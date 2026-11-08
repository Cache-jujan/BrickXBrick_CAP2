// Chart.js draws a label given as an array of strings on several lines. Long
// project names ("Proposed 2-Storey Residential Building – Consolacion") are
// broken at spaces into lines of about `width` characters, so the label column
// stays narrow and nothing is cut off. More than `maxLines` lines end in "…".
export function wrapLabel(text, width = 22, maxLines = 3) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s–-]+$/, "")}…`;
  return kept;
}
