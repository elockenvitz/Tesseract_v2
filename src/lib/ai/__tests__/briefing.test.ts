/**
 * A briefing is about what the page is already flagging.
 *
 * ── What these protect ───────────────────────────────────────────────────
 *
 * Two things, and the second is the one that would actually go wrong.
 *
 * The first is that the briefing and the attention band cannot disagree. They
 * are fed from one resolver, so the test is that the question names the
 * signals it was handed rather than describing the asset in general.
 *
 * The second is manufactured concern. On a quiet name a model asked to
 * "review this asset" will find something to report, because that is what
 * being asked implies. The question has to make "nothing has changed" an
 * acceptable answer out loud, and the cache has to be keyed so a briefing
 * written before a recommendation arrived is never served after it does.
 */
import { describe, it, expect } from 'vitest'
import {
  briefingContextFor,
  briefingQuestion,
  briefingKey,
  briefingHandoffDraft,
  BRIEFING_TITLE,
  BRIEFING_INTENT,
  SIGNALS_IN_BRIEFING,
  type BriefingContext,
} from '../briefing'
import type { WorkspaceSignal, WorkspaceState } from '../../asset-workspace/context'

const ALL_STATES: WorkspaceState[] = [
  'decision-pending', 'position-monitored', 'position-unexplained',
  'research-active', 'research-unstarted', 'unowned',
]

const signal = (over: Partial<WorkspaceSignal> = {}): WorkspaceSignal => ({
  id: 'pending-p1-buy',
  kind: 'pending',
  headline: 'A buy in Core Growth is waiting on a decision',
  destination: 'decisions',
  evidence: [{ label: 'Request: buy', table: 'decision_requests', id: 'dr1' }],
  weight: 110,
  ...over,
})

describe('which situation the reader is in', () => {
  it('is decision preparation exactly when something is waiting on a human', () => {
    expect(briefingContextFor('decision-pending')).toBe('decision')
    for (const s of ALL_STATES.filter(s => s !== 'decision-pending')) {
      expect(briefingContextFor(s), s).toBe('review')
    }
  })

  it('is total over the state union, so a new state cannot fall through', () => {
    /* `briefingContextFor` takes the union, so a new member is a type error at
       its call sites rather than a silent default. This asserts the runtime
       half: every state today resolves to one of exactly two contexts. */
    const got = new Set(ALL_STATES.map(briefingContextFor))
    expect([...got].sort()).toEqual(['decision', 'review'])
  })

  it('names and explains both contexts, with nothing shared between them', () => {
    const contexts: BriefingContext[] = ['decision', 'review']
    for (const c of contexts) {
      expect(BRIEFING_TITLE[c]).toBeTruthy()
      expect(BRIEFING_INTENT[c]).toBeTruthy()
    }
    expect(BRIEFING_TITLE.decision).not.toBe(BRIEFING_TITLE.review)
    expect(BRIEFING_INTENT.decision).not.toBe(BRIEFING_INTENT.review)
  })
})

describe('the question is about this page, not this company', () => {
  it('names the signals the band is already showing', () => {
    const q = briefingQuestion({
      context: 'decision',
      symbol: 'AAPL',
      state: 'decision-pending',
      signals: [
        signal(),
        signal({ id: 'contradiction-rating-dr1', headline: 'Rated underweight by 3 of 5, with a pending buy in Core Growth' }),
      ],
    })
    expect(q).toContain('A buy in Core Growth is waiting on a decision')
    expect(q).toContain('Rated underweight by 3 of 5, with a pending buy in Core Growth')
    expect(q).toMatch(/address these specifically rather than in general/)
  })

  it('carries at most the signals the band leads with', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      signal({ id: `s${i}`, headline: `Signal number ${i}` }))
    const q = briefingQuestion({ context: 'review', symbol: 'AAPL', state: 'research-active', signals: many })
    const named = many.filter(s => q.includes(s.headline))
    expect(named).toHaveLength(SIGNALS_IN_BRIEFING)
    /* The leading ones, which the resolver already ranked. */
    expect(q).toContain('Signal number 0')
    expect(q).not.toContain('Signal number 7')
  })

  it('tells the model to read the firm s records rather than recall the company', () => {
    const q = briefingQuestion({ context: 'review', symbol: 'AAPL', state: 'unowned', signals: [] })
    expect(q).toMatch(/Do not answer from general knowledge about the company/)
  })

  it('still works, and names nothing it does not have, without a symbol', () => {
    const q = briefingQuestion({ context: 'review', symbol: null, state: 'unowned', signals: [] })
    expect(q).toContain('this asset')
    expect(q).not.toMatch(/\bnull\b|\bundefined\b/)
  })
})

describe('a quiet name is allowed to be quiet', () => {
  it('makes "nothing is flagged" an answer rather than a silence to fill', () => {
    /* The failure this prevents: a model asked to review an asset will find
       something to report, because being asked implies there is something. */
    const q = briefingQuestion({
      context: 'review', symbol: 'AAPL', state: 'position-monitored', signals: [],
    })
    expect(q).toMatch(/flagging nothing/)
    expect(q).toMatch(/that is the answer/)
  })

  it('says so in the review framing too, not only when signals are absent', () => {
    const q = briefingQuestion({
      context: 'review', symbol: 'AAPL', state: 'position-monitored', signals: [signal()],
    })
    expect(q).toMatch(/If nothing material has changed, say so in one line rather than finding something to report/)
  })

  it('asks the decision briefing to state what is missing, not to supply it', () => {
    const q = briefingQuestion({
      context: 'decision', symbol: 'AAPL', state: 'decision-pending', signals: [signal()],
    })
    expect(q).toMatch(/what is NOT on record/)
    expect(q).toMatch(/strongest argument against acting/)
  })
})

describe('the cache cannot serve a briefing about a different page', () => {
  const base = { assetId: 'a1', context: 'decision' as BriefingContext }

  it('changes when the signals change', () => {
    /* The real case: a briefing written before a recommendation arrived
       describes a page the reader is no longer looking at. */
    const before = briefingKey({ ...base, signals: [] })
    const after = briefingKey({ ...base, signals: [signal()] })
    expect(before).not.toEqual(after)
  })

  it('is the same key for the same page, so it does not regenerate on a render', () => {
    expect(briefingKey({ ...base, signals: [signal()] }))
      .toEqual(briefingKey({ ...base, signals: [signal()] }))
  })

  it('ignores a headline that restated the same signal differently', () => {
    /*
     * Keyed on ids, not text. A headline carries counts and dates that move
     * without changing what the briefing is about, and re-running a model
     * call because a day counter ticked is waste the reader pays for.
     */
    const a = briefingKey({ ...base, signals: [signal({ headline: 'waiting 9 days' })] })
    const b = briefingKey({ ...base, signals: [signal({ headline: 'waiting 10 days' })] })
    expect(a).toEqual(b)
  })

  it('separates the two contexts and the two assets', () => {
    const s = [signal()]
    expect(briefingKey({ assetId: 'a1', context: 'decision', signals: s }))
      .not.toEqual(briefingKey({ assetId: 'a1', context: 'review', signals: s }))
    expect(briefingKey({ assetId: 'a1', context: 'decision', signals: s }))
      .not.toEqual(briefingKey({ assetId: 'a2', context: 'decision', signals: s }))
  })
})

describe('carrying a briefing into the chat pane', () => {
  it('hands over the framing, never the briefing s own prose', () => {
    /*
     * The honest half of continuity. Pasting the answer in as if the reader
     * had typed it would strip its evidence trail and turn a sourced figure
     * into an unsourced assertion the model then builds on.
     */
    const draft = briefingHandoffDraft({
      context: 'decision', symbol: 'AAPL', state: 'decision-pending', signals: [signal()],
    })
    expect(draft).toContain('AAPL')
    expect(draft).not.toContain(signal().headline)
    expect(draft.endsWith('?')).toBe(true)
  })

  it('asks a different follow-up in each context', () => {
    const d = briefingHandoffDraft({ context: 'decision', symbol: 'AAPL', state: 'decision-pending', signals: [] })
    const r = briefingHandoffDraft({ context: 'review', symbol: 'AAPL', state: 'research-active', signals: [] })
    expect(d).not.toBe(r)
    expect(d).toMatch(/rule on/)
    expect(r).toMatch(/review/)
  })

  it('names no symbol it was not given', () => {
    const draft = briefingHandoffDraft({ context: 'review', symbol: null, state: 'unowned', signals: [] })
    expect(draft).toContain('this asset')
    expect(draft).not.toMatch(/\bnull\b|\bundefined\b/)
  })
})
