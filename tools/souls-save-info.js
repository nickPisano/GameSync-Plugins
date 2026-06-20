#!/usr/bin/env node
"use strict";

/*
 * souls-save-info.js — read-only FromSoftware Souls save inspector.
 *
 * Auto-detects the game from the save filename and prints, per character slot,
 * what can be reliably extracted:
 *
 *   - Elden Ring (ER0000.sl2):   name, level, runes, soul memory, 8 base stats
 *   - Dark Souls III (DS30000.sl2):       name, souls
 *   - Dark Souls II SOTFS (DS2SOFS0000.sl2): name, souls, soul memory
 *   - Dark Souls: Remastered (DRAKS0005.sl2): name, souls
 *
 * It NEVER writes to the save file — it only reads.
 *
 * WHY ELDEN RING SHOWS MORE: ER's full slot layout (level + every stat) is
 * documented in a community 010-editor template, so er-save-info.js parses it in
 * full and is covered by a round-trip test. For DS3 / DS2 / DSR, the only
 * publicly-verified field locations are the character name and the souls counters
 * (from the souls_givifier editor, which is a working tool for those games). The
 * individual stat block and soul level are NOT shown for those games because
 * there is no verified offset map for them here — and this tool will not print
 * guessed numbers. If you can share a (copied) sample save, those can be added.
 *
 * HOW IT STAYS HONEST: every encrypted slot stores an MD5 of its own
 * (IV + ciphertext). After reading a slot this tool recomputes that MD5 and, on
 * mismatch (wrong file, or a save format newer than this tool), reports the slot
 * as unreadable instead of printing anything.
 *
 * References: Souls Modding Wiki (.sl2/BND4), SoulsFormats (BND4 headers),
 * ClayAmore/EldenRingSaveTemplate (ER layout), jtesta/souls_givifier (per-game
 * AES keys, framing, souls/name offsets — used as factual format data only).
 *
 * Usage:
 *   node souls-save-info.js [--json] [--game er|ds3|ds2|dsr] <path-to-save.sl2>
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const er = require("./er-save-info.js");

// AES-128 keys. DSR and ER share the same key; DS2 SOTFS and DS3 each differ.
const KEYS = {
  dsr: Buffer.from("0123456789ABCDEFFEDCBA9876543210", "hex"),
  ds2: Buffer.from("599f9b699640a55236ee2d70835ec744", "hex"),
  ds3: Buffer.from("fd464d695e69a39a10e319a7ace8b7fa", "hex"),
};

const GAME_LABEL = {
  er: "Elden Ring",
  ds3: "Dark Souls III",
  ds2: "Dark Souls II: Scholar of the First Sin",
  dsr: "Dark Souls: Remastered",
  ds2vanilla: "Dark Souls II (original)",
  sekiro: "Sekiro: Shadows Die Twice",
};

function detectGame(file) {
  const f = path.basename(file).toUpperCase();
  if (f.includes("ER0000")) return "er";
  if (f.includes("DS2SOFS")) return "ds2";
  if (f.includes("DARKSII")) return "ds2vanilla";
  if (f.includes("DS30000")) return "ds3";
  if (f.includes("DRAKS0005")) return "dsr";
  if (f.includes("S0000")) return "sekiro";
  return null;
}

/**
 * Decrypt one BND4 entry that uses the DS3/DS2/DSR framing:
 *   [checksum(16) = MD5(IV+ciphertext)] [IV(16)] [ciphertext]
 *   plaintext = AES-128-CBC(key, IV, ciphertext) = [length(4)] [record] [pad]
 * Returns { verified, record }.
 */
function decryptRecord(raw, off, size, key) {
  if (size < 48 || off + size > raw.length) return { verified: false, record: null };
  const checksum = raw.subarray(off, off + 16);
  const md5 = crypto.createHash("md5").update(raw.subarray(off + 16, off + size)).digest();
  const verified = checksum.equals(md5);
  const iv = raw.subarray(off + 16, off + 32);
  const ct = raw.subarray(off + 32, off + size);
  let pt;
  try {
    const d = crypto.createDecipheriv("aes-128-cbc", key, iv);
    d.setAutoPadding(false);
    pt = Buffer.concat([d.update(ct), d.final()]);
  } catch {
    return { verified, record: null };
  }
  if (pt.length < 4) return { verified, record: null };
  const length = pt.readUInt32LE(0);
  const end = length > 0 && 4 + length <= pt.length ? 4 + length : pt.length;
  return { verified, record: pt.subarray(4, end) };
}

function utf16Name(buf, off, maxChars) {
  let s = "";
  for (let i = 0; i < maxChars; i++) {
    const p = off + i * 2;
    if (p + 1 >= buf.length) break;
    const c = buf.readUInt16LE(p);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// Encode an (ASCII) character name the way it appears inside a decrypted record:
// each character followed by a zero byte (UTF-16LE for ASCII).
function nameToUtf16Bytes(name) {
  const b = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) b.writeUInt16LE(name.charCodeAt(i) & 0xffff, i * 2);
  return b;
}

const u32 = (buf, off) => (off >= 0 && off + 4 <= buf.length ? buf.readUInt32LE(off) : null);
const sane = (n) => n !== null && n >= 0 && n <= 999999999;

// Per-game slot layout for the "unified" save header entry (DSR/DS3).
const UNIFIED = {
  dsr: { summaryIndex: 10, occ: 176, nameBase: 192, slotLen: 400, nameMax: 13, soulsOffset: 224 },
  ds3: { summaryIndex: 10, occ: 4244, nameBase: 4254, slotLen: 554, nameMax: 16, soulsOffset: null },
};

function readUnified(raw, entries, game) {
  const cfg = UNIFIED[game];
  const key = KEYS[game];
  const summary = decryptRecord(raw, entries[cfg.summaryIndex].dataOffset, entries[cfg.summaryIndex].size, key);
  const slots = [];
  if (!summary.verified || !summary.record) return { slots, summaryVerified: summary.verified };
  const rec = summary.record;
  for (let i = 0; i < 10; i++) {
    if (rec[cfg.occ + i] === 0 || rec[cfg.occ + i] === undefined) continue;
    const name = utf16Name(rec, cfg.nameBase + cfg.slotLen * i, cfg.nameMax);
    const ce = decryptRecord(raw, entries[i].dataOffset, entries[i].size, key);
    if (!ce.verified || !ce.record) {
      slots.push({ slot: i + 1, name, verified: false });
      continue;
    }
    let souls = null;
    if (cfg.soulsOffset !== null) {
      souls = u32(ce.record, cfg.soulsOffset); // DSR: fixed offset
    } else {
      // DS3: save size varies, so locate souls relative to the in-record name.
      const np = ce.record.indexOf(nameToUtf16Bytes(name));
      if (np >= 20) souls = u32(ce.record, np - 20);
    }
    slots.push({ slot: i + 1, name, verified: true, souls: sane(souls) ? souls : null });
  }
  return { slots, summaryVerified: true };
}

function readDs2(raw, entries) {
  const key = KEYS.ds2;
  const summary = decryptRecord(raw, entries[0].dataOffset, entries[0].size, key);
  const slots = [];
  if (!summary.verified || !summary.record) return { slots, summaryVerified: summary.verified };
  const rec = summary.record;
  for (let i = 0; i < 10; i++) {
    const flagOff = 892 + 496 * i;
    if (rec[flagOff] === 0 || rec[flagOff] === undefined) continue;
    const name = utf16Name(rec, 1286 + 496 * i, 14);
    const entryIndex = i + 1; // DS2 character entries are 1..10
    if (entryIndex >= entries.length) continue;
    const ce = decryptRecord(raw, entries[entryIndex].dataOffset, entries[entryIndex].size, key);
    if (!ce.verified || !ce.record) {
      slots.push({ slot: i + 1, name, verified: false });
      continue;
    }
    const souls = u32(ce.record, 60);
    const soulMemory = u32(ce.record, 68);
    slots.push({
      slot: i + 1,
      name,
      verified: true,
      souls: sane(souls) ? souls : null,
      soulMemory: sane(soulMemory) ? soulMemory : null,
    });
  }
  return { slots, summaryVerified: true };
}

function inspect(buf, game) {
  if (game === "er") {
    const r = er.parseSave(buf);
    return { game, kind: "er", er: r };
  }
  // Games with no readable level/souls/stats — handled before any BND4 parsing.
  if (game !== "dsr" && game !== "ds3" && game !== "ds2") {
    return { game, kind: "unsupported" };
  }
  const entries = er.parseBnd4(buf);
  if (game === "dsr" || game === "ds3") return { game, kind: "unified", ...readUnified(buf, entries, game) };
  return { game, kind: "ds2", ...readDs2(buf, entries) };
}

function formatReport(result) {
  const label = GAME_LABEL[result.game] || result.game;
  const lines = [`${label} save — character slots`, "(read-only; verified against each slot's stored checksum)", ""];

  if (result.kind === "er") {
    return formatEr(result.er, lines);
  }
  if (result.kind === "unsupported") {
    if (result.game === "sekiro") {
      lines.push("Sekiro has no level / souls / stat system to read (it tracks Sen, skill");
      lines.push("points and attack power instead), so there is nothing to show here.");
    } else if (result.game === "ds2vanilla") {
      lines.push("Original (pre-SOTFS) Dark Souls II saves use a different, unencrypted");
      lines.push("format that this tool does not parse. Scholar of the First Sin is supported.");
    } else {
      lines.push("Unrecognized save type.");
    }
    return lines.join("\n");
  }

  const slots = result.slots || [];
  if (!result.summaryVerified) {
    lines.push("Could not verify the save header — wrong file, or a newer save format.");
    return lines.join("\n");
  }
  if (slots.length === 0) lines.push("No occupied character slots found.");
  for (const s of slots) {
    if (!s.verified) {
      lines.push(`Slot ${s.slot}: ${s.name || "(unknown)"} — checksum mismatch, could not read`);
      continue;
    }
    lines.push(`Slot ${s.slot}: ${s.name}`);
    lines.push(`    Souls:        ${s.souls === null ? "(unavailable)" : s.souls.toLocaleString()}`);
    if ("soulMemory" in s) {
      lines.push(`    Soul memory:  ${s.soulMemory === null ? "(unavailable)" : s.soulMemory.toLocaleString()}`);
    }
  }
  lines.push("");
  lines.push("Soul level and individual stats are not shown for this game — there is no");
  lines.push("verified field map for them here. Only Elden Ring exposes full stats so far.");
  return lines.join("\n");
}

function formatEr(r, lines) {
  const active = r.slots.filter((s) => s.verified && !s.empty && !s.parseFailed);
  if (active.length === 0) lines.push("No readable characters found.");
  for (const s of r.slots) {
    if (!s.verified) {
      lines.push(`Slot ${s.slotIndex + 1}: checksum mismatch — could not decrypt (skipped)`);
      continue;
    }
    if (s.empty) {
      lines.push(`Slot ${s.slotIndex + 1}: (empty)`);
      continue;
    }
    if (s.parseFailed) {
      lines.push(`Slot ${s.slotIndex + 1}: decrypted OK but layout not recognized`);
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
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const gi = args.indexOf("--game");
  const forced = gi >= 0 ? args[gi + 1] : null;
  const file = args.find((a, i) => !a.startsWith("--") && !(gi >= 0 && i === gi + 1));

  if (!file || args.includes("--help") || args.includes("-h")) {
    console.error("Usage: node souls-save-info.js [--json] [--game er|ds3|ds2|dsr] <path-to-save.sl2>");
    console.error("Read-only FromSoftware Souls save inspector.");
    process.exit(file ? 0 : 2);
  }

  const game = forced || detectGame(file);
  if (!game) {
    console.error(
      `Could not determine the game from "${path.basename(file)}".\n` +
        "Pass --game er|ds3|ds2|dsr, or use the standard save filename\n" +
        "(ER0000.sl2, DS30000.sl2, DS2SOFS0000.sl2, DRAKS0005.sl2)."
    );
    process.exit(2);
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
    result = inspect(buf, game);
  } catch (e) {
    console.error(`Could not parse save: ${e.message}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatReport(result));
  }
}

if (require.main === module) main();

module.exports = { detectGame, decryptRecord, readUnified, readDs2, inspect, KEYS };
