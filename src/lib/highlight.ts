import hljs from 'highlight.js/lib/common'

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  env: 'bash',
  lua: 'lua',
  diff: 'diff',
  patch: 'diff',
  gradle: 'java',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

/** Language id for a file path, or '' when it should stay plain text. */
export function langFromPath(path: string | undefined): string {
  if (!path) return ''
  const name = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  if (name.startsWith('.env')) return 'bash'
  const dot = name.lastIndexOf('.')
  if (dot === -1) return ''
  return BY_EXTENSION[name.slice(dot + 1)] ?? ''
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Highlighted HTML for one chunk of code. Falls back to escaped plain text. */
export function highlightCode(text: string, lang: string): string {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(text)
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(text)
  }
}

/** Highlights every line on its own so the diff can keep one row per line. */
export function highlightLines(lines: string[], lang: string): string[] {
  return lines.map((line) => (line ? highlightCode(line, lang) : ''))
}

/**
 * Colours shell output without guessing a grammar: errors red, warnings amber, successes green,
 * prompts and paths picked out. Returns HTML.
 */
export function colorizeShellOutput(text: string): string {
  return text
    .split('\n')
    .map((raw) => {
      const line = escapeHtml(raw)
      if (/^\s*(\$|>|#)\s/.test(raw)) return `<span class="sh-prompt">${line}</span>`
      if (/\b(error|fatal|failed|failure|exception|traceback|ERR!|cannot|denied|not found)\b|✗|✘/i.test(raw)) {
        return `<span class="sh-error">${line}</span>`
      }
      if (/\b(warn(ing)?|deprecated)\b/i.test(raw)) return `<span class="sh-warn">${line}</span>`
      if (/\b(pass(ed)?|success(ful(ly)?)?|done|ok|built|compiled|ready)\b|✓|✔/i.test(raw)) {
        return `<span class="sh-ok">${line}</span>`
      }
      return line.replace(
        /((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)+\.[\w]+(?::\d+(?::\d+)?)?)/g,
        '<span class="sh-path">$1</span>',
      )
    })
    .join('\n')
}
