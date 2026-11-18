#!/usr/bin/env node
// cleanup_orphan_receipts.js: list the R2 objects under receipts/ and delete the ones nothing
// points at. Dry-run by default; pass --apply to actually delete.
//
// An object counts as used when its key appears in expenses.receiptimageurl OR in
// ReceiptScans.receiptImageURL (a receipt is stored and scanned BEFORE its expense exists: an
// open draft, or an expense a phone has queued offline, still points at it). Objects younger
// than --min-age-days (default 7) are never touched, for the same reason.
//
// Usage (from backend/):
//   node scripts/db-tools/cleanup_orphan_receipts.js                       # dry run
//   node scripts/db-tools/cleanup_orphan_receipts.js --min-age-days 14     # dry run, older cut-off
//   node scripts/db-tools/cleanup_orphan_receipts.js --apply               # delete

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Client } = require("pg");
const { ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const r2 = require("../../src/lib/r2");
const { KEY_PREFIX } = require("../../src/lib/receiptStorage");

const APPLY = process.argv.includes("--apply");
const DAY_MS = 24 * 60 * 60 * 1000;

function minAgeDays() {
  const at = process.argv.indexOf("--min-age-days");
  if (at === -1) return 7;
  const days = Number(process.argv[at + 1]);
  if (!Number.isFinite(days) || days < 0) {
    console.error("--min-age-days needs a number of days (0 or more).");
    process.exit(1);
  }
  return days;
}

async function main() {
  const cutoff = Date.now() - minAgeDays() * DAY_MS;

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const rows = await db.query(
      `SELECT receiptimageurl AS url FROM expenses WHERE receiptimageurl IS NOT NULL
       UNION
       SELECT receiptimageurl AS url FROM ReceiptScans WHERE receiptimageurl IS NOT NULL`
    );
    const referenced = new Set(rows.rows.map((r) => r2.keyFromPublicUrl(r.url)).filter(Boolean));

    const client = r2.getClient();
    const found = [];
    let token;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: `${KEY_PREFIX}/`, ContinuationToken: token })
      );
      for (const obj of res.Contents || []) found.push({ key: obj.Key, modified: obj.LastModified });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    const unreferenced = found.filter((o) => !referenced.has(o.key));
    const orphans = unreferenced.filter((o) => o.modified && o.modified.getTime() < cutoff);
    console.log(`Receipt objects in R2:                ${found.length}`);
    console.log(`Referenced by expenses or scans:      ${found.length - unreferenced.length}`);
    console.log(`Unreferenced but too recent to touch: ${unreferenced.length - orphans.length}`);
    console.log(`Orphans:                              ${orphans.length}`);
    if (orphans.length === 0) return;

    if (!APPLY) {
      console.log("Dry run. Pass --apply to delete the following:");
      for (const o of orphans) console.log("  " + o.key);
      return;
    }

    for (const o of orphans) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: o.key }));
        console.log("deleted " + o.key);
      } catch (err) {
        console.error("failed " + o.key + ": " + err.message);
      }
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
