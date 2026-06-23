# GameSync Plugins

A community catalog of plugins for **[GameSync](https://github.com/nickPisano/GameSync)**,
a desktop game-save backup/sync app (Rust core + Tauri). A plugin is a single drop-in
`.json` file that you place in GameSync's plugins folder. Plugins can:

- add **save-path detection rules** for games and emulators,
- register **file viewers** for save files,
- run **backup/restore hooks** (shell commands around backup and restore).

> [!IMPORTANT]
> **Two kinds of plugins.** `games` and `emulators` are **pure data** — just file
> paths — and are always safe. `viewers` and `hooks` run **arbitrary shell commands**
> and only execute if you turn on **"allow plugins to run commands"** in GameSync.
> The catalog and validator flag every command-bearing plugin as **`runs_commands`**.

---

## Browse the catalog

[`plugins/index.json`](plugins/index.json) is the machine-readable catalog. Each entry:

```json
{ "id": "fromsoftware-souls", "name": "FromSoftware Souls saves",
  "summary": "…", "kinds": ["games"], "runs_commands": false }
```

| Plugin | Kinds | Runs commands? |
| --- | --- | --- |
| [`fromsoftware-souls`](plugins/fromsoftware-souls.json) | games | no |
| [`indie-essentials`](plugins/indie-essentials.json) | games | no |
| [`open-world-rpgs`](plugins/open-world-rpgs.json) | games | no |
| [`survival-sandbox`](plugins/survival-sandbox.json) | games | no |
| [`console-emulators`](plugins/console-emulators.json) | emulators | no |
| [`fromsoftware-souls-viewer`](plugins/fromsoftware-souls-viewer.json) | viewers | **yes** |
| [`example-save-viewer`](plugins/example-save-viewer.json) | viewers | **yes** |
| [`example-backup-hooks`](plugins/example-backup-hooks.json) | hooks | **yes** |

The two `example-*` plugins are **demonstrations** of command-bearing plugins. Install
them only if you understand and want their behavior. `fromsoftware-souls-viewer` is a
real, working command-bearing plugin — see
[FromSoftware Souls save inspector](#fromsoftware-souls-save-inspector-runs-commands) below.

---

## Install a plugin

> [!TIP]
> **New to this? See the full step-by-step walkthrough in [TUTORIAL.md](TUTORIAL.md)** —
> it covers installing, verifying, the safety toggle, and using the save inspector
> end-to-end, with troubleshooting.

The quick version, straight from GameSync's UI:

1. Open **[GameSync](https://github.com/nickPisano/GameSync)** → click **Plugins** in the toolbar.
2. Click **Open folder** → drop the `.json` file into the plugins folder.
3. Back in GameSync, click **Reload** — the plugin appears, switched **On**. No restart needed.

Toggle a plugin **Off** to disable it; delete its `.json` (then **Reload**) to remove it.
If a file is malformed, the Plugins window lists it under *"Some plugin files could not be
loaded"* with the parse error.

### Typical folder locations

The exact path is always shown at the top of the Plugins window (and the **Open folder**
button takes you there). Under the hood GameSync uses `$GAMESYNC_DATA/plugins` if the
`GAMESYNC_DATA` environment variable is set, otherwise the `plugins` subfolder of its
per-OS data directory (`directories::ProjectDirs("dev", "GameSync", "GameSync")`):

| OS | Plugins folder |
| --- | --- |
| **macOS** | `~/Library/Application Support/dev.GameSync.GameSync/plugins` |
| **Linux** | `~/.local/share/GameSync/plugins` |
| **Windows** | `%APPDATA%\GameSync\GameSync\data\plugins` |

If `GAMESYNC_DATA` is set, use `$GAMESYNC_DATA/plugins` instead.

---

## The "allow plugins to run commands" toggle

`games` and `emulators` are data only and always work. **`viewers` and `hooks` never
run unless you explicitly enable "allow plugins to run commands" in GameSync's
settings.** Leave this off unless you trust every command-bearing plugin you've
installed — these commands run with your user's privileges.

When the toggle is **off**:
- data-only plugins work normally,
- command-bearing plugins still contribute their data (if any), but their viewers and
  hooks are ignored.

---

## FromSoftware Souls save inspector (runs commands)

The [`fromsoftware-souls-viewer`](plugins/fromsoftware-souls-viewer.json) plugin
registers **viewers** for FromSoftware Souls saves. It runs
[`tools/souls-save-info.js`](tools/souls-save-info.js), a **zero-dependency, read-only**
Node script (it never writes to your save) that auto-detects the game from the save
filename. You can also run it directly without GameSync:

```bash
node tools/souls-save-info.js "/path/to/ER0000.sl2"
node tools/souls-save-info.js --json "/path/to/DS30000.sl2"   # machine-readable
node tools/souls-save-info.js --game dsr "/path/to/save.sl2"  # force the game
```

### What it shows per game

| Game | Save file | Fields shown |
| --- | --- | --- |
| **Elden Ring** | `ER0000.sl2` | name, **level**, runes, soul memory, 8 base stats |
| **Dark Souls III** | `DS30000.sl2` | name, **souls** |
| **Dark Souls II: Scholar of the First Sin** | `DS2SOFS0000.sl2` | name, **souls**, soul memory |
| **Dark Souls: Remastered** | `DRAKS0005.sl2` | name, **souls** |

Why Elden Ring shows more: its full slot layout (level + every stat) is documented in a
community 010-editor template and covered by a round-trip test. For DS3 / DS2 / DSR the
only **publicly verified** field locations are the character name and the souls counters,
so those are all the script will show — it will **not** print guessed stat/level numbers.
If you can share a copied sample save, full stats for those games can be added safely.

Not covered: **Sekiro** has no level/souls/stat system (it tracks Sen, skill points and
attack power), and **original (pre-SOTFS) Dark Souls II** uses a different unencrypted
format; the script detects both and says so rather than guessing. Inventory / weapon
lists are out of scope everywhere (they need a patch-specific item database).

### Setup

1. Have **Node.js ≥ 18** installed (`node --version`).
2. **Enable "allow plugins to run commands"** in GameSync (viewers don't run otherwise).
3. Edit each viewer's `command` to point at the script on your machine — replace
   `/ABSOLUTE/PATH/TO/GameSync-Plugins/tools/souls-save-info.js` with the real path, e.g.
   `node "/Users/you/GameSync-Plugins/tools/souls-save-info.js" {file}`.
4. **Seeing the output:** this is a console script, and GameSync launches viewers detached
   without a terminal — so run it yourself in a terminal, or have the viewer write its
   output to a file and open that. Both recipes are in
   [TUTORIAL.md → Step 5](TUTORIAL.md#step-5--see-the-output-important).

### How it stays honest

Every encrypted save slot stores an MD5 of its own (IV + ciphertext). After reading a
slot the script recomputes that MD5 and compares — if it doesn't match (wrong file, or a
save format newer than this tool), it reports the slot as unreadable **instead of printing
guessed numbers**.

### Format references

AES keys and per-game framing/offsets come from working community tooling — the
[Souls Modding Wiki](http://soulsmodding.wikidot.com/format:sl2),
[SoulsFormats](https://github.com/JKAnderson/SoulsFormats) (BND4),
[ClayAmore/EldenRingSaveTemplate](https://github.com/ClayAmore/EldenRingSaveTemplate)
(Elden Ring layout), and [jtesta/souls_givifier](https://github.com/jtesta/souls_givifier)
(DS3/DS2/DSR keys, framing, name/souls offsets). A future game patch could move offsets;
the MD5 check still prevents bad output if so.

> [!TIP]
> Back up your save before pointing any tool at it. This script only reads, but it's a
> good habit — and GameSync is a backup app, so let it make one first.

---

## Plugin format

One `.json` file per plugin. **The filename stem is the plugin id** (e.g.
`fromsoftware-souls.json` → id `fromsoftware-souls`). Everything except top-level
`name` is optional.

```json
{
  "name": "Optional display name",
  "games": {
    "<steam-appid>": { "name": "Game Name", "paths": ["{APPDATA}/Game/Saves"] }
  },
  "emulators": {
    "<key>": { "name": "Emulator Name", "paths": ["{DOCUMENTS}/Emu/saves"] }
  },
  "viewers": [
    { "name": "Hex editor", "match": "*.sl2", "command": "hexedit {file}" }
  ],
  "hooks": {
    "pre_backup": "echo before", "post_backup": null,
    "pre_restore": null, "post_restore": null
  }
}
```

### `games`

Map of **Steam appid → `{ name?, paths[] }`**. `paths` is an ordered list of templates;
the **first that resolves AND exists on disk wins**. The optional `name` lets non-Steam
stores (GOG/Epic) match by normalized name.

### `emulators`

Same `{ name, paths }` shape, but **`name` is required**. The key is any short
identifier (e.g. `pcsx2`).

### `viewers` — runs commands

A list of `{ name, match, command }`. `match` is a **filename glob** (e.g. `*.sl2`);
`command` is a shell command with `{file}` substituted for the matched file.

### `hooks` — runs commands

Shell commands run around backup/restore. Keys: `pre_backup`, `post_backup`,
`pre_restore`, `post_restore`. Each value is a command string, or `null` to disable it.

### Path placeholders

Only these placeholders are allowed in `paths`, and the validator enforces it:

| Placeholder | Meaning |
| --- | --- |
| `{APPDATA}` | Roaming app data (Windows `%APPDATA%`) |
| `{LOCALAPPDATA}` | Local app data (Windows `%LOCALAPPDATA%`) |
| `{DOCUMENTS}` | User Documents folder |
| `{SAVEDGAMES}` | Windows "Saved Games" |
| `{HOME}` | User home directory |
| `{USERPROFILE}` | Windows user profile root |
| `{APPSUPPORT}` | macOS `~/Library/Application Support` |
| `{XDG_DATA}` | Linux `$XDG_DATA_HOME` (`~/.local/share`) |
| `{XDG_CONFIG}` | Linux `$XDG_CONFIG_HOME` (`~/.config`) |
| `{INSTALL_DIR}` | The game/emulator install directory |

Use forward slashes; GameSync normalizes per OS. There is intentionally no `LocalLow`
placeholder — for Unity games that store there, use
`{USERPROFILE}/AppData/LocalLow/<Company>/<Product>`.

---

## Validate locally

```bash
node tools/validate.js          # validate all plugins + check the catalog is in sync
npm run validate                # same thing
npm run build-index             # regenerate plugins/index.json after adding a plugin
node tools/test-er-save-info.js # unit test for the Elden Ring save parser
node tools/test-souls-save-info.js # unit test for the DS3/DS2/DSR inspector
```

The validator is **zero-dependency** (pure Node ≥ 18). It checks valid JSON, only
known keys, non-empty `paths`, the placeholder whitelist, glob/command sanity, and that
[`plugins/index.json`](plugins/index.json) matches the plugins on disk. It prints each
plugin's `kinds` and `runs_commands` flag and exits non-zero on any error.

There is also a JSON Schema at [`schema/plugin.schema.json`](schema/plugin.schema.json)
for editor autocompletion — add `"$schema": "../schema/plugin.schema.json"` to a plugin
while editing it locally.

CI ([`.github/workflows/validate.yml`](.github/workflows/validate.yml)) runs the
validator on every pull request.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: PR one `.json` file to `plugins/`,
run the validator, and follow the strict security rules for command-bearing plugins.

## License

[MIT](LICENSE).
