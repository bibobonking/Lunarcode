// Static check of an extension's files for things that deserve a second look before it is marked Trusted.
//
// This is a *hint*, not a verdict: patterns are matched line by line, so a determined author can hide
// intent and an honest one can trip a rule. That is why Sandbox mode (not this scan) is what actually
// restricts an extension; the scan decides how loud the warning is when someone wants to trust it.
//
// Zero dependencies and pure, so it is unit-tested (`ext-scan.test.mjs`).

export const LEVELS = ['low', 'medium', 'high']

/** Each rule: id, level, message and a regexp tested against one line of a text file. */
const CODE_RULES = [
  { id: 'exec', level: 'high', test: /\b(?:child_process|execFileSync|execSync|spawnSync)\b|\b(?:spawn|exec|execFile|fork)\s*\(\s*['"`]/, message: 'Runs system commands' },
  { id: 'eval', level: 'high', test: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]/, message: 'Builds and runs code at runtime (eval / new Function)' },
  { id: 'secrets', level: 'high', test: /secrets\.enc|master\.key|\bmcpOAuth\b/, message: 'Touches CreateCode\'s encrypted key store' },
  {
    id: 'credentials',
    level: 'high',
    test: /\.ssh\b|id_rsa|id_ed25519|\.aws[\\/]credentials|\.npmrc|\.gnupg|\.kube[\\/]config|Login Data|Local State|wallet\.dat|\.config[\\/](?:google-chrome|chromium|BraveSoftware)/,
    message: 'References credential or browser-profile files',
  },
  { id: 'download-exec', level: 'high', test: /\b(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash|zsh|node)\b|powershell[^\n]*-enc/i, message: 'Downloads and runs a script' },
  { id: 'providers', level: 'medium', test: /\bapiKey\b|\bapi_key\b|\.providers\b|stores\.settings|useSettings/, message: 'Reads provider settings or keys' },
  { id: 'network', level: 'medium', test: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\.http\s*\(|node:(?:net|http|https|dgram|tls)\b|require\(\s*['"](?:net|https?|dgram|tls)['"]\s*\)/, message: 'Talks to the network' },
  { id: 'fs-write', level: 'medium', test: /\b(?:writeFile|writeFileSync|appendFile|unlink|unlinkSync|rmSync|rmdir|rename|renameSync|copyFile|chmod)\b|\bfs\.(?:rm|promises)\b/, message: 'Writes, moves or deletes files' },
  { id: 'env', level: 'medium', test: /\bprocess\.env\b/, message: 'Reads environment variables' },
  { id: 'cookies', level: 'medium', test: /\bdocument\.cookie\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, message: 'Reads cookies or browser storage' },
  { id: 'keys', level: 'medium', test: /addEventListener\(\s*['"](?:keydown|keypress|keyup)['"]/, message: 'Listens to every key press' },
  { id: 'clipboard', level: 'medium', test: /\bnavigator\.clipboard\b|execCommand\(\s*['"]copy['"]/, message: 'Reads or writes the clipboard' },
  { id: 'hex', level: 'medium', test: /(?:\\x[0-9a-fA-F]{2}){8,}|(?:\\u[0-9a-fA-F]{4}){8,}/, message: 'Hex/unicode-escaped strings (often obfuscation)' },
  { id: 'blob', level: 'medium', test: /['"`][A-Za-z0-9+/=]{400,}['"`]/, message: 'Very long encoded string (possible hidden payload)' },
  { id: 'charcodes', level: 'medium', test: /String\.fromCharCode\s*\(\s*\d+\s*(?:,\s*\d+\s*){12,}/, message: 'Text assembled from char codes' },
]

const STYLE_RULES = [
  { id: 'css-remote', level: 'medium', test: /@import\s+(?:url\()?\s*['"]?https?:|url\(\s*['"]?https?:/i, message: 'Stylesheet loads something from the network' },
]

const TEXT_FILE = /\.(?:m?js|cjs|jsx|ts|tsx|html?|css|json|svg)$/i
const CODE_FILE = /\.(?:m?js|cjs|jsx|ts|tsx|html?)$/i
const MAX_FILE_BYTES = 1_500_000
const MAX_PER_RULE = 3
const MAX_FINDINGS = 40

const rank = (level) => LEVELS.indexOf(level)

function snippet(line) {
  const clean = line.trim().replace(/\s+/g, ' ')
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean
}

const text = (value) => (typeof value === 'string' ? value : Buffer.from(value).toString('utf8'))

/** Server patches reach the daemon's own source; these paths decide how worried we are. */
const SENSITIVE_SERVER = /(?:^|\/)(?:providers|http|store|tools|shell|terminal|mcp-oauth|daemon)\.mjs$|secrets|crypto/i

/**
 * @param {{ manifest: object, files: Record<string, string | Uint8Array> | Map<string, string | Uint8Array> }} input
 * @returns {{ level: 'none' | 'low' | 'medium' | 'high', findings: Array<{ id: string, level: string, message: string, file: string, line: number, snippet: string }> }}
 */
export function scanExtension({ manifest, files }) {
  const findings = []
  const perRule = new Map()
  const push = (finding) => {
    const key = `${finding.id}:${finding.file}`
    const count = perRule.get(key) ?? 0
    if (count >= MAX_PER_RULE || findings.length >= MAX_FINDINGS) return
    perRule.set(key, count + 1)
    findings.push(finding)
  }

  // What the manifest itself asks for: these never run in Sandbox mode.
  if (manifest?.server) push({ id: 'manifest-server', level: 'medium', message: 'Ships Node code that would run inside the daemon', file: 'extension.json', line: 0, snippet: `"server": "${manifest.server}"` })
  for (const [index, patch] of (manifest?.patches ?? []).entries()) {
    const server = patch.scope === 'server'
    const sensitive = server && SENSITIVE_SERVER.test(String(patch.target ?? ''))
    push({
      id: 'manifest-patch',
      level: sensitive ? 'high' : server ? 'medium' : 'low',
      message: `${server ? 'Daemon' : 'App'} patch #${index + 1} rewrites ${patch.target}`,
      file: 'extension.json',
      line: 0,
      snippet: String(patch.note ?? patch.target ?? ''),
    })
  }

  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files ?? {})
  for (const [name, raw] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!TEXT_FILE.test(name) || name.startsWith('node_modules/')) continue
    const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength
    if (size > MAX_FILE_BYTES) {
      push({ id: 'too-big', level: 'low', message: 'File is too large to scan', file: name, line: 0, snippet: `${Math.round(size / 1024)} KB` })
      continue
    }
    const rules = /\.css$/i.test(name) ? STYLE_RULES : CODE_FILE.test(name) ? CODE_RULES : []
    if (rules.length === 0) continue
    const lines = text(raw).split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (line.length > 4000 && CODE_FILE.test(name)) {
        push({ id: 'minified', level: 'low', message: 'Minified or single-line code is hard to review', file: name, line: index + 1, snippet: snippet(line.slice(0, 160)) })
      }
      const target = line.length > 6000 ? line.slice(0, 6000) : line
      for (const rule of rules) {
        if (rule.test.test(target)) push({ id: rule.id, level: rule.level, message: rule.message, file: name, line: index + 1, snippet: snippet(line.length > 400 ? line.slice(0, 400) : line) })
      }
    }
  }

  findings.sort((a, b) => rank(b.level) - rank(a.level) || a.file.localeCompare(b.file) || a.line - b.line)
  const top = findings.reduce((best, item) => (rank(item.level) > rank(best) ? item.level : best), 'none')
  return { level: findings.length ? top : 'none', findings }
}
