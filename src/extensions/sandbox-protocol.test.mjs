import test from 'node:test'
import assert from 'node:assert/strict'
import { clampText, createFloodGuard, normalizeToolMeta, normalizeToolResult, sanitizeCss, sanitizeIcon, validId } from './sandbox-protocol.ts'

test('sanitizeCss drops remote loads and keeps local ones inside the extension', () => {
  const css = "@import url('https://evil.test/a.css');\n.a{background:url(https://evil.test/p.png)}\n.b{background:url(img/a.png)}\n.c{background:url(data:image/png;base64,AAAA)}\n.d{background:url(../x.png)}\n.e{background:url(/api/x)}"
  const out = sanitizeCss(css, { base: '/ext/demo/' })
  assert.ok(!out.includes('evil.test'))
  assert.ok(out.includes('url(/ext/demo/img/a.png)'))
  assert.ok(out.includes('data:image/png'))
  assert.equal((out.match(/url\(\)/g) ?? []).length, 3)
})

test('sanitizeIcon allows emoji, extension images and data images only', () => {
  const resolve = (path) => `/ext/demo/${path}`
  assert.equal(sanitizeIcon('🔥', resolve), '🔥')
  assert.equal(sanitizeIcon('assets/i.png', resolve), '/ext/demo/assets/i.png')
  assert.equal(sanitizeIcon('<svg onload=alert(1)>', resolve), undefined)
  assert.equal(sanitizeIcon('https://x.test/a.png', resolve), undefined)
  assert.equal(sanitizeIcon('../a.png', resolve), undefined)
  assert.equal(sanitizeIcon('data:image/png;base64,AAAA', resolve), 'data:image/png;base64,AAAA')
  assert.equal(sanitizeIcon('a long label', resolve), undefined)
})

test('flood guard trips after the limit inside one window', () => {
  let time = 0
  const guard = createFloodGuard(3, 1000, () => time)
  assert.deepEqual([guard.hit(), guard.hit(), guard.hit(), guard.hit()], [false, false, false, true])
  time = 1500
  assert.equal(guard.hit(), false)
})

test('tool meta and results are normalised', () => {
  assert.equal(normalizeToolMeta(null), null)
  assert.equal(normalizeToolMeta({ parameters: [] }), null)
  const meta = normalizeToolMeta({ description: 'x', parameters: { type: 'object' }, approval: 'weird', modes: { build: true, plan: 1 } })
  assert.deepEqual(meta.modes, { build: true, plan: false })
  assert.equal(meta.approval, 'auto')
  assert.deepEqual(normalizeToolResult({ output: 'ok', isError: true, media: [1] }), { output: 'ok', isError: true })
  assert.deepEqual(normalizeToolResult('hi'), { output: 'hi', isError: false })
  assert.equal(clampText('a'.repeat(10), 4), 'aaaa…')
  assert.equal(validId('a b'), false)
  assert.equal(validId('hello-1'), true)
})
