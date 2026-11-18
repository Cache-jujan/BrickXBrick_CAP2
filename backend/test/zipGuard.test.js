// zipGuard: a zip that declares too many parts or too much data is refused before it is opened.
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");

const { assertZipIsReasonable } = require("../src/lib/zipGuard");

// A minimal zip directory: one stored entry per name, declared uncompressed size = `size`.
function fakeZip(entries) {
  const central = [];
  for (const { name, size } of entries) {
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt32LE(size, 24);
    head.writeUInt16LE(Buffer.byteLength(name), 28);
    central.push(Buffer.concat([head, Buffer.from(name)]));
  }
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([dir, eocd]);
}

test("a normal zip passes", () => {
  assert.doesNotThrow(() => assertZipIsReasonable(fakeZip([{ name: "xl/workbook.xml", size: 2000 }, { name: "xl/sheet1.xml", size: 400000 }])));
});

test("a zip that declares too much data is refused", () => {
  assert.throws(() => assertZipIsReasonable(fakeZip([{ name: "a.xml", size: 40 * 1024 * 1024 }, { name: "b.xml", size: 40 * 1024 * 1024 }])), /too large once opened/);
});

test("a zip with too many parts is refused", () => {
  const many = Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}.xml`, size: 1 }));
  assert.throws(() => assertZipIsReasonable(fakeZip(many)), /too many parts/);
});

test("something that is not a zip is left to the real reader", () => {
  assert.doesNotThrow(() => assertZipIsReasonable(Buffer.from("not a zip at all, just text")));
  assert.doesNotThrow(() => assertZipIsReasonable(zlib.deflateSync(Buffer.from("x"))));
});
