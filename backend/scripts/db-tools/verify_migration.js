const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const col = await pool.query(
        "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='expenses' AND column_name='blockchainstatus'"
    );
    console.log("Expenses.blockchainStatus column:", col.rows);

    const tbl = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name='tamper_alerts'"
    );
    console.log("tamper_alerts table exists:", tbl.rows.length > 0);

    const ts = await pool.query(
        "SELECT column_default FROM information_schema.columns WHERE table_name='blockchainlogs' AND column_name='timestamp'"
    );
    console.log("BlockchainLogs.timestamp default:", ts.rows);

    await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });