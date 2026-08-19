import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { SignalCardView } from '../src/components/signals/SignalCardView'
import { buildActiveRiskCard } from '../src/lib/signals/builders/activeRisk'
import { buildRecommendationCard } from '../src/lib/signals/builders/recommendation'
import { buildNewsCard } from '../src/lib/signals/builders/news'
import { buildScenarioGapCard } from '../src/lib/signals/builders/scenarioGap'
import { ScenarioLadder } from '../src/components/signals/ScenarioLadder'
import { ScenarioCaseDetail } from '../src/components/signals/ScenarioCaseDetail'
import { ScenarioDistribution } from '../src/components/signals/ScenarioDistribution'
import { CardCarousel } from '../src/components/signals/CardCarousel'
import { ActiveWeightPeers } from '../src/components/signals/ActiveWeightPeers'
import { WhatIfSize } from '../src/components/signals/WhatIfSize'
import { PriceContext, type PricePoint } from '../src/components/signals/PriceContext'
import { WeightBars } from '../src/components/signals/WeightBars'
import { WeightSeries } from '../src/components/signals/WeightSeries'
import { CaseEditor } from '../src/components/signals/CaseEditor'
import { buildWeightSeries } from '../src/lib/portfolio/weight-series'
import { buildIdeaCard } from '../src/lib/signals/builders/ideas'
import { buildStaleTargetCard, buildNoTargetCard } from '../src/lib/signals/builders/legacy-kinds'
import { TargetTuner } from '../src/components/signals/TargetTuner'
import { VerdictBar } from '../src/components/signals/VerdictBar'
import { HorizonTimeline } from '../src/components/signals/HorizonTimeline'
import type { CardResult, SignalCard } from '../src/lib/signals/contract'

/**
 * A gallery of every card the builders can emit, rendered through the real
 * component with the real stylesheet.
 *
 * It is a separate Vite entry rather than a route in the app so that nothing
 * here can reach the production bundle, and so the layout assertions in
 * e2e/signal-cards.spec.ts have something deterministic to measure — the feed
 * itself depends on live data and cannot be a stable subject for a height
 * assertion.
 *
 * ── On the clock, and why this is an OFFSET and not a fixed instant ───────
 *
 * The rendered date has to be stable; the underlying timestamp must not be.
 *
 * This was a frozen instant — `new Date('2026-08-15T14:00:00Z')` — on the
 * reasoning that a card reading "2 hours ago" one day and "3 hours ago" the
 * next makes every screenshot diff meaningless. True, and it broke the whole
 * gallery three days later: the builders call `Date.now()`, not this constant,
 * so the news fixture aged past `MAX_AGE_DAYS` and `buildNewsCard` correctly
 * suppressed it. `unwrap` threw, React never mounted, and all 69 layout
 * assertions failed at once on a page with zero cards — with no test naming
 * the news card, because the failure was the whole bundle.
 *
 * A fixture pinned to a wall-clock date is a time bomb with a fuse the length
 * of its own expiry window. Offsets from the real clock give the same stable
 * rendered text — "about 1 hour ago" is "about 1 hour ago" forever — while
 * staying inside every freshness rule the builders enforce.
 *
 * Absolute dates below are NOT offsets and must not become them: `asOf`
 * values are real snapshot dates from the database, and the eyebrow prints
 * them verbatim as "holdings 31 Jul".
 */

const NOW = new Date()

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason} — ${r.detail}`)
  return r.card
}

const activeRisk = unwrap(buildActiveRiskCard({
  assetId: 'a1', symbol: 'MSFT', companyName: 'Microsoft',
  weightPct: 6.2, benchmarkWeightPct: 3.1,
  portfolioId: 'p1', portfolioName: 'Core Equity',
  asOf: '2026-07-31T00:00:00.000Z',
}))

/**
 * A target's stated date and the day its horizon ran out.
 *
 * Absolute, not offsets, and deliberately so. These have to line up with
 * `AAPL_CLOSES`, which is a fixed window of real closes ending 17 Apr 2026 — an
 * offset from the real clock would walk the horizon marker straight off the end
 * of the series, and `PriceContext` correctly drops a marker it cannot place,
 * so the fixture would quietly stop covering the thing it exists to cover.
 */
const STALE_STATED_AT = '2025-02-14T00:00:00.000Z'
const STALE_HORIZON_AT = '2026-02-13T00:00:00.000Z'

const staleTarget = unwrap(buildStaleTargetCard({
  assetId: 'aapl', symbol: 'AAPL', companyName: 'Apple',
  target: 245, price: 212.44,
  timeframe: '12 months',
  ageMonths: 18, overdueMonths: 6,
  heldIn: ['Core Equity', 'Large Cap Growth'],
  heldInIds: ['p1', 'p2'],
  statedAt: STALE_STATED_AT,
  expiredAt: STALE_HORIZON_AT,
  asOf: '2026-04-21T00:00:00.000Z',
}))

const noTarget = unwrap(buildNoTargetCard({
  assetId: 'aapl', symbol: 'AAPL', companyName: 'Apple',
  weightPct: 4.8, portfolioName: 'Core Equity',
  price: 212.44,
  heldIn: ['Core Equity', 'Large Cap Growth'],
  heldInIds: ['p1', 'p2'],
  conviction: 'high',
  asOf: '2026-04-21T00:00:00.000Z',
}))

const recommendation = unwrap(buildRecommendationCard({
  id: 'r1', assetId: 'a2', symbol: 'DASH', action: 'trim',
  proposedWeightPct: 1.5, currentWeightPct: 4.0,
  currentWeightAsOf: '2026-07-31T00:00:00.000Z',
  rationale: 'Multiple has re-rated past our bull case and the delivery margin story is now consensus. The position was sized for an outcome that has already happened, and holding it at four percent is a new decision nobody has made.',
  recommendedBy: 'Priya Raman',
  portfolioId: 'p1', portfolioName: 'Core Equity',
  createdAt: new Date(NOW.getTime() - 6 * 86_400_000).toISOString(),
}))

const news = unwrap(buildNewsCard({
  id: 'n1',
  headline: 'Microsoft raises quarterly dividend and expands buyback authorisation',
  summary: 'The company lifted its payout by 10% and added $60bn to its repurchase programme, the largest single authorisation in its history.',
  url: 'https://example.com/story', source: 'Reuters',
  publishedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
  primarySymbol: 'MSFT',
  asset: { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' },
  heldIn: ['Core Equity', 'Growth'], maxWeightPct: 6.2,
}))

/**
 * A constructed variant, not a builder output.
 *
 * None of the three builders emits evidence today — the contract's rule is
 * that a chart needs an argument to appear, and none of them has one yet. This
 * exists so the gallery can show the two states side by side: what a card with
 * a sparkline looks like, and that the slot leaves no gap without one.
 */
const withSparkline: SignalCard = {
  ...activeRisk,
  id: 'active_risk:with-evidence',
  evidence: {
    kind: 'sparkline',
    data: [402, 398, 405, 411, 409, 415, 421, 418, 424, 430, 427, 433],
    annotations: [{ date: '2026-07-15T00:00:00.000Z', label: 'Added', kind: 'entry' }],
  },
}

const Sparkline = ({ points }: { points: number[] }) => {
  const min = Math.min(...points)
  const max = Math.max(...points)
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * 100},${28 - ((p - min) / (max - min)) * 26}`)
    .join(' ')
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="w-full h-8" data-testid="sparkline">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5"
        className="text-gray-400 dark:text-gray-500" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * Real production ladders, read from analyst_price_targets on 2026-08-16.
 * The price is stamped now so the freshness guard passes in the gallery; every
 * other number is exactly what is in the database.
 */
const tsla = unwrap(buildScenarioGapCard({
  assetId: 'tsla', symbol: 'TSLA', companyName: 'Tesla',
  price: 248.90, priceAsOf: new Date().toISOString(),
  cases: [
    { name: 'Bear', price: 325, probability: 10, timeframe: '6 months', reasoning: 'Robotaxi slips another year and the energy business carries the multiple alone.' },
    { name: 'Base', price: 375, probability: 15, timeframe: '6 months' },
    { name: 'Bull', price: 400, probability: 75, timeframe: '6 months', reasoning: 'FSD licensing signed with a second OEM and energy storage margin holds above 30%.' },
  ],
  heldIn: ['Tech & Consumer Growth'], statedAt: '2026-03-21T18:49:00.000Z',
}))

/**
 * The "at expected value" state.
 *
 * NOT real data, and labelled as such, because no symbol in this database has
 * both a coherent distribution and a price. AAPL's six real cases sum to 125%
 * across two horizons, so the builder correctly refuses to compute an
 * expectation from them; the symbols that do sum to 100 (COIN, DASH, PLTR)
 * have no current_price at all. That gap is a finding, not a fixture problem.
 *
 * 104 against an expectation of 105 — inside the 3% band that makes the claim
 * true.
 */
const coherent = unwrap(buildScenarioGapCard({
  assetId: 'coh', symbol: 'COH', companyName: 'Coherent Ladder Co',
  price: 104, priceAsOf: new Date().toISOString(),
  cases: [
    { name: 'Bear', price: 80, probability: 25, timeframe: '12 months',
      reasoning: 'Pricing pressure in the core segment and no offset from the new line.' },
    { name: 'Base', price: 100, probability: 50, timeframe: '12 months',
      reasoning: 'Volume holds, margin flat, multiple unchanged.' },
    { name: 'Bull', price: 140, probability: 25, timeframe: '12 months',
      reasoning: 'The new line reaches scale a year early and carries 40% gross margin.' },
  ],
  heldIn: ['Tech & Consumer Growth'], statedAt: '2026-04-04T00:00:00.000Z',
}))

const amzn = unwrap(buildScenarioGapCard({
  assetId: 'amzn', symbol: 'AMZN', companyName: 'Amazon',
  price: 232.99, priceAsOf: new Date().toISOString(),
  cases: [
    { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
    { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
    { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
  ],
  heldIn: ['Vision Fund 10K'], statedAt: '2026-02-05T00:00:00.000Z',
}))

/**
 * Two panes. Pane 3 (price against the tape) is parked: price_history_cache
 * holds daily closes for only 3 of the 10 laddered symbols, stale by up to four
 * months, and analyst_price_targets carries no adjustment provenance — so a
 * chart drawn against those targets could not distinguish a real dislocation
 * from a stale unadjusted number.
 */
const ladderFor = (c: SignalCard) => {
  const d = c.evidence!.data as any
  const blocked = c.context.find(x => x.label.startsWith('Probabilities sum') || x.label.startsWith('Mixed horizons'))?.label ?? null
  return (
    <CardCarousel
      panes={[
        { id: 'ladder', label: 'Ladder',
          content: <ScenarioLadder price={d.price} cases={d.cases} expected={d.expected} /> },
        { id: 'weight', label: 'Conviction',
          content: <ScenarioDistribution cases={d.cases} expected={d.expected} blockedBy={blocked} price={d.price} /> },
      ]}
    />
  )
}

const detailFor = (c: SignalCard) => {
  const d = c.evidence!.data as any
  return <ScenarioCaseDetail price={d.price} cases={d.cases} expected={d.expected} />
}

/**
 * Six cases, two of them duplicate names at different prices — AAPL's real
 * ladder. Priced at 150 (below its bear) purely so the card renders: at its
 * real 276.49 the price is inside the range and correctly produces no card.
 * This fixture exists to expose ladder layout under the worst real density,
 * not to make a claim about AAPL.
 */
const sixCases = unwrap(buildScenarioGapCard({
  assetId: 'aapl6', symbol: 'AAPL', companyName: 'Apple',
  price: 150, priceAsOf: new Date().toISOString(),
  cases: [
    { name: 'Bear', price: 205, probability: 12, timeframe: '6 months' },
    { name: 'Base', price: 230, probability: 19, timeframe: '6 months' },
    { name: 'Bear', price: 255, probability: 10, timeframe: '12 months' },
    { name: 'Bull', price: 285, probability: 62, timeframe: '12 months' },
    { name: 'Bull', price: 345, probability: 15, timeframe: '12 months' },
    { name: 'Uber Bull', price: 500, probability: 7, timeframe: '12 months' },
  ],
  heldIn: ['Tech & Consumer Growth'], statedAt: '2026-04-04T00:00:00.000Z',
}))

/**
 * Active risk from REAL data — the S9 measurement.
 *
 * US Core Equity's 69-name snapshot of 2026-04-21, against SPY holdings from
 * SSGA's file dated 14-Aug-2026 (504 names, weights summing to 99.9775%).
 * All 69 portfolio names matched a SPY constituent; nothing was off-benchmark.
 *
 * Numbers are computed, not invented: NVDA is 3.75% of the book against
 * 8.14% of the index.
 */
const activeReal = unwrap(buildActiveRiskCard({
  assetId: 'nvda', symbol: 'NVDA', companyName: 'NVIDIA',
  weightPct: 3.7473, benchmarkWeightPct: 8.1367,
  portfolioId: 'usce', portfolioName: 'US Core Equity',
  asOf: '2026-04-21T00:00:00.000Z',
  benchmarkSource: { index: 'S&P 500', proxy: 'SPY', asOf: '2026-08-14T00:00:00.000Z', isProxy: true },
}))

/**
* S10 peer pane, from the same real computation as the card: US Core Equity's
 * 69-name snapshot against SSGA SPY dated 14-Aug-2026.
 */
const PEERS = [
{ symbol: 'NVDA', weightPct: 3.7473, benchmarkPct: 8.1367, activePct: -4.3894 },
    { symbol: 'AVGO', weightPct: 0.2872, benchmarkPct: 2.7760, activePct: -2.4888 },
    { symbol: 'UNH', weightPct: 2.7421, benchmarkPct: 0.5443, activePct: 2.1978 },
    { symbol: 'CRM', weightPct: 2.1129, benchmarkPct: 0.2393, activePct: 1.8736 },
    { symbol: 'ADBE', weightPct: 1.8191, benchmarkPct: 0.1593, activePct: 1.6597 },
    { symbol: 'BAC', weightPct: 2.0978, benchmarkPct: 0.6282, activePct: 1.4696 },
    { symbol: 'PFE', weightPct: 1.5305, benchmarkPct: 0.2279, activePct: 1.3026 },
    { symbol: 'AAPL', weightPct: 5.5026, benchmarkPct: 6.7040, activePct: -1.2014 },
    { symbol: 'JNJ', weightPct: 2.1192, benchmarkPct: 0.9352, activePct: 1.1840 },
    { symbol: 'GS', weightPct: 1.6382, benchmarkPct: 0.4575, activePct: 1.1807 },
    { symbol: 'GE', weightPct: 1.6992, benchmarkPct: 0.5734, activePct: 1.1258 },
    { symbol: 'MCD', weightPct: 1.3982, benchmarkPct: 0.2890, activePct: 1.1092 },
    { symbol: 'NEE', weightPct: 1.3229, benchmarkPct: 0.2680, activePct: 1.0549 },
    { symbol: 'NKE', weightPct: 1.1190, benchmarkPct: 0.0729, activePct: 1.0460 },
]

const activeEvidence = (
  <CardCarousel
    panes={[
      { id: 'weight', label: 'Active weight',
        content: <ActiveWeightPeers subject="NVDA" peers={PEERS} heldCount={69}
                   notHeldCount={435} notHeldActivePct={-41.0944} /> },
    ]}
  />
)

const noop = () => {}

/**
 * A weight series from the real book — and the real book only supports two
 * points, which is the fixture's whole reason for existing.
 *
 * Vision Fund 10K (Tesseract org) carries AMZN at 4.00% on 5 Feb 2026 and
 * 4.14% on 13 Apr 2026. It has two further "snapshot dates" — 15 Apr with one
 * name and 24 Apr with two — which are corrections, not the book. The engine
 * drops them as partial uploads, and the pane says so, because using one as a
 * denominator would have made a single holding 100% of the portfolio.
 *
 * The point of showing this rather than a smooth invented line: 5-7 of the
 * 25-92 names each book holds have any daily price at all, so nothing clears
 * the 95% gate and there is no daily series to draw for anybody yet.
 */
const AMZN_WEIGHTS = buildWeightSeries({
  subjectAssetId: 'amzn',
  rows: [
    { assetId: 'amzn', date: '2026-02-05', shares: 4_000, price: 1_000 },
    { assetId: 'rest', date: '2026-02-05', shares: 96_000, price: 1_000 },
    { assetId: 'amzn', date: '2026-04-13', shares: 4_140, price: 1_000 },
    { assetId: 'rest', date: '2026-04-13', shares: 95_860, price: 1_000 },
    // The 15 Apr correction: one name, dropped as a fragment.
    { assetId: 'amzn', date: '2026-04-15', shares: 2_000, price: 1_000 },
  ],
})

/**
 * Real closes from `price_history_cache`, read 2026-08-18 and downsampled to
 * every seventh trading day so the fixture is legible in source.
 *
 * Not invented, and deliberately not smoothed: MSFT runs 452 → 529 → 372 →
 * 405 over the window, which is the drawdown the pane has to render without
 * flattening. TSLA's window ends 15 May 2026, so against the gallery's frozen
 * clock it is 92 days old and MUST carry the staleness line — the fixture
 * exists to prove that path renders, not to look tidy.
 */
const MSFT_CLOSES: PricePoint[] = [
  { date: '2025-05-21', close: 452.57 }, { date: '2025-06-02', close: 461.97 },
  { date: '2025-06-11', close: 472.62 }, { date: '2025-06-23', close: 486.00 },
  { date: '2025-07-02', close: 491.09 }, { date: '2025-07-14', close: 503.02 },
  { date: '2025-07-23', close: 505.87 }, { date: '2025-08-01', close: 524.11 },
  { date: '2025-08-12', close: 529.24 }, { date: '2025-08-21', close: 504.24 },
  { date: '2025-09-02', close: 505.12 }, { date: '2025-09-11', close: 501.01 },
  { date: '2025-09-22', close: 514.45 }, { date: '2025-10-01', close: 519.71 },
  { date: '2025-10-10', close: 510.96 }, { date: '2025-10-21', close: 517.66 },
  { date: '2025-10-30', close: 525.76 }, { date: '2025-11-10', close: 506.00 },
  { date: '2025-11-19', close: 487.12 }, { date: '2025-12-01', close: 486.74 },
  { date: '2025-12-10', close: 478.56 }, { date: '2025-12-19', close: 485.92 },
  { date: '2025-12-31', close: 483.62 }, { date: '2026-01-12', close: 477.18 },
  { date: '2026-01-22', close: 451.14 }, { date: '2026-02-02', close: 423.37 },
  { date: '2026-02-11', close: 404.37 }, { date: '2026-02-23', close: 384.47 },
  { date: '2026-03-04', close: 405.20 }, { date: '2026-03-13', close: 395.55 },
  { date: '2026-03-24', close: 372.74 }, { date: '2026-04-02', close: 373.46 },
  { date: '2026-04-14', close: 393.11 }, { date: '2026-04-23', close: 415.75 },
  { date: '2026-05-04', close: 413.62 }, { date: '2026-05-13', close: 405.21 },
]

const TSLA_CLOSES: PricePoint[] = [
  { date: '2025-05-23', close: 339.34 }, { date: '2025-06-04', close: 332.05 },
  { date: '2025-06-13', close: 325.31 }, { date: '2025-06-25', close: 327.55 },
  { date: '2025-07-07', close: 293.94 }, { date: '2025-07-16', close: 321.67 },
  { date: '2025-07-25', close: 316.06 }, { date: '2025-08-05', close: 308.72 },
  { date: '2025-08-14', close: 335.58 }, { date: '2025-08-25', close: 346.60 },
  { date: '2025-09-04', close: 338.53 }, { date: '2025-09-15', close: 410.04 },
  { date: '2025-09-24', close: 442.79 }, { date: '2025-10-03', close: 429.83 },
  { date: '2025-10-14', close: 429.24 }, { date: '2025-10-23', close: 448.98 },
  { date: '2025-11-03', close: 468.37 }, { date: '2025-11-12', close: 430.60 },
  { date: '2025-11-21', close: 391.09 }, { date: '2025-12-03', close: 446.74 },
  { date: '2025-12-12', close: 458.96 }, { date: '2025-12-23', close: 485.56 },
  { date: '2026-01-05', close: 451.67 }, { date: '2026-01-14', close: 439.20 },
  { date: '2026-01-26', close: 435.20 }, { date: '2026-02-04', close: 406.01 },
  { date: '2026-02-13', close: 417.44 }, { date: '2026-02-25', close: 417.40 },
  { date: '2026-03-06', close: 396.73 }, { date: '2026-03-17', close: 399.27 },
  { date: '2026-03-26', close: 372.11 }, { date: '2026-04-07', close: 346.65 },
  { date: '2026-04-16', close: 388.90 }, { date: '2026-04-27', close: 378.67 },
  { date: '2026-05-06', close: 398.73 }, { date: '2026-05-15', close: 422.24 },
]

/**
 * Large Cap Growth's real position sizes, Tesseract org, newest snapshot.
 *
 * The pane a conviction card hangs off. Its purpose is to answer "is this
 * actually small here" — and note that it can only be answered against a book
 * that is not equal-weighted. Vision Fund 10K holds all 26 names at 4.14%
 * each, where the question has no content; this book runs 29.64 to 14.19.
 *
 * The intended basis is the CONVICTION cohort — every name you rated the same
 * way. That never renders today: `analyst_ratings` carries a conviction for
 * exactly one name per organisation, so no two names in a book share one, and
 * the code falls back to ranking the book. `cohortBasis` records which, and
 * the pane is captioned from it rather than from the card's conviction field.
 */
const BOOK_SIZES = [
  { label: 'MSFT', weightPct: 29.64, tone: 'neutral' as const },
  { label: 'AAPL', weightPct: 25.32, tone: 'subject' as const },
  { label: 'GOOGL', weightPct: 16.48, tone: 'neutral' as const },
  { label: 'TSLA', weightPct: 14.36, tone: 'neutral' as const },
  { label: 'AMZN', weightPct: 14.19, tone: 'neutral' as const },
]

/**
 * The one recommendation shape the database actually holds.
 *
 * All 25 `trade_queue_items` carrying a `proposed_weight` are the same seeded
 * AAPL buy at 7.75%, one per organisation. Current weight is that book's own
 * 25.32%, so the ask is a TRIM of 17.57 points despite the action reading
 * "buy" — which is what putting the two numbers on one axis is for.
 */
const REC_WEIGHTS = [
  { label: 'Current', weightPct: 25.32, tone: 'subject' as const, note: 'book 2026-04-21' },
  { label: 'Proposed', weightPct: 7.75, tone: 'proposed' as const },
]

/** AAPL's real closes, same source and downsample as MSFT above. The window
 *  ends 17 Apr 2026 — the stalest of the eight cached symbols. */
const AAPL_CLOSES: PricePoint[] = [
  { date: '2025-04-25', close: 209.28 }, { date: '2025-05-06', close: 198.51 },
  { date: '2025-05-15', close: 211.45 }, { date: '2025-05-27', close: 200.21 },
  { date: '2025-06-05', close: 200.63 }, { date: '2025-06-16', close: 198.42 },
  { date: '2025-06-26', close: 201.00 }, { date: '2025-07-08', close: 210.01 },
  { date: '2025-07-17', close: 210.02 }, { date: '2025-07-28', close: 214.05 },
  { date: '2025-08-06', close: 213.25 }, { date: '2025-08-15', close: 231.59 },
  { date: '2025-08-26', close: 229.31 }, { date: '2025-09-05', close: 239.69 },
  { date: '2025-09-16', close: 238.15 }, { date: '2025-09-25', close: 256.87 },
  { date: '2025-10-06', close: 256.69 }, { date: '2025-10-15', close: 249.34 },
  { date: '2025-10-24', close: 262.82 }, { date: '2025-11-04', close: 270.04 },
  { date: '2025-11-13', close: 272.95 }, { date: '2025-11-24', close: 275.92 },
  { date: '2025-12-04', close: 280.70 }, { date: '2025-12-15', close: 274.11 },
  { date: '2025-12-24', close: 273.81 }, { date: '2026-01-06', close: 262.36 },
  { date: '2026-01-15', close: 258.21 }, { date: '2026-01-27', close: 258.27 },
  { date: '2026-02-05', close: 275.91 }, { date: '2026-02-17', close: 263.88 },
  { date: '2026-02-26', close: 272.95 }, { date: '2026-03-09', close: 259.88 },
  { date: '2026-03-18', close: 249.94 }, { date: '2026-03-27', close: 248.80 },
  { date: '2026-04-08', close: 258.90 }, { date: '2026-04-17', close: 270.23 },
]

/**
 * Crowding, computed from the real book inside ONE organization.
 *
 * AAPL across the Tesseract org's three books that hold it, each weight
 * against that book's own newest snapshot: 25.32 / 15.22 / 4.00.
 *
 * The single-org qualifier is load-bearing. Queried across the whole database
 * these three become twenty-eight, because "Tech & Consumer Growth" is seeded
 * into 26 separate pilot organisations and a query run with the Management API
 * bypasses RLS and merges them. A user never sees that; the feed runs as a
 * member of one org. Any crowding number measured without an org filter is
 * meaningless — which is the enumeration hazard the tenant docs describe,
 * showing up as a chart rather than a leak.
 *
 * The spread is the point. "Held in 3 books, heaviest 25%" reads as one fact;
 * 25 / 15 / 4 reads as one conviction position beside a starter, which is a
 * different conclusion.
 */
const CROWDED_BOOKS = [
  { label: 'Large Cap Growth', weightPct: 25.32, tone: 'subject' as const },
  { label: 'Large Cap Core', weightPct: 15.22, tone: 'neutral' as const },
  { label: 'Vision Fund 5K', weightPct: 4.00, tone: 'neutral' as const },
]

/**
 * The same three books, by money — and the ranking INVERTS.
 *
 * Large Cap Growth carries the heaviest weight at 25.32% and holds $26k of
 * AAPL. Vision Fund 5K carries the lightest at 4.00% and holds $4.0m. Read the
 * weights alone and you would take the firm's AAPL problem to the wrong desk.
 *
 * This is why the card carries both and why the detail is not a repeat of the
 * pane. Real exposures, Tesseract org, each book's newest snapshot.
 */
const CROWDED_EXPOSURE = [
  { label: 'Vision Fund 5K', weightPct: 4_000_371, tone: 'subject' as const },
  { label: 'Large Cap Growth', weightPct: 26_325, tone: 'neutral' as const },
  { label: 'Large Cap Core', weightPct: 17_550, tone: 'neutral' as const },
]

/**
 * A deliberately long label. CI on Linux failed the overflow rule where local
 * font metrics passed, which means the action row was sized to the exact width
 * of one platform's fonts. This exercises the row's limit everywhere.
 */
const longLabel: SignalCard = {
  ...amzn,
  id: 'scenario-long-label',
  actions: { ...amzn.actions, open: { label: 'Open BRK.B WXYZ', href: '/asset/x' } },
}

const CARDS: { slug: string; card: SignalCard; evidence?: React.ReactNode; detail?: React.ReactNode; detailLabel?: string; detailCollapsible?: boolean }[] = [
  { slug: 'long-label', card: longLabel, evidence: ladderFor(amzn) },
  { slug: 'active-risk-real', card: activeReal, evidence: activeEvidence,
    // Same disclosure pattern as the scenario card: the pane ranks the top
    // five, the detail carries the rest without the card growing.
    detail: <ActiveWeightPeers subject="NVDA" peers={PEERS} heldCount={69}
              notHeldCount={435} notHeldActivePct={-41.0900} full />,
    detailLabel: 'See all 69 active weights' },
  { slug: 'six-cases', card: sixCases, evidence: ladderFor(sixCases), detail: detailFor(sixCases), detailLabel: 'See all 6 cases' },
  { slug: 'scenario-below-bear', card: tsla, evidence: ladderFor(tsla), detail: detailFor(tsla), detailLabel: 'See all 3 cases' },
  { slug: 'scenario-at-expected', card: coherent, evidence: ladderFor(coherent), detail: detailFor(coherent), detailLabel: 'See all 3 cases' },
  { slug: 'scenario-above-bull', card: amzn, evidence: ladderFor(amzn), detail: detailFor(amzn), detailLabel: 'See all 3 cases' },
  // The what-if control, on the card the feed hangs it off. This is the
  // MSFT fixture rather than the real NVDA one because `active-risk-real`
  // spends its detail slot on the 69-name peer list, and a card has one.
  //
  // Layout is the whole reason it is here: the control sits in the disclosure
  // region, which is bounded by `flex-1 min-h-0`, and jsdom cannot tell whether
  // a slider, a two-line readout and a 40px button fit inside whatever slack a
  // card with a metric well happens to leave. Only a real browser at 390px can.
  { slug: 'active-risk', card: activeRisk,
    // Two panes on the card the feed builds this way: where the bet ranks, and
    // what the tape did. Both are real data; the price window ends 13 May 2026
    // and is therefore flagged against the gallery's frozen clock.
    evidence: (
      <CardCarousel
        panes={[
          { id: 'weight', label: 'Active weight',
            content: <ActiveWeightPeers subject="MSFT" peers={PEERS} heldCount={69}
                       notHeldCount={435} notHeldActivePct={-41.0944} /> },
          { id: 'price', label: 'Price',
            content: <PriceContext symbol="MSFT" series={MSFT_CLOSES} now={NOW} /> },
        ]}
      />
    ),
    detail: <WhatIfSize symbol="MSFT" currentPct={6.2} benchmarkPct={3.1}
              benchmarkNote="SPY proxy · 14 Aug" onStage={noop} />,
    detailLabel: 'Try a different size' },
  // The price pane carrying the analyst's own cases as bands — the comparison
  // the ladder makes against a single price, made against a year of them.
  { slug: 'scenario-price-bands', card: { ...tsla, id: 'scenario:price-bands' },
    evidence: (
      <CardCarousel
        panes={[
          // The raw ladder, NOT `ladderFor` — that helper already wraps its
          // panes in a CardCarousel, so nesting it here rendered two indicator
          // rows stacked on one card and squeezed the ladder until its own
          // case labels clipped. A carousel takes panes, never another
          // carousel.
          { id: 'ladder', label: 'Ladder',
            content: <ScenarioLadder price={(tsla.evidence!.data as any).price}
                       cases={(tsla.evidence!.data as any).cases}
                       expected={(tsla.evidence!.data as any).expected} /> },
          { id: 'price', label: 'Price',
            content: <PriceContext symbol="TSLA" series={TSLA_CLOSES} now={NOW}
                       bands={(tsla.evidence!.data as any).cases.map((c: any) =>
                         ({ label: c.name, price: c.price, kind: 'case' as const }))} /> },
        ]}
      />
    ),
    detail: detailFor(tsla), detailLabel: 'See all 3 cases' },
  // A weight as a series, plus the case editor — the two interactive surfaces
  // that write. Ownership is the fixture's point: Bear belongs to another
  // analyst and carries no control, because RLS refuses that update silently.
  { slug: 'weight-series', card: { ...activeRisk, id: 'active_risk:series',
      headline: 'AMZN has drifted up in Vision Fund 10K',
      metric: { value: '4.14%', label: 'Weight of the book', direction: 'neutral',
                source: 'holdings', asOf: '2026-04-13T00:00:00.000Z' },
      body: 'Two uploads, ten weeks apart, and the position moved 14 basis points. Whether that was a trade or the market repricing it is not answerable from two snapshots — which is the finding.',
      entity: { kind: 'asset', id: 'amzn', name: 'Amazon', ticker: 'AMZN' },
      context: [{ label: 'Vision Fund 10K' }, { label: '2 snapshots' }],
      actions: { ...activeRisk.actions, open: { label: 'Open AMZN', href: '/asset/amzn' } },
      // Spreading `activeRisk` brought its 31 Jul provenance along, so the
      // eyebrow read "19 days ago · holdings Apr 13" — two dates three months
      // apart describing one number. On a card whose entire subject is date
      // discipline that is not a fixture wart, it is the defect on display.
      provenance: { ...activeRisk.provenance, occurredAt: '2026-04-13T00:00:00.000Z' },
    } as SignalCard,
    evidence: <WeightSeries symbol="AMZN" series={AMZN_WEIGHTS}
                benchmark={{ weightPct: 3.72, asOf: '2026-08-14' }} />,
    detail: (
      <CaseEditor
        symbol="AMZN"
        onSaveDraft={noop}
        cases={[
          { id: 'bull', name: 'Bull', price: 180, probability: 50, mine: true },
          { id: 'base', name: 'Base', price: 120, probability: 40, mine: true },
          { id: 'bear', name: 'Bear', price: 90, probability: 35, mine: false, authorName: 'Priya Raman' },
        ]}
      />
    ),
    detailLabel: 'Reweight your cases' },
  // Crowding: the spread across books, which the count alone cannot express.
  { slug: 'crowding-spread',
    card: { ...activeRisk, id: 'crowding:spread', type: 'crowding',
            headline: 'AAPL is held across more of the book than any one portfolio shows',
            metric: { value: '3', label: 'Portfolios holding it', direction: 'neutral',
                      source: 'holdings', asOf: '2026-04-21T00:00:00.000Z' },
            body: 'Held in 3 portfolios — Large Cap Growth, Large Cap Core, Vision Fund 5K — reaching 25.3% in the heaviest. A single-portfolio view understates the exposure to one thesis.',
            evidence: { kind: 'peer_bar', data: { books: 3 } },
            // The fixture is AAPL, so the entity and the action must be too.
            // Spreading `activeRisk` left this card headlined AAPL with an
            // "Open MSFT" button — a card contradicting itself in its own
            // action bar, which is the sort of thing a screenshot catches and
            // an assertion about slot COUNT never will.
            entity: { kind: 'asset', id: 'aapl', name: 'Apple', ticker: 'AAPL' },
            context: [{ label: 'Tesseract' }, { label: '3 books' }],
            actions: { ...activeRisk.actions, open: { label: 'Open AAPL', href: '/asset/aapl' } },
          } as SignalCard,
    evidence: (
      <CardCarousel
        panes={[
          { id: 'books', label: 'By book',
            content: <WeightBars rows={CROWDED_BOOKS} unitNote="Weight of each book · tap to compare" /> },
          { id: 'price', label: 'Price',
            content: <PriceContext symbol="AAPL" series={AAPL_CLOSES} now={NOW} /> },
        ]}
      />
    ),
    // Money, not a repeat of the weights above it — and the order flips.
    detail: <WeightBars unit="usd" rows={CROWDED_EXPOSURE} limit={12}
              unitNote="Exposure by book · tap to compare" />,
    detailLabel: 'Exposure in money' },
  // Same card, different evidence shape — a bare sparkline rather than a
  // carousel — so the gallery shows both. It carries the what-if control for
  // the same reason `active-risk` does: a claim plus a sparkline left 282px of
  // dead band, and the fix is to use the space, not to exempt the card.
  { slug: 'active-risk-sparkline', card: withSparkline,
    evidence: <Sparkline points={withSparkline.evidence!.data as number[]} />,
    detail: <WhatIfSize symbol="MSFT" currentPct={6.2} benchmarkPct={3.1}
              benchmarkNote="SPY proxy · 14 Aug" onStage={noop} />,
    detailLabel: 'Try a different size' },
  // A post, on the contract. The ideas feed was the last thing rendering
  // outside it — a colleague's trade idea sat beside an active-risk card
  // wearing entirely different furniture, in the same scroller.
  { slug: 'idea-trade', card: unwrap(buildIdeaCard({
      id: 'i1', type: 'trade_idea',
      content: 'The multiple has re-rated past our bull case and the delivery margin story is now consensus. The position was sized for an outcome that has already happened.',
      createdAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
      authorName: 'Priya Raman', action: 'sell', urgency: 'high',
      portfolioName: 'Core Equity',
      // MSFT, not DASH: the evidence pane below draws MSFT's real closes, and
      // a card headlined DASH above a MSFT chart is the same self-contradiction
      // as the AAPL card that carried an "Open MSFT" button. There is no DASH
      // price history to draw.
      asset: { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' },
    }, { share: true, ask: true, readthrough: true })),
    evidence: <PriceContext symbol="MSFT" series={MSFT_CLOSES} now={NOW} />,
    detail: <p className="whitespace-pre-line text-[15px] leading-[1.55] text-gray-600 dark:text-gray-300">
      The multiple has re-rated past our bull case and the delivery margin story is now consensus. The position was sized for an outcome that has already happened.
    </p>,
    detailLabel: 'Read the whole post' },
  { slug: 'idea-thought', card: unwrap(buildIdeaCard({
      id: 'i2', type: 'quick_thought',
      content: 'Worth watching whether the pricing pressure in the core segment shows up before the new line reaches scale — the bear case depends entirely on the order of those two.',
      createdAt: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(),
      authorName: 'Sam Okafor', sentiment: 'concerned',
      asset: { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' },
    }, { share: true, ask: true, promote: true })),
    detail: <p className="whitespace-pre-line text-[15px] leading-[1.55] text-gray-600 dark:text-gray-300">
      Worth watching whether the pricing pressure in the core segment shows up before the new line reaches scale — the bear case depends entirely on the order of those two.
    </p>,
    detailLabel: 'Read the whole post' },
  { slug: 'recommendation', card: recommendation,
    // Current against proposed. The action says "buy" and the bars say the ask
    // is 17.57 points smaller than the position — which is the whole reason
    // the two numbers belong on one axis instead of in two sentences.
    evidence: <WeightBars rows={REC_WEIGHTS} unitNote="Tap to see the change asked for" />,
    // The rationale in full. Its own allowlist entry prescribed this — "the
    // recommender's rationale given the space the scenario detail has" — and
    // the body clamps to two lines, so the argument for the trade was the one
    // thing the card would not show you.
    detail: (
      <div className="text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
          Priya Raman&rsquo;s case
        </p>
        <p>{recommendation.body}</p>
      </div>
    ),
    detailLabel: 'Read the full rationale' },
  // The conviction pane, on its fallback basis: rank the book's own sizes.
  { slug: 'conviction-cohort',
    card: { ...activeRisk, id: 'conviction:cohort', type: 'conviction_oversized',
            headline: 'AAPL is a quarter of Large Cap Growth on a view that has stopped moving',
            metric: { value: '25.3%', label: 'Weight of the book', direction: 'neutral',
                      source: 'holdings', asOf: '2026-04-21T00:00:00.000Z' },
            body: 'The position is the second largest in the book and the target it was sized against has not been revisited since. Either the view needs restating or the size does.',
            entity: { kind: 'asset', id: 'aapl', name: 'Apple', ticker: 'AAPL' },
            context: [{ label: 'Large Cap Growth' }, { label: '5 positions' }],
            evidence: { kind: 'peer_bar', data: { positions: 5 } },
            actions: { ...activeRisk.actions, open: { label: 'Open AAPL', href: '/asset/aapl' } },
            provenance: { ...activeRisk.provenance, occurredAt: '2026-04-21T00:00:00.000Z' },
          } as SignalCard,
    evidence: (
      <CardCarousel
        panes={[
          { id: 'cohort', label: 'Book sizes',
            content: <WeightBars rows={BOOK_SIZES} baselineIndex={1}
                       unitNote="Every position in Large Cap Growth" /> },
          { id: 'price', label: 'Price',
            content: <PriceContext symbol="AAPL" series={AAPL_CLOSES} now={NOW} /> },
        ]}
      />
    ),
    // Not a second copy of the bars. Within ONE book value and weight rank
    // identically by construction, so a money view here would be the same
    // chart twice — unlike the crowding card, where each book has its own
    // denominator and the orders genuinely invert.
    //
    // The claim is "this position is too big for the view", so the useful
    // thing to put behind the disclosure is the control that answers it.
    detail: <WhatIfSize symbol="AAPL" currentPct={25.32} benchmarkPct={6.70}
              benchmarkNote="SPY proxy · 14 Aug" maxPct={30} onStage={noop} />,
    detailLabel: 'Try a different size' },
  /**
   * The stale-target card, with everything it is supposed to carry.
   *
   * It had no fixture at all, which is how it shipped as the one tile in the
   * feed with a chart: nothing here could show that the chart had no target
   * line on it, that the eyebrow was printing a synthetic date, or that the
   * card offered no way to answer the question it asks.
   *
   * Three things a reader can work, which is the standard the surface is held
   * to: the tape with the target and the horizon drawn on it, the horizon as a
   * pair of durations, and a control that restates the number.
   */
  { slug: 'target-expired', card: staleTarget,
    evidence: (
      <CardCarousel
        panes={[
          { id: 'price', label: 'Price',
            content: (
              <PriceContext
                symbol="AAPL" series={AAPL_CLOSES} now={NOW}
                // The band the card exists to talk about. Drawing the price
                // without it was the defect: a card arguing that a number has
                // stopped being a view, with the number nowhere on the axis.
                bands={[{ label: 'Target', price: 245, kind: 'target' }]}
                markers={[{ date: STALE_HORIZON_AT, label: 'Horizon', kind: 'horizon' }]}
              />
            ) },
          { id: 'horizon', label: 'Horizon',
            content: <HorizonTimeline statedAt={STALE_STATED_AT} horizonAt={STALE_HORIZON_AT}
                       timeframe="12 months" now={NOW} /> },
        ]}
      />
    ),
    detail: (
      <CardCarousel
        panes={[
          { id: 'tune', label: 'Target',
            content: <TargetTuner symbol="AAPL" currentTarget={245}
                       reference={{ price: 212.44, label: 'book mark' }} onRecord={noop} /> },
          { id: 'verdict', label: 'Respond',
            content: (
              <VerdictBar
                question="Is $245.00 still your number?"
                options={[
                  { id: 'stands', label: 'Still my view', tone: 'affirm', disposition: 'settled',
                    note: 'AAPL: the standing target still reflects my view.' },
                  { id: 'revise', label: 'Needs revising', tone: 'neutral', disposition: 'flagged',
                    note: 'AAPL: the target needs revising. Flagged from the feed; no new number set yet.' },
                  { id: 'noise', label: 'Not useful', tone: 'negate', disposition: 'rejected',
                    note: 'AAPL: this target is not worth tracking against.' },
                ]}
                onRespond={noop}
              />
            ) },
        ]}
      />
    ),
    detailCollapsible: false },
  /**
   * The newest kind: a real position nobody has ever priced.
   *
   * Its detail is the same tuner the target cards use, seeded from the holdings
   * mark rather than from a standing target — so the control opens at zero
   * implied return and the reader is putting the FIRST number on the name.
   */
  { slug: 'no-target', card: noTarget,
    evidence: (
      <CardCarousel
        panes={[
          { id: 'price', label: 'Price',
            content: <PriceContext symbol="AAPL" series={AAPL_CLOSES} now={NOW} /> },
        ]}
      />
    ),
    detail: (
      <CardCarousel
        panes={[
          { id: 'tune', label: 'Target',
            content: <TargetTuner symbol="AAPL" currentTarget={212.44} isFirstTarget
                       reference={{ price: 212.44, label: 'book mark' }} onRecord={noop} /> },
          { id: 'verdict', label: 'Respond',
            content: (
              <VerdictBar
                question="Why is there no number on AAPL?"
                options={[
                  { id: 'deliberate', label: 'Deliberate', tone: 'affirm', disposition: 'settled',
                    note: 'AAPL: held for a reason that does not reduce to a price target.' },
                  { id: 'mine', label: 'I will price it', tone: 'neutral', disposition: 'flagged',
                    note: 'AAPL: taking this on, I will put a target on it. Claimed from the feed.' },
                  { id: 'noise', label: 'Not useful', tone: 'negate', disposition: 'rejected',
                    note: 'AAPL: a missing target is not a finding worth surfacing on this name.' },
                ]}
                onRespond={noop}
              />
            ) },
        ]}
      />
    ),
    detailCollapsible: false },
  { slug: 'news', card: news },
]

createRoot(document.getElementById('root')!).render(
  <div className="bg-gray-100 dark:bg-black min-h-screen">
    {/* The feed proper — cards stacked as the user meets them, which is the
        only way to see whether more than one fits on a phone screen. */}
    {/* A real snap feed, not a stack. The scroll-conflict test has to drive a
        touch gesture against the same container the app uses, or it proves
        nothing about gesture arbitration. */}
    <div
      id="feed"
      className="mx-auto h-[844px] max-w-[390px] snap-y snap-mandatory overflow-y-auto overscroll-contain"
    >
      {/* One screen per card, as the feed renders them. */}
      {CARDS.map(({ slug, card, evidence, detail, detailLabel, detailCollapsible }) => (
        <div key={slug} data-card={slug} className="h-full w-full snap-start snap-always overflow-hidden border-b-8 border-gray-200">
          <SignalCardView card={card} onAction={noop} onOpen={noop}
            evidence={evidence} detail={detail} detailLabel={detailLabel}
            detailCollapsible={detailCollapsible} />
        </div>
      ))}
    </div>
  </div>,
)
