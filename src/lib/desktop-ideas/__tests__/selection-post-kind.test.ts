/**
 * One rule decides which post a row is, and both readers get the same answer.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * `postTypeOf` used to spell the rule out inside `selection.ts`. Explore needs
 * the same answer from a RAW post rather than a built feed row, so the rule
 * moved to `postKindOf` and both sides now call it. The move is the risk: a
 * delegation that quietly lost a branch would show up as a prompt opening the
 * thought surface, which looks almost right and is not.
 *
 * Proven by injection -- breaking the prompt branch in `postKindOf` with this
 * file absent failed only the ADAPTER's cases, so nothing anywhere asserted
 * that the feed's own selection still told a prompt from a thought. It does
 * now, from the same rule, which is the whole point of there being one.
 */
import { describe, it, expect } from 'vitest'
import { selectionFor } from '../selection'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'

const entry = (item: Record<string, unknown> | null): AttentionEntry => ({
  key: 'k1',
  family: 'post',
  card: { type: 'thought', headline: 'A post', entity: { kind: 'asset', id: 'a1', ticker: 'NVDA' } },
  item,
  input: {},
  source: 'ideas',
} as unknown as AttentionEntry)

describe('a post selection names the surface its row would open', () => {
  it.each([
    [{ id: 'r1', type: 'trade_idea' }, 'trade_idea'],
    [{ id: 'r1', type: 'pair_trade' }, 'trade_idea'],
    [{ id: 'r1', type: 'quick_thought' }, 'thought'],
    [{ id: 'r1', type: 'note' }, 'thought'],
  ] as const)('reads %o as %s', (item, kind) => {
    expect(selectionFor(entry(item as Record<string, unknown>)).postType).toBe(kind)
  })

  /**
   * The two branches the delegation could have dropped. A prompt is a
   * `quick_thought` row distinguished only by `idea_type` or an `assignee:`
   * tag, so neither is inferable from the row's type.
   */
  it('tells a prompt from a thought by its idea_type', () => {
    expect(selectionFor(entry({ id: 'r1', type: 'quick_thought', idea_type: 'prompt' })).postType)
      .toBe('prompt')
  })

  it('tells a prompt from a thought by an assignee tag', () => {
    expect(selectionFor(entry({ id: 'r1', type: 'quick_thought', tags: ['assignee:u1'] })).postType)
      .toBe('prompt')
  })

  /** A thought's own tags are not an assignment. */
  it('leaves an ordinary tag alone', () => {
    expect(selectionFor(entry({ id: 'r1', type: 'quick_thought', tags: ['macro'] })).postType)
      .toBe('thought')
  })

  it('claims no kind for a row it does not recognise, or for no row at all', () => {
    expect(selectionFor(entry({ id: 'r1', type: 'something_else' })).postType).toBeNull()
    expect(selectionFor(entry(null)).postType).toBeNull()
  })
})
