/**
 * The Outcomes position chart's data model, shared by the desktop chart
 * (`PositionChart`) and the phone chart (`PositionChartMobile`).
 *
 * Pure: no React, no Recharts. The desktop chart's merge was lifted out of its
 * component unchanged so both charts plot the same numbers.
 */

import { format, parseISO, subDays, subMonths } from 'date-fns'
import type { PositionLifecycle, PositionEvent, PricePoint, HoldingsTimePoint } from '../../hooks/usePositionLifecycle'

export type OverlayField = 'shares' | 'weight' | 'active_weight'

const ACTION_CONFIG: Record<string, { color: string; symbol: string; label: string }> = {
  buy:       { color: '#22c55e', symbol: '▲', label: 'Buy' },
  add:       { color: '#22c55e', symbol: '+', label: 'Add' },
  sell:      { color: '#ef4444', symbol: '▼', label: 'Sell' },
  trim:      { color: '#ef4444', symbol: '−', label: 'Trim' },
  initiate:  { color: '#22c55e', symbol: '▲', label: 'Initiate' },
  exit:      { color: '#ef4444', symbol: '▼', label: 'Exit' },
  reduce:    { color: '#f59e0b', symbol: '−', label: 'Reduce' },
  increase:  { color: '#3b82f6', symbol: '+', label: 'Increase' },
}

export function getActionConfig(action: string) {
  return ACTION_CONFIG[action] || { color: '#6b7280', symbol: '●', label: action }
}

/** One plotted day: price, the holdings carried to that day, and any
 *  decision / execution that happened on it. */
export interface PositionChartRow {
  date: string
  price: number | null
  shares: number | null
  weightPct: number | null
  activeWt: number | null
  decisionAction: string | null
  decisionPrice: number | null
  decisionUser: string | null
  execAction: string | null
  execPrice: number | null
  execShares: number | null
  eventSourceId: string | null
  eventSourceType: 'trade_queue_item' | 'portfolio_trade_event' | null
  events: PositionEvent[]
}

/** Where a row's decision / execution marker sits relative to its price
 *  point, or null when the row has none. Shared by the drawn marker and the
 *  phone chart's tap target so the two cannot drift apart. */
export function markerGeometry(row: Pick<PositionChartRow, 'decisionAction' | 'execAction'>, cx: number, cy: number) {
  const hasDecision = !!row.decisionAction
  const hasExec = !!row.execAction && !hasDecision
  if (!hasDecision && !hasExec) return null
  const action = (hasDecision ? row.decisionAction : row.execAction) as string
  const isBullish = action === 'buy' || action === 'add' || action === 'initiate' || action === 'increase'
  const offset = hasDecision ? 16 : 12
  const markerRadius = hasDecision ? 7 : 5
  return { hasDecision, hasExec, action, isBullish, markerRadius, x: cx, y: isBullish ? cy - offset : cy + offset }
}

/**
 * Merge price history with decisions, executions and holdings into one row
 * per date.
 */
export function buildPositionChartData(
  lifecycle: PositionLifecycle,
  priceHistory: PricePoint[],
  holdingsHistory: HoldingsTimePoint[] | undefined,
  benchmarkWeightPct: number | null | undefined,
): PositionChartRow[] {
  // Build event map by date
  const eventsByDate = new Map<string, PositionEvent[]>()
  for (const evt of lifecycle.timeline) {
    const dateKey = evt.date.slice(0, 10)
    const list = eventsByDate.get(dateKey) || []
    list.push(evt)
    eventsByDate.set(dateKey, list)
  }

  // Build holdings map by date
  const holdingsByDate = new Map<string, HoldingsTimePoint>()
  if (holdingsHistory) {
    for (const h of holdingsHistory) {
      holdingsByDate.set(h.date, h)
    }
  }

  // Build a price map for quick lookup, then build the union of all
  // dates we want to plot. Decisions/executions made on a day that
  // hasn't landed in price_history_cache yet (e.g., a pilot scenario
  // approved today) would otherwise be silently dropped — the marker
  // pipeline anchors to dates present in this array, so the union
  // ensures every event has a row to attach to.
  const priceByDate = new Map<string, number>()
  for (const p of priceHistory) priceByDate.set(p.date, p.close)

  const allDates = new Set<string>()
  for (const p of priceHistory) allDates.add(p.date)
  for (const d of eventsByDate.keys()) allDates.add(d)
  for (const d of holdingsByDate.keys()) allDates.add(d)

  if (allDates.size === 0) return []

  const sortedDates = Array.from(allDates).sort((a, b) => a.localeCompare(b))

  // Forward-fill price across the merged timeline so synthetic event
  // dates (no cached close) still get a y-coordinate. Falls back to
  // the decision/execution snapshot price, then the asset's current
  // price, so the marker can always render somewhere sensible.
  let lastClose: number | null = null
  // Track last-known shares AND weight for step interpolation. Holdings
  // snapshots aren't taken every day, so without carry-forward the
  // shares/weight/active-weight overlays go blank on any day without a
  // snapshot — makes the line look broken. Forward-fill until the next
  // known snapshot overrides it.
  //
  // For newly-opened positions (one snapshot ever, opened by a buy/
  // initiate decision), seed a 0-shares baseline so the area has at
  // least two anchor points and actually renders. Without this, a
  // "today only" pilot trade leaves the overlay invisible because
  // Recharts can't draw an area from a single data point.
  const onlyOneSnapshot = (holdingsHistory?.length ?? 0) <= 1
  const firstDecision = lifecycle.timeline.find(e => e.type === 'decision' && e.stage === 'approved')
  const isNewPosition = !!firstDecision && (firstDecision.action === 'buy' || firstDecision.action === 'initiate')
  let lastShares: number | null = onlyOneSnapshot && isNewPosition ? 0 : null
  let lastWeightPct: number | null = onlyOneSnapshot && isNewPosition ? 0 : null
  // Missing benchmark weight is treated as 0 — an asset outside the
  // benchmark has an active weight equal to its portfolio weight.
  const benchWt = benchmarkWeightPct != null && Number.isFinite(benchmarkWeightPct)
    ? benchmarkWeightPct
    : 0

  return sortedDates.map(date => {
    const cachedClose = priceByDate.get(date)
    if (cachedClose != null) lastClose = cachedClose

    const events = eventsByDate.get(date) || []
    const decisions = events.filter(e => e.type === 'decision' && e.stage === 'approved')
    const executions = events.filter(e => e.type === 'execution')

    // Pick the best available price for this row's price line. Prefer
    // cached market close, fall back to the day's decision/execution
    // snapshot, then the carried-forward last close, then current
    // price as a last resort so the marker still renders.
    const eventPrice = decisions[0]?.price ?? executions[0]?.price ?? null
    const price = cachedClose ?? eventPrice ?? lastClose ?? lifecycle.currentPrice ?? null

    // Holdings: use exact match or carry forward last known
    const holding = holdingsByDate.get(date)
    if (holding) {
      lastShares = holding.shares
      if (holding.weightPct != null) lastWeightPct = holding.weightPct
    }
    const shares = holding?.shares ?? lastShares
    const weightPct = holding?.weightPct ?? lastWeightPct
    // Active weight = portfolio weight − benchmark weight. Null only
    // when we have no portfolio weight yet (pre-entry).
    const activeWt = weightPct != null ? weightPct - benchWt : null

    // Source id for click-to-isolate. Prefer decisions since those
    // are what the Decisions list keys on (trade_queue_item_id).
    const selectableEvent = decisions[0] || executions[0] || null

    return {
      date,
      price,
      shares,
      weightPct,
      activeWt,
      decisionAction: decisions[0]?.action || null,
      decisionPrice: decisions[0]?.price || null,
      decisionUser: decisions[0]?.userName || null,
      execAction: executions[0]?.action || null,
      execPrice: executions[0]?.price || null,
      execShares: executions[0]?.sharesDelta || null,
      eventSourceId: selectableEvent?.sourceId ?? null,
      eventSourceType: selectableEvent?.sourceType ?? null,
      events,
    }
  })
}

// ── Phone chart model ───────────────────────────────────────────────────

export type ChartRange = '3M' | '6M' | '1Y' | 'All'

const RANGE_MONTHS: Record<Exclude<ChartRange, 'All'>, number> = { '3M': 3, '6M': 6, '1Y': 12 }

/** Tap radius around a marker's centre, in px. The drawn decision marker is
 *  7px in radius; a fingertip is ~20px across. */
export const MARKER_HIT_RADIUS = 22

/** Height of the phone chart's plot, in px. */
export const PLOT_HEIGHT = 264

function compactShares(v: number) {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (a >= 10_000) return `${Math.round(v / 1000)}k`
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`
  return `${Math.round(v)}`
}

/** The secondary metric: its row field, colour, and units. Weight and active
 *  weight are percentages on their own scales — never the share scale. */
export const METRICS: Record<OverlayField, {
  label: string
  short: string
  color: string
  key: 'shares' | 'weightPct' | 'activeWt'
  /** Tooltip value, with unit. */
  format: (v: number) => string
  /** Axis tick, with unit. */
  tick: (v: number) => string
}> = {
  shares: {
    label: 'Shares', short: 'Shares', color: '#8b5cf6', key: 'shares',
    format: v => `${Math.round(v).toLocaleString('en-US')} shs`,
    tick: compactShares,
  },
  weight: {
    label: 'Weight', short: 'Weight', color: '#0d9488', key: 'weightPct',
    format: v => `${v.toFixed(2)}%`,
    tick: v => `${v.toFixed(1)}%`,
  },
  active_weight: {
    label: 'Active weight', short: 'Active wt', color: '#db2777', key: 'activeWt',
    format: v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`,
    tick: v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
  },
}

export const METRIC_ORDER: OverlayField[] = ['shares', 'weight', 'active_weight']

/** Which metrics have real history. Active weight is derived from weight, so
 *  it has history exactly when weight does. */
export function metricAvailability(rows: PositionChartRow[]): Record<OverlayField, boolean> {
  const shares = rows.some(r => r.shares != null && Number.isFinite(r.shares) && r.shares > 0)
  const weight = rows.some(r => r.weightPct != null && Number.isFinite(r.weightPct) && r.weightPct > 0)
  return { shares, weight, active_weight: weight }
}

export function rangeCutoff(rows: PositionChartRow[], range: Exclude<ChartRange, 'All'>) {
  const last = parseISO(rows[rows.length - 1].date)
  return format(subMonths(last, RANGE_MONTHS[range]), 'yyyy-MM-dd')
}

/** Ranges that actually crop the data, plus All. Anchored on the latest
 *  plotted date rather than the clock, so a stale price cache still reads. */
export function availableRanges(rows: PositionChartRow[]): ChartRange[] {
  if (rows.length < 2) return ['All']
  const first = rows[0].date
  const cropping = (['3M', '6M', '1Y'] as const).filter(r => rangeCutoff(rows, r) > first)
  return [...cropping, 'All']
}

/** The shortest range that shows the first entry (with a week of lead-in)
 *  through the latest date; 1Y when there is no entry to show. */
export function defaultRange(rows: PositionChartRow[], lifecycle: Pick<PositionLifecycle, 'timeline'>): ChartRange {
  const ranges = availableRanges(rows)
  const entry = lifecycle.timeline
    .filter(e => e.type === 'execution' || (e.type === 'decision' && e.stage === 'approved'))
    .map(e => e.date.slice(0, 10))
    .sort()[0]
  if (!entry) return ranges.includes('1Y') ? '1Y' : 'All'
  const leadIn = format(subDays(parseISO(entry), 7), 'yyyy-MM-dd')
  for (const r of ranges) {
    if (r === 'All') return 'All'
    if (rangeCutoff(rows, r) <= leadIn) return r
  }
  return 'All'
}
