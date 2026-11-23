import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { readExtensionArchive } from '../shared/lce.mjs'
import { parseArgs } from './cli.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs')
const run = (cwd, data, ...args) => execFileSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, LUNARCODE_DATA: data }, encoding: 'utf8' })

test('parseArgs takes --k=v, --k v and bare flags', () => {
  const { flags, positional } = parseArgs(['ext-dir', '--name', 'My Ext', '--version=1.2.0', '--enable', 'out.lce'])
  assert.deepEqual(flags, { name: 'My Ext', version: '1.2.0', enable: true })
  assert.deepEqual(positional, ['ext-dir', 'out.lce'])
})

test('ext pack zips a plain folder using name, version and description', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lce-cli-'))
  const dir = path.join(root, 'My Folder')
  mkdirSync(path.join(dir, 'sub'), { recursive: true })
  writeFileSync(path.join(dir, 'main.js'), 'export default {}')
  writeFileSync(path.join(dir, 'style.css'), 'body{}')
  writeFileSync(path.join(dir, 'sub', 'data.txt'), 'x')
  const out = run(root, path.join(root, 'data'), 'ext', 'pack', dir, '--name=Cool Ext', '--version', '2.1.0', '--desc=Short one')
  assert.match(out, /Packed Cool Ext 2\.1\.0/)
  const { manifest, files } = readExtensionArchive(readFileSync(path.join(root, 'my-folder-2.1.0.lce')))
  assert.equal(manifest.id, 'my-folder')
  assert.equal(manifest.name, 'Cool Ext')
  assert.equal(manifest.description, 'Short one')
  assert.equal(manifest.main, 'main.js')
  assert.deepEqual(manifest.styles, ['style.css'])
  assert.ok(files.has('sub/data.txt'))
})

test('ext pack flags override an existing extension.json, and the output file is not packed into itself', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lce-cli-'))
  const dir = path.join(root, 'ext')
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'extension.json'), JSON.stringify({ id: 'abc', name: 'Old', version: '1.0.0', main: 'main.js' }))
  writeFileSync(path.join(dir, 'main.js'), '')
  const target = path.join(dir, 'out.lce')
  run(root, path.join(root, 'data'), 'ext', 'pack', dir, target, '--version=1.0.1')
  run(root, path.join(root, 'data'), 'ext', 'pack', dir, target, '--version=1.0.2')
  const { manifest, files } = readExtensionArchive(readFileSync(target))
  assert.equal(manifest.version, '1.0.2')
  assert.equal(manifest.name, 'Old')
  assert.equal(files.has('out.lce'), false)
})
