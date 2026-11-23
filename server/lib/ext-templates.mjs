// Starter extensions for `lunarcode ext new` and the in-app "New extension" button.

const slug = (text) => text.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()

export const TEMPLATES = {
  hello: 'Renderer: a command, a toast, a side panel and a stylesheet',
  theme: 'Theme only: a colour palette, no code',
  tool: 'Renderer + server: an agent tool backed by Node code in the daemon',
  patch: 'Patch: edit the served app directly with find/replace',
}

export function scaffold(id, name, template = 'hello') {
  if (!(template in TEMPLATES)) throw new Error(`Unknown template "${template}". Use: ${Object.keys(TEMPLATES).join(', ')}`)
  const base = { id, name, version: '0.1.0', description: TEMPLATES[template], author: '', engine: '>=4.0.0' }
  const q = JSON.stringify(name)

  if (template === 'theme') {
    return {
      manifest: {
        ...base,
        themes: [
          {
            id: slug(id),
            label: name,
            dark: true,
            tokens: {
              canvas: '24 22 30', panel: '18 16 24', raised: '34 31 42', line: '58 54 72', ink: '238 234 246', muted: '176 170 196',
              faint: '124 118 146', accent: '255 149 120', 'accent-soft': '72 44 44', 'on-accent': '28 14 12', success: '120 220 160',
              warning: '248 208 112', danger: '255 120 130', 'syn-keyword': '255 149 120', 'syn-string': '140 226 180', 'syn-number': '250 200 120',
              'syn-title': '150 190 255', 'syn-attr': '130 220 230', headerbar: '28 26 36', sidebar: '26 23 34', 'sidebar-2': '31 28 40',
              card: '32 29 40', popover: '36 33 46', dialog: '30 27 38', link: '255 170 140',
            },
          },
        ],
      },
      files: { 'README.md': `# ${name}\n\nA theme-only extension. Edit the palette in \`extension.json\`; every value is an RGB triplet.\nPick it in Settings → Appearance.\n` },
    }
  }

  if (template === 'patch') {
    return {
      manifest: {
        ...base,
        patches: [
          {
            scope: 'web',
            target: 'index.html',
            find: '</head>',
            insertBefore: '<style id="lce-patch-demo">:root{--lce-patch:1}</style>',
            note: 'Adds a style tag to the page head: edit or remove this patch',
          },
          {
            scope: 'web',
            target: 'index.html',
            find: '</body>',
            insertBefore: '<script>console.info("[%s] patch applied to the app", "{{id}}")</script>',
            note: 'Logs to the browser console when the page loads',
          },
        ],
      },
      files: {
        'README.md': `# ${name}\n\nPatches edit the app the way a mod edits a game: no API, just find/replace.\n\n- \`scope: "web"\` patches the served files (\`index.html\`, \`assets/index-*.js\`, \`assets/*.css\`) in memory.\n- \`scope: "server"\` patches daemon modules (\`server/lib/tools.mjs\`) as they load; restart to apply.\n- Disable or remove the extension and the original code is back. Nothing on disk is rewritten.\n- Use \`find: { "regex": "…", "flags": "g" }\`, \`replace\`, \`insertBefore\`, \`insertAfter\`, \`append\`, \`prepend\`, and \`"file": "x.js"\` to take the text from a file in this extension.\n`,
      },
    }
  }

  if (template === 'tool') {
    return {
      manifest: { ...base, main: 'main.js', server: 'server.mjs' },
      files: {
        'server.mjs': `// Runs inside the Lunarcode daemon with full Node access: fs, child_process, net, any npm package you ship.
export default function activate(host) {
  host.log('server part started')

  // Callable from the window: await lunarcode.server.call('now')
  host.rpc('now', () => ({ iso: new Date().toISOString(), pid: process.pid, node: process.version }))

  // Plain HTTP route: GET /api/extensions/${id}/x/ping
  host.route('GET', 'ping', () => ({ pong: true }))

  // Push to the window whenever you like.
  host.interval(() => host.emit('tick', { at: Date.now() }), 30_000)
}
`,
        'main.js': `// Runs in the Lunarcode window. \`lunarcode\` is the live app: no sandbox, no permission list.
export default function activate(lunarcode) {
  lunarcode.registerTool({
    name: 'daemon_time',
    description: 'Returns the current time and Node version of the Lunarcode daemon.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    allowedInMode: () => true,
    async execute() {
      const info = await lunarcode.server.call('now')
      return { output: JSON.stringify(info), isError: false }
    },
  })

  lunarcode.server.on('tick', () => lunarcode.log('server tick'))
  lunarcode.registerCommand('daemon-time', 'Show daemon time', async () => {
    lunarcode.notify((await lunarcode.server.call('now')).iso, 'info')
  })
}
`,
        'README.md': `# ${name}\n\nAn agent tool (\`daemon_time\`) implemented by Node code in the daemon.\n`,
      },
    }
  }

  return {
    manifest: { ...base, main: 'main.js', styles: ['style.css'] },
    files: {
      'main.js': `// Runs in the Lunarcode window. \`lunarcode\` is the live app: no sandbox, no permission list.
export default function activate(lunarcode) {
  lunarcode.registerCommand('hello', 'Say hello from ${name.replace(/'/g, '')}', () => {
    lunarcode.notify('Hello from ' + ${q} + '!', 'success')
  })

  lunarcode.registerPanel('hello-panel', ${q}, (host) => {
    host.innerHTML = '<div class="lce-hello"><h3>' + ${q} + '</h3><p>This panel is plain DOM. Use lunarcode.React for components.</p><button>Click me</button></div>'
    const button = host.querySelector('button')
    const click = () => lunarcode.notify('Clicked!', 'info')
    button.addEventListener('click', click)
    return () => button.removeEventListener('click', click)
  })

  // Anything else: lunarcode.ctx is the Cordis context with every service (tools, ui, sessions, llm, …).
  lunarcode.on('agent/turn-finish', (turn) => lunarcode.log('turn finished after', turn.rounds, 'rounds'))
}
`,
      'style.css': `.lce-hello { padding: 16px; display: grid; gap: 8px; }
.lce-hello h3 { font-weight: 700; }
.lce-hello button { justify-self: start; padding: 6px 12px; border-radius: 8px; background: rgb(var(--accent)); color: rgb(var(--on-accent)); }
`,
      'README.md': `# ${name}\n\nStarter extension. Edit the files here and save: Lunarcode reloads the extension live.\n`,
    },
  }
}
