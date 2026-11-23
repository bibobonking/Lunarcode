import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPatches, fingerprintPatches, matchesTarget } from './patches.mjs'

const run = (source, file, patches) => applyPatches(source, file, patches.map((p) => ({ scope: 'web', ...p })), (p) => ({ id: p.__owner ?? 'x', ext: '/ext/x' }))

test('globs', () => {
  assert.equal(matchesTarget('assets/index-*.js', 'assets/index-AbC123.js'), true)
  assert.equal(matchesTarget('assets/index-*.js', 'assets/sub/index-AbC123.js'), false)
  assert.equal(matchesTarget('**/*.mjs', 'server/lib/tools.mjs'), true)
  assert.equal(matchesTarget('index.html', 'index.html'), true)
})

test('string patches: replace, insertBefore, insertAfter, all, first-only', () => {
  const out = run('a b a b', 'f.js', [
    { target: 'f.js', find: 'a', replace: 'A' },
    { target: 'f.js', find: 'b', insertAfter: '!', all: true },
    { target: 'f.js', find: 'A', insertBefore: '<' },
  ])
  assert.equal(out.source, '<A b! a b!')
  assert.ok(out.results.every((r) => r.applied))
})

test('regex patches expand $1 and keep literal inserts literal', () => {
  const out = run('function foo(x){}', 'f.js', [
    { target: 'f.js', find: { regex: 'function (\\w+)\\((\\w)\\)', flags: '' }, replace: 'function $1_p($2)' },
    { target: 'f.js', find: { regex: 'foo', flags: '' }, insertBefore: '$1' },
  ])
  assert.equal(out.source, 'function $1foo_p(x){}')
})

test('append, prepend and template variables', () => {
  const out = run('body', 'f.js', [
    { target: 'f.js', append: '|{{id}}', __owner: 'me' },
    { target: 'f.js', prepend: '{{ext}}|' },
  ])
  assert.equal(out.source, '/ext/x|body|me')
})

test('a stale patch is reported and skipped, never thrown; optional is silent', () => {
  const out = run('abc', 'f.js', [
    { target: 'f.js', find: 'zzz', replace: 'y' },
    { target: 'f.js', find: 'qqq', replace: 'y', optional: true },
    { target: 'f.js', find: 'b', replace: 'B' },
  ])
  assert.equal(out.source, 'aBc')
  assert.equal(out.results[0].error, 'pattern not found')
  assert.equal(out.results[1].error, undefined)
})

test('patches only touch files they target', () => {
  const out = run('abc', 'other.js', [{ target: 'f.js', find: 'a', replace: 'X' }])
  assert.equal(out.source, 'abc')
  assert.equal(out.results.length, 0)
})

test('fingerprint is stable and empty for no patches', () => {
  assert.equal(fingerprintPatches([]), '')
  const p = [{ target: 'a', find: 'b', replace: 'c', __owner: 'o', __index: 0, __text: '' }]
  assert.equal(fingerprintPatches(p), fingerprintPatches(structuredClone(p)))
})
