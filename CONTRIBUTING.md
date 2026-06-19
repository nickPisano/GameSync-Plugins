# Contributing to GameSync Plugins

Thanks for helping build the catalog! Contributions are one `.json` file at a time.

## Quick start

1. **Add one plugin file** to [`plugins/`](plugins/). The filename stem is the plugin
   id, so use lowercase kebab-case: `my-cool-games.json` → id `my-cool-games`.
2. **Regenerate the catalog:** `npm run build-index` (writes
   [`plugins/index.json`](plugins/index.json)), then **edit the `summary`** for your
   new entry — the validator rejects placeholder/empty summaries.
3. **Validate:** `node tools/validate.js` (or `npm run validate`). It must pass.
4. **Open a PR** with that one file (plus the `index.json` update). CI runs the
   validator automatically.

> The validator is pure Node (≥ 18) with **no dependencies** — no `npm install` needed.

## What makes a good data-only plugin

- Accurate, current save **paths** for popular games or emulators.
- Ordered `paths`: most-likely / per-OS locations first. The first one that resolves
  **and exists on disk** wins, so listing Windows/macOS/Linux variants together is fine.
- Use only the allowed placeholders (see the table in [README.md](README.md)). The
  validator enforces this whitelist.
- Use forward slashes. There is no `LocalLow` placeholder — use
  `{USERPROFILE}/AppData/LocalLow/<Company>/<Product>`.
- For non-Steam (GOG/Epic) entries, include a `name` so GameSync can match by
  normalized name.

Data-only plugins (`games` / `emulators`) are **always safe** and are the easiest to get
merged.

## Security rules for command-bearing plugins (`viewers` / `hooks`)

`viewers` and `hooks` run **arbitrary shell commands** on the user's machine (only when
they enable "allow plugins to run commands"). We hold them to a much higher bar.

**Required:**

- The plugin's top-level `name` and your PR description must make it **obvious** the
  plugin runs commands. The catalog will mark it `runs_commands: true`.
- Commands must be **transparent and minimal** — a reviewer should understand exactly
  what they do by reading them.
- Viewers should reference `{file}` and only **read/open** the matched file.
- Hooks should be scoped to backup/restore bookkeeping (logging, lightweight
  pre/post steps).

**Rejected automatically by the validator** (non-exhaustive): `rm -rf`, disk
format/partition tools, raw `dd if=`, piping a network download into a shell/interpreter
(`curl … | sh`), fork bombs, `base64 -d` payloads, `eval`, and writes to raw block
devices.

**Also rejected in review:**

- Downloading or executing remote code, or anything that phones home.
- Deleting or modifying files outside the save set.
- Obfuscated, minified, or encoded commands.
- Anything whose purpose isn't immediately clear from reading it.

When in doubt, prefer a **data-only** plugin. If you genuinely need a command, keep it
tiny, document why, and expect close scrutiny. New contributors will generally have an
easier time landing data-only plugins than command-bearing ones.

## Style

- Two-space indented JSON, one plugin per file.
- Group related titles into a themed plugin (e.g. all FromSoftware Souls games) or ship
  a single game/emulator — both are fine.
- Keep the `summary` in `index.json` to one line.

## Validator reference

| Command | What it does |
| --- | --- |
| `node tools/validate.js` | Validate every plugin and verify `index.json` is in sync. |
| `node tools/validate.js --write-index` | Regenerate `index.json` (preserves existing summaries). |
| `npm run validate` | Alias for the first command. |
| `npm run build-index` | Alias for `--write-index`. |

By submitting a contribution you agree to license it under the repository's
[MIT License](LICENSE).
