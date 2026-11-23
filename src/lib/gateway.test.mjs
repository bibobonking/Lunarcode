import assert from 'node:assert/strict'
import test from 'node:test'
import { modelPrefix, scopeGatewayModels } from './gateway.ts'

function models(ids) {
  return ids.map((id) => ({
    id,
    name: id,
    reasoningOptions: [],
    toolCall: true,
    temperature: true,
    apiKind: 'openai-chat',
  }))
}

test('modelPrefix returns the upstream of a gateway id', () => {
  assert.equal(modelPrefix('oc/deepseek-v4.1-flash-free'), 'oc')
  assert.equal(modelPrefix('deepseek-v4.1-flash-free'), '')
  assert.equal(modelPrefix('/leading-slash'), '')
})

test('a large gateway list is scoped to the active model upstream', () => {
  const list = [
    ...Array.from({ length: 30 }, (_, i) => `oc/model-${i}`),
    ...Array.from({ length: 20 }, (_, i) => `openai/model-${i}`),
    ...Array.from({ length: 5 }, (_, i) => `anthropic/model-${i}`),
  ]
  const scoped = scopeGatewayModels(models(list), 'oc/model-0')
  assert.equal(scoped.length, 30)
  assert.ok(scoped.every((model) => model.id.startsWith('oc/')))
})

test('small, unprefixed and unrelated lists are left alone', () => {
  assert.equal(scopeGatewayModels(models(['oc/a', 'oc/b']), 'oc/a').length, 2)
  assert.equal(
    scopeGatewayModels(
      models(Array.from({ length: 50 }, (_, i) => `local-model-${i}`)),
      'local-model-0',
    ).length,
    50,
  )
  assert.equal(
    scopeGatewayModels(
      models([
        ...Array.from({ length: 10 }, (_, i) => `oc/model-${i}`),
        ...Array.from({ length: 50 }, (_, i) => `local-model-${i}`),
      ]),
      'oc/model-0',
    ).length,
    60,
  )
  assert.equal(
    scopeGatewayModels(
      models([
        ...Array.from({ length: 30 }, (_, i) => `oc/model-${i}`),
        ...Array.from({ length: 20 }, (_, i) => `openai/model-${i}`),
      ]),
      'missing/model',
    ).length,
    50,
  )
})
