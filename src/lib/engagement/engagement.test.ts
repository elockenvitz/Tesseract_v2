/**
 * Focused tests for the engagement seam.
 *
 * Scope is deliberately the seam itself: what gets bound, what refuses to
 * bind, and what reaches a subscriber. Nothing here renders the pane, touches
 * Supabase, or exercises mobile.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DecisionContext } from '../../engine/decisionEngine/types'
import type { EngagementTarget } from './types'
import {
  toAITags,
  toThreadKey,
  canDiscuss,
  describeTarget,
  contextChipsFor,
  fromDecisionContext,
} from './target'
import {
  openEngagement,
  askAI,
  discuss,
  subscribeToEngagement,
  ENGAGEMENT_EVENT,
} from './open-engagement'
import {
  registerPrimaryAction,
  resolvePrimaryAction,
  __clearPrimaryActions,
  type PrimaryAction,
} from './primary-action'

const AMZN: EngagementTarget = {
  objectType: 'asset',
  objectId: 'asset-amzn',
  label: 'AMZN — Amazon.com',
  symbol: 'AMZN',
  portfolioId: 'pf-growth',
  portfolioName: 'Growth Composite',
  origin: { itemId: 'gde:thesisStale:amzn', surface: 'today' },
  issue: {
    title: 'Framework broken',
    detail: 'Spot cleared the bull case on 24 August.',
    reason: 'thesisStale',
  },
  seedPrompt: 'Which assumptions would need to change to justify $233?',
}

describe('toAITags', () => {
  it('tags the object itself when the object is AI-taggable', () => {
    const tags = toAITags(AMZN)
    expect(tags[0]).toEqual({ type: 'asset', id: 'asset-amzn', label: 'AMZN — Amazon.com' })
  })

  it('carries the portfolio alongside, because exposure changes the answer', () => {
    expect(toAITags(AMZN)).toContainEqual({
      type: 'portfolio', id: 'pf-growth', label: 'Growth Composite',
    })
  })

  it('does not tag the portfolio twice when the portfolio IS the subject', () => {
    const tags = toAITags({
      objectType: 'portfolio', objectId: 'pf-growth', label: 'Growth Composite',
      portfolioId: 'pf-growth', portfolioName: 'Growth Composite',
    })
    expect(tags.filter(t => t.type === 'portfolio')).toHaveLength(1)
  })

  it('falls back to the parent asset for an object that cannot be tagged', () => {
    // This is the case the seam exists for: a research note is not taggable,
    // but the model still needs the asset it is about.
    const tags = toAITags({
      objectType: 'research_note',
      objectId: 'note-1',
      label: 'Terminal multiple framework',
      assetId: 'asset-amzn',
      symbol: 'AMZN',
    })
    expect(tags).toEqual([{ type: 'asset', id: 'asset-amzn', label: 'AMZN' }])
  })

  it('returns nothing rather than guessing when there is nothing to bind', () => {
    expect(toAITags({ objectType: 'decision', objectId: 'd1', label: 'Maintain position' }))
      .toEqual([])
  })
})

describe('toThreadKey / canDiscuss', () => {
  it('binds a thread to the object itself', () => {
    expect(toThreadKey(AMZN)).toEqual({ contextType: 'asset', contextId: 'asset-amzn' })
  })

  it.each(['asset', 'portfolio', 'theme', 'note', 'trade_idea', 'quick_thought'] as const)(
    'allows %s, which shipping code already reads or writes on messages',
    type => {
      expect(canDiscuss({ objectType: type, objectId: 'x', label: 'x' })).toBe(true)
    },
  )

  it.each(['research_note', 'decision', 'coverage'] as const)(
    'refuses %s rather than risking the messages CHECK constraint',
    type => {
      expect(toThreadKey({ objectType: type, objectId: 'x', label: 'x' })).toBeNull()
      expect(canDiscuss({ objectType: type, objectId: 'x', label: 'x' })).toBe(false)
    },
  )

  it('never silently redirects an undiscussable object to its asset', () => {
    // A comment about a note is not a comment about the asset. Redirecting
    // would put the conversation somewhere the user cannot find again.
    expect(toThreadKey({
      objectType: 'research_note', objectId: 'note-1', label: 'note', assetId: 'asset-amzn',
    })).toBeNull()
  })

  it('refuses a target with no id', () => {
    expect(toThreadKey({ objectType: 'asset', objectId: '', label: 'x' })).toBeNull()
  })
})

describe('describeTarget / contextChipsFor', () => {
  it('names the object and the issue together', () => {
    expect(describeTarget(AMZN)).toBe('AMZN · AMZN — Amazon.com — Framework broken')
  })

  it('omits the issue clause when there is no issue', () => {
    expect(describeTarget({ objectType: 'asset', objectId: 'a', label: 'AMZN', symbol: 'AMZN' }))
      .toBe('AMZN')
  })

  it('prefers chips the surface supplied', () => {
    const chips = contextChipsFor({ ...AMZN, contextChips: [{ label: 'Thesis', value: 'rev 4' }] })
    expect(chips).toEqual([{ label: 'Thesis', value: 'rev 4' }])
  })

  it('describes the binding when the surface supplied none', () => {
    expect(contextChipsFor(AMZN)).toEqual([
      { label: 'Asset', value: 'AMZN' },
      { label: 'Portfolio', value: 'Growth Composite' },
      { label: 'Raised by', value: 'thesisStale' },
    ])
  })
})

describe('fromDecisionContext', () => {
  const ctx: DecisionContext = {
    assetId: 'asset-amzn',
    assetTicker: 'AMZN',
    portfolioId: 'pf-growth',
    portfolioName: 'Growth Composite',
  }

  it('chooses the most specific object as the subject', () => {
    const t = fromDecisionContext({ ...ctx, tradeIdeaId: 'ti-1' }, { label: 'AMZN' })
    expect(t).toMatchObject({ objectType: 'trade_idea', objectId: 'ti-1' })
  })

  it('demotes rather than discards what it did not choose', () => {
    const t = fromDecisionContext({ ...ctx, tradeIdeaId: 'ti-1' }, { label: 'AMZN' })
    expect(t).toMatchObject({ assetId: 'asset-amzn', portfolioId: 'pf-growth' })
  })

  it('falls back to asset, then portfolio', () => {
    expect(fromDecisionContext(ctx, { label: 'AMZN' })).toMatchObject({ objectType: 'asset' })
    expect(fromDecisionContext(
      { portfolioId: 'pf-growth' }, { label: 'Growth' },
    )).toMatchObject({ objectType: 'portfolio', objectId: 'pf-growth' })
  })

  it('returns null when the context names no object', () => {
    expect(fromDecisionContext({ overdueDays: 4 }, { label: 'Book-level' })).toBeNull()
  })
})

describe('openEngagement', () => {
  let received: unknown[]
  let unsubscribe: () => void

  beforeEach(() => {
    received = []
    unsubscribe?.()
    unsubscribe = subscribeToEngagement(r => received.push(r))
  })

  it('delivers the target and mode to a subscriber', () => {
    expect(openEngagement(AMZN, 'ai')).toBe(true)
    expect(received).toEqual([{ target: AMZN, mode: 'ai' }])
    unsubscribe()
  })

  it('carries the issue through unchanged, so nothing is recreated by hand', () => {
    askAI(AMZN)
    const req = received[0] as { target: EngagementTarget }
    expect(req.target.issue).toEqual(AMZN.issue)
    expect(req.target.seedPrompt).toBe(AMZN.seedPrompt)
    expect(req.target.origin?.itemId).toBe('gde:thesisStale:amzn')
    unsubscribe()
  })

  it('askAI and discuss set the mode', () => {
    askAI(AMZN)
    discuss(AMZN)
    expect(received.map(r => (r as { mode: string }).mode)).toEqual(['ai', 'discuss'])
    unsubscribe()
  })

  it('refuses to dispatch a target with nothing to bind', () => {
    expect(openEngagement({ objectType: 'asset', objectId: '', label: 'x' }, 'ai')).toBe(false)
    expect(received).toHaveLength(0)
    unsubscribe()
  })

  it('stops delivering after unsubscribe', () => {
    unsubscribe()
    openEngagement(AMZN, 'ai')
    expect(received).toHaveLength(0)
  })

  it('ignores a malformed event rather than throwing at the subscriber', () => {
    const handler = vi.fn()
    const off = subscribeToEngagement(handler)
    window.dispatchEvent(new CustomEvent(ENGAGEMENT_EVENT, { detail: { mode: 'ai' } }))
    expect(handler).not.toHaveBeenCalled()
    off()
    unsubscribe()
  })
})

describe('primary action slot', () => {
  beforeEach(() => __clearPrimaryActions())

  const action: PrimaryAction = {
    key: 'review-scenarios', label: 'Review scenarios', kind: 'navigate', run: () => {},
  }

  it('resolves by the reason that raised the item, not by object type', () => {
    registerPrimaryAction('thesisStale', () => action)
    expect(resolvePrimaryAction(AMZN)?.label).toBe('Review scenarios')
  })

  it('gives two evaluators about the same asset different verbs', () => {
    registerPrimaryAction('thesisStale', () => action)
    registerPrimaryAction('proposalAwaiting', () => ({ ...action, key: 'decide', label: 'Decide' }))
    const proposal = { ...AMZN, issue: { title: 'Decision waiting', reason: 'proposalAwaiting' } }
    expect(resolvePrimaryAction(AMZN)?.label).toBe('Review scenarios')
    expect(resolvePrimaryAction(proposal)?.label).toBe('Decide')
  })

  it('lets an explicit override win over the registry', () => {
    registerPrimaryAction('thesisStale', () => action)
    const override = { ...action, key: 'custom', label: 'Set framework' }
    expect(resolvePrimaryAction(AMZN, override)?.label).toBe('Set framework')
  })

  it('returns null for an unregistered reason instead of inventing "Open"', () => {
    expect(resolvePrimaryAction(AMZN)).toBeNull()
  })

  it('returns null when the item names no reason', () => {
    registerPrimaryAction('thesisStale', () => action)
    expect(resolvePrimaryAction({ objectType: 'asset', objectId: 'a', label: 'AMZN' })).toBeNull()
  })

  it('lets a factory decline a target it does not apply to', () => {
    registerPrimaryAction('thesisStale', t => (t.symbol === 'AMZN' ? null : action))
    expect(resolvePrimaryAction(AMZN)).toBeNull()
  })

  it('passes the target to the handler when run', () => {
    const run = vi.fn()
    registerPrimaryAction('thesisStale', () => ({ ...action, run }))
    resolvePrimaryAction(AMZN)!.run(AMZN)
    expect(run).toHaveBeenCalledWith(AMZN)
  })

  it('allows re-registration so a hot reload does not throw', () => {
    registerPrimaryAction('thesisStale', () => action)
    expect(() => registerPrimaryAction('thesisStale', () => action)).not.toThrow()
  })
})
