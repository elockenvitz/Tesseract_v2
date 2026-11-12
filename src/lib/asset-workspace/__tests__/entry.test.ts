/**
 * The entry reason, read off the descriptor the shell actually delivers.
 *
 * These fixtures are the real payloads: `assetTabFor` builds the first three,
 * and the Process dashboard's `{ workflowId, stageId, requirementId }` is the
 * fourth. A fixture invented here would let the resolver agree with a payload
 * nothing sends.
 */
import { describe, it, expect } from 'vitest'
import { resolveEntry, effectiveMode, GENERAL_ENTRY } from '../entry'
import { assetTabFor } from '../../desktop-asset/navigate'

describe('a plain open', () => {
  it('is general', () => {
    const { data } = assetTabFor({ assetId: 'a-1', symbol: 'AAPL' })
    expect(resolveEntry(data).mode).toBe('general')
  })

  it('is general with no descriptor at all', () => {
    /* A tab restored from a session written before any of this existed. */
    expect(resolveEntry(null)).toEqual(GENERAL_ENTRY)
    expect(resolveEntry(undefined).mode).toBe('general')
  })

  it('stays general when sent to read the case', () => {
    /*
     * The distinction the mode set turns on. Research and Ideas both send
     * `focus: 'research'`, and a reader sent to read a thesis is reviewing
     * the name -- the landing sub-page differs, the situation does not. If
     * this ever returns 'work', every asset opened from the Research lens
     * gets a process block it did not ask for.
     */
    const { data } = assetTabFor({
      assetId: 'a-1', symbol: 'AAPL', focus: 'research', origin: 'research',
    })
    expect(resolveEntry(data).mode).toBe('general')
  })
})

describe('arriving to rule on something', () => {
  it('is a decision when the sender named the request', () => {
    const entry = resolveEntry({ ...assetTabFor({ assetId: 'a-1' }).data, decisionId: 'dr-7' })
    expect(entry.mode).toBe('decision')
    expect(entry.decisionId).toBe('dr-7')
  })

  it('is a decision when the sender only named the destination', () => {
    /* A surface that knows the reader is deciding but not which request. The
       page can still lead with what is waiting; it just cannot point at one
       row. */
    const entry = resolveEntry(assetTabFor({
      assetId: 'a-1', focus: 'decisions', origin: 'decisions',
    }).data)
    expect(entry.mode).toBe('decision')
    expect(entry.decisionId).toBeNull()
  })

  it('is not a decision merely because a decisions lens sent them', () => {
    /*
     * `DecisionDetail` sends a reader from a DECIDED record with
     * `focus: 'research'` -- "go and read the case". Reading its origin as a
     * decision entry would lead that page with whatever unrelated request
     * happens to be open on the name. The origin is provenance, not intent.
     */
    const entry = resolveEntry(assetTabFor({
      assetId: 'a-1', focus: 'research', origin: 'decisions',
    }).data)
    expect(entry.mode).toBe('general')
    expect(entry.origin).toBe('decisions')
  })

  it('carries the book the sender was looking at it from', () => {
    const entry = resolveEntry({
      ...assetTabFor({ assetId: 'a-1', portfolioId: 'p-1', portfolioName: 'Growth' }).data,
      decisionId: 'dr-7',
    })
    expect(entry.portfolioId).toBe('p-1')
  })

  it('reads the reason whether it arrived as a string or an issue', () => {
    const asString = resolveEntry({ decisionId: 'dr-7', issue: 'Buy request waiting' })
    const asIssue = resolveEntry({
      decisionId: 'dr-7', issue: { title: 'Buy request waiting', detail: 'Raised Tuesday' },
    })
    expect(asString.reason).toBe('Buy request waiting')
    expect(asIssue.reason).toBe('Buy request waiting')
  })

  it('outranks a work destination in the same payload', () => {
    /* Both can be present when a reader is sent from a process to rule on
       the recommendation it produced. The ruling is the blocking thing. */
    const entry = resolveEntry({ decisionId: 'dr-7', workflowId: 'wf-1' })
    expect(entry.mode).toBe('decision')
    expect(entry.work?.workflowId).toBe('wf-1')
  })
})

describe('arriving to advance a process', () => {
  it('is work when the sender named the run', () => {
    const entry = resolveEntry({ workflowId: 'wf-1' })
    expect(entry.mode).toBe('work')
    expect(entry.work).toEqual({ workflowId: 'wf-1', stageId: null, requirementId: null })
  })

  it('keeps the exact requirement, under either of its two spellings', () => {
    const current = resolveEntry({ workflowId: 'wf-1', stageId: 's-2', requirementId: 'ci-3' })
    const legacy = resolveEntry({ workflowId: 'wf-1', stageId: 's-2', taskId: 'ci-3' })
    expect(current.work?.requirementId).toBe('ci-3')
    expect(legacy.work?.requirementId).toBe('ci-3')
  })

  it('is not work when only a stage or a task survived', () => {
    /* A requirement row is per-run, so an id without its run is
       unresolvable. `destinationFromTabData` drops it rather than guessing,
       and the mode must not promise a process the page cannot open. */
    expect(resolveEntry({ stageId: 's-2' }).mode).toBe('general')
    expect(resolveEntry({ taskId: 'ci-3' }).mode).toBe('general')
  })
})

describe('junk in the descriptor', () => {
  it('does not become a mode', () => {
    /* Tab data is persisted and merged by many senders; a non-string here is
       a bug somewhere else, not a reason to compose a different page. */
    expect(resolveEntry({ decisionId: 42, workflowId: {} as unknown }).mode).toBe('general')
    expect(resolveEntry({ decisionId: '', workflowId: '  ' }).mode).toBe('general')
  })
})

describe('the record is gone by the time the page looks', () => {
  const decision = resolveEntry({ decisionId: 'dr-7' })
  const work = resolveEntry({ workflowId: 'wf-1' })

  it('falls back to general when the request has been ruled on', () => {
    /*
     * The reader follows a day-old link. Leading the page with a block about
     * a request nobody is waiting on is worse than the general page they
     * would otherwise have seen.
     */
    expect(effectiveMode(decision, { openDecisionCount: 0, hasWork: false })).toBe('general')
    expect(effectiveMode(decision, { openDecisionCount: 1, hasWork: false })).toBe('decision')
  })

  it('falls back to general when the run is no longer there', () => {
    expect(effectiveMode(work, { openDecisionCount: 0, hasWork: false })).toBe('general')
    expect(effectiveMode(work, { openDecisionCount: 0, hasWork: true })).toBe('work')
  })

  it('never promotes a general entry, whatever is on the name', () => {
    /* An asset with a waiting decision does not make a general open into a
       decision entry: the attention band already says a decision is
       waiting, and "the reader came here for it" is a different claim. */
    expect(effectiveMode(GENERAL_ENTRY, { openDecisionCount: 3, hasWork: true })).toBe('general')
  })
})
