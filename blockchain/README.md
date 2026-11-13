# BrickXBrick blockchain (F12): record protection

An approved expense is fingerprinted with SHA-256 and the fingerprint is written to a private
3-node Clique Proof-of-Authority chain. Later, the expense is re-hashed from Postgres and
compared with the first hash on the chain. A difference means the record was changed after
approval. The chain **detects** tampering; it does not prevent it.

## Where things are

| What | Where |
|---|---|
| How it runs, what is on the chain, failure modes, honest limits | [`aws/README.md`](aws/README.md) |
| Node setup script (docker, signer key, genesis, peers, Caddy) | [`aws/setup-node.sh`](aws/setup-node.sh) |
| Live tamper demo runbook | [`demo/TAMPER_DEMO.md`](demo/TAMPER_DEMO.md) |
| Hashing, chain write, retry | `backend/src/lib/blockchainService.js` |
| Integrity check and tamper alerts | `backend/src/lib/integrityCheck.js`, `backend/src/lib/tamperAlerts.js` |
| Background jobs | `backend/src/server.js` |
| Tables and guards | `infra/db/migrations/029_tamper_alert_integrity.sql` (`BlockchainLogs`, `tamper_alerts`) |

## The design in short

- **Chain:** 3 geth v1.13.15 nodes, Clique PoA, 15 s blocks, chain ID 31337. 2 of 3 signers must be online to seal blocks.
- **Hosting:** three AWS EC2 t3.micro instances in three regions (Singapore, Tokyo, Mumbai), one AWS account, peering over the public internet with security-group rules. See `aws/README.md`.
- **What goes on the chain:** only a 64-character SHA-256 hash, never names, amounts or images.
- **Expense hash:** version 2 has 12 fields (version tag, expense ID, project ID, submitted by, approved by, vendor, amount, receipt date, category, BIR status, OR/SI number, TIN, quantity). Version 1 (9 fields) records still verify.
- **Proof:** the first `ExpenseApproved` record in `BlockchainLogs` for an expense is the one checked; a later record cannot replace it.
- **Write:** the approval is saved first, then the hash is sent to the chain (up to 30 s). If the chain doesn't answer, the expense stays Pending and a job retries every 60 s.
- **Check:** the GM's "Check for changes" button, plus an automatic scan of every secured expense every 3 minutes. Results are Match, Mismatch (status `TamperDetected`, a `tamper_alerts` row, and a notification to System Administrators and General Managers), or Unreachable (the chain could not be reached; never reported as tampering).
- **Tamper alerts and chain records** cannot be edited or deleted in the database (migration 029). If the guards are dropped, the next scan re-creates the alert, because the proof is on the chain.

## Other folders

- `cluster/`: the earlier local 3-node Docker Compose cluster (Clique), kept for running the chain on one machine.
- `connect.js`, `store.js`, `verify.js`, `retry.js`, `docker-compose.yml`, `lib/`: the original single-node proof of concept. **The backend does not use them.** They are kept for reference and write to local JSON files, not Postgres.
