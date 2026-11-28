# CreateCode daemon

`server/` is the local Node daemon (`127.0.0.1:4174`, no runtime dependencies). The desktop app starts it for you; there is no standalone launcher or npm package. It owns everything privileged: provider credentials, workspace files, shell, git, search, MCP connections, extensions, skills and deploys. The React app in `src/` only talks to it over `/api`.

```bash
node server/daemon.mjs [--port=4174]   # foreground daemon, for development (npm run daemon)
node server/cli.mjs ext list           # desktop CLI from a checkout (npm run cli -- ext list)
```

| File | Role |
|---|---|
| `daemon.mjs` | HTTP server, session cookie + CSRF guard, `/api` routes, static `dist/` |
| `cli.mjs` | Desktop CLI: `ext` (list, new, pack, unpack, install, enable, disable, remove, path), version |
| `lib/store.mjs` | data directory (`~/.createcode`, or `CREATECODE_DATA`), state, AES-256-GCM secrets |
| `lib/tools.mjs` | file, grep, git and shell tools, workspace path guard, checkpoints |
| `lib/shell.mjs` | picks bash/zsh/PowerShell/cmd per OS, kills process trees, Plan-mode allowlist |
| `lib/providers.mjs`, `lib/mcp*.mjs`, `lib/extensions.mjs`, `lib/ext-boot.mjs`, `lib/skills.mjs`, `lib/deploy.mjs` | providers, MCP (+OAuth), extensions (.cce), skills, deploys |

Shell selection: Linux → bash; macOS → your `$SHELL` (zsh/bash) as a login shell; Windows → `pwsh`, else Windows PowerShell, else `cmd`. Set `CREATECODE_SHELL` to force one. Commands run in the workspace root with `CREATECODE=1` and `CREATECODE_WORKSPACE` set.

See the root `README.md` for the full feature list and `CLAUDE.md` for architecture notes.
