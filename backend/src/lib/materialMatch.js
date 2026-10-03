// materialMatch.js — F9 shared helper. ONE matching rule for both F8 (which
// request a receipt line can be split into) and F9 Layer 3 (whether a line
// belongs to its request).
//
// Rule: lowercase; every character that isn't a letter or digit becomes a
// space; split into words; drop a trailing "s" from words longer than 3
// letters; match when EVERY word of materialType appears among the
// description's words, in any order. An empty materialType never matches.
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

function matchesMaterial(description, materialType) {
  const wanted = words(materialType);
  if (wanted.length === 0) return false;
  const have = new Set(words(description));
  return wanted.every((w) => have.has(w));
}

module.exports = { matchesMaterial, words };