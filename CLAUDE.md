# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run daemon     # daemon on :4174 (own terminal)
npm run dev        # Vite on :5173 (proxies /api to the daemon)
npm test           # node --test — discovers *.test.mjs anywhere
node --test src/lib/themes.test.mjs   # single test file
npm run typecheck  # tsc -b --pretty
npm run build      # tsc -b && vite build → dist/
npm run desktop    # Electron app from source
npm run cli -- ext list   # desktop CLI (server/cli.mjs); desktop only, no npm bin
```

Node 24 runs the `.test.mjs` files directly: they import TypeScript sources with an explicit `.ts` extension (`from './themes.ts'`) and rely on Node's built-in type stripping. See **Testing traps** below.

## Two processes, one app

The React app in `src/` never talks to a provider or the filesystem directly. It calls a local Node daemon (`server/daemon.mjs`, `127.0.0.1:4174`) over `/api`, and the daemon owns every privileged operation — provider credentials, workspace files, shell, git, search, deploy, extensions.

- **Provider calls** go browser → `POST /api/llm` → daemon → provider. Keys are AES-256-GCM encrypted in `~/.createcode/secrets.enc`; the browser only ever sees a masked hint, so adding a provider means touching both `src/` and `server/lib/providers.mjs`.
- **Tool calls** are dispatched by the client agent loop via `src/lib/daemon.ts` → `POST /api/tools/execute` → `server/lib/tools.mjs`.
- **All `/api` routes** require a session cookie plus `x-createcode-csrf`; Host, Origin and `Sec-Fetch-Site` are checked in `server/daemon.mjs`. New routes go inside the `pathname.startsWith('/api/')` block, after the session guard.

## MCP

`server/lib/mcp.mjs` owns every connection (stdio, Streamable HTTP, legacy SSE). Remote servers may set `oauth: { enabled }`: on a 401 the server becomes `needs_auth`, the MCP panel (`src/components/McpPanel.tsx`) calls `POST /api/mcp/:id/authorize`, and the provider redirects to `/oauth/mcp/callback`. That one route is handled *before* `guardRequest` (the redirect is cross-site); the one-time `state` is its CSRF guard. Clients and tokens live in `secrets.enc` under `mcpOAuth`, never in `state.json`.

**Sync is event-driven, never timed.** `McpManager` emits `{type:'server'|'servers'}` events (`subscribe`) that `GET /api/mcp/events` streams to `src/store/mcp.ts` (started from `applySnapshot`). Tool lists change through `scheduleRefresh` (debounced `list_changed`) or `#settleTools` (after a state-changing call on a server without `listChanged`); both go through `#syncTools`, which compares a hash and emits only on change. `callTool` returns `toolsChanged` and `src/core/mcp-tools.ts` applies it before returning the result — keep that order, it is what lets the next LLM request carry the new tools mid-turn. Lost connections reconnect themselves (`#scheduleReconnect`, keeps last tools, `reconnecting` flag, `#ready` waits for it); `mcpServerUsable` is the client-side gate. Transport kinds fall back to each other (`isTransportMismatch`) and `#handshake` negotiates the protocol version.

## Ask Question

`ask_question` (`src/core/plugins/tools/ask.ts`) parks the loop in `askUser` (`src/store/questions.ts`) until `QuestionCard` answers, skips or the run is stopped. The agent loop marks it `awaiting` (never approval-gated). Arguments are untrusted: always read them through `normalizeQuestions` (`src/lib/ask-question.ts`, unit-tested). The free-text field is rendered by the card for every question — the model must not add an "Other" option.

## Agent core (Cordis kernel)

`src/core/kernel.ts` builds one Cordis `Context` with services (`sessions`, `systemPrompt`, `tools`, `approval`, `llm`, `compaction`, `subagents`, `ui`, `agentLoop`, `titles`) and first-party tool plugins (`src/core/plugins/tools/*`). `src/agent/index.ts` is a thin facade over `kernel.agentLoop`; `src/agent/adapters/*` are the provider adapters. The model gets its tools from `LlmService` (`request.tools`, default `tools.schemas(settings, mode)`); pass `tools: []` for plain completions.

`AgentLoopService` has no round cap: a turn ends when the model stops calling tools, errors, or the user stops it. Neighbouring `subagent` calls in one round run in parallel; every other call runs in order. Transient provider errors retry with backoff (`src/lib/retry.ts`).

`src/agent/queue.ts` serializes runs **per session** (`createTurnQueue`) and caps each run's history with `turnHistory`, which stops at the *next* user message. This is what keeps a prompt submitted mid-stream from either being consumed early or splitting into a second reply — do not replace it with a slice of the store.

**Compaction** (`src/core/services/compaction.ts`, pure helpers in `src/lib/compact-plan.ts`): checked before a turn and between tool rounds at `AUTO_COMPACT_THRESHOLD`; `/compact [focus]` runs it by hand. It keeps the newest turns verbatim (cut always lands on a user message, so tool calls keep their results), summarises the rest with the model (rolling over chunks, merging a previous summary), tracks written files from tool calls, and falls back to a deterministic summary if the model fails and the window is nearly full. The summary is an assistant message with `compaction` metadata, shown as a divider by `CompactionNote`. Mid-turn compaction appends a handoff user message and the loop continues from it.

**Subagents** (`src/core/services/subagents.ts`, types in `src/lib/subagent-types.ts`): read-only (`plan` mode), per-type tool allowlist (`explore`, `research`, `review`), round budget then a forced report, old tool output pruned, live progress via `ToolExecutionContext.onProgress`. They never get MCP tools or the `subagent` tool.

## Chat rendering

Messages are stored flat (`UserMessage | AssistantMessage | ToolMessage`) with a `round` field. Presentation is derived, never stored: `src/lib/conversation.ts` (`groupConversationTurns`) folds consecutive tool messages into one `tools` segment and drops assistant rounds that only called tools. `TurnBlock` in `src/components/MessageItem.tsx` renders one user turn as one answer, and `UsedGroup` is the collapsible "Used N tools" cluster.

## Extensions

Extensions (`.cce`, since 4.0.0) replace plugins. There is **no API contract and no capability model**: an extension is a folder/zip with `extension.json` that may ship renderer code, daemon code and direct find/replace **patches** to the served app (web) or the daemon source (server). Enabling one is an explicit full-trust choice and the UI must keep saying so. Full reference: `docs/EXTENSIONS.md`.

- `shared/cce.mjs` — zero-dependency ZIP reader/writer (node:zlib), manifest validation, `satisfies` (engine ranges), `packExtension`/`readExtensionArchive`. Unit-tested (`shared/cce.test.mjs`).
- `shared/patches.mjs` — patch engine (`applyPatches`, `matchesTarget`, `fingerprintPatches`); never throws, reports `pattern not found`. Unit-tested.
- `server/lib/extensions.mjs` — storage (`~/.createcode/extensions/<id>`, `state.json`, `~/.createcode/extension-data/<id>`), install/export/uninstall, watcher live reload, `/ext/<id>/*` file serving, `/api/extensions*` routes, daemon host (`activate(host)`: rpc, route, hooks, emit, storage, tracked timers/spawn).
- `shared/esm-version.mjs` — multi-file renderer extensions: `serveExtensionFile` appends `?v=<hash>` to relative imports in served `.js`/`.mjs`, otherwise the page's module cache would keep old sub-modules after a live reload (daemon side does the same through the `ext-boot` resolve hook). Unit-tested.
- `server/lib/ext-boot.mjs` — preload (`--import`) that applies server patches through `module.registerHooks` (Node ≥ 22.15). Server patches need a daemon restart; the desktop app and CLI both launch the daemon with this preload, and `daemon.mjs` re-execs itself with it if started bare.
- Web patches are applied in memory per request in `serveStatic` (`transformAppFile`); files on disk (and `dist/`) are never modified. CSP is dynamic: strict with no enabled extension, permissive when any is enabled.
- `src/extensions/*` — renderer runtime. Each extension gets a Cordis child context (`kernel.plugin`), so disposing it removes every tool/command/panel/listener it registered. `globalThis.createcode` (and `window.CreateCode`) exposes services, stores, React and helpers; nothing is gated.
- Extension tools are named `ext__<id>__<name>` and are always enabled (`setExtensionToolSetting`). Extension themes are `ext-<id>-<theme>` (the daemon's settings sanitizer only allows `[a-z0-9-]`), so `themeIsDark` must go through the registry.
- The daemon is zero-dependency again (`fflate` is gone).

## Theming

Themes are `[data-theme='<id>']` attribute selectors on `<html>` in `src/index.css`, each defining the same 18 semantic RGB-triplet tokens (`--canvas`, `--ink`, `--accent`, `--syn-keyword`, …). The `dark` class is toggled alongside for Tailwind's `dark:` variants. `tailwind.config.js` maps those tokens to utilities; components should use tokens, never literal colors.

Three places must stay in sync when adding a theme: the CSS token block, `THEMES`/`NAMED`/`DARK` in `src/lib/themes.ts`, and the boot-time script inlined in `index.html` (which prevents a flash of the wrong theme before hydration). `src/lib/themes.test.mjs` enforces the token set.

Extension themes are registered at runtime as `ext-<id>-<theme>` and styled the same way, so `themeIsDark` must go through the registry rather than a hardcoded list.

Styling: `src/index.css` holds the soft flat Adwaita tokens and controls, `src/components.css` the chat/tool/sidebar pieces, and `src/glass.css` the optional Liquid Glass style with its own palette. Light and Dark use no gradients, shadows or blur.

## Testing traps

- Test files are colocated `*.test.mjs`; there is no framework. Import TypeScript with the explicit extension: `import { x } from './thing.ts'`.
- A `.ts` file imported by these tests **cannot** use extensionless relative imports — Node's ESM resolver fails with `ERR_MODULE_NOT_FOUND`. That is why helpers used by tests keep `import type` only or live in `.mjs`.
- `assert.rejects` does not catch a synchronous throw; API wrappers under test are `async` on purpose.

## Shell

`server/lib/shell.mjs` picks the shell per OS (user's `$SHELL` if bash/zsh else bash on Linux, login zsh/bash on macOS, pwsh → Windows PowerShell → cmd on Windows; `CREATECODE_SHELL` overrides), kills whole process trees (`taskkill /T` on Windows) and owns the Plan-mode read-only allowlist. The daemon reports `os` and `shell` in its snapshot and `SystemPromptService` turns them into an Environment section. `repairProcessEnv()` probes the user's real shell (`-ilc`, plus `-ic` for bash so `~/.bashrc` counts) for its PATH, merges known nvm/volta/Homebrew dirs, and drops `ELECTRON_RUN_AS_NODE` — otherwise a daemon started from the desktop app can't find `node`. It runs *after* the server binds and prints its port (async, 3 s hard cap per probe) so a slow or hanging shell profile can never keep the app from loading. Platform logic is tested with injected `platform`/`env` in `server/lib/shell.test.mjs`.

## Traps

- Vite's root is the repo root. Edit `src/` and `index.html` only.
- `dist/` is committed and is what the daemon serves — a source change is invisible in the app until `npm run build`.
- The data directory is `~/.createcode` (override with `CREATECODE_DATA`); provider keys, chats, settings and extensions all live there, so tests and manual runs share state with the real app.
- The CSRF header is `x-createcode-csrf`; the extension global is `createcode`; the app id is `dev.bibobonking.createcode`.
- Desktop only: there is no npm package, no `bin` and no web launcher. The CLI is `server/cli.mjs` (`ext`, `version`, `help`), run by the desktop binary (`desktop/electron/main.mjs`) or by the launchers in `desktop/bin/`. The Arch `.pkg.tar.zst` is built by `.github/workflows/build.yml` with `makepkg`, not by electron-builder.
- The README disclaimer (independent developer, no review, install at your own risk) must stay.
