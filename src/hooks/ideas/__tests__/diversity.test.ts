import { describe, expect, it } from 'vitest'

import { applyDiversityForTest as applyDiversity } from '../useIdeasFeed'

/**
 * Diversity is a rule about ORDER, and it was implemented as a rule about
 * membership.
 *
 * The loop used `continue` with a comment reading "skip, will appear later".
 * They never appeared later: the function runs once per page, and the next
 * page re-queries the database at a different offset — so a skipped row was
 * not deferred, it was deleted, and nothing downstream could tell that from
 * "this does not exist".
 */

const item = (id: string, author: string, asset?: string) => ({
  id, score: 1,
  author: { id: author },
  ...(asset ? { asset: { id: asset } } : {}),
} as any)

describe('diversity reorders, it does not delete', () => {
  it('keeps every item a desk of two analysts wrote', () => {
    /**
     * The reported failure. 21 open proposals written by two or three people:
     * "three from the same author in the last five" discarded most of them on
     * every page, while pair trades — a different path with a different author
     * spread — survived intact. The Ideas filter showed nothing but pair
     * trades, and was reported that way twice.
     */
    const items = Array.from({ length: 21 }, (_, i) => item(`i${i}`, i % 2 ? 'ana' : 'bob'))
    const out = applyDiversity(items)
    expect(out).toHaveLength(21)
    expect(new Set(out.map(o => o.id)).size).toBe(21)
  })

  it('keeps every item when one author wrote all of them', () => {
    // The worst case, and the one where dropping is most destructive: there is
    // no diversity available, so the only honest output is the input.
    const items = Array.from({ length: 10 }, (_, i) => item(`i${i}`, 'solo'))
    expect(applyDiversity(items)).toHaveLength(10)
  })

  it('keeps every item when they are all about one name', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`, `a${i}`, 'NVDA'))
    expect(applyDiversity(items)).toHaveLength(8)
  })

  it('still separates a run by the same author', () => {
    // The rule has to keep working, or this is a deletion of the feature
    // rather than a fix to it.
    const items = [
      item('a1', 'ana'), item('a2', 'ana'), item('a3', 'ana'), item('a4', 'ana'),
      item('b1', 'bob'), item('b2', 'bob'),
    ]
    const out = applyDiversity(items)
    const firstFive = out.slice(0, 5).map(o => o.author.id)
    expect(firstFive.filter(a => a === 'ana').length).toBeLessThan(4)
  })

  it('preserves the ranking order among what it keeps', () => {
    // Score already decided importance; diversity may only space things out.
    const items = [item('a', 'x'), item('b', 'y'), item('c', 'z')]
    expect(applyDiversity(items).map(o => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns nothing for nothing', () => {
    expect(applyDiversity([])).toEqual([])
  })
})
