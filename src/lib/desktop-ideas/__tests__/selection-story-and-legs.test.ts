/**
 * The two things a selection learned to carry, and why each had to.
 *
 * ── A story ───────────────────────────────────────────────────────────────
 *
 * It used to be a full-screen overlay with no selection behind it at all, so
 * there was nothing to test: the shell held the open article in its own state
 * and the workspace never saw it. Now a story is a selection like any other
 * and the pane routes on it, which puts the usual rule back in force -- the
 * family and the ids decide the surface, and nothing routes on a label.
 *
 * ── A pair's legs ─────────────────────────────────────────────────────────
 *
 * `assetId` holds ONE name, and the one it holds is whichever leg happened to
 * be long. On "Long MCD / Short CMG" that is MCD, and a pane routing on it
 * alone shows a page about MCD and never says CMG exists. The legs travel so
 * the surface can state the structure and let the reader work either side.
 *
 * Proven by injection: with `legsOf` returning null the pair cases fail, and
 * with `selectionForStory` dropping `story` the pane has nothing to read.
 */
import { describe, it, expect } from 'vitest'
import { selectionFor, selectionForStory } from '../selection'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'

const entry = (item: Record<string, unknown> | null): AttentionEntry => ({
  key: 'k1',
  family: 'post',
  card: { type: 'pair_trade', headline: 'Long MCD / Short CMG', entity: { kind: 'asset', id: 'mcd', ticker: 'MCD' } },
  item,
  input: {},
  source: 'ideas',
} as unknown as AttentionEntry)

/** The shape `useIdeasFeed` builds a `pair_trade` item out of. */
const PAIR = {
  id: 'pair-1',
  type: 'pair_trade',
  long_legs: [{ id: 'l1', asset: { id: 'mcd', symbol: 'MCD' } }],
  short_legs: [{ id: 's1', asset: { id: 'cmg', symbol: 'CMG' } }],
}

describe('a story, as a selection', () => {
  const STORY = {
    url: 'https://wire.test/oil',
    title: 'Peace sends oil lower',
    source: 'Yahoo',
    desk: { symbol: 'XOM', assetId: 'xom-1' },
  }

  it('is its own family and carries where to read it', () => {
    const s = selectionForStory(STORY)
    expect(s.family).toBe('story')
    expect(s.story).toEqual({
      url: 'https://wire.test/oil', title: 'Peace sends oil lower', source: 'Yahoo',
    })
  })

  /* The URL, because two tiles pointing at one story are one selection -- and
     because a key built from a title would collide across republications. */
  it('is identified by the story, not by the tile that opened it', () => {
    expect(selectionForStory(STORY).key).toBe('story:https://wire.test/oil')
  })

  /* The name the story was surfaced FOR. This is what puts the case on the
     screen under the words, which is the whole reason the overlay went. */
  it('names the asset the desk holds, so the case can open beneath it', () => {
    const s = selectionForStory(STORY)
    expect(s.assetId).toBe('xom-1')
    expect(s.symbol).toBe('XOM')
  })

  /* A story about a name with no asset record is still readable. Inventing an
     id to make the surface uniform is the defect this product keeps finding. */
  it('carries no asset where the resolver found none', () => {
    const s = selectionForStory({ ...STORY, desk: null })
    expect(s.assetId).toBeNull()
    expect(s.symbol).toBeNull()
  })

  /* Explore, because that is the only surface a story is reached from, and
     the Ideas feed must not clear a selection it never offered. */
  it('remembers that it came from Explore', () => {
    expect(selectionForStory(STORY).origin).toBe('explore')
  })

  it('leads with the headline and names the publisher as the reason', () => {
    const s = selectionForStory(STORY)
    expect(s.why.headline).toBe('Peace sends oil lower')
    expect(s.why.reason).toBe('Yahoo')
  })
})

describe('a pair carries both of its names', () => {
  it('takes every leg, long side first, with the side it is on', () => {
    expect(selectionFor(entry(PAIR)).legs).toEqual([
      { assetId: 'mcd', symbol: 'MCD', side: 'long' },
      { assetId: 'cmg', symbol: 'CMG', side: 'short' },
    ])
  })

  /* `assetId` is still the card's entity. The legs are additional, not a
     replacement -- a surface that reads only `assetId` keeps working. */
  it('leaves the entity the card resolved to alone', () => {
    expect(selectionFor(entry(PAIR)).assetId).toBe('mcd')
  })

  /* A leg whose asset join came back empty cannot be routed to, so it is
     dropped rather than carried as a name with nothing behind it. */
  it('drops a leg that names no asset', () => {
    const legs = selectionFor(entry({
      ...PAIR,
      short_legs: [{ id: 's1', asset: null }],
    })).legs
    expect(legs).toEqual([{ assetId: 'mcd', symbol: 'MCD', side: 'long' }])
  })

  /* Null, not an empty array: "this candidate has no legs" and "this pair has
     no legs left" are the same answer for the surface, and the surface draws
     its rail only when there is more than one name to put in it. */
  it('is null for a single-name idea', () => {
    expect(selectionFor(entry({ id: 'r1', type: 'trade_idea' })).legs).toBeNull()
  })

  it('is null for a finding, which has no row at all', () => {
    const finding = {
      key: 'k2', family: 'scenario_gap', item: null, input: null, source: null,
      card: { type: 'scenario_gap', headline: 'A gap', entity: { kind: 'asset', id: 'a1' } },
    } as unknown as AttentionEntry
    expect(selectionFor(finding).legs).toBeNull()
  })
})
