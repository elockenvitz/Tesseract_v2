import { useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { SignalCard, Severity, Surface } from '../../lib/signals/contract'

/**
 * The only component that renders a signal card.
 *
 * Every type goes through here. There is no per-type branch and there must
 * never be one: seven bespoke card components is what produced three header
 * patterns, four action bars and two cards that were dead ends. If a type
 * cannot render from the contract, the contract changes — not this file.
 *
 * Height is content-driven. The previous cards were full-viewport with the
 * payload in the top 40%, which is what made a triage surface feel like an
 * endless scroll of near-empty screens and hid the sense of a finite queue.
 * Two or three cards visible at once is the goal, not a compromise.
 */

interface SignalCardViewProps {
  card: SignalCard
  onAction: (actionId: string, card: SignalCard) => void
  onOpen: (card: SignalCard) => void
  onWhy: (card: SignalCard) => void
  /** Rendered between body and context — a sparkline, a peer bar. Supplied by
   *  the feed so this component never imports a chart. */
  evidence?: React.ReactNode
}

/**
 * Severity is a rail, not a pill.
 *
 * The old cards led with a large coloured badge saying ACTIVE RISK — shouting
 * the least useful thing on the card, since the headline already says what it
 * is. A 4px rail carries the same information at the edge of vision and gives
 * the width back to the sentence.
 */
const RAIL: Record<Severity, string> = {
  critical: 'bg-rose-500',
  attention: 'bg-amber-500',
  informational: 'bg-gray-300 dark:bg-gray-700',
}

const SURFACE_LABEL: Record<Surface, string> = {
  risk: 'Risk',
  research: 'Research',
  workflow: 'Workflow',
  market: 'Market',
}

const METRIC_TONE = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-gray-900 dark:text-white',
} as const

/** "31 Jul" — short enough to sit in the eyebrow without pushing it to two lines. */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // UTC, not local. A holdings snapshot dated 2026-07-31T00:00:00Z rendered
  // as "Jul 30" west of Greenwich, which quietly ages every book number by a
  // day. The date belongs to the snapshot, not to the reader's clock.
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function relative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true })
}

export function SignalCardView({ card, onAction, onOpen, onWhy, evidence }: SignalCardViewProps) {
  const [expanded, setExpanded] = useState(false)
  const hasEvidence = !!evidence && card.evidence && card.evidence.kind !== 'none'

  // Two lines by default. Replaces the horizontal swipe pages, where pages 2
  // and 3 held the rationale and the next action behind near-invisible dots —
  // most readers never saw them.
  const bodyIsLong = card.body.length > 140

  return (
    <article className="relative flex w-full bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className={clsx('w-1 shrink-0', RAIL[card.severity])} aria-hidden />

      <div className="flex-1 min-w-0 px-4 py-3.5">
        {/* Eyebrow: surface, when it happened, and — only when a number is on
            screen — when that number was true. */}
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400 dark:text-gray-500">
          {/* The metadata clips; it never pushes the row wider than the card.
              At 390px the surface, a relative time like "about 1 hour ago" and
              a "book 31 Jul" stamp together exceed the width, and without
              min-w-0 the flex row grows to fit them and scrolls sideways —
              measured, not theorised: e2e/signal-cards.spec.ts caught this on
              all four card types at once. */}
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap">
            <span className="shrink-0">{SURFACE_LABEL[card.surface]}</span>
            <span aria-hidden className="shrink-0">·</span>
            <span className="normal-case tracking-normal font-medium truncate">
              {relative(card.provenance.occurredAt)}
            </span>
            {card.metric && (
              <>
                <span aria-hidden className="shrink-0">·</span>
                <span className="normal-case tracking-normal font-medium shrink-0">
                  {card.metric.source === 'holdings' ? 'book ' : ''}
                  {shortDate(card.metric.asOf)}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => onWhy(card)}
            aria-label="Why am I seeing this"
            data-slot="why"
            // No negative margin. `-mr-1` optically aligned the icon with the
            // right text edge and bought 4px of horizontal overflow for it —
            // the button sat outside its parent's content box, so the row
            // became scrollable. Optical alignment is not worth a scrollbar.
            className="ml-auto shrink-0 flex items-center justify-center h-8 w-8 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 no-touch-target"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        {/* The headline is the message. A full sentence carrying the number,
            never a category label — the eyebrow already says the category. */}
        <h2 className="mt-1.5 text-[22px] leading-[1.22] font-semibold tracking-[-0.02em] text-gray-900 dark:text-white">
          {card.headline}
        </h2>

        {card.metric && (
          <div className="mt-3">
            <div className={clsx(
              'text-[38px] leading-none font-bold tabular-nums tracking-[-0.03em]',
              METRIC_TONE[card.metric.direction ?? 'neutral'],
            )}>
              {card.metric.value}
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400">
              {card.metric.label}
            </div>
          </div>
        )}

        {hasEvidence && <div className="mt-3" data-evidence={card.evidence!.kind}>{evidence}</div>}

        <p className={clsx(
          'mt-3 text-[15px] leading-[1.5] text-gray-600 dark:text-gray-300',
          bodyIsLong && !expanded && 'line-clamp-2',
        )}>
          {card.body}
        </p>

        {bodyIsLong && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-1 flex items-center gap-1 text-[13px] font-semibold text-gray-500 dark:text-gray-400 no-touch-target"
          >
            Show more
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}

        {card.context.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {card.context.map(chip => (
              <span
                key={chip.label}
                className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-[11px] font-medium text-gray-600 dark:text-gray-300"
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}

        {/* One grammar on every card. Quick actions resolve in place; the
            primary is the move; open always sits last and always navigates.
            Two of the old cards had no action bar at all and were dead ends. */}
        {/* One row, never two. Four buttons at 390px is the budget every
            action label has to fit inside — "Not useful" and "Log a view"
            both wrapped to two lines and inflated the card by 28px. */}
        <div className="mt-4 flex items-center gap-1">
          {card.actions.quick.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAction(a.id, card)}
              data-slot="quick"
              className="h-9 px-2.5 shrink-0 whitespace-nowrap rounded-lg text-[13px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 no-touch-target"
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAction(card.actions.primary.id, card)}
            data-slot="primary"
            className="h-9 px-3 shrink-0 whitespace-nowrap rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[13px] font-bold no-touch-target"
          >
            {card.actions.primary.label}
          </button>
          <button
            type="button"
            onClick={() => onOpen(card)}
            data-slot="open"
            className="ml-auto h-9 px-2.5 shrink-0 whitespace-nowrap rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-700 dark:text-gray-200 no-touch-target"
          >
            {card.actions.open.label}
          </button>
        </div>
      </div>
    </article>
  )
}
