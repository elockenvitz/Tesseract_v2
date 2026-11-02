/**
 * A no-target card draws what is at stake, not a line pointing at nothing.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * MEASURED on the live field: JNJ, PG, ROKU, SQ and ZOOM all surface as "has
 * no price target on record", and every one of them drew `target_compare`
 * with `target: null` -- a dashed amber run from the current price to a
 * "NOT SET" chip. That is the headline, redrawn. Most of the Decisions column
 * was a picture restating the sentence above it.
 *
 * The defence on the component was that the shape of the absence IS the
 * statement. It is, on a card that has not already made it in words. These
 * cards have.
 *
 * ── What replaces it, and why not a chart ─────────────────────────────────
 *
 * The question a no-target position raises is how much rides on it while
 * nobody has said what it is worth. The `untargeted` lens already carries
 * `weightPct`, and the exposure bar is a ruled measurement of exactly that.
 * No new fetch, no invented figure.
 *
 * Not the tape: the tile's pager already offers Price beside the finding, so a
 * line here would be a second copy of a chart the reader can already reach, in
 * the pane whose job is to argue.
 *
 * ── What is deliberately NOT changed ──────────────────────────────────────
 *
 * A no-target card with no weight keeps the stated absence. A position whose
 * size is unknown is a different card from one whose size is 4.2%, and
 * implying a number where there is none is the one thing this card must not
 * do. Asserted below so the change cannot creep.
 */
import { describe, it, expect } from 'vitest'
import { exploreVisualFor } from '../explore-visual'
import type { ExploreItem } from '../explore-item'

const untargeted = (over: Record<string, unknown> = {}): ExploreItem => ({
  id: 'lens-untargeted-jnj',
  dedupeKey: 'no_target:jnj',
  signalType: 'no_target',
  category: 'decisions',
  subtype: 'signal',
  title: 'JNJ has no price target on record',
  symbol: 'JNJ',
  assetId: 'asset-jnj',
  occurredAt: '2026-10-01T00:00:00Z',
  destination: { kind: 'action', action: 'set_target', assetId: 'asset-jnj', symbol: 'JNJ' },
  importance: 0.3,
  portfolio: { weightPct: 4.2, name: 'Large Cap Growth' },
  visual: { currentPrice: 162, target: null },
  ...over,
} as unknown as ExploreItem)

describe('a sized position with no target shows the size', () => {
  /** THE case. */
  it('draws the exposure bar rather than a run to NOT SET', () => {
    const v = exploreVisualFor(untargeted())
    expect(v.kind).toBe('exposure')
    expect(v.kind === 'exposure' && v.weightPct).toBe(4.2)
    expect(v.kind === 'exposure' && v.portfolioName).toBe('Large Cap Growth')
  })

  /** It is the WEIGHT that redirects it, not the signal type. */
  it('still shows the pair when a target exists', () => {
    const v = exploreVisualFor(untargeted({ visual: { currentPrice: 162, target: 190 } }))
    expect(v.kind).toBe('target_compare')
    expect(v.kind === 'target_compare' && v.target).toBe(190)
  })
})

describe('an unsized position still states the absence', () => {
  it.each([
    ['no portfolio facet at all', undefined],
    ['a facet with no weight', { name: 'Large Cap Growth' }],
    ['a zero weight', { weightPct: 0, name: 'Large Cap Growth' }],
    ['a weight that is not a number', { weightPct: Number.NaN, name: 'Large Cap Growth' }],
  ] as const)('keeps the stated absence given %s', (_label, portfolio) => {
    const v = exploreVisualFor(untargeted({ portfolio }))
    expect(v.kind).toBe('target_compare')
    expect(v.kind === 'target_compare' && v.target).toBeNull()
    // And it never implies a number where there is none.
    expect(v.kind === 'target_compare' && v.current).toBe(162)
  })
})
