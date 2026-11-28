import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'createcode-providers-'))
process.env.CREATECODE_DATA = dataDir

const { saveModelsCache } = await import('./store.mjs')
const { listModels } = await import('./providers.mjs')

const catalog = {
  fetchedAt: Date.now(),
  providers: {
    opencode: {
      models: {
        'deepseek-v4.1-flash-free': {
          id: 'deepseek-v4.1-flash-free',
          name: 'DeepSeek V4.1 Flash Free',
          family: 'deepseek',
          reasoning: true,
          reasoning_options: [
            { type: 'toggle' },
            { type: 'effort', values: ['low', 'medium', 'high'] },
          ],
          tool_call: true,
          temperature: true,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 200000, output: 32000 },
          cost: {},
          provider: {},
          canonical_model_id: '',
        },
      },
    },
  },
}

await saveModelsCache(catalog)

function startServer(payload) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(payload))
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{}')
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` })
    })
  })
}

test('gateway models recover limits and capabilities from live metadata and the catalog', async (t) => {
  const payload = {
    object: 'list',
    data: [
      { id: 'oc/deepseek-v4.1-flash-free', object: 'model', owned_by: 'oc' },
      {
        id: 'openai/gpt-5.5',
        object: 'model',
        owned_by: 'openai',
        capabilities: {
          vision: true,
          tools: true,
          reasoning: true,
          thinkingCanDisable: true,
          thinkingEffortSupported: false,
          contextWindow: 1050000,
          maxOutput: 128000,
        },
      },
      {
        id: 'oc/jev-1.13-free',
        object: 'model',
        owned_by: 'oc',
        capabilities: {
          vision: false,
          tools: true,
          reasoning: false,
          contextWindow: 200000,
          maxOutput: 64000,
        },
      },
      {
        id: 'gc/gemini-2.5-pro',
        object: 'model',
        owned_by: 'gc',
        capabilities: {
          vision: true,
          tools: true,
          reasoning: true,
          thinkingRange: { min: 0, max: 24576 },
          contextWindow: 1048576,
          maxOutput: 65536,
        },
      },
      {
        id: 'thinkingmachines/inkling-2-mini',
        object: 'model',
        context_length: 1048576,
        top_provider: { context_length: 1048576, max_completion_tokens: 65536 },
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      },
      { id: 'openai/gpt-image-1', object: 'model' },
      { id: 'openai/search', object: 'model', kind: 'webSearch' },
    ],
  }
  const { server, baseUrl } = await startServer(payload)
  t.after(() => {
    server.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  const result = await listModels('custom', { providers: { custom: { baseUrl } } })
  assert.equal(result.source, 'live')
  assert.equal(result.models.length, 5)

  const byId = Object.fromEntries(result.models.map((model) => [model.id, model]))

  assert.equal(byId['oc/deepseek-v4.1-flash-free'].context, 200000)
  assert.equal(byId['oc/deepseek-v4.1-flash-free'].maxOutput, 32000)
  assert.equal(byId['oc/deepseek-v4.1-flash-free'].vision, false)
  assert.equal(byId['oc/deepseek-v4.1-flash-free'].name, 'DeepSeek V4.1 Flash Free')
  assert.deepEqual(byId['oc/deepseek-v4.1-flash-free'].reasoningOptions, [
    { type: 'toggle' },
    { type: 'effort', values: ['low', 'medium', 'high'] },
  ])

  assert.equal(byId['openai/gpt-5.5'].context, 1050000)
  assert.equal(byId['openai/gpt-5.5'].maxOutput, 128000)
  assert.equal(byId['openai/gpt-5.5'].vision, true)
  assert.equal(byId['openai/gpt-5.5'].toolCall, true)
  assert.deepEqual(byId['openai/gpt-5.5'].reasoningOptions, [{ type: 'toggle' }])

  assert.equal(byId['oc/jev-1.13-free'].context, 200000)
  assert.equal(byId['oc/jev-1.13-free'].maxOutput, 64000)
  assert.equal(byId['oc/jev-1.13-free'].vision, false)
  assert.deepEqual(byId['oc/jev-1.13-free'].reasoningOptions, [])

  assert.equal(byId['gc/gemini-2.5-pro'].context, 1048576)
  assert.deepEqual(byId['gc/gemini-2.5-pro'].reasoningOptions, [
    { type: 'budget_tokens', min: 0, max: 24576 },
  ])

  assert.equal(byId['thinkingmachines/inkling-2-mini'].context, 1048576)
  assert.equal(byId['thinkingmachines/inkling-2-mini'].maxOutput, 65536)
  assert.equal(byId['thinkingmachines/inkling-2-mini'].vision, true)
})
