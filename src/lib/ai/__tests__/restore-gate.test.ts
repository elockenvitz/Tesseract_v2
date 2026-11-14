/**
 * The first open must not claim "there is nothing here" before it has looked.
 *
 * Each case below is one of the frames the pane actually painted when opening
 * the assistant on an asset that already had a conversation. The sequence test
 * at the bottom is the one that matters: it walks the real arrival order and
 * asserts the gate never opens early.
 */
import { describe, it, expect } from 'vitest'
import { isThreadSettling, type RestoreGateInput } from '../restore-gate'

/** Nothing in flight, nothing bound: the state after everything has landed. */
const settled: RestoreGateInput = {
  messageCount: 0,
  initialTagCount: 0,
  openTagCount: 0,
  hasConversation: false,
  isFetchingClaimedTranscript: false,
  isLoadingList: false,
  isLoadingConversationTags: false,
  isLoadingTagLabels: false,
}

describe('isThreadSettling', () => {
  it('opens immediately for an unbound pane', () => {
    /* Opened from the header with no asset in context. There is nothing to
       restore, so holding the prompts back would be a stall with no payoff. */
    expect(isThreadSettling(settled)).toBe(false)
  })

  it('holds while the conversation list is still loading on a bound pane', () => {
    expect(isThreadSettling({ ...settled, initialTagCount: 1, isLoadingList: true })).toBe(true)
  })

  it('holds while the list is loaded but its tag rows are not', () => {
    /* The frame that produced paint 2. The match is made on tags: with the
       rows missing every candidate looks untagged and matches nothing, so the
       pane concluded "no prior conversation" from incomplete data. */
    expect(isThreadSettling({
      ...settled, initialTagCount: 1, isLoadingList: false, isLoadingConversationTags: true,
    })).toBe(true)
  })

  it('holds while a claimed transcript is in flight', () => {
    /* `conversationId` is already set here, so the thread branch is chosen and
       `messages` is still empty: without this the pane shows the empty state
       for a conversation it is in the middle of reading. */
    expect(isThreadSettling({
      ...settled, initialTagCount: 1, hasConversation: true,
      isFetchingClaimedTranscript: true,
    })).toBe(true)
  })

  it('holds while the open conversation’s tag labels are loading', () => {
    /* Paint 1 to paint 2: the prompts are written from these labels, and
       without them they say "asset" where they should say "AAPL". */
    expect(isThreadSettling({ ...settled, openTagCount: 1, isLoadingTagLabels: true })).toBe(true)
  })

  it('does not hold for labels when no tag is bound', () => {
    expect(isThreadSettling({ ...settled, openTagCount: 0, isLoadingTagLabels: true })).toBe(false)
  })

  it('does not hold for a list load when nothing was bound to restore', () => {
    expect(isThreadSettling({ ...settled, initialTagCount: 0, isLoadingList: true })).toBe(false)
  })

  it('opens once the lookup finished and found nothing', () => {
    /* The honest empty state: we looked, there is no prior conversation on
       this asset, here are some questions. */
    expect(isThreadSettling({ ...settled, initialTagCount: 1 })).toBe(false)
  })

  it('never holds once the thread has content, whatever else is in flight', () => {
    /* The upper bound. Every flag set at once, which no real sequence
       produces, standing in for any future path that leaves one stuck. */
    expect(isThreadSettling({
      messageCount: 2,
      initialTagCount: 1,
      openTagCount: 1,
      hasConversation: true,
      isFetchingClaimedTranscript: true,
      isLoadingList: true,
      isLoadingConversationTags: true,
      isLoadingTagLabels: true,
    })).toBe(false)
  })

  it('holds across the whole real arrival sequence and opens exactly once', () => {
    /*
      The observed order when opening the pane on AAPL, which already had a
      conversation. Before this gate, frames 1 and 2 painted the empty state
      and frame 4 replaced it with a thread.
    */
    const frames: Array<[string, RestoreGateInput]> = [
      ['nothing has answered', {
        ...settled, initialTagCount: 1, openTagCount: 1,
        isLoadingList: true, isLoadingConversationTags: true, isLoadingTagLabels: true,
      }],
      ['list landed, tag rows did not', {
        ...settled, initialTagCount: 1, openTagCount: 1,
        isLoadingConversationTags: true, isLoadingTagLabels: true,
      }],
      ['candidate matched, transcript claimed', {
        ...settled, initialTagCount: 1, openTagCount: 1,
        hasConversation: true, isFetchingClaimedTranscript: true,
      }],
      ['transcript landed', {
        ...settled, messageCount: 6, initialTagCount: 1, openTagCount: 1, hasConversation: true,
      }],
    ]

    const held = frames.map(([, f]) => isThreadSettling(f))
    expect(held).toEqual([true, true, true, false])

    /* One transition, and it is the last one. A second `false` anywhere
       earlier is a frame showing the reader something untrue.

       Phrasing note: `vitest.config.ts` sorts node tests from jsdom ones with
       a regex over the source text, and one of its hints is the testing
       library's query object followed by a dot. Ordinary prose can spell that
       by accident, which silently moves a pure test into a browser
       environment it has no use for. Hence the careful wording here. */
    expect(held.filter(h => !h)).toHaveLength(1)
    /* Indexed rather than `.at(-1)`: this project's `lib` is below ES2022. */
    expect(held[held.length - 1]).toBe(false)
  })
})
