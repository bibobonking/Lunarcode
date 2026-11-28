import test from 'node:test'
import assert from 'node:assert/strict'
import { scanExtension } from './ext-scan.mjs'

const scan = (files, manifest = { id: 'x', name: 'x', version: '1.0.0' }) => scanExtension({ manifest, files })
const ids = (result) => result.findings.map((finding) => finding.id)

test('a plain extension is clean', () => {
  const result = scan({ 'main.js': "export default (cc) => cc.registerCommand('hi', 'Hi', () => cc.notify('hi'))\n", 'style.css': 'body{color:red}' })
  assert.equal(result.level, 'none')
  assert.deepEqual(result.findings, [])
})

test('flags commands, eval, secrets and credentials as high', () => {
  const result = scan({
    'server.mjs': "import { exec } from 'node:child_process'\nexec('ls')\n",
    'main.js': "eval(atob('x'))\nconst p = '~/.ssh/id_rsa'\nfs.readFile('secrets.enc')\n",
  })
  assert.equal(result.level, 'high')
  for (const id of ['exec', 'eval', 'credentials', 'secrets']) assert.ok(ids(result).includes(id), id)
})

test('network and storage access are medium', () => {
  const result = scan({ 'main.js': "fetch('https://x.test')\ndocument.cookie\n" })
  assert.equal(result.level, 'medium')
  assert.deepEqual(new Set(ids(result)), new Set(['network', 'cookies']))
})

test('manifest server and patches are reported', () => {
  const result = scan(
    {},
    {
      id: 'x', name: 'x', version: '1.0.0', server: 'server.mjs',
      patches: [{ scope: 'server', target: 'server/lib/providers.mjs' }, { scope: 'web', target: 'index.html' }],
    },
  )
  assert.equal(result.level, 'high')
  assert.equal(result.findings.filter((item) => item.id === 'manifest-patch').length, 2)
  assert.ok(ids(result).includes('manifest-server'))
})

test('findings are capped per rule and file, highest level first', () => {
  const lines = Array.from({ length: 30 }, () => "fetch('/a')").join('\n')
  const result = scan({ 'main.js': `${lines}\neval('1')` })
  assert.equal(result.findings.filter((item) => item.id === 'network').length, 3)
  assert.equal(result.findings[0].level, 'high')
})

test('minified code, long payloads and remote css are noticed', () => {
  const result = scan({ 'main.js': `var a="${'A'.repeat(450)}";${'x=1;'.repeat(1200)}`, 'style.css': "@import url('https://x.test/a.css');" })
  for (const id of ['blob', 'minified', 'css-remote']) assert.ok(ids(result).includes(id), id)
})

test('binary and node_modules files are skipped', () => {
  const result = scan({ 'node_modules/a/index.js': 'eval(1)', 'logo.png': new Uint8Array([1, 2, 3]) })
  assert.equal(result.level, 'none')
})
