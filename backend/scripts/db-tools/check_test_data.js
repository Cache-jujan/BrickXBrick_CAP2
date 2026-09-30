// check_test_data.js
// Read-only inspection: lists projects, tickets, and Purchaser/PM/SM users
// currently in the DB, so we know what's already seeded before writing
// setup data for test_expenses_api.sh.
//
// Usage (from backend/ folder):
//   node scripts/check_test_data.js

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("=== Users (PM / SM / Purchaser) ===");
  const users = await pool.query(
    `SELECT userid, name, email, role, status FROM users
     WHERE role IN ('Project Manager', 'Site Manager', 'Purchaser')
     ORDER BY role, name`
  );
  console.table(users.rows);

  console.log("\n=== Projects ===");
  const projects = await pool.query(
    `SELECT projectid, name, status, projectmanagerid, sitemanagerid FROM projects`
  );
  console.table(projects.rows);

  console.log("\n=== Tickets (with assignedTo email) ===");
  const tickets = await pool.query(`
    SELECT t.ticketid, t.projectid, t.status, t.assignedto, u.email AS assigned_email
    FROM tickets t
    LEFT JOIN users u ON u.userid = t.assignedto
    ORDER BY t.createdat DESC
    LIMIT 20
  `);
  console.table(tickets.rows);

  await pool.end();
}

main().catch((e) => {
  console.error("Query failed:", e.message);
  process.exit(1);
});
