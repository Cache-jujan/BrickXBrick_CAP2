// create_purchaser_b.js
// One-off script: logs in as the seeded System Administrator, then creates
// a second Purchaser account (testpurchaser2@gmail.com) so test_expenses_api.sh
// has a real EMAIL_PURCHASER_B / PASSWORD_PURCHASER_B to use.
//
// Usage (from backend/ folder, with the server already running):
//   node create_purchaser_b.js

const BASE_URL = "http://127.0.0.1:3000";

const ADMIN_EMAIL = "testadmin@gmail.com";
const ADMIN_PASSWORD = "admin123";

const NEW_PURCHASER_EMAIL = "testpurchaser2@gmail.com";
const NEW_PURCHASER_PASSWORD = "TestPurch2123!";
const NEW_PURCHASER_NAME = "Test Purchaser 2";

async function main() {
  // 1. Login as admin
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const loginBody = await loginRes.json();
  if (!loginRes.ok) {
    console.error("Admin login failed:", loginRes.status, loginBody);
    process.exit(1);
  }
  const adminToken = loginBody.token;
  console.log("Admin login OK.");

  // 2. Create Purchaser B (skip if it already exists — treat 409 as fine)
  const createRes = await fetch(`${BASE_URL}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: NEW_PURCHASER_NAME,
      email: NEW_PURCHASER_EMAIL,
      role: "Purchaser",
      tempPassword: NEW_PURCHASER_PASSWORD,
    }),
  });
  const createBody = await createRes.json();

  if (createRes.status === 201) {
    console.log("Created Purchaser B:", createBody);
  } else if (createRes.status === 409) {
    console.log("Purchaser B already exists — that's fine, reusing it.");
  } else {
    console.error("Create failed:", createRes.status, createBody);
    process.exit(1);
  }

  console.log("\nAdd these to your CONFIG block:");
  console.log(`EMAIL_PURCHASER_B="${NEW_PURCHASER_EMAIL}"; PASSWORD_PURCHASER_B="${NEW_PURCHASER_PASSWORD}"`);
}

main().catch((e) => {
  console.error("Script error:", e.message);
  process.exit(1);
});
