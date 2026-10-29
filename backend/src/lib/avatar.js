// avatar.js — checks for profile pictures. The browser's idea of the file type
// can't be trusted, so the first bytes of the file decide.
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** "image/jpeg" or "image/png" when the bytes really are one of those, else null. */
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => buffer[i] === byte)) return "image/png";
  return null;
}

module.exports = { AVATAR_MAX_BYTES, sniffImageType };
