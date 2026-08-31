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

/** "246d" → a window label that never overstates what was measured. */
export function windowLabel(w: PriceWindow, ageDays: number | null): string {
  if (w.reachesAnchor && ageDays != null) return `since review · ${ageDays}d`
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
  if (!e) return item

  const ageDays = ageFromMetrics(item)
  const window = priceWindowSince(e.history, item.source.createdAt)

  const metrics = enrichMetrics(item, e, window)
  const visual = enrichVisual(item, e, window, ageDays)
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

function ageFromMetrics(item: TodayItem): number | null {
  const m = item.metrics.find(x => x.label === 'Since review' || x.label === 'Open')
  if (!m) return null
  const n = Number(m.value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function enrichMetrics(
  item: TodayItem, e: TodayEnrichment, w: PriceWindow | null,
): TodayMetric[] {
  const out = [...item.metrics]

  // Price movement, labelled by what was actually measured.
  if (w) {
    out.push({
      label: w.reachesAnchor ? 'Since review' : 'Over history',
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
      return {
        archetype: 'scenario',
        caption: 'Spot against the framework',
        window: `${e.ladder.cases.length} cases · ${e.ladder.updatedAt.slice(0, 10)}`,
        note: beyond
          ? `Spot is ${pct(((spot - bull) / bull) * 100)} above the bull case. No case produces this price.`
          : spot < bear
            ? `Spot is below the bear case.`
            : 'Spot sits inside the framework.',
        scenario: {
          cases: e.ladder.cases.map(c => ({ name: c.name, price: c.price })),
          spot,
        },
      }
    }
  }

  if (w && (item.source.titleKey === 'THESIS_STALE' || item.source.titleKey === 'RATING_NO_FOLLOWUP')) {
    return {
      archetype: 'review-window',
      caption: w.reachesAnchor ? 'Price since last review' : 'Price over available history',
      window: windowLabel(w, ageDays),
      note: w.reachesAnchor
        ? undefined
        : 'History does not reach the review date, so this is not a since-review move.',
      reviewWindow: {
        series: w.series,
        changePct: w.changePct,
        reachesAnchor: w.reachesAnchor,
      },
    }
  }

  return item.visual
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
