import type { ModelInfo } from '../types'

/** The upstream prefix of a gateway model id ("oc/deepseek…" → "oc"). */
export function modelPrefix(id: string): string {
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(0, slash) : ''
}

/**
 * Routers such as 9router return every model they know about when no upstream is
 * connected, so the live list can contain hundreds of models that cannot be used.
 * When most ids carry an upstream prefix, keep the list on the upstream of the
 * model that is already in use. The manual model-id field still accepts anything.
 */
export function scopeGatewayModels(models: ModelInfo[], activeModelId: string): ModelInfo[] {
  if (models.length < 40) return models
  const prefix = modelPrefix(activeModelId)
  if (!prefix) return models
  let prefixed = 0
  let scoped = 0
  for (const model of models) {
    const candidate = modelPrefix(model.id)
    if (!candidate) continue
    prefixed += 1
    if (candidate === prefix) scoped += 1
  }
  if (prefixed < models.length * 0.8 || scoped === 0) return models
  return models.filter((model) => modelPrefix(model.id) === prefix)
}
