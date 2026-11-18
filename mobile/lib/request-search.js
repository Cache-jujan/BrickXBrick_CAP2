// Finding the open request a receipt line belongs to, for "Match to a request".
// Pure, so it is tested in Node (lib/sync/test/request-search.test.mjs).
//
// The words are cut the same way as the server's matcher (backend/src/lib/materialMatch.js):
// lower case, letters and digits only, a trailing "s" dropped from words longer than 3 letters.

export function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

// "40 kg" -> "40kg", so a size written with a space still equals the request's.
function matchWords(text) {
  return words(
    String(text ?? "")
      .toLowerCase()
      .replace(/(\d)\s+(kgs?|mm|cm|ml|pcs?|g|m|l)\b/g, "$1$2")
  );
}

/**
 * Whether a receipt line is matched to a request by name, the same rule as the server
 * (backend/src/lib/materialMatch.js): every word of the request's material is on the line.
 * A size in the request ("40kg") is needed only when the line gives a size of its own.
 */
export function matchesMaterial(description, materialType) {
  const wanted = matchWords(materialType);
  if (wanted.length === 0) return false;
  const have = new Set(matchWords(description));
  const hasDigit = (w) => /\d/.test(w);
  const lineGivesSize = [...have].some(hasDigit);
  return wanted.every((w) => have.has(w) || (hasDigit(w) && !lineGivesSize));
}

/**
 * Requests that share words with a scanned line, best first (most shared words, then oldest).
 * Falls back to every request when none share a word, so the list is never empty by itself.
 * @returns {{ requests: typeof requests, matched: boolean }}  matched = false when it fell back to all
 */
export function suggestRequests(description, requests, nameOf = (r) => r.materialType) {
  const list = Array.isArray(requests) ? requests : [];
  const wanted = new Set(words(description));
  const scored = list
    .map((request, order) => ({ request, order, shared: words(nameOf(request)).filter((w) => wanted.has(w)).length }))
    .filter((entry) => entry.shared > 0)
    // Most shared words first; then oldest (when it has a date), else the list's own order.
    .sort((a, b) => b.shared - a.shared || (Date.parse(a.request.createdAt) - Date.parse(b.request.createdAt) || a.order - b.order));
  return scored.length > 0
    ? { requests: scored.map((entry) => entry.request), matched: true }
    : { requests: list, matched: false };
}

/**
 * Requests where every word typed appears in the material, request name, store or project.
 * A typed word matches part of a word too ("cem" finds "cement", "16" finds "16mm"), and case never
 * matters, so it works while the user is still typing. textOf gives the text to search for one
 * request (default: those four fields).
 */
export function searchRequests(query, requests, textOf = (r) => [r.materialType, r.subject, r.vendorName, r.projectName].join(" ")) {
  const list = Array.isArray(requests) ? requests : [];
  const typed = words(query);
  if (typed.length === 0) return list;
  return list.filter((request) => {
    const have = words(textOf(request));
    return typed.every((w) => have.some((h) => h.includes(w)));
  });
}
