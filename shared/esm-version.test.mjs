import test from 'node:test'
import assert from 'node:assert/strict'
import { versionRelativeImports } from './esm-version.mjs'

test('relative imports get the version, in every form', () => {
  const source = [
    "import a from './a.js'",
    'import { b } from "../lib/b.js"',
    "export * from './c.js'",
    "import './side.js'",
    "const m = await import('./lazy.js')",
  ].join('\n')
  const out = versionRelativeImports(source, 'abc123')
  assert.match(out, /from '\.\/a\.js\?v=abc123'/)
  assert.match(out, /from "\.\.\/lib\/b\.js\?v=abc123"/)
  assert.match(out, /from '\.\/c\.js\?v=abc123'/)
  assert.match(out, /import '\.\/side\.js\?v=abc123'/)
  assert.match(out, /import\('\.\/lazy\.js\?v=abc123'\)/)
})

test('bare, absolute and already-versioned specifiers are untouched', () => {
  const source = "import x from 'react'\nimport y from '/ext/a/b.js'\nimport z from './z.js?v=1'\nimport w from 'https://cdn/x.js'"
  assert.equal(versionRelativeImports(source, 'abc'), source)
})

test('no version means no change', () => {
  const source = "import a from './a.js'"
  assert.equal(versionRelativeImports(source, ''), source)
})
