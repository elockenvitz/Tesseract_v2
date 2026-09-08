import { describe, it, expect } from 'vitest'
import { selectContext, describeSelection, DEFAULT_BUDGET, OBJECT_TOKEN_COST } from '../context-selection'
import type { EngagementTarget } from '../../engagement'

const AMZN_TAB = {
  type: 'asset',
  id: 'asset-amzn',
  title: 'AMZN',
  data: { id: 'asset-amzn', symbol: 'AMZN' },
}

const NOTE_TARGET: EngagementTarget = {
  objectType: 'research_note',
  objectId: 'note-1',
  label: 'AMZN margin work',
  assetId: 'asset-amzn',
  symbol: 'AMZN',
  portfolioId: 'pf-growth',
  portfolioName: 'Growth Composite',
}

describe('determinism', () => {
  it('the same location always produces the same selection', () => {
    const first = selectContext({ engagementTarget: NOTE_TARGET })
    for (let i = 0; i < 10; i++) {
      expect(selectContext({ engagementTarget: NOTE_TARGET })).toEqual(first)
    }
  })

  it('an empty location is a valid, empty selection', () => {
    const selection = selectContext({})
    expect(selection.selected).toEqual([])
    expect(selection.tags).toEqual([])
    expect(selection.allowlist).toEqual([])
    expect(selection.subject).toBeNull()
    expect(describeSelection(selection)).toBe('No object context')
  })

  it('a tab with no single subject contributes nothing', () => {
    // A dashboard, a list, a settings page. Inventing a subject for these is
    // how a conversation ends up tagged with "Assets".
    for (const type of ['dashboard', 'assets-list', 'trade-lab', 'coverage', 'calendar']) {
      const selection = selectContext({ tab: { type, id: type, title: type } })
      expect(selection.selected, type).toEqual([])
    }
  })
})

describe('the object context is preserved', () => {
  it('the tab the reader is on becomes the subject', () => {
    const selection = selectContext({ tab: AMZN_TAB })
    expect(selection.subject).toMatchObject({ type: 'asset', id: 'asset-amzn', symbol: 'AMZN', role: 'subject' })
    expect(selection.tags).toEqual([{ type: 'asset', id: 'asset-amzn', label: 'AMZN' }])
  })

  it('a research note carries the asset behind it and the book it sits in', () => {
    const selection = selectContext({ engagementTarget: NOTE_TARGET })
    expect(selection.selected.map(o => `${o.type}:${o.id}`))
      .toEqual(['asset:asset-amzn', 'portfolio:pf-growth'])
    // The subject is the asset, because a research note is not taggable and
    // pretending otherwise would tag the conversation with something the
    // edge function silently ignores.
    expect(selection.subject?.id).toBe('asset-amzn')
  })

  it('an engagement target wins over the tab', () => {
    const selection = selectContext({ tab: AMZN_TAB, engagementTarget: {
      objectType: 'portfolio', objectId: 'pf-growth', label: 'Growth Composite',
    } })
    expect(selection.subject).toMatchObject({ type: 'portfolio', id: 'pf-growth' })
  })

  it('objects the user named explicitly come first', () => {
    const selection = selectContext({
      tab: AMZN_TAB,
      explicitRefs: [{ type: 'asset', id: 'asset-nvda', symbol: 'NVDA' }],
    })
    expect(selection.selected[0]).toMatchObject({ id: 'asset-nvda', role: 'explicit' })
  })

  it('never selects the same object twice', () => {
    const selection = selectContext({
      tab: AMZN_TAB,
      engagementTarget: { objectType: 'asset', objectId: 'asset-amzn', label: 'AMZN', assetId: 'asset-amzn' },
      explicitRefs: [{ type: 'asset', id: 'asset-amzn' }],
    })
    expect(selection.selected).toHaveLength(1)
    expect(selection.dropped.filter(d => d.reason === 'duplicate').length).toBeGreaterThan(0)
  })
})

describe('the budget is real and reported', () => {
  it('charges each object and reports the total', () => {
    const selection = selectContext({ engagementTarget: NOTE_TARGET })
    expect(selection.estimatedTokens).toBe(OBJECT_TOKEN_COST.asset + OBJECT_TOKEN_COST.portfolio)
    expect(selection.estimatedTokens).toBeLessThanOrEqual(DEFAULT_BUDGET.maxTokens)
  })

  it('drops what does not fit rather than sending it', () => {
    const explicitRefs = Array.from({ length: 6 }, (_, i) => ({ type: 'asset' as const, id: `asset-${i}` }))
    const selection = selectContext({ explicitRefs })
    expect(selection.estimatedTokens).toBeLessThanOrEqual(DEFAULT_BUDGET.maxTokens)
    expect(selection.selected.length).toBeLessThan(explicitRefs.length)
    expect(selection.dropped.some(d => d.reason === 'budget')).toBe(true)
  })

  it('never exceeds the object cap', () => {
    const explicitRefs = Array.from({ length: 12 }, (_, i) => ({ type: 'project' as const, id: `p-${i}` }))
    const selection = selectContext({ explicitRefs })
    expect(selection.selected.length).toBeLessThanOrEqual(DEFAULT_BUDGET.maxObjects)
  })

  it('honours a tighter budget', () => {
    const selection = selectContext({ engagementTarget: NOTE_TARGET }, { maxTokens: 6000, maxObjects: 4 })
    expect(selection.selected.map(o => o.type)).toEqual(['asset'])
    expect(selection.dropped.some(d => d.reason === 'budget')).toBe(true)
  })
})

describe('the allowlist is narrower than the context', () => {
  it('a note is sent to the model but cannot be acted on', () => {
    const selection = selectContext({
      tab: { type: 'note', id: 'note-9', title: 'Q3 read', data: { id: 'note-9' } },
    })
    expect(selection.tags).toEqual([{ type: 'note', id: 'note-9', label: 'Q3 read' }])
    // No action in the catalogue accepts a note, so it must not be actionable.
    expect(selection.allowlist).toEqual([])
  })

  it('an idea is actionable even though the server assembles no context for it', () => {
    const selection = selectContext({
      tab: { type: 'ideas-v2', id: 'ideas-v2', title: 'Ideas', data: { selectedIdeaId: 'idea-3' } },
    })
    // No tag: the edge function has no idea branch, and showing a chip for
    // context that was never assembled would be a lie to the reader.
    expect(selection.tags).toEqual([])
    // But "open the idea you are already looking at" is a real action.
    expect(selection.allowlist).toEqual([{ type: 'idea', id: 'idea-3', label: 'Ideas' }])
  })

  it('everything in the allowlist was also selected', () => {
    const selection = selectContext({ engagementTarget: NOTE_TARGET })
    const selectedKeys = new Set(selection.selected.map(o => `${o.type}:${o.id}`))
    for (const ref of selection.allowlist) {
      expect(selectedKeys.has(`${ref.type}:${ref.id}`)).toBe(true)
    }
  })
})
