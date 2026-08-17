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
 * Dates are frozen. A card whose eyebrow says "2 hours ago" one day and "3
 * hours ago" the next makes every screenshot diff meaningless.
 */

const NOW = new Date('2026-08-15T14:00:00.000Z')

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
 * A deliberately long label. CI on Linux failed the overflow rule where local
 * font metrics passed, which means the action row was sized to the exact width
 * of one platform's fonts. This exercises the row's limit everywhere.
 */
const longLabel: SignalCard = {
  ...amzn,
  id: 'scenario-long-label',
  actions: { ...amzn.actions, open: { label: 'Open BRK.B WXYZ', href: '/asset/x' } },
}

const CARDS: { slug: string; card: SignalCard; evidence?: React.ReactNode; detail?: React.ReactNode; detailLabel?: string }[] = [
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
  { slug: 'active-risk', card: activeRisk },
  { slug: 'active-risk-sparkline', card: withSparkline, evidence: <Sparkline points={withSparkline.evidence!.data as number[]} /> },
  { slug: 'recommendation', card: recommendation },
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
      {CARDS.map(({ slug, card, evidence, detail, detailLabel }) => (
        <div key={slug} data-card={slug} className="h-full w-full snap-start snap-always overflow-hidden border-b-8 border-gray-200">
          <SignalCardView card={card} onAction={noop} onOpen={noop}
            evidence={evidence} detail={detail} detailLabel={detailLabel} />
        </div>
      ))}
    </div>
  </div>,
)
