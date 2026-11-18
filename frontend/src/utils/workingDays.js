// The date that is `workingDays` working days from `startIso` (YYYY-MM-DD): the start
// day counts as day 1 when it is not a Sunday, and Sundays are skipped. Holidays are
// not known, so the result is only an estimate. Same rule as the server's
// addWorkingDays in backend/src/lib/contractIntake.js.
export function addWorkingDays(startIso, workingDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startIso || ""));
  const n = Number(workingDays);
  if (!m || !Number.isInteger(n) || n < 1) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return "";
  let counted = 0;
  for (;;) {
    if (d.getUTCDay() !== 0) {
      counted += 1;
      if (counted === n) break;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}
