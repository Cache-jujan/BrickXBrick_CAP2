# F12 Spike 2 — 3-Node Clique Consensus

Proves the manuscript's "no single point of failure, 2-of-3 validator
consensus" claim mechanically, using 3 geth nodes on Clique PoA.

## Setup
See numbered steps in the master guide: generate 3 signer accounts,
build genesis.json, geth init all 3 datadirs, `docker compose up -d`,
manually peer via admin.addPeer, then static-nodes.json for persistence.

## Result
- 3/3 or 2/3 nodes online -> chain seals normally
- 1/3 nodes online -> sealing halts (matches UC-12-01 Exception E1)
- Killed nodes rejoin automatically via static-nodes.json

## Known gaps vs. real F12
- All 3 nodes run on one machine/Docker network, not 3 separate VPS
  (production target: 3 separate Hetzner instances)
- Peering is manual (admin.addPeer + static-nodes.json), not a proper
  bootnode/discovery setup
- A `tamper_alerts` table is referenced in UC-12-01 but isn't in our
  current Data Dictionary excerpt — open documentation question, not
  solved by this spike