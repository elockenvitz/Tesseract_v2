/**
 * One rule, pinned: a CTA exists only when it goes somewhere the tile does not.
 */

import { describe, it, expect } from 'vitest'
import { progressionFor, promptStatus } from '../progression'
import type { IdeasSelection } from '../selection'

const sel = (over: Partial<IdeasSelection> = {}): IdeasSelection => ({
  family: 'post', key: 'k', objectId: 'o1', postType: 'thought', item: null,
  assetId: null, symbol: null, portfolioId: null, portfolioName: null,
  why: { headline: 'h', reason: null, occurredAt: null },
  ...over,
} as IdeasSelection)

const idea = (maturity: string) => ({ id: 'i1', maturity, assetId: 'a1' } as never)

describe('progressionFor', () => {
  it('gives no CTA to machine findings', () => {
    for (const family of ['stale_target', 'target_hit', 'conviction', 'crowding', 'scenario_gap'] as const) {
      expect(progressionFor(sel({ family }))).toBeNull()
    }
  })

  it('sends each idea maturity to a distinct module', () => {
    expect(progressionFor(sel({ postType: 'trade_idea' }), { idea: idea('researching') })?.mode)
      .toEqual({ kind: 'idea_focus', focus: 'research' })
    expect(progressionFor(sel({ postType: 'trade_idea' }), { idea: idea('thesis_forming') })?.mode)
      .toEqual({ kind: 'idea_focus', focus: 'thesis' })
    expect(progressionFor(sel({ postType: 'trade_idea' }), { idea: idea('decision_ready') })?.mode)
      .toEqual({ kind: 'idea_focus', focus: 'decision' })
  })

  /** The verb tells the truth about what the surface can record. */
  it('says Decide only when a decision can be recorded', () => {
    const can = progressionFor(sel({ postType: 'trade_idea' }), { idea: idea('deciding'), canDecide: true })
    const cannot = progressionFor(sel({ postType: 'trade_idea' }), { idea: idea('deciding'), canDecide: false })
    expect(can?.label).toBe('Decide')
    expect(cannot?.label).toBe('Review decision')
  })

  it('offers promotion once, and never for an already-promoted thought', () => {
    expect(progressionFor(sel({ postType: 'thought', item: { tags: [] } as never }))?.label)
      .toBe('Promote to trade idea')
    expect(progressionFor(sel({
      postType: 'thought', item: { promoted_to_trade_idea_id: 'ti1' } as never,
    }))).toBeNull()
  })

  it('walks a prompt through its states and stops at closed', () => {
    const at = (tags: string[]) => progressionFor(sel({ postType: 'prompt', item: { tags } as never }))
    expect(at([])?.label).toBe('Respond')
    expect(at(['status:responded'])?.label).toBe('Resolve')
    expect(at(['status:closed'])).toBeNull()
  })

  it('reads the tag-backed prompt status, defaulting to open', () => {
    expect(promptStatus(null)).toBe('open')
    expect(promptStatus(['assignee:u1'])).toBe('open')
    expect(promptStatus(['status:responded'])).toBe('responded')
    expect(promptStatus(['status:closed'])).toBe('closed')
  })

  /** No idea row means no maturity, and a label with no state behind it. */
  it('gives no idea CTA without the idea', () => {
    expect(progressionFor(sel({ postType: 'trade_idea' }), {})).toBeNull()
  })
})
