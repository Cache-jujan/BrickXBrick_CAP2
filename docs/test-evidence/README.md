# Test evidence: F10 (Site Manager offline task updates) and F11 (Financial analytics)

Everything here was produced on the local development database (PostgreSQL 16,
seed data from `backend/scripts/db-tools/seed_report_data.js`). Nothing was run
against Neon. The browser pages were driven by a headless Chromium with a
**stubbed login and a fake blockchain**, because the cloud sandbox has no
Supabase and no Geth. Re-run the items marked **YOU RUN THIS** on real systems
before the defense.

## Mapping to the manuscript test ids

I did not have the manuscript while building this, so the ids below follow the
build spec's own mapping. Check each one against your Chapter tables.

| Manuscript id | What it covers | Evidence | Status |
|---|---|---|---|
| UT-C009 (F11 unit) | 5,000 + 7,000 + 3,000 spend on a 50,000 budget gives 15,000 spend, 35,000 net, 30.00% | `test-output/f11-backend.txt` ("three approved expenses ... (UT-C009 style)") | passed |
| UT-C030 (F11 unit) | Other F11 maths: overrun, budget 0, BIR, split receipt counted once, report hash | `test-output/f11-backend.txt`, `f11-hash-TZ-*.txt` | passed |
| STC-005 (report and RBAC) | GM generates, exports and anchors a report; PM, Site Manager, Purchaser get 403 | `screenshots/F11-reports-page-seed-1-31-oct.png`, `F11-rbac-*.png`, `sample-pdfs/`, `f11-backend.txt` | passed (stub login, fake chain) |
| UAT-GM-01 | GM reads figures and exports a PDF | same as STC-005 | **YOU RUN THIS** with a real GM login |
| STC-002 and STC-007 (offline) | Queue, coalesce, 100-entry limit, 72-hour rule, sync, reject codes | `test-output/f10-backend.txt`, `f10-mobile.txt` | logic passed; phone test **YOU RUN THIS** |
| UAT-P-01 | Offline use on a real phone | none | **YOU RUN THIS**: airplane-mode script, spec section 6.3 |

## Files

- `screenshots/F11-reports-page-seed-1-31-oct.png`: cards 150,000.00 / 94,500.50 / 55,499.50 / 63.00%, chart, BIR table.
- `screenshots/F11-exported-pdf-confirmed-page1.png`: the exported PDF, anchor line Confirmed.
- `screenshots/F11-rbac-project-manager-not-authorized.png`, `F11-rbac-site-manager-not-authorized.png`: no Reports menu, `/reports` shows Not authorized. The API also answered 403 for GET summary, POST pdf and POST anchor for both roles.
- `sample-pdfs/F11-report-anchor-pending.pdf` and `...-confirmed.pdf`: the same report exported with the chain down and up.
- `test-output/`: spec-reporter output of the F10 and F11 test files; the hash tests also under `TZ=UTC` and `TZ=Asia/Manila`.

## Full-suite results at the time of writing

- backend `npm test`: 381 tests, 379 pass, 0 fail, 2 `todo` (existing, not mine).
- mobile `npm test`: 40 tests, 0 fail. `tsc --noEmit`: clean.
- frontend `vite build`: ok. ESLint: 1 pre-existing problem in `Topbar.jsx` (unused `handleMarkRead`), nothing in the F11 files.

## Proposed new line for the System Test table (manuscript)

The manuscript's offline test only covers expenses. Suggested addition:

> **STC-0xx** | F10 Offline Operation | Site Manager submits task evidence (camera photo and note) while offline; the update is queued (one per task), and on reconnect the photo is uploaded first and the update is sent through `POST /api/sync`; the PM then sees it as Pending Review. | Rejected updates (task reassigned, task completed, submission already waiting) are listed to the Site Manager with a plain reason. | Expected: no duplicate on repeat sync; 101st queued entry blocked.

## Intentional deviations from the manuscript (say these at the defense)

1. Table 28 stores the photo as Base64 plus a completion percentage and an issue report. The app stores a **file path** (a 10 MB Base64 row risks slow queries and crashes), and the model is **photo + note** because tasks in this system are binary (only the PM Acknowledge completes a task).
2. Item 10.5 (ticket interactions offline) stays deferred: Site Managers only view tickets, so there is nothing to queue.
3. PDF amounts print as `PHP 12,345.00` because standard PDF fonts have no peso sign; this avoids bundling fonts into the Cloud Run image.
