// materialMatch.js: F9 shared helper. ONE matching rule for both F8 (which
// request a receipt line can be split into) and F9 Layer 3 (whether a line
// belongs to its request).
//
// Rule: lowercase; every character that isn't a letter or digit becomes a
// space; split into words; drop a trailing "s" from words longer than 3
// letters; match when EVERY word of materialType appears among the
// description's words, in any order. An empty materialType never matches.
//
// A size or spec in the request ("40kg", "10mm", any word with a digit) is
// needed only when the receipt line gives a size of its own. "Portland cement"
// on the receipt matches a request for "Portland cement 40kg"; "Portland cement
// 50kg" does not. "40 kg" and "40kg" are the same size.
//
// Known limit: synonyms and abbreviations don't match ("deformed bar" vs
// "rebar", "PC" vs "Portland cement").

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

// "40 kg" -> "40kg", so a size written with a space still equals the request's.
function matchWords(text) {
  const joined = String(text || "")
    .toLowerCase()
    .replace(/(\d)\s+(kgs?|mm|cm|ml|pcs?|g|m|l)\b/g, "$1$2");
  return words(joined);
}

const hasDigit = (word) => /\d/.test(word);

function matchesMaterial(description, materialType) {
  const wanted = matchWords(materialType);
  if (wanted.length === 0) return false;
  const have = new Set(matchWords(description));
  const lineGivesSize = [...have].some(hasDigit);
  return wanted.every((w) => have.has(w) || (hasDigit(w) && !lineGivesSize));
}

module.exports = { matchesMaterial, words };