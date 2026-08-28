import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  coverageExplanationFor,
  coverageRelevanceFor,
  coverageSignature,
  coverageWeightFor,
  desktopAssetRelevanceFor,
  EMPTY_COVERAGE_INDEX,
  hasAnyCoverage,
  type CoverageIndex,
  type CoverageRelevance,
} from '../coverage-relevance'
import { diversify, priorityFor, rankFeed, type PriorityInput } from '../feed-priority'

const NVDA = '11111111-1111-4111-8111-111111111111'
const MSFT = '22222222-2222-4222-8222-222222222222'
const HELD = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'

const index = (over: Partial<CoverageIndex> = {}): CoverageIndex => ({
  ready: true,
  direct: new Set(),
  assigned: new Set(),
  held: new Set(),
  ...over,
})

// ── what coverage means ─────────────────────────────────────────────────────

describe('coverageRelevanceFor — the four states', () => {
  it('[1] personal coverage marks the asset directly relevant', () => {
    expect(coverageRelevanceFor(index({ direct: new Set([NVDA]) }), NVDA)).toBe('direct')
  })

  it('[2] org-assigned coverage for this user marks it relevant too', () => {
    expect(coverageRelevanceFor(index({ assigned: new Set([NVDA]) }), NVDA)).toBe('assigned')
  })

  /**
   * [3] The index is built from `user_id = auth.uid()`, so a colleague's
   * coverage never enters it. This pins the consequence: an asset somebody
   * ELSE covers is simply not in any band, and for a reader who covers things
   * that reads as `none`.
   */
  it('[3] another analyst’s coverage does not make an asset relevant', () => {
    const mine = index({ direct: new Set([NVDA]) })
    expect(coverageRelevanceFor(mine, OTHER)).toBe('none')
  })

  /**
   * [4] Holdings are offered as suggestions by CoverageQuickStart and are a
   * weaker ranking band, but they are never coverage. A position is a fact
   * about a portfolio; coverage is a claim about attention.
   */
  it('[4] a held asset is `held`, never `direct` or `assigned`', () => {
    const i = index({ direct: new Set([NVDA]), held: new Set([HELD]) })
    expect(coverageRelevanceFor(i, HELD)).toBe('held')
  })

  it('prefers the reader’s own claim when a name is both declared and assigned', () => {
    const i = index({ direct: new Set([NVDA]), assigned: new Set([NVDA]) })
    expect(coverageRelevanceFor(i, NVDA)).toBe('direct')
  })
})

describe('coverageRelevanceFor — the three refusals', () => {
  /**
   * [9a] The refusal that protects every existing user. A reader who has
   * declared nothing must see the feed they saw yesterday, not one where every
   * card carries a penalty for a question nobody answered.
   */
  it('declines to answer for a reader with no coverage at all', () => {
    expect(coverageRelevanceFor(index({ held: new Set([HELD]) }), OTHER)).toBe('unknown')
  })

  it('still reports `held` for that reader, since holdings are known', () => {
    expect(coverageRelevanceFor(index({ held: new Set([HELD]) }), HELD)).toBe('held')
  })

  it.each([
    ['a ticker', 'AAPL'],
    ['a synthetic id', 'signal-cluster-x'],
    ['an empty string', ''],
    ['null', null],
  ])('declines to answer for %s', (_label, id) => {
    expect(coverageRelevanceFor(index({ direct: new Set([NVDA]) }), id)).toBe('unknown')
  })

  /** [9b] Fails safe, not closed: a pending or failed query is neutral. */
  it('declines to answer while coverage has not resolved', () => {
    expect(coverageRelevanceFor(EMPTY_COVERAGE_INDEX, NVDA)).toBe('unknown')
    expect(coverageRelevanceFor(index({ ready: false, direct: new Set([NVDA]) }), NVDA)).toBe('unknown')
  })

  it('hasAnyCoverage ignores holdings', () => {
    expect(hasAnyCoverage(index({ held: new Set([HELD]) }))).toBe(false)
    expect(hasAnyCoverage(index({ direct: new Set([NVDA]) }))).toBe(true)
    expect(hasAnyCoverage(index({ assigned: new Set([NVDA]) }))).toBe(true)
  })
})

// ── how it scores ───────────────────────────────────────────────────────────

describe('the weights preserve the existing span', () => {
  it('grades within [0,1] and never penalises the unknown', () => {
    expect(coverageWeightFor('direct')).toBe(1)
    expect(coverageWeightFor('assigned')).toBe(1)
    expect(coverageWeightFor('held')).toBe(0.6)
    expect(coverageWeightFor('none')).toBe(0)
    expect(coverageWeightFor('unknown')).toBe(1)
  })

  /** Desktop's two original numbers are preserved exactly. */
  it('keeps the desktop scale unchanged for held and not-relevant', () => {
    expect(desktopAssetRelevanceFor('held')).toBe(0.9)
    expect(desktopAssetRelevanceFor('none')).toBe(0.3)
    expect(desktopAssetRelevanceFor('unknown')).toBe(0.3)
    expect(desktopAssetRelevanceFor('direct')).toBe(1)
  })
})

// ── how it lands in the priority model ──────────────────────────────────────

const card = (over: Partial<PriorityInput> = {}): PriorityInput => ({
  id: 'c1', type: 'research_stale', severity: 'attention',
  occurredAt: new Date('2026-08-01').toISOString(), ...over,
})
const NOW = new Date('2026-08-10').getTime()

describe('priority behaviour', () => {
  /** [5] A covered signal gets a real, bounded benefit. */
  it('[5] ranks a covered signal above the identical uncovered one', () => {
    const covered = priorityFor(card({ coverage: 'direct' }), NOW)
    const not = priorityFor(card({ coverage: 'none' }), NOW)
    expect(covered.total).toBeGreaterThan(not.total)
    expect(covered.components.ownership).toBeGreaterThan(not.components.ownership)
  })

  it('places held between covered and not relevant', () => {
    const held = priorityFor(card({ coverage: 'held' }), NOW).total
    expect(held).toBeLessThan(priorityFor(card({ coverage: 'direct' }), NOW).total)
    expect(held).toBeGreaterThan(priorityFor(card({ coverage: 'none' }), NOW).total)
  })

  /**
   * [6] The guarantee that matters. `compareRanked` sorts by tier before
   * score, and coverage only moves the score — so a price that has left its
   * framework outranks a covered stale-research card no matter what.
   */
  it('[6] an urgent uncovered signal still outranks a weak covered one', () => {
    const urgentUncovered = priorityFor(
      card({ id: 'urgent', type: 'scenario_gap', severity: 'critical', coverage: 'none' }), NOW)
    const weakCovered = priorityFor(
      card({ id: 'weak', type: 'research_stale', severity: 'informational', coverage: 'direct' }), NOW)

    expect(urgentUncovered.tier).toBeLessThan(weakCovered.tier)
    expect(urgentUncovered.total).toBeGreaterThan(weakCovered.total)
  })

  it('cannot lift a covered card out of its tier', () => {
    const t2 = priorityFor(card({ type: 'research_stale', coverage: 'direct' }), NOW)
    const t0 = priorityFor(card({ type: 'scenario_gap', coverage: 'none' }), NOW)
    expect(t2.tier).toBe(2)
    expect(t0.tier).toBe(0)
  })

  /** [9c] A reader with no coverage sees an unchanged feed. */
  it('[9] scores identically for every card when coverage is unknown', () => {
    const a = priorityFor(card({ id: 'a', coverage: 'unknown' }), NOW)
    const b = priorityFor(card({ id: 'b' }), NOW) // field absent entirely
    expect(a.components.ownership).toBe(b.components.ownership)
  })

  /** The legacy boolean keeps working, so no existing caller changed meaning. */
  it('honours the deprecated `owned` boolean', () => {
    expect(priorityFor(card({ owned: false }), NOW).components.ownership)
      .toBe(priorityFor(card({ coverage: 'none' }), NOW).components.ownership)
    expect(priorityFor(card({ owned: true }), NOW).components.ownership)
      .toBe(priorityFor(card({ coverage: 'direct' }), NOW).components.ownership)
    expect(priorityFor(card({}), NOW).components.ownership)
      .toBe(priorityFor(card({ coverage: 'unknown' }), NOW).components.ownership)
  })

  it('lets `coverage` win when both are supplied', () => {
    const p = priorityFor(card({ owned: false, coverage: 'direct' }), NOW)
    expect(p.components.ownership).toBe(priorityFor(card({ coverage: 'direct' }), NOW).components.ownership)
  })

  /**
   * [7] Suppression is decided before any of this. A judged card is dropped
   * whether or not the reader covers the name — coverage must never resurrect
   * something the reader has already answered.
   */
  it('[7] judgment suppression still wins over coverage', () => {
    const judged = priorityFor(card({
      type: 'no_target',
      coverage: 'direct',
      judgment: { key: 'not_price_driven', kind: 'settled', at: NOW - 1000 },
    }), NOW)
    expect(judged.suppressed).toBe(true)
  })

  /**
   * The other half of that rule, and the reason the first assertion had to name
   * `no_target`: `not_price_driven` is scoped to `no_target`, so it says
   * nothing about a scenario gap on the same name. Coverage does not change
   * that scoping either way.
   */
  it('[7b] an out-of-scope judgment suppresses nothing, covered or not', () => {
    for (const coverage of ['direct', 'none'] as const) {
      const p = priorityFor(card({
        type: 'scenario_gap',
        coverage,
        judgment: { key: 'not_price_driven', kind: 'settled', at: NOW - 1000 },
      }), NOW)
      expect(p.suppressed).toBe(false)
    }
  })
})

// ── explanation ─────────────────────────────────────────────────────────────

describe('coverageExplanationFor', () => {
  it('explains a declared name by name', () => {
    expect(coverageExplanationFor(index({ direct: new Set([NVDA]) }), NVDA, 'NVDA'))
      .toEqual({ relevance: 'direct', label: 'Because you follow NVDA' })
  })

  it('distinguishes an assignment from a declaration', () => {
    expect(coverageExplanationFor(index({ assigned: new Set([NVDA]) }), NVDA, 'NVDA').label)
      .toBe('You cover NVDA')
  })

  /** No label on most of the feed — a badge on every card is a badge nobody reads. */
  it.each([
    ['held', index({ held: new Set([HELD]) }), HELD],
    ['none', index({ direct: new Set([NVDA]) }), OTHER],
    ['unknown', EMPTY_COVERAGE_INDEX, NVDA],
  ])('says nothing for %s', (_label, i, id) => {
    expect(coverageExplanationFor(i as CoverageIndex, id).label).toBeNull()
  })
})

// ── cache invalidation ──────────────────────────────────────────────────────

describe('[10] coverageSignature — changing coverage recomputes ranking', () => {
  it('changes when a name is added', () => {
    const before = coverageSignature(index({ direct: new Set([NVDA]) }))
    const after = coverageSignature(index({ direct: new Set([NVDA, MSFT]) }))
    expect(after).not.toBe(before)
  })

  it('changes when a name is removed', () => {
    const before = coverageSignature(index({ direct: new Set([NVDA, MSFT]) }))
    const after = coverageSignature(index({ direct: new Set([NVDA]) }))
    expect(after).not.toBe(before)
  })

  it('changes when a name moves between lanes', () => {
    const declared = coverageSignature(index({ direct: new Set([NVDA]) }))
    const assigned = coverageSignature(index({ assigned: new Set([NVDA]) }))
    expect(assigned).not.toBe(declared)
  })

  it('is stable for the same membership regardless of insertion order', () => {
    expect(coverageSignature(index({ direct: new Set([NVDA, MSFT]) })))
      .toBe(coverageSignature(index({ direct: new Set([MSFT, NVDA]) })))
  })

  it('marks a pending index distinctly, so nothing caches against it', () => {
    expect(coverageSignature(EMPTY_COVERAGE_INDEX)).toBe('pending')
  })
})

// ── one definition, both shells ─────────────────────────────────────────────

/**
 * [11] The architectural guarantee: mobile and desktop consume the SAME
 * coverage input.
 *
 * The two ranking ALGORITHMS are still different — mobile runs
 * `rankFeed`/`priorityFor`, desktop runs `scoreFeedItem`, and reconciling them
 * is tracked in docs/tickets/ideas-ranking-divergence.md. What must not diverge
 * is the answer to "does this reader cover this name", because two shells that
 * disagree about that is a bug the user can see: the same name, ranked high on
 * the phone and buried on the laptop.
 *
 * These tests hold that seam shut from both ends — behaviourally, that the two
 * scales are driven by one relevance value and agree on its ordering; and
 * structurally, that neither consumer has grown a second coverage query.
 */
describe('[11] mobile and desktop share one coverage definition', () => {
  const shared = index({
    direct: new Set([NVDA]),
    assigned: new Set([MSFT]),
    held: new Set([HELD]),
  })

  it('drives both scales from the same relevance value', () => {
    for (const assetId of [NVDA, MSFT, HELD, OTHER, 'AAPL', null]) {
      const relevance = coverageRelevanceFor(shared, assetId)
      // Mobile's input and desktop's input are two projections of one fact.
      expect(coverageWeightFor(relevance)).toBe(coverageWeightFor(coverageRelevanceFor(shared, assetId)))
      expect(desktopAssetRelevanceFor(relevance))
        .toBe(desktopAssetRelevanceFor(coverageRelevanceFor(shared, assetId)))
    }
  })

  /**
   * The property that actually matters to a reader carrying two devices: both
   * shells must order the coverage bands the same way. The magnitudes differ —
   * mobile grades a 0.06 span, desktop a 0.2 one — but the ranking they imply
   * cannot invert.
   */
  it('orders the bands identically on both scales', () => {
    const bands: CoverageRelevance[] = ['direct', 'assigned', 'held', 'none']
    for (let i = 0; i < bands.length - 1; i++) {
      const [higher, lower] = [bands[i], bands[i + 1]]
      expect(coverageWeightFor(higher)).toBeGreaterThanOrEqual(coverageWeightFor(lower))
      expect(desktopAssetRelevanceFor(higher)).toBeGreaterThanOrEqual(desktopAssetRelevanceFor(lower))
    }
    // …and both must rank a covered name strictly above an uncovered one,
    // or "we used your coverage" is not true on that shell.
    expect(coverageWeightFor('direct')).toBeGreaterThan(coverageWeightFor('none'))
    expect(desktopAssetRelevanceFor('direct')).toBeGreaterThan(desktopAssetRelevanceFor('none'))
  })

  /**
   * A source guard, not a behaviour test. It fails the moment someone answers
   * "the phone should weight coverage differently" by querying `coverage`
   * inside a shell instead of changing this module — which is exactly how the
   * two ranking systems diverged in the first place.
   */
  const CONSUMERS = {
    mobile: 'src/components/mobile/MobileDashboard.tsx',
    desktop: 'src/hooks/ideas/useIdeasFeed.ts',
  }

  for (const [shell, file] of Object.entries(CONSUMERS)) {
    it(`${shell} reads coverage only through the shared hook`, () => {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(src).toContain('useCoverageIndex')
      expect(src).toContain('coverageRelevanceFor')
      // No shell-local coverage query, and no shell-local idea of the bands.
      expect(src).not.toMatch(/from\(['"]coverage['"]\)/)
      expect(src).not.toMatch(/coverage_scope/)
    })
  }
})

// ── coverage must not defeat the protections above it ───────────────────────

/**
 * [8] Diversity still binds when the reader has coverage.
 *
 * The failure this guards against is specific: a reader declares four names,
 * every card about those names takes the ownership benefit at once, and the
 * feed opens with six cards of one type — a "personalised" feed that is really
 * just a filter, which the brief ruled out ("do NOT make the feed become only
 * covered names").
 *
 * The rule asserted is the one `diversify` actually makes, and the one
 * feed-diversity.test.ts states: no type may dominate the OPENING. A cap over
 * the whole feed would be a stronger claim than the design makes — once the
 * competitive alternatives are spent, a run is priority working rather than
 * diversity failing.
 */
describe('[8] diversity survives coverage', () => {
  const stale = (i: number, coverage: CoverageRelevance): PriorityInput => ({
    id: `nt${i}`, type: 'no_target', severity: 'attention',
    occurredAt: new Date('2026-08-01').toISOString(),
    weightPct: 6 - i * 0.4, held: true, coverage,
  })
  const others: PriorityInput[] = [
    { id: 'rs1', type: 'research_stale', severity: 'attention', occurredAt: new Date('2026-08-01').toISOString(), weightPct: 6, held: true, deviationPct: 17, coverage: 'none' },
    { id: 'rs2', type: 'research_stale', severity: 'attention', occurredAt: new Date('2026-08-01').toISOString(), weightPct: 4, held: true, coverage: 'none' },
    { id: 'ca1', type: 'catalyst_ahead', severity: 'attention', occurredAt: new Date('2026-08-01').toISOString(), weightPct: 5, held: true, coverage: 'none' },
    { id: 'ca2', type: 'catalyst_ahead', severity: 'attention', occurredAt: new Date('2026-08-01').toISOString(), weightPct: 3, held: true, coverage: 'none' },
  ]

  /** Every no-target card is on a name the reader just declared. */
  const COVERED_FEED = [...Array.from({ length: 8 }, (_, i) => stale(i, 'direct')), ...others]

  const types = (inputs: PriorityInput[], enabled = true) =>
    diversify(rankFeed(inputs, i => i, NOW), { enabled }).map(r => r.item.type)

  const longestRun = (xs: string[]) => {
    let best = 0, cur = 0, prev: string | null = null
    for (const x of xs) { cur = x === prev ? cur + 1 : 1; prev = x; best = Math.max(best, cur) }
    return best
  }

  it('breaks up a run of covered cards in the opening', () => {
    // Ranking alone stacks them, exactly as it would without coverage…
    expect(longestRun(types(COVERED_FEED, false).slice(0, 6))).toBeGreaterThanOrEqual(4)
    // …and diversity still breaks the stack.
    expect(longestRun(types(COVERED_FEED).slice(0, 6))).toBeLessThanOrEqual(2)
  })

  /**
   * The other half: an uncovered feed and a covered one must diversify the
   * same. If coverage widened the score gaps past `DIVERSITY_TOLERANCE`, the
   * rule would quietly stop binding — a regression no assertion about a covered
   * feed alone would catch.
   */
  it('diversifies a covered feed no worse than the same feed uncovered', () => {
    const uncoveredFeed = [...Array.from({ length: 8 }, (_, i) => stale(i, 'none')), ...others]
    expect(longestRun(types(COVERED_FEED).slice(0, 6)))
      .toBeLessThanOrEqual(longestRun(types(uncoveredFeed).slice(0, 6)))
  })

  /** And nothing is dropped: diversity reorders, coverage does not filter. */
  it('keeps uncovered cards in the feed', () => {
    const out = diversify(rankFeed(COVERED_FEED, i => i, NOW))
    expect(out).toHaveLength(COVERED_FEED.length)
    expect(out.some(r => r.item.coverage === 'none')).toBe(true)
  })
})

// ── the lift is big enough to notice, small enough to be safe ───────────────

/**
 * [12] The measurement that sent this back for a second pass.
 *
 * Folding coverage into the existing bands alone was worth 0.024 of score, and
 * on staging that moved a real ranked feed by zero positions — a populated
 * boolean and an unkept promise. These pin the additive lift: large enough to
 * reorder comparable cards, and structurally unable to overrule urgency.
 */
describe('[12] the coverage lift is perceptible and bounded', () => {
  const at = (over: Partial<PriorityInput>): PriorityInput => ({
    id: 'x', type: 'research_stale', severity: 'attention',
    occurredAt: new Date('2026-08-01').toISOString(), ...over,
  })

  it('lets a covered name outrank a materially larger uncovered position', () => {
    const coveredSmall = priorityFor(at({ id: 'c', coverage: 'direct', weightPct: 1, held: true }), NOW)
    const uncoveredBig = priorityFor(at({ id: 'u', coverage: 'held', weightPct: 8, held: true }), NOW)
    expect(coveredSmall.total).toBeGreaterThan(uncoveredBig.total)
  })

  it('is exactly zero for everyone who has declared nothing', () => {
    for (const c of ['held', 'none', 'unknown'] as const) {
      expect(priorityFor(at({ coverage: c }), NOW).components.coverage).toBe(0)
    }
    expect(priorityFor(at({}), NOW).components.coverage).toBe(0)
    expect(priorityFor(at({ coverage: 'direct' }), NOW).components.coverage).toBeGreaterThan(0)
  })

  /** The guarantee the lift is not allowed to break, restated against it. */
  it('still cannot lift a covered card over an urgent uncovered one', () => {
    const covered = at({ id: 'covered', type: 'research_stale', coverage: 'direct', weightPct: 9, held: true })
    const urgent = at({ id: 'urgent', type: 'scenario_gap', severity: 'critical', coverage: 'none' })
    // Ranked as the feed ranks them — tier first, and only then score.
    const order = rankFeed([covered, urgent], i => i, NOW).map(r => r.item.id)
    expect(order).toEqual(['urgent', 'covered'])
  })
})
