# Lunarcode Desktop

Lunarcode is a desktop app: this folder is the Electron shell, the installers and the launcher scripts of the CLI. There is no npm package and no web version. The renderer, daemon and data folder (`~/.lunarcode`) are the ones described in the root [README](../README.md).

> **Disclaimer.** Lunarcode is made by one independent developer, with no review team and no security audit. Check any build, extension, skill or MCP server yourself before installing it. If you install something without checking it carefully, the risk is yours. See the full [disclaimer](../README.md#disclaimer).

## Packages and executables

| OS | Package | Executable |
|---|---|---|
| Windows 10 / 11 | `.exe` (NSIS) | `Lunarcode.exe` |
| macOS 13+ | `.dmg`, `.zip` (Apple Silicon and Intel) | `Lunarcode.app` |
| Linux | `.AppImage`, `.deb`, `.rpm` | `lunarcode` |
| Arch Linux | `.pkg.tar.zst` (built by CI with `makepkg`) | `lunarcode`, `lunarcode-cli` |

Linux and Arch install the app in `/opt/Lunarcode`. On Arch, `sudo pacman -U lunarcode-<version>-1-x86_64.pkg.tar.zst` installs it with a menu entry and icon.

## How it works

1. The window opens a small loading page.
2. If a Lunarcode daemon of the same version already runs on `127.0.0.1:4174` it is reused. Otherwise the app starts its own daemon on a free port, using Electron's built-in Node runtime (`ELECTRON_RUN_AS_NODE`), so no separate Node binary is shipped.
3. The window navigates to the daemon. Links to other sites open in your default browser; an MCP sign-in popup stays in its own sandboxed window so the callback can reach the app.
4. When you close the window, a daemon the app started is stopped. A daemon the app reused is left running.

The daemon (`server/`), `dist/`, `shared/` and `bin/` are copied into the app's `resources/app` folder at build time. `electron/` holds the main process and `electron-builder.yml` the packaging config.

## CLI

The desktop app is also the CLI. It is desktop only: nothing is published to npm.

```bash
lunarcode ext list
lunarcode ext new my-ext --template=hello --name="My Ext"
lunarcode ext pack ./folder --name="My Ext" --version=1.0.0 --desc="Does one thing"
lunarcode ext install my-ext-1.0.0.lce --enable
lunarcode ext help
```

Two ways to run it:

- **Launcher** (recommended): `resources/app/bin/lunarcode` (Linux, macOS) or `lunarcode.cmd` (Windows). It runs `server/cli.mjs` on the app's own Node runtime, so it works without a display and prints to the terminal on Windows. Put it on your `PATH`; the Arch package already installs it as `lunarcode-cli`. Set `LUNARCODE_EXE` to point it at the executable if it cannot find it.
- **The app binary**: `lunarcode ext …` (Linux), `Lunarcode.exe ext …` (Windows, output may not show in the terminal), `Lunarcode.app/Contents/MacOS/Lunarcode ext …` (macOS). When the first argument is `ext`, `version` or `help`, the app runs the CLI and exits without opening a window.

From a checkout: `npm run cli -- ext list`.

## Build it yourself

Requirements: Node 22.12+ and npm. No Rust or platform webview libraries are needed. Building the Linux `.rpm` additionally needs `rpmbuild` (`sudo apt-get install rpm` on Debian/Ubuntu). From the repository root:

```bash
npm ci
npm run build                 # the app → dist/
cd desktop
npm ci
npm run dist                  # installers for the current OS → desktop/release/
```

Useful variants:

```bash
npm start                     # run the desktop app from source (needs dist/)
npm run pack                  # unpacked app, no installer
npm run dist:linux            # only Linux targets (AppImage, deb, rpm)
npm run dist:win              # only Windows targets
npm run dist:mac              # only macOS targets
```

Each OS has to be built on that OS. The Arch package is not built by electron-builder: `.github/workflows/build.yml` builds it with `makepkg` in an Arch container from the unpacked Linux app. The same workflow builds Linux, Windows, macOS arm64 and macOS x64, and creates the release when you push a `v*` tag or run it manually.

## Naming

The product, executables and package are called Lunarcode. A few internal identifiers keep their old names on purpose so existing installs and setups keep working: the app id `dev.opensoft.opensol`, the `OPENSOL_*` environment variables (`OPENSOL_APP_DIR`, `OPENSOL_DEVTOOLS`, `OPENSOL_SHELL`) and the `x-maxcode-csrf` header.
