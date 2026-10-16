# Decisions and learnings

## F11 / F10 build (spec revision 2)

### D1. Spend model for F11: child expense rows only (Model B)

`backend/src/routes/allocations.js` (POST `/`) saves a split receipt as:

- one `expenses` row per project portion (a full expense with its own `amount`), and
- one `receiptallocations` row per portion that points at that same child expense
  (`allocatedamount` = the child's `amount`).

There is no parent expense for the whole receipt. So F11 reads `expenses` only
(`status = 'Approved'`) and never joins `receiptallocations`. Joining it would
add nothing and invites double-counting.

Proof queries (spec section 9) run on the local database after
`npm run migrate` (migrations 001-039):

```
SELECT count(*) FROM receiptallocations;            -- 0
SELECT e.expenseid, e.amount, ra.projectid, ra.allocatedamount
  FROM expenses e JOIN receiptallocations ra ON ra.expenseid = e.expenseid
 LIMIT 10;                                          -- 0 rows
```

The database was freshly built, so both are empty. They prove the schema, not
the data. The data proof (a 4500 split into 2000 + 2500 counts once, total 4500)
comes with the R4 seed script, which builds the split with `planAllocation` and
the same two INSERTs the route uses.

### D2. Task photos

The online `POST /api/tasks/:id/progress` takes the photo in the same multipart
request and stores it with `uploadBuffer` (`lib/r2.js`) under `tasks/<id>`. A
JSON sync batch cannot carry a photo, so S2 adds `POST /api/tasks/:id/photo`
and a `taskPhotoExists(url)` check (R2 head-object).

### D3. Tasks are binary

No percentages. The Site Manager submits photo + note, the row is Pending
Review, and only the PM Acknowledge sets Completed and runs milestone
recalculation and the variance alert. Idempotency uses the existing UNIQUE
`task_progress_log.clientSubmissionId`, so there is no migration 041.

### D4. Migrations

- Next free number is 040 (`report_events`). 041 stays free.
- Gaps at 010 and 023 are intentional. Never renumber: `schema_migrations`
  tracks applied files by filename.
- Run with `npm run migrate` (`backend/scripts/migrate.js`), not
  `db-tools/run_migration.js`, which records nothing in `schema_migrations`.
- `blockchainlogs` is append-only (migration 029): only INSERT. Report anchor
  status lives on `report_events`.

### D5. Local database in the cloud session

The cloud container has no Docker daemon, so local verification used the
installed PostgreSQL 16 (database `brickxbrick`, user `brickuser`) instead of
the Docker Postgres 14 in `docker-compose.yml`. Neon was never touched. Re-run
the checkpoints on Docker Postgres 14 on your machine if you want exact parity.

### D6. Choices made while building (review at the defense)

- **SUPERSEDED on sync.** A queued task update is rejected (`SUPERSEDED`) when the
  task already has a Pending Review row, as spec revision 2 says ("server wins").
  The online route does the opposite (a new submission replaces the pending one).
  The check runs under the task row lock, so it cannot race.
- **Replay beats every other check.** A task update whose uuid was already saved
  reports synced even if the task was since completed or the photo check would
  now fail (same as expenses).
- **Could not check is not rejected.** A photo-storage timeout leaves the item out
  of the sync response so the phone keeps it pending. Only a confirmed-missing
  file is `MISSING_PHOTO`.
- **72-hour rule.** Pending offline entries are never deleted for being old (the
  old code did delete them at app start). Old pending entries block NEW entries
  with a warning and still sync.
- **Empty report.** `POST /api/reports/pdf` returns 400 when the period has no
  approved expenses, so an all-zero report is never anchored.
- **Money sums.** Report totals are added in whole centavos in JS (exact), not in
  SQL; the spec said SQL, but its pure builder takes row-level inputs.
- **Dev DB.** Checkpoints ran on PostgreSQL 16 (no Docker daemon in the cloud
  session), not the Docker Postgres 14 in `docker-compose.yml`.
- **Config typo noticed, not changed:** `backend/.env.example` says
  `R2_PUBLIC__BASE_URL` (two underscores); the code reads `R2_PUBLIC_BASE_URL`.
