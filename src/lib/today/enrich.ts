/**
 * Today — enrichment of the surfaced set.
 *
 * ── Why this runs after selection, not before ─────────────────────────────
 *
 * The engine loads what every evaluator needs. Price history and scenario
 * ladders are needed by neither, and fetching them for the whole candidate
 * pool would mean reading history for every stale thesis in the book to draw
 * four charts. So the order is deliberate:
 *
 *   expand → rank → diversify → cut to four → enrich those four → render
 *
 * Four symbols of history and four assets' targets, fetched once. "Also
 * watching" is never enriched because it never draws anything.
 *
 * ── Honesty rules, carried from mobile ────────────────────────────────────
 *
 * `useScenarioCards` records that only 68 of 911 assets carry a stored price,
 * and `TileSparkline` records that a line whose window is not named reads as a
 * contradiction. Both apply here. Every enriched number carries the window it
 * was measured over, and where the data does not reach the anchor the claim
 * changes rather than the number being stretched to fit.
 */

import type { CurrentLadder } from '../signals/current-ladder'
import type { TodayItem, TodayMetric, TodayVisual } from './types'

/** One asset's enrichment. Every field is optional and independently absent. */
export interface TodayEnrichment {
  /** Closes ascending, oldest first. Empty when nothing is cached. */
  history?: { date: string; close: number }[]
  /** The current framework, from the same selector Review Cases uses. */
  ladder?: CurrentLadder
  /** Latest close, when history has one. Today does not fetch live quotes. */
  spot?: number
  /** Position weight as a percent of NAV, when the asset is held. */
  weightPct?: number
  /** Market value of the position. */
  marketValue?: number
  portfolioName?: string
  /** Count of research documents linked to the asset. */
  researchCount?: number
}

export type EnrichmentMap = Record<string, TodayEnrichment>

/* -------------------------------------------------------------------------- */
/* Price movement over an honest window                                       */
/* -------------------------------------------------------------------------- */

export interface PriceWindow {
  changePct: number
  /** The first close actually used, which may be later than the anchor. */
  fromDate: string
  toDate: string
  /**
   * True when the history reaches the anchor date.
   *
   * When false the move is real but it is NOT "since review", and every label
   * built from it says so. Stretching a 90-day series to stand for 246 days
   * would be the exact fabrication the brief forbids.
   */
  reachesAnchor: boolean
  series: number[]
  /** Where in `series` the anchor falls, or null when it predates the data. */
  anchorIndex: number | null
}

export function priceWindowSince(
  history: { date: string; close: number }[] | undefined,
  anchorISO: string | undefined,
): PriceWindow | null {
  if (!history || history.length < 2) return null

  const anchor = anchorISO ? Date.parse(anchorISO) : NaN
  const hasAnchor = Number.isFinite(anchor)

  const firstDate = Date.parse(history[0].date)
  const reachesAnchor = hasAnchor && Number.isFinite(firstDate) && firstDate <= anchor

  const anchorIndex = reachesAnchor
    ? history.findIndex(p => Date.parse(p.date) >= anchor)
    : null

  const startIndex = anchorIndex != null && anchorIndex >= 0 ? anchorIndex : 0
  const from = history[startIndex]
  const to = history[history.length - 1]
  if (!from || !to || !(from.close > 0)) return null

  return {
    changePct: ((to.close - from.close) / from.close) * 100,
    fromDate: from.date,
    toDate: to.date,
    reachesAnchor: !!reachesAnchor,
    series: history.slice(startIndex).map(p => p.close),
    anchorIndex: anchorIndex != null && anchorIndex >= 0 ? 0 : null,
  }
}

/**
 * "246d" → a window label that never overstates what was measured.
 *
 * `since` names the anchor the caller actually measured from. It defaults to
 * "review" because that was the only anchor when this was written, and three
 * of the four findings that now draw a window are not measured from a review
 * at all — an unconfirmed execution is measured from the decision.
 */
export function windowLabel(
  w: PriceWindow, ageDays: number | null, since = 'review',
): string {
  if (w.reachesAnchor && ageDays != null) return `since ${since} · ${ageDays}d`
  const days = Math.round((Date.parse(w.toDate) - Date.parse(w.fromDate)) / 86_400_000)
  return `${days}d of history`
}

/* -------------------------------------------------------------------------- */
/* Applying enrichment                                                        */
/* -------------------------------------------------------------------------- */

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

/**
 * Fold an asset's enrichment into a surfaced item.
 *
 * Pure, and additive: with no enrichment the item is returned unchanged, which
 * is what every test of the unenriched path relies on. Nothing here invents a
 * number — each branch requires its own input to exist.
 */
export function applyEnrichment(item: TodayItem, e: TodayEnrichment | undefined): TodayItem {
  const ageDays = ageFromMetrics(item)

  /*
   * A card with nothing to draw is worse than a card drawing the one fact it
   * has -- and this runs whether or not enrichment arrived.
   *
   * `visualFor` suppresses the aging visual when the age is already in the
   * metric strip, and says so: "fall through to no visual and let enrichment
   * offer a real one". That is right whenever enrichment CAN. For a name with
   * no price history it cannot, and the fall-through lands on nothing: BABA,
   * a written case nobody has revisited in eleven months, rendered as a
   * ticker, a sentence and two hundred pixels of white.
   *
   * The duplication that rule was avoiding is a number, not a picture. The
   * strip states the count; the line states the duration against a review
   * cycle, which is the thing a reader cannot do in their head and the whole
   * finding on a card whose complaint is that nobody has looked.
   */
  const aged = ageVisual(item, ageDays)
  if (!e) return aged ? { ...item, visual: aged } : item
  const window = priceWindowSince(e.history, item.source.createdAt)

  const metrics = enrichMetrics(item, e, window, ANCHORED_KEYS[item.source.titleKey ?? ''])
  const enriched = enrichVisual(item, e, window, ageDays)
  const visual = enriched.archetype === 'metrics' ? (aged ?? enriched) : enriched
  const claim = enrichClaim(item, e, window, ageDays)

  return {
    ...item,
    metrics,
    visual,
    claim,
    target: item.target
      ? { ...item.target, contextChips: enrichChips(item, e, window, ageDays) }
      : null,
  }
}

/** The age as a duration, for a card that would otherwise draw nothing. */
function ageVisual(item: TodayItem, ageDays: number | null): TodayVisual | null {
  if (item.visual.archetype !== 'metrics' || ageDays == null || ageDays <= 0) return null
  return {
    archetype: 'aging',
    caption: 'Unreviewed for',
    window: `${ageDays} day${ageDays === 1 ? '' : 's'}`,
    note: 'Nothing has been recorded against this case since it was written.',
    aging: {
      days: ageDays,
      milestones: [
        { label: 'written', atPct: 0, hot: false },
        { label: 'today', atPct: 100, hot: ageDays >= 180 },
      ],
    },
  }
}

function ageFromMetrics(item: TodayItem): number | null {
  const m = item.metrics.find(x => x.label === 'Since review' || x.label === 'Open')
  if (!m) return null
  const n = Number(m.value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function enrichMetrics(
  item: TodayItem, e: TodayEnrichment, w: PriceWindow | null,
  anchor?: { shortSince: string },
): TodayMetric[] {
  const out = [...item.metrics]

  /*
   * Price movement, labelled by what was actually measured.
   *
   * This said "Since review" whatever the finding was, which put two metrics
   * carrying different things under one word: the Age chip also maps to
   * "Since review", so an unconfirmed execution rendered `4d · SINCE REVIEW`
   * immediately beside `+2.0% · SINCE REVIEW` — same label, one a duration and
   * one a price move, neither measured from a review.
   *
   * Naming the quantity as well as the window separates them, and the window
   * is the finding's own anchor rather than a borrowed one.
   */
  if (w) {
    out.push({
      label: w.reachesAnchor
        ? `Price since ${anchor?.shortSince ?? 'review'}`
        : 'Price over history',
      value: pct(w.changePct),
      // Neutral either way. The sign is in the value; the colour would be a
      // verdict on a price move, which is the same category error the charts
      // just stopped making.
      tone: 'neutral',
    })
  }
  if (e.weightPct != null) {
    out.push({ label: 'Weight', value: `${e.weightPct.toFixed(1)}%`, tone: 'neutral' })
  }
  if (e.researchCount) {
    out.push({ label: 'Linked research', value: String(e.researchCount), tone: 'neutral' })
  }

  // Four is the ceiling; beyond that the strip stops being scannable.
  return out.slice(0, 4)
}

/**
 * Upgrade the visual when enrichment makes a stronger one honest.
 *
 * A real ladder beats everything: it is the only visual that compares the
 * price to the desk's own framework. A real price window beats the staleness
 * bars, which were only ever a shape. Otherwise the original stands.
 */
function enrichVisual(
  item: TodayItem, e: TodayEnrichment, w: PriceWindow | null, ageDays: number | null,
): TodayVisual {
  const spot = e.spot
  if (e.ladder?.valid && spot != null) {
    const prices = e.ladder.cases.map(c => c.price).filter(p => Number.isFinite(p))
    if (prices.length >= 2) {
      const bull = Math.max(...prices)
      const bear = Math.min(...prices)
      const beyond = spot > bull
      /*
       * "Spot" is desk shorthand for the current price, and it was the
       * loudest word on the card -- as a caption, three times in the note,
       * and as a bold tick label over the mark itself. It says nothing a
       * reader does not already get from "price now", and the one thing it
       * adds is the impression that you need the vocabulary to belong here.
       *
       * The framework's own words -- bear, base, bull -- stay, because those
       * are the desk's names for its own cases and a reader who wrote them
       * needs them back unchanged.
       */
      return {
        archetype: 'scenario',
        caption: 'Price against the framework',
        window: `${e.ladder.cases.length} cases · ${e.ladder.updatedAt.slice(0, 10)}`,
        note: beyond
          ? `The price is ${pct(((spot - bull) / bull) * 100)} above the bull case. No case we wrote produces it.`
          : spot < bear
            ? 'The price is below the bear case. No case we wrote produces it.'
            : 'The price sits inside the framework.',
        scenario: {
          cases: e.ladder.cases.map(c => ({ name: c.name, price: c.price })),
          spot,
        },
      }
    }
  }

  const anchor = ANCHORED_KEYS[item.source.titleKey ?? '']
  if (w && anchor) {
    return {
      archetype: 'review-window',
      caption: w.reachesAnchor ? `Price since ${anchor.since}` : 'Price over available history',
      window: windowLabel(w, ageDays, anchor.shortSince),
      note: w.reachesAnchor
        ? undefined
        : `History does not reach ${anchor.the}, so this is not a since-${anchor.shortSince} move.`,
      reviewWindow: {
        series: w.series,
        changePct: w.changePct,
        reachesAnchor: w.reachesAnchor,
        anchorLabel: anchor.tick,
      },
    }
  }

  return item.visual
}

/**
 * Which findings anchor a price path, and what their anchor actually is.
 *
 * The window is measured from `source.createdAt`, and each evaluator sets that
 * to the event its finding is about — so the anchor is already meaningful for
 * more keys than the two that were drawing it:
 *
 *   THESIS_STALE                 thesis.updated_at        the last review
 *   RATING_NO_FOLLOWUP           change.changed_at        the rating change
 *   EXECUTION_NOT_CONFIRMED      idea.decided_at          the decision itself
 *   PROPOSAL_AWAITING_DECISION   idea.updated_at          the proposal
 *
 * Extending it to the last two measures nothing new: `enrichMetrics` already
 * computes this exact number and prints it in the strip for every enriched
 * item whatever its key. Only the DRAWING was gated to two keys, which is why
 * an unconfirmed execution — a decision the book has not caught up with —
 * rendered a bar of its own age instead of the price it has been drifting
 * against since someone committed capital to it.
 *
 * Each key names its own anchor rather than borrowing "last review", which
 * would be false on three of the four.
 *
 * OVERDUE_DELIVERABLE is deliberately absent: it carries no asset and sets no
 * `createdAt`, so there is no price and no anchor. It draws nothing, which is
 * the honest outcome rather than a fabricated one.
 */
const ANCHORED_KEYS: Record<
  string, { since: string; shortSince: string; the: string; tick: string }
> = {
  THESIS_STALE: {
    since: 'last review', shortSince: 'review', the: 'the review date', tick: 'LAST REVIEW',
  },
  RATING_NO_FOLLOWUP: {
    since: 'the rating changed', shortSince: 'change', the: 'the change date', tick: 'RATING CHANGE',
  },
  EXECUTION_NOT_CONFIRMED: {
    since: 'the decision', shortSince: 'decision', the: 'the decision date', tick: 'DECISION',
  },
  PROPOSAL_AWAITING_DECISION: {
    since: 'the proposal', shortSince: 'proposal', the: 'the proposal date', tick: 'PROPOSAL',
  },
}

/**
 * Make the claim specific to the object once real numbers exist.
 *
 * The generic sentence was identical across every stale thesis, which is what
 * made four of them read as one finding repeated. Each clause below is added
 * only when its number is real.
 */
function enrichClaim(
  item: TodayItem, e: TodayEnrichment, w: PriceWindow | null, ageDays: number | null,
): string {
  if (item.source.titleKey !== 'THESIS_STALE') return item.claim
  if (!w && e.weightPct == null) return item.claim

  const parts: string[] = []
  parts.push(
    ageDays != null
      ? `The thesis has not been revisited in ${ageDays} days`
      : 'The thesis has not been revisited',
  )
  if (w) {
    parts.push(
      w.reachesAnchor
        ? `while the stock moved ${pct(w.changePct)}`
        : `while the stock moved ${pct(w.changePct)} over the history we hold`,
    )
  }
  if (e.weightPct != null) {
    parts.push(`and the position remains ${e.weightPct.toFixed(1)}% of the book`)
  }
  return `${parts.join(' ')}.`
}

/** The context the AI pane shows as already supplied. */
function enrichChips(
  item: TodayItem, e: TodayEnrichment, w: PriceWindow | null, ageDays: number | null,
): { label: string; value: string }[] {
  const chips = [...(item.target?.contextChips ?? [])]
  if (ageDays != null) chips.push({ label: 'Since review', value: `${ageDays}d` })
  if (w) {
    chips.push({
      label: w.reachesAnchor ? 'Move since review' : 'Move over history',
      value: pct(w.changePct),
    })
  }
  if (e.weightPct != null) chips.push({ label: 'Portfolio weight', value: `${e.weightPct.toFixed(1)}%` })
  if (e.portfolioName) chips.push({ label: 'Portfolio', value: e.portfolioName })
  if (e.researchCount) chips.push({ label: 'Linked research', value: `${e.researchCount} docs` })
  if (e.ladder?.valid) chips.push({ label: 'Framework', value: `${e.ladder.cases.length} cases` })
  return chips
}
