===============================================================
BRICK X BRICK - BACKEND SETUP
Getting the full 10-table schema standing before F6 development
===============================================================

Work through these in order. Each step is small and checkable.
Total time: roughly 30-45 minutes.


---------------------------------------------------------------
STEP 1 - PLACE THE NEW FILES
---------------------------------------------------------------

Copy these into your backend/ folder:

  004_tickets.sql      -> backend/db/migrations/   (OVERWRITE the old one)
  009_milestones.sql   -> backend/db/migrations/   (new)
  010_tasks.sql        -> backend/db/migrations/   (new)
  migrate.js           -> backend/db/              (MOVE UP one level,
                                                    out of migrations/)

IMPORTANT: the old 004_tickets.sql used quoted camelCase ("ticketID")
which does NOT match your users/projects tables. If you already ran it
successfully, that's a surprise - see STEP 5 troubleshooting. Most
likely it failed, which is fine; the new one replaces it.

Also move seed.js up: backend/db/migrations/seed.js -> backend/db/seed.js

Why: db/migrations/ should hold ONLY numbered .sql files. The runner
(migrate.js) reads every .sql in that folder, so keeping scripts and
data separate avoids confusion later.


---------------------------------------------------------------
STEP 2 - INSTALL DEPENDENCIES
---------------------------------------------------------------

From backend/:

    npm install pg dotenv --save

Harmless if they're already installed.

  pg     = the PostgreSQL driver for Node. migrate.js uses it to talk
           to Neon.
  dotenv = reads your .env file into process.env so migrate.js can find
           DATABASE_URL.


---------------------------------------------------------------
STEP 3 - ADD THE NPM SCRIPT
---------------------------------------------------------------

Open backend/package.json. Inside "scripts", add:

    "migrate": "node db/migrate.js",
    "seed": "node db/seed.js"

Now you can run `npm run migrate` instead of remembering the path.


---------------------------------------------------------------
STEP 4 - BASELINE THE MIGRATION TRACKER
---------------------------------------------------------------

This step only matters ONCE, because you ran 001-008 by hand before
migrate.js existed. Skip it and migrate.js will try to re-run tables
that already exist.

4a. Run the migrator once so it creates its tracking table:

        npm run migrate

    It will create schema_migrations, then try to apply 001 and probably
    error out ("already exists"). That's expected. Don't panic.

4b. Open the Neon SQL editor and paste this ONCE:

    INSERT INTO schema_migrations (filename) VALUES
      ('001_extensions.sql'),
      ('002_users.sql'),
      ('003_projects.sql'),
      ('005_vendor_master_list.sql'),
      ('006_expenses.sql'),
      ('007_receipt_allocations.sql'),
      ('008_fraud_flags_and_blockchain_logs.sql')
    ON CONFLICT DO NOTHING;

    NOTE: 004_tickets.sql is deliberately NOT in this list, because it
    almost certainly failed the first time (wrong column naming). We
    want migrate.js to actually run the corrected version.

4c. Run it again:

        npm run migrate

    Expected output:
        skip   001_extensions.sql
        skip   002_users.sql
        skip   003_projects.sql
        apply  004_tickets.sql
        skip   005_vendor_master_list.sql
        skip   006_expenses.sql
        skip   007_receipt_allocations.sql
        skip   008_fraud_flags_and_blockchain_logs.sql
        apply  009_milestones.sql
        apply  010_tasks.sql
        Done. All migrations applied.

From now on, everyone on the team just runs `npm run migrate`. No more
pasting SQL by hand.


---------------------------------------------------------------
STEP 5 - IF 004 FAILS
---------------------------------------------------------------

If you see: 'relation "Tickets" already exists' or similar - the old
broken version partially got in. Drop it in the Neon SQL editor:

    DROP TABLE IF EXISTS "Tickets";
    DROP TABLE IF EXISTS tickets;
    DELETE FROM schema_migrations WHERE filename = '004_tickets.sql';

Then run `npm run migrate` again.

If you see: 'relation "expenses" does not exist' or an FK error
mentioning a column name - your 006_expenses.sql may name the column
something other than ticket_id. Check it and tell Claude.


---------------------------------------------------------------
STEP 6 - WIRE UP THE ERROR HANDLER
---------------------------------------------------------------

Open backend/src/app.js.

Near the top, with your other requires:

    const errorHandler = require('./middleware/errorHandler');

Then, AFTER every app.use() route mount, as the very LAST thing before
you export the app:

    app.use(errorHandler);

Why last: Express walks middleware top to bottom. The error handler has
to sit at the end of that chain to catch anything the routes threw.
Express identifies it purely by it having 4 arguments (err, req, res,
next) - don't remove the unused `next`, it stops working.


---------------------------------------------------------------
STEP 7 - VERIFY THE SCHEMA
---------------------------------------------------------------

In the Neon SQL editor:

    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;

You should see 11 rows - the 10 Data Dictionary tables plus the
tracker:

    blockchain_logs
    expenses
    fraud_flags
    milestones
    projects
    receipt_allocations
    schema_migrations
    tasks
    tickets
    users
    vendor_master_list

If all 11 are there, the database is done. F6 is unblocked.


---------------------------------------------------------------
STEP 8 - CONFIRM .ENV IS NOT TRACKED
---------------------------------------------------------------

From backend/:

    git check-ignore .env

If it prints ".env" -> good, it's ignored.
If it prints nothing -> .gitignore isn't being picked up. Check it's at
backend/.gitignore (or repo root, depending on where you run git).

Then confirm it was never committed before .gitignore existed:

    git log --all --oneline -- .env

If that prints ANY commits, your Supabase service-role key and Neon
connection string are in git history. Rotate both keys immediately -
deleting the file now does not remove it from history.


---------------------------------------------------------------
NOTES FOR THE TEAM
---------------------------------------------------------------

Column naming: this schema uses snake_case (user_id, project_id).
The manuscript's Data Dictionary writes them camelCase (userID). This
is a deliberate, consistent deviation - Postgres folds unquoted
identifiers to lowercase, so snake_case avoids needing quotes on every
single query. Worth one sentence in the manuscript's implementation
notes so the panel doesn't read it as an error.

Enum-ish values: CHECK constraints use PascalCase with no spaces
('GeneralManager', 'MaterialRequest', 'OnTrack'). The manuscript writes
them with spaces ('General Manager'). Every module MUST use the DB's
exact strings or inserts get rejected. Agree on this as a team now.

Role constraints not enforced in DB: the Data Dictionary says things
like "only Project Manager role users may appear in created_by". That
is enforced in application code (requireRole middleware), not by a
database constraint - Postgres would need a trigger to check the role
of a referenced row, which is overkill here. Note this if the panel
asks.

supabase_user_id is nullable in 002_users.sql but the Data Dictionary
says NOT NULL. This is intentional for now (lets you seed test users
without Supabase records). F1 should tighten it before final defense.