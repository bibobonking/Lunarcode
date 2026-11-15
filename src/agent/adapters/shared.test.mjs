import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveToolName } from './shared.ts'

test('a tool name that is offered is used unchanged', () => {
  const available = new Set(['read_file', 'mcp__blockbench__capture_screenshot'])
  assert.equal(resolveToolName('read_file', available), 'read_file')
  assert.equal(resolveToolName('mcp__blockbench__capture_screenshot', available), 'mcp__blockbench__capture_screenshot')
})

test('the names models use for the file tools resolve to the offered tool', () => {
  const available = new Set(['read_file', 'list_files'])
  for (const name of ['read', 'readFile', 'read-file', 'view', 'cat', 'READ']) {
    assert.equal(resolveToolName(name, available), 'read_file', name)
  }
  for (const name of ['list', 'ls', 'listFiles', 'list-files']) {
    assert.equal(resolveToolName(name, available), 'list_files', name)
  }
})

test('an alias never hides a real tool with that name', () => {
  const available = new Set(['read', 'read_file'])
  assert.equal(resolveToolName('read', available), 'read')
})

test('an alias whose target is not offered still fails', () => {
  assert.equal(resolveToolName('read', new Set(['list_files'])), undefined)
  assert.equal(resolveToolName('delete_everything', new Set(['read_file'])), undefined)
})
