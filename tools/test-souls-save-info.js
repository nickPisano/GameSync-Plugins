#!/usr/bin/env node
"use strict";

/*
 * Synthetic end-to-end test for souls-save-info.js (DS3 / DS2 SOTFS / DSR paths).
 *
 * Builds valid encrypted saves from the documented format — the same framing the
 * working souls_givifier editor uses:
 *   entry data = [checksum(16) = MD5(IV+ciphertext)] [IV(16)] [ciphertext]
 *   plaintext  = AES-128-CBC(key, IV, ciphertext) = [length(4)] [record] [pad]
 * then asserts the inspector recovers the planted names and souls. (Elden Ring has
 * its own verified test in test-er-save-info.js.)
 *
 * Run: node tools/test-souls-save-info.js
 */

const assert = require("assert");
const crypto = require("crypto");
const ssi = require("./souls-save-info.js");

function u32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function putU32(buf, off, n) {
  buf.writeUInt32LE(n >>> 0, off);
}

function putName(buf, off, name) {
  for (let i = 0; i < name.length; i++) buf.writeUInt16LE(name.charCodeAt(i) & 0xffff, off + i * 2);
}

// Encrypt one record into an on-disk entry blob using the DS3/DS2/DSR framing.
function encryptEntry(record, key) {
  const lengthPrefixed = Buffer.concat([u32le(record.length), record]);
  const padLen = (16 - (lengthPrefixed.length % 16)) % 16;
  const plaintext = Buffer.concat([lengthPrefixed, Buffer.alloc(padLen)]);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const checksum = crypto.createHash("md5").update(Buffer.concat([iv, ct])).digest();
  return Buffer.concat([checksum, iv, ct]); // size = 32 + ct.length
}

// Minimal little-endian BND4 (format None: no names, 32-bit offsets -> 0x14 headers).
function buildBnd4(blobs) {
  const HEADER = 0x40;
  const ENTRY = 0x14;
  const dataStart = HEADER + blobs.length * ENTRY;
  const header = Buffer.alloc(dataStart);
  header.write("BND4", 0, "latin1");
  header[9] = 0; // little-endian
  header[10] = 1; // BitBigEndian = false
  header.writeInt32LE(blobs.length, 0x0c);
  header.writeBigInt64LE(0x40n, 0x10);
  header.write("00000000", 0x18, "latin1");
  header.writeBigInt64LE(BigInt(ENTRY), 0x20);
  header.writeBigInt64LE(BigInt(dataStart), 0x28);

  let dataOffset = dataStart;
  const chunks = [];
  blobs.forEach((blob, i) => {
    const off = HEADER + i * ENTRY;
    header[off] = 0;
    header.writeInt32LE(-1, off + 4);
    header.writeBigInt64LE(BigInt(blob.length), off + 8);
    header.writeUInt32LE(dataOffset, off + 0x10);
    chunks.push(blob);
    dataOffset += blob.length;
  });
  return Buffer.concat([header, ...chunks]);
}

// Build an 11-entry save from { index -> record } and a key.
function buildSave(records, key) {
  const blobs = [];
  for (let i = 0; i < 11; i++) blobs.push(encryptEntry(records[i] || Buffer.alloc(16), key));
  return buildBnd4(blobs);
}

function testDsr() {
  const key = ssi.KEYS.dsr;
  const summary = Buffer.alloc(4192);
  summary[176] = 1; // slot 0 occupied
  putName(summary, 192, "Knight"); // nameBase + slotLen*0
  const char0 = Buffer.alloc(256);
  putU32(char0, 224, 50000); // souls
  const save = buildSave({ 10: summary, 0: char0 }, key);

  const res = ssi.inspect(save, "dsr");
  assert.strictEqual(res.summaryVerified, true, "DSR summary should verify");
  assert.strictEqual(res.slots.length, 1, "DSR should find one slot");
  assert.deepStrictEqual(
    { slot: res.slots[0].slot, name: res.slots[0].name, souls: res.slots[0].souls, verified: res.slots[0].verified },
    { slot: 1, name: "Knight", souls: 50000, verified: true },
    "DSR slot mismatch"
  );
  console.log("ok - DSR: name + souls recovered");
}

function testDs3() {
  const key = ssi.KEYS.ds3;
  const summary = Buffer.alloc(9794);
  summary[4244] = 1; // slot 0 occupied
  putName(summary, 4254, "Ashen"); // nameBase + slotLen*0
  const char0 = Buffer.alloc(256);
  putU32(char0, 100, 777777); // souls at namePos-20
  putName(char0, 120, "Ashen"); // name at namePos (=120)
  const save = buildSave({ 10: summary, 0: char0 }, key);

  const res = ssi.inspect(save, "ds3");
  assert.strictEqual(res.summaryVerified, true, "DS3 summary should verify");
  assert.strictEqual(res.slots.length, 1, "DS3 should find one slot");
  assert.deepStrictEqual(
    { slot: res.slots[0].slot, name: res.slots[0].name, souls: res.slots[0].souls, verified: res.slots[0].verified },
    { slot: 1, name: "Ashen", souls: 777777, verified: true },
    "DS3 slot mismatch (name-relative souls)"
  );
  console.log("ok - DS3: name + name-relative souls recovered");
}

function testDs2() {
  const key = ssi.KEYS.ds2;
  const summary = Buffer.alloc(6246);
  summary[892] = 1; // slot 0 occupied
  putName(summary, 1286, "Bearer"); // name for slot 0
  const char1 = Buffer.alloc(128); // DS2 character entries are 1..10
  putU32(char1, 60, 12345); // souls
  putU32(char1, 68, 6789000); // soul memory
  const save = buildSave({ 0: summary, 1: char1 }, key);

  const res = ssi.inspect(save, "ds2");
  assert.strictEqual(res.summaryVerified, true, "DS2 summary should verify");
  assert.strictEqual(res.slots.length, 1, "DS2 should find one slot");
  assert.deepStrictEqual(
    {
      slot: res.slots[0].slot,
      name: res.slots[0].name,
      souls: res.slots[0].souls,
      soulMemory: res.slots[0].soulMemory,
      verified: res.slots[0].verified,
    },
    { slot: 1, name: "Bearer", souls: 12345, soulMemory: 6789000, verified: true },
    "DS2 slot mismatch"
  );
  console.log("ok - DS2: name + souls + soul memory recovered");
}

function testGuards() {
  // Tampered ciphertext must fail the checksum and report the slot unreadable.
  const key = ssi.KEYS.dsr;
  const summary = Buffer.alloc(4192);
  summary[176] = 1;
  putName(summary, 192, "Knight");
  const char0 = Buffer.alloc(256);
  putU32(char0, 224, 50000);
  const save = buildSave({ 10: summary, 0: char0 }, key);
  // Entry 0 (the first character slot) is the first data blob, at 0x40 + 11*0x14.
  // Corrupt a byte inside its ciphertext so the MD5 check fails but the summary
  // (a later blob) stays intact.
  save[0x40 + 11 * 0x14 + 40] ^= 0xff;
  const res = ssi.inspect(save, "dsr");
  assert.strictEqual(res.summaryVerified, true, "summary should still verify");
  assert.strictEqual(res.slots[0].verified, false, "tampered DSR slot must be reported unreadable");
  assert.strictEqual(res.slots[0].name, "Knight", "name still comes from the intact summary");

  // Detection by filename.
  assert.strictEqual(ssi.detectGame("ER0000.sl2"), "er");
  assert.strictEqual(ssi.detectGame("DS30000.sl2"), "ds3");
  assert.strictEqual(ssi.detectGame("DS2SOFS0000.sl2"), "ds2");
  assert.strictEqual(ssi.detectGame("DARKSII0000.sl2"), "ds2vanilla");
  assert.strictEqual(ssi.detectGame("DRAKS0005.sl2"), "dsr");
  assert.strictEqual(ssi.detectGame("S0000.sl2"), "sekiro");
  assert.strictEqual(ssi.detectGame("random.bin"), null);

  // Non-BND4 input must throw.
  assert.throws(() => ssi.inspect(Buffer.from("not a save"), "ds3"), /BND4/);

  console.log("ok - tampered slot rejected; filename detection; non-save rejected");
}

testDsr();
testDs3();
testDs2();
testGuards();
console.log("\nAll souls-save-info tests passed.");
