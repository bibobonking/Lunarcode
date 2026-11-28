import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { CceError, packExtension, readExtensionArchive, readZip, satisfies, validateManifest, writeZip } from './cce.mjs'

const manifest = { id: 'demo-ext', name: 'Demo', version: '1.2.3', main: 'main.js', styles: ['a.css'] }

test('pack then read round-trips every file, including binary', () => {
  const binary = Buffer.from([0, 255, 1, 254, 2, 253])
  const { bytes } = packExtension({ manifest, files: { 'main.js': 'export default () => {}', 'a.css': 'a{}', 'img/logo.bin': binary, 'deep/a/b/c.txt': 'x'.repeat(5000) } })
  const read = readExtensionArchive(bytes)
  assert.equal(read.manifest.id, 'demo-ext')
  assert.deepEqual(read.files.get('img/logo.bin'), binary)
  assert.equal(read.files.get('deep/a/b/c.txt').length, 5000)
})

test('output is deterministic', () => {
  const a = packExtension({ manifest, files: { 'main.js': 'x', 'a.css': 'y' } }).bytes
  const b = packExtension({ manifest, files: { 'a.css': 'y', 'main.js': 'x' } }).bytes
  assert.ok(a.equals(b))
})

test('a zipped folder with one top-level directory is unwrapped', () => {
  const zip = writeZip({ 'wrapped/extension.json': JSON.stringify(manifest), 'wrapped/main.js': 'x', 'wrapped/a.css': 'y' })
  assert.equal(readExtensionArchive(zip).files.has('main.js'), true)
})

test('manifest problems are explained', () => {
  assert.throws(() => validateManifest({ id: 'A', name: 'x', version: '1.0.0' }), /manifest\.id/)
  assert.throws(() => validateManifest({ id: 'ok-id', name: 'x', version: '1' }), /version/)
  assert.throws(() => validateManifest({ ...manifest, main: '../evil.js' }), /unsafe/)
  assert.throws(() => validateManifest({ ...manifest, main: 'x.txt' }), /\.js/)
  assert.throws(() => validateManifest({ ...manifest, engine: '>=9.0.0' }, { appVersion: '4.0.0' }), /needs CreateCode/)
  assert.throws(() => validateManifest({ ...manifest, patches: [{ target: 'a', find: 'x' }] }), /exactly one/)
  assert.throws(() => validateManifest({ ...manifest, patches: [{ target: 'a', find: { regex: '(' }, replace: 'x' }] }), /compile/)
  assert.throws(() => validateManifest({ ...manifest, themes: [{ id: 't', label: 'T', tokens: { canvas: 'red' } }] }), /triplet/)
})

test('no capabilities, API version or domain list exist: unknown fields are kept, not rejected', () => {
  const ok = validateManifest({ ...manifest, anything: { goes: true } })
  assert.deepEqual(ok.anything, { goes: true })
})

test('missing files named by the manifest are rejected at install time', () => {
  const zip = writeZip({ 'extension.json': JSON.stringify(manifest), 'main.js': 'x' })
  assert.throws(() => readExtensionArchive(zip), /a\.css/)
})

test('zip-slip, corruption and non-zips are refused', () => {
  const evil = writeZip({ 'extension.json': '{}' })
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), CceError)
  const good = writeZip({ 'a.txt': 'hello hello hello hello' })
  const bad = Buffer.from(good)
  bad[40] ^= 0xff // flip a payload byte
  assert.throws(() => readZip(bad))
  assert.ok(evil.length > 0)
  // Hand-built archive with a traversal name.
  const name = Buffer.from('../x.txt')
  const data = Buffer.from('x')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt32LE(0, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 10)
  const cdOffset = 30 + name.length + data.length
  eocd.writeUInt32LE(46 + name.length, 12)
  eocd.writeUInt32LE(cdOffset, 16)
  void deflateRawSync
  assert.throws(() => readZip(Buffer.concat([local, name, data, central, name, eocd])), /unsafe|checksum/)
})

test('engine ranges', () => {
  assert.equal(satisfies('4.0.0', '>=4.0.0'), true)
  assert.equal(satisfies('3.3.0', '>=4.0.0'), false)
  assert.equal(satisfies('4.2.1', '^4.0.0'), true)
  assert.equal(satisfies('5.0.0', '^4.0.0'), false)
  assert.equal(satisfies('4.1.9', '~4.1.0'), true)
  assert.equal(satisfies('4.2.0', '>=4.0.0 <4.2.0'), false)
  assert.equal(satisfies('4.0.0', '*'), true)
})
