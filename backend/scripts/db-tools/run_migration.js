const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");

async function main() {
    const migrationFile = process.argv[2];
    if (!migrationFile) {
        console.error("Usage: node run_migration.js <path-to-sql-file>");
        process.exit(1);
    }
    const sql = fs.readFileSync(migrationFile, "utf8");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(sql);
    await pool.end();
    console.log("Migration applied:", migrationFile);
}

main().catch((e) => { console.error(e.message); process.exit(1); });