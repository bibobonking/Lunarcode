# Build a CreateCode extension

A `.cce` extension is a **zip file** with an `extension.json` at its root plus your files. No compile step, no account, no approval. Write files, pack, share. This guide walks you through it; the exact reference is in [docs/EXTENSIONS.md](docs/EXTENSIONS.md).

## Build something nobody else would

CreateCode ships a small core on purpose. Everything that makes it *yours* is an extension, and the best extensions are the unusual ones. Skip the clone of a feature that already exists elsewhere and build the odd, specific thing you wish the app did:

- a tool that gives the agent one new superpower (query your company's API, read a niche file format, talk to a gadget on your desk)
- a panel for how *you* work: a scratchpad, a timer, a changelog writer, a bug board, a mood tracker
- a command for a habit you repeat ten times a day
- a theme nobody else would dare ship
- a daemon route or hook that makes the app behave the way your team needs
- a patch that fixes the one thing that annoys you

If it is small, strange and useful to even one person, it is a good extension. Share it.

## 1. Your first extension in five minutes

```bash
createcode ext new my-ext --template=hello --name="My Ext"
createcode ext enable my-ext
```

(Or press **New** in the Extensions panel.) The folder appears under `createcode ext path` (default `~/.createcode/extensions/my-ext/`). Open `main.js`, change the text, save: the extension **reloads live**, so you see the result without packing anything.

Templates:

| Template | What you get | Runs in the sandbox? |
|---|---|---|
| `hello` | a command, a panel and a stylesheet | yes |
| `theme` | a colour palette only | yes |
| `tool` | an agent tool backed by Node code in the daemon | needs **Trusted** |
| `patch` | edits to the app's own files | needs **Trusted** |
| `project` | multi-file layout: `src/`, `server/`, `styles/` | partly (the daemon part needs **Trusted**) |

## 2. Sandbox and Trusted: the one idea to understand

Every extension starts in **Sandbox** mode. You can enable it right away and it works, but with limits. When you (or the person who installs your extension) decide to trust it, it becomes **Trusted** and gets full power.

| | Sandbox (default) | Trusted |
|---|---|---|
| Window code (`main`) | isolated iframe, small API | inside the app, live kernel |
| Network | none | anything |
| Chats, files, provider keys | not reachable | reachable |
| Daemon code (`server`) | **does not run** | full Node access |
| Patches | **do not run** | apply to the app and daemon |
| Tools, commands, actions, panels, settings, themes, styles | yes | yes |
| Storage (JSON) and bundled assets | yes (1 MB) | yes |

**Write for the sandbox first.** Most good ideas (a command, a panel, a tool that returns text, a theme) need nothing more, and an extension that works in the sandbox is one people can try without worrying. Ask for Trusted only when you really need the network, the daemon or the app's internals, and **say so in your description** ("needs Trusted: calls the GitHub API from the daemon").

How a person trusts an extension: Extensions → open it → **Security → Mark as Trusted**. They see a scan of your code and a last warning first. If the scan finds something serious (running commands, `eval`, credential paths, heavy obfuscation) they must also type your extension's id. In a terminal: `createcode ext trust my-ext --yes`. Putting it back: **Back to sandbox** or `createcode ext sandbox my-ext`.

Things to know:

- **Updating puts it back in the sandbox.** Installing a new `.cce` of an extension that was Trusted drops it to Sandbox until the person trusts it again. Plan for that.
- **Blocked attempts are recorded.** In the sandbox, trying the network, `createcode.ctx` or other privileged things is blocked, shown in the extension's card and, if you flood the bridge, the extension is suspended. Do not probe the walls: it looks exactly like malware.
- **The scan is a hint, not a verdict.** Clean readable code gets a quiet scan. Minified code, `eval` and giant encoded strings get loud warnings, so ship readable source.

## 3. Layout

```
my-ext/
├── extension.json   required
├── main.js          window code (ES module)
├── server.mjs       daemon code (optional, needs Trusted)
├── style.css        optional
└── ...              any file or folder
```

Minimal `extension.json`:

```json
{ "id": "my-ext", "name": "My Ext", "version": "1.0.0", "main": "main.js" }
```

`id` is `a-z 0-9 -` only. Other fields: `description`, `author`, `icon`, `server`, `styles`, `themes`, `patches`, `engine` (for example `">=4.0.0"`), `homepage`, `license`, `priority`. Unknown fields are kept. Every file the manifest names must exist in the package, or install fails with a clear error.

## 4. Window code (`main.js`)

Export `activate(createcode)`. This works in **both** modes; the sandbox simply gives you the smaller `createcode` object listed below.

```js
export default function activate(createcode) {
  // A command in the command palette
  createcode.registerCommand('hi', 'Say hi', () => createcode.notify('Hello!', 'success'))

  // A tool the agent can call (it sees ext__my-ext__word_count)
  createcode.registerTool({
    name: 'word_count',
    description: 'Count the words in a text.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async execute({ text }) {
      return { output: String(text.trim().split(/\s+/).length), isError: false }
    },
  })

  // A side panel (plain DOM; bundle your own library if you want components)
  createcode.registerPanel('notes', 'Notes', (host) => {
    host.innerHTML = '<textarea style="width:100%;height:200px"></textarea>'
    const box = host.querySelector('textarea')
    createcode.storage.get('text', '').then((value) => (box.value = value))
    box.addEventListener('input', () => createcode.storage.set('text', box.value))
  }, { icon: '📝' })
}
```

### What `createcode` offers in Sandbox mode

| Call | What it does |
|---|---|
| `registerCommand(id, label, run, { hint })` | command palette entry |
| `registerAction(id, { label, icon, run, placement })` | button in the top bar or sidebar (`placement: 'topbar' \| 'sidebar'`) |
| `registerTool({ name, description, parameters, execute, approval, allowedInMode })` | agent tool; returns `{ output, isError }` (text only) |
| `registerPanel(id, label, render(host), { icon })` | side panel; `host` is an element in your own page |
| `registerSettings(label, render(host))` | block in your extension's card; grows with its content |
| `registerTheme(id, label, palette, { dark })` | colour theme (RGB triplets such as `"18 18 21"`) |
| `addStyle(css)` | adds CSS (to the app from `main`, to your panel from inside a panel) |
| `notify(message, 'info' \| 'success' \| 'error')` | toast |
| `confirm({ title, body, confirmLabel, tone })` | yes/no dialog, returns a promise |
| `storage.get/set/delete/all` | JSON storage for your extension, 1 MB |
| `asset(path)` | promise of a `blob:` URL for a file in your package (image, font) |
| `emit(name, data)` / `on(name, fn)` | talk between your panels and your `main` |
| `log(...)` | shows in the extension's logs |
| `dispose(fn)` | run `fn` when the extension stops |
| `id`, `manifest`, `appVersion`, `sandbox` | facts about the extension and app |

Good to know in the sandbox:

- Your window code runs **in more than one page**: once for the background logic and once per open panel or settings block. Keep top-level code free of side effects you do not want twice; do the real work inside commands, tools and `render`.
- **Styles in `extension.json`** apply to the app and are also loaded into your own panels. Remote `@import` and remote `url()` are removed; use `data:` images or `await createcode.asset('img/a.png')`.
- **Icons** may be an emoji or up to four characters, a file in your package (`assets/icon.png`, `assets/icon.svg`) or a `data:image/…` URL. Inline `<svg …>` strings and `https:` images are not accepted: put the SVG in a file.
- **Panels look like the app** automatically: the theme's colours are available as CSS variables (`rgb(var(--ink))`, `rgb(var(--panel))`, `rgb(var(--accent))`, …).
- There is **no `eval`, no network and no `localStorage`**. Use `storage`.
- Anything outside the table (`createcode.ctx`, `stores`, `React`, `server`, `http`, …) throws with a message telling the person to trust the extension.

### Extra power when Trusted

A Trusted extension gets the whole thing: `createcode.ctx` (the Cordis context), `services`, `stores`, `React`, `kernel`, `url(path)`, `render`, `server.call/fetch/on` (talk to your daemon code), `http` (a daemon-side fetch without CORS), and `window.CreateCode`. Anything registered through the context is removed automatically when the extension is disabled or reloaded.

## 5. Daemon code (`server.mjs`, Trusted only)

```js
export default function activate(host) {
  host.rpc('now', () => new Date().toISOString())      // window: await createcode.server.call('now')
  host.route('GET', 'ping', () => ({ pong: true }))    // /api/extensions/my-ext/x/ping
  host.on('tool:before', (event) => {})                // inspect or change tool calls
  host.emit('changed', {})                             // push to the window
}
```

You get full `fs`, `child_process`, npm packages you bundle in the zip, and `host.app('lib/xxx.mjs')` to import daemon modules. This is the most powerful part and the most scrutinised: people reading the scan will look at it first. Keep it small and obvious.

## 6. Patches (Trusted only)

Edit the app's own files, no API needed:

```json
"patches": [
  { "scope": "web", "target": "index.html", "find": "</head>", "insertBefore": "<style>/* ... */</style>" },
  { "scope": "web", "target": "assets/index-*.js", "find": { "regex": "foo\\((\\w+)\\)", "flags": "g" }, "replace": "bar($1)" },
  { "scope": "server", "target": "server/daemon.mjs", "find": "const VERSION", "insertBefore": "// patched\n", "optional": true }
]
```

Pick exactly one operation: `replace`, `insertBefore`, `insertAfter`, `append`, `prepend`. Add `all: true` to hit every match, `file: "x.js"` to take the text from a file in the package, and use `{{id}} {{ext}} {{version}}`. `web` patches apply in memory (reload the page); `server` patches need a daemon restart. The panel shows each patch as `applied` or `pattern not found`; a patch that stops matching after an app update is skipped, never fatal. Server patches that touch sensitive daemon files raise the scan to **high**.

## 7. Themes and styles

Declare themes in `themes`; each `tokens` value is an RGB triplet (`"canvas": "18 18 21"`). `examples/example-theme.cce` has the full token set. Stylesheets must be listed in `styles` (in load order): a `.css` file is not picked up just because it sits in the folder.

## 8. Bigger projects

An extension is a folder tree, not three files. `createcode ext new my-ext --template=project`, or arrange your own:

```
my-ext/
├── extension.json     "main": "src/main.js", "server": "server/index.mjs",
│                      "styles": ["styles/base.css", "styles/panel.css"], "icon": "assets/icon.svg"
├── src/               window code
│   ├── main.js
│   ├── commands/hello.js
│   └── lib/format.js
├── server/            daemon code (Trusted)
├── styles/
└── assets/
```

- **Any path, any depth** for `main`, `server`, `styles`, `icon`, `themes[].css` and a patch's `file`. Paths are relative: no `..`, no leading `/`.
- **Split code with relative imports** and always write the file extension: `import { greeting } from '../lib/format.js'`. Bare specifiers (`import x from 'react'`) are not resolved in the window: bundle your dependencies into your own files. (The daemon can load npm packages you ship in the zip.)
- **Live reload covers the whole tree**: saving any file reloads the extension.
- **Build tools are optional.** If you use TypeScript or a bundler, point `main` at the compiled output.

## 9. Pack and share

```bash
createcode ext pack ./my-ext                  # -> my-ext-1.0.0.cce
createcode ext pack ./my-ext dist/my-ext.cce  # choose the file name
createcode ext pack ./folder --name="My Ext" --version=1.2.0 --desc="Does one thing"   # no extension.json needed
```

Or Extensions panel → installed extension → **Export**. By hand, `extension.json` must be at the zip root: `cd my-ext && zip -r ../my-ext.cce . -x '.git/*'`. Check any `.cce` with `createcode ext unpack my-ext.cce /tmp/check`.

Install with `createcode ext install my-ext.cce` or drag it into **Extensions → Install .cce**. It lands **disabled and in the sandbox**. Installing the same `id` again updates it, keeps its enabled state and its data in `~/.createcode/extension-data/my-ext/`, and sends it back to the sandbox.

When you share, tell people: what it does, whether it needs Trusted and why, and where the source is. Recipients should read an `.cce` before trusting it; nobody reviews extensions for them.

## 10. Debugging

- Extensions panel → **Logs** (window and daemon), or `createcode logs`.
- Manifest errors show in the list (`ERROR: ...`). Fix, save, and it retries.
- **"Blocked while sandboxed" in the card** means your code tried something the sandbox forbids (network, `createcode.ctx`, a popup). Either drop it or tell people the extension needs Trusted.
- **Daemon or patches seem dead:** they only run when Trusted. The card says "off in sandbox".
- **Suspended in Sandbox mode:** the bridge was flooded with messages. Slow down loops that call `notify`, `storage` or `emit`.
- **A panel is blank:** open Logs. A thrown error in `render` shows there. Remember the panel page is separate from `main`.
- **`Failed to fetch dynamically imported module` / `ERR_MODULE_NOT_FOUND`:** wrong path, or the import is missing its `.js` / `.mjs`.
- **A stylesheet has no effect:** it must be listed in `"styles"` (or `themes[].css`).

## 11. Before you share it

- [ ] Works in the sandbox, or says clearly that it needs Trusted and why
- [ ] Readable source: no minified bundles you cannot explain
- [ ] No hidden network calls, no reading files you do not need
- [ ] `description` says what it does in one sentence
- [ ] Version bumped, `.cce` packed and tested with a fresh install

Now go build the strange thing.
