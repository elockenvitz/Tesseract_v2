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

import { buildAttentionCard, buildInsightCard, buildStaleTargetCard, buildTargetHitCard } from '../../../signals/builders/legacy-kinds'
import { targetHitSeverity } from '../../../signals/lens-severity'
import { buildScenarioGapCard } from '../../../signals/builders/scenarioGap'
import { researchBaseFor } from '../../../research/case-state'
import { insightSignalType } from '../../../signals/insight-type'
import { attentionSignalType } from '../../../mobile/entry-signal-type'
import type { DerivedInsight } from '../../../../hooks/mobile/useDerivedInsights'
import type { SignalCard } from '../../../signals/contract'
import type { StaleTarget, TargetBreach } from '../../../../hooks/mobile/usePortfolioLenses'
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
export const dislocationCard = (
  over: {
    price?: number
    cases?: typeof CASES
    /** So a composition test can put this on the same name as another finding. */
    assetId?: string
    symbol?: string
    companyName?: string
  } = {},
): SignalCard => {
  const r = buildScenarioGapCard({
    assetId: over.assetId ?? 'a-amzn',
    symbol: over.symbol ?? 'AMZN',
    companyName: over.companyName ?? 'Amazon',
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
  /**
   * Derived, exactly as `rankInputFor` derives it.
   *
   * It was hard-coded `no_research` while only the thesis half was adopted, and
   * that is a tier apart from `research_stale` — 1 against 2. Transcribing the
   * branch rather than its outcome is what caught it.
   */
  type: insightSignalType(i.kind) as PriorityInput['type'],
  severity: 'attention',
  occurredAt: i.reviewAnchor ?? null,
  weightPct: i.weightPct ?? null,
  held: i.held,
  base: researchBaseFor(i.issue),
  deviationPct: null,
  coverage,
  judgment: null,
})

// ── Target Hit ───────────────────────────────────────────────────────────────

/**
 * A price 18% past a $520 base case.
 *
 * 18 sits between the card's own `critical` threshold (10%) and the ranker's
 * (15%), which is deliberate: the fixture has to exercise a band where the two
 * shipping rules could disagree, so a future unification is visible here rather
 * than only in production.
 */
export const targetBreachRow = (over: Partial<TargetBreach> = {}): TargetBreach => ({
  asOf: '2026-08-31T00:00:00.000Z',
  assetId: 'a-msft',
  symbol: 'MSFT',
  companyName: 'Microsoft',
  price: 613.6,
  target: 520,
  overshootPct: 0.18,
  caseName: 'Base',
  cases: [
    { id: 'c-bear', name: 'Bear', price: 400 },
    { id: 'c-base', name: 'Base', price: 520 },
    { id: 'c-bull', name: 'Bull', price: 620 },
  ],
  conviction: 'high',
  heldIn: ['Core Equity'],
  heldInIds: ['p-core'],
  statedAt: '2025-01-15T00:00:00.000Z',
  ...over,
})

export const targetHitCard = (over: Partial<TargetBreach> = {}): SignalCard => {
  const r = buildTargetHitCard(targetBreachRow(over))
  if (!r.ok) throw new Error(`fixture suppressed: ${r.reason} — ${r.detail ?? ''}`)
  return r.card
}

/** `rankInputFor`'s own `case 'breach'` branch, transcribed. */
export const targetHitRankInput = (
  b: TargetBreach = targetBreachRow(),
  coverage: PriorityInput['coverage'] = 'direct',
): PriorityInput => ({
  id: `breach-${b.assetId}`,
  type: 'target_hit',
  severity: targetHitSeverity(b.overshootPct),
  occurredAt: b.asOf,
  weightPct: null,
  held: true,
  deviationPct: Math.abs(b.overshootPct * 100),
  coverage,
  judgment: null,
})

// ── Unreviewed Move ──────────────────────────────────────────────────────────

/**
 * A `stale_research` insight in any of its three shipping framings.
 *
 * The framing decides the metric, the ranking base and the primary action, so
 * the fixture takes it as an argument rather than testing one state and
 * assuming the other two.
 */
export const staleInsight = (
  framing: 'price_move' | 'new_evidence' | 'long_silence' = 'price_move',
  over: Partial<DerivedInsight> = {},
): DerivedInsight => {
  const anchor = '2026-02-09T00:00:00.000Z'
  const daysSinceReview = 210

  const issue = {
    framing,
    daysSinceReview,
    daysSinceWritten: daysSinceReview,
    anchoredOn: 'written' as const,
    present: ['thesis', 'where_different', 'risks_to_thesis'],
    missing: [],
    supporting: [],
    ...(framing === 'price_move' ? { movePct: -30.5 } : {}),
    ...(framing === 'new_evidence'
      ? {
          evidence: [
            { id: 'e1', at: '2026-06-01T00:00:00.000Z', kind: 'note' as const, title: 'Q2 review' },
            { id: 'e2', at: '2026-07-14T00:00:00.000Z', kind: 'thought' as const },
            { id: 'e3', at: '2026-08-02T00:00:00.000Z', kind: 'note' as const, title: 'Channel checks' },
          ],
        }
      : {}),
  } as DerivedInsight['issue']

  const base: DerivedInsight = {
    id: `research-${framing}-a-nke`,
    kind: 'stale_research',
    headline: 'NKE has moved since the case was written',
    body: 'The written view has not accounted for it.',
    prompt: 'Has the view changed?',
    assetId: 'a-nke',
    symbol: 'NKE',
    companyName: 'Nike',
    portfolioName: 'Core Equity',
    portfolioId: 'p-core',
    weightPct: 2.6,
    held: true,
    portfolioCount: 1,
    liveIdeas: [],
    coverageOwners: [],
    evidenceCount: issue.evidence?.length ?? 0,
    issue,
    caseWrittenAt: anchor,
    researchReviewAt: null,
    reviewAnchor: anchor,
    anchoredOn: issue.anchoredOn,
    daysSinceReview,
    daysSinceWritten: daysSinceReview,
    score: researchBaseFor(issue) + Math.min(2.6 / 10, 1) * 0.1,
    ...over,
  }
  return { ...base, issue }
}

export const staleCard = (
  framing: 'price_move' | 'new_evidence' | 'long_silence' = 'price_move',
  over: Partial<DerivedInsight> = {},
): SignalCard => {
  const r = buildInsightCard(staleInsight(framing, over), null)
  if (!r.ok) throw new Error(`fixture suppressed: ${r.reason} — ${r.detail ?? ''}`)
  return r.card
}

// ── Coverage Gap ─────────────────────────────────────────────────────────────

/**
 * The row `collectNeglectedCoverage` emits, field for field.
 *
 * Transcribed from the collector rather than imagined, including the two things
 * that decide everything downstream: `reason_code` names the finding, and
 * `due_at` is null because nobody set a deadline — which is why the shipping
 * card has no metric at all.
 *
 * 47 days is past the collector's own 30-day `high` boundary, so the fixture
 * exercises the severity rule the adapter is forbidden from restating.
 */
export const COVERAGE_LAST_LOOK = '2026-07-22T00:00:00.000Z'
export const COVERAGE_NOW = Date.parse('2026-09-07T00:00:00.000Z')

export const coverageRow = (over: Record<string, unknown> = {}) => ({
  attention_id: 'att-coverage-a-amzn',
  source_type: 'coverage_change',
  source_id: 'a-amzn',
  source_url: '/asset/a-amzn',
  attention_type: 'action_required' as const,
  reason_code: 'coverage_neglected',
  reason_text: 'No research update in 47 days — thesis may be stale',
  title: 'AMZN — Research stale',
  subtitle: 'Amazon.com',
  tags: ['coverage', 'stale'],
  icon_key: 'TrendingUp',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: COVERAGE_LAST_LOOK,
  last_activity_at: COVERAGE_LAST_LOOK,
  due_at: null,
  status: 'stale',
  next_action: 'Update thesis, rating, or research for this covered name',
  severity: 'high',
  score: 0,
  context: { asset_id: 'a-amzn' },
  ...over,
})

export const COVERAGE_ASSET = { id: 'a-amzn', symbol: 'AMZN', companyName: 'Amazon.com' }

export const coverageCard = (over: Record<string, unknown> = {}): SignalCard => {
  // The fixture pins its own clock, so the elapsed-silence metric is the
  // same number every day the suite runs.
  const r = buildAttentionCard(coverageRow(over) as never, COVERAGE_ASSET, undefined, COVERAGE_NOW)
  if (!r.ok) throw new Error(`fixture suppressed: ${r.reason} — ${r.detail ?? ''}`)
  return r.card
}

/**
 * `rankInputFor`'s own `case 'attention'` branch, transcribed.
 *
 * `severity` is `informational` and that is not a typo. The branch reads
 * `a.priority`, and `AttentionItem` has no such field — it carries `severity`.
 * So every attention item in the product ranks informational today. Recorded
 * here because a fixture that quietly "fixed" it would claim a parity the feed
 * does not have. See the coverage suite, which reports it.
 */
export const attentionRankInput = (
  row: ReturnType<typeof coverageRow> = coverageRow(),
  coverage: PriorityInput['coverage'] = 'direct',
): PriorityInput => ({
  id: String(row.attention_id),
  type: attentionSignalType(row) as PriorityInput['type'],
  severity: 'informational',
  occurredAt: row.created_at ?? null,
  weightPct: null,
  held: !!row.context?.asset_id,
  deviationPct: null,
  overdueDays: row.due_at
    ? Math.floor((Date.now() - new Date(row.due_at as string).getTime()) / 86_400_000)
    : null,
  coverage,
  judgment: null,
})
