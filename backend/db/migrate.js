/**
 * db/migrate.js
 *
 * Minimal migration runner for Brick x Brick.
 *
 * Runs every .sql file in db/migrations/, in filename order (001_, 002_,
 * 003_...), against DATABASE_URL. Safe to re-run: each applied file is
 * recorded in a schema_migrations table, and anything already recorded
 * gets skipped.
 *
 * Usage:
 *   node db/migrate.js
 *   npm run migrate
 *
 * Requires: npm install pg dotenv --save
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// The runner lives in db/, the SQL lives in db/migrations/.
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Neon requires SSL; a local Postgres install usually has it disabled and
// will reject an SSL handshake outright. Deciding from the host keeps this
// file, seed.js, and src/lib/db.js in agreement, and means switching
// between Neon and local is a .env change with no code edit.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing from your .env file.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  try {
    // 1. Make sure we have somewhere to record what's already applied.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    VARCHAR(255) PRIMARY KEY,
        applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Read what's already been applied.
    const { rows } = await pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    // 3. Collect .sql files, sorted so 001_ runs before 002_, etc.
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No .sql files found in db/migrations/.');
      return;
    }

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`apply  ${file}`);

      // Each file runs in its own transaction: if anything inside fails,
      // the whole file rolls back and it is NOT marked as applied, so you
      // can fix the SQL and just run migrate again.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`FAILED ${file}: ${err.message}`);
        throw err;
      } finally {
        client.release();
      }
    }

    console.log('Done. All migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration run failed:', err.message);
  process.exit(1);
});