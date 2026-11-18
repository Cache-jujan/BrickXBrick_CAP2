// zipGuard.js: refuse a zip-based upload (.xlsx, .docx) that would unpack to something huge.
//
// The upload limit (5 MB) is on the compressed file, and a "zip bomb" can be a few KB that
// unpacks to gigabytes. exceljs unpacks the whole workbook in memory, so the sizes the zip
// declares are checked first. Reads only the zip's directory; nothing is unpacked here.

const MAX_ENTRIES = 2000;
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;

function tooBig(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Throws a 400 when the zip declares too many files or too much data. Not a zip: left to the real reader. */
function assertZipIsReasonable(buf, { maxEntries = MAX_ENTRIES, maxUnpackedBytes = MAX_UNPACKED_BYTES } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return;

  const entries = buf.readUInt16LE(eocd + 10);
  if (entries > maxEntries) throw tooBig("The file contains too many parts to be a normal document.");
  let pos = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) break;
    total += buf.readUInt32LE(pos + 24);
    if (total > maxUnpackedBytes) throw tooBig("The file is too large once opened to be a normal document.");
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
}

module.exports = { assertZipIsReasonable, MAX_ENTRIES, MAX_UNPACKED_BYTES };
