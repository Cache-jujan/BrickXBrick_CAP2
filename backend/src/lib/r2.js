// r2.js: thin S3-compatible upload helper for Cloudflare R2.
//
// Built for F5 (task photo evidence). F6's receipts.js never persists the
// receipt image anywhere (it OCRs straight off the multer buffer), so there
// was no existing helper to reuse: this is the first version. If F6 later
// needs to store receipt images too, extend this file rather than writing a
// second one.

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
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
// PRIVATE BUCKET: the bucket is meant to be private. What gets STORED (in
// avatarurl, photoUrl, photoEvidenceURL, receiptImageURL ...) is still the plain
// <R2_PUBLIC_BASE_URL>/<key> string this returns: it is the identity of the object
// and is never fetched directly. Whatever is SENT to a browser or phone is a signed
// GET URL that expires after an hour (getSignedReadUrl, below): the API response
// hook in middleware/r2Urls.js swaps every stored URL for a signed one on the way
// out, and turns a signed URL back into the stored form on the way in.
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

// keyFromPublicUrl(url, baseUrl?) -> object key, or null when the URL is not
// one of ours. uploadBuffer builds URLs as <R2_PUBLIC_BASE_URL>/<key>, so this
// is its inverse. Anything outside our base URL (or trying to climb out of it)
// is null: it can never be a photo this server stored.
function keyFromPublicUrl(url, baseUrl = process.env.R2_PUBLIC_BASE_URL) {
    if (typeof url !== "string" || !baseUrl) return null;
    const prefix = `${baseUrl.replace(/\/$/, "")}/`;
    if (!url.startsWith(prefix)) return null;
    const key = url.slice(prefix.length);
    if (!key || key.includes("..") || key.includes("?") || key.includes("#")) return null;
    return key;
}

const HEAD_TIMEOUT_MS = 5000;

// objectExists(key, send?) -> true | false. Throws on anything that is not a
// clear "no such object" (timeout, network, credentials): the caller must
// treat that as "could not check", never as "missing". `send` is injectable
// for tests.
async function objectExists(key, send) {
    const command = new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key });
    try {
        if (send) await send(command);
        else await getClient().send(command, { abortSignal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
        return true;
    } catch (error) {
        if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) return false;
        throw error;
    }
}

// publicUrlForKey(key) -> the URL a browser/app uses to fetch the object.
// Same shape uploadBuffer returns: <R2_PUBLIC_BASE_URL>/<key>.
function publicUrlForKey(key) {
    return `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
}

// getSignedReadUrl(key, { expiresIn }) -> a GET URL for one object that works without
// the bucket being public and stops working after `expiresIn` seconds (default 1 hour).
// Signing is a local calculation; it does not call R2.
const SIGNED_URL_TTL_SECONDS = 3600;
async function getSignedReadUrl(key, { expiresIn = SIGNED_URL_TTL_SECONDS } = {}) {
    return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn });
}

// getSignedReadUrlFromPublicUrl(url, opts) -> a signed URL for a stored URL, or null when
// the URL is not one of ours (an outside link is never signed).
async function getSignedReadUrlFromPublicUrl(url, opts) {
    const key = keyFromPublicUrl(url);
    return key ? getSignedReadUrl(key, opts) : null;
}

// storedUrlFromSignedUrl(url) -> the stored <R2_PUBLIC_BASE_URL>/<key> form of a signed URL this
// server handed out, or null. Phones and pages send back the URL they were given (for example
// the receipt of a scan when saving the expense); the database matches on the stored form.
function storedUrlFromSignedUrl(url) {
    const account = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET;
    if (typeof url !== "string" || !account || !bucket || !process.env.R2_PUBLIC_BASE_URL) return null;
    // The SDK signs with the bucket in the host name; the path style is accepted too.
    const hosted = `https://${bucket}.${account}.r2.cloudflarestorage.com/`;
    const pathStyle = `https://${account}.r2.cloudflarestorage.com/${bucket}/`;
    const strip = url.startsWith(hosted) ? hosted : url.startsWith(pathStyle) ? pathStyle : null;
    if (!strip) return null;
    let key;
    try {
        const parsed = new URL(url);
        key = decodeURIComponent(parsed.pathname.slice(strip === hosted ? 1 : `/${bucket}/`.length));
    } catch {
        return null;
    }
    if (!key || key.includes("..")) return null;
    return publicUrlForKey(key);
}

// putObject(key, buffer, contentType) -> Promise<string URL>
//
// Like uploadBuffer, but the caller chooses the exact key and content type.
// Used for receipts (which can be PDFs, unlike task photos). Callers must
// validate the type themselves.
async function putObject(key, buffer, contentType) {
    await getClient().send(
        new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        })
    );
    return publicUrlForKey(key);
}

// deleteObject(key): remove one object. Used to drop an upload that turned out not to be a receipt.
async function deleteObject(key) {
    await getClient().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
}

module.exports = {
    uploadBuffer,
    putObject,
    deleteObject,
    publicUrlForKey,
    keyFromPublicUrl,
    getSignedReadUrl,
    getSignedReadUrlFromPublicUrl,
    storedUrlFromSignedUrl,
    objectExists,
    getClient,
};