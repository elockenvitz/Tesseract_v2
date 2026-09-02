/**
 * The engagement seam — the contract every surface depends on.
 *
 * Companion to `engagement.test.ts`, which covers binding and the adapters.
 * This file covers what Stage 4C added: a typed result that names what it
 * opened, an affordance resolver that six surfaces share instead of each
 * re-deriving the same two guards, and the stale-binding rule that stops a
 * target from outliving the object it was made for.
 *
 * Everything here is pure or window-level. Nothing renders the pane.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { EngagementTarget } from './types'
import { isEngagementObjectType, ENGAGEMENT_OBJECT_TYPES } from './types'
import { openEngagement, askAI, discuss, subscribeToEngagement } from './open-engagement'
import { engagementAffordances } from './affordances'
import { toPaneContext, targetMatchesContext } from './target'

const AMZN: EngagementTarget = {
  objectType: 'asset',
  objectId: 'asset-amzn',
  label: 'AMZN — Amazon.com',
  symbol: 'AMZN',
}

const MSFT: EngagementTarget = {
  objectType: 'asset',
  objectId: 'asset-msft',
  label: 'MSFT — Microsoft',
  symbol: 'MSFT',
}

/** A research note about AMZN: engageable, but it cannot hold a thread. */
const NOTE: EngagementTarget = {
  objectType: 'research_note',
  objectId: 'note-1',
  label: 'Q3 read-through',
  assetId: 'asset-amzn',
  symbol: 'AMZN',
}

describe('the result names what was opened', () => {
  let received: { target: EngagementTarget; mode: string }[]
  let off: () => void

  beforeEach(() => {
    received = []
    off?.()
    off = subscribeToEngagement(r => received.push(r))
  })

  it('AI engagement reports the object identity and the mode, not just success', () => {
    const result = askAI(AMZN)
    off()

    expect(result).toEqual({
      opened: true,
      mode: 'ai',
      objectType: 'asset',
      objectId: 'asset-amzn',
    })
    // The identity on the wire is the id, never the display string.
    expect(received[0].target.objectId).toBe('asset-amzn')
    expect(received[0].mode).toBe('ai')
  })

  it('Discuss reports the same identity under the other mode', () => {
    const result = discuss(AMZN)
    off()

    expect(result).toEqual({
      opened: true,
      mode: 'discuss',
      objectType: 'asset',
      objectId: 'asset-amzn',
    })
    expect(received[0].mode).toBe('discuss')
  })

  it('names the missing capability rather than hiding it behind a true', () => {
    const result = discuss(NOTE)
    off()

    // It still opened — the pane says why there is no thread, and the caller
    // is told so it never claims a conversation was started.
    expect(result).toEqual({
      opened: true,
      mode: 'discuss',
      objectType: 'research_note',
      objectId: 'note-1',
      limitation: 'discuss-unsupported',
    })
    expect(received).toHaveLength(1)
  })

  it('does not report a limitation when the same object is asked of AI', () => {
    const result = askAI(NOTE)
    off()
    expect(result).toEqual({
      opened: true,
      mode: 'ai',
      objectType: 'research_note',
      objectId: 'note-1',
    })
  })

  it('never substitutes AI for an unsupported Discuss', () => {
    discuss(NOTE)
    off()
    // The mode the user asked for is the mode that travels. Silently opening
    // a model for someone who asked for a colleague would be worse than the
    // explicit "no thread here" the pane shows.
    expect(received[0].mode).toBe('discuss')
  })
})

describe('unsupported object types fail safely', () => {
  let received: unknown[]
  let off: () => void

  beforeEach(() => {
    received = []
    off?.()
    off = subscribeToEngagement(r => received.push(r))
  })

  it('refuses a kind the app does not engage with, and dispatches nothing', () => {
    // An adapter reading an unexpected database row is the real source of
    // this: the union cannot catch it at runtime, so the seam has to.
    const rogue = { objectType: 'spreadsheet', objectId: 'x1', label: 'Model.xlsx' }
    const result = openEngagement(rogue as unknown as EngagementTarget, 'ai')
    off()

    expect(result).toEqual({ opened: false, refused: 'unsupported-type' })
    expect(received).toHaveLength(0)
  })

  it('refuses rather than throws when there is no object at all', () => {
    const result = openEngagement(null as unknown as EngagementTarget, 'ai')
    off()
    expect(result).toEqual({ opened: false, refused: 'no-target' })
    expect(received).toHaveLength(0)
  })

  it('recognises every declared object type and nothing else', () => {
    for (const t of ENGAGEMENT_OBJECT_TYPES) expect(isEngagementObjectType(t)).toBe(true)
    for (const t of ['spreadsheet', '', 'Asset', null, undefined, 7]) {
      expect(isEngagementObjectType(t)).toBe(false)
    }
    off()
  })
})

describe('engagementAffordances — one answer, shared by every surface', () => {
  it('offers both actions for an object that can hold a thread', () => {
    const engage = engagementAffordances(AMZN)
    expect(engage.canAskAI).toBe(true)
    expect(engage.canDiscuss).toBe(true)
    expect(engage.unsupportedType).toBe(false)
    expect(engage.target).toBe(AMZN)
  })

  it('withholds Discuss for an object with nowhere to put the conversation', () => {
    const engage = engagementAffordances(NOTE)
    expect(engage.canAskAI).toBe(true)
    // This is the guard six surfaces used to write out by hand.
    expect(engage.canDiscuss).toBe(false)
  })

  it('is inert for a target that has not resolved yet, instead of throwing', () => {
    const unresolved: (EngagementTarget | null | undefined)[] = [
      null,
      undefined,
      { objectType: 'asset', objectId: '', label: 'x' },
    ]
    for (const empty of unresolved) {
      const engage = engagementAffordances(empty)
      expect(engage.canAskAI).toBe(false)
      expect(engage.canDiscuss).toBe(false)
      expect(engage.target).toBeNull()
      // Callable without a null check — that is what removed the `target!`
      // assertions from the call sites.
      expect(engage.askAI()).toEqual({ opened: false, refused: 'no-target' })
      expect(engage.discuss()).toEqual({ opened: false, refused: 'no-target' })
    }
  })

  it('flags an unsupported kind distinctly from having no object yet', () => {
    const engage = engagementAffordances(
      { objectType: 'spreadsheet', objectId: 'x1', label: 'Model.xlsx' } as unknown as EngagementTarget,
    )
    expect(engage.canAskAI).toBe(false)
    expect(engage.unsupportedType).toBe(true)
    expect(engagementAffordances(null).unsupportedType).toBe(false)
  })

  it('fires the one seam, so multiple callers reach one mechanism', () => {
    const received: { target: EngagementTarget; mode: string }[] = []
    const off = subscribeToEngagement(r => received.push(r))

    // Two unrelated surfaces, each holding only its own target...
    engagementAffordances(AMZN).askAI()
    engagementAffordances(NOTE).discuss()
    // ...and a caller going through the bare function instead of the resolver.
    openEngagement(MSFT, 'ai')
    off()

    expect(received.map(r => [r.target.objectId, r.mode])).toEqual([
      ['asset-amzn', 'ai'],
      ['note-1', 'discuss'],
      ['asset-msft', 'ai'],
    ])
  })
})

describe('switching objects does not retain stale context', () => {
  it('binds the pane to the object itself when it is taggable', () => {
    expect(toPaneContext(AMZN)).toEqual({
      contextType: 'asset',
      contextId: 'asset-amzn',
      contextTitle: 'AMZN — Amazon.com',
    })
  })

  it('binds an untaggable object to the asset it hangs off, matching toAITags', () => {
    expect(toPaneContext(NOTE)).toEqual({
      contextType: 'asset',
      contextId: 'asset-amzn',
      contextTitle: 'AMZN',
    })
  })

  it('binds nothing when there is nothing to hang the pane on', () => {
    expect(toPaneContext(null)).toBeNull()
    expect(toPaneContext({ objectType: 'decision', objectId: 'd1', label: 'Trim' })).toBeNull()
  })

  it('says a binding is stale once the pane moves to another object', () => {
    // The user opened AI on AMZN, then picked MSFT from inside the pane.
    expect(targetMatchesContext(AMZN, 'asset', 'asset-amzn')).toBe(true)
    expect(targetMatchesContext(AMZN, 'asset', 'asset-msft')).toBe(false)
  })

  it('treats a different kind of object under the same id as a different object', () => {
    expect(targetMatchesContext(AMZN, 'portfolio', 'asset-amzn')).toBe(false)
  })

  it('holds a note binding only while the pane is still on its asset', () => {
    expect(targetMatchesContext(NOTE, 'asset', 'asset-amzn')).toBe(true)
    expect(targetMatchesContext(NOTE, 'asset', 'asset-msft')).toBe(false)
  })

  it('is false for no target and for a cleared context, so a caller only keeps on a yes', () => {
    expect(targetMatchesContext(null, 'asset', 'asset-amzn')).toBe(false)
    expect(targetMatchesContext(AMZN, undefined, undefined)).toBe(false)
    expect(targetMatchesContext(AMZN, 'asset', '')).toBe(false)
  })
})
