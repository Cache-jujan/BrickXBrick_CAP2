# Tamper demo (F12): runbook

About 6 minutes. Two windows side by side:

- **Left:** the web app, signed in as the **General Manager**.
- **Right:** the **Neon SQL editor**, playing "an insider with database access".

**Why the database and not the app?** An approved expense can't be edited in the app: no
screen allows it and the backend refuses. Anyone who wants to change one has to go around the
app, straight to the database, which is what a dishonest insider would do (a developer, IT
staff, anyone holding the database password). That is exactly the case the blockchain covers.
We don't add a "tamper" button to the app: it would itself be a security hole.

---

## 1. Before presenting

| # | Do this | You should see |
|---|---|---|
| 1 | AWS console → EC2 → **start all 3 nodes** about 10 minutes before. Node 1 keeps its Elastic IP, so the backend URL doesn't change. | 3 instances "running" |
| 2 | On any node: `sudo bash setup-node.sh status` | the block number goes up every ~15 s, `peers: 2`, 3 signers |
| 3 | In the app, as **General Manager**: Tamper Alerts → review every old test alert (with a reason), so the list starts clean. | "To review" is empty |
| 4 | Have one approved expense with **"Record secured"**. None? As Purchaser submit one, as PM approve it, wait ~15 s. | pill says "Record secured" |
| 5 | In Neon, run query A below and **copy the expense ID and its current amount** into a note. | one row per secured expense |
| 6 | Practice once: steps 2 to 5 of the demo, then restore. Take screenshots as a fallback. | |

**Query A: secured expenses**
```sql
SELECT e.expenseid, e.vendorname, e.amount, e.blockchainstatus, p.name AS project
  FROM expenses e
  JOIN projects p ON p.projectid = e.projectid
 WHERE EXISTS (SELECT 1 FROM blockchainlogs b
                WHERE b.expenseid = e.expenseid AND b.eventtype = 'ExpenseApproved')
 ORDER BY e.submittedat DESC
 LIMIT 10;
```

---

## 2. On stage

### Step 1: The approved expense
**Show:** the project page → the expense → "Record secured". Optional: **Check for changes** → "No changes found".

**Say:** "When the PM approved this expense, the system took a fingerprint of it, a SHA-256 hash of
the vendor, amount, date, category, quantity, BIR status and who submitted it, and wrote it to our
private blockchain on three AWS servers. The database keeps the expense; the blockchain keeps the proof."

### Step 2: The insider changes it (Neon)
```sql
UPDATE expenses SET amount = 58500 WHERE expenseid = 'PASTE_EXPENSE_ID';
```
**Say:** "I'm someone with database access. I skip the app and raise the amount. No approval,
nothing in the app. In most systems nobody would ever know."

### Step 3: The system catches it (app)
**Do:** refresh → the expense → **Check for changes**.

**Show:** "This expense was changed after approval", the pill "Changed after approval", the
Tamper Alerts badge and the notification bell.

**Say:** "It recomputed the fingerprint from today's data and compared it with the copy on the
blockchain. They don't match. Even without this button, the server re-checks every secured
expense every 3 minutes."

### Step 4: Try to cover it up (Neon)
```sql
DELETE FROM tamper_alerts WHERE expenseid = 'PASTE_EXPENSE_ID';
```
→ refused: **"Tamper alerts cannot be deleted"**
```sql
DELETE FROM blockchainlogs WHERE expenseid = 'PASTE_EXPENSE_ID';
```
→ refused: **"Blockchain log records cannot be changed or deleted"**
```sql
UPDATE expenses SET blockchainstatus = 'Confirmed' WHERE expenseid = 'PASTE_EXPENSE_ID';
```
→ allowed, but **Check for changes** flips it straight back to "Changed after approval".

**Say:** "The status is only a cached result; every check recomputes it. And even an admin who
removes these database protections can't touch the copy on the blockchain: each of the three
servers keeps its own copy, and each block is sealed with a signer's key, so the others reject a
rewritten history."

### Step 5: Review and restore
**Do:** Tamper Alerts → the alert → **Review** with a reason (10+ characters).
```sql
UPDATE expenses SET amount = PASTE_ORIGINAL_AMOUNT WHERE expenseid = 'PASTE_EXPENSE_ID';
```
**Do:** **Check for changes** → "No changes found", back to "Record secured".

**Say:** "Reviewing never erases anything: it records who, when and why, and whoever approved the
expense can't review its own alert. Once the data is back to what was approved, the fingerprints
match again; the alert stays on record, marked restored."

---

## 3. Questions the panel may ask

| Question | Answer |
|---|---|
| Does the blockchain prevent the change? | No, it **detects** it. The point is that a change can't be made silently. |
| What is on the chain? | Only the 64-character hash. No names, amounts or receipts (Data Privacy Act). |
| Is the database the only way to cheat? | No. Fake receipts **before** approval are caught by F9 (BIR fields, duplicates, unknown vendors); PM and Purchaser working together is handled by role separation and GM review. The blockchain covers one risk: an approved record changed afterwards. |
| What if a node is down? | Blocks continue with 2 of 3. If the chain can't be reached, approvals still save and the fingerprint is written later; checks say "couldn't run the check", never "tampered". |
| Who runs the 3 nodes? | One AWS account today, so it proves the mechanism, not independence. In production each node should be run by a different party or provider. |
| Can someone change the expense and write a new fingerprint? | No. Checks always use the **first** fingerprint written at approval, and the database refuses a second one for the same expense. |

## 4. If something goes wrong

| Problem | Do this |
|---|---|
| Check says "couldn't run the check" | The nodes aren't reachable: start them, wait 1–2 min. Otherwise use the screenshots, and explain this message is the designed behaviour when nodes are down. |
| No "Check for changes" button | Sign in as **General Manager**; the expense must say "Record secured". |
| Forgot to restore | Run the restore `UPDATE` with the original amount any time. |

## 5. For the slides (presentation)

1. **The problem:** "Inside the app an approved expense is locked. The risk is someone editing it directly in the database."
2. **How it works:** approve → SHA-256 fingerprint → written to 3 EC2 nodes (Clique, 2 of 3) → every check recomputes and compares. Use the diagram in `../aws/README.md`.
3. **Live demo:** the 5 steps above.
4. **Honest limits:** detects, doesn't prevent; one AWS account today; image and OR/BIR number not fingerprinted yet (future work).
