/**
 * Real producer output, built by the real producers.
 *
 * ── Why these are not hand-written cards ──────────────────────────────────
 *
 * The whole claim of this stage is that the engine agrees with what ships. A
 * fixture card typed out by hand proves the adapter agrees with a fixture, and
 * a fixture that drifts from the builder is exactly how a gallery came to
 * measure a composition the feed cannot produce.
 *
 * So the inputs here are the SOURCE shapes — a `StaleTarget` row as
 * `usePortfolioLenses` emits it, a `ScenarioGapInput` as `useScenarioCards`
 * assembles it — and the cards come out of `buildStaleTargetCard` and
 * `buildScenarioGapCard`. Every threshold, suppression and severity rule under
 * test is therefore the shipping one.
 */

import { buildInsightCard, buildStaleTargetCard } from '../../../signals/builders/legacy-kinds'
import { buildScenarioGapCard } from '../../../signals/builders/scenarioGap'
import { researchBaseFor } from '../../../research/case-state'
import type { DerivedInsight } from '../../../../hooks/mobile/useDerivedInsights'
import type { SignalCard } from '../../../signals/contract'
import type { StaleTarget } from '../../../../hooks/mobile/usePortfolioLenses'
import type { PriorityInput } from '../../../signals/feed-priority'

/**
 * One instant, captured once, and read from the real clock on purpose.
 *
 * `buildScenarioGapCard` gates on quote age against `Date.now()` — a quote
 * more than a long weekend old is refused as a data fault. That rule is the
 * shipping one and this suite is not entitled to fake it, so the fixture dates
 * its quote relative to now instead.
 *
 * Determinism survives because both sides of every comparison are handed this
 * same value: the old path and the new path see one clock, so a parity result
 * cannot depend on when the suite runs.
 */
export const NOW = Date.now()

const unwrap = (r: ReturnType<typeof buildStaleTargetCard>): SignalCard => {
  if (!r.ok) throw new Error(`fixture suppressed: ${r.reason} — ${r.detail ?? ''}`)
  return r.card
}

// ── Target Expired ───────────────────────────────────────────────────────────

/**
 * A twelve-month target written in Jan 2025, six months past its horizon.
 *
 * Six is deliberate: it is the boundary `buildStaleTargetCard` uses for
 * `critical`, so the fixture exercises the severity rule the adapter is
 * forbidden from restating.
 */
export const staleTargetRow = (over: Partial<StaleTarget> = {}): StaleTarget => ({
  asOf: '2026-08-31T00:00:00.000Z',
  assetId: 'a-msft',
  symbol: 'MSFT',
  companyName: 'Microsoft',
  target: 520,
  price: 431.2,
  timeframe: '12 months',
  ageMonths: 18,
  overdueMonths: 6,
  heldIn: ['Core Equity', 'Global Growth'],
  heldInIds: ['p-core', 'p-growth'],
  statedAt: '2025-01-15T00:00:00.000Z',
  expiredAt: '2026-01-15T00:00:00.000Z',
  /** `analyst_price_targets.user_id`, now selected by the lens. */
  authorId: 'u-analyst',
  ...over,
})

export const staleTargetCard = (over: Partial<StaleTarget> = {}): SignalCard =>
  unwrap(buildStaleTargetCard(staleTargetRow(over)))

/**
 * What `rankInputFor` hands `rankFeed` for a stale-target entry.
 *
 * Transcribed from `MobileDashboard`'s own `case 'stale'` branch, including
 * the parts that look like oversights and are load-bearing: no weight, no
 * overdue days, and a deviation of `overdueMonths × 5`.
 */
export const staleTargetRankInput = (
  s: StaleTarget = staleTargetRow(),
  coverage: PriorityInput['coverage'] = 'direct',
): PriorityInput => ({
  id: `stale-${s.assetId}`,
  type: 'target_expired',
  severity: s.overdueMonths >= 6 ? 'critical' : 'attention',
  occurredAt: s.expiredAt,
  weightPct: null,
  held: true,
  deviationPct: s.overdueMonths * 5,
  coverage,
  judgment: null,
})

// ── Case vs Price ────────────────────────────────────────────────────────────

const CASES = [
  { id: 'c-bear', userId: 'u-analyst', name: 'Bear', price: 400, probability: 25, timeframe: '12 months' },
  { id: 'c-base', userId: 'u-analyst', name: 'Base', price: 520, probability: 50, timeframe: '12 months' },
  { id: 'c-bull', userId: 'u-analyst', name: 'Bull', price: 620, probability: 25, timeframe: '12 months' },
]

/**
 * The price below every case, by 22%.
 *
 * Past `gap >= 0.15`, so the builder calls it `critical` — again the shipping
 * rule, not a restatement of it. The quote is minutes old so the stale-quote
 * gate passes without the fixture needing a fake clock.
 */
export const dislocationCard = (over: { price?: number; cases?: typeof CASES } = {}): SignalCard => {
  const r = buildScenarioGapCard({
    assetId: 'a-amzn',
    symbol: 'AMZN',
    companyName: 'Amazon',
    price: over.price ?? 312,
    priceAsOf: new Date(NOW - 5 * 60_000).toISOString(),
    cases: over.cases ?? CASES,
    heldIn: [{ id: 'p-core', name: 'Core Equity', valueUsd: 4_100_000 }],
    statedAt: '2026-02-05T00:00:00.000Z',
  })
  if (!r.ok) throw new Error(`fixture suppressed: ${r.reason} — ${r.detail ?? ''}`)
  return r.card
}

/** Inside the range and within 3% of the expected value: the `at_expected` claim. */
export const atExpectedCard = (): SignalCard => dislocationCard({ price: 515 })

/** `rankInputFor`'s own `case 'scenario'` branch, transcribed. */
export const scenarioRankInput = (
  card: SignalCard,
  capital: { weightPct?: number | null } | null,
  coverage: PriorityInput['coverage'] = 'direct',
): PriorityInput => {
  const dev = Number(String(card.metric?.value ?? '').replace(/[^0-9.]/g, ''))
  return {
    id: card.id,
    type: 'scenario_gap',
    severity: card.severity,
    occurredAt: card.provenance.occurredAt,
    deviationPct: Number.isFinite(dev) ? dev : null,
    held: capital != null,
    weightPct: capital?.weightPct ?? null,
    coverage,
    judgment: null,
  }
}

/** A phone feed slot, as `MobileDashboard` seeds `feedContainer`. */
export const PHONE = { width: 390, height: 734 }

// ── No Core Thesis ───────────────────────────────────────────────────────────

/**
 * A `DerivedInsight` as `useDerivedInsights` emits one, with a real issue.
 *
 * The framing decides everything downstream — the card's pill, the capital
 * reframe, the ranking base — so the fixture takes it as an argument rather
 * than hard-coding the void case and leaving the partial one untested.
 */
export const thesisInsight = (over: Partial<DerivedInsight> = {}): DerivedInsight => {
  const framing = (over.issue?.framing ?? 'no_case') as 'no_case' | 'incomplete_case'
  const present = framing === 'no_case' ? [] : (['thesis'] as const)
  const missing = framing === 'no_case'
    ? (['thesis', 'where_different', 'risks_to_thesis'] as const)
    : (['where_different', 'risks_to_thesis'] as const)

  const issue = {
    framing,
    daysSinceReview: framing === 'no_case' ? null : 210,
    daysSinceWritten: framing === 'no_case' ? null : 210,
    anchoredOn: framing === 'no_case' ? null : ('written' as const),
    present: [...present],
    missing: [...missing],
    supporting: [],
    ...over.issue,
  } as DerivedInsight['issue']

  const base: DerivedInsight = {
    id: `research-${issue.framing}-a-amzn`,
    kind: 'no_thesis',
    headline: 'AMZN has no written investment case',
    body: 'Nothing has been written against this name.',
    prompt: 'Does this need a case?',
    assetId: 'a-amzn',
    symbol: 'AMZN',
    companyName: 'Amazon',
    portfolioName: 'Core Equity',
    portfolioId: 'p-core',
    weightPct: 3.4,
    held: true,
    portfolioCount: 1,
    liveIdeas: [],
    coverageOwners: [],
    evidenceCount: 0,
    issue,
    caseWrittenAt: framing === 'no_case' ? null : '2026-02-09T00:00:00.000Z',
    researchReviewAt: null,
    reviewAnchor: framing === 'no_case' ? null : '2026-02-09T00:00:00.000Z',
    anchoredOn: issue.anchoredOn,
    daysSinceReview: issue.daysSinceReview,
    daysSinceWritten: issue.daysSinceWritten,
    /** The producer's own within-type strength. See `researchBaseFor`. */
    score: researchBaseFor(issue) + Math.min(3.4 / 10, 1) * 0.1,
    ...over,
  }
  return { ...base, issue }
}

export const thesisCard = (over: Partial<DerivedInsight> = {}): SignalCard => {
  const r = buildInsightCard(thesisInsight(over), null)
  if (!r.ok) throw new Error(`fixture suppressed: ${r.reason} — ${r.detail ?? ''}`)
  return r.card
}

/** `rankInputFor`'s own `case 'insight'` branch, transcribed. */
export const insightRankInput = (
  i: DerivedInsight = thesisInsight(),
  coverage: PriorityInput['coverage'] = 'direct',
): PriorityInput => ({
  id: i.id,
  type: 'no_research',
  severity: 'attention',
  occurredAt: i.reviewAnchor ?? null,
  weightPct: i.weightPct ?? null,
  held: i.held,
  base: researchBaseFor(i.issue),
  deviationPct: null,
  coverage,
  judgment: null,
})
