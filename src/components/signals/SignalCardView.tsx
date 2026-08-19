import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import type { CardContextChip, SignalCard } from '../../lib/signals/contract'
import { KIND_LABEL, SEVERITY_MARK, SURFACE_SKIN, showsTopRule } from './card-identity'

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
  /**
   * Whether the detail is worth a hide/show control at all.
   *
   * A disclosure earns its place when the region holds *content* the reader
   * might want out of the way: six cases with reasoning, a full post. It does
   * not when the region holds a single control that is open by default and has
   * nowhere else to go — a "Hide detail" button above a three-button response
   * bar offers to hide the only thing on the card a reader can act on, and its
   * other state ("Show detail") is a step they never wanted.
   *
   * False renders the region plainly, with no toggle and no label.
   */
  detailCollapsible?: boolean
  /** Narrow the feed to this kind. Restores the legacy chip behaviour. */
  onFilterKind?: (type: SignalCard['type']) => void
  /** A context chip carrying an href was tapped, e.g. a portfolio name. */
  onContext?: (chip: CardContextChip) => void
}

const METRIC_TONE = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-gray-900 dark:text-white',
} as const

/**
 * The numeral scales to what it is, rather than shouting every value.
 *
 * ── Two rounds of shrinking, and why ──────────────────────────────────────
 *
 * It began as a fixed 56px, chosen for "+3.1%" and then applied to everything,
 * so "179" under "days since anyone wrote on it" arrived at the same visual
 * weight as a book's largest active bet. That went to a 42px ceiling.
 *
 * It is now 30px, because the problem was never only the type size. The metric
 * lived in a tall tinted well that consumed about 98px of an 844px screen —
 * roughly the height the chart was missing. "6mo / PAST ITS HORIZON" at that
 * scale is a headline restating a fact the headline already made, while the
 * evidence a reader can actually work with was squeezed into a fifth of the
 * card. The number is still the loudest thing on the card; it is no longer the
 * biggest thing on it.
 *
 * Length remains the proxy because it governs the layout: a ten-character value
 * wraps or clips on a 390px card whatever it means.
 */
function metricSize(value: string): string {
  const n = value.length
  if (n <= 5) return 'text-[30px]'
  if (n <= 8) return 'text-[24px]'
  return 'text-[19px]'
}

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
  card, onAction, onOpen, evidence, detail, detailLabel, detailCollapsible = true, onFilterKind, onContext,
}: SignalCardViewProps) {
  const [bodyOpen, setBodyOpen] = useState(false)
  /**
   * Open by default, and it cannot grow the card.
   *
   * Earlier this pushed the card past one screen, which caused the scroll
   * conflict. That is no longer possible: the article is `h-full
   * overflow-hidden` and this region is `flex-1 min-h-0 overflow-y-auto`, so it
   * absorbs exactly the slack and no more. Open, it fills the screen with the
   * analyst's own reasoning; closed, the card is mostly empty.
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

  const skin = SURFACE_SKIN[card.surface]
  const hasEvidence = !!evidence && card.evidence && card.evidence.kind !== 'none'
  const bodyIsLong = card.body.length > 150

  /**
   * The eyebrow says WHEN, never WHERE FROM.
   *
   * It used to print "book 31 Jul", later "holdings 31 Jul", to mark a number
   * as coming off a snapshot rather than a live feed. That distinction is real
   * and the product still enforces it — `vintageOf`, the `snapshot_vs_live`
   * suppression and the freshness gates all depend on it — but it is an
   * ENGINEERING concern, and it was being shown to readers who reasonably
   * assume holdings and prices are current.
   *
   * So the qualifier is gone from the face of the card. What remains is the
   * date itself, which is the part a reader can act on: a weight from three
   * weeks ago is worth knowing whatever table it came from.
   */
  /**
   * And when it is shown, it says what it is.
   *
   * A bare "Jun 18" sat next to "5 months ago" with nothing to distinguish
   * them, so the card printed two unexplained dates and the reader had no way
   * to tell which one the finding belonged to. It is now prefixed.
   *
   * It is also only shown when the number is OLDER than the event, which is
   * the only case where "as of" is the true relationship. A metric whose asOf
   * is in the future is a deadline — an attention item's due date — and its own
   * label already says so ("until due", "overdue"); dating it here would put
   * "as of" in front of something that has not happened.
   */
  const sameDay = !!card.metric && utcDay(card.provenance.occurredAt) === utcDay(card.metric.asOf)
  const showsSecondDate = !!card.metric && !sameDay &&
    new Date(card.metric.asOf).getTime() < new Date(card.provenance.occurredAt).getTime()

  return (
    <article
      data-signal-card={card.type}
      // Exactly one screen, and it never grows.
      //
      // It was `min-h-full` inside an `overflow-y-auto` section, so the card
      // could exceed the viewport and scroll vertically *inside* a vertical
      // snap scroller. Every upward drag was then ambiguous between "scroll
      // this card" and "next card", and the browser resolves that by giving the
      // gesture to the inner scroller — so the feed stopped advancing until the
      // card had been scrolled to its end.
      //
      // Vertical belongs to the feed. Overflow goes horizontal, which is what
      // the carousel is for.
      className="relative flex h-full w-full flex-col overflow-hidden bg-white dark:bg-gray-900"
    >
      {/* Only critical cards get the rule. If everything has one it stops
          meaning anything, which is what the old 4px rail on every card did. */}
      {showsTopRule(card.severity) && (
        <div className={clsx('h-1 w-full shrink-0', skin.topRule)} aria-hidden />
      )}

      <div className="flex min-h-0 flex-1 flex-col px-4 pt-4 pb-2">
        {/* Eyebrow. Severity is the colour of the surface word plus a dot. */}
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          {/* The KIND, not the surface. Four surface words across seventeen
              types made every research finding read as the same card; the kind
              is what a reader scans for. Tappable, restoring the filter-by-kind
              affordance the legacy tiles had and the first convergence lost. */}
          <button
            type="button"
            data-slot="kind"
            onClick={() => onFilterKind?.(card.type)}
            className={clsx(
              'shrink-0 rounded-full px-2 py-0.5 uppercase tracking-[0.06em] transition-opacity active:opacity-70 no-touch-target',
              skin.chip,
            )}
          >
            {KIND_LABEL[card.type] ?? card.type}
          </button>

          <span className={clsx('shrink-0', SEVERITY_MARK[card.severity])} aria-hidden />

          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-gray-400 dark:text-gray-500">
            <span className="truncate font-medium normal-case tracking-normal">
              {relative(card.provenance.occurredAt)}
            </span>
            {showsSecondDate && (
              <>
                <span aria-hidden className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
                <span className="shrink-0 font-medium normal-case tracking-normal">
                  as of {shortDate(card.metric!.asOf)}
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
              // The box stays inside its parent; only the glyph moves.
              //
              // A negative margin was added here twice for optical alignment —
              // the dots sit ~6px inside a 36px round hit target, so against
              // the container padding the icon looks indented relative to the
              // text below it. Both times it put the button outside the
              // parent's content box and made the eyebrow row scrollable.
              // Translating the icon achieves the same alignment and cannot
              // affect layout, because a transform does not contribute to
              // scrollWidth.
              className="flex items-center justify-center h-9 w-9 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 no-touch-target"
            >
              <MoreHorizontal className="h-5 w-5 translate-x-[3px]" />
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
          // One line, not a stacked well.
          //
          // The value and its label sat on separate rows inside 20px of
          // vertical padding, which is how a two-word fact came to occupy the
          // height of a chart. Baseline-aligned on one row they read as a
          // single statement — "6mo past its horizon" — and give the evidence
          // band back about 60px. The tint stays, because the surface hue is
          // what makes a risk number legible as a risk number before it is
          // read at all; it is just no longer wrapped around empty space.
          <div className={clsx(
            'mt-3 -mx-1.5 flex items-baseline gap-2 overflow-hidden rounded-xl px-2 py-1.5',
            skin.metricWell,
          )}>
            <span className={clsx(
              'shrink-0 leading-none font-bold tabular-nums tracking-[-0.035em]',
              metricSize(card.metric.value),
              METRIC_TONE[card.metric.direction ?? 'neutral'],
            )}>
              {card.metric.value}
            </span>
            <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">
              {card.metric.label}
            </span>
          </div>
        )}

        {/* Evidence gets real space now that the card owns the screen. */}
        {/* Fixed band, not flex-1.
            Letting the evidence absorb all the slack passed the dead-space rule
            and moved the emptiness inside the chart: a 500px-tall ladder with
            the axis floating in the middle of nothing. The slack belongs to the
            detail, which is content.

            The chart takes the space the card is not spending on a control.

            It has climbed 164 → 180 → 260, and the first two moves were too
            timid because they took the height from nowhere: each was capped by
            whatever the rest of the card would spare. The metric well paid for
            this one, going from a stacked 98px block to a 40px line.

            Two heights rather than one, because the constraint genuinely
            differs. A card whose disclosure holds a slider and a commit button
            needs ~160px down there or the button lands under the action bar —
            one working control traded for another. A card whose disclosure is
            prose, or which has none, has no such floor and can give the chart
            35% of the screen, which is where a chart stops being a garnish. */}
        {hasEvidence && (
          <div className={clsx(
            'mt-3.5 flex shrink-0 flex-col',
            detail ? 'h-[236px]' : 'h-[300px]',
          )}>
            {evidence}
          </div>
        )}

        {/* Closed, the body is a clamped teaser and takes no space it does not
            need. Open, it becomes a bounded scroller.

            It used to be `line-clamp-5` in both states and `shrink-0` in both,
            which meant "Show more" on a long body revealed five lines and then
            silently ate the rest: no clamp indicator, no scrollbar, no way to
            reach the end. A control labelled "show more" that cannot show more
            is worse than no control. `flex-1 min-h-0 overflow-y-auto` lets the
            open state absorb the slack the detail is not using and scroll
            within it, so the card still never grows past its screen. */}
        {/* The body IS its own control.
            "Show more" used to be a 22px button row of its own beneath the
            prose. On a card already carrying a chart and a slider that row was
            pure overhead — it cost the disclosure below more height than the
            line of text it revealed. Tapping the paragraph is the same gesture
            with none of the furniture, and the trailing "more"/"less" keeps the
            affordance visible.

            Open, the region becomes a bounded scroller. It used to be
            `line-clamp-5` and `shrink-0` in both states, so "Show more" on a
            long body revealed five lines and silently ate the rest: no
            indicator, no scrollbar, no way to reach the end. */}
        <div className={clsx(
          'mt-3.5 text-[15px] leading-[1.5] text-gray-600 dark:text-gray-300',
          bodyOpen && bodyIsLong ? 'min-h-0 flex-1 overflow-y-auto' : 'shrink-0',
        )}>
          <p
            {...(bodyIsLong ? { onClick: () => setBodyOpen(v => !v), 'data-slot': 'body-toggle', role: 'button' } : {})}
            className={clsx(
              bodyIsLong && 'cursor-pointer',
              // One line rather than two on the cards carrying BOTH a chart and
              // a control. Those are the cards where a screen genuinely runs
              // out, and the second line of prose is the cheapest thing on it.
              !bodyOpen && bodyIsLong && (hasEvidence && detail ? 'line-clamp-1' : 'line-clamp-2'),
            )}
          >
            {card.body}
            {bodyIsLong && bodyOpen && (
              <span className="ml-1 font-semibold text-gray-500 dark:text-gray-400">less</span>
            )}
          </p>
          {bodyIsLong && !bodyOpen && (
            <button
              type="button"
              onClick={() => setBodyOpen(true)}
              className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 no-touch-target"
            >
              more
            </button>
          )}
        </div>

        {/* Context as a legible row, not decorative pills. "Held · 2" at 11px
            inside a grey pill was invisible, and it is the line that says
            whether any of this is your problem. */}
        {card.context.length > 0 && (
          // One line, not a wrapping block.
          //
          // Naming the books instead of counting them made this row longer —
          // "Core Equity, Large Cap Growth · Conviction high · Book 4mo old"
          // wraps to two lines on a 390px card — and every pixel it takes comes
          // out of the disclosure below, which is where the controls live. This
          // is a supporting row: it should cost one line, and the chips that do
          // not fit should be off the edge rather than pushing a slider under
          // the action bar.
          <div className="mt-3.5 flex shrink-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-[13px]">
            {card.context.map((chip, i) => (
              <span key={chip.label} className="flex items-center gap-2">
                {i > 0 && <span className="text-gray-300 dark:text-gray-600" aria-hidden>·</span>}
                {/* A chip with an href is a destination, and says so.
                    Portfolio names have always been the reader's shortest route
                    to "what does that position actually look like", and they
                    were inert text sitting next to an "Open MSFT" button that
                    went somewhere else entirely. Chips without an href stay
                    plain: underlining every chip would make the ones that do
                    nothing look broken. */}
                {chip.href && onContext ? (
                  <button
                    type="button"
                    data-slot="context-link"
                    onClick={() => onContext(chip)}
                    className="font-semibold text-gray-700 underline decoration-gray-300 underline-offset-2 active:opacity-70 dark:text-gray-200 dark:decoration-gray-600 no-touch-target"
                  >
                    {chip.label}
                  </button>
                ) : (
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{chip.label}</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Detail in place. A card that must send you elsewhere to be
            understood is a notification. */}
        {detail && (
          <div className={clsx('mt-3.5 flex min-h-0 flex-col', detailOpen && 'flex-1')}>
            {detailCollapsible && (
              <button
                type="button"
                data-slot="detail-toggle"
                aria-expanded={detailOpen}
                onClick={() => setDetailOpen(v => !v)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 px-3.5 py-2.5 text-[14px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200 no-touch-target"
              >
                {detailOpen ? 'Hide detail' : (detailLabel ?? 'Show detail')}
                {detailOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
              </button>
            )}
            {detailOpen && (
              // The one bounded vertical scroller on the card, and only when
              // opened. Six cases with reasoning cannot be paged sideways
              // without losing the comparison, so this region scrolls — bounded
              // by flex-1/min-h-0, so the CARD never grows.
              //
              // Scroll chaining is deliberately LEFT ON. This was
              // `overscroll-behavior-y: contain`, which means "do not chain to
              // the ancestor" — the exact opposite of what was wanted. At the
              // end of the case list the feed was blocked from advancing, which
              // is the scroll conflict reproduced inside the region meant to
              // contain it. A computed-style assertion had reported it as
              // handled; a driven gesture showed the feed sitting at 844 and
              // refusing to move.
              <div
                className={clsx('min-h-0 flex-1 overflow-y-auto', detailCollapsible && 'mt-3')}
                data-testid="card-detail"
              >
                {detail}
              </div>
            )}
          </div>
        )}

        {/* Absorbs slack only when the detail is closed. If this is doing real
            work on a card type, that card is too thin for a screen and the
            dead-space rule will say so. */}
        {!detailOpen && !hasEvidence && <div className="min-h-4 flex-1" aria-hidden />}
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
