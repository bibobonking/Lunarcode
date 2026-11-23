import assert from 'node:assert/strict'
import test from 'node:test'
import { cliArguments, isLocalUrl, parseListeningPort } from './util.mjs'

test('parseListeningPort reads the daemon port from its startup line', () => {
  assert.equal(parseListeningPort('[opensol] daemon listening on http://127.0.0.1:4317'), 4317)
  assert.equal(parseListeningPort('[opensol] data: /home/me/.opensol'), null)
})

test('isLocalUrl only trusts the loading page and the local daemon', () => {
  assert.equal(isLocalUrl('http://127.0.0.1:4174/'), true)
  assert.equal(isLocalUrl('http://localhost:5173/'), true)
  assert.equal(isLocalUrl('file:///opt/OpenSol/resources/app.asar/loading/index.html'), true)
  assert.equal(isLocalUrl('about:blank'), true)
  assert.equal(isLocalUrl('blob:http://127.0.0.1:4174/6f1c'), true)
  assert.equal(isLocalUrl('data:text/html,<h1>x</h1>'), false)
  assert.equal(isLocalUrl('https://opensol.dev'), false)
  assert.equal(isLocalUrl('mailto:hello@opensoft.dev'), false)
  assert.equal(isLocalUrl('not a url'), false)
})

test('cliArguments only fires for CLI words, skipping the script path of `electron .`', () => {
  assert.deepEqual(cliArguments(['/opt/Lunarcode/Lunarcode', 'ext', 'list']), ['ext', 'list'])
  assert.deepEqual(cliArguments(['electron', '.', 'ext', 'pack', 'dir'], true), ['ext', 'pack', 'dir'])
  assert.equal(cliArguments(['/opt/Lunarcode/Lunarcode']), null)
  assert.equal(cliArguments(['/opt/Lunarcode/Lunarcode', '--no-sandbox']), null)
  assert.equal(cliArguments(['electron', '.'], true), null)
})
