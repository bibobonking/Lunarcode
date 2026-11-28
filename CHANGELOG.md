# Changelog

## 4.1.0

**Extension security: Sandbox and Trusted**
- **New extensions start in Sandbox mode.** Window code runs in an isolated iframe (opaque origin, no network, no eval) and talks to the app through a small message API: tools, commands, actions, panels, settings, themes, styles, notifications, confirmations, storage and assets. Daemon (`server`) code and patches do not run. Existing extensions also start in the sandbox after this update.
- **Mark as Trusted** lifts the sandbox: full access as before. It shows the scan findings and a last warning first, and asks you to type the extension id when the scan is serious or the extension already tried to break out. Also `createcode ext trust <id> --yes` and `createcode ext sandbox <id>`.
- **Anomaly detection.** Every extension is scanned for suspicious code (commands, `eval`, credential paths, obfuscation, network and storage access, patches to sensitive daemon files). While sandboxed, blocked attempts (network, privileged API, popups, flooding) are recorded and shown; a message flood suspends the extension.
- Updating an extension from a `.cce` sends it back to the sandbox. The page CSP is relaxed only while a Trusted extension is enabled.
- Extension guide rewritten (clearer, step by step, with a call to build unusual extensions) and README rewritten.

- The app is now CreateCode by Bibobonking. Data folder, app id, environment variables, extension global and CSRF header use the new name; no migration from older names.
- Extension packages are now `.cce`.
- Light and Dark redesigned as soft flat Adwaita. The Lunar theme is removed; Liquid Glass stays.
- New black-and-white icon with a gear, and a new start screen.
- The desktop executable and CLI command are `createcode`.

## 4.0.0

**Extensions replace plugins**
- **New `.lce` format (Lunarcode Extension).** A zip with an `extension.json`. Install from Settings → Extensions, drag in a file, or `lunarcode ext install file.lce`. Export any installed extension back to `.lce`; output is deterministic.
- **No API, no sandbox, no limits.** The capability/domain/API-version system is gone. An extension can ship renderer code, daemon (Node) code and **patches**: find/replace, insert before/after, append or prepend against any file of the served UI or the daemon source, with regex support and `{{id}}`/`{{ext}}` variables. Web patches are applied in memory, files on disk are never touched; stale patches are reported per patch, never fatal. Server patches load through a preload hook (Node 22.15+) and ask for a restart.
- **Full access from code.** `lunarcode` global: Cordis context, every service and store, React, tools, commands, panels, actions, settings pages, themes, styles, a daemon bridge (`server.call/fetch/on`) and a CORS-free HTTP proxy. The daemon side gets `activate(host)` with rpc, HTTP routes, tool/LLM/request hooks, SSE events, persistent storage, tracked timers and processes, and access to daemon modules.
- **Live reload.** Edit a folder under `~/.lunarcode/extensions` and the extension reloads itself, including multi-file server extensions. Per-extension logs, enable/disable, restart banner, patch status in the manager.
- **Scaffolding and CLI.** "New extension" templates (hello, theme, tool, patch) and `lunarcode ext list|new|pack|unpack|install|enable|disable|remove|path`.
- **Dynamic CSP.** Strict while no extension is enabled; relaxed only when one is, so extensions can talk to any service.
- Extension tools are `ext__<id>__<tool>`, extension themes `ext-<id>-<theme>`. Plugins (`.plugin.json`) are removed; this is a clean break. The `fflate` dependency is gone.

**Dark theme**
- Reworked as a neutral graphite palette: a clear surface ladder (canvas, panel, raised, popover), softer text, a cool blue accent, readable syntax and status colours, and matching overrides for the Lunar chrome (headerbar, sidebar, scrims, shadows).

**Other**
- Static files are served with ETags and `no-cache`, so updates and patches apply on the next load.
- Version 4.0.0 across the app, CLI, desktop and packages.

## 3.3.0

**Lunarcode: new name, new look**
- **OpenSol is now Lunarcode.** New name across the app, desktop installers, CLI (`lunarcode start|stop|status|open|logs`; `opensol` stays as an alias) and npm package (`@bibobonking/lunarcode`). Data lives in `~/.lunarcode`; an existing `~/.opensol` or `~/.maxcode` is renamed automatically on first start, nothing is converted or lost. `LUNARCODE_DATA` overrides the folder (`OPENSOL_DATA` and `MAXCODE_DATA` still work). `LUNARCODE.md` is read as a project instruction file (before `OPENSOL.md`).
- **New logo.** Same mark, re-lit for night: gradient ring, cratered moon, silvered prompt, glossy tile. Not flat. Desktop icons regenerated.
- **Three themes: Light, Lunar and Dark.** Lunar is the new default (moonlit indigo with a periwinkle moon accent). Dark is the neutral Adwaita Dark. The other palettes were removed; anyone who had one is moved to Lunar.
- **Effects in the Lunar tone.** Acrylic popovers and dialogs, gradient primary buttons with a sheen, active rails in the sidebar, moon spinner, shimmering "running" text, drifting aurora and stars on the welcome screen, lift-on-hover cards, expand/collapse that animates height. All of it respects reduced motion.
- **Smaller, denser UI** and larger panels: type, controls, headerbar and sidebar are one step smaller; dialogs, settings, MCP, the model picker and the command palette are wider and taller; composer menus are wider.

**Style and light theme**
- **Liquid Glass style.** Settings → Appearance → Style switches the whole window to Liquid Glass: a living gradient behind frosted, translucent panes with lit edges, rounder shapes, glossy pill buttons, glass dialogs and menus. It sits on top of any theme (Light, Lunar, Dark) and **Default** restores the regular look instantly. Reduced motion stops the drifting blobs.
- **Softer Light theme.** No more pure-white surfaces: cool paper tones, a softer text colour and gentler borders, so Light is no longer glaring.

**Agent**
- **Todo list tool (`todo_write`).** The agent plans multi-step work as a checklist and ticks items off as it goes. A card in the conversation shows each update and a dock above the composer shows the live list with progress. Works in Plan mode, can be switched off in Settings → Tools.
- **Reasoning effort on gateways.** Custom endpoints such as 9router, LiteLLM or one-api now get effort controls: the model behind an id like `ag/claude-sonnet-4-6` or `tokenharbor/deepseek-v4.1-flash:free` is recognised (catalog lookup, then family patterns for Claude, GPT-5/o-series, Gemini, DeepSeek, Qwen3, GLM, Kimi, MiMo and more).
- **Agent activity logo.** While the agent works, a pixel Lunarcode mark appears under the turn: the moon orbits the ring while it thinks or runs a shell, and the ring redraws itself while it writes, edits or rewrites. It disappears when the turn ends.

**Tool output**
- **Cards for every tool call**, with status rail, icon, duration, and for write/edit/rewrite the file path, **+N −M** counts and a proportion bar.
- **Syntax colours** for diffs, written content and `read_file` output by file type, bash colours for commands, and coloured shell output (errors, warnings, successes, paths). Output text is brighter and easier to read.

**Terminal**
- **Built-in terminal.** Run commands in the workspace without leaving Lunarcode: toggle from the top bar or with Ctrl/⌘ `` ` ``. Streams output as it arrives with ANSI colours, command history (↑/↓), `cd` that carries over, Ctrl C to stop, Ctrl L to clear and a resizable dock. It runs one command at a time (no full-screen programs).

**Interface**
- **New chat button in the top bar**, no need to open the sidebar.
- **Workspaces expand on click.** Clicking a workspace row expands or collapses its chats; it no longer opens the file tree.
- **Extensions (soon).** Plugins is now Extensions with a Soon badge and an "Extension update coming soon" dialog.
- Message header is cleaner: no avatar, no model name.

**Fixed**
- **Slash commands hidden behind the page.** The `/` command list is now drawn above everything and flips below the composer when there is no room.
- **Composer menus covered by the welcome cards.** Permissions, effort, plus and workspace menus are rendered on top and clamp to the window.
- **Model picker search box misaligned.** Icon, input and key hint now sit in one field (same fix in the file search).
- **MCP templates cut off.** The template grid adapts to the width and descriptions wrap.

**Build**
- **Arch Linux package.** The desktop workflow now builds a `.pacman` package next to AppImage, deb and rpm (Arch, Manjaro, EndeavourOS).
- Version 3.3.0 everywhere (package, daemon, desktop, MCP client info, About).

## 3.2.4 (hotfix)

**`read_file` reads more than text**
- **Images, audio and PDFs are attached, not called binary.** A `.png/.jpg/.jpeg/.gif/.webp`, `.mp3/.wav/.ogg/.oga/.m4a/.aac/.flac` or `.pdf` read with `read_file` now comes back as multimodal content through the same pipeline MCP results already used, so the model sees the image, hears the audio or reads the PDF.
- **Every provider gets it.** Anthropic: `image` and `document` blocks inside `tool_result`. OpenAI Responses: `input_image` / `input_file`. OpenAI Chat: media follows in a user message next to the tool block. Gemini: `inlineData` for image, audio and PDF. A kind a provider cannot read is named in the text instead of being silently dropped.
- **Large media is explained, not truncated.** A file over 5 MB returns a message with its size and the limit instead of a cut, invalid payload. Text reads are unchanged.
- **The card shows it.** Images render in the tool card, audio gets a player, PDFs open from a button.

**Tool names the model made up now resolve**
- **Fixed: “The model requested a tool that is not enabled: read”.** Models often call `read`, `view`, `cat`, `ls` or `list` for the built-in file tools. Those names now resolve to `read_file` / `list_files` when the target tool is offered, on all four adapters. An exact match still wins, and an alias whose target is unavailable is still refused.

**MCP: results are no longer text-only**
- **Fixed: images were dropped.** The daemon flattened every MCP result to text, so an `image` block (for example a Blockbench `capture_screenshot`) became an empty `[image … omitted]` placeholder and the model never saw it. Binary content is now kept as base64 and handed to the model.
- **All MCP content types.** `text`, `image`, `audio`, embedded `resource` (text or `blob`) and `resource_link` are handled. A `blob` that is an image, audio or PDF becomes media; any other binary blob stays a short text note. A `resource_link` is read through `resources/read` (up to 3 links, 10 s each) so the model gets the data instead of a bare URI; a link that cannot be read stays a link. Limits: 8 media items per result, about 8 MB of base64 each.
- **Sent per provider.** Anthropic: `image` and `document` blocks inside `tool_result`. OpenAI Responses: `input_image` / `input_file` in `function_call_output`. OpenAI Chat: tool messages are text only, so media follows in a user message right after the tool block. Gemini: `inlineData` for image, audio and PDF. A type a provider cannot read (audio on all but Gemini) is left out and the model is told so, instead of being told it was attached.
- **Context stays small.** Only the 4 newest tool results keep their media in the request; older ones fall back to text.
- **Tool card shows it.** Images are displayed in the card, audio gets a player, PDFs open from a button.
- Still text-only: `structuredContent` is used only when `content` is empty, and `annotations` (`audience`, `priority`) are ignored.

**MCP: connected tools stop disappearing**
- **Fixed: “The model requested a tool that is not enabled” after a blip.** A manual reconnect, a failed tool refresh, or a server that forgot its session used to empty the tool list for a moment. That moment removed the tools from the model's schema, so the next tool call was refused until OpenSol restarted. The last known list now stays visible and callable through every reconnect, and is only cleared by an explicit disconnect, a disabled server, a config change, sign-out, or an expired authorization.
- **One connection attempt at a time.** Startup, the MCP panel and a tool call can ask for the same server together; they now share the attempt instead of tearing down each other's transport.
- **A 404 session is renewed even without a session id.** Some servers never send `Mcp-Session-Id`; the next request after a restart still reinitializes and retries instead of falling back to a full reconnect.
- **A call that finds a dead session reconnects.** A 404 or 5xx rebuilds the transport in the background (the call itself is not retried) instead of leaving the server stuck until OpenSol restarts.
- **Reconnecting states stay dispatchable.** A server that is `connecting` or in `error` with a known tool list keeps those tools in the schema (the daemon waits for the reconnect), matching the 3.2.3 reconnect design.

**Desktop (Electron)**
- **A `data:` link can no longer take over the window.** `data:` URLs are no longer treated as local, so a link to one opens nothing inside the app (blob URLs made by the app, such as the new image/PDF viewer, still work).
- **Quit stops the whole daemon tree on Windows.** `kill()` is a hard kill there and left MCP servers and running shell commands behind; the app now runs `taskkill /T /F`.
- **A daemon that dies while the window is open is restarted** (at most 3 times a minute, then a clear error) instead of leaving a dead page.
- **One daemon start at a time.** Activate, a second launch and a crash restart could race and start two daemons; starts are now serialized.
- Launching OpenSol again when its window is gone (macOS) opens a new window instead of doing nothing.

**Other**
- Version 3.2.4 everywhere (package, daemon, desktop, MCP client info, About).

## 3.2.3

**MCP: tools that follow the server**
- **Auto sync, event-driven.** A server that opens tools after an action (10 tools before a project exists, 100 after) is picked up the moment it happens. The daemon listens for `notifications/tools/list_changed` (stdio, legacy SSE, the POST stream *and* the optional Streamable HTTP GET stream), coalesces bursts, re-reads the list and publishes it only when a hash of names, descriptions and schemas really changed. Servers that never send the notification are re-listed once right after a tool call that may change state. Nothing polls on a timer.
- **The agent keeps going.** The new tool list is applied before the tool result is handed back, the result carries a short note naming the new tools, and the next model request already includes them: no stop, no new message. A call to a tool the list no longer knows re-reads the list once before it is refused.
- **Live push to the app.** `GET /api/mcp/events` streams every status/tool change to the UI (the 1.2 s "connecting" poll is gone). MCP servers are now loaded at startup, not only after the **+** menu is opened.
- **Auto-reconnect.** A server that exits or drops is reconnected with back-off (0.4 s → 30 s); its last known tools stay callable meanwhile and a call made during the gap waits for the reconnect instead of failing. A lost Streamable HTTP session (404) is re-opened transparently.
- **Compatibility.** Protocol negotiation steps down 2025-06-18 → 2025-03-26 → 2024-11-05 and uses what the server answers; a Streamable HTTP URL that only speaks legacy HTTP+SSE (and the other way round) is detected and used automatically, so existing configs keep working; JSON batch replies, SSE notifications inside POST replies, servers without the tools capability, and `roots/list` are handled.

**Approvals**
- **Allow / Deny act at once.** The card flips to "running" / "denied" on the click instead of waiting for the tool to finish, and a double click is ignored.

**New: Ask Question**
- Agent tool `ask_question` (also in Plan mode): several questions per call, single or multi-select, a small comment under every option, a "Recommended" convention, and a free-text field at the end of **every** question without the model asking for it. Tabs, Back/Next, number keys, Skip; answers go back to the model as text and the card keeps a summary. Turn it off in Settings → Tools.

**Other**
- **Desktop is now Electron.** The Tauri/Rust wrapper was replaced by Electron and
  electron-builder for Linux, Windows and macOS. The app still starts (or reuses) the same
  local daemon, now on Electron's built-in Node runtime, and keeps the same data folder.
- Version 3.2.3 everywhere (package, daemon, desktop, MCP client info).

## Realeased 3.2.0 - Final Version

- **Shell on every OS.** Commands run in bash (Linux), a login zsh/bash (macOS) or PowerShell/cmd (Windows) instead of a hard-coded `/bin/bash`; the agent is told which. `OPENSOL_SHELL` overrides. Plan mode has a read-only allowlist per shell family, process trees are killed correctly on Windows, and deploy builds use the same shell.
- **Smarter compaction.** Keeps the newest turns verbatim, merges earlier summaries, tracks changed files from tool calls, handles huge sessions in chunks, retries, falls back safely, also runs between tool rounds, and has `/compact [focus]`. Summaries show as a divider you can expand.
- **Better subagents.** Types `explore`/`research`/`review`, parallel calls, live progress in the tool card, round budget with forced report, context pruning, transient-error retry, and approval now actually applies to them. Subagents can no longer start subagents or receive tools outside their type.
- **New composer and home.** Compact box with the folder picker above it, a **+** menu (files, web search, MCP, skills link), plain-text Build/Plan, permission, effort and model controls whose panels flip and scroll to stay on screen, and a simpler new-session screen.
- Mascot is now optional: Settings → General → Show mascot (off by default).
- Cleanup: removed the legacy `src/agent/{compact,subagent,tools,prompt,model,approval}.ts` duplicates, a stale `server/package.json`, unused composer/ChatView code, and merge-conflict markers in `.gitignore` and `.npmignore`. Docs synced (`~/.opensol`, build workflow name, architecture).
- Agent loop: removed the 16-round cap (subagents now have their own round budget, see above). Provider errors now retry up to 5 times with backoff, only for transient errors (429 bursts, 5xx, overload, network); quota, credit and "limit reached" errors are never retried.
- Model deck: hovering no longer scrolls the list, which made rows jump.
- Plugins button disabled for maintenance.
- Skills: real skill folders (SKILL.md + scripts/references) installed by folder upload or npm, loaded on demand through the new `skill` tool. Built-in skills removed.
- Credits spent shown per session (top bar) and in the dashboard, for every provider (provider-reported cost, else tokens × model price).
- File tree: colored file and folder icons, indent guides, git status marks.
- Deploy: redesigned with steps and project detection; fixed Netlify creating a new site every deploy, Vercel org-id error, wrong URL picked from CLI output, missing output folder.
- System prompt per session and per workspace (button in the top bar).
- New OpenSol icon.


## 3.1.2

**New**
- **MCP panel + OAuth** — MCP has its own panel (sidebar → MCP, Settings → MCP → Open MCP panel, or Ctrl/⌘ K) instead of living inside Settings: server list, edit-in-place, templates, tool filter and **Import JSON** (Claude Desktop / Cursor / VS Code `mcpServers`). Remote servers can use **OAuth 2.1** (discovery, dynamic client registration, PKCE, automatic refresh; tokens stay in the encrypted secrets file) and there is a third connection type, legacy **HTTP+SSE**, next to stdio and Streamable HTTP. See `server/lib/mcp-oauth.mjs`.
- **MCP connect** — Add local (stdio) or remote (Streamable HTTP) Model Context Protocol servers; their tools reach the agent as `mcp__<server>__<tool>`. Per-server approval (ask / auto), per-tool switches, secrets masked in the UI. The daemon owns every connection (`server/lib/mcp.mjs`).
- **Remove workspace** — trash button on each workspace in the sidebar (removes it from the list; the folder stays on disk).
- **Sessions tab** — new tab in the workspace panel: sessions of the open workspace (or all), with rename, AI title and delete. New sessions record the workspace they started in.
- **AI session titles** — after the first answer the model names the session (Settings → General turns it off). "Name with AI" in the session menu regenerates a title; names you type are never overwritten.
- **Edit stats** — file edits show `+added −removed` and where the change starts (`L42:7`), with a mini diff in the tool card; the task header and the Undo bar show the turn total.
- **OpenSol Desktop** — Tauri app (`desktop/`) using the OS webview: WebKitGTK (Linux), WebView2 (Windows 10/11), WKWebView (macOS). The web version is unchanged. See `desktop/README.md`.

**Changed**
- Brand name is now **OpenSoftX** (the app is still OpenSol).
- Model Deck: the provider highlight no longer drifts off its button and the active provider scrolls into view.
- Thoughts are closed by default, also while the model is still thinking.
- New **Model Deck** replaces the dropdown picker: centered overlay, provider rail, context bars, and a draggable effort throttle; the composer shows live effort bars. `Ctrl/⌘ M` opens it.
- Redesigned Settings: numbered rail with a sliding pill, large section headers, card layout.
- More motion: spring knob, staggered rows, blur-in titles, diff rows, tool rows. All of it respects `prefers-reduced-motion`.
- Daemon now persists `chatFontSize`, `workDetail` and `autoCollapseWork` (they were dropped before).
