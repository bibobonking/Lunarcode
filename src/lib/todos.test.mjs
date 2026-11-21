import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTodos, todoProgress } from './todos.ts'
import { parseAnsi } from './ansi.ts'

test('normalizeTodos drops junk, defaults status and keeps one in_progress', () => {
  const items = normalizeTodos({
    todos: [
      { content: ' Plan ', status: 'completed' },
      { content: 'Build', status: 'in_progress' },
      { content: 'Test', status: 'in_progress' },
      { content: '', status: 'pending' },
      { content: 'Ship', status: 'weird' },
      null,
    ],
  })
  assert.deepEqual(items.map((item) => item.status), ['completed', 'in_progress', 'pending', 'pending'])
  assert.equal(items[0].content, 'Plan')
  assert.deepEqual(normalizeTodos({}), [])
  const progress = todoProgress(items)
  assert.equal(progress.done, 1)
  assert.equal(progress.total, 4)
  assert.equal(progress.active?.content, 'Build')
})

test('parseAnsi splits colour runs and strips other escapes', () => {
  const { spans } = parseAnsi('plain \u001b[31mred\u001b[0m \u001b[1;32mok\u001b[0m\u001b[2K')
  assert.deepEqual(spans.map((span) => span.text), ['plain ', 'red', ' ', 'ok'])
  assert.ok(spans[1].color)
  assert.equal(spans[3].bold, true)
  assert.equal(spans[0].color, undefined)
})
