import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import type { CardContextChip, SignalCard } from '../../lib/signals/contract'
import { KIND_LABEL, SEVERITY_MARK, SURFACE_SKIN, showsTopRule } from './card-identity'
import { feedbackOptionsFor, type FeedFeedbackOption } from '../../lib/signals/feed-feedback'

/**
 * How many books the card will render before it stops.
 *
 * Four rows is roughly 150px, which a card can absorb without reaching its
 * ceiling. Beyond that the count is stated instead — a scroller here would be a
 * second vertical scroll owner inside a feed whose entire gesture contract is
 * that there is exactly one.
 */
const MAX_DISCLOSED_BOOKS = 4

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
 * As tall as its content, never taller than one screen.
 *
 * This has been wrong in both directions. The first version was deliberately
 * short, on the reading that full-viewport cards were the defect. They were
 * not: the defect was full-viewport cards that were 60% EMPTY, with the payload
 * crammed into the top 40% and a chart panel rendering nothing. Shrinking cured
 * the emptiness by removing the space rather than using it, so a card carrying
 * a real finding rendered like a table row.
 *
 * The correction was `h-full` — one screen per card, always — and it overshot
 * in the other direction. A two-line workflow card was padded out to 844px, so
 * a feed of eight findings cost eight full swipes and never showed the reader
 * that a ninth existed. The feed read as a stack of full-screen alerts because
 * it was structurally incapable of reading as anything else.
 *
 * The rule that satisfies both: a CEILING, not a fixed height. The scroll
 * conflict the one-screen rule existed to prevent comes from cards taller than
 * the viewport, not shorter — a card that fits has no inner scroller and
 * nothing to arbitrate. So the space still has to be earned, and a card that
 * cannot fill a screen simply does not take one. A case ladder still runs most
 * of the screen because its content genuinely does; a stale-research card is
 * about 380px, and the next card peeks below it.
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
  /**
   * Navigate to a book, from the disclosure rather than from the chip.
   *
   * Deliberately separate from `onContext`: that fires when a plain href chip
   * is tapped, and the whole point of the disclosure is that tapping a label no
   * longer navigates.
   */
  onOpenPortfolio?: (portfolioId: string, name: string) => void
  /**
   * Feedback about the feed itself, offered in the overflow menu.
   *
   * Separate prop from `onAction` because it is a separate loop with a separate
   * store: these go to product telemetry, not to the investment audit trail.
   * Passing them through the card's action grammar would have made that
   * distinction a convention rather than a type.
   */
  onFeedback?: (option: FeedFeedbackOption) => void
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
  card, onAction, onOpen, evidence, detail, detailLabel, detailCollapsible = true, onFilterKind, onContext, onOpenPortfolio,
  onFeedback,
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

  // Signal-aware: "wrong person" is meaningless on a market move, which was
  // routed to nobody.
  const feedback = onFeedback ? feedbackOptionsFor(card) : []
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
  /**
   * Which context chip has its books open, by label. Null when none.
   *
   * Keyed by label rather than a boolean so a card carrying two disclosing
   * chips cannot open both and grow past its own ceiling.
   */
  const [booksOpen, setBooksOpen] = useState<string | null>(null)
  const openBooks = card.context.find(c => c.label === booksOpen)?.portfolios ?? null

  const sameDay = !!card.metric && utcDay(card.provenance.occurredAt) === utcDay(card.metric.asOf)
  const showsSecondDate = !!card.metric && !sameDay &&
    new Date(card.metric.asOf).getTime() < new Date(card.provenance.occurredAt).getTime()

  return (
    <article
      data-signal-card={card.type}
      // As tall as its content, and never taller than one screen.
      //
      // ── What the two previous rules each got half right ──────────────────
      //
      // It was `min-h-full` inside an `overflow-y-auto` section, so a card
      // could EXCEED the viewport and scroll vertically inside a vertical snap
      // scroller. Every upward drag was then ambiguous between "scroll this
      // card" and "next card", and the browser resolves that by giving the
      // gesture to the inner scroller, so the feed stopped advancing.
      //
      // The fix was `h-full`: exactly one screen, always. That killed the
      // conflict and introduced the opposite defect — a two-line workflow card
      // padded out to 844px, so a feed of eight findings took eight full swipes
      // and never showed the reader that a next card existed.
      //
      // Both rules were reaching for the same constraint from opposite sides.
      // The conflict comes from cards TALLER than the viewport, not from cards
      // shorter than it: a card that fits has no inner scroller and nothing to
      // arbitrate. So the rule is a ceiling, not a fixed height. A stale-research
      // card is now about 380px and the next card peeks below it; a case ladder
      // still takes most of the screen because its content genuinely does.
      //
      // `max-h-full` keeps the ceiling and `overflow-hidden` keeps the promise:
      // vertical belongs to the feed, and overflow goes horizontal, which is
      // what the carousel is for.
      // ── Phase 8.1: one viewport per card ─────────────────────────────────
      //
      // `max-h-[100dvh]` was a ceiling on a content-sized card, which produced
      // exactly the inconsistency hands-on testing found: a news card at 327px,
      // a scenario card at 844, and several in between. Swiping through it did
      // not feel like advancing through decisions; it felt like a list that
      // could not decide what it was.
      //
      // `h-full` against a `h-[100dvh]` section is one screen per card. The
      // difference from the version this replaces in Phase 1 is that the space
      // is now COMPOSED — chart, evidence, judgment, actions — rather than
      // absorbed by a spacer, which is what made a two-line workflow card 844px
      // of nothing the first time round.
      className="relative flex h-full w-full flex-col overflow-hidden bg-white dark:bg-gray-900"
    >
      {/* Only critical cards get the rule. If everything has one it stops
          meaning anything, which is what the old 4px rail on every card did. */}
      {showsTopRule(card.severity) && (
        <div className={clsx('h-1 w-full shrink-0', skin.topRule)} aria-hidden />
      )}

      {/* `flex-1` is correct in BOTH height regimes, which is why removing it
          was wrong.
          In a content-sized flex column it distributes free space of which
          there is none, so a short card stays short — it was never what
          stretched them; the `min-h-4 flex-1` spacer below was. Once a card
          reaches the `max-h-[100dvh]` ceiling this is what lets the inner
          regions shrink and the detail scroll inside its bounds instead of
          overflowing into the action bar. */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-2.5 pb-2">
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
              className="flex items-center justify-center h-11 w-11 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <MoreHorizontal className="h-5 w-5 translate-x-[3px]" />
            </button>
            {menuOpen && (
              <div data-slot="menu-panel" className="absolute right-0 top-12 z-30 w-[264px] max-w-[80vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                {/* Why this surfaced.
                    Every builder has written a `provenance.reason` since the
                    contract existed and nothing has ever rendered one, so the
                    answer to "why am I being shown this" lived only in the
                    source. It matters more now that triggers are composite: a
                    card can fire on a combination the reader cannot reconstruct
                    from the headline. Not on the face of the card — it is a
                    question people ask occasionally, and the card is already
                    carrying its claim, its evidence and its question. */}
                <div className="border-b border-gray-200 px-4 pt-2.5 pb-2.5 dark:border-gray-700">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    Why this surfaced
                  </p>
                  <p data-slot="menu-reason" className="mt-1 text-[12px] font-normal normal-case leading-snug tracking-normal text-gray-600 dark:text-gray-300">
                    {card.provenance.reason}
                  </p>
                </div>
                {card.actions.menu.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    data-slot="menu-item"
                    onClick={() => { setMenuOpen(false); onAction(a.id, card) }}
                    className="block min-h-[44px] w-full px-4 py-3 text-left text-[14px] font-medium normal-case tracking-normal text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60"
                  >
                    {a.label}
                  </button>
                ))}

                {/* Feedback about the FEED, below a rule and under its own
                    heading.
                    The items above answer "what should happen to this card";
                    these answer "should Tesseract have shown it". Same menu,
                    because a reader reaching for one is plausibly reaching for
                    the other — and visibly separate, because they go to
                    different places and mean different things. */}
                {feedback.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-700">
                    <p className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      About this card
                    </p>
                    {feedback.map(f => (
                      <button
                        key={f.key}
                        type="button"
                        data-slot="menu-feedback"
                        data-feedback={f.key}
                        onClick={() => { setMenuOpen(false); onFeedback?.(f) }}
                        className="block min-h-[44px] w-full px-4 py-3 text-left text-[14px] font-medium normal-case tracking-normal text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60"
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The claim. Never carries the number — the metric block does. */}
        {/* The claim. Never carries the number — the metric block does.
            Sized by length: 26px is right for "AMZN has reached your target"
            and wrong for a headline that wraps to three lines, where it stops
            being a claim and becomes the card. */}
        <h2 className={clsx(
          'mt-2.5 shrink-0 leading-[1.15] font-semibold tracking-[-0.025em] text-gray-900 dark:text-white',
          card.headline.length > 62 ? 'text-[21px]'
            : card.headline.length > 44 ? 'text-[23px]'
            : 'text-[26px]',
        )}>
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
          // shrink-0 is load-bearing.
          //
          // Without it this was the only flexible row above the evidence band,
          // and a flex child defaults to `flex-shrink: 1`. On a tight card the
          // column resolved the overflow by squeezing THIS box — the one with
          // `overflow-hidden` on it — so the number and its label were sliced
          // horizontally and the well read as a banner half-hidden behind the
          // chart below it. Nothing was overlapping; the row had been crushed.
          <div className={clsx(
            'mt-3 -mx-1.5 flex shrink-0 items-baseline gap-2 overflow-hidden rounded-xl px-2 py-1.5',
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
            // Three tiers, because the constraint really is three-way: a
            // chart with a control and a question below it has the least room
            // to give, and the chart is the one element that stays legible
            // when trimmed by 20px.
            detail && card.prompt ? 'h-[200px]'
              : detail ? 'h-[236px]'
              : 'h-[264px]',
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
        {/* The caption pattern, not a layout push.
            ── Why it overlays instead of expanding in flow ──────────────────
            Expanding in flow meant the body competed with the disclosure for
            the same slack, and the disclosure won because its content is
            taller: "more" fired, the layout barely moved, and the reader got a
            few extra words. Making it a scroller instead — the version this
            replaces — bought room by adding a second vertical scroll owner to a
            feed whose whole gesture contract is that there is one.
            A reel caption solves this without either. It rises over the card,
            takes as much of the tile as it needs, dims what is behind it so the
            text stays legible, and collapses on the next tap. Nothing below it
            moves, so the action bar and the judgment stay exactly where the
            thumb left them. */}
        <div className={clsx(
          'mt-3.5 shrink-0 text-[15px] leading-[1.5] text-gray-600 dark:text-gray-300',
          bodyOpen && bodyIsLong && 'invisible',
        )}>
          <p
            {...(bodyIsLong ? { onClick: () => setBodyOpen(true), 'data-slot': 'body-toggle', role: 'button' } : {})}
            className={clsx(
              bodyIsLong && 'cursor-pointer',
              // One line rather than two on the cards carrying BOTH a chart and
              // a control. Those are the cards where a screen genuinely runs
              // out, and the second line of prose is the cheapest thing on it.
              bodyIsLong && (
                hasEvidence && detail && card.prompt ? 'line-clamp-1'
                  : hasEvidence && detail ? 'line-clamp-2'
                  : 'line-clamp-3'
              ),
            )}
          >
            {card.body}
          </p>
          {bodyIsLong && (
            <button
              type="button"
              onClick={() => setBodyOpen(true)}
              className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 no-touch-target"
            >
              more
            </button>
          )}
        </div>

        {/* The question, in its own right.
            WHAT HAPPENED is the headline, WHY IT MATTERS is the metric, and
            this is the third thing a reader needs and the only one that had no
            home: it was either the last clause of the body or buried inside a
            response control they had to scroll to before knowing a question
            existed. On a phone, where engagement is decided in about a second,
            that ordering is the whole problem. Set in the surface accent so it
            reads as the card speaking rather than as more body copy. */}
        {card.prompt && (
          <p
            data-slot="prompt"
            className={clsx('mt-3 shrink-0 text-[15px] font-semibold leading-snug', skin.accentText)}
          >
            {card.prompt}
          </p>
        )}

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
          <div className="mt-3.5 shrink-0">
            <div className="flex items-center gap-x-2 overflow-hidden whitespace-nowrap text-[13px]">
              {card.context.map((chip, i) => (
                <span key={chip.label} className="flex items-center gap-2">
                  {i > 0 && <span className="text-gray-300 dark:text-gray-600" aria-hidden>·</span>}
                  {/* A chip that has books behind it DISCLOSES; it does not
                      navigate.

                      Tapping "Vision Fund" used to leave the feed immediately,
                      and "In 2 portfolios" was inert text stating a number the
                      reader obviously wanted to open. Both are the same
                      mistake. The answer — which books, and how big — fits in
                      the card, and leaving the feed to find it costs the reader
                      their place in it. Navigation is still available, as an
                      explicit action per row below. */}
                  {chip.portfolios?.length ? (
                    <button
                      type="button"
                      data-slot="context-disclose"
                      aria-expanded={booksOpen === chip.label}
                      onClick={() => setBooksOpen(v => (v === chip.label ? null : chip.label))}
                      className="flex items-center gap-1 font-semibold text-gray-700 underline decoration-dotted decoration-gray-400 underline-offset-2 active:opacity-70 dark:text-gray-200 no-touch-target"
                    >
                      {chip.label}
                      <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', booksOpen === chip.label && 'rotate-180')} />
                    </button>
                  ) : chip.href && onContext ? (
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

            {/* Bounded on purpose, and never scrollable.
                Four rows is about 150px, which a card can absorb. Beyond that
                the count is stated rather than the rows rendered — a scroller
                here would be a second vertical scroll owner inside a feed whose
                whole gesture contract is that there is exactly one. */}
            {openBooks && (
              <div data-slot="portfolio-disclosure" className="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                {openBooks.slice(0, MAX_DISCLOSED_BOOKS).map(pf => (
                  <div key={pf.name} data-slot="portfolio-row"
                    className="flex items-center gap-2 border-b border-gray-100 px-2.5 py-1.5 last:border-b-0 dark:border-gray-800">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                      {pf.name}
                    </span>
                    {pf.weightPct != null && (
                      <span className="shrink-0 text-[12px] tabular-nums text-gray-500">{pf.weightPct.toFixed(1)}%</span>
                    )}
                    {pf.activePct != null && (
                      <span className="shrink-0 text-[12px] tabular-nums text-gray-400">
                        {pf.activePct >= 0 ? '+' : ''}{pf.activePct.toFixed(1)} act
                      </span>
                    )}
                    {pf.id && onOpenPortfolio ? (
                      <button
                        type="button"
                        data-slot="portfolio-open"
                        data-portfolio={pf.id}
                        onClick={() => onOpenPortfolio(pf.id!, pf.name)}
                        className="shrink-0 rounded px-1.5 py-1 text-[12px] font-semibold text-blue-600 active:opacity-70 dark:text-blue-400 no-touch-target"
                      >
                        Open →
                      </button>
                    ) : null}
                  </div>
                ))}
                {openBooks.length > MAX_DISCLOSED_BOOKS && (
                  <p className="px-2.5 py-1.5 text-[12px] text-gray-500">
                    +{openBooks.length - MAX_DISCLOSED_BOOKS} more on the asset
                  </p>
                )}
              </div>
            )}
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
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-gray-200 px-3.5 py-2.5 text-[14px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
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
              // No longer a scroller.
              //
              // Measured at 390x844 this was hiding real content on six card
              // types — 311px of it on the six-case ladder, 272px on
              // at-expected, 127px on active risk. None of it was reachable by
              // a gesture the feed would give up, so in practice it was simply
              // gone.
              //
              // Panes that genuinely exceed a screen page sideways now; see the
              // carousel compositions in MobileDashboard.
              <div
                className={clsx('min-h-0 flex-1 overflow-hidden', detailCollapsible && 'mt-3')}
                data-testid="card-detail"
              >
                {detail}
              </div>
            )}
          </div>
        )}

        {/* The spacer is gone.
            It existed to push the action bar to the bottom of a card that was
            always exactly one screen, which is precisely the mechanism that
            padded a two-line workflow card out to 844px. With the card sized to
            its content there is no slack to absorb, and a short card ends where
            its content ends. */}
      </div>

      {/* The expanded caption. Anchored to the bottom of the content area and
          growing upward, capped so the headline stays visible — the reader has
          to be able to see what the text is about while reading it. Not
          scrollable: at 70% of a full screen this holds roughly 20 lines, and
          any card whose body exceeds that has a copy problem, not a layout one. */}
      {bodyOpen && bodyIsLong && (
        <button
          type="button"
          data-slot="body-overlay"
          onClick={() => setBodyOpen(false)}
          className="absolute inset-x-0 bottom-0 z-20 flex max-h-[70%] flex-col justify-end px-5 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-10 text-left"
        >
          {/* Fades into the card rather than cutting a hard edge across the
              chart it is covering. */}
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-white via-white/98 to-white/0 dark:from-gray-900 dark:via-gray-900/98 dark:to-gray-900/0" aria-hidden />
          <span className="relative text-[15px] leading-[1.5] text-gray-700 dark:text-gray-200">
            {card.body}
            <span className="ml-1 font-semibold text-gray-500 dark:text-gray-400">less</span>
          </span>
        </button>
      )}

      {/* Actions at the end of the card, and pinned while it is taller than the
          viewport so the gesture is in the same place on every card type.

          The bottom inset is not decoration: on iOS the home indicator sits
          over the last ~34px of the viewport, and a 44px button ending flush
          with the card was a button whose bottom third could not be tapped. */}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-gray-100 bg-white/95 px-4 pt-3 pb-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
        {card.actions.quick.map(a => (
          <button
            key={a.id}
            type="button"
            data-slot="quick"
            onClick={() => onAction(a.id, card)}
            className="h-11 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-gray-200 text-[15px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          data-slot="primary"
          onClick={() => onAction(card.actions.primary.id, card)}
          className="h-11 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl bg-gray-900 text-[15px] font-bold text-white dark:bg-white dark:text-gray-900"
        >
          {card.actions.primary.label}
        </button>
        <button
          type="button"
          data-slot="open"
          onClick={() => onOpen(card)}
          className="h-11 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-gray-200 text-[15px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
        >
          {card.actions.open.label}
        </button>
      </div>
    </article>
  )
}
