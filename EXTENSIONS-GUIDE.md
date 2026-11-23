# Writing and packaging a `.lce` extension

A `.lce` is simply a **zip file** with `extension.json` at its root plus your files. There is no compile step and no required API: write files, pack, install. Reference: [EXTENSIONS.md](EXTENSIONS.md). Tiếng Việt: [EXTENSIONS.vi.md](EXTENSIONS.vi.md).

## 1. Scaffold

```bash
lunarcode ext new my-ext --template=hello --name="My Ext"
```

Templates: `hello` (command + panel + CSS), `theme` (palette only), `tool` (agent tool backed by Node code in the daemon), `patch` (edit the app's own files), `project` (multi-file layout with `src/`, `server/` and `styles/` folders, for larger extensions). The **New** button in the Extensions panel does the same.

The folder is created under `lunarcode ext path` (default `~/.lunarcode/extensions/my-ext/`). Enable it (`lunarcode ext enable my-ext` or the toggle in the panel) and **every save reloads it live**, so you can write and watch the result before ever packing.

## 2. Layout

```
my-ext/
├── extension.json   required
├── main.js          runs in the app window (ES module)
├── server.mjs       runs in the Node daemon (optional)
├── style.css        optional
└── ...              any file or folder, served at /ext/my-ext/<path>
```

This is the minimal shape. For folders of modules, several stylesheets and a `server/` tree, see [Multi-file projects](#multi-file-projects).

Minimal `extension.json`:

```json
{ "id": "my-ext", "name": "My Ext", "version": "1.0.0", "main": "main.js" }
```

Three files are only the minimum. A bigger extension can be a whole project with folders: see [Multi-file projects](#multi-file-projects) below.

`id` is `a-z 0-9 -` only. Other fields: `server`, `styles`, `themes`, `patches`, `engine` (e.g. `">=4.0.0"`), `icon`, `author`, `description`, `homepage`, `license`, `priority`. Unknown fields are kept. Every file the manifest names (`main`, `server`, `styles`, `icon`, a patch's `file`) must exist in the package, otherwise install fails with a clear error.

## Multi-file projects

An extension is a folder tree, not three files. Start one with `lunarcode ext new my-ext --template=project`, or arrange your own:

```
my-ext/
├── extension.json     "main": "src/main.js", "server": "server/index.mjs",
│                      "styles": ["styles/base.css", "styles/panel.css"], "icon": "assets/icon.svg"
├── src/               window code (ES modules)
│   ├── main.js
│   ├── commands/hello.js
│   ├── ui/panel.js
│   └── lib/format.js
├── server/            daemon code (Node ESM)
│   ├── index.mjs
│   └── handlers/now.mjs
├── styles/            any number of .css files
└── assets/            images, JSON, fonts… served at /ext/my-ext/assets/…
```

Rules:

- **Any path, any depth.** `main`, `server`, every entry of `styles`, `icon`, `themes[].css` and a patch's `file` accept subfolders (`src/main.js`). Paths must be relative: no `..`, no leading `/`, no `C:`.
- **Split code with relative imports**, in the window and in the daemon alike: `import { greeting } from '../lib/format.js'`. Use the full file name with extension. Bare specifiers (`import x from 'react'`) are not resolved in the window: use `lunarcode.React`, or bundle your dependencies into your own files. The daemon can also load npm packages you ship inside the zip.
- **Every `.css` file must be listed in `styles`** (they are loaded in that order). A stylesheet is not picked up just because it sits in the folder. `@import` inside CSS also works for files in the same extension.
- **Live reload covers the whole tree.** Saving any file (even a deep `src/lib/x.js`) reloads the extension and re-evaluates every module, so you never see stale code. This holds for the daemon part too when the daemon is started by the desktop app or the CLI (both use the extension preload).
- **Other files** (images, JSON, wasm, fonts) are reachable at `lunarcode.url('assets/logo.png')`, which resolves to `/ext/<id>/assets/logo.png`. Read them with `fetch`.
- **Packing** (`ext pack`, **Export**, `ext install ./folder`) includes the entire tree. `.git`, `node_modules/.cache` and similar folders are skipped.
- **Build tools are optional.** If you write TypeScript or use a bundler, point `main` at the compiled output and pack that folder.

### Icons

- Extension icon: `"icon"` in `extension.json`. Accepts `.png`, `.svg`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.ico`, `.avif`, shown 40×40 in the Extensions panel.
- Panel and button icons: the `icon` option of `registerPanel(...)` / `registerAction(...)` accepts
  - an image inside the extension: `icon: 'assets/icon.png'` or `'assets/icon.svg'` (resolved to `/ext/<id>/…` automatically);
  - an inline SVG string: `icon: '<svg viewBox="0 0 24 24">…</svg>'` (use `currentColor` to follow the theme);
  - an emoji or up to two characters of text;
  - a `data:image/…` or `https://` image URL.
  - With no icon, a puzzle piece is shown.

## 3. Write code

**App window (`main.js`)**

```js
export default function activate(lunarcode) {
  lunarcode.registerCommand('hi', 'Say hi', () => lunarcode.notify('Hello!', 'success'))
  lunarcode.registerTool({
    name: 'my_tool',                       // the agent sees ext__my-ext__my_tool
    description: '...',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    allowedInMode: () => true,
    async execute() { return { output: 'ok', isError: false } },
  })
}
```

Split it up as it grows:

```js
// src/main.js
import { registerHello } from './commands/hello.js'
export default function activate(lunarcode) { registerHello(lunarcode) }
```

Use `lunarcode.ctx`, `lunarcode.services`, `lunarcode.stores`, `lunarcode.React` or `window.Lunarcode` directly. Anything registered through the context is removed automatically when the extension is disabled or reloaded.

**Daemon (`server.mjs`)**

```js
export default function activate(host) {
  host.rpc('now', () => new Date().toISOString())      // from main.js: await lunarcode.server.call('now')
  host.route('GET', 'ping', () => ({ pong: true }))    // /api/extensions/my-ext/x/ping
  host.on('tool:before', (e) => {})                    // inspect/alter tool calls
  host.emit('changed', {})                             // push to the window
}
```

`server.mjs` can import its own files too (`import { now } from './handlers/now.mjs'`). You get full `fs`, `child_process`, any npm package you bundle in the zip, and `host.app('lib/xxx.mjs')` to import daemon modules.

**Patches (edit files directly, no API)**

```json
"patches": [
  { "scope": "web", "target": "index.html", "find": "</head>", "insertBefore": "<style>/* ... */</style>" },
  { "scope": "web", "target": "assets/index-*.js", "find": { "regex": "foo\\((\\w+)\\)", "flags": "g" }, "replace": "bar($1)" },
  { "scope": "server", "target": "server/daemon.mjs", "find": "const VERSION", "insertBefore": "// patched\n", "optional": true }
]
```

Pick exactly one operation: `replace`, `insertBefore`, `insertAfter`, `append`, `prepend`. Add `all: true` to hit every match, `file: "x.js"` to take the text from a file in the package, and use `{{id}} {{ext}} {{version}}`. `web` patches are applied in memory (reload the page); `server` patches need a daemon restart (Node ≥ 22.15). The panel shows each patch as `applied` or `pattern not found`.

**Themes:** declare them in `themes`; each `tokens` value is an RGB triplet (`"canvas": "18 18 21"`). See `examples/example-theme.lce` for the full token set.

## 4. Pack to `.lce`

CLI (recommended, deterministic output):

```bash
lunarcode ext pack ./my-ext                 # -> my-ext-1.0.0.lce
lunarcode ext pack ./my-ext dist/my-ext.lce # choose the file name
```

Any folder works, even without an `extension.json`: give it a name, version and short description and one is generated (`main.js`, `server.mjs`, top-level `*.css` and `icon.png` are picked up by name):

```bash
lunarcode ext pack ./my-folder --name="My Ext" --version=1.2.0 --desc="Does one thing"   # also: --id, --author
```

With an `extension.json` present, the same flags override its fields.

In the app: Extensions panel → installed extension → **Export**.

By hand: `extension.json` must be **at the zip root** (or inside exactly one wrapping folder, which is unwrapped automatically):

```bash
cd my-ext && zip -r ../my-ext.lce . -x '.git/*'
```

Check it with `lunarcode ext unpack my-ext.lce /tmp/check`. Folders are kept as they are, so a multi-file extension packs exactly the way a three-file one does.

## 5. Install and share

```bash
lunarcode ext install my-ext.lce    # or drag into Extensions → Install .lce
lunarcode ext enable my-ext
```

Installing the same `id` again updates it and keeps its enabled state and its data in `~/.lunarcode/extension-data/my-ext/`. Remove with `lunarcode ext remove my-ext`. To share, send the `.lce`. Recipients must enable it themselves, and enabling means fully trusting its code. Nobody reviews extensions for you, so read an `.lce` (`lunarcode ext unpack`) before you enable one; installing without checking is at your own risk.

## 6. Debugging

- Extensions panel → **Logs** (window and daemon), or `lunarcode logs`.
- Manifest errors show in the list (`ERROR: ...`).
- A file you imported is missing or misspelled (`Failed to fetch dynamically imported module`, `ERR_MODULE_NOT_FOUND`): check the path and that the import includes the `.js` / `.mjs` extension.
- A stylesheet has no effect: make sure it is listed in `"styles"` (or `themes[].css`).
- If `extension.json` has a syntax error the extension won't load; fix and save and it retries.
