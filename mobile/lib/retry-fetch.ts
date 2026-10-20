// fetch that tries a second time when the first attempt fails to connect.
//
// Android keeps the last connection to the server open and reuses it. If the
// server restarted in between (a deploy, or `node --watch` in development),
// that old connection is dead and the first request fails at once with
// "Network request failed" / "connection reset"; a second attempt opens a new
// connection and works. Only a connection failure is retried, never a server
// answer, and only for requests that are safe to send twice.
import { isNetworkError } from "@/lib/sync/messages";

const RETRY_DELAY_MS = 400;

export async function fetchWithRetry(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return fetch(input, init);
  }
}
