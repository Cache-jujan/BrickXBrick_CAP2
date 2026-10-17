// taskDocuments.js — rules for documents attached to Planning-phase tasks.
//
// Pure helpers (unit-tested in test/taskDocuments.test.js). The routes in
// routes/tasks.js do the database and R2 work.
//
// Accepted: PDF, JPEG, PNG, up to 10 MB each, at most 10 live files per task.
// Word/Excel files are not accepted: their magic bytes are the same as any
// zip, so the content check could not tell them from anything else. Export
// to PDF instead.

const crypto = require("crypto");

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENTS_PER_TASK = 10;

const TYPES = {
    "application/pdf": { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
    "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
    "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
};

const ALLOWED_DOCUMENT_TYPES = Object.keys(TYPES);

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

// Checks the declared type is allowed AND the bytes really are that type.
// Returns { contentType, ext }. Throws a 400 otherwise.
function validateDocumentFile(file) {
    if (!file) throw httpError(400, "file is required");
    const type = TYPES[file.mimetype];
    if (!type) throw httpError(400, "file must be a PDF, JPEG or PNG");
    const { buffer } = file;
    if (!buffer || buffer.length === 0) throw httpError(400, "file is empty");
    if (buffer.length > MAX_DOCUMENT_BYTES) throw httpError(400, "file must be 10MB or smaller");
    const matches = buffer.length >= type.magic.length && type.magic.every((byte, i) => buffer[i] === byte);
    if (!matches) throw httpError(400, "file content does not match its type");
    return { contentType: file.mimetype, ext: type.ext };
}

// The uploaded name is only ever shown back to people, never used as a path
// or storage key. Strip folders, control characters and quotes, and cap length.
function sanitizeFileName(name, ext) {
    let clean = String(name == null ? "" : name)
        .split(/[\\/]/)
        .pop()
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (clean.length > 200) {
        const dot = clean.lastIndexOf(".");
        const tail = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
        clean = clean.slice(0, 200 - tail.length) + tail;
    }
    return clean && clean !== "." && clean !== ".." ? clean : `document.${ext}`;
}

function sha256Hex(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

// task-documents/<taskId>/<random uuid>.<ext> — the only shape this writes.
function buildStorageKey(taskId, ext) {
    return `task-documents/${taskId}/${crypto.randomUUID()}.${ext}`;
}

// The ONE place that turns a stored key into something a browser can open.
// Today the R2 bucket is public, so this is the public URL. When the bucket
// goes private, change this function (signed URL, or stream through the API)
// and nothing else: the API already returns it behind an authenticated call
// and the table stores keys, not URLs.
function documentUrl(storageKey) {
    return require("./r2").publicUrlForKey(storageKey);
}

module.exports = {
    MAX_DOCUMENT_BYTES,
    MAX_DOCUMENTS_PER_TASK,
    ALLOWED_DOCUMENT_TYPES,
    validateDocumentFile,
    sanitizeFileName,
    sha256Hex,
    buildStorageKey,
    documentUrl,
};
