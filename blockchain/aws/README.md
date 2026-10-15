# BrickXBrick blockchain on AWS EC2

How the private blockchain behind F12 (record protection) runs, what it stores, and
what it does and doesn't guarantee. Setup commands are in `setup-node.sh`; the live
demo steps are in `../demo/TAMPER_DEMO.md`.

## 1. The picture

```
                    Backend (Cloud Run / laptop)            Postgres (Neon)
                    lib/blockchainService.js  ───────────►  Expenses, BlockchainLogs,
                              │                              tamper_alerts
                              │ HTTPS  GETH_RPC_URL
                              │ https://<ip>.sslip.io/<secret-token>
                              ▼
  ┌──────────────────────── AWS VPC (one account) ─────────────────────────┐
  │                                                                        │
  │  EC2 node 1 (Elastic IP)        EC2 node 2              EC2 node 3      │
  │  ┌──────────────────────┐   ┌────────────────┐   ┌────────────────┐    │
  │  │ Caddy :443 (HTTPS)   │   │                │   │                │    │
  │  │   /<token> → :8545   │   │                │   │                │    │
  │  │ geth v1.13.15        │◄─►│ geth v1.13.15  │◄─►│ geth v1.13.15  │    │
  │  │ signer A (own key)   │   │ signer B       │   │ signer C       │    │
  │  └──────────────────────┘   └────────────────┘   └────────────────┘    │
  │        P2P :30303 over private VPC IPs (static peers, no discovery)    │
  └────────────────────────────────────────────────────────────────────────┘
```

| Part | Value | Where it's set |
|---|---|---|
| Nodes | 3 × EC2 (t3.micro + 2 GB swap), one geth container each | `setup-node.sh init` |
| Consensus | **Clique Proof-of-Authority**, 3 authorized signers | genesis `extradata` |
| Block time | 15 s (`period: 15`) | `CLIQUE_PERIOD` |
| Chain ID | 31337 (private, not connected to Ethereum) | `CHAIN_ID` |
| geth version | pinned **v1.13.15** (Clique was removed in 1.14) | `GETH_IMAGE` |
| Peering | static peers over private VPC IPs, `--nodiscover` | `config.toml` |
| RPC | geth listens on `127.0.0.1:8545` only; node 1 exposes it through Caddy (auto HTTPS via sslip.io) at a secret random path; any other path returns 404 | Caddyfile |
| Keys | each signer key is created on its own machine and never leaves it | `init` |

**Why 3 nodes?** Clique lets a signer seal at most one block in any 2 consecutive blocks
(`floor(3/2)+1 = 2`). So **2 of 3** signers must be online for new blocks. With 1 node
left, sealing stops; nothing is lost, and writes wait in the retry queue.

## 2. What goes on the chain

Only a **SHA-256 hash** (64 hex characters) of the approved expense, placed in the data
field of a 0-value transaction from node 1's account to itself. No names, amounts,
receipts or images go on-chain, so personal data stays in Postgres (Data Privacy Act).

The hash covers (`canonicalizeExpense` in `backend/src/lib/blockchainService.js`):
expense ID, project ID, submitted by, vendor name, amount, receipt date (normalized to
Manila midnight), category, BIR validation status and quantity.

## 3. Write: when an expense is approved

1. PM/GM approves → backend computes the hash.
2. Backend sends the transaction through `GETH_RPC_URL` and waits up to 30 s for it to be sealed in a block.
3. Saves `txHash`, `blockNumber` and the peer count to **BlockchainLogs** → expense status **Confirmed** ("Record secured").
4. If the chain doesn't answer in time, the status stays **Pending** ("Securing record"), and a job retries every 60 s until it's written. The approval itself is saved *before* the chain write, so it never fails because of the chain. At worst, the Approve click takes up to 30 s to answer.

## 4. Verify: how a change is caught

1. Recompute the hash from the expense as it is **now** in Postgres.
2. Read the transaction of the **first** approval record from the chain and take its data field.
3. Same → **Match** (status Confirmed). Different, or transaction missing → **Mismatch**:
   status **TamperDetected**, a `tamper_alerts` row, and a notification to every active System
   Administrator and General Manager.
4. This runs on the GM's **"Check for changes"** button and automatically **every 3 minutes**
   for every secured expense (least recently checked first).

Database guards (migration 029) refuse to delete alerts or edit or delete chain records, and
refuse a second approval record per expense. The cached status column is never trusted; every
check recomputes it.

## 5. Failure modes

| Situation | What happens |
|---|---|
| 1 node down | Blocks continue with 2 signers. No visible change. |
| 2 nodes down | No new blocks. New approvals stay "Securing record" and are retried every minute. Checks answer "couldn't run the check, your records are safe", **never** "tampered". |
| Node 1 (gateway) down | Backend can't reach the chain (same as above) even if nodes 2 and 3 are up. Known single point for *access*, not for the data. |
| Instances stopped and started | Private IPs and the Elastic IP stay, so peers and the backend URL keep working. Chain data is on the EBS disk. |
| Someone edits an expense in Postgres | Caught at the next check (button or ≤ 3 min scan). |
| Someone deletes the alert or the chain record in Postgres | Refused by the guards. If an admin drops the guards, the next scan re-creates the alert, because the proof is on the chain, not in Postgres. |

## 6. Honest limits

- **Detects, doesn't prevent.** Someone with database access can still change a record; they can't do it silently.
- **One AWS account.** All 3 nodes are run by our team, so this proves the mechanism, not independent trust. For production, each node should be run by a different party (e.g. the company, its accountant or auditor, the client) or on separate providers (Hetzner was the original target).
- **Gateway access = write access.** Node 1's account is unlocked so the backend can send transactions. Anyone holding the secret RPC URL could add junk transactions. They still **cannot change or remove** existing ones. Keep `GETH_RPC_URL` secret; rotate the token on node 1 by deleting `/opt/bxb/rpc-token`, re-running `start` with the same arguments, then `docker restart bxb-caddy`, and put the new `url` in `backend/.env`.
- **Hash only proves "unchanged since approval".** It doesn't prove the receipt was genuine when submitted; that is F9's job (BIR checks, duplicate and vendor screening).
- **Not every field is fingerprinted yet.** The hash covers the fields in §2. The receipt image, the OR/BIR number, the approver and how a split receipt is divided are not in it, so a change to those isn't caught. Future work: add them, plus a fingerprint of the image file itself.

## 7. Operating it

```bash
sudo bash setup-node.sh status   # on any node: {"block":…, "peers":2, "signers":[3 addresses]}
sudo bash setup-node.sh url      # on node 1: prints GETH_RPC_URL for backend/.env
```
