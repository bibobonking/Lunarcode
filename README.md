# Lunarcode

A local-first AI coding agent by OpenSoftX. Lunarcode pairs a warm React chat interface with a zero-dependency Node daemon that owns the real workspace, shell, git, search, deploy and provider credentials on your machine.

The daemon binds to `127.0.0.1` only. It serves the prebuilt app from `dist/` and stores everything under `~/.lunarcode`. API keys and hosting tokens are encrypted with AES-256-GCM using a local `master.key`; the app window only ever receives a masked hint.

## Disclaimer

Lunarcode is made by **one independent developer**. There is no review team, no security audit and no vetting of releases, builds or extensions (this includes `examples/*.lce` and any `.lce`, skill or MCP server you download). Read the code and check anything you install yourself. The agent can edit files and run commands on your machine, so review what it does too.

If you install or enable something without checking it carefully, **you do so at your own risk** and you are responsible for what it does. The software is provided “as is”, without warranty of any kind, under the MIT license.


## Install

Lunarcode is a **desktop app**. There is no npm package and no web version. Download an installer from the releases page, or build it yourself (see [desktop/README.md](desktop/README.md)).

| OS | Package | Executable |
|---|---|---|
| Windows 10 / 11 | `.exe` (NSIS) | `Lunarcode.exe` |
| macOS 13+ | `.dmg`, `.zip` (Apple Silicon and Intel) | `Lunarcode.app` |
| Linux | `.AppImage`, `.deb`, `.rpm` | `lunarcode` |
| Arch Linux | `.pkg.tar.zst` (`sudo pacman -U <file>`) | `lunarcode`, `lunarcode-cli` |

The app starts its own daemon, so there is nothing to launch by hand.

**CLI (desktop only).** `lunarcode ext …` through the launcher in `resources/app/bin/` (`lunarcode`, `lunarcode.cmd`; the Arch package installs it as `lunarcode-cli`), or `<executable> ext …` on the app binary. Commands: `ext list|new|pack|unpack|install|enable|disable|remove|path`, `version`, `help`.

On first launch, choose a real project folder, then add a provider key in **Settings → Models** and pick a live model. Everything else — workspace tree, editor, git, search, build/plan modes, subagents and deploys — runs through the local daemon.

See *Shell* below for how commands run on each OS.

## What is in the app

- **Build and Plan modes.** Build can edit files and run commands; Plan is read-only investigation.
- **Live models and reasoning.** Model lists come from each provider; the models.dev catalog is only a fallback. Thinking is the provider's job: an effort control appears only when the selected model advertises effort levels or a token budget, and it is sent automatically.
- **Themes.** Light, Lunar and Dark, plus extension themes. Syntax highlighting follows the theme.
- **Real tools.** Read/write/edit files, grep, list files, shell, git, web search, URL reading, skills and read-only subagents. Each user turn renders as one answer, with consecutive tool rounds collapsed into a single “Used N tools” group.
- **New composer.** A compact box: the project folder sits above it, **+** adds files, toggles web search and Plan mode, opens MCP and switches skills. Permissions and effort are plain text at the bottom left (a panel opens on click); the model name is at the bottom right and opens the Model Deck (`Ctrl/⌘ M`).
- **MCP that keeps up.** Tools a server opens mid-session (10 → 100 after creating a project) reach the agent immediately without stopping the turn; dropped servers reconnect by themselves; Streamable HTTP and legacy SSE URLs fall back to each other automatically.
- **Ask Question.** The agent can ask several multiple-choice questions at once (single or multi-select, a comment under each option, a free-text field on every question).
- **Shell.** The `shell` tool runs in your default shell: bash/zsh (login shell) on Linux and macOS, PowerShell 7 or Windows PowerShell on Windows (`cmd` as a last resort). The agent is told which one in its system prompt. Override with `OPENSOL_SHELL=/path/to/shell` (the variable keeps its old name). Plan mode accepts only read-only commands in the matching syntax.
- **Smart compaction.** Near 85% of the context window (checked before a turn and between tool rounds), older turns are summarised while the newest ones stay verbatim. Earlier summaries are merged, not re-summarised; changed files are tracked from tool calls; if the model is unavailable a deterministic fallback keeps the session going. Run `/compact [focus]` to do it yourself.
- **Subagents.** `subagent` delegates read-only work to a separate context: `explore` (codebase), `research` (web + code) and `review` (bugs in a diff). Several calls in one message run in parallel, progress streams into the tool card, and each has a round budget and context pruning.
- **Turn queue.** A prompt sent while a turn is streaming waits its turn and runs next, instead of splitting into a second reply.
- **Extensions (`.lce`).** No API, no sandbox, no limits: an extension is a zip with an `extension.json` and any mix of renderer code, daemon code and direct find/replace patches to the app itself, like a userscript or a BepInEx mod. Add agent tools, panels, commands, themes, HTTP routes and hooks, or rewrite any file of the UI or daemon. Install from the Extensions panel or `lunarcode ext install my.lce`; create one from a template with `lunarcode ext new`; pack any folder with `lunarcode ext pack <folder> --name=… --version=… --desc=…`. Live reload while you edit. Enabling an extension is a full-trust decision. See [docs/EXTENSIONS.md](docs/EXTENSIONS.md) and the ready-made `examples/*.lce`.
- **Workspace panel.** Folder tree, file editor, git status and quick file actions.
- **Deploy.** Cloudflare Pages, Netlify and Vercel, for the open workspace or another existing folder. Tokens stay in the daemon and are passed to CLIs through environment variables.
- **Local history.** Conversations, settings, workspaces and encrypted keys survive restarts.

Slash commands: `/search`, `/plan`, `/build`, `/compact`, `/new`, `/workspace`, `/deploy`, `/settings` and `/clear`.

## Development

```bash
npm install
npm run daemon     # daemon on 127.0.0.1:4174 (terminal 1)
npm run dev        # Vite on http://127.0.0.1:5173, proxies /api to the daemon (terminal 2)
npm run build      # typecheck + production build into dist/
npm run typecheck
npm run desktop    # the Electron app from source (needs dist/ and `npm ci` in desktop/)
npm run cli -- ext list   # the CLI from a checkout
```

Remote models need provider access from this machine. Local providers such as Ollama are keyless but must already be running; Lunarcode reports an actionable error when they are not.

OpenCode free-tier models only work inside OpenCode itself, so they are hidden here. Paid OpenCode models work with an API key. Deploys require the matching CLI (`wrangler`, `netlify` or `vercel`) or `npx`, plus credentials in **Settings → Deploy**.

## Data and security

- Data directory: `~/.lunarcode` (override with `LUNARCODE_DATA`; an existing `~/.opensol` or `~/.maxcode` is renamed automatically).
- `secrets.enc` and `master.key` are created with mode `600`.
- All API routes require the local session cookie and a CSRF header; Host and Origin are checked.
- The daemon rejects code execution outside the selected workspace except for an explicit, existing deploy folder.
- No telemetry or OpenSoftX-hosted proxy. Provider requests go directly from the daemon to the provider you configured.

## Stack

TypeScript, React 19, Vite, Tailwind CSS, Zustand, direct provider adapters (OpenAI, Anthropic, Gemini, OpenCode and OpenAI-compatible endpoints), and a Node HTTP daemon with no runtime dependencies.

```
src/        React app, Cordis kernel (src/core), stores, adapters and UI
server/     local daemon, encrypted store, workspace tools, shell, MCP and deploy
desktop/    Electron app, installers and the launcher scripts of the CLI
shared/     .lce archive format and patch engine used by both sides
dist/       production build served by the daemon
```
