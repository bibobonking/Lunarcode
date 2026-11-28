// Starter extensions for `createcode ext new` and the in-app "New extension" button.

const slug = (text) => text.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()

export const TEMPLATES = {
  hello: 'Renderer: a command, a toast, a side panel and a stylesheet',
  theme: 'Theme only: a colour palette, no code',
  tool: 'Renderer + server: an agent tool backed by Node code in the daemon',
  patch: 'Patch: edit the served app directly with find/replace',
  project: 'Multi-file project: src/ modules, several stylesheets and a server/ folder, for larger extensions',
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
            insertBefore: '<style id="cce-patch-demo">:root{--cce-patch:1}</style>',
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

  if (template === 'project') {
    return {
      manifest: { ...base, main: 'src/main.js', server: 'server/index.mjs', styles: ['styles/base.css', 'styles/panel.css'] },
      files: {
        'src/main.js': `// Entry point of the window part. Split the extension into as many files and folders as you like:
// relative imports (./x.js, ../y.js) are served from this extension and reload live when any file changes.
import { registerHello } from './commands/hello.js'
import { registerPanel } from './ui/panel.js'

export default function activate(createcode) {
  registerHello(createcode)
  registerPanel(createcode)
}
`,
        'src/commands/hello.js': `import { greeting } from '../lib/format.js'

export function registerHello(createcode) {
  createcode.registerCommand('hello', 'Say hello from ${name.replace(/'/g, '')}', async () => {
    const info = await createcode.server.call('now')
    createcode.notify(greeting(${q}, info.iso), 'success')
  })
}
`,
        'src/ui/panel.js': `import { greeting } from '../lib/format.js'

export function registerPanel(createcode) {
  createcode.registerPanel('project-panel', ${q}, (host) => {
    host.innerHTML = '<div class="cce-project"><h3></h3><p></p><button>Ask the daemon</button></div>'
    host.querySelector('h3').textContent = ${q}
    host.querySelector('p').textContent = greeting(${q}, new Date().toISOString())
    const button = host.querySelector('button')
    const click = async () => createcode.notify(JSON.stringify(await createcode.server.call('now')), 'info')
    button.addEventListener('click', click)
    return () => button.removeEventListener('click', click)
  })
}
`,
        'src/lib/format.js': `export const greeting = (name, iso) => 'Hello from ' + name + ' (' + iso + ')'
`,
        'server/index.mjs': `// Entry point of the daemon part (Node, full access). Relative imports work here too.
import { now } from './handlers/now.mjs'

export default function activate(host) {
  host.rpc('now', now)
  host.route('GET', 'ping', () => ({ pong: true }))
  host.log('project server part started')
}
`,
        'server/handlers/now.mjs': `export const now = () => ({ iso: new Date().toISOString(), pid: process.pid, node: process.version })
`,
        'styles/base.css': `.cce-project { padding: 16px; display: grid; gap: 8px; }
.cce-project h3 { font-weight: 700; }
`,
        'styles/panel.css': `.cce-project button { justify-self: start; padding: 6px 12px; border-radius: 8px; background: rgb(var(--accent)); color: rgb(var(--on-accent)); }
`,
        'README.md': `# ${name}\n\nMulti-file extension layout:\n\n\`\`\`\nextension.json   main: src/main.js, server: server/index.mjs, styles: [...]\nsrc/             window code (ES modules, import each other with relative paths)\nserver/          daemon code (Node ESM, same rule)\nstyles/          any number of .css files, list each in "styles"\nassets/          anything else, served at /ext/${id}/<path>\n\`\`\`\n\nEvery file is part of the package: \`createcode ext pack\` zips the whole folder.\n`,
      },
    }
  }

  if (template === 'tool') {
    return {
      manifest: { ...base, main: 'main.js', server: 'server.mjs' },
      files: {
        'server.mjs': `// Runs inside the CreateCode daemon with full Node access: fs, child_process, net, any npm package you ship.
export default function activate(host) {
  host.log('server part started')

  // Callable from the window: await createcode.server.call('now')
  host.rpc('now', () => ({ iso: new Date().toISOString(), pid: process.pid, node: process.version }))

  // Plain HTTP route: GET /api/extensions/${id}/x/ping
  host.route('GET', 'ping', () => ({ pong: true }))

  // Push to the window whenever you like.
  host.interval(() => host.emit('tick', { at: Date.now() }), 30_000)
}
`,
        'main.js': `// Runs in the CreateCode window. \`createcode\` is the live app: no sandbox, no permission list.
export default function activate(createcode) {
  createcode.registerTool({
    name: 'daemon_time',
    description: 'Returns the current time and Node version of the CreateCode daemon.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    allowedInMode: () => true,
    async execute() {
      const info = await createcode.server.call('now')
      return { output: JSON.stringify(info), isError: false }
    },
  })

  createcode.server.on('tick', () => createcode.log('server tick'))
  createcode.registerCommand('daemon-time', 'Show daemon time', async () => {
    createcode.notify((await createcode.server.call('now')).iso, 'info')
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
      'main.js': `// Runs in the CreateCode window. \`createcode\` is the live app: no sandbox, no permission list.
export default function activate(createcode) {
  createcode.registerCommand('hello', 'Say hello from ${name.replace(/'/g, '')}', () => {
    createcode.notify('Hello from ' + ${q} + '!', 'success')
  })

  createcode.registerPanel('hello-panel', ${q}, (host) => {
    host.innerHTML = '<div class="cce-hello"><h3>' + ${q} + '</h3><p>This panel is plain DOM. Use createcode.React for components.</p><button>Click me</button></div>'
    const button = host.querySelector('button')
    const click = () => createcode.notify('Clicked!', 'info')
    button.addEventListener('click', click)
    return () => button.removeEventListener('click', click)
  })

  // Anything else: createcode.ctx is the Cordis context with every service (tools, ui, sessions, llm, …).
  createcode.on('agent/turn-finish', (turn) => createcode.log('turn finished after', turn.rounds, 'rounds'))
}
`,
      'style.css': `.cce-hello { padding: 16px; display: grid; gap: 8px; }
.cce-hello h3 { font-weight: 700; }
.cce-hello button { justify-self: start; padding: 6px 12px; border-radius: 8px; background: rgb(var(--accent)); color: rgb(var(--on-accent)); }
`,
      'README.md': `# ${name}\n\nStarter extension. Edit the files here and save: CreateCode reloads the extension live.\n`,
    },
  }
}
