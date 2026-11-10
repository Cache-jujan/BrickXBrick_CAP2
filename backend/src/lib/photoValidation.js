// photoValidation.js — D-07: the client-declared MIME type was the only
// check on evidence photos, so a text file, an HTML file, a 0-byte file and
// a corrupt JPEG were all accepted as long as the upload said image/jpeg or
// image/png. Check the file's actual magic bytes instead of trusting the
// declared type.

const MAGIC_BYTES = {
    "image/jpeg": [0xff, 0xd8, 0xff],
    "image/png": [0x89, 0x50, 0x4e, 0x47],
};

function hasValidMagicBytes(buffer, mimetype) {
    const signature = MAGIC_BYTES[mimetype];
    if (!signature || !buffer || buffer.length < signature.length) return false;
    return signature.every((byte, i) => buffer[i] === byte);
}

// Receipts may also be WebP or PDF. The bytes must match the declared type, so a renamed
// text/HTML/zip file cannot be posted as a receipt.
function hasValidReceiptSignature(buffer, mimetype) {
    if (!buffer || buffer.length === 0) return false;
    if (mimetype === "application/pdf") return buffer.subarray(0, 1024).includes("%PDF-");
    if (mimetype === "image/webp") {
        return buffer.length >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP";
    }
    return hasValidMagicBytes(buffer, mimetype);
}

module.exports = { hasValidMagicBytes, hasValidReceiptSignature, MAGIC_BYTES };
