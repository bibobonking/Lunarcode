# CreateCode extensions (`.cce`)

An extension adds to CreateCode: agent tools, commands, panels, themes, daemon routes and hooks, even patches to the app's own files. Every extension starts in **Sandbox** mode (isolated window code only); the person can mark it **Trusted** for full access (see [Sandbox and Trusted](#sandbox-and-trusted)). CreateCode is made by one independent developer and nothing is reviewed or audited, including the extensions in `examples/`: read an extension's code before you trust it. If you install or trust one without checking, the risk is yours (see the [disclaimer](../README.md#disclaimer)).

## Install and manage

- Extensions panel (top bar / sidebar): **Install .cce**, **New** (templates, including a multi-file project), enable, logs, export, remove.
- CLI (desktop only): `createcode ext list | new <id> [--template=hello|theme|tool|patch] | pack <dir> [out.cce] [--name --version --desc --id --author] | unpack <file> | install <file|dir> | enable <id> | disable <id> | remove <id> | path`. Run it as `CreateCode ext …` on the app binary or with the `createcode` launcher in `resources/app/bin/`.
- Drop-in: put a folder in `~/.createcode/extensions/<id>/` (it reloads live). Data for an extension lives in `~/.createcode/extension-data/<id>/`.

## Layout

```
my-ext.cce  (zip)
├── extension.json
├── main.js          renderer ES module (runs in the app window)
├── server.mjs       daemon module (runs in Node)
├── style.css
└── anything else    served at /ext/<id>/<path>
```

Three files are only the minimum. An extension can be a whole project with any folder structure (`createcode ext new my-ext --template=project`):

```
my-ext/
├── extension.json   "main": "src/main.js", "server": "server/index.mjs", "styles": ["styles/base.css", "styles/panel.css"]
├── src/             window code: ES modules that `import './x.js'` / `'../lib/y.js'` each other
│   ├── main.js
│   ├── commands/…
│   ├── ui/…
│   └── lib/…
├── server/          daemon code: Node ESM, relative imports work the same way
│   ├── index.mjs
│   └── handlers/…
├── styles/          any number of .css files; list each one in "styles"
└── assets/          images, JSON, … served at /ext/<id>/assets/…
```

- Icons: `"icon"` in `extension.json` takes `.png`, `.svg`, `.jpg`, `.webp`, `.gif`, `.ico` or `.avif`. `registerPanel`/`registerAction` `icon` takes an emoji, an `<svg>` string, or the path of an image inside the extension (`"assets/icon.png"`); data: and http(s) image URLs also work.
- `main`, `server`, `styles`, `themes[].css`, `icon` and patch `file` accept any relative path with subfolders (no `..`, no absolute paths).
- Relative imports are served from the extension and carry its version, so saving **any** file reloads the whole module graph live (renderer and daemon alike). Bare specifiers (`import x from 'react'`) are not resolved: use `createcode.React`, or bundle dependencies into your own files.
- `pack`, `install`, Export and the live folder watcher all include the full folder tree. For a build step (TypeScript, a bundler), point `main` at the compiled file and pack the output.

## `extension.json`

```json
{
  "id": "my-ext", "name": "My extension", "version": "1.0.0",
  "description": "", "author": "", "homepage": "", "license": "",
  "icon": "icon.png",
  "engine": ">=4.0.0",
  "main": "main.js",
  "server": "server.mjs",
  "styles": ["style.css"],
  "themes": [{ "id": "night", "label": "Night", "dark": true, "tokens": { "canvas": "18 18 21" }, "css": "theme.css" }],
  "patches": [],
  "priority": 0
}
```

Unknown fields are kept. Only `id` (`[a-z0-9-]`), `name` and `version` are required.

## Renderer (`main`)

Export `activate(createcode)` (and optionally `deactivate`), or just run code at import time and use `globalThis.createcode`. In Trusted mode everything is reachable (in Sandbox only the smaller API above): `createcode.ctx` (Cordis context), `services`, `stores`, `React`, `kernel`, plus helpers:

`registerTool`, `registerCommand`, `registerPanel`, `registerAction`, `registerSettings`, `registerTheme`, `addStyle`, `on`, `dispose`, `notify`, `confirm`, `log`, `url(path)`, `render`, `storage`, `server.call/fetch/on`, `http` (daemon-side fetch, no CORS). `window.CreateCode` exposes the same internals. Anything registered through the context is removed automatically when the extension is disabled or reloaded. Tools are named `ext__<id>__<name>`.

## Daemon (`server`)

```js
export default function activate(host) {
  host.rpc('ping', (data) => ({ pong: data }))           // createcode.server.call('ping', ...)
  host.route('GET', '/hello', (req, res) => res.end('hi')) // /api/extensions/<id>/x/hello
  host.on('tool:before', (e) => { /* inspect or change a tool call */ })
  host.on('llm:before' | 'tool:after' | 'request' | 'ready' | 'shutdown', ...)
  host.emit('changed', {})                                // createcode.server.on('changed', ...)
  host.storage.get/set, host.interval, host.timeout, host.spawn, host.onDispose
  const tools = await host.app('lib/tools.mjs')            // import any daemon module
}
```

## Patches

Edit the app itself. Each patch has `scope` (`web` or `server`), a glob `target` relative to the app root (`dist/index.html`-style web paths such as `index.html` or `assets/index-*.js`; daemon paths such as `server/daemon.mjs`), exactly one operation (`replace`, `insertBefore`, `insertAfter`, `append`, `prepend`), and `find` (string, or `{ "regex": "...", "flags": "g" }`). Extras: `all`, `optional`, `note`, `file` (take the text from a file in the extension), and `{{id}}`, `{{ext}}`, `{{version}}` variables.

- Web patches are applied in memory on each request. Nothing on disk changes; disabling the extension restores the original instantly (a page reload is needed).
- Server patches are applied when the daemon loads a module (Node 22.15+), so they need a restart; the manager shows a banner and a Restart button.
- A patch that no longer matches (the app updated) is reported as `pattern not found` and skipped. It never breaks startup.

## Sandbox and Trusted

Each extension has a mode, stored in `~/.createcode/extensions/state.json` (`trust`). New, dropped-in and updated extensions are in **Sandbox**.

**Sandbox**
- `main` runs in an `<iframe sandbox="allow-scripts">` served by the daemon (`GET /api/extensions/<id>/sandbox`) with `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; connect-src 'none'; …`. The page has an opaque origin: no access to the app's DOM, stores, cookies or storage, no network, no `eval`, no workers. The extension's modules are inlined (relative imports are resolved at build time).
- The window talks to it by `postMessage` only (`src/extensions/sandbox.ts`). Messages are validated and size-capped. Available: `registerTool/Command/Action/Panel/Settings/Theme`, `addStyle`, `notify`, `confirm`, `storage` (1 MB), `asset`, `emit/on`, `log`, `dispose`. Tools return text only. Panels and settings blocks are their own sandboxed frames (they run `main` again with the role `panel` or `settings`).
- Stylesheets and theme CSS are sanitised: remote `@import`/`url()` removed. Icons are emoji, extension images or `data:image/…`; no inline SVG markup.
- `server` code does not start, patches (web and server) are not applied, and the page CSP is not relaxed.
- Reading `createcode.ctx`, `services`, `stores`, `React`, `kernel`, `server`, `http`, `url`, … throws and records an anomaly.

**Trusted**
- Everything described in the sections below: the live `createcode` object, daemon code with full Node access, patches. While at least one Trusted extension is enabled the page CSP is relaxed.

**Changing mode**
- UI: Extensions → the extension → Security → **Mark as Trusted…** (scan findings, last warning, type-the-id when the scan is high or anomalies exist) / **Back to sandbox**.
- CLI: `createcode ext trust <id> --yes`, `createcode ext sandbox <id>`.
- HTTP: `PUT /api/extensions/<id>/trust` with `{ "trust": "trusted", "confirm": "<id>" }` (or `"sandbox"`).
- Installing a new package over an existing extension resets it to Sandbox (`trustRevoked: "updated"` is shown in its card).

**Detection**
- *Static scan* (`shared/ext-scan.mjs`): line-based rules for commands, `eval`, secrets and credential files, provider keys, network, file writes, environment, cookies and storage, key listeners, clipboard, obfuscation, minified code, remote CSS, plus the manifest itself (`server`, patches; server patches on sensitive files are *high*). Results are `low`, `medium`, `high` and shown before trusting. It is a hint, not proof.
- *Runtime anomalies*: blocked network or privileged-API attempts, CSP violations, invalid registrations and flooding are recorded (`anomalies` in the extension listing, `POST /api/extensions/<id>/anomaly`). More than 600 messages in a second suspends the extension.

## Security note

Trusted extensions run with the privileges of the app and the daemon. Sandbox narrows what window code can reach, but it is not an audit: install only what you are willing to read. Enabled Trusted extensions relax the page CSP.
