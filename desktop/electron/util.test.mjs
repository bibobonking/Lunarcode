import assert from 'node:assert/strict'
import test from 'node:test'
import { cliArguments, isLocalUrl, parseListeningPort } from './util.mjs'

test('parseListeningPort reads the daemon port from its startup line', () => {
  assert.equal(parseListeningPort('[createcode] daemon listening on http://127.0.0.1:4317'), 4317)
  assert.equal(parseListeningPort('[createcode] data: /home/me/.createcode'), null)
})

test('isLocalUrl only trusts the loading page and the local daemon', () => {
  assert.equal(isLocalUrl('http://127.0.0.1:4174/'), true)
  assert.equal(isLocalUrl('http://localhost:5173/'), true)
  assert.equal(isLocalUrl('file:///opt/CreateCode/resources/app.asar/loading/index.html'), true)
  assert.equal(isLocalUrl('about:blank'), true)
  assert.equal(isLocalUrl('blob:http://127.0.0.1:4174/6f1c'), true)
  assert.equal(isLocalUrl('data:text/html,<h1>x</h1>'), false)
  assert.equal(isLocalUrl('https://createcode.dev'), false)
  assert.equal(isLocalUrl('mailto:hello@example.com'), false)
  assert.equal(isLocalUrl('not a url'), false)
})

test('cliArguments only fires for CLI words, skipping the script path of `electron .`', () => {
  assert.deepEqual(cliArguments(['/opt/CreateCode/CreateCode', 'ext', 'list']), ['ext', 'list'])
  assert.deepEqual(cliArguments(['electron', '.', 'ext', 'pack', 'dir'], true), ['ext', 'pack', 'dir'])
  assert.equal(cliArguments(['/opt/CreateCode/CreateCode']), null)
  assert.equal(cliArguments(['/opt/CreateCode/CreateCode', '--no-sandbox']), null)
  assert.equal(cliArguments(['electron', '.'], true), null)
})
