import { normalizeQuestions } from './ask-question'
import type { BuiltinToolName, ToolName } from '../types'

export function toolLabel(name: ToolName): string {
  if (name.startsWith('mcp__')) return name.split('__').slice(2).join(' ').replace(/_/g, ' ') || 'MCP tool'
  const labels: Record<BuiltinToolName, string> = {
    shell: 'Shell',
    read_file: 'Read file',
    list_files: 'List files',
    write_file: 'Write file',
    edit_file: 'Edit file',
    rewrite_file: 'Rewrite file',
    grep: 'Grep',
    web_search: 'Web search',
    read_url: 'Read URL',
    git: 'Git',
    subagent: 'Subagent',
    skill: 'Skill',
    ask_question: 'Question',
    todo_write: 'Todo list',
  }
  return labels[name as BuiltinToolName] ?? 'Tool'
}

function todoSummary(args: Record<string, unknown>): string {
  const list = Array.isArray(args.todos) ? args.todos : []
  const done = list.filter((item) => item && typeof item === 'object' && (item as { status?: unknown }).status === 'completed').length
  return list.length ? `${done}/${list.length} done` : ''
}

function questionSummary(args: Record<string, unknown>): string {
  const questions = normalizeQuestions(args)
  if (questions.length === 0) return ''
  return questions.length === 1 ? questions[0].question : `${questions.length} questions`
}

export function toolSummary(name: ToolName, args: Record<string, unknown>): string {
  const value =
    name === 'shell'
      ? args.command
      : name === 'grep'
        ? args.pattern
        : name === 'web_search'
          ? args.query
          : name === 'read_url'
            ? args.url
            : name === 'git'
              ? args.action
              : name === 'subagent'
                ? args.task
                : name === 'skill'
                  ? [args.name, args.file].filter(Boolean).join(' / ')
                  : name === 'todo_write'
                    ? todoSummary(args)
                    : name === 'ask_question'
                    ? questionSummary(args)
                : (args.path ?? '')
  return typeof value === 'string' ? value : ''
}
