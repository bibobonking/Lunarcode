// Minimal ANSI SGR renderer for terminal output: colours (16, 256, truecolor), bold, dim, italic,
// underline. Everything else (cursor moves, title sequences) is dropped. Returns plain data, never HTML.

export interface AnsiSpan {
  text: string
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

const BASIC = [
  'rgb(var(--ink) / 0.55)',
  'rgb(var(--danger))',
  'rgb(var(--success))',
  'rgb(var(--warning))',
  'rgb(var(--lunar-a))',
  'rgb(var(--lunar-c))',
  'rgb(var(--lunar-b))',
  'rgb(var(--ink) / 0.85)',
]
const BRIGHT = [
  'rgb(var(--ink) / 0.7)',
  'rgb(var(--danger))',
  'rgb(var(--success))',
  'rgb(var(--warning))',
  'rgb(var(--link))',
  'rgb(var(--lunar-c))',
  'rgb(var(--lunar-b))',
  'rgb(var(--ink))',
]

function color256(n: number): string | undefined {
  if (n < 8) return BASIC[n]
  if (n < 16) return BRIGHT[n - 8]
  if (n < 232) {
    const i = n - 16
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${level(Math.floor(i / 36))} ${level(Math.floor(i / 6) % 6)} ${level(i % 6)})`
  }
  const gray = 8 + (n - 232) * 10
  return `rgb(${gray} ${gray} ${gray})`
}

// eslint-disable-next-line no-control-regex
const CSI = /\u001b\[([0-9;]*)([A-Za-z])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Z0-9]|\r(?!\n)/g

export interface AnsiState {
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export function parseAnsi(input: string, initial: AnsiState = {}): { spans: AnsiSpan[]; state: AnsiState } {
  const spans: AnsiSpan[] = []
  let state: AnsiState = { ...initial }
  let last = 0
  const push = (text: string) => {
    if (text) spans.push({ text, ...state })
  }
  for (const match of input.matchAll(CSI)) {
    push(input.slice(last, match.index))
    last = (match.index ?? 0) + match[0].length
    if (match[2] !== 'm') continue
    const codes = (match[1] || '0').split(';').map((value) => Number(value) || 0)
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i]
      if (code === 0) state = {}
      else if (code === 1) state.bold = true
      else if (code === 2) state.dim = true
      else if (code === 3) state.italic = true
      else if (code === 4) state.underline = true
      else if (code === 22) state = { ...state, bold: false, dim: false }
      else if (code === 23) state.italic = false
      else if (code === 24) state.underline = false
      else if (code >= 30 && code <= 37) state.color = BASIC[code - 30]
      else if (code >= 90 && code <= 97) state.color = BRIGHT[code - 90]
      else if (code >= 40 && code <= 47) state.bg = BASIC[code - 40].replace(/\/ [\d.]+\)/, '/ 0.25)')
      else if (code === 39) state.color = undefined
      else if (code === 49) state.bg = undefined
      else if (code === 38 || code === 48) {
        const target = code === 38 ? 'color' : 'bg'
        if (codes[i + 1] === 5) {
          state[target] = color256(codes[i + 2] ?? 0)
          i += 2
        } else if (codes[i + 1] === 2) {
          state[target] = `rgb(${codes[i + 2] ?? 0} ${codes[i + 3] ?? 0} ${codes[i + 4] ?? 0})`
          i += 4
        }
      }
    }
  }
  push(input.slice(last))
  return { spans, state }
}
