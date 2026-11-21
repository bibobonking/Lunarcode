import type { Context } from 'cordis'
import { normalizeTodos, todoProgress } from '../../../lib/todos'

export const name = 'tool-todo'
export const inject = ['tools']

export function apply(ctx: Context) {
  return ctx.tools.register({
    name: 'todo_write',
    description:
      'Create and update a task list for the current job so the user can follow your plan. Use it for work with three or more steps. ' +
      'Each call sends the COMPLETE list and replaces the previous one. Statuses: `pending`, `in_progress` (at most one at a time) and `completed`. ' +
      'Mark an item completed as soon as it is finished, and put the next one in progress before you start it. Do not use it for one trivial step or a plain question. Works in Plan mode too.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The full task list, in the order you will do it.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Short, concrete task (imperative), e.g. "Add the login form".' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args) {
      const items = normalizeTodos(args)
      if (items.length === 0) {
        return { output: 'todo_write needs a non-empty "todos" array of {content, status}.', isError: true }
      }
      const { done, total, active } = todoProgress(items)
      return {
        output: `Todo list updated: ${done}/${total} completed.${active ? ` In progress: ${active.content}.` : ''} Continue with the work.`,
        isError: false,
        data: { todos: items },
      }
    },
  })
}
