# CreateCode

A local-first AI coding agent by Bibobonking, built on the Linux way of thinking:

> *I build the core. You build what's missing, with extensions.*

**CreateCode follows the Linux model: I build the core, and you build everything else with extensions.** Missing a tool, a panel, a command, a theme, a whole workflow? Don't wait for me. Make an extension, and make it something only you would think of. Every feature you build is a feature the app didn't have yesterday, and you can share it as a single `.cce` file. Start with the [extension guide](EXTENSIONS-GUIDE.md).

CreateCode pairs a React chat interface with a small Node daemon that owns the real workspace, shell, git, search, deploys and provider keys on your machine. It is a desktop app: there is no web version and no npm package.

## Contents

- [Install](#install)
- [First steps](#first-steps)
- [What is in the app](#what-is-in-the-app)
- [Extensions](#extensions)
- [Data and security](#data-and-security)
- [Disclaimer](#disclaimer)
- [Development](#development)
- [Stack](#stack)

## Install

Download an installer from the releases page, or build it yourself (see [desktop/README.md](desktop/README.md)). The app starts its own daemon, so there is nothing to launch by hand.

| OS | Package | Executable |
|---|---|---|
| Windows 10 / 11 | `.exe` (NSIS) | `CreateCode.exe` |
| macOS 13+ | `.dmg`, `.zip` (Apple Silicon and Intel) | `CreateCode.app` |
| Linux | `.AppImage`, `.deb`, `.rpm` | `createcode` |
| Arch Linux | `.pkg.tar.zst` (`sudo pacman -U <file>`) | `createcode`, `createcode-cli` |

**CLI.** The desktop build includes a launcher in `resources/app/bin/` (`createcode`, `createcode.cmd`; the Arch package installs it as `createcode-cli`). You can also run `<executable> ext …` on the app binary. Commands: `ext list|new|pack|unpack|install|enable|disable|trust|sandbox|remove|path`, `version`, `help`.

## First steps

1. Open CreateCode and choose a real project folder.
2. Add a provider key in **Settings → Models** and pick a live model.
3. Chat. Everything else (workspace tree, editor, git, search, Build/Plan modes, subagents, deploys) runs through the local daemon.

## What is in the app

**Agent**
- **Build and Plan modes.** Build can edit files and run commands; Plan is read-only investigation.
- **Real tools.** Read/write/edit files, grep, list files, shell, git, web search, URL reading, skills and read-only subagents. Each user turn renders as one answer, with consecutive tool rounds collapsed into a single "Used N tools" group.
- **Subagents.** `subagent` delegates read-only work to a separate context: `explore` (codebase), `research` (web + code) and `review` (bugs in a diff). Several calls in one message run in parallel and stream progress into the tool card.
- **Ask Question.** The agent can ask several multiple-choice questions at once (single or multi-select, a comment under each option, a free-text field on every question).
- **Smart compaction.** Near 85% of the context window, older turns are summarised while the newest stay verbatim; earlier summaries are merged, not re-summarised. Run `/compact [focus]` to do it yourself.
- **Turn queue.** A prompt sent while a turn is streaming waits and runs next, instead of splitting into a second reply.

**Models and MCP**
- **Live models and reasoning.** Model lists come from each provider; the models.dev catalog is only a fallback. An effort control appears only when the selected model advertises effort levels or a token budget.
- **MCP that keeps up.** Tools a server opens mid-session reach the agent immediately; dropped servers reconnect by themselves; Streamable HTTP and legacy SSE URLs fall back to each other.

**Interface**
- **Themes.** Adwaita Light and Dark, an optional Liquid Glass style, plus extension themes.
- **Composer.** The project folder sits above the box; **+** adds files, toggles web search and Plan mode, opens MCP and switches skills. Permissions and effort are at the bottom left, the model picker (`Ctrl/⌘ M`) at the bottom right.
- **Workspace panel.** Folder tree, file editor, git status and quick file actions.
- **Local history.** Conversations, settings, workspaces and encrypted keys survive restarts.

**Shell.** The `shell` tool runs in your default shell: bash/zsh (login shell) on Linux and macOS, PowerShell 7 or Windows PowerShell on Windows (`cmd` as a last resort). Override with `CREATECODE_SHELL=/path/to/shell`. Plan mode accepts only read-only commands in the matching syntax.

**Deploy.** Cloudflare Pages, Netlify and Vercel, for the open workspace or another existing folder. Tokens stay in the daemon and are passed to the CLIs through environment variables.

Slash commands: `/search`, `/plan`, `/build`, `/compact`, `/new`, `/workspace`, `/deploy`, `/settings` and `/clear`.

## Extensions

CreateCode does not try to ship every feature. There is a core, and you build the rest.

- **The core is mine.** The agent loop, providers, workspace tools, MCP, deploys, encrypted key storage and the interface.
- **What is missing is yours.** A tool for the agent, a panel, a command, a theme, a daemon route, a patch to the app itself: write a `.cce` extension. No fork, no waiting.
- **Unique ideas welcome.** Like Linux, the core stays small on purpose and the community fills the rest. The best extensions are the ones nobody else thought of: build the odd, specific thing you wish the app did, then share it so others can build on it.

An extension is a zip with an `extension.json`, plus any mix of window code, daemon code and patches. Install from the Extensions panel or `createcode ext install my.cce`; live reload while you edit.

### Sandbox first, Trusted when you decide

Freedom without blind trust:

| | **Sandbox** (default for every new extension) | **Trusted** (you chose it) |
|---|---|---|
| Window code | Runs in an isolated iframe with a small message API | Runs inside the app with the live kernel, stores and React |
| Network | None | Anything |
| Your chats, files, keys | Not reachable | Reachable |
| Daemon code (`server`) | Does not run | Runs with full Node access |
| Patches | Do not run | Apply to the app and daemon |
| Tools, commands, panels, themes, storage | Yes (through the bridge) | Yes |

- Every extension is **scanned** for suspicious code (running commands, `eval`, credential paths, obfuscation, network calls) and the result is shown before you trust it.
- While sandboxed, any attempt to break out (network, privileged API, flooding) is **blocked and recorded**; a flood suspends the extension.
- **Mark as Trusted** (Extensions → the extension → Security, or `createcode ext trust <id> --yes`) shows the findings and a last warning first. Serious findings make you type the extension's id.
- Updating an extension from a `.cce` puts it back in the sandbox until you trust it again.

Sandbox is a real boundary for window code (opaque origin, CSP, no network), but nobody audits it: read the code of what you install, and trust only what you need to. See [docs/EXTENSIONS.md](docs/EXTENSIONS.md#sandbox-and-trusted).

### Make your first extension

```bash
createcode ext new my-ext        # create it from a template
createcode ext enable my-ext     # turn it on; it reloads every time you save
createcode ext path              # where the extension folders live
createcode ext pack <folder>     # pack it into a .cce to share
```

You can also press **New** in the Extensions panel. Start with the [extension guide](EXTENSIONS-GUIDE.md), then the [reference](docs/EXTENSIONS.md) and the samples in `examples/`.

## Data and security

- Data directory: `~/.createcode` (override with `CREATECODE_DATA`).
- API keys and hosting tokens are encrypted with AES-256-GCM using a local `master.key`; `secrets.enc` and `master.key` are created with mode `600`. The app window only ever receives a masked hint.
- The daemon binds to `127.0.0.1` only. Every API route needs the local session cookie and a CSRF header; Host and Origin are checked.
- The daemon rejects code execution outside the selected workspace, except for an explicit, existing deploy folder.
- Extensions run in the sandbox until you trust them (see [Extensions](#extensions)). The page's CSP is relaxed only while a **Trusted** extension is enabled.
- No telemetry and no hosted proxy. Provider requests go straight from the daemon to the provider you configured.

## Disclaimer

CreateCode is made by **one independent developer**. There is no review team, no security audit and no vetting of releases, builds or extensions (this includes `examples/*.cce` and any `.cce`, skill or MCP server you download). Read the code and check anything you install yourself. The agent can edit files and run commands on your machine, so review what it does too.

If you install, enable or trust something without checking it carefully, **you do so at your own risk** and you are responsible for what it does. The software is provided "as is", without warranty of any kind, under the MIT license.

## Development

```bash
npm install
npm run daemon     # daemon on 127.0.0.1:4174 (terminal 1)
npm run dev        # Vite on http://127.0.0.1:5173, proxies /api to the daemon (terminal 2)
npm run build      # typecheck + production build into dist/
npm run typecheck
npm test
npm run desktop    # the Electron app from source (needs dist/ and `npm ci` in desktop/)
npm run cli -- ext list   # the CLI from a checkout
```

Remote models need provider access from this machine. Local providers such as Ollama are keyless but must already be running. OpenCode free-tier models only work inside OpenCode itself, so they are hidden; paid OpenCode models work with an API key. Deploys need the matching CLI (`wrangler`, `netlify` or `vercel`) or `npx`, plus credentials in **Settings → Deploy**.

## Stack

TypeScript, React 19, Vite, Tailwind CSS, Zustand, direct provider adapters (OpenAI, Anthropic, Gemini, OpenCode and OpenAI-compatible endpoints) and a Node HTTP daemon with no runtime dependencies.

```
src/        React app, Cordis kernel (src/core), stores, adapters, UI, extension runtime and sandbox bridge
server/     daemon, encrypted store, workspace tools, shell, MCP, deploy, extension host and sandbox frame
desktop/    Electron app, installers and the launcher scripts of the CLI
shared/     .cce format, patch engine and extension scanner used by both sides
dist/       production build served by the daemon
```
