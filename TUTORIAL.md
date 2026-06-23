# Installing GameSync plugins — a step-by-step tutorial

This is the hands-on guide to getting a plugin from this catalog into
**[GameSync](https://github.com/nickPisano/GameSync)** (the main app) and using it.
For the field-by-field plugin *format* reference, see [README.md](README.md).

Everything below matches GameSync's actual **Plugins** window — the button names,
toggles, and messages are exactly what you'll see on screen.

> [!IMPORTANT]
> **Two kinds of plugins.** `games` and `emulators` are **pure data** (just save-path
> rules) and are always safe. `viewers` and `hooks` run **shell commands** and only
> execute after you turn on **"Allow plugins to run commands"**. The catalog flags every
> command-bearing plugin as **`runs_commands`**. Parts 1–2 below are safe for everyone;
> Part 3 is the opt-in part.

---

## What you need

- **GameSync** installed and opened at least once — [github.com/nickPisano/GameSync](https://github.com/nickPisano/GameSync).
- A plugin `.json` file from this repo's [`plugins/`](plugins/) folder.
- (Only for the save inspector in Part 3) **Node.js ≥ 18** — check with `node --version`.

---

## The 60-second version

1. In GameSync, click **Plugins** in the top toolbar.
2. Click **Open folder** to open the plugins folder in your file manager.
3. Copy a `.json` file from this repo's [`plugins/`](plugins/) into that folder.
4. Back in GameSync, click **Reload**. The plugin appears in the list, switched **On**.

That's the whole flow for a data-only plugin. The rest of this page explains each step,
how to verify it worked, and how to set up the command-bearing save inspector.

---

## Part 1 — Open the Plugins window

In GameSync's main window, the top toolbar has a **Plugins** button. Click it.

The Plugins window shows:

- a one-line hint: *"Drop `.json` files in the plugins folder to add games, emulator save
  paths, backup/restore hooks, or file viewers. Click Reload after editing."*
- the **full path** to your plugins folder (shown as code at the top),
- an **Open folder** button and a **Reload** button,
- the **"Allow plugins to run commands"** checkbox (off by default),
- one row per installed plugin, each with an **On/Off** toggle.

GameSync **creates the plugins folder for you** the first time you open this window, so it
always exists even if it's empty.

---

## Part 2 — Install a data-only plugin

We'll install [`fromsoftware-souls`](plugins/fromsoftware-souls.json) (save-path rules for
Elden Ring, the Dark Souls games, Sekiro). It's pure data — no commands.

1. **Open the folder.** In the Plugins window, click **Open folder**. Your file manager
   opens at the plugins directory.
2. **Copy the file in.** Drag (or copy) [`plugins/fromsoftware-souls.json`](plugins/fromsoftware-souls.json)
   from this repo into that folder. Keep the filename — **the filename without `.json` is
   the plugin's id** (`fromsoftware-souls.json` → id `fromsoftware-souls`). One `.json`
   file = one plugin.
3. **Reload.** Back in GameSync, click **Reload**. No app restart is needed.
4. **Verify it loaded.** A new row appears:

   ```
   FromSoftware Souls saves
   fromsoftware-souls
   5 games · 0 emulators · 0 hooks · 0 viewers          [ On ]
   ```

   The counts confirm GameSync parsed it. New plugins are **On** by default; the
   game-save rules are now part of detection. Flip the toggle to **Off** to disable a
   plugin without deleting its file.

To install more, repeat — drop each `.json` in and click **Reload**.

### Where the plugins folder actually is

You normally never need this — **Open folder** takes you straight there. But if you want
to script it or place files manually, GameSync uses `$GAMESYNC_DATA/plugins` if the
`GAMESYNC_DATA` environment variable is set, otherwise the per-OS app data directory:

| OS | Plugins folder |
| --- | --- |
| **macOS** | `~/Library/Application Support/dev.GameSync.GameSync/plugins` |
| **Linux** | `~/.local/share/GameSync/plugins` |
| **Windows** | `%APPDATA%\GameSync\GameSync\data\plugins` |

The exact path is always shown at the top of the Plugins window, so trust that over the
table if they ever differ on your machine.

### Removing or disabling a plugin

- **Disable** (keep the file): flip its row toggle to **Off**, or
- **Remove** entirely: delete its `.json` from the plugins folder and click **Reload**.

---

## Part 3 — Command-bearing plugins and the safety toggle

`viewers` and `hooks` run programs on your computer, so they are gated behind one switch:

> **"Allow plugins to run commands (hooks & file viewers)."** — off by default.

While it's **off**:

- data-only plugins (games/emulators) work normally,
- command-bearing plugins still load and you can still see them in the list, but their
  viewers and hooks **do nothing**.

Turn it **on** only if you trust every command-bearing plugin you've installed — those
commands run with your user account's privileges. You can review exactly what a viewer or
hook will run by opening the plugin's `.json` and reading its `command` strings before
enabling anything.

---

## Part 4 — End-to-end: the FromSoftware Souls save inspector

[`fromsoftware-souls-viewer.json`](plugins/fromsoftware-souls-viewer.json) is a real,
working command-bearing plugin. It registers **file viewers** that run
[`tools/souls-save-info.js`](tools/souls-save-info.js) — a **zero-dependency, read-only**
Node script (it never writes to your save) — and prints character info from a `.sl2` save:

| Game | Save file | Shows |
| --- | --- | --- |
| **Elden Ring** | `ER0000.sl2` | name, **level**, runes, soul memory, 8 base stats |
| **Dark Souls III** | `DS30000.sl2` | name, **souls** |
| **Dark Souls II: Scholar of the First Sin** | `DS2SOFS0000.sl2` | name, **souls**, soul memory |
| **Dark Souls: Remastered** | `DRAKS0005.sl2` | name, **souls** |

### Step 1 — Confirm Node is installed

```bash
node --version    # must be v18 or newer
```

### Step 2 — Point the viewer at the script on your machine

The plugin ships with a **placeholder** path so it can't accidentally run anything. Open
your installed copy of `fromsoftware-souls-viewer.json` (in the plugins folder) and, in
**every** `command`, replace

```
/ABSOLUTE/PATH/TO/GameSync-Plugins/tools/souls-save-info.js
```

with the real location of the script on your computer, e.g.:

- **macOS / Linux:** `node "/Users/you/GameSync-Plugins/tools/souls-save-info.js" {file}`
- **Windows:** `node "C:\\Users\\you\\GameSync-Plugins\\tools\\souls-save-info.js" {file}`

`{file}` is a placeholder GameSync fills in with the save file you click on — leave it as is.

### Step 3 — Enable commands and reload

1. In the Plugins window, tick **"Allow plugins to run commands."**
2. Click **Reload**. The viewer plugin's row should show `… · 4 viewers`.

### Step 4 — Run the viewer on a save

1. In GameSync's main window, find the game card (e.g. Elden Ring) and click **Files**.
2. The **Save files** window lists the files in that game's save folder.
3. Next to a matching save (e.g. `ER0000.sl2`) you'll see a button **named after the
   viewer** — e.g. *"Elden Ring — level / runes / soul memory / base stats."* (Viewer
   buttons only appear when commands are allowed **and** a plugin provides a matching
   viewer.) Click it.

### Step 5 — See the output (important)

The inspector is a **console** script — it prints text. GameSync launches viewers
**detached and without opening a terminal window**, so that text only shows up if you
started GameSync from a terminal. If you launched GameSync normally (double-click), the
script runs but you won't see anything.

Two reliable ways to actually read the output:

**A) Run it yourself in a terminal** (simplest — no plugin edits needed). Grab the save's
path from the **Save files** window (use **Reveal** / **Open save folder**), then:

```bash
node "/path/to/GameSync-Plugins/tools/souls-save-info.js" "/path/to/ER0000.sl2"
node "/path/.../souls-save-info.js" --json "/path/to/DS30000.sl2"   # machine-readable
node "/path/.../souls-save-info.js" --game dsr "/path/to/save.sl2"  # force the game
```

**B) Make the viewer save its output to a file and open it.** Edit the `command` in your
installed `fromsoftware-souls-viewer.json` so it redirects to a text file and opens that
file. Use whichever line matches your OS:

- **macOS:**
  ```
  node "/Users/you/.../souls-save-info.js" "{file}" > "$HOME/Desktop/souls-info.txt" 2>&1; open "$HOME/Desktop/souls-info.txt"
  ```
- **Linux:**
  ```
  node "/home/you/.../souls-save-info.js" "{file}" > "$HOME/souls-info.txt" 2>&1; xdg-open "$HOME/souls-info.txt"
  ```
- **Windows:**
  ```
  node "C:\\Users\\you\\...\\souls-save-info.js" "{file}" > "%USERPROFILE%\\Desktop\\souls-info.txt" 2>&1 & start "" "%USERPROFILE%\\Desktop\\souls-info.txt"
  ```

Click **Reload** after editing, then click the viewer button again — the report opens in
your default text editor.

### Why it never lies to you

Each encrypted save slot stores an MD5 of its own contents. After reading a slot the
script recomputes that MD5 and compares; on a mismatch (wrong file, or a save format newer
than this tool) it reports the slot as **unreadable instead of printing guessed numbers**.
That's also why Elden Ring shows more than the other games — only ER's full stat layout is
publicly documented and round-trip tested. **Sekiro** (no level/souls system) and
**original, pre-SOTFS Dark Souls II** (a different unencrypted format) are detected and
reported as unsupported rather than guessed.

> [!TIP]
> Back up your save before pointing any tool at it. This script only reads, but it's a
> good habit — and GameSync is a backup app, so let it make one first.

---

## Troubleshooting

**The plugin doesn't appear after I copied it in.**
Click **Reload**. Confirm the file is directly in the plugins folder (not a subfolder) and
ends in `.json`.

**GameSync shows "Some plugin files could not be loaded."**
That panel at the bottom of the Plugins window means a file is invalid JSON or has the
wrong shape; it prints `yourfile.json — <error>`. Fix the JSON (a trailing comma or a
missing quote is the usual cause) and click **Reload**. You can catch these before copying
the file in by validating locally: `node tools/validate.js` (see [README.md](README.md#validate-locally)).

**I clicked the viewer button but nothing happened / I saw no output.**
Expected for a console script — see [Step 5](#step-5--see-the-output-important). Use option
A (run it in a terminal) or option B (redirect to a file and open it).

**There's no viewer button next to my save file.**
Check all three: (1) **"Allow plugins to run commands"** is on, (2) the viewer plugin's row
is **On**, and (3) the save's filename matches the viewer's pattern (e.g. `ER0000.sl2`).
Click **Reload** after any change.

**"plugin commands are disabled — enable them in Plugins settings first."**
The commands toggle is off. Turn on **"Allow plugins to run commands"** and try again.

**`node: command not found` (or similar) in the output.**
Node isn't installed or isn't on your PATH. Install Node ≥ 18 and re-check with
`node --version`.

---

## See also

- **[GameSync](https://github.com/nickPisano/GameSync)** — the main app these plugins are for.
- [README.md](README.md) — the plugin format reference and the full catalog.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to submit your own plugin.
