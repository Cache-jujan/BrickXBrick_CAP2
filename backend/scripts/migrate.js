#!/usr/bin/env node
/* eslint-disable no-console */
// migrate.js — the one way to apply database migrations.
//
// Why this exists: migrations used to be applied by hand, with no record of
// which files had run on which database. That caused repeat test failures
// (a migration simply never got applied) and made a fresh deploy guesswork.
// This runner keeps a `schema_migrations` table so every database knows
// exactly what it has, applies only what's missing, and wraps each file in
// its own transaction so a failure leaves a clean state.
//
// Usage (from backend/, DATABASE_URL in the environment or backend/.env):
//   npm run migrate                 apply every pending migration, in order
//   npm run migrate -- --status     show applied vs pending, then exit
//   npm run migrate -- --dry-run    list what WOULD be applied, change nothing
//   npm run migrate -- --baseline   mark ALL files as applied WITHOUT running
//                                   them (for a database already built by hand)
//   npm run migrate -- --baseline-up-to 034
//                                   mark only files numbered <= 034 as applied
//                                   (use when a DB is known good up to N)
//
// Exit code is non-zero on any failure, so CI can gate on it.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const MIGRATIONS_DIR = path.resolve(__dirname, "../../infra/db/migrations");

// A migration filename starts with digits, optionally a letter suffix
// (e.g. 019a), then an underscore: 019a_vendor_master_atp_fix.sql.
const MIGRATION_RE = /^(\d+)([a-z]*)_.*\.sql$/i;

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => MIGRATION_RE.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}

// Numeric prefix of a filename, for --baseline-up-to comparisons. The letter
// suffix (019a) shares the number of its base (019) and is treated as <= 019.
function numericPrefix(filename) {
  const m = MIGRATION_RE.exec(filename);
  return m ? parseInt(m[1], 10) : NaN;
}

function parseArgs(argv) {
  const args = { status: false, dryRun: false, baseline: false, baselineUpTo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--status") args.status = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--baseline") args.baseline = true;
    else if (a === "--baseline-up-to") {
      const v = argv[i + 1];
      if (!v || !/^\d+$/.test(v)) {
        throw new Error("--baseline-up-to needs a number, e.g. --baseline-up-to 034");
      }
      args.baselineUpTo = parseInt(v, 10);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

async function ensureRegistry(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename  TEXT PRIMARY KEY,
      appliedAt TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedSet(client) {
  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  return new Set(rows.map((r) => r.filename));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Point it at the target database first.");
    process.exit(1);
  }

  const files = listMigrationFiles();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await ensureRegistry(client);
    const done = await appliedSet(client);
    const pending = files.filter((f) => !done.has(f));

    if (args.status) {
      console.log(`Applied (${files.length - pending.length}):`);
      for (const f of files) if (done.has(f)) console.log(`  ✓ ${f}`);
      console.log(`Pending (${pending.length}):`);
      for (const f of pending) console.log(`  • ${f}`);
      return;
    }

    if (args.baseline || args.baselineUpTo !== null) {
      const toMark = pending.filter(
        (f) => args.baseline || numericPrefix(f) <= args.baselineUpTo
      );
      if (toMark.length === 0) {
        console.log("Baseline: nothing to mark (all already recorded).");
        return;
      }
      for (const f of toMark) {
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
          [f]
        );
      }
      const label = args.baseline ? "all files" : `files up to ${String(args.baselineUpTo).padStart(3, "0")}`;
      console.log(`Baseline: recorded ${toMark.length} migration(s) as applied (${label}) WITHOUT running them.`);
      const stillPending = pending.filter((f) => !toMark.includes(f));
      if (stillPending.length > 0) {
        console.log(`Still pending (will run on the next 'npm run migrate'): ${stillPending.length}`);
        for (const f of stillPending) console.log(`  • ${f}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log("Database is up to date — nothing to apply.");
      return;
    }

    if (args.dryRun) {
      console.log(`Would apply ${pending.length} migration(s):`);
      for (const f of pending) console.log(`  • ${f}`);
      return;
    }

    console.log(`Applying ${pending.length} migration(s)…`);
    for (const f of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      process.stdout.write(`  → ${f} … `);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
        await client.query("COMMIT");
        console.log("ok");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.log("FAILED");
        console.error(`\nMigration ${f} failed and was rolled back:\n  ${err.message}\n`);
        console.error("No later migrations were applied. Fix the file and run again.");
        process.exit(1);
      }
    }
    console.log("All migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});