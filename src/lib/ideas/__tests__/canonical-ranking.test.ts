import { describe, expect, it } from 'vitest'
import { ideaPriorityInput, rankIdeaCandidates } from '../idea-priority'
import { rankCandidatesForTest, applyDiversityForTest } from '../../../hooks/ideas/useIdeasFeed'
import {
  priorityFor, rankFeed, type PriorityInput,
} from '../../signals/feed-priority'
import {
  scopeBonusFor, scopeWeightFor, type ScopeRelevance, type CoverageIndex,
} from '../../signals/coverage-relevance'
import { dispositionKey } from '../../signals/dispositions'
import { ideaCardId, ideaCardType } from '../../signals/builders/ideas'
import { TRIAGE_JUDGMENT } from '../../signals/feed-triage'
import { DAY_MS } from '../../signals/thresholds'
import { eligibleFeedItems } from '../feed-suppression'
import { buildFixtureSnapshot, FIXTURE_NOW, MARKED } from '../rank-snapshot/fixture'
import { replayLegacyMobileIntake } from '../rank-snapshot/legacy-rankers'
import { replayCanonical } from '../rank-snapshot/canonical-replay'
import type { DispositionMap } from '../../signals/dispositions'

const NOW = FIXTURE_NOW
const PERSONAL = 'aaaaaaaa-1111-4111-8111-111111111111'
const ASSIGNED = 'bbbbbbbb-2222-4222-8222-222222222222'
const HELD = 'cccccccc-3333-4333-8333-333333333333'
const OUTSIDE = 'dddddddd-4444-4444-8444-444444444444'

const INDEX: CoverageIndex = {
  ready: true,
  direct: new Set([PERSONAL]),
  assigned: new Set([ASSIGNED]),
  held: new Set([HELD]),
}

const CTX = { userId: 'me', followedIds: ['friend'], coverageIndex: INDEX }

const post = (over: Record<string, any> = {}) => ({
  id: 'p1',
  type: 'quick_thought',
  created_at: new Date(NOW - DAY_MS).toISOString(),
  content: 'A view worth reading.',
  author: { id: 'someone' },
  ...over,
})

const priorityOf = (item: any, ctx: any = CTX) =>
  priorityFor(ideaPriorityInput(item, ctx), NOW)

// ── 1. one intelligence, two shells ────────────────────────────────────────

describe('[1] desktop and mobile agree on priority', () => {
  it('produces an identical Priority for the same row and reader', () => {
    for (const type of ['quick_thought', 'trade_idea', 'note', 'thesis_update', 'pair_trade']) {
      for (const assetId of [PERSONAL, ASSIGNED, HELD, OUTSIDE, null]) {
        const item = post({ id: `${type}-${assetId}`, type, asset: assetId ? { id: assetId } : null })

        // Desktop: through the feed hook's ranking entry point.
        const [desktop] = rankCandidatesForTest([item] as any, {
          userId: 'me', organizationId: 'o', followedIds: ['friend'],
          heldAssetIds: new Set<string>(), coverageIndex: INDEX,
        } as any, NOW)

        // Mobile: through the pooled ranker, the way rankInputFor now does it.
        const mobile = priorityFor(ideaPriorityInput(item, CTX), NOW)

        expect(desktop.priority).toEqual(mobile)
      }
    }
  })

  /**
   * The structural guarantee behind the above: there is one mapping, so a shell
   * cannot introduce a difference by reading a row slightly differently.
   */
  it('builds the same PriorityInput from both entry points', () => {
    const item = post({ asset: { id: PERSONAL } })
    const a = ideaPriorityInput(item, CTX)
    const b = ideaPriorityInput(item, { ...CTX })
    expect(a).toEqual(b)
  })
})

// ── 2–5. the scope model ───────────────────────────────────────────────────

describe('scope influences priority exactly once', () => {
  const scoped = (assetId: string | null) =>
    priorityOf(post({ id: `s-${assetId}`, asset: assetId ? { id: assetId } : null }))

  it('[2] personal scope lifts, and reports one scope reason', () => {
    const p = scoped(PERSONAL)
    const outside = scoped(OUTSIDE)
    expect(p.total).toBeGreaterThan(outside.total)
    expect(p.scope.kind).toBe('personal_scope')
    const scopeReasons = p.reasons.filter(r =>
      ['in_my_scope', 'assigned_to_me', 'held', 'readthrough'].includes(r.code))
    expect(scopeReasons).toHaveLength(1)
    expect(scopeReasons[0].code).toBe('in_my_scope')
  })

  it('[3] assigned scope lifts by the same amount, under its own reason', () => {
    const personal = scoped(PERSONAL)
    const assigned = scoped(ASSIGNED)
    expect(assigned.components.ownership).toBe(personal.components.ownership)
    expect(assigned.components.coverage).toBe(personal.components.coverage)
    expect(assigned.reasons.find(r => r.code === 'assigned_to_me')).toBeTruthy()
    expect(assigned.reasons.find(r => r.code === 'in_my_scope')).toBeUndefined()
  })

  /**
   * The double application this phase removed. Desktop added 0.12 and mobile
   * 0.10 to the same declaration, in sequence, because mobile ranked rows
   * desktop had already scored. The whole scope contribution must now equal one
   * application of the model's own constants.
   */
  it('[2b] applies the bonus once, not once per shell', () => {
    const p = scoped(PERSONAL)
    const outside = scoped(OUTSIDE)
    const delta = (p.components.ownership + p.components.coverage)
      - (outside.components.ownership + outside.components.coverage)

    const expected =
      (scopeWeightFor({ kind: 'personal_scope' }) - scopeWeightFor({ kind: 'none' })) * 0.06
      + (scopeBonusFor({ kind: 'personal_scope' }) - scopeBonusFor({ kind: 'none' })) * 0.10

    expect(delta).toBeCloseTo(expected, 10)
    // And the reason agrees with the arithmetic, so an explanation cannot
    // silently claim more than the score gave.
    expect(p.reasons.find(r => r.code === 'in_my_scope')!.contribution)
      .toBeCloseTo(p.components.ownership + p.components.coverage, 10)
  })

  it('[4] held is weaker than scope and stronger than nothing', () => {
    const held = scoped(HELD)
    expect(held.total).toBeLessThan(scoped(PERSONAL).total)
    expect(held.total).toBeGreaterThan(scoped(OUTSIDE).total)
    expect(held.scope.kind).toBe('held')
    // Distinct, not a weak coverage: no bonus at all.
    expect(held.components.coverage).toBe(0)
  })

  it('[5] a reader who has declared nothing is scored neutrally', () => {
    const empty: CoverageIndex = { ready: true, direct: new Set(), assigned: new Set(), held: new Set() }
    const ctx = { ...CTX, coverageIndex: empty }
    const a = priorityOf(post({ id: 'a', asset: { id: PERSONAL } }), ctx)
    const b = priorityOf(post({ id: 'b', asset: { id: OUTSIDE } }), ctx)
    expect(a.components.ownership).toBe(b.components.ownership)
    expect(a.components.coverage).toBe(0)
    expect(a.scope.kind).toBe('unknown')
    expect(a.reasons.some(r => ['in_my_scope', 'assigned_to_me', 'held'].includes(r.code))).toBe(false)
  })

  it('[5b] an unresolved index is neutral, never a penalty', () => {
    const pending: CoverageIndex = { ready: false, direct: new Set(), assigned: new Set(), held: new Set() }
    const p = priorityOf(post({ asset: { id: PERSONAL } }), { ...CTX, coverageIndex: pending })
    expect(p.scope.kind).toBe('unknown')
    expect(p.components.ownership).toBeGreaterThan(0)
  })
})

// ── 6. relevance must not become a filter ──────────────────────────────────

describe('[6] urgency still beats a weak scope relationship', () => {
  it('ranks an urgent unscoped proposal above an old scoped thought', () => {
    const urgent = post({
      id: 'urgent', type: 'trade_idea', asset: { id: OUTSIDE },
      created_at: new Date(NOW - 0.1 * DAY_MS).toISOString(),
    })
    const weakScoped = post({
      id: 'weak', type: 'quick_thought', asset: { id: PERSONAL },
      created_at: new Date(NOW - 46 * DAY_MS).toISOString(),
    })
    const order = rankIdeaCandidates([urgent, weakScoped], CTX, NOW).map(r => r.item.id)
    expect(order).toEqual(['urgent', 'weak'])
  })

  /**
   * The structural version of the same guarantee, which is the one that holds
   * regardless of weights: scope is a within-tier lift, and the tier sort runs
   * first. A scenario gap outranks any post whatever the reader has declared.
   */
  it('cannot lift a post over a signal in a higher tier', () => {
    const gap: PriorityInput = {
      id: 'gap', type: 'scenario_gap', severity: 'critical',
      occurredAt: new Date(NOW - 30 * DAY_MS).toISOString(), scope: { kind: 'none' },
    }
    const scopedPost = ideaPriorityInput(
      post({ id: 'post', type: 'trade_idea', asset: { id: PERSONAL } }), CTX,
    )
    const order = rankFeed([gap, scopedPost], i => i, NOW).map(r => r.item.id)
    expect(order).toEqual(['gap', 'post'])
  })
})

// ── 7. suppression, on both shells ─────────────────────────────────────────

describe('[7] a suppressed item is absent from both shells', () => {
  const p = post({ id: 'dismissed' })
  const dismissed: DispositionMap = {
    [dispositionKey(ideaCardType(p.type), ideaCardId(p.type, p.id))]: {
      kind: 'settled', key: TRIAGE_JUDGMENT.dismiss.key, verdict: TRIAGE_JUDGMENT.dismiss.key,
      at: NOW, until: NOW + 30 * DAY_MS,
    },
  }
  const other = post({ id: 'kept' })

  it('is dropped by the shared eligibility pass', () => {
    expect(eligibleFeedItems([p, other], dismissed, NOW).map(i => i.id)).toEqual(['kept'])
  })

  it('is dropped by the canonical ranker when the judgment reaches it', () => {
    const order = rankIdeaCandidates([p, other], { ...CTX, dispositions: dismissed }, NOW)
    expect(order.map(r => r.item.id)).toEqual(['kept'])
  })

  it('cannot be resurrected by scope', () => {
    const scopedDismissed = post({ id: 'dismissed', asset: { id: PERSONAL } })
    const order = rankIdeaCandidates([scopedDismissed, other], { ...CTX, dispositions: dismissed }, NOW)
    expect(order.map(r => r.item.id)).toEqual(['kept'])
  })
})

// ── 8–9. the candidate pool actually reaches both shells ───────────────────

describe('the widened pool is visible to both shells', () => {
  const snap = buildFixtureSnapshot()
  const canonical = replayCanonical({
    ...snap,
    candidates: snap.candidates.filter(c =>
      eligibleFeedItems(snap.candidates, snap.context.dispositions, snap.context.now)
        .some(e => e.id === c.id)),
  })
  const legacyMobile = replayLegacyMobileIntake(snap)

  it('[8] an old scoped idea reaches the first desktop page', () => {
    const page = canonical.ranked.slice(0, 20).map(r => r.id)
    expect(page).toContain(MARKED.oldScoped)
    expect(page).toContain(MARKED.oldAssigned)
  })

  /**
   * The structural defect this phase removed. Mobile's idea candidates used to
   * be whatever survived desktop's diversity pass and a fifteen-row cut, so a
   * row could be missing from mobile because DESKTOP had spaced it out.
   */
  it('[9] mobile now sees candidates the old desktop slice removed', () => {
    const oldIntake = new Set(legacyMobile.ranked.map(r => r.id))
    const nowVisible = canonical.ranked.map(r => r.id).filter(id => !oldIntake.has(id))
    expect(nowVisible.length).toBeGreaterThan(0)
    /**
     * Named, so the claim is about specific rows rather than a count. The pair
     * trade is the clearest case: legacy desktop ranked it 17th, so the
     * fifteen-row cut removed it, and mobile could not tell that from "there
     * are no pair trades" — which is exactly how it was reported.
     */
    expect(oldIntake.has('proposal-5')).toBe(false)
    expect(canonical.ranked.some(r => r.id === 'proposal-5')).toBe(true)
  })

  it('[9b] mobile receives the whole eligible pool, not a page of it', () => {
    expect(canonical.ranked.length).toBeGreaterThan(legacyMobile.ranked.length)
  })
})

// ── 10. determinism ────────────────────────────────────────────────────────

describe('[10] the order is total and reproducible', () => {
  const identical = [3, 1, 2].map(n => post({
    id: `tie-${n}`, type: 'quick_thought',
    created_at: new Date(NOW - DAY_MS).toISOString(),
  }))

  it('breaks exact ties by id, stably', () => {
    const forwards = rankIdeaCandidates(identical, CTX, NOW).map(r => r.item.id)
    const backwards = rankIdeaCandidates([...identical].reverse(), CTX, NOW).map(r => r.item.id)
    expect(backwards).toEqual(forwards)
    expect(forwards).toEqual(['tie-1', 'tie-2', 'tie-3'])
  })

  it('is byte-identical across repeated runs of a whole snapshot', () => {
    const snap = buildFixtureSnapshot()
    const a = replayCanonical(snap).ranked.map(r => `${r.id}:${r.score}`)
    const b = replayCanonical(snap).ranked.map(r => `${r.id}:${r.score}`)
    expect(b).toEqual(a)
  })

  it('orders by tier before score', () => {
    const gap: PriorityInput = {
      id: 'gap', type: 'scenario_gap', severity: 'informational',
      weightPct: 0.1, occurredAt: new Date(NOW - 300 * DAY_MS).toISOString(),
    }
    const post4 = ideaPriorityInput(post({ id: 'fresh', type: 'trade_idea', asset: { id: PERSONAL } }), CTX)
    const ranked = rankFeed([post4, gap], i => i, NOW)
    expect(ranked[0].item.id).toBe('gap')
    expect(ranked[0].priority.tier).toBeLessThan(ranked[1].priority.tier)
  })
})

// ── 11. diversity is presentation ──────────────────────────────────────────

describe('[11] diversity rearranges, it does not re-rank', () => {
  const sameAuthor = { id: 'prolific' }
  /**
   * Four from one author ranked above one from another, so the run rule has
   * something to do: it defers the fourth past the outsider. Five from one
   * author would not reorder at all — the deferred rows are still blocked on
   * the second pass and get appended in place.
   */
  const items = [
    ...['a', 'b', 'c', 'd'].map((id, i) => post({
      id, author: sameAuthor,
      created_at: new Date(NOW - (i + 1) * DAY_MS).toISOString(),
    })),
    post({ id: 'x', author: { id: 'someone-else' }, created_at: new Date(NOW - 9 * DAY_MS).toISOString() }),
  ]

  it('leaves every underlying priority untouched', () => {
    const ranked = rankIdeaCandidates(items, CTX, NOW)
    const before = new Map(ranked.map(r => [String(r.item.id), r.priority.total]))

    const scored = ranked.map(r => ({ ...(r.item as any), score: r.priority.total, priority: r.priority }))
    const spaced = applyDiversityForTest(scored as any)

    for (const row of spaced) {
      expect((row as any).score).toBe(before.get(String(row.id)))
    }
    // Same membership, possibly different order — which is the whole point.
    expect(new Set(spaced.map(r => r.id))).toEqual(new Set(items.map(i => i.id)))
  })

  it('changes the order it is given, so it is doing something', () => {
    const ranked = rankIdeaCandidates(items, CTX, NOW)
    const scored = ranked.map(r => ({ ...(r.item as any), score: r.priority.total, priority: r.priority }))
    const spaced = applyDiversityForTest(scored as any).map(r => r.id)
    expect(spaced).not.toEqual(ranked.map(r => r.item.id))
  })
})

// ── 12. scope changes recompute ────────────────────────────────────────────

describe('[12] declaring a name changes the ranking', () => {
  it('reorders once the asset enters personal scope', () => {
    const quiet = post({
      id: 'quiet', asset: { id: OUTSIDE },
      created_at: new Date(NOW - 20 * DAY_MS).toISOString(),
    })
    /**
     * `fresh` carries an asset too, deliberately. A row with no asset resolves
     * to `unknown` — neutral, and neutral scores the FULL ownership weight,
     * because a pending or inapplicable answer must never read as "not your
     * problem". Comparing a scoped row against an assetless one would therefore
     * be comparing it against a row that is also getting the band.
     */
    const fresh = post({
      id: 'fresh', asset: { id: HELD },
      created_at: new Date(NOW - 2 * DAY_MS).toISOString(),
    })

    const before = rankIdeaCandidates([quiet, fresh], CTX, NOW).map(r => r.item.id)
    expect(before).toEqual(['fresh', 'quiet'])

    const declared: CoverageIndex = { ...INDEX, direct: new Set([PERSONAL, OUTSIDE]) }
    const after = rankIdeaCandidates([quiet, fresh], { ...CTX, coverageIndex: declared }, NOW)
    expect(after.map(r => r.item.id)).toEqual(['quiet', 'fresh'])
    expect(after[0].priority.reasons[0].code).toBe('in_my_scope')
  })
})

// ── 13. the readthrough extension point ────────────────────────────────────

/**
 * An architecture test, not a feature test. No relationship graph exists and
 * none is built here; what is asserted is that one could be added as a new
 * PRODUCER of `ScopeRelevance` without changing the ranker's inputs, its
 * outputs, or any call site.
 */
describe('[13] readthrough is representable without an API change', () => {
  const readthrough: ScopeRelevance = {
    kind: 'readthrough',
    via: {
      sourceAssetId: OUTSIDE,
      targetAssetId: PERSONAL,
      relationshipType: 'capex_exposure',
      strength: 0.8,
      explanation: "hyperscaler capex outlook moves this reader's scoped name",
    },
  }

  it('is accepted by priorityFor with no signature change', () => {
    const p = priorityFor({
      id: 'msft-capex', type: 'news', severity: 'attention',
      occurredAt: new Date(NOW - DAY_MS).toISOString(),
      scope: readthrough,
    }, NOW)
    expect(p.scope.kind).toBe('readthrough')
    expect(p.total).toBeGreaterThan(0)
  })

  it('carries the relationship out on the reason, for presentation to phrase', () => {
    const p = priorityFor({
      id: 'msft-capex', type: 'news', severity: 'attention',
      occurredAt: new Date(NOW - DAY_MS).toISOString(),
      scope: readthrough,
    }, NOW)
    const reason = p.reasons.find(r => r.code === 'readthrough')
    expect(reason).toBeTruthy()
    expect((reason!.detail as any).via.targetAssetId).toBe(PERSONAL)
    expect((reason!.detail as any).via.relationshipType).toBe('capex_exposure')
    // The ranker supplies facts; it does not supply copy.
    expect(JSON.stringify(reason)).not.toMatch(/is relevant to|in your scope/)
  })

  /**
   * Deliberately unscored for now. Choosing what a readthrough is worth needs a
   * graph to measure against, and guessing it here would bake an unmeasured
   * constant into the one place relevance is decided.
   */
  it('is scored neutrally today, and says so', () => {
    expect(scopeWeightFor(readthrough)).toBe(scopeWeightFor({ kind: 'unknown' }))
    expect(scopeBonusFor(readthrough)).toBe(0)
  })

  it('does not disturb the bands that are scored', () => {
    expect(scopeWeightFor({ kind: 'personal_scope' })).toBe(1)
    expect(scopeWeightFor({ kind: 'held' })).toBe(0.6)
    expect(scopeWeightFor({ kind: 'none' })).toBe(0)
  })
})
