import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vintageOf } from '../../lib/signals/contract'
import type { SignalCard, Severity, Surface } from '../../lib/signals/contract'

/**
 * The only component that renders a signal card.
 *
 * Every type goes through here and there is no per-type branch — seven bespoke
 * card components is what produced three header patterns, four action bars and
 * two cards that were dead ends. If a type cannot render from the contract,
 * the contract changes, not this file.
 *
 * ── On height ─────────────────────────────────────────────────────────────
 *
 * One screen per card, filled.
 *
 * The first version was deliberately short, on the reading that full-viewport
 * cards were the defect. They were not: the defect was full-viewport cards
 * that were 60% empty, with the payload crammed into the top 40% and a chart
 * panel rendering nothing. Shrinking the card cured the emptiness by removing
 * the space rather than using it, which made a card carrying a real finding
 * look like a table row.
 *
 * So the card owns the screen and has to earn it. Everything in it is
 * load-bearing: the claim, the number, evidence that changes the decision, the
 * detail behind the number, the actions. A card that cannot fill a screen with
 * substance is a thin claim, not a candidate for less room.
 */

interface SignalCardViewProps {
  card: SignalCard
  onAction: (actionId: string, card: SignalCard) => void
  onOpen: (card: SignalCard) => void
  /** Rendered in the evidence band — a ladder, a sparkline. Supplied by the
   *  feed so this component never imports a chart. */
  evidence?: React.ReactNode
  /**
   * Detail behind the number, revealed in place.
   *
   * The point of the disclosure: a card saying a name is below its bear case
   * must be able to show the cases themselves without sending anybody to an
   * asset page. Navigation is the failure this surface exists to avoid.
   */
  detail?: React.ReactNode
  /** Label for the disclosure control, e.g. "See all 3 cases". */
  detailLabel?: string
}

/**
 * Severity tints the eyebrow, and nothing else.
 *
 * It was a 4px rail down the left edge. On a full-screen card that reads as a
 * coloured border around the whole app, and three risk cards in a row looked
 * like an error state. The eyebrow already names the surface; colouring that
 * word carries urgency without painting the frame.
 */
const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-rose-600 dark:text-rose-400',
  attention: 'text-amber-600 dark:text-amber-500',
  informational: 'text-gray-400 dark:text-gray-500',
}

const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-rose-500',
  attention: 'bg-amber-500',
  informational: 'bg-gray-300 dark:bg-gray-600',
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

/** "31 Jul" in UTC — the date belongs to the snapshot, not the reader's clock. */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function relative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true })
}

function utcDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export function SignalCardView({
  card, onAction, onOpen, evidence, detail, detailLabel,
}: SignalCardViewProps) {
  const [bodyOpen, setBodyOpen] = useState(false)
  /**
   * Open by default.
   *
   * The card owns a screen, and with the detail closed there were ~400px of
   * nothing between the disclosure control and the actions — the exact "full
   * viewport, 60% empty" failure this redesign exists to remove, reproduced by
   * the redesign. The detail is the densest, most useful content available, so
   * it fills the space it was written for and collapses for anyone who wants
   * the claim alone.
   */
  const [detailOpen, setDetailOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on any outside press. Without this the menu stayed open while the
  // feed scrolled under it, which reads as a stuck overlay.
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const hasEvidence = !!evidence && card.evidence && card.evidence.kind !== 'none'
  const bodyIsLong = card.body.length > 150

  const sameDay = !!card.metric && utcDay(card.provenance.occurredAt) === utcDay(card.metric.asOf)
  const isBook = !!card.metric && vintageOf(card.metric) === 'holdings'
  const showsSecondDate = !!card.metric && !sameDay

  return (
    <article
      data-signal-card={card.type}
      className="relative flex min-h-full w-full flex-col bg-white dark:bg-gray-900"
    >
      <div className="flex-1 min-h-0 flex flex-col px-4 pt-4 pb-2">
        {/* Eyebrow. Severity is the colour of the surface word plus a dot. */}
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]">
          <span className={clsx('h-1.5 w-1.5 rounded-full shrink-0', SEVERITY_DOT[card.severity])} aria-hidden />
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap">
            <span className={clsx('shrink-0', SEVERITY_TEXT[card.severity])}>
              {SURFACE_LABEL[card.surface]}
            </span>
            <span aria-hidden className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
            <span className="normal-case tracking-normal font-medium truncate text-gray-400 dark:text-gray-500">
              {sameDay && isBook ? `book ${shortDate(card.metric!.asOf)}` : relative(card.provenance.occurredAt)}
            </span>
            {showsSecondDate && (
              <>
                <span aria-hidden className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
                <span className="normal-case tracking-normal font-medium shrink-0 text-gray-400 dark:text-gray-500">
                  {isBook ? 'book ' : ''}{shortDate(card.metric!.asOf)}
                </span>
              </>
            )}
          </div>

          {/* The overflow menu. This control was wired to a no-op — it looked
              like an affordance and did nothing, which is worse than having
              none. Snooze, dismiss and "why am I seeing this" live here now. */}
          <div className="relative ml-auto shrink-0" ref={menuRef}>
            <button
              type="button"
              data-slot="menu"
              aria-label="More options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(v => !v)}
              // No negative margin. This is the second time it has been added here
              // for optical alignment and the second time it put the button
              // outside its parent's content box, making the eyebrow row
              // scrollable. Optical alignment is not worth a scrollbar.
              className="flex items-center justify-center h-9 w-9 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 no-touch-target"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-30 min-w-[210px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                {card.actions.menu.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    data-slot="menu-item"
                    onClick={() => { setMenuOpen(false); onAction(a.id, card) }}
                    className="block w-full px-4 py-3 text-left text-[14px] font-medium normal-case tracking-normal text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* The claim. Never carries the number — the metric block does. */}
        <h2 className="mt-3 text-[26px] leading-[1.15] font-semibold tracking-[-0.025em] text-gray-900 dark:text-white">
          {card.headline}
        </h2>

        {card.metric && (
          <div className="mt-4">
            <div className={clsx(
              'text-[56px] leading-none font-bold tabular-nums tracking-[-0.035em]',
              METRIC_TONE[card.metric.direction ?? 'neutral'],
            )}>
              {card.metric.value}
            </div>
            <div className="mt-1.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-gray-400">
              {card.metric.label}
            </div>
          </div>
        )}

        {/* Evidence gets real space now that the card owns the screen. */}
        {hasEvidence && <div className="mt-5">{evidence}</div>}

        <p className={clsx(
          'mt-5 text-[16px] leading-[1.55] text-gray-600 dark:text-gray-300',
          bodyIsLong && !bodyOpen && 'line-clamp-3',
        )}>
          {card.body}
        </p>

        {bodyIsLong && (
          // Both directions. "Show more" with no way back left the card
          // permanently expanded and removed its own control, so the reader
          // could not tell whether anything was still hidden.
          <button
            type="button"
            data-slot="body-toggle"
            onClick={() => setBodyOpen(v => !v)}
            className="mt-1.5 flex items-center gap-1 self-start text-[14px] font-semibold text-gray-500 dark:text-gray-400 no-touch-target"
          >
            {bodyOpen ? 'Show less' : 'Show more'}
            {bodyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}

        {/* Context as a legible row, not decorative pills. "Held · 2" at 11px
            inside a grey pill was invisible, and it is the line that says
            whether any of this is your problem. */}
        {card.context.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
            {card.context.map((chip, i) => (
              <span key={chip.label} className="flex items-center gap-2">
                {i > 0 && <span className="text-gray-300 dark:text-gray-600" aria-hidden>·</span>}
                <span className="font-semibold text-gray-700 dark:text-gray-200">{chip.label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Detail in place. A card that must send you elsewhere to be
            understood is a notification. */}
        {detail && (
          <div className="mt-4">
            <button
              type="button"
              data-slot="detail-toggle"
              aria-expanded={detailOpen}
              onClick={() => setDetailOpen(v => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 px-3.5 py-3 text-[14px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200 no-touch-target"
            >
              {detailOpen ? 'Hide detail' : (detailLabel ?? 'Show detail')}
              {detailOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
            </button>
            {detailOpen && <div className="mt-3" data-testid="card-detail">{detail}</div>}
          </div>
        )}

        {/* Absorbs slack when a card genuinely has less to say. If this is
            doing real work on a card type, that card is too thin for a screen
            and the e2e dead-space rule will say so. */}
        <div className="flex-1 min-h-4" aria-hidden />
      </div>

      {/* Actions pinned to the bottom of the screen the card owns, so the
          gesture is in the same place on every card type. */}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-gray-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
        {card.actions.quick.map(a => (
          <button
            key={a.id}
            type="button"
            data-slot="quick"
            onClick={() => onAction(a.id, card)}
            className="h-11 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-gray-200 text-[15px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200 no-touch-target"
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          data-slot="primary"
          onClick={() => onAction(card.actions.primary.id, card)}
          className="h-11 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl bg-gray-900 text-[15px] font-bold text-white dark:bg-white dark:text-gray-900 no-touch-target"
        >
          {card.actions.primary.label}
        </button>
        <button
          type="button"
          data-slot="open"
          onClick={() => onOpen(card)}
          className="h-11 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-gray-200 text-[15px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200 no-touch-target"
        >
          {card.actions.open.label}
        </button>
      </div>
    </article>
  )
}
