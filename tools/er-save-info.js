#!/usr/bin/env node
"use strict";

/*
 * er-save-info.js — read-only Elden Ring save inspector.
 *
 * Prints each character slot's name, level, runes held, soul memory, and the
 * eight base stats from an Elden Ring PC save (ER0000.sl2). It NEVER writes to
 * the save file — it only reads.
 *
 * Usage:
 *   node er-save-info.js <path-to-ER0000.sl2>
 *   node er-save-info.js --json <path-to-ER0000.sl2>
 *
 * Designed to be wired into GameSync as a viewer (see
 * plugins/fromsoftware-souls-viewer.json), or run standalone.
 *
 * SCOPE: Elden Ring PC only. Dark Souls III / Sekiro also use .sl2 but with a
 * different encryption key and slot layout, so they are NOT supported here.
 * Full inventory / weapon enumeration is intentionally out of scope: it needs a
 * patch-specific item-id -> name database that this tool does not ship.
 *
 * HOW IT TRUSTS ITSELF: every Elden Ring save slot stores an MD5 of its own
 * body. After decrypting a slot this tool recomputes that MD5 and compares. If
 * it doesn't match, the tool reports the slot as unreadable rather than printing
 * guessed numbers. Within a verified slot, the level/runes/stats locations come
 * from the community 010-editor template (ClayAmore/EldenRingSaveTemplate).
 *
 * Format references:
 *   - AES key + .sl2 structure: Souls Modding Wiki, SoulsFormats (BND4)
 *   - PlayerGameData offsets: ClayAmore/EldenRingSaveTemplate (SL2.bt)
 */

const fs = require("fs");
const crypto = require("crypto");

// Static AES-128 key used for every USER_DATA entry in an Elden Ring .sl2.
const ER_AES_KEY = Buffer.from("0123456789ABCDEFFEDCBA9876543210", "hex");

// A decrypted character slot is exactly this many bytes (0x10 checksum + data).
const CHAR_SLOT_SIZE = 0x280010;

// PlayerGameData field offsets, relative to the start of the PlayerGameData
// struct (SL2.bt). All are uint32 little-endian unless noted.
const PGD = {
  VIGOR: 0x34,
  MIND: 0x38,
  ENDURANCE: 0x3c,
  STRENGTH: 0x40,
  DEXTERITY: 0x44,
  INTELLIGENCE: 0x48,
  FAITH: 0x4c,
  ARCANE: 0x50,
  LEVEL: 0x60,
  RUNES_HELD: 0x64,
  SOUL_MEMORY: 0x68,
  NAME: 0x94, // wchar_t[16], UTF-16LE, null-terminated
  SIZE: 0x1b0,
};

function reverseBits(b) {
  return (
    (((b & 0x01) << 7) |
      ((b & 0x02) << 5) |
      ((b & 0x04) << 3) |
      ((b & 0x08) << 1) |
      ((b & 0x10) >> 1) |
      ((b & 0x20) >> 3) |
      ((b & 0x40) >> 5) |
      ((b & 0x80) >> 7)) &
    0xff
  );
}

// Mirrors SoulsFormats Binder.ReadFormat.
function readFormat(raw, bitBigEndian) {
  const reverse = bitBigEndian || ((raw & 1) !== 0 && (raw & 0x80) === 0);
  return reverse ? raw : reverseBits(raw);
}

const FMT = { IDS: 0x02, NAMES1: 0x04, NAMES2: 0x08, LONG_OFFSETS: 0x10, COMPRESSION: 0x20 };
const hasNames = (f) => (f & (FMT.NAMES1 | FMT.NAMES2)) !== 0;

/**
 * Parse a BND4 container and return its entries as
 * { name, dataOffset, size } (size = on-disk encrypted blob length).
 * Throws if the file is not a BND4.
 */
function parseBnd4(buf) {
  if (buf.length < 0x40 || buf.toString("latin1", 0, 4) !== "BND4") {
    throw new Error("not a BND4 file (missing 'BND4' magic) — is this an Elden Ring ER0000.sl2?");
  }
  const bigEndian = buf[9] !== 0;
  if (bigEndian) throw new Error("big-endian BND4 not supported (expected a PC save)");
  const bitBigEndian = buf[10] === 0; // BitBigEndian = !ReadBoolean()

  const fileCount = buf.readInt32LE(0x0c);
  const fileHeaderSize = Number(buf.readBigInt64LE(0x20));
  const unicode = buf[0x30] !== 0;
  const format = readFormat(buf[0x31], bitBigEndian);

  const longOffsets = (format & FMT.LONG_OFFSETS) !== 0;
  const compression = (format & FMT.COMPRESSION) !== 0;
  const ids = (format & FMT.IDS) !== 0;
  const names = hasNames(format);

  const entries = [];
  for (let i = 0; i < fileCount; i++) {
    let off = 0x40 + i * fileHeaderSize;
    // flags(1) + 3 zero bytes + int32(-1) = 8 bytes
    off += 8;
    const size = Number(buf.readBigInt64LE(off));
    off += 8;
    if (compression) off += 8; // uncompressedSize (unused; saves aren't compressed)
    let dataOffset;
    if (longOffsets) {
      dataOffset = Number(buf.readBigInt64LE(off));
      off += 8;
    } else {
      dataOffset = buf.readUInt32LE(off);
      off += 4;
    }
    if (ids) off += 4;
    let name = "";
    if (names) {
      const nameOffset = buf.readUInt32LE(off);
      off += 4;
      name = readCString(buf, nameOffset, unicode);
    }
    // (Names1 trailing id+0 is ignored; we don't need it.)
    entries.push({ name, dataOffset, size });
  }
  return entries;
}

function readCString(buf, off, unicode) {
  let s = "";
  if (unicode) {
    for (let p = off; p + 1 < buf.length; p += 2) {
      const c = buf.readUInt16LE(p);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
  } else {
    for (let p = off; p < buf.length; p++) {
      if (buf[p] === 0) break;
      s += String.fromCharCode(buf[p]);
    }
  }
  return s;
}

// Decrypt one USER_DATA entry: first 16 bytes are the IV, the rest is AES-128-CBC.
function decryptEntry(blob) {
  const iv = blob.subarray(0, 16);
  const ciphertext = blob.subarray(16);
  const decipher = crypto.createDecipheriv("aes-128-cbc", ER_AES_KEY, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// A decrypted slot's first 16 bytes are an MD5 of the remaining bytes.
function checksumOk(plaintext) {
  const stored = plaintext.subarray(0, 16);
  const computed = crypto.createHash("md5").update(plaintext.subarray(16)).digest();
  return stored.equals(computed);
}

function readUtf16Name(buf, off, maxChars) {
  let s = "";
  for (let i = 0; i < maxChars; i++) {
    const c = buf.readUInt16LE(off + i * 2);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/**
 * Walk the variable-length GaitemHandleMap to find PlayerGameData, then read the
 * fields we care about. Returns null if the walk goes out of bounds or the data
 * fails sanity checks (which means our offsets drifted and we shouldn't trust it).
 */
function parseCharacterSlot(pt) {
  const version = pt.readUInt32LE(0x10);
  const count = version <= 81 ? 0x13fe : 0x1400;

  let p = 0x30; // start of GaitemHandleMap
  for (let i = 0; i < count; i++) {
    if (p + 8 > pt.length) return null;
    const handle = pt.readUInt32LE(p);
    let sz = 8;
    if (handle !== 0) {
      const hi = (handle & 0xf0000000) >>> 0;
      if (hi === 0x80000000) sz += 13; // weapon entry
      else if (hi === 0x90000000) sz += 8; // armor entry
    }
    p += sz;
  }

  const base = p; // start of PlayerGameData
  if (base + PGD.SIZE > pt.length) return null;

  const name = readUtf16Name(pt, base + PGD.NAME, 16);
  const level = pt.readUInt32LE(base + PGD.LEVEL);

  const stats = {
    VIG: pt.readUInt32LE(base + PGD.VIGOR),
    MND: pt.readUInt32LE(base + PGD.MIND),
    END: pt.readUInt32LE(base + PGD.ENDURANCE),
    STR: pt.readUInt32LE(base + PGD.STRENGTH),
    DEX: pt.readUInt32LE(base + PGD.DEXTERITY),
    INT: pt.readUInt32LE(base + PGD.INTELLIGENCE),
    FTH: pt.readUInt32LE(base + PGD.FAITH),
    ARC: pt.readUInt32LE(base + PGD.ARCANE),
  };

  const empty = name.trim() === "" && level === 0;
  if (empty) return { empty: true };

  // Sanity bounds: if the walk drifted, these would be wild. Generous caps so we
  // still accept modded saves but reject obvious garbage.
  const statValues = Object.values(stats);
  const looksValid =
    level >= 1 &&
    level <= 1000 &&
    name.length > 0 &&
    statValues.every((s) => s >= 1 && s <= 999);
  if (!looksValid) return null;

  return {
    empty: false,
    name,
    level,
    runesHeld: pt.readUInt32LE(base + PGD.RUNES_HELD),
    soulMemory: pt.readUInt32LE(base + PGD.SOUL_MEMORY),
    stats,
  };
}

/** Parse a whole .sl2 buffer; returns { slots: [...], anyVerified }. */
function parseSave(buf) {
  const entries = parseBnd4(buf);
  const slots = [];
  let index = 0;
  let anyVerified = false;
  for (const entry of entries) {
    let pt;
    try {
      pt = decryptEntry(buf.subarray(entry.dataOffset, entry.dataOffset + entry.size));
    } catch {
      continue;
    }
    if (pt.length !== CHAR_SLOT_SIZE) continue; // not a character slot
    const slotIndex = index++;
    if (!checksumOk(pt)) {
      slots.push({ slotIndex, verified: false });
      continue;
    }
    anyVerified = true;
    const parsed = parseCharacterSlot(pt);
    if (parsed === null) {
      slots.push({ slotIndex, verified: true, parseFailed: true });
    } else if (parsed.empty) {
      slots.push({ slotIndex, verified: true, empty: true });
    } else {
      slots.push({ slotIndex, verified: true, empty: false, ...parsed });
    }
  }
  return { slots, anyVerified };
}

function formatReport(result) {
  const lines = [];
  lines.push("Elden Ring save — character slots");
  lines.push("(read-only; numbers verified against each slot's stored checksum)");
  lines.push("");
  const active = result.slots.filter((s) => s.verified && !s.empty && !s.parseFailed);
  if (active.length === 0) {
    lines.push("No readable characters found.");
  }
  for (const s of result.slots) {
    if (!s.verified) {
      lines.push(`Slot ${s.slotIndex + 1}: checksum mismatch — could not decrypt (skipped)`);
      continue;
    }
    if (s.empty) {
      lines.push(`Slot ${s.slotIndex + 1}: (empty)`);
      continue;
    }
    if (s.parseFailed) {
      lines.push(`Slot ${s.slotIndex + 1}: decrypted OK but layout not recognized (save patch may be newer than this tool)`);
      continue;
    }
    lines.push(`Slot ${s.slotIndex + 1}: ${s.name}`);
    lines.push(`    Level:        ${s.level}`);
    lines.push(`    Runes held:   ${s.runesHeld.toLocaleString()}`);
    lines.push(`    Soul memory:  ${s.soulMemory.toLocaleString()}`);
    const st = s.stats;
    lines.push(
      `    Stats:        VIG ${st.VIG}  MND ${st.MND}  END ${st.END}  STR ${st.STR}  ` +
        `DEX ${st.DEX}  INT ${st.INT}  FTH ${st.FTH}  ARC ${st.ARC}`
    );
    lines.push("");
  }
  lines.push("Inventory / equipped weapons are not listed (out of scope — needs a patch-specific item database).");
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const file = args.find((a) => !a.startsWith("--"));

  if (!file || args.includes("--help") || args.includes("-h")) {
    console.error("Usage: node er-save-info.js [--json] <path-to-ER0000.sl2>");
    console.error("Read-only Elden Ring save inspector (level, runes, base stats).");
    process.exit(file ? 0 : 2);
  }

  let buf;
  try {
    buf = fs.readFileSync(file); // read-only; never written back
  } catch (e) {
    console.error(`Cannot read file: ${e.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = parseSave(buf);
  } catch (e) {
    console.error(`Could not parse save: ${e.message}`);
    process.exit(1);
  }

  if (!result.anyVerified) {
    console.error(
      "No Elden Ring character slots could be verified.\n" +
        "This tool supports Elden Ring PC saves (ER0000.sl2). Dark Souls III and\n" +
        "Sekiro use a different key/layout and are not supported."
    );
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result.slots, null, 2));
  } else {
    console.log(formatReport(result));
  }
}

if (require.main === module) main();

module.exports = {
  parseSave,
  parseBnd4,
  decryptEntry,
  checksumOk,
  parseCharacterSlot,
  ER_AES_KEY,
  CHAR_SLOT_SIZE,
  PGD,
};
