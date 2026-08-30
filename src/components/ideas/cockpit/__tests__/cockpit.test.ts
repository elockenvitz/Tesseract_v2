import { describe, expect, it } from 'vitest'
import { whyThis } from '../why-this'
import { compactAge, toIdeaRow } from '../to-row'
import { COCKPIT_LEAD_TIER } from '../CockpitStream'
import { priorityFor, type RankReason } from '../../../../lib/signals/feed-priority'
import { rankIdeaCandidates } from '../../../../lib/ideas/idea-priority'
import { judgmentRefFor } from '../../../../lib/ideas/feed-suppression'
import { recordRowTriage, TRIAGE_JUDGMENT } from '../../../../lib/signals/feed-triage'
import { loadDispositions, dispositionKey } from '../../../../lib/signals/dispositions'
import { ideaCardId, ideaCardType } from '../../../../lib/signals/builders/ideas'
import { DAY_MS } from '../../../../lib/signals/thresholds'

const NOW = Date.UTC(2026, 7, 28, 12)
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString()

const SCOPED = 'aaaaaaa1-0000-4000-8000-000000000000'
const ASSIGNED = 'aaaaaaa2-0000-4000-8000-000000000000'
const HELD = 'aaaaaaa3-0000-4000-8000-000000000000'
const OUTSIDE = 'aaaaaaa4-0000-4000-8000-000000000000'

const CTX = {
  userId: 'me',
  followedIds: ['friend'],
  coverageIndex: {
    ready: true,
    direct: new Set([SCOPED]),
    assigned: new Set([ASSIGNED]),
    held: new Set([HELD]),
  },
}

const post = (over: Record<string, any> = {}) => ({
  id: 'p1', type: 'quick_thought', created_at: ago(1),
  content: 'A view worth reading, long enough to be a real post.',
  author: { id: 'someone' }, ...over,
})

const reasonsFor = (item: any, ctx: any = CTX): RankReason[] =>
  rankIdeaCandidates([item], ctx, NOW)[0].priority.reasons

// ── 3–6. the vocabulary a reader actually sees ─────────────────────────────

describe('scope reads in product language', () => {
  const labelFor = (assetId: string) =>
    whyThis(reasonsFor(post({ asset: { id: assetId } }))).primary.label

  it('[3] personal scope reads "My Scope", never "direct coverage"', () => {
    expect(labelFor(SCOPED)).toBe('My Scope')
  })

  it('[4] org-assigned reads "Assigned to you"', () => {
    expect(labelFor(ASSIGNED)).toBe('Assigned to you')
  })

  it('[5] a held name reads "In portfolio"', () => {
    expect(labelFor(HELD)).toBe('In portfolio')
  })

  /**
   * [6] The guard that matters, because a leak here is a database column in a
   * workspace. Every label the module can emit, checked against the internal
   * vocabulary rather than against a list of the ones we happened to think of.
   */
  it('[6] no internal enum name can reach a label', () => {
    const codes: RankReason[] = [
      { code: 'in_my_scope', contribution: 0.16 },
      { code: 'assigned_to_me', contribution: 0.16 },
      { code: 'held', contribution: 0.036 },
      { code: 'urgency', contribution: 0.14 },
      { code: 'unresolved', contribution: 0.066 },
      { code: 'freshness', contribution: 0.1 },
      { code: 'off_framework', contribution: 0.18 },
      { code: 'followed_author', contribution: 0.06 },
      { code: 'own_post', contribution: 0.036 },
      { code: 'peer_interest', contribution: 0.04 },
      { code: 'acknowledged', contribution: -0.2 },
      { code: 'material', contribution: 0.033 },
    ]
    const forbidden = [
      'direct', 'assigned_scope', 'personal_scope', 'coverage', 'ownership',
      'in_my_scope', 'assigned_to_me', 'peer_interest', 'off_framework',
      'tier', 'score', 'contribution',
    ]
    for (const reason of codes) {
      const { primary, secondary } = whyThis([reason])
      for (const label of [primary, secondary].filter(Boolean)) {
        for (const bad of forbidden) {
          expect(label!.label.toLowerCase()).not.toContain(bad)
        }
      }
    }
  })

  it('reports one primary and at most one secondary, never a wall', () => {
    const why = whyThis(reasonsFor(post({
      asset: { id: SCOPED }, type: 'trade_idea', author: { id: 'friend' },
      rationale: 'Worth doing now.',
    })))
    expect(why.primary.label).toBe('My Scope')
    expect(Object.keys(why).length).toBeLessThanOrEqual(2)
  })

  /**
   * "Urgent" has to mean urgent. Every card carries a baseline urgency
   * contribution, so an unfiltered reason list put the badge on everything —
   * which is decoration that teaches a reader to stop seeing the word.
   */
  it('does not call an ordinary post urgent', () => {
    const labels = whyThis(reasonsFor(post({ asset: { id: SCOPED } })))
    expect([labels.primary.label, labels.secondary?.label]).not.toContain('Urgent')
  })

  it('still calls a critical signal urgent', () => {
    const p = priorityFor({
      id: 's', type: 'scenario_gap', severity: 'critical',
      occurredAt: ago(0.5), weightPct: 4, held: true, deviationPct: 12,
    }, NOW)
    const labels = whyThis(p.reasons)
    expect([labels.primary.label, labels.secondary?.label]).toContain('Urgent')
  })

  /** A row with nothing to say says so, rather than rendering an empty chip. */
  it('falls back rather than emitting nothing', () => {
    expect(whyThis([]).primary.label).toBe('In your feed')
    expect(whyThis(undefined).primary.label).toBe('In your feed')
  })
})

// ── 7. the readthrough shape renders before it exists ──────────────────────

describe('[7] a readthrough reason renders safely today', () => {
  const readthrough: RankReason = {
    code: 'readthrough',
    contribution: 0.1,
    detail: {
      via: {
        sourceAssetId: OUTSIDE,
        targetAssetId: SCOPED,
        targetTicker: 'NVDA',
        relationshipType: 'capex_exposure',
        strength: 0.8,
        explanation: 'Microsoft AI capex may affect GPU demand.',
      },
    },
  }

  it('names the asset it reads through to, not the row it is on', () => {
    const why = whyThis([readthrough])
    expect(why.primary.label).toBe('Readthrough to NVDA')
    expect(why.primary.detail).toBe('Microsoft AI capex may affect GPU demand.')
  })

  it('degrades to a bare label when the link is incomplete', () => {
    expect(whyThis([{ code: 'readthrough', contribution: 0.1 }]).primary.label)
      .toBe('Readthrough')
  })

  it('takes the scope slot, so it cannot double up with another relationship', () => {
    const why = whyThis([readthrough, { code: 'held', contribution: 0.036 }])
    expect(why.primary.label).toBe('Readthrough to NVDA')
    expect(why.secondary?.label).not.toBe('In portfolio')
  })
})

// ── 1. layout does not touch ranking ───────────────────────────────────────

describe('[1] the presentation layer preserves the canonical order', () => {
  const items = [
    post({ id: 'a', type: 'trade_idea', asset: { id: SCOPED }, rationale: 'Buy.' }),
    post({ id: 'b', type: 'note', asset: { id: OUTSIDE }, title: 'A note' }),
    post({ id: 'c', type: 'quick_thought', created_at: ago(30) }),
  ]

  it('maps rows one-for-one, in order, without re-sorting', () => {
    const ranked = rankIdeaCandidates(items, CTX, NOW)
    const rows = ranked.map(r => toIdeaRow({ ...(r.item as any), priority: r.priority }, NOW))
    expect(rows.map(r => r.id)).toEqual(ranked.map(r => String(r.item.id)))
  })

  it('carries the canonical tier onto the row unchanged', () => {
    const ranked = rankIdeaCandidates(items, CTX, NOW)
    for (const r of ranked) {
      const row = toIdeaRow({ ...(r.item as any), priority: r.priority }, NOW)
      expect(row.tier).toBe(r.priority.tier)
    }
  })

  /** [2] Lead-tier rows are the ones the Attention band takes. */
  it('[2] partitions on the tier the ranker assigned, not on content type', () => {
    const gap = priorityFor({
      id: 'gap', type: 'scenario_gap', severity: 'critical', occurredAt: ago(1),
    }, NOW)
    expect(gap.tier).toBeLessThanOrEqual(COCKPIT_LEAD_TIER)

    const ranked = rankIdeaCandidates(items, CTX, NOW)
    // Every post is tier 4, so none of them can pre-empt a real signal.
    for (const r of ranked) expect(r.priority.tier).toBeGreaterThan(COCKPIT_LEAD_TIER)
  })

  it('a row with no priority lands in the lower band rather than the top', () => {
    const row = toIdeaRow(post({ id: 'discovery-0-1', type: 'insight' }) as any, NOW)
    expect(row.tier).toBeGreaterThan(COCKPIT_LEAD_TIER)
  })
})

describe('age reads as a glance, not a timestamp', () => {
  it('uses the largest sensible unit', () => {
    expect(compactAge(ago(0), NOW)).toBe('now')
    expect(compactAge(new Date(NOW - 45 * 60_000).toISOString(), NOW)).toBe('45m')
    expect(compactAge(new Date(NOW - 5 * 3_600_000).toISOString(), NOW)).toBe('5h')
    expect(compactAge(ago(3), NOW)).toBe('3d')
    expect(compactAge(ago(30), NOW)).toBe('4w')
    expect(compactAge(ago(200), NOW)).toBe('6mo')
  })

  it('survives an unparseable timestamp', () => {
    expect(compactAge('not-a-date', NOW)).toBe('')
  })
})

// ── 12. actions file under the identity everything else uses ───────────────

describe('[12] desktop triage writes the canonical disposition', () => {
  it('lands under exactly the key mobile would use', () => {
    localStorage.clear()
    const item = { id: 'row-1', type: 'quick_thought' }

    expect(recordRowTriage('reader', judgmentRefFor(item), 'dismiss', NOW)).toBe(true)

    const stored = loadDispositions('reader')
    const mobileKey = dispositionKey(ideaCardType(item.type), ideaCardId(item.type, item.id))
    expect(Object.keys(stored)).toEqual([mobileKey])
    expect(stored[mobileKey].key).toBe(TRIAGE_JUDGMENT.dismiss.key)
    localStorage.clear()
  })

  it('snooze and dismiss write their own keys, not a shared one', () => {
    localStorage.clear()
    recordRowTriage('reader', judgmentRefFor({ id: 'a', type: 'note' }), 'snooze', NOW)
    recordRowTriage('reader', judgmentRefFor({ id: 'b', type: 'note' }), 'dismiss', NOW)
    const stored = loadDispositions('reader')
    const keys = Object.values(stored).map(d => d.key).sort()
    expect(keys).toEqual([TRIAGE_JUDGMENT.dismiss.key, TRIAGE_JUDGMENT.snooze.key].sort())
    localStorage.clear()
  })
})
