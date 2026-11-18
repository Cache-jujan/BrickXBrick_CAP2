// seed_ticket_resolved_b.js
// Creates a fresh Project Manager account (so we don't need testpm1/testpm2's
// password), then walks a new ticket through the full lifecycle:
//   SM creates (Pending) -> new PM acknowledges + assigns Purchaser B
//   (Acknowledged) -> Purchaser B resolves (Resolved).
// Prints the resulting ticketID to plug into TICKET_RESOLVED_B.
//
// Usage (from backend/ folder, with the server running):
//   node scripts/seed_ticket_resolved_b.js
//
// Needs SEED_ADMIN_EMAIL / _PASSWORD, SEED_SM_EMAIL / _PASSWORD, SEED_PURCHASER_B_EMAIL / _PASSWORD
// and SEED_PM_SEED_EMAIL / _PASSWORD in backend/.env (see backend/.env.example).

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE_URL = "http://127.0.0.1:3000";

// Credentials come from the environment, never from this file. Fails fast when one is missing.
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing env var: ${name}. Set it in backend/.env or export it before running this script.`);
        process.exit(1);
    }
    return value;
}

const ADMIN_EMAIL = requireEnv("SEED_ADMIN_EMAIL");
const ADMIN_PASSWORD = requireEnv("SEED_ADMIN_PASSWORD");

const SM_EMAIL = requireEnv("SEED_SM_EMAIL");
const SM_PASSWORD = requireEnv("SEED_SM_PASSWORD");

const PURCHASER_B_EMAIL = requireEnv("SEED_PURCHASER_B_EMAIL");
const PURCHASER_B_PASSWORD = requireEnv("SEED_PURCHASER_B_PASSWORD");
const PURCHASER_B_USERID = "53e9fbd2-3056-4372-a975-b61797c26b53";

// "Ticket Test Project": testsm is siteManagerId here, so SM can create on it.
const PROJECT_ID = "ef403363-8377-46ee-902f-54634c558356";

const NEW_PM_EMAIL = requireEnv("SEED_PM_SEED_EMAIL");
const NEW_PM_PASSWORD = requireEnv("SEED_PM_SEED_PASSWORD");
const NEW_PM_NAME = "Test PM Seed";

async function login(email, password) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(body)}`);
    return body.token;
}

async function main() {
    // 1. Admin login, create (or reuse) a throwaway PM account.
    const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log("Admin login OK.");

    const createPmRes = await fetch(`${BASE_URL}/api/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
            name: NEW_PM_NAME,
            email: NEW_PM_EMAIL,
            role: "Project Manager",
            tempPassword: NEW_PM_PASSWORD,
        }),
    });
    if (createPmRes.status === 201) {
        console.log("Created throwaway PM:", NEW_PM_EMAIL);
    } else if (createPmRes.status === 409) {
        console.log("Throwaway PM already exists — reusing it.");
    } else {
        const body = await createPmRes.json();
        throw new Error(`Create PM failed: ${createPmRes.status} ${JSON.stringify(body)}`);
    }

    // 2. SM creates a ticket on the project they're assigned to.
    const smToken = await login(SM_EMAIL, SM_PASSWORD);
    console.log("SM login OK.");

    const createTicketRes = await fetch(`${BASE_URL}/api/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${smToken}` },
        body: JSON.stringify({
            projectID: PROJECT_ID,
            ticketType: "Material Request",
            subject: "Seed ticket for Purchaser B test data",
            description: "Created by seed_ticket_resolved_b.js — safe to ignore/delete.",
        }),
    });
    const ticketBody = await createTicketRes.json();
    if (createTicketRes.status !== 201) {
        throw new Error(`Create ticket failed: ${createTicketRes.status} ${JSON.stringify(ticketBody)}`);
    }
    const ticketId = ticketBody.ticketid;
    console.log("Ticket created (Pending):", ticketId);

    // 3. New PM acknowledges, assigning Purchaser B.
    const pmToken = await login(NEW_PM_EMAIL, NEW_PM_PASSWORD);
    console.log("New PM login OK.");

    const ackRes = await fetch(`${BASE_URL}/api/tickets/${ticketId}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pmToken}` },
        body: JSON.stringify({ assignedTo: PURCHASER_B_USERID }),
    });
    const ackBody = await ackRes.json();
    if (ackRes.status !== 200) {
        throw new Error(`Acknowledge failed: ${ackRes.status} ${JSON.stringify(ackBody)}`);
    }
    console.log("Ticket acknowledged, assigned to Purchaser B.");

    // 4. Purchaser B resolves.
    const purchaserBToken = await login(PURCHASER_B_EMAIL, PURCHASER_B_PASSWORD);
    console.log("Purchaser B login OK.");

    const resolveRes = await fetch(`${BASE_URL}/api/tickets/${ticketId}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${purchaserBToken}` },
    });
    const resolveBody = await resolveRes.json();
    if (resolveRes.status !== 200) {
        throw new Error(`Resolve failed: ${resolveRes.status} ${JSON.stringify(resolveBody)}`);
    }
    console.log("Ticket resolved.");

    console.log("\n=== Done ===");
    console.log(`TICKET_RESOLVED_B="${ticketId}"`);
}

main().catch((e) => {
    console.error("Script error:", e.message);
    process.exit(1);
});
