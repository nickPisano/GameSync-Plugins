#!/usr/bin/env node
"use strict";

/*
 * GameSync plugin validator.
 *
 * Zero dependencies on purpose: CI just runs `node tools/validate.js`.
 *
 * What it does:
 *   - Validates every plugins/*.json (except index.json) against the plugin format.
 *   - Marks each plugin's kinds ([games|emulators|viewers|hooks]) and runs_commands flag.
 *   - Enforces the allowed-placeholder whitelist and basic glob/command sanity.
 *   - Keeps plugins/index.json in sync with the actual plugins.
 *
 * Usage:
 *   node tools/validate.js              Validate; non-zero exit on any error.
 *   node tools/validate.js --write-index  Regenerate plugins/index.json (preserving summaries).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const INDEX_PATH = path.join(PLUGINS_DIR, "index.json");
const SCHEMA_PATH = path.join(ROOT, "schema", "plugin.schema.json");

const ALLOWED_PLACEHOLDERS = [
  "APPDATA",
  "LOCALAPPDATA",
  "DOCUMENTS",
  "SAVEDGAMES",
  "HOME",
  "USERPROFILE",
  "APPSUPPORT",
  "XDG_DATA",
  "XDG_CONFIG",
  "INSTALL_DIR",
];
const ALLOWED_PLACEHOLDER_SET = new Set(ALLOWED_PLACEHOLDERS);

const TOP_KEYS = new Set(["$schema", "name", "games", "emulators", "viewers", "hooks"]);
const ENTRY_KEYS = new Set(["name", "paths"]);
const VIEWER_KEYS = new Set(["name", "match", "command"]);
const HOOK_KEYS = ["pre_backup", "post_backup", "pre_restore", "post_restore"];
const KIND_ORDER = ["games", "emulators", "viewers", "hooks"];

// Patterns that should never appear in a community-submitted command. These are
// hard errors: command-bearing plugins are already high-trust, so anything that
// smells like data destruction, remote code execution, or obfuscation is rejected.
const DANGEROUS_COMMAND_PATTERNS = [
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, msg: "recursive force delete (rm -rf)" },
  { re: /\b(mkfs|fdisk|diskutil\s+erase|format\s+[a-z]:)/i, msg: "disk format/partition command" },
  { re: /\bdd\s+if=/i, msg: "raw dd write" },
  { re: /(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sh|bash|zsh|powershell|pwsh|python|node|perl|ruby)\b/i, msg: "pipe-from-network to interpreter" },
  { re: /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/, msg: "fork bomb" },
  { re: /\b(base64\s+-d|base64\s+--decode)\b/i, msg: "base64-decoded payload" },
  { re: /\beval\b/i, msg: "eval of dynamic input" },
  { re: />\s*\/dev\/sd[a-z]/i, msg: "write to a raw block device" },
];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function listPluginFiles() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs
    .readdirSync(PLUGINS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json" && !f.startsWith("."))
    .sort();
}

function checkPath(p, ctx, errors, warnings) {
  if (typeof p !== "string" || p.length === 0) {
    errors.push(`${ctx}: each path must be a non-empty string`);
    return;
  }
  const tokens = p.match(/\{[^{}]*\}/g) || [];
  for (const tok of tokens) {
    const inner = tok.slice(1, -1);
    if (!ALLOWED_PLACEHOLDER_SET.has(inner)) {
      errors.push(
        `${ctx}: unknown placeholder "${tok}" in "${p}" (allowed: ${ALLOWED_PLACEHOLDERS.map((x) => "{" + x + "}").join(", ")})`
      );
    }
  }
  const stripped = p.replace(/\{[^{}]*\}/g, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    errors.push(`${ctx}: malformed placeholder braces in "${p}"`);
  }
  if (p.includes("\\")) {
    warnings.push(`${ctx}: "${p}" uses backslashes; prefer forward slashes for cross-platform templates`);
  }
}

function checkEntry(entry, ctx, { nameRequired }, errors, warnings) {
  if (!isPlainObject(entry)) {
    errors.push(`${ctx}: must be an object`);
    return;
  }
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) errors.push(`${ctx}: unknown key "${key}" (allowed: name, paths)`);
  }
  if (nameRequired) {
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      errors.push(`${ctx}: "name" is required and must be a non-empty string`);
    }
  } else if ("name" in entry && (typeof entry.name !== "string" || entry.name.length === 0)) {
    errors.push(`${ctx}: "name" must be a non-empty string when present`);
  }
  if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
    errors.push(`${ctx}: "paths" is required and must be a non-empty array`);
    return;
  }
  entry.paths.forEach((p, i) => checkPath(p, `${ctx}.paths[${i}]`, errors, warnings));
}

function checkCommand(cmd, ctx, errors, warnings) {
  if (typeof cmd !== "string" || cmd.trim().length === 0) {
    errors.push(`${ctx}: command must be a non-empty string`);
    return;
  }
  for (const { re, msg } of DANGEROUS_COMMAND_PATTERNS) {
    if (re.test(cmd)) errors.push(`${ctx}: command rejected — looks like ${msg}: ${cmd}`);
  }
}

function validatePlugin(file) {
  const id = path.basename(file, ".json");
  const errors = [];
  const warnings = [];
  const result = { id, file, name: id, kinds: [], runs_commands: false, errors, warnings };

  let raw;
  try {
    raw = fs.readFileSync(path.join(PLUGINS_DIR, file), "utf8");
  } catch (e) {
    errors.push(`cannot read file: ${e.message}`);
    return result;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    errors.push(`invalid JSON: ${e.message}`);
    return result;
  }

  if (!isPlainObject(data)) {
    errors.push("top level must be a JSON object");
    return result;
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    warnings.push(`filename/id "${id}" should be lowercase kebab-case (a-z, 0-9, '-', '.', '_')`);
  }

  for (const key of Object.keys(data)) {
    if (!TOP_KEYS.has(key)) errors.push(`unknown top-level key "${key}" (allowed: name, games, emulators, viewers, hooks)`);
  }

  if ("name" in data) {
    if (typeof data.name !== "string" || data.name.length === 0) {
      errors.push(`"name" must be a non-empty string`);
    } else {
      result.name = data.name;
    }
  }

  // games
  if ("games" in data) {
    if (!isPlainObject(data.games)) {
      errors.push(`"games" must be an object`);
    } else {
      const keys = Object.keys(data.games);
      if (keys.length === 0) errors.push(`"games" must not be empty`);
      for (const appid of keys) {
        const entry = data.games[appid];
        if (!/^\d+$/.test(appid) && !(isPlainObject(entry) && typeof entry.name === "string")) {
          warnings.push(`games["${appid}"]: non-numeric key should provide a "name" so non-Steam stores can match`);
        }
        checkEntry(entry, `games["${appid}"]`, { nameRequired: false }, errors, warnings);
      }
      if (keys.length > 0) result.kinds.push("games");
    }
  }

  // emulators
  if ("emulators" in data) {
    if (!isPlainObject(data.emulators)) {
      errors.push(`"emulators" must be an object`);
    } else {
      const keys = Object.keys(data.emulators);
      if (keys.length === 0) errors.push(`"emulators" must not be empty`);
      for (const key of keys) {
        checkEntry(data.emulators[key], `emulators["${key}"]`, { nameRequired: true }, errors, warnings);
      }
      if (keys.length > 0) result.kinds.push("emulators");
    }
  }

  // viewers
  if ("viewers" in data) {
    if (!Array.isArray(data.viewers)) {
      errors.push(`"viewers" must be an array`);
    } else {
      if (data.viewers.length === 0) errors.push(`"viewers" must not be empty`);
      data.viewers.forEach((v, i) => {
        const ctx = `viewers[${i}]`;
        if (!isPlainObject(v)) {
          errors.push(`${ctx}: must be an object`);
          return;
        }
        for (const key of Object.keys(v)) {
          if (!VIEWER_KEYS.has(key)) errors.push(`${ctx}: unknown key "${key}" (allowed: name, match, command)`);
        }
        if (typeof v.name !== "string" || v.name.length === 0) errors.push(`${ctx}: "name" is required (non-empty string)`);
        if (typeof v.match !== "string" || v.match.length === 0) {
          errors.push(`${ctx}: "match" is required (non-empty glob string)`);
        } else if (v.match.includes("/") || v.match.includes("\\")) {
          warnings.push(`${ctx}: "match" should be a filename glob (e.g. *.sl2), not a path`);
        }
        checkCommand(v.command, ctx, errors, warnings);
        if (typeof v.command === "string" && !v.command.includes("{file}")) {
          warnings.push(`${ctx}: command does not reference {file}; the matched file won't be passed to it`);
        }
      });
      if (data.viewers.length > 0) {
        result.kinds.push("viewers");
        result.runs_commands = true;
      }
    }
  }

  // hooks
  if ("hooks" in data) {
    if (!isPlainObject(data.hooks)) {
      errors.push(`"hooks" must be an object`);
    } else {
      for (const key of Object.keys(data.hooks)) {
        if (!HOOK_KEYS.includes(key)) {
          errors.push(`hooks: unknown key "${key}" (allowed: ${HOOK_KEYS.join(", ")})`);
        }
      }
      let active = false;
      for (const key of HOOK_KEYS) {
        if (!(key in data.hooks)) continue;
        const val = data.hooks[key];
        if (val === null) continue;
        active = true;
        checkCommand(val, `hooks.${key}`, errors, warnings);
      }
      if (active) {
        result.kinds.push("hooks");
        result.runs_commands = true;
      }
    }
  }

  if (result.kinds.length === 0 && errors.length === 0) {
    warnings.push("plugin declares no games, emulators, viewers, or hooks — it does nothing");
  }

  return result;
}

function canonicalKinds(kinds) {
  return KIND_ORDER.filter((k) => kinds.includes(k));
}

function buildIndexEntry(result, existingSummary) {
  return {
    id: result.id,
    name: result.name,
    summary: existingSummary || "TODO: add a one-line summary",
    kinds: canonicalKinds(result.kinds),
    runs_commands: result.runs_commands,
  };
}

function loadExistingIndex() {
  if (!fs.existsSync(INDEX_PATH)) return { entries: [], byId: new Map(), error: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    if (!Array.isArray(parsed)) return { entries: [], byId: new Map(), error: "index.json must be a JSON array" };
    const byId = new Map();
    for (const e of parsed) {
      if (isPlainObject(e) && typeof e.id === "string") byId.set(e.id, e);
    }
    return { entries: parsed, byId, error: null };
  } catch (e) {
    return { entries: [], byId: new Map(), error: `index.json invalid JSON: ${e.message}` };
  }
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const writeIndex = process.argv.includes("--write-index");
  const files = listPluginFiles();

  // Sanity-check the schema file itself parses.
  const schemaErrors = [];
  try {
    JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  } catch (e) {
    schemaErrors.push(`schema/plugin.schema.json: ${e.message}`);
  }

  const results = files.map(validatePlugin);
  const valid = results.filter((r) => r.errors.length === 0);

  // Report per plugin.
  console.log(`GameSync plugin validator — ${files.length} plugin file(s) in plugins/\n`);
  for (const r of results) {
    const kinds = canonicalKinds(r.kinds);
    const mark = r.errors.length ? "FAIL" : "ok  ";
    const cmd = r.runs_commands ? "  [RUNS COMMANDS]" : "";
    console.log(`[${mark}] ${r.id}  kinds=[${kinds.join(", ")}]  runs_commands=${r.runs_commands}${cmd}`);
    for (const w of r.warnings) console.log(`        warn: ${w}`);
    for (const e of r.errors) console.log(`        error: ${e}`);
  }

  // Index sync.
  const existing = loadExistingIndex();
  const indexErrors = [];
  if (existing.error) indexErrors.push(existing.error);

  const expected = valid
    .map((r) => buildIndexEntry(r, (existing.byId.get(r.id) || {}).summary))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (writeIndex) {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(expected, null, 2) + "\n");
    console.log(`\nWrote ${expected.length} entries to plugins/index.json`);
    const missing = expected.filter((e) => e.summary.startsWith("TODO"));
    if (missing.length) {
      console.log(`Note: fill in summaries for: ${missing.map((e) => e.id).join(", ")}`);
    }
  } else if (!existing.error) {
    const expectedById = new Map(expected.map((e) => [e.id, e]));
    for (const r of valid) {
      const have = existing.byId.get(r.id);
      const want = expectedById.get(r.id);
      if (!have) {
        indexErrors.push(`index.json missing entry for "${r.id}" (run: node tools/validate.js --write-index)`);
        continue;
      }
      if (typeof have.summary !== "string" || have.summary.trim() === "" || have.summary.startsWith("TODO")) {
        indexErrors.push(`index.json["${r.id}"]: summary is missing — add a one-line description`);
      }
      if (have.name !== want.name) indexErrors.push(`index.json["${r.id}"].name "${have.name}" != plugin name "${want.name}"`);
      if (!eq(canonicalKinds(have.kinds || []), want.kinds)) {
        indexErrors.push(`index.json["${r.id}"].kinds [${(have.kinds || []).join(", ")}] != [${want.kinds.join(", ")}]`);
      }
      if (have.runs_commands !== want.runs_commands) {
        indexErrors.push(`index.json["${r.id}"].runs_commands ${have.runs_commands} != ${want.runs_commands}`);
      }
    }
    for (const e of existing.entries) {
      if (isPlainObject(e) && typeof e.id === "string" && !valid.some((r) => r.id === e.id)) {
        indexErrors.push(`index.json has entry "${e.id}" with no matching valid plugin file`);
      }
    }
    if (indexErrors.length) indexErrors.push(`fix with: node tools/validate.js --write-index`);
  }

  // Summary.
  const failed = results.filter((r) => r.errors.length);
  const cmdCount = valid.filter((r) => r.runs_commands).length;
  console.log("");
  console.log(`Summary: ${valid.length} valid, ${failed.length} failed, ${cmdCount} run commands.`);
  if (schemaErrors.length) for (const e of schemaErrors) console.log(`error: ${e}`);
  if (indexErrors.length) {
    console.log("\nindex.json:");
    for (const e of indexErrors) console.log(`  error: ${e}`);
  }

  const ok = failed.length === 0 && schemaErrors.length === 0 && (writeIndex || indexErrors.length === 0);
  if (!ok) {
    console.log("\nValidation FAILED.");
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main();
