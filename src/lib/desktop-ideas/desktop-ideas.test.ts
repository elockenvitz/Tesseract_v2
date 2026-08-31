/**
 * Focused tests for the Desktop Ideas domain layer.
 *
 * Scope: the Idea model, stance/maturity separation, visual family resolution
 * and its degradation, ranking, and EngagementTarget construction. Pure — no
 * React, no network.
 */

import { describe, it, expect } from 'vitest'
import {
  maturityOf, familyFor, issueFor, seedPromptFor, primaryActionFor, targetFor,
  scoreIdea, compareIdeas, MATURITY_LABEL,
  type IdeaEnrichment, type IdeaRow,
  openIdea, subscribeToOpenIdea, ideasTabFor,
} from './index'

const idea = (over: Partial<IdeaRow> = {}): IdeaRow => ({
  id: 'tq-1', assetId: 'a-amzn', symbol: 'AMZN', companyName: 'Amazon.com',
  direction: 'buy', stage: 'deep_research', maturity: maturityOf(over.stage ?? 'deep_research'),
  conviction: 'high', thesis: 'AWS reacceleration is under-modelled.',
  urgency: 'medium', proposedWeight: 3, portfolioId: 'p1', portfolioName: 'Growth',
  createdBy: 'u1', authorName: 'John Park',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  decisionOutcome: null,
  ...over,
})

const ladder: IdeaEnrichment = {
  spot: 233,
  ladder: {
    updatedAt: '2026-02-01',
    cases: [{ name: 'Bear', price: 96 }, { name: 'Base', price: 142 }, { name: 'Bull', price: 180 }],
  },
}

describe('stance and maturity are separate', () => {
  it.each([
    ['aware', 'researching'], ['investigate', 'researching'], ['deep_research', 'researching'],
    ['thesis_forming', 'thesis_forming'], ['modeling', 'thesis_forming'],
    ['ready_for_decision', 'decision_ready'], ['deciding', 'deciding'],
  ] as const)('maps stage %s to maturity %s', (stage, maturity) => {
    expect(maturityOf(stage)).toBe(maturity)
  })

  it('never invents WATCH for an early idea — direction survives maturity', () => {
    const early = idea({ direction: 'buy', stage: 'aware', maturity: 'researching' })
    // "BUY · RESEARCHING": we lean long, the work is unfinished. Both true.
    expect(early.direction).toBe('buy')
    expect(MATURITY_LABEL[early.maturity]).toBe('Researching')
  })

  it('falls back to researching for an unknown stage rather than dropping the idea', () => {
    expect(maturityOf('something_new')).toBe('researching')
    expect(maturityOf(null)).toBe('researching')
  })
})

describe('visual family', () => {
  it('prefers the framework when a real ladder and spot exist', () => {
    expect(familyFor(idea(), ladder)).toBe('scenario')
  })

  it('falls to target when there is a target but no ladder', () => {
    expect(familyFor(idea(), { target: 200, spot: 180 })).toBe('target')
  })

  it('falls to performance when only history exists', () => {
    expect(familyFor(idea(), {
      history: [{ date: '2026-01-01', close: 100 }, { date: '2026-02-01', close: 120 }],
    })).toBe('performance')
  })

  it('needs BOTH ladder and spot — neither alone earns the scenario visual', () => {
    expect(familyFor(idea(), { ladder: ladder.ladder })).not.toBe('scenario')
    expect(familyFor(idea(), { spot: 233 })).not.toBe('scenario')
  })

  it('needs both target and spot for the target visual', () => {
    expect(familyFor(idea(), { target: 200 })).not.toBe('target')
  })

  it('gives a decision-stage idea the team family when it has no market data', () => {
    expect(familyFor(idea({ stage: 'deciding', maturity: 'deciding' }), undefined)).toBe('team')
  })

  it('falls all the way back to the written claim, which is a real answer', () => {
    expect(familyFor(idea({ conviction: null, maturity: 'researching' }), undefined)).toBe('thesis')
  })

  it('never resolves a catalyst family — no durable catalyst data exists', () => {
    const families = new Set([
      familyFor(idea(), ladder),
      familyFor(idea(), { target: 1, spot: 2 }),
      familyFor(idea(), undefined),
    ])
    expect([...families]).not.toContain('catalyst')
  })
})

describe('ranking', () => {
  const rank = (i: IdeaRow, e?: IdeaEnrichment) => ({ id: i.id, rank: scoreIdea(i, e, Date.parse('2026-08-30')) })

  it('puts a decision in progress above everything', () => {
    expect(scoreIdea(idea({ maturity: 'deciding' }), undefined).tier).toBe(0)
    expect(scoreIdea(idea({ maturity: 'decision_ready' }), undefined).tier).toBe(1)
    expect(scoreIdea(idea({ maturity: 'researching' }), undefined).tier).toBe(3)
  })

  it('does not let an old unchanged idea lead merely by being old', () => {
    const ancient = rank(idea({ id: 'old', maturity: 'researching', updatedAt: '2020-01-01T00:00:00.000Z' }))
    const ready = rank(idea({ id: 'ready', maturity: 'decision_ready', updatedAt: '2020-01-01T00:00:00.000Z' }))
    expect([ancient, ready].sort(compareIdeas)[0].id).toBe('ready')
  })

  it('does not let freshness cross a tier', () => {
    const freshResearch = rank(idea({ id: 'fresh', maturity: 'researching', updatedAt: '2026-08-30T00:00:00.000Z' }))
    const staleReady = rank(idea({ id: 'ready', maturity: 'decision_ready', updatedAt: '2020-01-01T00:00:00.000Z' }))
    expect([freshResearch, staleReady].sort(compareIdeas)[0].id).toBe('ready')
  })

  it('lets a broken framework raise score within its tier', () => {
    const plain = scoreIdea(idea(), undefined, Date.parse('2026-08-30'))
    const broken = scoreIdea(idea(), ladder, Date.parse('2026-08-30'))
    expect(broken.tier).toBe(plain.tier)
    expect(broken.score).toBeGreaterThan(plain.score)
  })

  it('is stable — equal tier and score break by id', () => {
    const a = rank(idea({ id: 'aaa' })), b = rank(idea({ id: 'bbb' }))
    expect([b, a].sort(compareIdeas).map(x => x.id)).toEqual(['aaa', 'bbb'])
  })
})

describe('engagement target', () => {
  it('binds the trade idea itself, which is already discussable', () => {
    const t = targetFor(idea(), ladder)!
    expect(t).toMatchObject({ objectType: 'trade_idea', objectId: 'tq-1', symbol: 'AMZN' })
    expect(t.assetId).toBe('a-amzn')
    expect(t.origin).toMatchObject({ surface: 'ideas' })
  })

  it('carries the situation as the issue, not a generic label', () => {
    expect(targetFor(idea(), ladder)!.issue!.title).toMatch(/above the current bull case/)
    expect(targetFor(idea({ maturity: 'decision_ready' }), undefined)!.issue!.title)
      .toMatch(/Ready for a decision/)
  })

  it('supplies context the user never has to retype', () => {
    const labels = targetFor(idea(), { ...ladder, weightPct: 8.2, researchCount: 3 })!
      .contextChips!.map(c => c.label)
    expect(labels).toEqual(expect.arrayContaining(
      ['Direction', 'Maturity', 'Conviction', 'Framework', 'Weight', 'Portfolio', 'Research'],
    ))
  })

  it('writes a maturity-aware seed prompt', () => {
    expect(seedPromptFor(idea({ maturity: 'researching' }), undefined)).toMatch(/evidence is still missing/)
    expect(seedPromptFor(idea({ maturity: 'decision_ready' }), undefined)).toMatch(/should become a position/)
    expect(seedPromptFor(idea({ maturity: 'deciding' }), undefined)).toMatch(/strongest case against/)
    // A broken framework overrides maturity — it is the more specific problem.
    expect(seedPromptFor(idea({ maturity: 'researching' }), ladder)).toMatch(/justify the current price/)
  })

  it('returns no target without an id', () => {
    expect(targetFor(idea({ id: '' }), undefined)).toBeNull()
  })
})

describe('primary action', () => {
  it('is an investment verb, never Open or View', () => {
    const stages = ['researching', 'thesis_forming', 'decision_ready', 'deciding'] as const
    // Without a completable decision, both decision stages read "Review
    // decision" — looking is all the surface can honestly offer.
    expect(stages.map(m => primaryActionFor(idea({ maturity: m }), undefined, false)))
      .toEqual(['Advance research', 'Advance thesis', 'Review decision', 'Review decision'])
    // With one, the verb strengthens to the real mutation.
    expect(stages.map(m => primaryActionFor(idea({ maturity: m }), undefined, true)))
      .toEqual(['Advance research', 'Advance thesis', 'Decide', 'Decide'])
    const verbs = stages.map(m => primaryActionFor(idea({ maturity: m }), undefined, true))
    expect(verbs.join(' ')).not.toMatch(/\b(Open|View|Manage)\b/)
  })

  it('prefers the framework verb when the price has left the ladder', () => {
    expect(primaryActionFor(idea({ maturity: 'researching' }), ladder)).toBe('Review scenarios')
  })
})

describe('sparse data', () => {
  const bare = idea({
    thesis: null, conviction: null, proposedWeight: null,
    portfolioId: null, portfolioName: null, authorName: null, updatedAt: null,
  })

  it('still produces an identity, a family, a verb and a target', () => {
    expect(familyFor(bare, undefined)).toBe('thesis')
    expect(primaryActionFor(bare, undefined)).toBeTruthy()
    expect(targetFor(bare, undefined)).not.toBeNull()
    expect(issueFor(bare, undefined)).toBeTruthy()
  })

  it('does not fabricate chips it has no data for', () => {
    const labels = targetFor(bare, undefined)!.contextChips!.map(c => c.label)
    expect(labels).not.toContain('Conviction')
    expect(labels).not.toContain('Weight')
    expect(labels).not.toContain('Portfolio')
    expect(labels).toContain('Maturity')
  })
})

describe('arriving from another surface', () => {
  it('carries object, focus and issue on the wire', () => {
    const seen: any[] = []
    const off = subscribeToOpenIdea(r => seen.push(r))
    expect(openIdea({ ideaId: 'tq-9', focus: 'framework', issue: 'Spot above bull', origin: 'today' })).toBe(true)
    expect(seen[0]).toEqual({ ideaId: 'tq-9', focus: 'framework', issue: 'Spot above bull', origin: 'today' })
    off()
  })

  it('refuses a request with no object rather than opening a generic destination', () => {
    const seen: any[] = []
    const off = subscribeToOpenIdea(r => seen.push(r))
    expect(openIdea({ ideaId: '' })).toBe(false)
    expect(seen).toHaveLength(0)
    off()
  })

  it('uses a fixed tab id so the workspace is reused, never duplicated', () => {
    const a = ideasTabFor({ ideaId: 'tq-1' })
    const b = ideasTabFor({ ideaId: 'tq-2', focus: 'thesis' })
    expect(a.id).toBe('ideas-v2')
    expect(b.id).toBe(a.id)
    expect(b.data).toMatchObject({ selectedIdeaId: 'tq-2', focus: 'thesis' })
  })

  it('stops delivering after unsubscribe', () => {
    const seen: any[] = []
    const off = subscribeToOpenIdea(r => seen.push(r))
    off()
    openIdea({ ideaId: 'tq-1' })
    expect(seen).toHaveLength(0)
  })
})

describe('decision verb honesty', () => {
  it('says Decide only when a decision can actually be recorded here', () => {
    const ready = idea({ stage: 'ready_for_decision', maturity: 'decision_ready' })
    expect(primaryActionFor(ready, undefined, true)).toBe('Decide')
    // No completable decision -> the weaker verb, because looking is all the
    // surface can honestly offer.
    expect(primaryActionFor(ready, undefined, false)).toBe('Review decision')
    expect(primaryActionFor(ready, undefined)).toBe('Review decision')
  })

  it('does not promise Decide from the scan, which cannot know', () => {
    const deciding = idea({ stage: 'deciding', maturity: 'deciding' })
    expect(primaryActionFor(deciding, undefined, false)).toBe('Review decision')
  })

  it('leaves non-decision verbs unaffected by decision capability', () => {
    expect(primaryActionFor(idea({ maturity: 'researching' }), undefined, true)).toBe('Advance research')
    expect(primaryActionFor(idea({ maturity: 'thesis_forming' }), undefined, true)).toBe('Advance thesis')
  })
})
