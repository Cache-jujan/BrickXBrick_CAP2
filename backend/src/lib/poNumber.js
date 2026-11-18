// poNumber.js: sequential Purchase Order numbers, "PO-2026-014". The counter restarts every year
// (Philippine time). Only the counter lives in the database (po_counters); the PO itself is a PDF
// the app builds, so nothing else is stored.

// Who may ask for a PO number: the people who build a Purchase Order from their open requests.
// Same four roles that can see open requests (lib/openRequests.js), each limited to their own scope.
const PO_ROLES = ["Purchaser", "Site Manager", "Project Manager", "General Manager"];

/** @param {number} year @param {number} n */
function formatPoNumber(year, n) {
  return `PO-${year}-${String(n).padStart(3, "0")}`;
}

/**
 * Hands out the next number. One atomic upsert, so two Purchasers asking at once never share one.
 * A number is used up when it is handed out, so a PO that is never shared leaves a gap: numbers
 * are unique and increasing, not guaranteed gap-free.
 * @param {(sql: string, params?: any[]) => Promise<{ rows: any[] }>} run
 * @returns {Promise<string>}
 */
async function nextPoNumber(run) {
  const result = await run(
    `INSERT INTO po_counters (year, lastnumber)
          VALUES (EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Manila'))::int, 1)
     ON CONFLICT (year) DO UPDATE SET lastnumber = po_counters.lastnumber + 1
       RETURNING year, lastnumber`
  );
  const { year, lastnumber } = result.rows[0];
  return formatPoNumber(Number(year), Number(lastnumber));
}

module.exports = { PO_ROLES, formatPoNumber, nextPoNumber };
