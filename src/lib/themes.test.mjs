import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEMES, normalizeTheme, resolveTheme, themeIsDark } from './themes.ts'

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

const TOKENS = [
  'canvas',
  'panel',
  'raised',
  'line',
  'ink',
  'muted',
  'faint',
  'accent',
  'accent-soft',
  'on-accent',
  'success',
  'warning',
  'danger',
  'syn-keyword',
  'syn-string',
  'syn-number',
  'syn-title',
  'syn-attr',
]

function block(needle) {
  const start = css.indexOf(needle)
  assert.notEqual(start, -1, `missing CSS block for ${needle}`)
  return css.slice(start, css.indexOf('}', start))
}

test('every named palette defines the full semantic token set', () => {
  for (const theme of THEMES) {
    const body = block(`[data-theme='${theme.id}']`)
    for (const token of TOKENS) {
      assert.match(body, new RegExp(`--${token}:`), `${theme.id} is missing --${token}`)
    }
  }
  const light = block(':root,')
  for (const token of TOKENS) {
    assert.match(light, new RegExp(`--${token}:`), `light is missing --${token}`)
  }
})

test('legacy, named, system and invalid themes resolve', () => {
  assert.equal(normalizeTheme('light'), 'light')
  assert.equal(normalizeTheme('dark'), 'dark')
  assert.equal(normalizeTheme('system'), 'system')
  assert.equal(normalizeTheme('lunar'), 'lunar')
  // Retired palettes fall back to Lunar.
  assert.equal(normalizeTheme('night-owl'), 'lunar')
  assert.equal(normalizeTheme('claude-code'), 'lunar')
  assert.equal(normalizeTheme('flame'), 'lunar')
  assert.equal(normalizeTheme(undefined), 'system')
  assert.equal(normalizeTheme(7), 'system')
  assert.equal(normalizeTheme('Not A Theme'), 'system')
  // Plugin themes are `plugin-<id>:<theme>` slugs the app has not seen at build time.
  assert.equal(normalizeTheme('plugin-demo:sunrise'), 'plugin-demo:sunrise')
})

test('system follows the OS preference while named themes do not', () => {
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('lunar', false), 'lunar')
  assert.equal(themeIsDark('light', true), false)
  assert.equal(themeIsDark('dark', false), true)
  assert.equal(themeIsDark('lunar', false), true)
  assert.equal(themeIsDark('system', true), true)
})
