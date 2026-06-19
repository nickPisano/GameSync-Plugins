# GameSync Plugins

A community catalog of plugins for **GameSync**, a desktop game-save backup/sync app
(Rust core + Tauri). A plugin is a single drop-in `.json` file that you place in
GameSync's plugins folder. Plugins can:

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
| [`example-save-viewer`](plugins/example-save-viewer.json) | viewers | **yes** |
| [`example-backup-hooks`](plugins/example-backup-hooks.json) | hooks | **yes** |

The two `example-*` plugins are **demonstrations** of command-bearing plugins. Install
them only if you understand and want their behavior.

---

## Install a plugin

The authoritative way to find the folder:

> **Open GameSync → Plugins → "Open folder", then drop the `.json` file in there.**

Restart or rescan if GameSync doesn't pick it up automatically. To remove a plugin,
delete its `.json` file.

### Typical folder locations

GameSync derives its data directory from
`directories::ProjectDirs("dev", "GameSync", "GameSync")`, with the `plugins`
subfolder inside it. You can override the data directory with the `GAMESYNC_DATA`
environment variable (plugins then live in `$GAMESYNC_DATA/plugins`).

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
