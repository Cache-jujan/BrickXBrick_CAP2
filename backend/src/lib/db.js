// db.js — one shared Postgres connection pool for the whole app.
const { Pool } = require("pg");

// Neon requires SSL; a local Postgres install usually has it disabled.
// Must match db/migrate.js and db/seed.js.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { query, pool };