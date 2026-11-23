# OpenSol Desktop

OpenSol Desktop is the same OpenSol app in an Electron window. The renderer, daemon and data
folder live in `~/.lunarcode`.

| OS | Installer |
|---|---|
| Linux | `.AppImage`, `.deb`, `.rpm` |
| Windows 10 / 11 | `.exe` (NSIS) |
| macOS 13+ | `.dmg`, `.zip` (Apple Silicon and Intel) |

Desktop is the only supported build: there is no npm package or web launcher any more.

## CLI

The desktop app is also the CLI (`Lunarcode ext list|new|pack|unpack|install|enable|disable|remove|path`, `version`, `help`; `lunarcode ext help` for details). The launchers in `resources/app/bin/` (`lunarcode`, `lunarcode.cmd`) run it on the app's own Node runtime, which also works headless and prints to the terminal on Windows. Put one on your `PATH`.

## How it works

1. The window opens a small loading page.
2. If an OpenSol daemon of the same version already runs on `127.0.0.1:4174` it is reused.
   Otherwise the app starts its own daemon on a free port, using Electron's built-in Node
   runtime (`ELECTRON_RUN_AS_NODE`), so no separate Node binary is shipped.
3. The window navigates to the daemon. Links to other sites open in your default browser;
   an MCP sign-in popup stays in its own sandboxed window so the callback can reach the app.
4. When you close the window, a daemon that the app started is stopped. A daemon the app
   reused is left running.

The daemon, `dist/`, `shared/` and `bin/` are copied into the app's
`resources/app` folder at build time. `desktop/electron/` contains the main process and
`desktop/electron-builder.yml` contains the packaging config.

## Build it yourself

Requirements: Node 22.12+ and npm. No Rust or platform webview libraries are needed. Building
the Linux `.rpm` additionally needs `rpmbuild` (`sudo apt-get install rpm` on Debian/Ubuntu).
From the repository root:

```bash
npm ci
npm run build                 # the web app → dist/
cd desktop
npm ci
npm run dist                  # installers for the current OS → desktop/release/
```

Useful variants:

```bash
npm start                     # run the desktop app from source (needs dist/)
npm run pack                  # unpacked app, no installer
npm run dist:linux            # only Linux targets
npm run dist:win              # only Windows targets
npm run dist:mac              # only macOS targets
```

Each OS has to be built on that OS (Windows installers on Windows, macOS on macOS).
`.github/workflows/build.yml` builds Linux, Windows, macOS arm64 and macOS x64 on GitHub
Actions when you push a `v*` tag or run it manually.
