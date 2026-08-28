import { describe, expect, it } from 'vitest'
import {
  canonicalTypeFor, signalDispositionRef, signalPriorityInput,
  type GeneratedSignal,
} from '../signal-candidates'
import { rankMixedCandidates } from '../idea-priority'
import { priorityFor, LEAD_TIER } from '../../signals/feed-priority'
import { dispositionKey, type DispositionMap } from '../../signals/dispositions'
import { TRIAGE_JUDGMENT } from '../../signals/feed-triage'
import { DAY_MS } from '../../signals/thresholds'
import type { CoverageIndex } from '../../signals/coverage-relevance'

const NOW = Date.UTC(2026, 7, 28, 12)
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString()

const NVDA = 'aaaaaaa1-0000-4000-8000-000000000000'
const AVGO = 'aaaaaaa2-0000-4000-8000-000000000000'
const JPM = 'aaaaaaa3-0000-4000-8000-000000000000'

const INDEX: CoverageIndex = {
  ready: true,
  direct: new Set([NVDA]),
  assigned: new Set(),
  held: new Set([AVGO]),
}

const CTX = { userId: 'me', followedIds: [] as string[], coverageIndex: INDEX }

const signal = (over: Partial<GeneratedSignal> = {}): GeneratedSignal => ({
  id: 'signal-conflict-nvda',
  signalType: 'conflict',
  headline: 'NVDA: team is split',
  body: 'Opposing recorded views.',
  relatedAssets: [{ id: NVDA, symbol: 'NVDA' }],
  createdAt: new Date(NOW).toISOString(),
  priority: 0.8,
  ...over,
})

const post = (over: Record<string, any> = {}) => ({
  id: 'p1', type: 'quick_thought', created_at: ago(0.5),
  content: 'A view worth reading.', author: { id: 'someone' }, ...over,
})

const ids = (rows: ReturnType<typeof rankMixedCandidates>) =>
  rows.map(r => (r.item.kind === 'signal' ? r.item.signal!.id : String(r.item.post!.id)))

// ── 1–4. the ranker decides, not the component ─────────────────────────────

describe('signals compete on the canonical scale', () => {
  it('[1] a conflict outranks a fresh scoped post', () => {
    const fresh = post({ id: 'fresh', asset: { id: NVDA }, created_at: ago(0.01) })
    const ranked = rankMixedCandidates([fresh], [signal()], CTX, NOW)
    expect(ids(ranked)[0]).toBe('signal-conflict-nvda')
  })

  /**
   * [2] The claim that matters most. `attention_cluster` maps to `team_focus`
   * — tier 2, base 0.40 — so activity on a name does not become a decision by
   * arriving through the signal generator.
   */
  it('[2] a weak signal does not reach Attention just for being a signal', () => {
    const cluster = signal({
      id: 'signal-cluster-jpm', signalType: 'attention_cluster',
      relatedAssets: [{ id: JPM, symbol: 'JPM' }], priority: 0.9,
    })
    const input = signalPriorityInput(cluster, { coverageIndex: INDEX })!
    expect(priorityFor(input, NOW).tier).toBeGreaterThan(LEAD_TIER)
  })

  it('[2b] stale coverage is real, and still not Attention', () => {
    const stale = signal({
      id: 'signal-stale-avgo', signalType: 'stale_coverage',
      relatedAssets: [{ id: AVGO, symbol: 'AVGO' }],
    })
    const p = priorityFor(signalPriorityInput(stale, { coverageIndex: INDEX })!, NOW)
    expect(p.tier).toBeGreaterThan(LEAD_TIER)
    // …but it does outrank an ordinary post, which is tier 4.
    const ranked = rankMixedCandidates([post({ id: 'note' })], [stale], CTX, NOW)
    expect(ids(ranked)[0]).toBe('signal-stale-avgo')
  })

  /**
   * [3] Attention is not a signals-only club. A tier 0/1 candidate reaches it
   * whatever produced it — the rule reads `tier`, and nothing else.
   */
  it('[3] a lead-tier candidate reaches Attention regardless of its source', () => {
    const gap = priorityFor({
      id: 'gap', type: 'scenario_gap', severity: 'critical', occurredAt: ago(1),
    }, NOW)
    expect(gap.tier).toBeLessThanOrEqual(LEAD_TIER)

    const conflict = priorityFor(signalPriorityInput(signal(), { coverageIndex: INDEX })!, NOW)
    expect(conflict.tier).toBeLessThanOrEqual(LEAD_TIER)
  })

  it('[4] the generator\'s own 0-1 priority has no effect on the ranking', () => {
    const weak = signal({ id: 'a', priority: 0.01 })
    const strong = signal({ id: 'b', priority: 1 })
    const a = priorityFor(signalPriorityInput(weak, { coverageIndex: INDEX })!, NOW)
    const b = priorityFor(signalPriorityInput(strong, { coverageIndex: INDEX })!, NOW)
    expect(a.total).toBe(b.total)
  })

  /** [7] One stream, one sort — signals are interleaved by rank, not spliced. */
  it('[7] posts and signals come back in one canonically ordered list', () => {
    const rows = rankMixedCandidates(
      [post({ id: 'p-a' }), post({ id: 'p-b', asset: { id: NVDA } })],
      [signal(), signal({
        id: 'signal-stale-avgo', signalType: 'stale_coverage',
        relatedAssets: [{ id: AVGO, symbol: 'AVGO' }],
      })],
      CTX, NOW,
    )
    // Tiers are non-decreasing down the list: the sort is the canonical one.
    const tiers = rows.map(r => r.priority.tier)
    expect([...tiers].sort((x, y) => x - y)).toEqual(tiers)
    expect(rows).toHaveLength(4)
  })

  /**
   * [8] The structural guarantee behind [7]: there is no path that appends an
   * unranked signal. Every candidate in the result carries a Priority.
   */
  it('[8] no candidate reaches the stream without a canonical priority', () => {
    const rows = rankMixedCandidates([post()], [signal()], CTX, NOW)
    for (const r of rows) {
      expect(r.priority).toBeTruthy()
      expect(typeof r.priority.tier).toBe('number')
      expect(r.priority.reasons).toBeInstanceOf(Array)
    }
  })
})

// ── 5–6. suppression and scope behave as they do everywhere else ───────────

describe('signals obey the shared suppression and scope rules', () => {
  const dismissedNvdaConflict: DispositionMap = {
    [dispositionKey('thesis_conflict', NVDA)]: {
      kind: 'settled', key: TRIAGE_JUDGMENT.dismiss.key, verdict: TRIAGE_JUDGMENT.dismiss.key,
      at: NOW, until: NOW + 30 * DAY_MS,
    },
  }

  it('[5] a dismissed signal is absent from the stream', () => {
    const rows = rankMixedCandidates(
      [post({ id: 'kept' })], [signal()],
      { ...CTX, dispositions: dismissedNvdaConflict }, NOW,
    )
    expect(ids(rows)).toEqual(['kept'])
  })

  it('[5b] scope cannot resurrect a dismissed signal', () => {
    // NVDA is in personal scope — the strongest lift in the model — and the
    // dismissal still wins, because eligibility is decided before scoring.
    const rows = rankMixedCandidates(
      [], [signal()], { ...CTX, dispositions: dismissedNvdaConflict }, NOW,
    )
    expect(rows).toHaveLength(0)
  })

  it('[5c] the dismissal is keyed on the asset, not the generated id', () => {
    const ref = signalDispositionRef(signal())!
    expect(ref).toEqual({ type: 'thesis_conflict', entityId: NVDA })
    // The generator rebuilds the id every five minutes; the asset does not move.
    expect(ref.entityId).not.toContain('signal-')
  })

  it('[5d] dismissing one name does not silence the same signal on another', () => {
    const other = signal({
      id: 'signal-conflict-jpm', relatedAssets: [{ id: JPM, symbol: 'JPM' }],
    })
    const rows = rankMixedCandidates([], [signal(), other], { ...CTX, dispositions: dismissedNvdaConflict }, NOW)
    expect(ids(rows)).toEqual(['signal-conflict-jpm'])
  })

  it('[6] scope applies to signals exactly as it does to posts', () => {
    const scoped = priorityFor(signalPriorityInput(signal(), { coverageIndex: INDEX })!, NOW)
    const unscoped = priorityFor(
      signalPriorityInput(
        signal({ id: 'x', relatedAssets: [{ id: JPM, symbol: 'JPM' }] }),
        { coverageIndex: INDEX },
      )!, NOW,
    )
    expect(scoped.scope.kind).toBe('personal_scope')
    expect(unscoped.scope.kind).toBe('none')
    expect(scoped.total).toBeGreaterThan(unscoped.total)
    expect(scoped.reasons.find(r => r.code === 'in_my_scope')).toBeTruthy()
  })
})

// ── what enters the stream, and what does not ──────────────────────────────

describe('the mapping is explicit about what it will not rank', () => {
  it('maps each generated type onto a decided canonical type', () => {
    expect(canonicalTypeFor('conflict')).toBe('thesis_conflict')
    expect(canonicalTypeFor('stale_coverage')).toBe('research_stale')
    expect(canonicalTypeFor('attention_cluster')).toBe('team_focus')
    expect(canonicalTypeFor('catalyst_proximity')).toBe('catalyst_ahead')
  })

  /**
   * A prompt is a request addressed to a person, not a finding about a name, so
   * the asset-keyed identity rule has nothing to key on. Excluded rather than
   * given a fuzzy identity.
   */
  it('declines to rank a prompt rather than inventing a tier for it', () => {
    expect(canonicalTypeFor('prompt')).toBeNull()
    expect(signalPriorityInput(signal({ signalType: 'prompt' }), {})).toBeNull()
  })

  it('drops an unrankable signal from the stream instead of downgrading it', () => {
    const rows = rankMixedCandidates(
      [post({ id: 'kept' })],
      [signal({ id: 'prompt-1', signalType: 'prompt' })],
      CTX, NOW,
    )
    expect(ids(rows)).toEqual(['kept'])
  })

  it('is not dismissible when there is no asset to key on', () => {
    expect(signalDispositionRef(signal({ relatedAssets: [] }))).toBeNull()
  })

  /**
   * The generator stamps `createdAt` with the moment the query ran, so a signal
   * would otherwise claim to be seconds old forever and take the full recency
   * boost. These are standing conditions with no event behind them.
   */
  it('takes no recency boost from the time the generator happened to run', () => {
    const p = priorityFor(signalPriorityInput(signal(), { coverageIndex: INDEX })!, NOW)
    expect(p.components.recency).toBe(0)
    expect(p.reasons.find(r => r.code === 'freshness')).toBeUndefined()
  })
})
