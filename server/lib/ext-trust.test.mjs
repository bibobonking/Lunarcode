import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

process.env.CREATECODE_DATA = await mkdtemp(path.join(os.tmpdir(), 'cce-trust-'))
const ext = await import('./extensions.mjs')
const { collectModuleGraph, renderSandboxFrame, SANDBOX_CSP } = await import('./ext-sandbox.mjs')
ext.disableServerRuntime()
await ext.prepareExtensions('4.0.0')

test('new extensions are sandboxed and never relax the page CSP', async () => {
  const made = await ext.createExtension({ id: 'trust-demo', name: 'Trust demo', template: 'tool' })
  assert.equal(made.extension.trust, 'sandbox')
  await ext.setExtensionEnabled('trust-demo', true)
  const listed = (await ext.listExtensions()).extensions.find((item) => item.id === 'trust-demo')
  assert.equal(listed.enabled, true)
  assert.equal(listed.server.state, 'sandboxed')
  assert.equal(ext.extensionsActive(), false)
})

test('trusting needs the id as confirmation, resets anomalies and relaxes the CSP', async () => {
  await assert.rejects(ext.setExtensionTrust('trust-demo', 'trusted'), /confirmation/)
  await assert.rejects(ext.setExtensionTrust('trust-demo', 'trusted', { confirm: 'other' }), /confirmation/)
  await ext.reportAnomaly('trust-demo', { kind: 'network', level: 'medium', message: 'Tried to use fetch' })
  await ext.reportAnomaly('trust-demo', { kind: 'network', level: 'medium', message: 'Tried to use fetch' })
  const before = (await ext.listExtensions()).extensions.find((item) => item.id === 'trust-demo')
  assert.equal(before.anomalies.length, 1)
  assert.equal(before.anomalies[0].count, 2)
  await ext.setExtensionTrust('trust-demo', 'trusted', { confirm: 'trust-demo' })
  const after = (await ext.listExtensions()).extensions.find((item) => item.id === 'trust-demo')
  assert.equal(after.trust, 'trusted')
  assert.equal(after.anomalies.length, 0)
  assert.equal(ext.extensionsActive(), true)
  await ext.setExtensionTrust('trust-demo', 'sandbox')
  assert.equal(ext.extensionsActive(), false)
})

test('installing a new package over a trusted extension sends it back to the sandbox', async () => {
  await ext.setExtensionTrust('trust-demo', 'trusted', { confirm: 'trust-demo' })
  const archive = await ext.exportExtension('trust-demo')
  const updated = await ext.installArchive(archive)
  assert.equal(updated.extension.trust, 'sandbox')
  assert.equal(updated.extension.trustRevoked, 'updated')
})

test('the scan reports the daemon part of the tool template', async () => {
  const listed = (await ext.listExtensions()).extensions.find((item) => item.id === 'trust-demo')
  assert.ok(listed.risk.findings.some((finding) => finding.id === 'manifest-server'))
})

test('sandbox frame inlines relative modules and is served under a sandbox CSP', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cce-frame-'))
  await mkdir(path.join(dir, 'src/lib'), { recursive: true })
  await writeFile(path.join(dir, 'src/main.js'), "import { a } from './lib/a.js'\nexport default () => a\nconst lazy = () => import('./lib/b.js')\n")
  await writeFile(path.join(dir, 'src/lib/a.js'), "export { b } from './b.js'\nexport const a = 1\n")
  await writeFile(path.join(dir, 'src/lib/b.js'), 'export const b = 2\n')
  const graph = await collectModuleGraph(dir, 'src/main.js')
  assert.deepEqual(Object.keys(graph.modules).sort(), ['@cce/src/lib/a.js', '@cce/src/lib/b.js', '@cce/src/main.js'])
  assert.match(graph.modules['@cce/src/main.js'], /from '@cce\/src\/lib\/a\.js'/)
  assert.match(graph.modules['@cce/src/lib/a.js'], /from '@cce\/src\/lib\/b\.js'/)
  const html = await renderSandboxFrame({ record: { id: 'x', dir, manifest: { main: 'src/main.js' } }, role: 'logic', nonce: 'n' })
  assert.ok(html.includes('id="cce-boot"'))
  assert.ok(!/<\/script>[^<]*<\/script>.*<\/script>.*<\/script>/s.test(html))
  assert.match(SANDBOX_CSP, /^sandbox allow-scripts;.*connect-src 'none'/)
})

test('frame refuses module paths that leave the extension', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cce-frame2-'))
  await writeFile(path.join(dir, 'main.js'), "import '../../etc/passwd.js'\n")
  const graph = await collectModuleGraph(dir, 'main.js')
  assert.deepEqual(Object.keys(graph.modules), ['@cce/main.js'])
  assert.match(graph.modules['@cce/main.js'], /\.\.\/\.\.\/etc\/passwd\.js/)
})
