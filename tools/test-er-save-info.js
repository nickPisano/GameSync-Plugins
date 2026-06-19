#!/usr/bin/env node
"use strict";

/*
 * Synthetic end-to-end test for er-save-info.js.
 *
 * We can't ship a real Elden Ring save, so this builds a *valid* encrypted .sl2
 * from scratch — following the documented BND4 + AES-128-CBC + MD5 format — with
 * known character stats, then asserts the parser recovers them exactly. The
 * encoder here is written independently of the parser and deliberately includes
 * weapon/armor/normal item entries so the variable-stride GaitemHandleMap walk
 * (the riskiest part) is actually exercised.
 *
 * Run: node tools/test-er-save-info.js
 */

const assert = require("assert");
const crypto = require("crypto");
const { parseSave, CHAR_SLOT_SIZE, ER_AES_KEY, PGD } = require("./er-save-info.js");

// Build one decrypted character-slot plaintext (0x280010 bytes) with a known
// character at the correctly-walked PlayerGameData offset.
function buildSlotPlaintext(char) {
  const pt = Buffer.alloc(CHAR_SLOT_SIZE);
  const version = 82; // > 81 -> item count 0x1400
  pt.writeUInt32LE(version, 0x10);

  // GaitemHandleMap: 0x1400 entries. Make a few non-empty to exercise strides.
  const count = 0x1400;
  let p = 0x30;
  for (let i = 0; i < count; i++) {
    let handle = 0;
    if (i === 0) handle = 0x80000001; // weapon  -> base 8 + 13
    else if (i === 1) handle = 0x90000002; // armor -> base 8 + 8
    else if (i === 2) handle = 0x00000003; // normal item -> base 8
    pt.writeUInt32LE(handle >>> 0, p);
    pt.writeUInt32LE(0x11110000 + i, p + 4); // itemID (value irrelevant)
    let sz = 8;
    if (handle !== 0) {
      const hi = (handle & 0xf0000000) >>> 0;
      if (hi === 0x80000000) sz += 13;
      else if (hi === 0x90000000) sz += 8;
    }
    p += sz;
  }

  const base = p; // PlayerGameData start
  pt.writeUInt32LE(char.stats.VIG, base + PGD.VIGOR);
  pt.writeUInt32LE(char.stats.MND, base + PGD.MIND);
  pt.writeUInt32LE(char.stats.END, base + PGD.ENDURANCE);
  pt.writeUInt32LE(char.stats.STR, base + PGD.STRENGTH);
  pt.writeUInt32LE(char.stats.DEX, base + PGD.DEXTERITY);
  pt.writeUInt32LE(char.stats.INT, base + PGD.INTELLIGENCE);
  pt.writeUInt32LE(char.stats.FTH, base + PGD.FAITH);
  pt.writeUInt32LE(char.stats.ARC, base + PGD.ARCANE);
  pt.writeUInt32LE(char.level, base + PGD.LEVEL);
  pt.writeUInt32LE(char.runesHeld, base + PGD.RUNES_HELD);
  pt.writeUInt32LE(char.soulMemory, base + PGD.SOUL_MEMORY);
  for (let i = 0; i < char.name.length && i < 16; i++) {
    pt.writeUInt16LE(char.name.charCodeAt(i), base + PGD.NAME + i * 2);
  }

  // Stored checksum = MD5 of everything after the first 16 bytes.
  const md5 = crypto.createHash("md5").update(pt.subarray(16)).digest();
  md5.copy(pt, 0);
  return pt;
}

function encryptEntry(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-cbc", ER_AES_KEY, iv);
  cipher.setAutoPadding(false);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, ct]); // IV prefix + ciphertext
}

// Wrap encrypted slot blobs in a minimal little-endian BND4 (format = None:
// no names, no compression, 32-bit offsets -> entry header size 0x14).
function buildBnd4(blobs) {
  const HEADER = 0x40;
  const ENTRY = 0x14;
  const dataStart = HEADER + blobs.length * ENTRY;

  const header = Buffer.alloc(dataStart);
  header.write("BND4", 0, "latin1");
  header[9] = 0; // little-endian
  header[10] = 1; // BitBigEndian = !true = false
  header.writeInt32LE(blobs.length, 0x0c);
  header.writeBigInt64LE(0x40n, 0x10);
  header.write("00000000", 0x18, "latin1");
  header.writeBigInt64LE(BigInt(ENTRY), 0x20);
  header.writeBigInt64LE(BigInt(dataStart), 0x28);
  header[0x30] = 0; // not unicode
  header[0x31] = 0; // format None
  header[0x32] = 0; // extended none

  let dataOffset = dataStart;
  const dataChunks = [];
  blobs.forEach((blob, i) => {
    let off = HEADER + i * ENTRY;
    header[off] = 0; // flags
    header.writeInt32LE(-1, off + 4);
    header.writeBigInt64LE(BigInt(blob.length), off + 8);
    header.writeUInt32LE(dataOffset, off + 0x10);
    dataChunks.push(blob);
    dataOffset += blob.length;
  });

  return Buffer.concat([header, ...dataChunks]);
}

function run() {
  const hero = {
    name: "Tarnished",
    level: 150,
    runesHeld: 1234567,
    soulMemory: 88888888,
    stats: { VIG: 60, MND: 20, END: 40, STR: 55, DEX: 18, INT: 9, FTH: 25, ARC: 7 },
  };
  const emptyPt = (() => {
    const pt = Buffer.alloc(CHAR_SLOT_SIZE);
    pt.writeUInt32LE(82, 0x10);
    const md5 = crypto.createHash("md5").update(pt.subarray(16)).digest();
    md5.copy(pt, 0);
    return pt;
  })();

  const save = buildBnd4([encryptEntry(buildSlotPlaintext(hero)), encryptEntry(emptyPt)]);
  const result = parseSave(save);

  assert.strictEqual(result.anyVerified, true, "expected at least one verified slot");
  assert.strictEqual(result.slots.length, 2, "expected two character slots");

  const s0 = result.slots[0];
  assert.strictEqual(s0.verified, true, "slot 0 should verify against its MD5");
  assert.strictEqual(s0.empty, false, "slot 0 should not be empty");
  assert.strictEqual(s0.name, hero.name, "name mismatch");
  assert.strictEqual(s0.level, hero.level, "level mismatch");
  assert.strictEqual(s0.runesHeld, hero.runesHeld, "runes held mismatch");
  assert.strictEqual(s0.soulMemory, hero.soulMemory, "soul memory mismatch");
  assert.deepStrictEqual(s0.stats, hero.stats, "stats mismatch");

  const s1 = result.slots[1];
  assert.strictEqual(s1.verified, true, "slot 1 should verify");
  assert.strictEqual(s1.empty, true, "slot 1 should be detected as empty");

  // A corrupted ciphertext must fail the checksum (no garbage output).
  const corrupt = Buffer.from(save);
  corrupt[corrupt.length - 1] ^= 0xff;
  const corruptResult = parseSave(corrupt);
  assert.strictEqual(
    corruptResult.slots[corruptResult.slots.length - 1].verified,
    false,
    "tampered slot must fail checksum verification"
  );

  // A non-BND4 file must throw.
  assert.throws(() => parseSave(Buffer.from("not a save file")), /BND4/);

  console.log("ok - er-save-info parses name, level, runes, soul memory, and stats");
  console.log("ok - empty slots detected; tampered slots rejected; non-saves rejected");
  console.log("\nAll er-save-info tests passed.");
}

run();
