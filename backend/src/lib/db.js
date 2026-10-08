// db.js — one shared Postgres connection pool for the whole app.
const { Pool, types, defaults } = require("pg");

// All TIMESTAMP columns are "without time zone" and filled by NOW(), which
// Neon runs in UTC. By default node-postgres reads them as *local* time, so
// on a Philippine-time server every createdAt/detectedAt was shown 8 hours
// early (an alert at 6:20 PM appeared as 10:20 AM). Read them as UTC, and
// write JS Dates as UTC too, so stored and displayed times agree.
const TIMESTAMP_WITHOUT_TZ = 1114;
types.setTypeParser(TIMESTAMP_WITHOUT_TZ, (value) =>
    value === null ? null : new Date(value.replace(" ", "T") + "Z")
);
defaults.parseInputDatesAsUTC = true;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query(text, params) { return pool.query(text, params); }

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client); // fn receives a client with the same .query(text, params) shape
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, pool, withTransaction };
