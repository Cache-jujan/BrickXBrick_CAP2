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

module.exports = { hasValidMagicBytes, MAGIC_BYTES };
