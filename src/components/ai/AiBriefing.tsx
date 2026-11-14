/**
 * ACT AI Briefing: one assistant turn, in the page rather than the pane.
 *
 * ── Why this is thin ────────────────────────────────────────────────────
 *
 * Almost all of it already exists. `AiMessage` renders the prose through the
 * shared markdown layer, `ResearchTrail` renders what was looked up and how
 * far each lookup could see, and `AiThinking` and `AiErrorNotice` carry the
 * working and failed states in the same words the pane uses. This component
 * is the arrangement of those four plus the one thing a briefing has that a
 * chat reply does not: a stated purpose the reader agrees to before it runs.
 *
 * That reuse is the requirement, not an economy. A briefing with its own
 * renderer would eventually describe a failed lookup differently from the
 * pane, and "this lookup failed" reading as "no records found" on one surface
 * and not the other is the defect the shared layer was extracted to end.
 *
 * ── Why it does not run on its own ──────────────────────────────────────
 *
 * A briefing costs a model call and several seconds of tool lookups. Starting
 * one because a reader opened an asset spends that on everyone passing
 * through and replaces a page that paints immediately with a spinner. So the
 * reader is told what it will do and presses once; after that it is cached
 * and comes back without being paid for twice.
 *
 * ── The evidence is open by default ─────────────────────────────────────
 *
 * Opposite to the chat pane, deliberately. In a conversation the trail is
 * something to check when an answer surprises you. A briefing is read once,
 * in place of doing the reading yourself, so what it consulted is part of the
 * artifact rather than a disclosure behind a toggle.
 */
import { Sparkles, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import { AiMessage } from './AiMessage'
import { AiThinking, AiErrorNotice } from './AiStates'
import { ACT_AI_BRIEFING } from '../../lib/ai/brand'
import { BRIEFING_INTENT, BRIEFING_TITLE, type BriefingContext } from '../../lib/ai/briefing'
import type { AiRenderableMessage, AiSourceRef, MessageToolCall } from '../../lib/ai/presentation'

export interface AiBriefingProps {
  context: BriefingContext
  /** The answer, once there is one. */
  message: AiRenderableMessage | null
  toolCalls: MessageToolCall[]
  isLoading: boolean
  error: Error | null
  /** Asked for by the reader. Nothing runs until this is called. */
  onRun: () => void
  /** After a failure. Same handler as `onRun`; named apart for legibility. */
  onRetry?: () => void
  /** Carries the briefing's framing into the chat pane. Absent hides it. */
  onContinueInChat?: () => void
  /** Overrides the trail's default asset-page handoff. */
  onOpenSource?: (source: AiSourceRef) => void
  className?: string
}

export function AiBriefing({
  context, message, toolCalls, isLoading, error,
  onRun, onRetry, onContinueInChat, onOpenSource, className,
}: AiBriefingProps) {
  return (
    <section
      data-testid="ai-briefing"
      data-briefing-context={context}
      className={clsx(
        'rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900',
        className,
      )}
    >
      <header className="flex items-start gap-2.5 border-b border-gray-100 px-3.5 py-2.5 dark:border-gray-800">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-white">
            {ACT_AI_BRIEFING}
          </div>
          {/*
            Which of the two situations this is, and what the briefing will
            do about it. Shown before and after it runs: afterwards it is the
            frame the answer was written to, which is what lets a reader judge
            whether the answer is on topic.
          */}
          <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            <span data-testid="ai-briefing-context" className="font-medium">
              {BRIEFING_TITLE[context]}
            </span>
            {'. '}
            {BRIEFING_INTENT[context]}
          </div>
        </div>
      </header>

      <div className="px-3.5 py-3">
        {error ? (
          <AiErrorNotice error={error} onRetry={onRetry ?? onRun} />
        ) : isLoading ? (
          /* The pane's own working row, so "reading the firm's records" reads
             the same on both surfaces. */
          <AiThinking status="Reading what the firm holds…" />
        ) : message ? (
          <>
            {/*
              One evidence section, rendered by the message.

              This used to render a `ResearchTrail` of its own BESIDE
              `AiMessage` -- and the briefing's message already carries the
              same `tool_calls`, so the trail appeared twice. That is exactly
              the duplicated-evidence defect, in this component.

              The lookups are merged into the message rather than rendered
              separately, so `AiEvidence` sees one set and deduplicates it,
              and `evidenceOpen` keeps a briefing's sources expanded: a
              briefing is read once in place of doing the reading, so its
              sources are part of the artifact rather than something to go
              looking for.
            */}
            <AiMessage
              message={toolCalls.length > 0 ? { ...message, tool_calls: toolCalls } : message}
              evidenceOpen
              onOpenSource={onOpenSource}
            />
            {onContinueInChat && (
              <button
                type="button"
                data-testid="ai-briefing-continue"
                onClick={onContinueInChat}
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium
                           text-primary-600 hover:underline dark:text-primary-400"
              >
                Continue in ACT AI
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </>
        ) : (
          /*
            Before it has run. The button says what it will read, because the
            reader is agreeing to spend several seconds, and a bare "Generate"
            does not tell them what they are buying.
          */
          <button
            type="button"
            data-testid="ai-briefing-run"
            onClick={onRun}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5
                       text-[12px] font-medium text-gray-700 transition-colors
                       hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200
                       dark:hover:bg-gray-700"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary-500" />
            Brief me on this
          </button>
        )}
      </div>
    </section>
  )
}
