// db.js — one shared Postgres connection pool for the whole app.
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function query(text, params) { return pool.query(text, params); }
module.exports = { query, pool };
