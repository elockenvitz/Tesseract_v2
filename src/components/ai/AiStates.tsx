/**
 * The states that are not an answer: working, failed, and nothing yet.
 *
 * ── Why these are components and not inline JSX ──────────────────────────
 *
 * The chat pane and a contextual briefing have to say the same things in the
 * same words. "This lookup failed" meaning one thing in the panel and another
 * on the asset page is the defect class this whole layer exists to stop.
 *
 * ── What changed from the inline versions ────────────────────────────────
 *
 * A failed turn had no way back. The error rendered as a red strip with the
 * message text and nothing else, so the reader's only move was to retype what
 * they had just typed — and the hook pops the failed message, so the text was
 * gone from the thread too. `AiErrorNotice` takes a retry.
 */
import type { ReactNode } from 'react'
import { AlertCircle, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'

/**
 * The working row, shown only until prose starts arriving.
 *
 * `status` is a grounded activity from the stream — a tool name translated on
 * the client — never model text, and never a description of its reasoning.
 */
export function AiThinking({ status, onStop }: { status?: string | null; onStop?: () => void }) {
  return (
    <div className="flex justify-start" data-testid="ai-thinking">
      <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary-500" />
          <span className="text-sm text-gray-600 dark:text-gray-400">{status ?? 'Working…'}</span>
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400
                         dark:hover:text-gray-200 underline underline-offset-2"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A turn that failed, with the way back.
 *
 * `onRetry` is offered only when the caller still holds what was sent. A
 * Retry that silently sends something else, or nothing, would be worse than
 * no Retry at all.
 */
export function AiErrorNotice({
  error, onRetry, className,
}: {
  error: Error | { message?: string } | null
  onRetry?: () => void
  className?: string
}) {
  if (!error) return null
  return (
    <div
      data-testid="ai-error"
      className={clsx(
        'rounded-lg border border-red-200 bg-red-50 px-3 py-2.5',
        'dark:border-red-800 dark:bg-red-900/20',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-red-700 dark:text-red-300">
            Couldn't get a response
          </div>
          <div className="mt-0.5 text-[11px] text-red-700/80 dark:text-red-300/80 break-words">
            {error.message || 'Try again, or rephrase your question.'}
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px]
                       font-medium text-red-700 hover:bg-red-100
                       dark:text-red-300 dark:hover:bg-red-900/40"
            title="Send that question again"
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * An empty thread: the prompts ARE the explanation.
 *
 * No heading, because a line of copy telling the reader they can ask questions
 * says less than four questions worth asking. The fixed height and two-line
 * clamp keep every button the same size, so the layout does not jump as the
 * suggestions change with the asset.
 */
export function AiPrompts({
  suggestions, onPick, header, className, columns = 1,
}: {
  /**
   * The questions. A plain string, or a question with the records that
   * justify it.
   *
   * The union rather than a second prop: every caller renders the same
   * button, and a surface that has not adopted grounded prompts yet should
   * not have to pass `{ text, reason: null }` to say so.
   */
  suggestions: ReadonlyArray<string | { text: string; reason?: string | null }>
  onPick: (suggestion: string) => void
  /** Anything to show above the prompts — an error, a context note. */
  header?: ReactNode
  className?: string
  /**
   * How many sit across. Research mode has the width for two, which is the
   * difference between four questions and six fitting above the composer
   * without the column running past the reading measure.
   */
  columns?: 1 | 2
}) {
  const wide = columns === 2
  return (
    <div
      /*
       * It arrives rather than appears.
       *
       * The thread area is deliberately empty while the pane works out what
       * it is showing -- a skeleton there would be the very flash the settle
       * gate exists to remove. But empty-then-present with no motion reads as
       * a jump, which is what "blank for a second and then it pops in" is
       * describing. A 10px rise over 300ms turns the same two states into one
       * movement, with no placeholder and no added delay.
       *
       * `motion-reduce:animate-none` because an entrance is decoration: a
       * reader who has asked their system for less motion gets the content
       * with none.
       */
      className={clsx(
        'flex h-full flex-col items-center justify-center px-4 text-center',
        'animate-slide-up motion-reduce:animate-none',
        className,
      )}
    >
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full
                      bg-gradient-to-br from-primary-100 to-purple-100
                      dark:from-primary-900/30 dark:to-purple-900/30">
        <Sparkles className="h-5 w-5 text-primary-500" />
      </div>
      {header && (
        <div className={clsx('mb-3 w-full text-left', wide ? 'max-w-2xl' : 'max-w-sm')}>{header}</div>
      )}
      <div
        data-testid="ai-prompts"
        className={clsx(
          'w-full',
          /* Roomier than it was. Each button is now two lines of text rather
             than one, so a 8px gutter read as a single block of grey with
             hairlines through it rather than as four separate choices. */
          wide ? 'grid max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2' : 'max-w-sm space-y-2.5',
        )}
      >
        {suggestions.map((entry, i) => {
          const text = typeof entry === 'string' ? entry : entry.text
          const reason = typeof entry === 'string' ? null : (entry.reason ?? null)
          return (
            <button
              key={text || i}
              onClick={() => onPick(text)}
              /*
                `min-h` rather than a fixed 56px: a reason adds a second line,
                and a fixed height clipped it. Items with and without one sit
                in the same grid, so the floor keeps the row heights even.
              */
              className="flex min-h-[56px] w-full flex-col justify-center gap-1 rounded-lg
                         bg-gray-100 px-3.5 py-2.5 text-left text-sm text-gray-700
                         transition-colors hover:bg-gray-200
                         dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              title={reason ? `${text}\n${reason}` : text}
            >
              <span className="line-clamp-2 font-medium leading-snug">{text}</span>
              {/*
                Why this question is being offered, in records. Quieter than
                the question and never a substitute for it: a reader scanning
                four buttons reads the questions, and the reason is what they
                check when one of them surprises them.
              */}
              {reason && (
                <span
                  data-testid="ai-prompt-reason"
                  /*
                    Bigger and lighter than it was, which is not a
                    contradiction. It was 10.5px semibold in `gray-500` on a
                    `gray-800` panel: too small to read comfortably and, in
                    dark mode, too close to its own background. Now 11px at
                    normal weight, and a step brighter in the dark theme, so
                    the question still dominates by WEIGHT rather than by the
                    reason being hard to see.
                  */
                  className="line-clamp-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400"
                >
                  {reason}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
