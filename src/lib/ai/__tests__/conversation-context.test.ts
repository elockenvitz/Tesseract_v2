/**
 * Which conversation a message would join, and whether the pane says so.
 *
 * ── The measured defect ─────────────────────────────────────────────────
 *
 * On the running app: resume AAPL's thread from AAPL Work, then open MSFT.
 * The pane kept AAPL's conversation and still read "CONTEXT ALREADY SUPPLIED
 * TO THE MODEL — Asset AAPL" while the page said MSFT, because the pane's
 * subject comes from the engagement target and `Layout` never clears it. A
 * message typed there joined the AAPL thread with nothing on screen saying so.
 *
 * The fix is not to move the conversation — threads that span companies are
 * real investigations. It is to compare the OPEN conversation's own tags
 * against the ACTIVE TAB and, when they diverge, say which thread is open and
 * offer the other choice by name.
 */
import { describe, it, expect } from 'vitest'
import { conversationContextState, describeSendTarget, shortSubjectLabel, subjectsAgree, subjectTag } from '../conversation-context'

const AAPL = { type: 'asset', id: 'aapl-id', label: 'AAPL' }
const MSFT = { type: 'asset', id: 'msft-id', label: 'MSFT' }

const tag = (id: string, type = 'asset') => ({ type, id })

describe('no conversation open', () => {
  it('is empty, whatever the page is', () => {
    expect(conversationContextState({
      conversationId: null, conversationTags: [], currentSubject: MSFT,
    })).toBe('empty')
  })

  it('says a message would start a new conversation', () => {
    expect(describeSendTarget('empty', null)).toBe('Starts a new conversation.')
  })
})

describe('the open conversation belongs here', () => {
  it('matches when the current asset is one of its tags', () => {
    expect(conversationContextState({
      conversationId: 'c1', conversationTags: [tag('aapl-id')], currentSubject: AAPL,
    })).toBe('matches')
  })

  it('matches a multi-asset thread from either of its assets', () => {
    // A thread comparing AAPL and MSFT is an investigation, not a mistake.
    const tags = [tag('aapl-id'), tag('msft-id')]
    expect(conversationContextState({ conversationId: 'c1', conversationTags: tags, currentSubject: AAPL })).toBe('matches')
    expect(conversationContextState({ conversationId: 'c1', conversationTags: tags, currentSubject: MSFT })).toBe('matches')
  })

  it('does not match an id that belongs to a different kind of object', () => {
    // Same uuid as a portfolio tag is not the asset.
    expect(conversationContextState({
      conversationId: 'c1',
      conversationTags: [{ type: 'portfolio', id: 'aapl-id' }],
      currentSubject: AAPL,
    })).toBe('foreign')
  })
})

describe('the open conversation is about something else', () => {
  it('is foreign when the current asset is not among its tags', () => {
    expect(conversationContextState({
      conversationId: 'c1', conversationTags: [tag('aapl-id')], currentSubject: MSFT,
    })).toBe('foreign')
  })

  it('names the thread a message would actually join', () => {
    expect(describeSendTarget('foreign', "Apple's AI Monetization"))
      .toBe('Continues “Apple\'s AI Monetization”.')
  })

  it('still names it when the thread has no title', () => {
    expect(describeSendTarget('foreign', '   ')).toBe('Continues the open conversation.')
    expect(describeSendTarget('foreign', null)).toBe('Continues the open conversation.')
  })
})

describe('it does not cry wolf', () => {
  it('stays quiet on a page that binds nothing', () => {
    // A dashboard or a list has no second subject to confuse the first with.
    expect(conversationContextState({
      conversationId: 'c1', conversationTags: [tag('aapl-id')], currentSubject: null,
    })).toBe('matches')
  })

  it('stays quiet while the conversation\'s tags are still loading', () => {
    /*
     * `selectConversation` sets the id and the tags from two places. An
     * empty array during that gap would flash "this is about something
     * else" at a thread that is about exactly this.
     */
    expect(conversationContextState({
      conversationId: 'c1', conversationTags: [], currentSubject: MSFT,
    })).toBe('matches')
    expect(conversationContextState({
      conversationId: 'c1', conversationTags: null, currentSubject: MSFT,
    })).toBe('matches')
  })

  it('stays quiet when the current subject is half-formed', () => {
    expect(conversationContextState({
      conversationId: 'c1', conversationTags: [tag('aapl-id')],
      currentSubject: { type: 'asset', id: '' },
    })).toBe('matches')
  })
})

describe('the short subject name', () => {
  it('takes the ticker half of a tab title', () => {
    // Tab titles are "MSFT - Microsoft Corporation", which reads badly
    // inside "Start one about …".
    expect(shortSubjectLabel('MSFT - Microsoft Corporation')).toBe('MSFT')
  })

  it('leaves a label that has no such shape alone', () => {
    expect(shortSubjectLabel('Growth Composite')).toBe('Growth Composite')
  })

  it('invents no name when there is none', () => {
    expect(shortSubjectLabel(null)).toBeNull()
    expect(shortSubjectLabel('   ')).toBeNull()
  })

  it('does not strip a hyphen that is part of the name', () => {
    // " - " with spaces is the separator; "Coca-Cola" is not two things.
    expect(shortSubjectLabel('Coca-Cola')).toBe('Coca-Cola')
  })
})

describe('the bound-object header must describe where the reader is', () => {
  it('agrees when the target is the page', () => {
    expect(subjectsAgree({ type: 'asset', id: 'aapl-id' }, AAPL)).toBe(true)
  })

  it('disagrees once the reader has walked away', () => {
    /*
     * The second half of the defect. With no conversation open the state is
     * `empty`, not `foreign` — there is no thread — but the header still
     * announced "context already supplied: Asset AAPL" on an MSFT page.
     */
    expect(subjectsAgree({ type: 'asset', id: 'aapl-id' }, MSFT)).toBe(false)
  })

  it('treats an absent side as agreement, not conflict', () => {
    // A dashboard has no subject to contradict; a pane with nothing bound
    // contradicts nothing.
    expect(subjectsAgree(null, MSFT)).toBe(true)
    expect(subjectsAgree({ type: 'asset', id: 'aapl-id' }, null)).toBe(true)
  })
})

describe('beginning in the current context tags the current thing', () => {
  it('builds the tag for the page the reader is on', () => {
    // `newConversation` alone resets to initialTags, which derive from the
    // SAME stale target — so "Start one about MSFT" would have started a
    // thread tagged AAPL. The tag is set explicitly instead.
    expect(subjectTag(MSFT)).toEqual({ type: 'asset', id: 'msft-id', label: 'MSFT' })
  })

  it('shortens a tab title for the label', () => {
    expect(subjectTag({ type: 'asset', id: 'x', label: 'MSFT - Microsoft Corporation' }))
      .toEqual({ type: 'asset', id: 'x', label: 'MSFT' })
  })

  it('omits a label it does not have rather than inventing one', () => {
    expect(subjectTag({ type: 'asset', id: 'x' })).toEqual({ type: 'asset', id: 'x' })
  })

  it('refuses a kind the tag table does not understand', () => {
    /*
     * `tag_type` understands four kinds. A fifth would be stored, shown,
     * and silently ignored by the function that assembles context — a tag
     * that looks present and contributes nothing.
     */
    expect(subjectTag({ type: 'decision', id: 'd1' })).toBeNull()
    expect(subjectTag({ type: 'trade_idea', id: 'i1' })).toBeNull()
    expect(subjectTag(null)).toBeNull()
  })

  it('accepts each kind the tag table does understand', () => {
    for (const type of ['asset', 'portfolio', 'theme', 'note']) {
      expect(subjectTag({ type, id: 'x' })?.type).toBe(type)
    }
  })
})
