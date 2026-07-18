/**
 * Seeds just enough fixture data for F6-F8 development:
 *   - one user per role (so RBAC checks have real UUIDs to reference)
 *   - one active project
 *   - one Pending Material Request ticket assigned to the Purchaser
 *   - two approved vendors
 *
 * This stands in for F1 (user provisioning), F2 (project init), and F4
 * (ticket creation) until those modules exist. Re-runnable: keyed on
 * unique columns (email, vendor_name) or a name lookup.
 *
 * NOTE: users are inserted without supabase_user_id, which only works
 * because 002_users.sql leaves that column nullable. The Data Dictionary
 * (Table 29) says NOT NULL. When F1 lands and tightens the column, this
 * seed will break and will need real Supabase Auth records.
 *
 * Run: npm run seed
 * After it runs, it prints the IDs you need for x-mock-user-id headers
 * and the projectId/ticketId to use in F6 requests.
 */

require('dotenv').config();
const { Pool } = require('pg');

// Neon requires SSL; a local Postgres install usually has it disabled.
// Must match db/migrate.js and src/lib/db.js.
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
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const users = [
      { name: 'Grace Manager', email: 'gm@jjcr.test', role: 'GeneralManager' },
      { name: 'Paolo Reyes', email: 'pm@jjcr.test', role: 'ProjectManager' },
      { name: 'Sonny Cruz', email: 'sm@jjcr.test', role: 'SiteManager' },
      { name: 'Pia Santos', email: 'purchaser@jjcr.test', role: 'Purchaser' },
      { name: 'Ada Admin', email: 'admin@jjcr.test', role: 'SystemAdministrator' },
    ];

    const userIds = {};
    for (const u of users) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, role, status)
         VALUES ($1, $2, $3, 'Active')
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING user_id, role`,
        [u.name, u.email, u.role]
      );
      userIds[u.role] = rows[0].user_id;
    }

    const { rows: existingProject } = await client.query(
      `SELECT project_id FROM projects WHERE name = $1 LIMIT 1`,
      ['JJC-R Sample Build']
    );

    let projectId;
    if (existingProject.length > 0) {
      projectId = existingProject[0].project_id;
    } else {
      const { rows } = await client.query(
        `INSERT INTO projects (created_by, name, description, client_name, status, start_date, end_date, budget)
         VALUES ($1, $2, $3, $4, 'Active', CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', $5)
         RETURNING project_id`,
        [
          userIds.GeneralManager,
          'JJC-R Sample Build',
          'Seeded project for F6-F8 development.',
          'Sample Client Corp',
          2500000.0,
        ]
      );
      projectId = rows[0].project_id;
    }

    const { rows: existingTicket } = await client.query(
      `SELECT ticket_id FROM tickets WHERE subject = $1 LIMIT 1`,
      ['Cement bags for Column A (seeded)']
    );

    let ticketId;
    if (existingTicket.length > 0) {
      ticketId = existingTicket[0].ticket_id;
    } else {
      const { rows } = await client.query(
        `INSERT INTO tickets (project_id, submitted_by, assigned_to, recipient_role, ticket_type, subject, description, status)
         VALUES ($1, $2, $3, 'Purchaser', 'MaterialRequest', $4, $5, 'Pending')
         RETURNING ticket_id`,
        [
          projectId,
          userIds.ProjectManager,
          userIds.Purchaser,
          'Cement bags for Column A (seeded)',
          'Need 50 bags of Portland cement for Column A pour.',
        ]
      );
      ticketId = rows[0].ticket_id;
    }

    await client.query(
      `INSERT INTO vendor_master_list (added_by, vendor_name, location, approval_status)
       VALUES
         ($1, 'Santos Hardware', 'Consolacion, Cebu', 'Approved'),
         ($1, 'ABC Construction Supply', 'Mandaue City, Cebu', 'Approved')
       ON CONFLICT (vendor_name) DO NOTHING`,
      [userIds.SystemAdministrator]
    );

    await client.query('COMMIT');

    console.log('\nSeed complete.\n');
    console.log('User IDs (use with x-mock-user-id header):');
    for (const [role, id] of Object.entries(userIds)) {
      console.log(`  ${role.padEnd(20)} ${id}`);
    }
    console.log(`\nSample project_id: ${projectId}`);
    console.log(`Sample ticket_id (Material Request, Pending, -> Purchaser): ${ticketId}\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});