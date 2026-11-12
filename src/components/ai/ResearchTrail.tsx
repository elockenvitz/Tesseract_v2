/**
 * What the assistant looked up, and what came back.
 *
 * ── Why this is its own module ────────────────────────────────────────────
 *
 * It was a module-local function inside `AISection.tsx`, which meant a
 * contextual briefing could only reuse it by copying it — and a second copy of
 * the three-status logic is exactly how "the lookup failed" starts rendering
 * as "no records found" again on one surface and not the other.
 *
 * ── The one rule it exists to enforce ─────────────────────────────────────
 *
 * Three statuses, three different sentences. `ok` found records, `empty`
 * searched and matched nothing, `error` means the search never ran. The last
 * two are not the same fact and must never read the same way: conflating them
 * is how a reader is told the firm holds no research on a name when the query
 * simply fell over. The earlier version printed `result_summary` — the tool's
 * raw JSON cut to 160 characters — so an empty search showed the literal text
 * `{"results":[]}` and a failure showed something equally cryptic.
 */
import { useState } from 'react'
import { AlertCircle, ChevronRight, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { openAsset } from '../../lib/desktop-asset'
import { focusForSourceKind } from '../../lib/ai/source-focus'
import type { AiSourceRef, MessageToolCall } from '../../lib/ai/presentation'
/* The words, and the three-status rule they carry, live in lib so a test can
   read them without a DOM and a second surface cannot quietly reword them. */
import {
  SOURCE_KIND_LABEL, sourceStateLabel, recordAge,
  toolCallLabel, toolCallOutcome, trailBorderFor,
} from '../../lib/ai/trail-text'

interface ResearchTrailProps {
  toolCalls: MessageToolCall[]
  /** A briefing shows its evidence open; a chat reply keeps it folded away. */
  defaultOpen?: boolean
  /** Overrides the default asset-page handoff. */
  onOpenSource?: (source: AiSourceRef) => void
  className?: string
}

export function ResearchTrail({
  toolCalls, defaultOpen = false, onOpenSource, className,
}: ResearchTrailProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (toolCalls.length === 0) return null

  const anyFailed = toolCalls.some(tc => tc.status === 'error')

  return (
    <div className={clsx('mt-3 pt-2 border-t border-gray-200 dark:border-gray-700/60', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-400
                   hover:text-gray-800 dark:hover:text-gray-200"
        title={open ? 'Hide research' : 'Show research'}
        aria-expanded={open}
      >
        <Search className="w-3 h-3" />
        Research ({toolCalls.length})
        {anyFailed && (
          <span className="text-red-600 dark:text-red-400" title="A lookup failed">
            <AlertCircle className="w-3 h-3" />
          </span>
        )}
        <ChevronRight className={clsx('w-3 h-3 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {toolCalls.map((tc, i) => {
            const o = toolCallOutcome(tc)
            return (
              <li
                key={i}
                className={clsx(
                  'text-[11px] text-gray-700 dark:text-gray-300 pl-1.5 border-l-2',
                  trailBorderFor(tc.status),
                )}
              >
                <div className="font-medium">{toolCallLabel(tc.name, tc.input)}</div>
                {o.text && <div className={o.tone}>{o.text}</div>}
                {tc.sources && tc.sources.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5">
                    {tc.sources.map(s => (
                      <li key={`${s.kind}:${s.id}`}>
                        <SourceRef source={s} onOpen={onOpenSource} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * One consulted record, as a link where we can open it.
 *
 * Uses the shell's existing `openAsset` channel rather than a new route: the
 * asset page is where notes, theses, decisions and requirements are read, and
 * `lib/ai/source-focus` holds which focus each kind lands on. A source we
 * cannot open renders as plain text, not a dead link.
 */
export function SourceRef({
  source, onOpen,
}: {
  source: AiSourceRef
  onOpen?: (source: AiSourceRef) => void
}) {
  const openable = Boolean(onOpen) || Boolean(source.asset_id)

  const when = source.timestamp
    ? new Date(source.timestamp).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      })
    : null

  const state = sourceStateLabel(source.state)
  const age = recordAge(source.timestamp)

  const body = (
    <>
      <span className="inline-block px-1 mr-1 rounded bg-gray-100 dark:bg-gray-800
                       text-gray-600 dark:text-gray-400 text-[10px] uppercase tracking-wide">
        {SOURCE_KIND_LABEL[source.kind]}
      </span>
      <span className="font-medium">{source.title}</span>
      {/*
        The record's own state, never the lookup's. Separated from the kind
        chip by weight rather than another box: two chips side by side read as
        two categories, and this is a property of the one named record.
      */}
      {state && (
        <span data-testid="ai-source-state" className="ml-1 text-gray-500 dark:text-gray-400">
          {state}
        </span>
      )}
      {when && <span className="text-gray-400 dark:text-gray-500 ml-1">{when}</span>}
      {/*
        The age, where it is old enough to change how the record should be
        weighed. The date alone is the lightest thing on the row, so a thesis
        from March and one from last week scan identically -- and only one of
        them should be leaned on.

        An age, never a verdict: nothing here calls a record stale. A thesis
        on a slow compounder can be two years old and current.
      */}
      {age && (
        <span
          data-testid="ai-source-age"
          className="ml-1 text-amber-700 dark:text-amber-500"
          title={`Last updated ${when}. Weigh it accordingly.`}
        >
          {age.label}
        </span>
      )}
      {/*
        The record in its own words. One line, clamped: enough to recognise
        the row without turning the trail into the document.
      */}
      {source.excerpt && (
        <span
          data-testid="ai-source-excerpt"
          className="mt-0.5 block line-clamp-2 font-normal text-gray-500 dark:text-gray-400"
        >
          {source.excerpt}
        </span>
      )}
    </>
  )

  if (!openable) {
    return <span className="text-gray-500 dark:text-gray-400">{body}</span>
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (onOpen) { onOpen(source); return }
        /* No focusRequestId here: assetTabFor stamps one per call, which is
           what lets the receiver tell a new intent from a remounted tab. */
        openAsset({
          assetId: source.asset_id as string,
          symbol: source.symbol ?? null,
          focus: focusForSourceKind(source.kind),
          origin: 'ai-research-trail',
        })
      }}
      className="text-left text-primary-600 dark:text-primary-400 hover:underline"
      title={`Open ${source.title}`}
    >
      {body}
    </button>
  )
}
