# Ingine World (desktop prototype)

A [Tauri](https://tauri.app) app that opens the procedural world, the same game as the
GitHub Pages site, in its own window. It adds no game code: it wraps the sandbox build
(`apps/sandbox`, built with `--mode desktop`, which sets `VITE_DEFAULT_LEVEL=world`).
Saves live in the app's own storage, separate from the browser's.

## Download

The newest installers are on the **desktop-latest** pre-release
(Releases > "Desktop app (latest build)"), rebuilt on every push to `main` that touches the
engine, the sandbox or this app. You can also rebuild by hand: Actions > Desktop app > Run workflow.

| Computer | File |
|---|---|
| Mac (Apple silicon or Intel) | `.dmg` |
| Windows | `-setup.exe` (or `.msi`) |
| Linux | `.AppImage` (or `.deb`) |

## Opening an unsigned build

The builds are not signed with a paid Apple or Microsoft certificate, so the first launch
needs one extra step. After that it opens normally.

**Mac.** Open the `.dmg` and drag Ingine World into Applications. Open it once; macOS says it
can't verify the app. Click Done, then go to System Settings > Privacy & Security, scroll
down to "Ingine World was blocked" and click **Open Anyway**. If macOS instead says the app
"is damaged", run this in Terminal and open it again:

```bash
xattr -dr com.apple.quarantine "/Applications/Ingine World.app"
```

**Windows.** Run the setup file. If SmartScreen says "Windows protected your PC", click
**More info**, then **Run anyway**.

**Linux.** `chmod +x Ingine*.AppImage`, then run it.

## Desktop differences

- The window opens maximized. For true fullscreen use F (as in the browser) or, on macOS,
  Window > Enter Full Screen (Ctrl+Cmd+F).
- On macOS the menu has no Cmd+W "Close Window", so Cmd (crouch) can't close the game.
  Cmd+Q still quits.

## Build it yourself

Needs Rust (https://rustup.rs) and, on Linux, the WebKitGTK libraries listed in
`.github/workflows/desktop.yml`.

```bash
npm install
npm run dev:desktop     # app window on the sandbox dev server (hot reload)
npm run build:desktop   # installers in apps/desktop/src-tauri/target/release/bundle/
```
