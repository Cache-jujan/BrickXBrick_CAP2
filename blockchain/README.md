# F12 Spike — Blockchain Notary (Proof of Concept)

Disposable spike proving the F12 mechanism: hash an approved expense,
write the hash on-chain, later re-verify by recomputing and comparing.

## Setup
1. `docker compose up -d` — starts a single `geth --dev` node on :8545
2. `npm install`
3. `cp .env.example .env`

## Scripts
- `node connect.js` — sanity check: connect + print dev account balance
- `node store.js` — hash a fake expense, write hash on-chain, save a
  BlockchainLogs-shaped record to `data/blockchainLogs.json`
- `data/blockchainLogs.json` fields (Table 38 BlockchainLogs):
  logID, expenseID, actorID, txHash, blockNumber, eventType,
  validatorNodeCount, consensusType, timestamp
- `node verify.js <expenseID>` — recompute hash, compare to on-chain value,
  print VERIFIED or TAMPERED
- 

## Tamper logging + queue/retry (Spike 3)

- `verify.js` now writes a permanent record to `data/tamperAlerts.json`
  on every TAMPERED result (stand-in for the `tamper_alerts` table),
  plus a console "SYSADMIN NOTIFIED" block (stand-in for a real
  notification channel — not implemented here).
- `store.js` now bounds `tx.wait()` to 15s. If it times out (fewer than
  2 of 3 validator nodes online), the expense is queued to
  `data/pendingQueue.json` instead of hanging or crashing.
- `retry.js` drains that queue, retrying each entry against the chain.
  Succeeded entries move to `blockchainLogs.json`; still-failing ones
  stay queued.
- Known shortcut: retry is a manual command in this spike. A real F12
  build would run this automatically on a schedule or via a node-status
  watcher, not require someone to type `node retry.js`.

## Known gaps vs. real F12 (see code comments for exact locations)
- Single node, not 3-node Clique PoA with 2-of-3 consensus
- JSON file stand-in for the Postgres `BlockchainLogs` table
- No custom Solidity contract — hash is written as raw tx calldata
- Tamper notification is `console.warn`, not a real alert channel
- A `tamper_alerts` table is referenced in UC-12-01's alternative course and
  sequence diagrams but isn't in our current Data Dictionary excerpt — this
  is a documentation gap to raise with the team, not something this spike
  invents a schema for.
- Starting multiple Clique nodes simultaneously can race: a node may try
  to resolve a peer's Docker DNS name before that peer's container has
  registered on the network, causing a fatal crash instead of a retry.
  Mitigation used in this spike: start nodes with a short delay between
  them (or restart any node that crashes this way — it succeeds once its
  peers are already up).