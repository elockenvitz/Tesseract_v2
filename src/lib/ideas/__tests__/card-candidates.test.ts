import { describe, expect, it } from 'vitest'
import {
  cardDispositionRef, cardPriorityInput, emittedCards, lensDispositionRef,
  lensPriorityInput, toPortfolioLenses, type PortfolioLens,
} from '../card-candidates'
import { rankMixedCandidates } from '../idea-priority'
import { LEAD_TIER, priorityFor } from '../../signals/feed-priority'
import { dispositionKey, type DispositionMap } from '../../signals/dispositions'
import { TRIAGE_JUDGMENT } from '../../signals/feed-triage'
import { DAY_MS } from '../../signals/thresholds'
import type { CoverageIndex } from '../../signals/coverage-relevance'
import type { SignalCard } from '../../signals/contract'

const NOW = Date.UTC(2026, 7, 28, 12)
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString()

const NVDA = 'aaaaaaa1-0000-4000-8000-000000000000'
const AVGO = 'aaaaaaa2-0000-4000-8000-000000000000'
const JPM = 'aaaaaaa3-0000-4000-8000-000000000000'

const INDEX: CoverageIndex = {
  ready: true, direct: new Set([NVDA]), assigned: new Set(), held: new Set([AVGO]),
}
const CTX = { userId: 'me', followedIds: [] as string[], coverageIndex: INDEX }

const scenarioCard = (over: Partial<SignalCard> = {}): SignalCard => ({
  id: 'scenario_gap:nvda',
  type: 'scenario_gap',
  surface: 'research',
  severity: 'critical',
  headline: 'NVDA is trading 14% below your bear case',
  body: 'Either the case is wrong or the position is.',
  metric: { value: '14% below', label: 'vs bear case', direction: 'bad', source: 'quote', asOf: ago(0.2) },
  entity: { kind: 'asset', id: NVDA, name: 'NVIDIA', ticker: 'NVDA' },
  context: [{ label: 'Portfolio', value: 'Global Equity' }],
  ...over,
} as any)

const post = (over: Record<string, any> = {}) => ({
  id: 'p1', type: 'quick_thought', created_at: ago(0.1),
  content: 'A view.', author: { id: 'someone' }, ...over,
})

const ids = (rows: any[]) => rows.map(r => String(r.input.id))

// ── 1–3. scenario findings ─────────────────────────────────────────────────

describe('scenario ladders become canonical candidates', () => {
  it('[1] enters the candidate set as its canonical type', () => {
    const rows = rankMixedCandidates({ posts: [post()], cards: [scenarioCard()] }, CTX, NOW)
    expect(ids(rows)).toContain('scenario_gap:nvda')
    expect(rows.find(r => r.input.id === 'scenario_gap:nvda')!.input.type).toBe('scenario_gap')
  })

  it('[2] a real scenario gap reaches Attention', () => {
    const p = priorityFor(cardPriorityInput(scenarioCard(), { coverageIndex: INDEX }), NOW)
    expect(p.tier).toBeLessThanOrEqual(LEAD_TIER)
  })

  it('[1b] it leads a fresh post, because tier sorts before score', () => {
    const rows = rankMixedCandidates(
      { posts: [post({ id: 'fresh', created_at: ago(0.001) })], cards: [scenarioCard()] },
      CTX, NOW,
    )
    expect(ids(rows)[0]).toBe('scenario_gap:nvda')
  })

  /**
   * [3] The claim that keeps Attention honest. A card whose canonical type is
   * NOT lead-tier stays out of the band however it was produced — the rule
   * reads `tier`, and `crowding` is tier 2 whether it arrives from a lens, a
   * builder or anywhere else.
   */
  it('[3] a weak finding does not reach Attention just for being a card', () => {
    const weak = scenarioCard({
      id: 'crowding:jpm', type: 'crowding', severity: 'informational',
      entity: { kind: 'asset', id: JPM, name: 'JPM', ticker: 'JPM' },
      metric: { value: '3.2%', label: 'max weight', direction: 'neutral', source: 'holdings', asOf: ago(1) },
    } as any)
    const p = priorityFor(cardPriorityInput(weak, { coverageIndex: INDEX }), NOW)
    expect(p.tier).toBeGreaterThan(LEAD_TIER)
  })

  it('reads the deviation back from the card rather than recomputing it', () => {
    const input = cardPriorityInput(scenarioCard(), {})
    expect(input.deviationPct).toBe(14)
  })

  /**
   * The defect this test was written to catch. `buildScenarioGapCard` writes
   * "$820" for a price at expected value — the most benign state it emits — and
   * reading any number out of the metric turned that into a deviation of 820,
   * so the calmest card would have scored like the most broken one.
   */
  it('reads a deviation only from a metric expressed as one', () => {
    const atExpected = scenarioCard({
      severity: 'informational',
      metric: { value: '$820', label: 'Probability-weighted', direction: 'neutral', source: 'quote', asOf: ago(1) },
    } as any)
    expect(cardPriorityInput(atExpected, {}).deviationPct).toBeNull()

    // A missing metric is neutral too, never a confident zero.
    expect(cardPriorityInput({ ...scenarioCard(), metric: undefined } as any, {}).deviationPct).toBeNull()
  })

  it('takes its event time from the quote the claim rests on', () => {
    expect(cardPriorityInput(scenarioCard(), {}).occurredAt).toBe(ago(0.2))
  })

  it('only ranks builder results that actually emitted a card', () => {
    const results = [
      { ok: true, card: scenarioCard() },
      { ok: false, reason: 'quote_unavailable', entity: 'LLY' },
    ]
    expect(emittedCards(results)).toHaveLength(1)
    expect(emittedCards(null)).toEqual([])
  })
})

// ── 4–5. portfolio lenses ──────────────────────────────────────────────────

describe('portfolio lenses become canonical candidates', () => {
  const lenses: PortfolioLens[] = [
    { type: 'breach', breach: { assetId: NVDA, overshootPct: 0.22, asOf: ago(0.5) } },
    { type: 'stale', target: { assetId: AVGO, overdueMonths: 8, expiredAt: ago(240) } },
    { type: 'untargeted', position: { assetId: JPM, weightPct: 6.4, asOf: ago(1) } },
    { type: 'conviction', gap: { assetId: AVGO, direction: 'overweight', weightPct: 4.1, tension: 0.35, asOf: ago(2) } },
    { type: 'crowded', name: { assetId: JPM, maxWeightPct: 3.2, asOf: ago(3) } },
  ]

  it('[4] maps each lens onto the canonical type the TIER table already has', () => {
    const types = lenses.map(l => lensPriorityInput(l, {}).type)
    expect(types).toEqual([
      'target_hit', 'target_expired', 'no_target', 'conviction_oversized', 'crowding',
    ])
  })

  /**
   * Four of the five are lead-tier. That is the finding the migration was
   * chasing: the cockpit's Attention band had one producer, and the portfolio
   * lens set alone supplies four more.
   */
  it('[4b] supplies Attention from four of its five lenses', () => {
    const tiers = lenses.map(l => priorityFor(lensPriorityInput(l, {}), NOW).tier)
    expect(tiers.filter(t => t <= LEAD_TIER)).toHaveLength(4)
    // …and `crowding` is the one that stays out, as an observation should.
    expect(tiers[4]).toBeGreaterThan(LEAD_TIER)
  })

  /**
   * [5] The lens buckets carry positional scores on mobile (60, 58, 55, 40, 38).
   * None of them reaches the ranker: priority comes from canonical fields only.
   */
  it('[5] priority comes from canonical fields, not the old bucket order', () => {
    const breach = lensPriorityInput(lenses[0], {})
    expect(breach.severity).toBe('critical')     // 22% overshoot >= 15%
    expect(breach.deviationPct).toBeCloseTo(22, 5)
    expect(breach.weightPct).toBeNull()          // TargetBreach carries no weight
    expect(breach.held).toBe(true)

    const untargeted = lensPriorityInput(lenses[2], {})
    expect(untargeted.severity).toBe('critical') // 6.4% >= 5%
    expect(untargeted.weightPct).toBe(6.4)
    expect(untargeted.deviationPct).toBeNull()
  })

  it('carries the two lossy conversions over unchanged', () => {
    expect(lensPriorityInput(lenses[1], {}).deviationPct).toBe(40)   // 8 months x 5
    expect(lensPriorityInput(lenses[3], {}).deviationPct).toBeCloseTo(35, 5) // tension x100
  })

  it('flattens the five buckets without losing one', () => {
    const flat = toPortfolioLenses({
      breaches: [{ assetId: NVDA }], stale: [{ assetId: AVGO }],
      untargeted: [{ assetId: JPM }], conviction: [{ assetId: NVDA }],
      crowded: [{ assetId: AVGO }],
    })
    expect(flat.map(l => l.type)).toEqual(['breach', 'stale', 'untargeted', 'conviction', 'crowded'])
    expect(toPortfolioLenses(null)).toEqual([])
  })
})

// ── 6–8. one order, one scope model, one suppression rule ──────────────────

describe('everything shares one ordered stream', () => {
  it('[6] posts, signals, cards and lenses come back in one canonical order', () => {
    const rows = rankMixedCandidates({
      posts: [post({ id: 'p-a' })],
      signals: [{
        id: 'signal-conflict-nvda', signalType: 'conflict', headline: 'split', body: 'x',
        relatedAssets: [{ id: NVDA, symbol: 'NVDA' }], createdAt: ago(0), priority: 0.8,
      } as any],
      cards: [scenarioCard()],
      lenses: [{ type: 'crowded', name: { assetId: JPM, maxWeightPct: 3.2, asOf: ago(3) } }],
    }, CTX, NOW)

    const tiers = rows.map(r => r.priority.tier)
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers)
    expect(rows).toHaveLength(4)
    // The scenario ladder leads: tier 0, base 1.00, the top of the table.
    expect(ids(rows)[0]).toBe('scenario_gap:nvda')
  })

  it('[7] scope relevance applies to cards and lenses', () => {
    const scoped = priorityFor(cardPriorityInput(scenarioCard(), { coverageIndex: INDEX }), NOW)
    expect(scoped.scope.kind).toBe('personal_scope')
    expect(scoped.reasons.find(r => r.code === 'in_my_scope')).toBeTruthy()

    const held = priorityFor(
      lensPriorityInput({ type: 'crowded', name: { assetId: AVGO, maxWeightPct: 3 } }, { coverageIndex: INDEX }),
      NOW,
    )
    expect(held.scope.kind).toBe('held')
  })

  it('[8] suppression still wins over a tier-0 scenario gap', () => {
    const dismissed: DispositionMap = {
      [dispositionKey('scenario_gap', NVDA)]: {
        kind: 'settled', key: TRIAGE_JUDGMENT.dismiss.key, verdict: TRIAGE_JUDGMENT.dismiss.key,
        at: NOW, until: NOW + 30 * DAY_MS,
      },
    }
    const rows = rankMixedCandidates(
      { posts: [post({ id: 'kept' })], cards: [scenarioCard()] },
      { ...CTX, dispositions: dismissed }, NOW,
    )
    expect(ids(rows)).toEqual(['kept'])
  })

  /**
   * [9] The duplication guard. The same finding arriving from two sources —
   * a scenario ladder that is also emitted as a generated signal, say — is
   * ranked and rendered once.
   */
  it('[9] the same finding is never ranked twice', () => {
    const rows = rankMixedCandidates(
      { cards: [scenarioCard(), scenarioCard()] }, CTX, NOW,
    )
    expect(rows).toHaveLength(1)
  })
})

// ── identity ───────────────────────────────────────────────────────────────

describe('disposition identity is stable and type-specific', () => {
  it('keys a scenario card on its asset, through the shared rule', () => {
    expect(cardDispositionRef(scenarioCard())).toEqual({ type: 'scenario_gap', entityId: NVDA })
  })

  /**
   * Distinct per lens type, deliberately. Dismissing "this position has no
   * price target" must not also silence "the price has passed the target it
   * does not have" — which is why `dispositionKey` takes a type at all.
   */
  it('keys each lens on its own type, not on the asset alone', () => {
    const a = lensDispositionRef({ type: 'untargeted', position: { assetId: NVDA, weightPct: 6 } })
    const b = lensDispositionRef({ type: 'breach', breach: { assetId: NVDA, overshootPct: 0.2 } })
    expect(a).toEqual({ type: 'no_target', entityId: NVDA })
    expect(b).toEqual({ type: 'target_hit', entityId: NVDA })
    expect(dispositionKey(a.type, a.entityId)).not.toBe(dispositionKey(b.type, b.entityId))
  })

  it('gives an overweight and an underweight gap different identities', () => {
    const over = lensDispositionRef({ type: 'conviction', gap: { assetId: NVDA, direction: 'overweight', weightPct: 4, tension: 0.3 } })
    const under = lensDispositionRef({ type: 'conviction', gap: { assetId: NVDA, direction: 'underweight', weightPct: 4, tension: 0.3 } })
    expect(over.type).toBe('conviction_oversized')
    expect(under.type).toBe('conviction_undersized')
  })
})

// ── 10–12. both shells, and determinism ────────────────────────────────────

describe('[10][11] the two shells read the same normalization', () => {
  /**
   * The extraction claim, asserted rather than intended.
   *
   * `MobileDashboard.rankInputFor` used to hold these mappings inline; it now
   * calls the same functions. A source guard is the only way to keep it that
   * way — a copy pasted back in would pass every behavioural test here.
   */
  it('mobile composes card and lens inputs through the shared module', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(process.cwd(), 'src/components/mobile/MobileDashboard.tsx'), 'utf8')

    expect(src).toContain('cardPriorityInput')
    expect(src).toContain('lensPriorityInput')
    // And holds no inline copy of the mappings it used to own.
    expect(src).not.toMatch(/type: 'target_hit'/)
    expect(src).not.toMatch(/type: 'conviction_oversized'/)
    expect(src).not.toMatch(/overdueMonths \* 5/)
  })

  it('desktop composes them through the same module', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(process.cwd(), 'src/components/ideas/feed/IdeasFeedPage.tsx'), 'utf8')
    expect(src).toContain('rankMixedCandidates')
    expect(src).toContain('useScenarioCards')
    expect(src).toContain('usePortfolioLenses')
  })
})

describe('[12] ranking stays deterministic', () => {
  it('produces the same order on repeated runs', () => {
    const sources = {
      posts: [post({ id: 'a' }), post({ id: 'b' })],
      cards: [scenarioCard()],
      lenses: [
        { type: 'crowded', name: { assetId: JPM, maxWeightPct: 3.2, asOf: ago(3) } },
        { type: 'untargeted', position: { assetId: AVGO, weightPct: 6.4, asOf: ago(1) } },
      ] as PortfolioLens[],
    }
    const first = ids(rankMixedCandidates(sources, CTX, NOW))
    const second = ids(rankMixedCandidates(sources, CTX, NOW))
    expect(second).toEqual(first)
  })

  it('is independent of the order sources are supplied in', () => {
    const cards = [scenarioCard()]
    const lenses: PortfolioLens[] = [{ type: 'crowded', name: { assetId: JPM, maxWeightPct: 3.2 } }]
    const a = ids(rankMixedCandidates({ posts: [post()], cards, lenses }, CTX, NOW))
    const b = ids(rankMixedCandidates({ lenses, cards, posts: [post()] }, CTX, NOW))
    expect(b).toEqual(a)
  })
})
