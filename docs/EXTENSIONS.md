# Lunarcode extensions (`.lce`)

An extension changes Lunarcode directly. There is no permission model and no API version to stay inside: it can run code in the app window, run Node code in the daemon, and rewrite the app's own files with patches. Enabling an extension is a full-trust decision, the same as installing a userscript or a game mod.

## Install and manage

- Extensions panel (top bar / sidebar): **Install .lce**, **New** (templates), enable, logs, export, remove.
- CLI (desktop only): `lunarcode ext list | new <id> [--template=hello|theme|tool|patch] | pack <dir> [out.lce] [--name --version --desc --id --author] | unpack <file> | install <file|dir> | enable <id> | disable <id> | remove <id> | path`. Run it as `Lunarcode ext …` on the app binary or with the `lunarcode` launcher in `resources/app/bin/`.
- Drop-in: put a folder in `~/.lunarcode/extensions/<id>/` (it reloads live). Data for an extension lives in `~/.lunarcode/extension-data/<id>/`.

## Layout

```
my-ext.lce  (zip)
├── extension.json
├── main.js          renderer ES module (runs in the app window)
├── server.mjs       daemon module (runs in Node)
├── style.css
└── anything else    served at /ext/<id>/<path>
```

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

Export `activate(lunarcode)` (and optionally `deactivate`), or just run code at import time and use `globalThis.lunarcode`. Everything is reachable: `lunarcode.ctx` (Cordis context), `services`, `stores`, `React`, `kernel`, plus helpers:

`registerTool`, `registerCommand`, `registerPanel`, `registerAction`, `registerSettings`, `registerTheme`, `addStyle`, `on`, `dispose`, `notify`, `confirm`, `log`, `url(path)`, `render`, `storage`, `server.call/fetch/on`, `http` (daemon-side fetch, no CORS). `window.Lunarcode` exposes the same internals. Anything registered through the context is removed automatically when the extension is disabled or reloaded. Tools are named `ext__<id>__<name>`.

## Daemon (`server`)

```js
export default function activate(host) {
  host.rpc('ping', (data) => ({ pong: data }))           // lunarcode.server.call('ping', ...)
  host.route('GET', '/hello', (req, res) => res.end('hi')) // /api/extensions/<id>/x/hello
  host.on('tool:before', (e) => { /* inspect or change a tool call */ })
  host.on('llm:before' | 'tool:after' | 'request' | 'ready' | 'shutdown', ...)
  host.emit('changed', {})                                // lunarcode.server.on('changed', ...)
  host.storage.get/set, host.interval, host.timeout, host.spawn, host.onDispose
  const tools = await host.app('lib/tools.mjs')            // import any daemon module
}
```

## Patches

Edit the app itself. Each patch has `scope` (`web` or `server`), a glob `target` relative to the app root (`dist/index.html`-style web paths such as `index.html` or `assets/index-*.js`; daemon paths such as `server/daemon.mjs`), exactly one operation (`replace`, `insertBefore`, `insertAfter`, `append`, `prepend`), and `find` (string, or `{ "regex": "...", "flags": "g" }`). Extras: `all`, `optional`, `note`, `file` (take the text from a file in the extension), and `{{id}}`, `{{ext}}`, `{{version}}` variables.

- Web patches are applied in memory on each request. Nothing on disk changes; disabling the extension restores the original instantly (a page reload is needed).
- Server patches are applied when the daemon loads a module (Node 22.15+), so they need a restart; the manager shows a banner and a Restart button.
- A patch that no longer matches (the app updated) is reported as `pattern not found` and skipped. It never breaks startup.

## Security note

Enabled extensions run with the privileges of the app and the daemon, and while any extension is enabled the page CSP is relaxed. Install only what you trust.
