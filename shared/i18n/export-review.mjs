// Writes docs/i18n-review.csv for a native-speaker review: one row per message key.
// Run from the repo root: node shared/i18n/export-review.mjs
//
// Reviewers edit the Bisaya and Filipino columns of the CSV (or tell us the fixes);
// the values are then copied into shared/i18n/messages.json and checked with
//   node shared/i18n/check.mjs
//
// "confidence" is a hint for where to look first, not a quality guarantee:
//   check-first : a sentence that is identical to the English (may be left untranslated)
//   draft       : everything else. All wording is a draft until a native speaker approves it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const messages = JSON.parse(fs.readFileSync(path.join(here, "messages.json"), "utf8"));

const AREAS = {
  language: "Language switcher", nav: "Menu and page titles", notifications: "Notifications", notif: "Notifications",
  account: "Account", login: "Sign-in", settings: "Settings", common: "Shared words", mobile: "Mobile app",
  dashboard: "Dashboard", auth: "Sign-in and passwords", errors: "Error messages", legal: "Terms and privacy",
  status: "Statuses", chain: "Record protection", tamper: "Tamper alerts", flag: "Fraud flags",
  verify: "Record check errors", protection: "Record protection", expenses: "Expenses review", my_expenses: "My expenses",
  submit: "Submit expense", split: "Split receipt", projects: "Projects", picker: "Manager picker", limits: "Assignment limits",
  form: "Project form", bom: "Bill of materials", bomjust: "Budget justification", costcat: "Cost types", costhint: "Cost type examples",
  pd: "Project page", ms: "Milestones", docs: "Task documents", review: "Progress review", tl: "Timeline", tf: "Ticket form",
  tq: "Ticket queue", tickettype: "Ticket types", users: "User accounts", rep: "Reports", bir: "BIR labels", category: "Expense categories",
  time: "Time wording", mx: "Mobile expense flow", rv: "Mobile receipt review", al: "Mobile split allocation", tr: "Mobile ticket request",
  df: "Date field", sm: "Mobile site manager", mn: "Mobile notifications", mr: "Mobile my requests", ea: "Mobile expense actions",
  sr: "Mobile scanned receipts", re: "Mobile rejected expenses", mh: "Mobile header", fp: "Mobile file preview", due: "Due dates",
  lg: "Mobile sign-in", ix: "Mobile requests tab", ex: "Mobile expenses tab", banner: "Mobile offline banner", sync: "Mobile sync result",
};

const csv = (value) => `"${String(value).replace(/"/g, '""')}"`;
const looksLikeSentence = (text) => text.length > 30 && text.includes(" ");

const rows = [["key", "area", "English", "Bisaya", "Filipino", "confidence", "reviewer notes"]];
for (const key of Object.keys(messages.en)) {
  const prefix = key.split(".")[0];
  const en = messages.en[key];
  const ceb = messages.ceb[key];
  const fil = messages.fil[key];
  const untranslated = looksLikeSentence(en) && (ceb === en || fil === en);
  rows.push([key, AREAS[prefix] ?? prefix, en, ceb, fil, untranslated ? "check-first" : "draft", ""]);
}

const out = path.join(root, "docs", "i18n-review.csv");
// BOM so Excel opens the Filipino/Bisaya text correctly.
fs.writeFileSync(out, "﻿" + rows.map((r) => r.map(csv).join(",")).join("\r\n") + "\r\n");
console.log(`wrote ${rows.length - 1} rows to ${path.relative(root, out)}`);
