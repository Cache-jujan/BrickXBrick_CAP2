// Checks the shared message catalog. Run from the repo root: node shared/i18n/check.mjs
// Fails on: a key missing from a locale, placeholders that differ from English,
// or a key used in code that the catalog does not define. Unused keys are only warned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const messages = JSON.parse(fs.readFileSync(path.join(here, "messages.json"), "utf8"));
const LOCALES = ["ceb", "fil"];
const errors = [];
const warnings = [];

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

for (const key of Object.keys(messages.en)) {
  for (const locale of LOCALES) {
    const value = messages[locale]?.[key];
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`[${locale}] missing: ${key}`);
    } else if (placeholders(value) !== placeholders(messages.en[key])) {
      errors.push(`[${locale}] placeholders differ from en: ${key}`);
    }
  }
}
for (const locale of LOCALES) {
  for (const key of Object.keys(messages[locale] ?? {})) {
    if (!(key in messages.en)) errors.push(`[${locale}] extra key not in en: ${key}`);
  }
}

// Keys appear as string literals (t("nav.x"), or { label: "nav.x" } maps), so scan
// for any literal that starts with a known catalog namespace.
const namespaces = [...new Set(Object.keys(messages.en).map((k) => k.split(".")[0]))];
const namespacePattern = namespaces.join("|");
const literal = new RegExp(`["'\`]((?:${namespacePattern})(?:\\.[a-z0-9_]+)+)["'\`]`, "g");
// Keys built at runtime: tv("status", value) reads status.<value>, and a template
// such as `chain.${tone}.label` reads chain.<tone>.label. Their prefixes count as used.
const tvCall = /\btv\(\s*["'`]([a-z0-9_.]+)["'`]/g;
const templated = new RegExp(`["'\`]((?:${namespacePattern})\\.[a-z0-9_.]*)\\$\\{`, "g");

const SKIP = new Set(["node_modules", "dist", ".expo", "build", ".git"]);
const used = new Set();
const usedPrefixes = new Set();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(jsx?|tsx?|mjs)$/.test(entry.name)) {
      const text = fs.readFileSync(full, "utf8");
      for (const match of text.matchAll(literal)) used.add(match[1]);
      for (const match of text.matchAll(tvCall)) usedPrefixes.add(`${match[1]}.`);
      for (const match of text.matchAll(templated)) usedPrefixes.add(match[1]);
    }
  }
}
for (const dir of ["frontend/src", "mobile/app", "mobile/components", "mobile/lib"]) {
  const full = path.join(root, dir);
  if (fs.existsSync(full)) walk(full);
}

// A literal like "sync.task" is the stem of sync.task_one / sync.task_other (picked by count).
const isUsed = (key) =>
  used.has(key) || [...usedPrefixes].some((prefix) => key.startsWith(prefix)) || [...used].some((stem) => key.startsWith(`${stem}_`));

for (const key of used) {
  const known = key in messages.en || Object.keys(messages.en).some((k) => k.startsWith(`${key}.`) || k.startsWith(`${key}_`));
  if (!known) errors.push(`used in code but not defined: ${key}`);
}
for (const key of Object.keys(messages.en)) if (!isUsed(key)) warnings.push(`unused: ${key}`);

// A long sentence that is word-for-word the English is probably untranslated.
for (const locale of LOCALES) {
  for (const [key, value] of Object.entries(messages[locale] ?? {})) {
    const en = messages.en[key];
    if (en && value === en && en.length > 30 && en.includes(" ")) warnings.push(`[${locale}] same as English: ${key}`);
  }
}

console.log(`keys: en ${Object.keys(messages.en).length}, ceb ${Object.keys(messages.ceb).length}, fil ${Object.keys(messages.fil).length}`);
if (warnings.length) console.warn(`${warnings.length} unused key(s):\n  ${warnings.join("\n  ")}`);
if (errors.length) {
  console.error(`${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("i18n catalog OK");
