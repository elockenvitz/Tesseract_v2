/**
 * The first candidate that exists because of what the reader did.
 *
 * Every other producer fires on the state of a row. This one compares two
 * durable facts -- when you last opened a name, and when research on it last
 * arrived -- and says nothing at all unless both are present.
 *
 * The load-bearing half of this suite is the lifecycle: the finding must stop
 * being true when the reader opens the asset, and become true again when
 * something arrives after that visit. Nothing dismisses it; it is simply not
 * produced. A producer that kept emitting after the visit would ask the same
 * question every morning, which is the defect the view cursor exists to end.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  researchChangedSinceViewCandidates,
  evaluateResearchChangedSinceView,
  RESEARCH_CHANGED_SINCE_VIEW_KIND,
  type ViewedResearchSubject,
} from '../../../engine/decisionEngine/evaluators/researchChangedSinceView'
import { runGlobalDecisionEngine } from '../../../engine/decisionEngine/globalDecisionEngine'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const VIEWED = '2026-09-10T12:00:00.000Z'
const BEFORE = '2026-09-08T12:00:00.000Z'
const AFTER = '2026-09-12T12:00:00.000Z'
const LATER = '2026-09-14T12:00:00.000Z'

const subject = (over: Partial<ViewedResearchSubject> = {}): ViewedResearchSubject => ({
  assetId: 'a1',
  symbol: 'AAPL',
  companyName: 'Apple Inc.',
  newestEvidenceAt: AFTER,
  evidenceDates: [BEFORE, AFTER],
  ...over,
})

const cursors = (...pairs: [string, string][]) => new Map(pairs)

const run = (over: Parameters<typeof researchChangedSinceViewCandidates>[0] = {}) =>
  researchChangedSinceViewCandidates({
    subjects: [subject()],
    viewCursors: cursors(['a1', VIEWED]),
    organizationId: 'org-1',
    ...over,
  })

describe('eligibility needs both halves of the comparison', () => {
  /* Never opened is not "neglected". There is no "since" to measure from, and
     inventing one would be the age threshold this pass deliberately omits. */
  it('says nothing about an asset with no prior cursor', () => {
    expect(run({ viewCursors: cursors() })).toEqual([])
    expect(run({ viewCursors: cursors(['other-asset', VIEWED]) })).toEqual([])
  })

  it('says nothing when the visit is newer than every piece of evidence', () => {
    expect(run({ subjects: [subject({ newestEvidenceAt: BEFORE })] })).toEqual([])
  })

  /* Evidence stamped at the moment of the visit was on screen during it.
     Strictly-after, not at-or-after. */
  it('says nothing when the newest evidence is exactly the visit', () => {
    expect(run({ subjects: [subject({ newestEvidenceAt: VIEWED })] })).toEqual([])
  })

  it('says nothing about a name with no research at all', () => {
    expect(run({ subjects: [subject({ newestEvidenceAt: null })] })).toEqual([])
  })

  it('produces exactly one candidate when evidence arrived after the visit', () => {
    const c = run()
    expect(c).toHaveLength(1)
    expect(c[0].kind).toBe(RESEARCH_CHANGED_SINCE_VIEW_KIND)
    expect(c[0].subjectType).toBe('asset')
    expect(c[0].subjectId).toBe('a1')
    expect(c[0].organizationId).toBe('org-1')
  })

  it('says nothing when there is nothing to compare', () => {
    expect(researchChangedSinceViewCandidates({})).toEqual([])
  })
})

describe('the claim is made of real timestamps and real counts', () => {
  it('dates the claim from the evidence, not from the run', () => {
    expect(run()[0].occurredAt).toBe(AFTER)
  })

  it('reports the cursor and the evidence date it compared', () => {
    const f = run()[0].facts!
    expect(f.lastViewedAt).toBe(VIEWED)
    expect(f.newestEvidenceAt).toBe(AFTER)
  })

  /* Counted against the CURSOR, not against the thesis date. `BEFORE` was
     already read; only `AFTER` and `LATER` are new. */
  it('counts only the items that arrived after the visit', () => {
    const c = run({
      subjects: [subject({ newestEvidenceAt: LATER, evidenceDates: [BEFORE, AFTER, LATER] })],
    })
    expect(c[0].facts?.newItemsSinceView).toBe(2)
    expect(c[0].reason).toBe('2 new research items on AAPL since you last opened it.')
  })

  it('says one item, not 1 items', () => {
    expect(run()[0].reason).toBe('1 new research item on AAPL since you last opened it.')
  })

  /* An unknown count is left out of the claim rather than guessed at. */
  it('makes the claim without a count when the dates were not loaded', () => {
    const c = run({ subjects: [subject({ evidenceDates: undefined })] })
    expect(c[0].facts?.newItemsSinceView).toBeNull()
    expect(c[0].reason).toBe('New research on AAPL since you last opened it.')
  })

  it('falls back to the company name, then to neither', () => {
    expect(run({ subjects: [subject({ symbol: null })] })[0].reason)
      .toContain('Apple Inc.')
    expect(run({ subjects: [subject({ symbol: null, companyName: null })] })[0].reason)
      .toContain('this name')
  })
})

describe('identity and provenance', () => {
  it('keys on the asset, unchanged by how much evidence arrived', () => {
    const one = run()[0]
    const many = run({
      subjects: [subject({ newestEvidenceAt: LATER, evidenceDates: [AFTER, LATER] })],
    })[0]
    expect(one.id).toBe('research-changed-a1')
    expect(many.id).toBe(one.id)
  })

  it('is stable across regeneration', () => {
    expect(run()).toEqual(run())
  })

  it('names the producer and the authoritative source', () => {
    const p = run()[0].provenance
    expect(p.producer).toBe('evaluator:researchChangedSinceView')
    expect(p.sourceType).toBe('asset_notes')
    expect(p.sourceId).toBe('a1')
  })

  /* Non-urgent by construction. Nobody is late for information. */
  it('is information, not work owed', () => {
    expect(run()[0].severity).toBe('info')
  })

  /* No AI, no inference about what the evidence means. Asserted against the
     producer's declarations, which is where such a thing would have to live. */
  it('summarises nothing', () => {
    const body = src('engine/decisionEngine/evaluators/researchChangedSinceView.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    for (const smell of ['generate', 'summar', 'openai', 'anthropic', 'bullish', 'bearish']) {
      expect(body.toLowerCase()).not.toContain(smell)
    }
  })
})

describe('clicking it opens the right asset, and says why', () => {
  const action = run()[0].actions![0]

  it('opens Research on the asset the claim is about', () => {
    expect(action.actionKey).toBe('OPEN_RESEARCH_SUBJECT')
    expect(action.payload?.assetId).toBe('a1')
  })

  it('carries the reason the reader was sent', () => {
    expect(action.payload?.issue).toBe('New research since you last looked')
    expect(action.payload?.origin).toBe('today')
    expect(action.payload?.focus).toBe('evidence')
  })

  /* The dispatcher must route through the typed Research handoff, which is
     what actually opens the detail -- and opening the detail is what advances
     the cursor and makes this finding stop being true. */
  it('is routed through the typed research handoff', () => {
    const dispatcher = src('engine/decisionEngine/dispatchDecisionAction.ts')
    expect(dispatcher).toContain("case 'OPEN_RESEARCH_SUBJECT':")
    expect(dispatcher).toContain('researchTabFor({')
  })
})

describe('the lifecycle: it stops being true when you look', () => {
  const evidence = { newestEvidenceAt: AFTER, evidenceDates: [BEFORE, AFTER] }

  it('qualifies while the cursor predates the evidence', () => {
    expect(run({ subjects: [subject(evidence)] })).toHaveLength(1)
  })

  /* The visit advanced the cursor past the evidence. Same evidence, same
     producer, nothing dismissed -- it simply is not produced. */
  it('stops qualifying once the cursor advances past that evidence', () => {
    const afterVisit = run({
      subjects: [subject(evidence)],
      viewCursors: cursors(['a1', '2026-09-13T12:00:00.000Z']),
    })
    expect(afterVisit).toEqual([])
  })

  it('qualifies again when something arrives after that visit', () => {
    const c = run({
      subjects: [subject({ newestEvidenceAt: LATER, evidenceDates: [BEFORE, AFTER, LATER] })],
      viewCursors: cursors(['a1', '2026-09-13T12:00:00.000Z']),
    })
    expect(c).toHaveLength(1)
    // Same id as before the visit: the claim returned, it did not fork.
    expect(c[0].id).toBe('research-changed-a1')
    expect(c[0].facts?.newItemsSinceView).toBe(1)
  })
})

describe('Today is not re-ranked to make room for it', () => {
  const engineArgs = {
    userId: 'u1',
    role: 'analyst',
    coverage: { assetIds: [], portfolioIds: [] },
    now: new Date('2026-09-16T12:00:00Z'),
  }

  it('lands on the intel surface, never the action queue', () => {
    const items = evaluateResearchChangedSinceView({
      subjects: [subject()],
      viewCursors: cursors(['a1', VIEWED]),
      organizationId: 'org-1',
    })
    expect(items).toHaveLength(1)
    expect(items[0].surface).toBe('intel')
    expect(items[0].titleKey).toBe(RESEARCH_CHANGED_SINCE_VIEW_KIND)
    expect(items[0].id).toBe('research-changed-a1')
    // Quieter than any colour the action evaluators use.
    expect(items[0].severity).toBe('blue')
  })

  /* Urgent work is on a different surface, so no amount of research can
     outrank it. Asserted through the real engine, not the evaluator. */
  it('cannot displace an overdue trade decision', () => {
    const withoutResearch = runGlobalDecisionEngine({
      ...engineArgs,
      data: {
        tradeReviewObligations: [{
          id: 'o1', subject_id: 't1', organization_id: 'org-1', owner_id: 'pm-1',
          raised_at: '2026-08-01T12:00:00Z', due_at: '2026-08-05T12:00:00Z',
        }],
      },
    })
    const withResearch = runGlobalDecisionEngine({
      ...engineArgs,
      data: {
        tradeReviewObligations: [{
          id: 'o1', subject_id: 't1', organization_id: 'org-1', owner_id: 'pm-1',
          raised_at: '2026-08-01T12:00:00Z', due_at: '2026-08-05T12:00:00Z',
        }],
        researchSubjects: [subject()],
        assetViewCursors: cursors(['a1', VIEWED]),
        organizationId: 'org-1',
      },
    })

    expect(withResearch.actionItems.map(i => i.id)).toEqual(
      withoutResearch.actionItems.map(i => i.id),
    )
    expect(withResearch.intelItems.map(i => i.id)).toContain('research-changed-a1')
  })

  /* Post-processing dedupes and resolves conflicts BY asset. Without an
     assetId on the item every research candidate would collide under the
     empty key and all but one would silently vanish. */
  it('keeps one finding per asset through post-processing', () => {
    const result = runGlobalDecisionEngine({
      ...engineArgs,
      data: {
        researchSubjects: [
          subject(),
          subject({ assetId: 'a2', symbol: 'MSFT' }),
          subject({ assetId: 'a3', symbol: 'NVDA' }),
        ],
        assetViewCursors: cursors(['a1', VIEWED], ['a2', VIEWED], ['a3', VIEWED]),
        organizationId: 'org-1',
      },
    })
    expect(result.intelItems.map(i => i.id).sort()).toEqual([
      'research-changed-a1', 'research-changed-a2', 'research-changed-a3',
    ])
    expect(result.actionItems).toEqual([])
  })

  it('adds nothing when no one has looked at anything', () => {
    const result = runGlobalDecisionEngine({
      ...engineArgs,
      data: { researchSubjects: [subject()], assetViewCursors: cursors() },
    })
    expect(result.intelItems).toEqual([])
  })
})
