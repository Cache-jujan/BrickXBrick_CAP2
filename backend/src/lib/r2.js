// r2.js — thin S3-compatible upload helper for Cloudflare R2.
//
// Built for F5 (task photo evidence). F6's receipts.js never persists the
// receipt image anywhere (it OCRs straight off the multer buffer), so there
// was no existing helper to reuse — this is the first version. If F6 later
// needs to store receipt images too, extend this file rather than writing a
// second one.

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

const REQUIRED_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY", "R2_SECRET_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"];

let client;
function getClient() {
    if (client) return client;

    const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        throw new Error(`r2.js: missing required env var(s): ${missing.join(", ")}`);
    }

    client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY,
            secretAccessKey: process.env.R2_SECRET_KEY,
        },
    });
    return client;
}

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png" };

// uploadBuffer(buffer, { contentType, keyPrefix }) -> Promise<string URL>
//
// keyPrefix groups objects under a folder-like prefix (e.g. "tasks/<taskId>")
// so the bucket stays human-navigable; the object name itself is random so
// two uploads never collide.
//
// NOTE: this assumes R2_PUBLIC_URL points at a bucket with public read
// access (R2's public dev URL or a custom domain) and returns a plain URL.
// R2 objects are private by default. If this bucket is NOT public, this
// needs to return a signed GET URL instead (@aws-sdk/s3-request-presigner)
// — confirm which setup is actually live before this goes past local
// testing.
async function uploadBuffer(buffer, { contentType, keyPrefix = "uploads" }) {
    const ext = EXT_BY_MIME[contentType];
    if (!ext) {
        throw new Error(`r2.js: unsupported contentType "${contentType}" (expected image/jpeg or image/png)`);
    }

    const key = `${keyPrefix}/${crypto.randomUUID()}.${ext}`;

    await getClient().send(
        new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        })
    );

    return `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
}

module.exports = { uploadBuffer };