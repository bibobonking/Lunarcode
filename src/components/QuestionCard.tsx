import { useMemo, useRef } from 'react'
import { Check, CircleHelp, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ToolMessage } from '../types'
import { answerIsComplete, emptyAnswer, normalizeQuestions, readResult, type AskAnswer, type AskQuestion } from '../lib/ask-question'
import { answerQuestions, dismissQuestions, useQuestions } from '../store/questions'
import { cn } from '../lib/utils'
import { RadioMark, CheckMark } from './ui'

function Indicator({ checked, multi }: { checked: boolean; multi: boolean }) {
  return <span className="mt-0.5 shrink-0">{multi ? <CheckMark checked={checked} /> : <RadioMark checked={checked} />}</span>
}

function answerText(answer: AskAnswer): string {
  const parts = [...answer.selected]
  if (answer.custom.trim()) parts.push(answer.custom.trim())
  return parts.join(' · ')
}

/** Read-only view of a question that was answered, skipped or never finished. */
function Summary({ message, questions }: { message: ToolMessage; questions: AskQuestion[] }) {
  const result = readResult(message.data, questions.length)
  const skipped = result?.dismissed === true
  const interrupted = !result && message.status !== 'done'
  return (
    <div className="adw-boxed px-3 py-2 text-[13px]">
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        <CircleHelp size={16} className="text-muted" />
        {skipped ? 'Questions skipped' : interrupted ? 'Question not answered' : questions.length === 1 ? 'Question answered' : `${questions.length} questions answered`}
      </p>
      <ul className="mt-1.5 space-y-1.5 pl-6">
        {questions.map((question, index) => {
          const answer = result?.answers[index]
          return (
            <li key={index} className="leading-snug">
              <p className="text-muted">{question.question}</p>
              {answer && answerIsComplete(answer) && !skipped && <p className="mt-0.5 text-ink">{answerText(answer)}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function QuestionCard({ message }: { message: ToolMessage }) {
  const callId = message.call.id
  const questions = useMemo(() => normalizeQuestions(message.call.args), [message.call.args])
  const waiting = useQuestions((state) => Boolean(state.waiting[callId]))
  const draft = useQuestions((state) => state.drafts[callId])
  const patchDraft = useQuestions((state) => state.patchDraft)
  const root = useRef<HTMLDivElement>(null)

  if (questions.length === 0 || !waiting || !draft) return <Summary message={message} questions={questions} />

  const step = Math.min(draft.step, questions.length - 1)
  const question = questions[step]
  const answer = draft.answers[step] ?? emptyAnswer()
  const last = step === questions.length - 1
  const answered = questions.map((_, index) => answerIsComplete(draft.answers[index]))
  const allAnswered = answered.every(Boolean)
  const answeredCount = answered.filter(Boolean).length

  // Always patch the newest draft from the store. Closing over `draft` here is what used to wipe answers.
  const update = (patch: Partial<AskAnswer>) =>
    patchDraft(callId, (current) => ({
      ...current,
      answers: current.answers.map((item, index) => (index === step ? { ...item, ...patch } : item)),
    }))
  const go = (target: number) =>
    patchDraft(callId, (current) => ({ ...current, step: Math.max(0, Math.min(questions.length - 1, target)) }))

  const choose = (label: string) => {
    if (question.multiSelect) {
      const selected = answer.selected.includes(label) ? answer.selected.filter((item) => item !== label) : [...answer.selected, label]
      update({ selected })
      return
    }
    // One answer per question: a preset replaces whatever was typed. Picking the same one again clears it.
    // It never jumps to another question; the person moves with Next, Back or the tabs.
    const same = answer.selected[0] === label && !answer.custom
    update({ selected: same ? [] : [label], custom: '' })
  }

  const type = (custom: string) => {
    update(question.multiSelect ? { custom } : { custom, selected: custom.trim() ? [] : answer.selected })
  }

  const submit = () => {
    if (allAnswered) answerQuestions(callId, draft.answers)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (event.key === 'Enter' && target.tagName === 'INPUT') {
      event.preventDefault()
      if (!answerIsComplete(answer)) return
      if (last) submit()
      else go(step + 1)
      return
    }
    if (target.tagName === 'INPUT' || event.metaKey || event.ctrlKey || event.altKey) return
    const number = Number(event.key)
    if (Number.isInteger(number) && number >= 1 && number <= question.options.length) {
      event.preventDefault()
      choose(question.options[number - 1].label)
    } else if (event.key === 'ArrowRight' && !last) go(step + 1)
    else if (event.key === 'ArrowLeft' && step > 0) go(step - 1)
  }

  return (
    <div
      ref={root}
      onKeyDown={onKeyDown}
      className="adw-boxed my-1.5 p-4 text-[13px]"
      role="group"
      aria-label="Question from the agent"
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold text-warning">
        <CircleHelp size={16} />
        <span>{questions.length > 1 ? `Question ${step + 1} of ${questions.length}` : 'Question'}</span>
        <span className="ml-auto font-normal text-muted">The agent is waiting for you</span>
      </div>

      {questions.length > 1 && (
        <div className="thin-scroll mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5" role="tablist">
          {questions.map((item, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === step}
              onClick={() => go(index)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1 rounded-[9px] px-3 text-[12px] font-semibold transition-colors',
                index === step ? 'bg-ink/[.11] text-ink' : 'text-muted hover:bg-ink/[.07] hover:text-ink',
              )}
            >
              {answered[index] && <Check size={14} className="text-success" />}
              {item.header || `Q${index + 1}`}
            </button>
          ))}
        </div>
      )}

      <p key={step} className="mt-3 text-[14px] font-semibold leading-snug text-ink">
        {question.question}
      </p>
      <p className="mt-0.5 text-[12px] text-muted">{question.multiSelect ? 'Select all that apply' : 'Select one'}</p>

      <div key={`o${step}`} className="mt-2.5 space-y-1.5">
        {question.options.map((option, index) => {
          const checked = answer.selected.includes(option.label)
          return (
            <button
              key={option.label}
              type="button"
              role={question.multiSelect ? 'checkbox' : 'radio'}
              aria-checked={checked}
              onClick={() => choose(option.label)}
              className={cn(
                'flex min-h-[44px] w-full items-start gap-2.5 rounded-[9px] border px-3 py-2 text-left transition-colors',
                checked ? 'border-accent bg-accent-soft' : 'border-line hover:bg-ink/[.05]',
              )}
            >
              <Indicator checked={checked} multi={question.multiSelect} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug text-ink">{option.label}</span>
                {option.description && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{option.description}</span>}
              </span>
              {index < 9 && <kbd className="mt-0.5 shrink-0 font-mono text-[12px] text-faint">{index + 1}</kbd>}
            </button>
          )
        })}

        {/* Always the last row of every question: the person can answer in their own words. */}
        <label
          className={cn(
            'flex min-h-[44px] items-start gap-2.5 rounded-[9px] border px-3 py-2 transition-colors focus-within:border-accent',
            answer.custom.trim() ? 'border-accent bg-accent-soft' : 'border-line',
          )}
        >
          <Indicator checked={Boolean(answer.custom.trim())} multi={question.multiSelect} />
          <input
            value={answer.custom}
            onChange={(event) => type(event.target.value)}
            maxLength={2000}
            placeholder={question.options.length > 0 ? 'Something else… type your own answer' : 'Type your answer'}
            aria-label="Your own answer"
            className="min-w-0 flex-1 bg-transparent text-[13px] leading-snug text-ink outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => dismissQuestions(callId)}
          className="adw-btn adw-btn-flat h-8"
        >
          Skip
        </button>
        <span className="ml-auto text-[12px] text-muted">
          {questions.length > 1 ? `${answeredCount}/${questions.length} answered` : ''}
        </span>
        {step > 0 && (
          <button
            type="button"
            onClick={() => go(step - 1)}
            className="adw-btn h-8"
          >
            <ChevronLeft size={16} /> Back
          </button>
        )}
        {last ? (
          <button
            type="button"
            onClick={submit}
            disabled={!allAnswered}
            className="adw-btn adw-btn-suggested h-8"
          >
            Submit answers
          </button>
        ) : (
          <button
            type="button"
            onClick={() => go(step + 1)}
            className="adw-btn adw-btn-suggested h-8"
          >
            Next <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
