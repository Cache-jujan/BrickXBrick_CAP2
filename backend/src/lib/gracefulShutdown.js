// Graceful shutdown for Cloud Run.
//
// Cloud Run sends SIGTERM on every redeploy and scale-down, then kills the
// container about 10 seconds later. Without a handler Node dies at once, and
// an expense approval cut off halfway is how a chain write goes missing.
//
// On the first signal this:
//   1. stops the background timers (chain retry, tamper scan, schedule sweep)
//   2. stops accepting new requests and lets the ones in progress finish
//      (idle keep-alive connections are closed so they do not hold things up)
//   3. waits for a background pass that is already running to end
//   4. closes the database pool
//   5. exits 0
// If that is not done within timeoutMs, it exits 1 anyway, so the container
// never hangs until Cloud Run kills it. Calling it again is harmless.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createGracefulShutdown({
  server,
  stopTimers,
  isBusy = () => false,
  closeDb,
  timeoutMs = 8000,
  pollMs = 100,
  log = console.log,
  exit = process.exit,
}) {
  let running = null;

  return function shutdown(signal = "shutdown") {
    if (running) return running;

    running = (async () => {
      log(`${signal} received: refusing new requests and finishing the ones in progress`);
      let timedOut = false;
      const force = setTimeout(() => {
        timedOut = true;
        log(`Shutdown still not finished after ${timeoutMs} ms: exiting now`);
        exit(1);
      }, timeoutMs);

      try {
        stopTimers();

        const closed = new Promise((resolve) => server.close(resolve));
        // A keep-alive connection with no request on it would keep close() waiting.
        const sweep = setInterval(() => server.closeIdleConnections?.(), pollMs);
        await closed;
        clearInterval(sweep);

        while (isBusy() && !timedOut) await sleep(pollMs);
        if (timedOut) return;

        await closeDb();
        clearTimeout(force);
        log("Shutdown complete");
        exit(0);
      } catch (err) {
        clearTimeout(force);
        log(`Shutdown failed: ${err.message}`);
        exit(1);
      }
    })();

    return running;
  };
}

module.exports = { createGracefulShutdown };
