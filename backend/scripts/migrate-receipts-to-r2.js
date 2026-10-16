#!/usr/bin/env node
/* eslint-disable no-console */
// migrate-receipts-to-r2.js — one-time move of locally stored receipts into
// the Cloudflare R2 bucket (under receipts/), then rewrite the stored URLs.
//
// Usage (from backend/, with R2_* and DATABASE_URL in backend/.env):
//   node scripts/migrate-receipts-to-r2.js --dry-run
//       list what would be uploaded; touches nothing
//   node scripts/migrate-receipts-to-r2.js
//       upload every local receipt to R2 and verify each one (size check)
//   node scripts/migrate-receipts-to-r2.js --update-db
//       upload + verify, THEN rewrite expenses.receiptimageurl and
//       receiptscans.receiptimageurl to the R2 URL, one file at a time
//
// Options:
//   --dir <path>   local receipts folder (default: RECEIPT_STORAGE_DIR, or
//                  backend/storage/receipts)
//
// Safe to re-run: files already in R2 with the same size are skipped, and the
// URL rewrite only touches rows that still point at /receipts/files/<name>.
// Local files are never deleted by this script.

require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const { PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getClient, publicUrlForKey } = require("../src/lib/r2");

const KEY_PREFIX = "receipts";
const FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$/i;
const CONTENT_TYPE_BY_EXT = { ".jpg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf" };

function parseArgs(argv) {
  const args = { dryRun: false, updateDb: false, dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--update-db") args.updateDb = true;
    else if (argv[i] === "--dir") args.dir = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (args.dryRun && args.updateDb) throw new Error("--dry-run and --update-db cannot be combined");
  return args;
}

// Size of the object in R2, or null if it isn't there.
async function remoteSize(client, key) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    return head.ContentLength;
  } catch (error) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(
    args.dir || process.env.RECEIPT_STORAGE_DIR || path.join(__dirname, "../storage/receipts")
  );

  const entries = await fs.readdir(dir).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`Receipts folder not found: ${dir}`);
    throw error;
  });
  const files = entries.filter((name) => FILE_RE.test(name));
  const skippedNames = entries.filter((name) => !FILE_RE.test(name) && name !== ".gitkeep");

  console.log(`Local folder : ${dir}`);
  console.log(`Bucket       : ${process.env.R2_BUCKET}  (prefix ${KEY_PREFIX}/)`);
  console.log(`Receipts     : ${files.length} file(s) to consider`);
  if (skippedNames.length > 0) {
    console.log(`Ignored      : ${skippedNames.length} file(s) that are not <uuid>.jpg|png|pdf: ${skippedNames.join(", ")}`);
  }
  if (args.dryRun) console.log("DRY RUN: nothing will be uploaded or changed.\n");

  const client = getClient();
  let pool = null;
  if (args.updateDb) {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  const summary = { uploaded: 0, alreadyThere: 0, failed: 0, rowsUpdated: 0 };

  for (const name of files) {
    const key = `${KEY_PREFIX}/${name}`;
    const localPath = path.join(dir, name);
    try {
      const localSize = (await fs.stat(localPath)).size;
      const existing = await remoteSize(client, key);

      if (existing === localSize) {
        summary.alreadyThere += 1;
        console.log(`= ${name}  already in R2 (${localSize} bytes)`);
      } else if (args.dryRun) {
        console.log(`+ ${name}  would upload (${localSize} bytes)${existing === null ? "" : `, R2 copy has ${existing} bytes and would be replaced`}`);
        continue;
      } else {
        await client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
          Body: await fs.readFile(localPath),
          ContentType: CONTENT_TYPE_BY_EXT[path.extname(name).toLowerCase()],
        }));
        const verified = await remoteSize(client, key);
        if (verified !== localSize) {
          throw new Error(`size mismatch after upload: local ${localSize}, R2 ${verified}`);
        }
        summary.uploaded += 1;
        console.log(`+ ${name}  uploaded and verified (${localSize} bytes)`);
      }

      if (pool && !args.dryRun) {
        const newUrl = publicUrlForKey(key);
        const pattern = `%/receipts/files/${name}`;
        const expenses = await pool.query(
          "UPDATE expenses SET receiptimageurl = $1 WHERE receiptimageurl LIKE $2 AND receiptimageurl <> $1",
          [newUrl, pattern]
        );
        const scans = await pool.query(
          "UPDATE receiptscans SET receiptimageurl = $1 WHERE receiptimageurl LIKE $2 AND receiptimageurl <> $1",
          [newUrl, pattern]
        );
        summary.rowsUpdated += expenses.rowCount + scans.rowCount;
        if (expenses.rowCount + scans.rowCount > 0) {
          console.log(`  db: ${expenses.rowCount} expense row(s), ${scans.rowCount} scan row(s) now point at R2`);
        }
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`! ${name}  FAILED: ${error.message}`);
    }
  }

  if (pool) await pool.end();

  console.log("\nSummary");
  console.log(`  uploaded now      : ${summary.uploaded}`);
  console.log(`  already in R2     : ${summary.alreadyThere}`);
  console.log(`  failed            : ${summary.failed}`);
  if (args.updateDb) console.log(`  DB rows rewritten : ${summary.rowsUpdated}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});