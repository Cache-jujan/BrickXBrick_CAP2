// reset_purchaser_b_password.js
// Force-sets testpurchaser2@gmail.com's Supabase password to a known value,
// in case it was created earlier with a different password than we assumed.
//
// Usage (from backend/ folder):
//   node scripts/reset_purchaser_b_password.js

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { supabaseAdmin } = require("../../src/lib/supabaseAdmin");
const { Pool } = require("pg");

const EMAIL = "testpurchaser2@gmail.com";
const NEW_PASSWORD = "TestPurch2123!";

async function main() {
    // Look up the real Supabase user ID — it's a different UUID from the
    // app's userID (Postgres userID != Supabase auth user id).
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    const dbResult = await pool.query(
        "SELECT supabaseuserid FROM users WHERE email = $1",
        [EMAIL]
    );
    await pool.end();

    if (dbResult.rowCount === 0) {
        console.error(`No user found in Postgres with email ${EMAIL}`);
        process.exit(1);
    }
    const SUPABASE_USER_ID = dbResult.rows[0].supabaseuserid;
    console.log("Found Supabase user ID:", SUPABASE_USER_ID);

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(SUPABASE_USER_ID, {
        password: NEW_PASSWORD,
        email_confirm: true,
    });
    if (error) {
        console.error("Reset failed:", error.message);
        process.exit(1);
    }
    console.log("Password reset OK for:", data.user.email);
    console.log(`New password: ${NEW_PASSWORD}`);

    // Sanity-check: try logging in right now via the actual API.
    const loginRes = await fetch("http://127.0.0.1:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: NEW_PASSWORD }),
    });
    const loginBody = await loginRes.json();
    console.log("Login test:", loginRes.status, loginBody.token ? "token received OK" : loginBody);
}

main();
