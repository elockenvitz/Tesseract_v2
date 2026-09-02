import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { SignalCardView } from '../src/components/signals/SignalCardView'
import { buildActiveRiskCard } from '../src/lib/signals/builders/activeRisk'
import { buildRecommendationCard } from '../src/lib/signals/builders/recommendation'
import { buildNewsCard } from '../src/lib/signals/builders/news'
import { buildScenarioGapCard } from '../src/lib/signals/builders/scenarioGap'
import { ScenarioLadder } from '../src/components/signals/ScenarioLadder'
import { ScenarioCaseDetail } from '../src/components/signals/ScenarioCaseDetail'
import { CardCarousel } from '../src/components/signals/CardCarousel'
import { ScenarioGapPanes } from '../src/components/signals/ScenarioGapPanes'
import { deriveScenarioState } from '../src/lib/signals/scenario-state'
import { frameworkCapitalFor } from '../src/lib/signals/framework-break'
import { currentBook } from '../src/lib/holdings/portfolio-context'
import { materialCapitalFor } from '../src/lib/signals/portfolio-issues'
import { ActiveWeightPeers } from '../src/components/signals/ActiveWeightPeers'
import { WhatIfSize } from '../src/components/signals/WhatIfSize'
import { SizeExplorer } from '../src/components/signals/SizeExplorer'
import { CaseLadderBuilder } from '../src/components/signals/CaseLadderBuilder'
import { PriceContext, type PricePoint } from '../src/components/signals/PriceContext'
import { WeightBars } from '../src/components/signals/WeightBars'
import { WeightSeries } from '../src/components/signals/WeightSeries'
import { CaseEditor } from '../src/components/signals/CaseEditor'
import { buildWeightSeries } from '../src/lib/portfolio/weight-series'
import { buildIdeaCard } from '../src/lib/signals/builders/ideas'
import { buildStaleTargetCard, buildNoTargetCard, buildInsightCard, buildAttentionCard } from '../src/lib/signals/builders/legacy-kinds'
// From the pure rule module, NOT from `useDerivedInsights` — that hook imports
// `supabase`, which throws at module load in this env and takes the whole
// gallery down. See the header of `stale-signal.ts`.
import {
  caseCoverageFrom, researchCopy, researchIssueFor, researchSignalTypeFor, reviewClocks,
} from '../src/lib/research/case-state'
import { TargetTuner } from '../src/components/signals/TargetTuner'
import { VerdictBar } from '../src/components/signals/VerdictBar'
import { TargetExpiredPanes } from '../src/components/signals/TargetExpiredPanes'
import { resolvePriceSnapshot } from '../src/lib/signals/price-snapshot'
import type { CardResult, SignalCard } from '../src/lib/signals/contract'
import { cardTier, TIER_PX } from '../src/lib/signals/card-height'
import { CasePane } from '../src/components/signals/CasePane'
import { insightPanePlan } from '../src/lib/signals/pane-plan'
import { RankingDebug } from './ranking'
import { ExploreGallery } from './explore'
import { FeedWindowGallery } from './feed-window'

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

/**
 * The Research family, built through the real rule rather than by hand.
 *
 * Hardcoding the strings would have made these fixtures agree with themselves
 * forever while the product said something else. `researchIssueFor` decides the
 * framing and `researchCopy` writes the words, so a change to either shows up
 * here as a layout change — which is the only reason the gallery is worth
 * having.
 *
 * The two are separate fixtures because they make DIFFERENT claims and must not
 * be allowed to converge: one says something happened, the other says nothing
 * did. A single fixture would let the silence card drift into event language
 * without any test noticing.
 */
const CASE_WRITTEN_AT = '2026-06-08T00:00:00.000Z'
const SILENT_WRITTEN_AT = '2026-03-31T00:00:00.000Z'

/** A complete case, all three core sections saved at one moment. */
const completeCase = (at: string) => caseCoverageFrom(
  ['thesis', 'where_different', 'risks_to_thesis'].map(section => ({
    section, hasContent: true, updated_at: at,
  })),
)

/**
 * A Research insight from the two clocks, the way the hook assembles one.
 *
 * `reviewedAt` is the second clock: a completed "reviewed, unchanged" judgment
 * that produced no edit. Passing one is what makes the card say "reviewed"
 * where it would otherwise say "written", and the gallery carries a fixture for
 * each so the two labels can be compared rather than trusted.
 */
function researchInsight(input: {
  id: string; symbol: string; companyName: string
  writtenAt: string; reviewedAt?: string | null
  movePct?: number | null; weightPct?: number | null; score: number
}) {
  const coverage = completeCase(input.writtenAt)
  const clocks = reviewClocks(coverage, input.reviewedAt ?? null)
  const issue = researchIssueFor({
    clocks, coverage, evidence: [], movePct: input.movePct ?? null, now: NOW.getTime(),
  })!
  return {
    id: input.id,
    kind: 'stale_research' as const,
    ...researchCopy({
      symbol: input.symbol, issue,
      portfolioName: 'Core Equity', weightPct: input.weightPct ?? null, held: true,
    }),
    assetId: input.symbol.toLowerCase(), symbol: input.symbol, companyName: input.companyName,
    portfolioName: 'Core Equity', portfolioId: 'p1',
    weightPct: input.weightPct ?? null, held: true, portfolioCount: 1,
    liveIdeas: [], coverageOwners: [], evidenceCount: 0,
    issue,
    caseWrittenAt: clocks.caseWrittenAt,
    researchReviewAt: clocks.researchReviewAt,
    reviewAnchor: clocks.effectiveAnchor,
    anchoredOn: issue.anchoredOn,
    daysSinceReview: issue.daysSinceReview,
    daysSinceWritten: issue.daysSinceWritten,
    score: input.score,
  }
}

/** Case B: the price moved and the written case did not follow. */
const MOVE_TOUCHED = CASE_WRITTEN_AT
const unreviewedMove = unwrap(buildInsightCard(researchInsight({
  id: 'insight-stale-aapl', symbol: 'AAPL', companyName: 'Apple',
  writtenAt: CASE_WRITTEN_AT, movePct: 18.4, weightPct: 6.2, score: 0.92,
})))

/** Case F: nothing happened. A complete case, quiet past the 90-day line. */
const SIZE_TOUCHED = SILENT_WRITTEN_AT
const unreviewedSize = unwrap(buildInsightCard(researchInsight({
  id: 'insight-stale-msft', symbol: 'MSFT', companyName: 'Microsoft',
  writtenAt: SILENT_WRITTEN_AT, weightPct: 7.5, score: 0.58,
})))

const noTarget = unwrap(buildNoTargetCard({
  assetId: 'aapl', symbol: 'AAPL', companyName: 'Apple',
  // Two books, so "In 2 portfolios" has something behind it to disclose.
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

/**
 * The two cards from the production clipping report, at their real numbers.
 *
 * The gallery's AMZN trades at 232.99 against an 86-242 range, which is not the
 * card the phone showed: 266.43 against 199-284 puts the price ABOVE the whole
 * 52-week range as well as above every case, and moves both endpoint labels
 * into the right half where the case labels are. A regression test for clipping
 * has to measure the geometry that clipped.
 */
const prodAmzn = unwrap(buildScenarioGapCard({
  assetId: 'amzn-prod', symbol: 'AMZN', companyName: 'Amazon',
  price: 266.43, priceAsOf: new Date().toISOString(),
  cases: [
    { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
    { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
    { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
  ],
  heldIn: ['Vision Fund 10K', 'Core Equity'], statedAt: '2026-02-05T00:00:00.000Z',
}))

/** DASH at its expected value, unheld, with a weighted ladder. */
const prodDash = unwrap(buildScenarioGapCard({
  assetId: 'dash-prod', symbol: 'DASH', companyName: 'DoorDash',
  price: 236.74, priceAsOf: new Date().toISOString(),
  cases: [
    { name: 'Bear', price: 180, probability: 30, timeframe: '12 months' },
    { name: 'Base', price: 250, probability: 40, timeframe: '12 months' },
    { name: 'Bull', price: 300, probability: 30, timeframe: '12 months' },
  ],
  heldIn: [], statedAt: '2026-08-23T19:13:53Z',
}))

/**
 * The two framework-break states, through the real derivation.
 *
 * ── Why these exist ───────────────────────────────────────────────────────
 *
 * A held framework break needs a book behind it, and whether production has
 * one on any given day is a fact about the desk rather than about the code.
 * These build the CANONICAL context from holdings rows and hand the result to
 * the same builder the feed uses — `currentBook` derives the weights,
 * `frameworkCapitalFor` chooses the book, and nothing here writes a percentage
 * by hand. If the rule changes, these change with it; if they were hand-built
 * card literals they would keep rendering the old copy forever.
 *
 * Gallery only. Nothing in this file ships in the app bundle, and no fixture
 * data reaches production.
 */
const holdingRow = (
  portfolioId: string, portfolioName: string, assetId: string, shares: number,
) => ({
  portfolio_id: portfolioId, asset_id: assetId, shares, price: 10, date: '2026-08-01',
  portfolios: { id: portfolioId, name: portfolioName },
  assets: { symbol: assetId.toUpperCase(), asset_type: 'equity' },
})

const BROKEN_LADDER = [
  { name: 'Bear', price: 200, probability: 20, timeframe: '12 months' },
  { name: 'Base', price: 300, probability: 55, timeframe: '12 months' },
  { name: 'Bull', price: 400, probability: 25, timeframe: '12 months' },
]

/** A — held, in a book big enough for the weight to mean something. */
const bigBook = currentBook([
  ...Array.from({ length: 4 }, (_, i) =>
    holdingRow('lcc', 'Large Cap Core', `filler${i}`, 100)),
  holdingRow('lcc', 'Large Cap Core', 'aapl-break', 250),
])
const breakWithWeight = unwrap(buildScenarioGapCard({
  assetId: 'aapl-break', symbol: 'AAPL', companyName: 'Apple',
  price: 158.4, priceAsOf: new Date().toISOString(),
  cases: BROKEN_LADDER, statedAt: '2026-03-11T00:00:00.000Z',
  heldIn: [{ id: 'lcc', name: 'Large Cap Core' }],
  capital: frameworkCapitalFor(bigBook, 'aapl-break'),
}))

/** B — held, in a book too small for a percentage to describe anything. */
const smallBook = currentBook([
  holdingRow('sb', 'Small Book', 'other', 100),
  holdingRow('sb', 'Small Book', 'nke-break', 250),
])
const breakWithoutWeight = unwrap(buildScenarioGapCard({
  assetId: 'nke-break', symbol: 'NKE', companyName: 'Nike',
  price: 158.4, priceAsOf: new Date().toISOString(),
  cases: BROKEN_LADDER, statedAt: '2026-03-11T00:00:00.000Z',
  heldIn: [{ id: 'sb', name: 'Small Book' }],
  capital: frameworkCapitalFor(smallBook, 'nke-break'),
}))

/**
 * The unwritten-position states, through the real derivation.
 *
 * Three of them, because the interesting part of this signal is the two ways
 * it must NOT fire. Every one builds a `DerivedInsight` through the real rule
 * — `caseCoverageFrom` decides what is written, `researchIssueFor` decides the
 * framing, `materialCapitalFor` decides whether the capital is material — and
 * hands the result to the same builder the feed uses. Nothing here writes a
 * headline, a percentage or a sentence.
 *
 * Gallery only; nothing in this file ships in the app bundle.
 */
function unwrittenInsight(
  symbol: string, assetId: string, written: string[], portfolioName: string,
) {
  const coverage = caseCoverageFrom(
    written.map(section => ({ section, hasContent: true, updated_at: '2026-02-01T00:00:00.000Z' })) as any,
  )
  const clocks = reviewClocks(coverage, null)
  const issue = researchIssueFor({
    clocks, coverage, evidence: [], movePct: null, now: Date.parse('2026-09-01T00:00:00.000Z'),
  })!
  const copy = researchCopy({ symbol, issue, portfolioName, weightPct: null, held: true })
  return {
    id: `unwritten-${assetId}`,
    kind: researchSignalTypeFor(issue.framing) === 'no_research' ? 'no_thesis' : 'stale_research',
    headline: copy.headline, body: copy.body, prompt: copy.prompt,
    assetId, symbol, companyName: symbol,
    portfolioName, portfolioId: 'gp', weightPct: null,
    held: true, portfolioCount: 1, liveIdeas: [], coverageOwners: ['John Homler'],
    evidenceCount: 0, issue,
    caseWrittenAt: clocks.caseWrittenAt, researchReviewAt: null,
    reviewAnchor: clocks.effectiveAnchor, anchoredOn: clocks.anchoredOn,
    daysSinceReview: issue.daysSinceReview, daysSinceWritten: issue.daysSinceWritten,
    score: 1,
  } as any
}

/** A book of `n` filler positions plus the subject at `shares`. */
const bookWith = (portfolioId: string, name: string, assetId: string, shares: number, n = 4) =>
  currentBook([
    ...Array.from({ length: n }, (_, i) => holdingRow(portfolioId, name, `pad${portfolioId}${i}`, 100)),
    holdingRow(portfolioId, name, assetId, shares),
  ])

/**
 * The three capital fixtures, as the FEED composes them.
 *
 * ── What was wrong with the previous shape ────────────────────────────────
 *
 * They were `unwrap(buildInsightCard(...))` and nothing else, mounted as a
 * plain `card:` entry with no panes. The feed cannot produce that: an insight
 * entry always receives a case pane, and where the framing wants a judgment it
 * receives that too. So these three measured 19-35% ink with 185-271px of dead
 * space, and a whole density stage went looking for a hole that exists only
 * here. A fixture that does not compose what ships is a second implementation
 * wearing a fixture's clothes.
 *
 * The insight and the capital are kept alongside the card now, because the
 * panes are built from them — the same inputs `MobileDashboard` builds from.
 */
const capitalFixture = (
  symbol: string, assetId: string, written: string[], shares: number, book: string,
) => {
  const ins = unwrittenInsight(symbol, assetId, written, 'Large Cap Core')
  const capital = materialCapitalFor(bookWith(book, 'Large Cap Core', assetId, shares), assetId)
  return { ins, capital, card: unwrap(buildInsightCard(ins, capital)) }
}

/* A — meaningful capital, nothing written. The signal. */
const unwrittenMaterialFx = capitalFixture('JNJ', 'jnj-unwritten', [], 250, 'lcc2')
const unwrittenMaterial = unwrittenMaterialFx.card

/* B — nothing written, but the stake is a rounding error. Not the signal. */
const unwrittenImmaterialFx = capitalFixture('SNAP', 'snap-unwritten', [], 4, 'lcc3')
const unwrittenImmaterial = unwrittenImmaterialFx.card

/* C — meaningful capital WITH a written view. Not the signal. */
const writtenMaterialFx = capitalFixture(
  'MSFT', 'msft-written', ['thesis', 'where_different', 'risks_to_thesis'], 250, 'lcc4')
const writtenMaterial = writtenMaterialFx.card

/**
 * A capital/Research card with the panes the feed gives it.
 *
 * The pane SET comes from `insightPanePlan` — the same function the dashboard
 * orders its panes with — so this fixture cannot drift from the feed by
 * gaining or losing a region. `price` is skipped rather than faked: the plan
 * lists it as an eligibility, the real pane fetches a series, and a fixture
 * that drew one anyway would be reserving space the feed does not promise.
 */
function CapitalCard({ fx }: { fx: ReturnType<typeof capitalFixture> }) {
  const { ins, capital, card } = fx
  const framing = ins.issue.framing
  const plan = insightPanePlan({
    framing,
    hasCapital: !!capital,
    evidenceCount: ins.issue.evidence?.length ?? 0,
  })
  const casePane = {
    id: 'case',
    label: 'Case',
    content: (
      <CasePane
        present={ins.issue.present}
        caseWrittenAt={ins.caseWrittenAt}
        daysSinceWritten={ins.daysSinceWritten}
        daysSinceReviewed={ins.anchoredOn === 'reviewed' ? ins.daysSinceReview : null}
        coverageOwners={ins.coverageOwners}
        held={ins.held}
        portfolioName={ins.portfolioName ?? null}
        portfolioCount={ins.portfolioCount}
        weightPct={ins.weightPct ?? null}
        liveIdeas={ins.liveIdeas}
        evidenceCount={ins.evidenceCount}
        motivate={framing === 'no_case' || framing === 'incomplete_case'}
        absenceEmphasis={!!capital}
      />
    ),
  }
  const panes = plan.order.flatMap(id =>
    id === 'case' ? [casePane]
    : id === 'judgment' ? [{
        id: 'verdict',
        label: 'Respond',
        content: (
          <VerdictBar
            question={card.prompt ?? 'Has the investment view changed?'}
            hideQuestion
            options={RESPOND_FOUR}
            externalCommit
            onRespond={async () => true}
          />
        ),
      }]
    : [],
  )
  return <SignalCardView card={card} onAction={noop} onOpen={noop} onOpenPortfolio={noop} panes={panes} />
}

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
/**
 * The card as the FEED composes it: one carousel, four panes, in ship order.
 *
 * ── Why the fixture had to change shape ──────────────────────────────────
 *
 * It rendered `evidence` and `detail` — two separate `CardCarousel`s stacked in
 * two regions, so the phone suite measured a card with two indicator rows, two
 * pane counts and a layout the app has not produced since the panes were
 * merged. Every geometry assertion about this card was true of the fixture and
 * unverified against what ships.
 *
 * `ScenarioGapPanes` is the real composer, and it is pure, so the gallery mounts
 * the same component the feed does. What the gallery supplies instead of the
 * feed is only what needs a database: a 52-week range and a price pane. Both
 * are passed in, which is exactly the seam that makes this renderable here.
 */
/**
 * The response module, on any card, opened.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The convergence this fixture reviews is a claim about what every family
 * looks like WHILE ANSWERING, and that state lives in `MobileDashboard`
 * behind a login. Two stages have now shipped ordering changes that no
 * screenshot could check.
 *
 * So this is the feed's own wiring, minimally: the same `SignalCardView`, the
 * same `VerdictBar` in `externalCommit` mode, the same footer override
 * appearing on selection. What it proves is the SKELETON — where Back sits,
 * where the question starts, how the options are laid out, that the note is
 * above the commit, that the commit is the footer and that no prose follows
 * it. It does not prove any family's real question or options; those are
 * asserted in the unit tests.
 */
function RespondSkeleton({ card, question, options }: {
  card: SignalCard
  question: string
  options: VerdictOption[]
}) {
  const [picked, setPicked] = useState<VerdictOption | null>(null)
  const [pane, setPane] = useState('verdict')
  return (
    <SignalCardView
      card={card}
      panes={[{
        id: 'verdict',
        label: 'Respond',
        content: (
          <VerdictBar
            question={question}
            options={options}
            hideQuestion={card.prompt === question}
            externalCommit
            onPick={setPicked}
            onRespond={async () => true}
          />
        ),
      }]}
      onPaneChange={setPane}
      primaryOverride={pane === 'verdict' && picked
        ? { id: 'submit_response', label: 'Submit response', run: noop }
        : null}
      onAction={noop}
      onOpen={noop}
      onOpenPortfolio={noop}
    />
  )
}

const scenarioPanes = (c: SignalCard, opts?: {
  range52w?: { low: number; high: number } | null
  pricePane?: React.ReactNode | null
}) => {
  const d = c.evidence!.data as any
  return (
    <ScenarioGapPanes
      question={c.prompt ?? 'Has the investment view changed?'}
      ladderPane={(
        <ScenarioLadder
          price={d.price}
          cases={d.cases}
          expected={d.expected}
          statedOn={d.statedOn ?? null}
          range52w={opts?.range52w ?? null}
        />
      )}
      pricePane={opts?.pricePane ?? null}
      casesPane={(
        /* Wired like the app: the probability-status row is the thing that was
           clipping on the phone, and a fixture without a handler renders no CTA
           and so cannot show it. */
        <ScenarioCaseDetail
          price={d.price}
          cases={d.cases}
          expected={d.expected}
          blockedBy={deriveScenarioState(d.price, d.cases)?.expectedBlockedBy ?? null}
          onAddProbabilities={noop}
        />
      )}
      onSubmit={async () => true}
    >
      {({ panes, onPaneChange, primaryOverride }) => (
        <SignalCardView
          card={c}
          panes={panes}
          onPaneChange={onPaneChange}
          primaryOverride={primaryOverride}
          onAction={noop}
          onOpen={noop}
          onOpenPortfolio={noop}
        />
      )}
    </ScenarioGapPanes>
  )
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

/** Four and three options, to show both grid shapes side by side. */
const RESPOND_FOUR: VerdictOption[] = [
  { key: 'a', label: 'Priced in', tone: 'affirm', disposition: 'settled', note: 'n' },
  { key: 'b', label: 'Needs work', tone: 'neutral', disposition: 'flagged', note: 'n' },
  { key: 'c', label: 'Not mine', tone: 'negate', disposition: 'rejected', note: 'n' },
  { key: 'd', label: 'Later', tone: 'neutral', disposition: 'flagged', note: 'n' },
]
const RESPOND_THREE: VerdictOption[] = RESPOND_FOUR.slice(0, 3)

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

/**
 * The stale-target card, as the feed composes it.
 *
 * ── Why this is a component and not three entries in the array ────────────
 *
 * The card holds state the array cannot express: which resolution the reader
 * has chosen, which pane they are standing on, and a sticky footer computed
 * from both. A fixture that flattened those into static panes would show a
 * layout the app never renders — and this page is where the phone suite
 * measures the geometry.
 *
 * `TargetExpiredPanes` is the SHIPPING composition, imported rather than
 * copied. What the harness supplies is only the part it must: the chart, drawn
 * over fixture closes, because `PricePane` reaches Supabase and this page has
 * no Supabase environment. Same seam and same reason as `renderSparkline` on
 * the Explore fixture.
 *
 * The snapshot comes from `resolvePriceSnapshot` over those same closes, so the
 * editor's CURRENT PRICE and the chart's last point are one number here for
 * exactly the reason they are one number in the app.
 */
function StaleTargetFixture() {
  const snapshot = resolvePriceSnapshot({ closes: AAPL_CLOSES })
  return (
    <TargetExpiredPanes
      subject={{
        symbol: 'AAPL', target: 245, timeframe: '12 months',
        statedAt: STALE_STATED_AT, expiredAt: STALE_HORIZON_AT,
      }}
      question="What should happen to this target?"
      snapshot={snapshot}
      pricePane={(
        <PriceContext
          symbol="AAPL" series={AAPL_CLOSES} now={NOW}
          // The band the card exists to talk about. Drawing the price without
          // it was the defect: a card arguing that a number has stopped being a
          // view, with the number nowhere on the axis.
          bands={[{ label: 'Target', price: 245, kind: 'target' }]}
          markers={[{ date: STALE_HORIZON_AT, label: 'Horizon', kind: 'horizon' }]}
          compareTo="Target"
        />
      )}
      onCommit={async () => true}
      onOpenCases={noop}
    >
      {({ panes, onPaneChange, primaryOverride }) => (
        <SignalCardView
          card={staleTarget}
          panes={panes}
          onPaneChange={onPaneChange}
          primaryOverride={primaryOverride}
          onAction={noop}
          onOpen={noop}
          onOpenPortfolio={noop}
        />
      )}
    </TargetExpiredPanes>
  )
}

/**
 * `Component` is the escape hatch for a card whose panes hold their own state.
 *
 * `target-expired` needs it because the footer is computed from a selection and
 * an active pane, and the scenario cards need it for the same reason: the
 * response pane owns a choice and a note, and the footer's `Submit response`
 * is derived from both. A fixture array of static nodes cannot express that —
 * and a hand-copied approximation of it would be a guard measuring a card that
 * does not ship, which is exactly what these four fixtures used to be.
 */
const crowdedSpread = { ...activeRisk, id: 'crowding:spread', type: 'crowding',
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
  /**
   * `3 books` was a third wording for a fact two other families
   * already state, and nothing opened it. The real spread is right
   * here in the fixture — the same rows the evidence pane and the
   * detail draw — so the count carries them into the shared
   * disclosure instead of sitting inert beside the org name.
   */
  context: [{ label: 'Tesseract' }, {
    label: '3 portfolios',
    portfolios: CROWDED_BOOKS.map((b, i) => ({
      // Ids, so each row is a route into the book rather than a line of text —
      // the same thing the lens now carries through.
      id: `crowd-p${i + 1}`,
      name: b.label,
      weightPct: b.weightPct,
      valueUsd: CROWDED_EXPOSURE.find(e => e.label === b.label)?.weightPct,
    })),
  }],
  actions: { ...activeRisk.actions, open: { label: 'Open AAPL', href: '/asset/aapl' } },
} as SignalCard

const CARDS: {
  slug: string
  card: SignalCard
  evidence?: React.ReactNode
  detail?: React.ReactNode
  detailLabel?: string
  detailCollapsible?: boolean
  Component?: () => React.ReactNode
}[] = [
  /* A headline-length fixture. The bare ladder, because what is measured
     here is what a 90-character claim does to the rows beneath it. */
  { slug: 'long-label', card: longLabel,
    evidence: <ScenarioLadder price={(amzn.evidence!.data as any).price}
                cases={(amzn.evidence!.data as any).cases}
                expected={(amzn.evidence!.data as any).expected} /> },
  { slug: 'active-risk-real', card: activeReal, evidence: activeEvidence,
    // Same disclosure pattern as the scenario card: the pane ranks the top
    // five, the detail carries the rest without the card growing.
    detail: <ActiveWeightPeers subject="NVDA" peers={PEERS} heldCount={69}
              notHeldCount={435} notHeldActivePct={-41.0900} full />,
    detailLabel: 'See all 69 active weights' },
  /**
   * Six cases at the worst real density, AND the 52-week marks landing
   * among them.
   *
   * AAPL's ladder runs 205-500 against a price of 150, so a high of 260
   * sits INSIDE the modelled band where the case labels already are. That
   * is the collision the second placement pass exists to survive, and a
   * fixture whose 52-week range sat harmlessly off both ends would not
   * test it.
   */
  { slug: 'six-cases', card: sixCases,
    Component: () => scenarioPanes(sixCases, { range52w: { low: 142, high: 260 } }) },
  { slug: 'scenario-below-bear', card: tsla, Component: () => scenarioPanes(tsla) },
  /*
    The probability-mode fixture. It carries a 52-week range because that mode
    KEEPS the range — the card without one exercises the absent-range path, and
    a fixture with no band cannot show whether the band survives the transition.
    Chosen so the expectation sits inside the year's trading, which is the
    reading the mode exists to support — and INSIDE the case span, so the axis
    domain is the one the cases already set. A range that widened the domain
    would slide the expectation toward Base until their two hit areas overlapped
    and the ring became unclickable at 320px, which is a fixture artefact and
    not a finding about the card.
  */
  { slug: 'scenario-at-expected', card: coherent,
    Component: () => scenarioPanes(coherent, { range52w: { low: 84, high: 132 } }) },
  /**
   * The 52-week range as the feed supplies it.
   *
   * A literal here rather than `range52wFrom(series)`, because the gallery
   * has no price cache — the shape is what matters and the numbers are
   * AMZN's real last-year close range. Low 86 is under the bear case and
   * high 242 is above the tape, so the ladder draws the span across the
   * whole axis with both ends in the compressed margins, which is the
   * common case.
   */
  /* The production clipping report, at its real numbers. See `prodAmzn`. */
  { slug: 'scenario-prod-amzn', card: prodAmzn,
    Component: () => scenarioPanes(prodAmzn, { range52w: { low: 199, high: 284 } }) },
  { slug: 'scenario-prod-dash', card: prodDash,
    Component: () => scenarioPanes(prodDash, { range52w: { low: 147, high: 282 } }) },
  { slug: 'scenario-above-bull', card: amzn,
    Component: () => scenarioPanes(amzn, { range52w: { low: 86, high: 242 } }) },
  /* Held framework break, with a book that can carry a weight claim. */
  { slug: 'portfolio-framework-break', card: breakWithWeight,
    Component: () => scenarioPanes(breakWithWeight, { range52w: { low: 140, high: 420 } }) },
  /* The same break in a two-name book, where the honest answer is the book's
     name and not a percentage. */
  { slug: 'portfolio-framework-break-unweighted', card: breakWithoutWeight,
    Component: () => scenarioPanes(breakWithoutWeight, { range52w: { low: 140, high: 420 } }) },
  /* Meaningful capital with nothing written behind it. The signal.
     Its pane ORDER is a feed behaviour and lives in MobileDashboard, so what
     this shows is the card, not the carousel the feed opens on. */
  { slug: 'portfolio-unwritten-position', card: unwrittenMaterial,
    Component: () => <CapitalCard fx={unwrittenMaterialFx} /> },
  /* The response skeleton, one per family class. Cover the headline and they
     should be one interaction: Back, question, options, note, footer commit. */
  { slug: 'respond-no-target', card: unwrittenMaterial,
    Component: () => (
      <RespondSkeleton
        card={unwrittenMaterial}
        question="Does this position need a price target?"
        options={RESPOND_FOUR}
      />
    ) },
  /* Deliberately the multi-book card, and deliberately the one whose
     metadata row is longest.

     `Back` replaces `Your view` at the END of the context row, so the row a
     multi-book card renders is the row Respond has to share. Pointing this at
     a single-book fixture would have shown a shorter row than any real
     crowding card ever renders and proved nothing about the collision the
     count exists to prevent. */
  { slug: 'respond-crowded', card: crowdedSpread,
    Component: () => (
      <RespondSkeleton
        card={crowdedSpread}
        question="Is AAPL too much of one bet?"
        options={RESPOND_THREE}
      />
    ) },
  { slug: 'respond-framework-break', card: breakWithWeight,
    Component: () => (
      <RespondSkeleton
        card={breakWithWeight}
        question="Has the investment view changed?"
        options={RESPOND_FOUR}
      />
    ) },
  /* The same absence on a rounding-error stake — a Research card, not a
     Portfolio one. */
  { slug: 'portfolio-unwritten-immaterial', card: unwrittenImmaterial,
    Component: () => <CapitalCard fx={unwrittenImmaterialFx} /> },
  /* Meaningful capital that HAS a written view. No capital issue at all. */
  { slug: 'portfolio-written-material', card: writtenMaterial,
    Component: () => <CapitalCard fx={writtenMaterialFx} /> },
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
  /**
   * The tape as a pane of the real card, carrying the analyst's own cases.
   *
   * It used to be its own hand-built `CardCarousel` of ladder + price, which
   * is the composition `ScenarioGapPanes` now owns — so the fixture was a
   * second, slightly different arrangement of the same two panes. Passing
   * the price pane IN is the seam the composer already has for exactly this.
   */
  { slug: 'scenario-price-bands', card: { ...tsla, id: 'scenario:price-bands' },
    Component: () => scenarioPanes({ ...tsla, id: 'scenario:price-bands' }, {
      range52w: { low: 214, high: 488 },
      pricePane: (
        /* NO `compareTo`, matching what the feed now passes.
           The distance to the breached case is this CARD's metric and it is
           already stated in 32px at the top of the tile; printing a second
           case-relative figure beside the price made two different
           measurements look like one, and it truncated at 390px. The chart
           header states the window return instead. The cases are still in
           `bands`, so the breached one is still drawn as a labelled rule at
           its own price. */
        <PriceContext symbol="TSLA" series={TSLA_CLOSES} now={NOW}
          bands={(tsla.evidence!.data as any).cases.map((c: any) =>
            ({ label: c.name, price: c.price, kind: 'case' as const }))} />
      ),
    }) },
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
  { slug: 'crowding-spread', card: crowdedSpread,
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
  /**
   * The workflow card, measured for the first time.
   *
   * `card-coverage.ts` has named this the second-highest-value gap since it was
   * written: `buildAttentionCard` had no fixture at all, its entity is not an
   * asset on most items, and its metric is a day count — a combination no other
   * measured card has. It is also the family whose primary was inert, because
   * the mobile feed renders it through `renderCard` and the only thing at the
   * end of `resolve` was a hard-coded no-op.
   *
   * Built through the real builder with the shape the feed actually passes:
   * `buildAttentionCard(item, asset)` and NO capability object, which is what
   * decides the primary. A fixture that passed `{ approve: true }` would
   * photograph a card no reader of this feed can reach.
   */
  { slug: 'awaiting-review', card: unwrap(buildAttentionCard({
      attention_id: 'at-1',
      attention_type: 'decision_required',
      title: 'Trim MSFT to 4.0% in Core Equity',
      reason_text: 'You are the PM on Core Equity and this has been waiting since Monday.',
      subtitle: 'Priya Raman proposed this off the Q3 margin revision.',
      due_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
      created_at: new Date(NOW.getTime() - 6 * 86_400_000).toISOString(),
      next_action: 'Decide',
      tags: ['Trading'],
      context: { asset_id: 'a1' },
    }, { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' })),
    panes: [
      { id: 'verdict', label: 'Respond', content: (
        <VerdictBar
          // The same string the builder puts in `card.prompt` for a
          // `decision_required` item, and the same one the feed passes — which
          // is what makes `hideQuestion` fire. A fixture that paired the
          // decision prompt with the action-required question would photograph
          // the card asking twice, which is not what ships.
          question="What is your answer?"
          hideQuestion
          options={[
            { key: 'answered', label: 'Answered', tone: 'affirm', disposition: 'settled',
              note: 'MSFT: answered outside the feed. Clearing it from my queue.' },
            { key: 'in_progress', label: 'In progress', tone: 'neutral', disposition: 'flagged',
              note: 'MSFT: still working through it.' },
            { key: 'defer', label: 'Defer', tone: 'neutral', disposition: 'settled',
              note: 'MSFT: deferred deliberately, not forgotten.' },
            { key: 'not_mine', label: 'Not mine', tone: 'negate', disposition: 'rejected',
              note: 'MSFT: this decision is not mine to make.' },
          ]}
          onRespond={noop}
        />
      ) },
    ] },
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
          /**
           * The control the app actually ships on this card.
           *
           * The fixture put `WhatIfSize` behind the disclosure, and `WhatIfSize`
           * is not reachable from the application at all — the feed renders
           * `SizeExplorer` as a CAROUSEL PANE (MobileDashboard, the conviction
           * branch). Different component, different container, and ~28px less
           * height because a pane carries an indicator strip and a disclosure
           * does not.
           *
           * So the gallery has been showing a control nobody sees, in a slot
           * nobody uses, at a height the phone never gives it. Three separate
           * fixes for "the commit buttons overlap the change figures" shipped
           * against this fixture, and none of them could have caught it.
           *
           * `benchmarkPct` is null exactly as the conviction branch passes it,
           * which is what makes the Active figure and the Neutral preset absent
           * here. The active-risk card is the one with a real benchmark.
           */
          { id: 'size', label: 'Size',
            content: <SizeExplorer symbol="AAPL" currentPct={25.32} benchmarkPct={6.7}
                       onStage={noop} /> },
          /**
           * The same control on a book with no benchmark file.
           *
           * Which is most of them: 7 of the active portfolios in production
           * carry one and the rest do not, and the largest overweight positions
           * sit in books that do not. The trailing cell reads "no benchmark"
           * there — a phrase at 12px beside two figures at 17px — and that size
           * difference is what broke the row's alignment twice. Without a
           * fixture for it, the gallery kept reporting the row as perfect.
           */
          { id: 'size-nobench', label: 'Size · no bench',
            content: <SizeExplorer symbol="AAPL" currentPct={25.32} benchmarkPct={null}
                       onStage={noop} /> },
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
  { slug: 'target-expired', card: staleTarget, Component: StaleTargetFixture },
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
          /**
           * The control the app ships on this card, in the slot it ships in.
           *
           * The fixture had `TargetTuner` behind the disclosure. The app never
           * rendered that here — it rendered `TargetExplorer` as a pane, and now
           * renders the ladder builder. A fixture that disagrees with the feed
           * about which component, in which container, at which height is a
           * fixture that cannot catch a layout bug, which is how three fixes for
           * the same overlap shipped without one.
           *
           * `range52w` is passed literally rather than fetched: the gallery has no
           * Supabase environment, and `CaseLadderBuilder` is pure for exactly that
           * reason. `LadderPane` is the shell that fetches it in the app.
           */
          { id: 'ladder', label: 'Price it',
            content: <CaseLadderBuilder range52w={{ low: 164.08, high: 260.1 }}
                       onOpenDetails={noop} /> },
        ]}
      />
    ),
    detail: (
      <CardCarousel
        panes={[
          { id: 'tune', label: 'Target',
            content: <TargetTuner symbol="AAPL" currentTarget={212.44} isFirstTarget
                       reference={{ price: 212.44, label: 'position mark' }} onRecord={noop} /> },
          { id: 'verdict', label: 'Respond',
            content: (
              <VerdictBar
                question="Does this position need a price target?"
                hideQuestion
                options={[
                  { key: 'price_target', label: 'Yes', tone: 'affirm', disposition: 'flagged',
                    note: 'AAPL: this position should carry a price target.' },
                  { key: 'case_framework', label: 'I use cases', tone: 'affirm', disposition: 'flagged',
                    note: 'AAPL: valued on a scenario ladder rather than a single target.' },
                  // `settled`, not `rejected`. A non-price framework is a
                  // legitimate process, and the fixture exists partly to keep
                  // that mapping visible in review.
                  { key: 'not_price_driven', label: 'Not target-driven', tone: 'neutral', disposition: 'settled',
                    note: 'AAPL: held on a thesis that does not reduce to a price. Deliberate, not an oversight.' },
                  { key: 'not_now', label: 'Not now', tone: 'neutral', disposition: 'flagged',
                    note: 'AAPL: a fair question, but not today. Deferred from the feed.' },
                ]}
                onRespond={noop}
              />
            ) },
        ]}
      />
    ),
    detailCollapsible: false },
  /**
   * Case B: something moved and the recorded view did not follow.
   *
   * The chart is the argument. The marker is the last time anybody recorded a
   * view, so the gap the card is about is drawn rather than counted at the
   * reader — a card claiming an unreviewed move with no visible "since when"
   * is asking to be taken on trust.
   */
  { slug: 'unreviewed-move', card: unreviewedMove,
    evidence: (
      <CardCarousel
        panes={[
          { id: 'price', label: 'Price',
            content: (
              <PriceContext
                symbol="AAPL" series={AAPL_CLOSES} now={NOW}
                markers={[{ date: MOVE_TOUCHED, label: 'Case written', kind: 'horizon' }]}
              />
            ) },
        ]}
      />
    ),
    detail: (
      <CardCarousel
        panes={[
      { id: 'verdict', label: 'Respond',
        content: (
          <VerdictBar
            question="Does this change need a look?"
            hideQuestion
            options={[
              { key: 'change_accounted_for', label: 'Case holds', tone: 'affirm', disposition: 'settled',
                note: 'AAPL: the recorded view already accounts for this.' },
              { key: 'view_needs_update', label: 'Needs update', tone: 'neutral', disposition: 'flagged',
                note: 'AAPL: the written view needs updating for this.',
                nextAction: { id: 'update_thesis', label: 'Update thesis' } },
              { key: 'no_longer_covered', label: 'No longer covered', tone: 'negate', disposition: 'settled',
                note: 'AAPL: no longer actively covered.' },
            ]}
            onRespond={noop}
            resolveNext={o => (o.nextAction ? { label: o.nextAction.label, run: noop } : null)}
          />
        ) },
        ]}
      />
    ),
    detailCollapsible: false },
  /**
   * Case F: nothing happened. A large position, silent long enough that size
   * alone earns a look.
   *
   * Kept as its own fixture precisely because it must NOT read like case B.
   * The copy has to stay free of event language, and the only way to see that
   * is to have both rendered side by side.
   */
  { slug: 'unreviewed-size', card: unreviewedSize,
    evidence: (
      <CardCarousel
        panes={[
          { id: 'price', label: 'Price',
            content: (
              <PriceContext
                symbol="AAPL" series={AAPL_CLOSES} now={NOW}
                markers={[{ date: SIZE_TOUCHED, label: 'Case written', kind: 'horizon' }]}
              />
            ) },
        ]}
      />
    ),
    // It had a chart and nothing else, which left 447px of blank card under it.
    // The judgment is the thing the reader is here to give, and it costs the
    // same room the emptiness was taking.
    detail: (
      <CardCarousel
        panes={[
          { id: 'verdict', label: 'Respond',
            content: (
              <VerdictBar
                question="Does this change need a look?"
                hideQuestion
                options={[
                  { key: 'change_accounted_for', label: 'Case holds', tone: 'affirm', disposition: 'settled',
                    note: 'MSFT: the recorded view already accounts for this.' },
                  { key: 'view_needs_update', label: 'Needs update', tone: 'neutral', disposition: 'flagged',
                    note: 'MSFT: the written view needs updating.',
                    nextAction: { id: 'update_thesis', label: 'Update thesis' } },
                  { key: 'no_longer_covered', label: 'No longer covered', tone: 'negate', disposition: 'settled',
                    note: 'MSFT: no longer actively covered.' },
                ]}
                onRespond={noop}
                resolveNext={o => (o.nextAction ? { label: o.nextAction.label, run: noop } : null)}
              />
            ) },
        ]}
      />
    ),
    detailCollapsible: false },
  /**
   * News, composed rather than left short.
   *
   * A headline and two sentences is genuinely thin content, and the old fixture
   * rendered it as 573px of empty card — which reads as a bug, not as brevity.
   * The story is about a holding, so the tape and the reader's view of it are
   * both relevant and both already built. Nothing here is filler: the chart
   * answers "what has the market done with this", which is the first thing
   * anybody asks of a headline.
   */
  { slug: 'news', card: news,
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
          { id: 'verdict', label: 'Respond',
            content: (
              <VerdictBar
                question="Does this change the view?"
                hideQuestion
                options={[
                  { key: 'thesis_relevant', label: 'Hits the thesis', tone: 'neutral', disposition: 'flagged',
                    note: 'AAPL: this story bears on the thesis.',
                    nextAction: { id: 'update_thesis', label: 'Update thesis' } },
                  { key: 'priced_in', label: 'Priced in', tone: 'affirm', disposition: 'settled',
                    note: 'AAPL: already reflected in the price and the view.' },
                  { key: 'needs_review', label: 'Review', tone: 'neutral', disposition: 'flagged',
                    note: 'AAPL: worth a proper look before calling it.' },
                ]}
                onRespond={noop}
                resolveNext={o => (o.nextAction ? { label: o.nextAction.label, run: noop } : null)}
              />
            ) },
        ]}
      />
    ),
    detailCollapsible: false },
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
      {CARDS.map(({ slug, card, evidence, detail, panes, detailLabel, detailCollapsible, Component }: any) => (
        <div key={slug} data-card={slug}
          data-card-tier-slot={cardTier(card?.type)}
          // The card's own tier, not one viewport for everything.
          //
          // This wrapper stands in for `FeedSlot`, so it has to size itself the
          // way the slot does or the gallery measures a layout the feed does
          // not ship. It was `h-[844px]` for every card, and that is precisely
          // what hid the emptiness here: a card with 247px of content reported
          // a clean full-screen box and the 603px hole inside it was somebody
          // else's problem.
          //
          // A definite height either way, which is what `h-full` on the card
          // resolves against.
          style={{ height: TIER_PX[cardTier(card?.type)] }}
          className="w-full snap-start snap-always overflow-hidden border-b-8 border-gray-200">
          {/* A card whose panes carry their own state renders itself.
              `target_expired` holds a review selection and an active pane, and
              the footer is computed from both — state a fixture array cannot
              express. It still mounts the SHIPPING composition
              (`TargetExpiredPanes`) rather than a hand-copied one, so what the
              phone suite measures here is what the feed renders. */}
          {Component ? <Component /> : (
          <SignalCardView card={card} onAction={noop} onOpen={noop} panes={panes}
            // Without a handler the disclosure renders rows and no way out of
            // them, which is exactly the state the fixture needs to prove is
            // not what ships.
            onOpenPortfolio={noop}
            evidence={evidence} detail={detail} detailLabel={detailLabel}
            detailCollapsible={detailCollapsible} />
          )}
        </div>
      ))}
    </div>

    {/* Ranking below the feed, not above it.
        It went above first, which pushed the feed container down the page and
        broke all three gesture tests — they drive real pointer input at fixed
        viewport coordinates, so anything inserted before the feed moves the
        target out from under them. The panel is a scroll away either way. */}
    <RankingDebug />

    {/* Explore last, for the same reason the ranking panel is not first: the
        gesture tests drive pointer input at fixed viewport coordinates against
        the Curate feed, and anything inserted before it moves their target. */}
    <ExploreGallery />

    {/* Last, for the same reason as the two above: the gesture tests drive
        real pointer input at fixed viewport coordinates against the Curate
        feed, and anything inserted before it moves their target. */}
    <FeedWindowGallery />
  </div>,
)
