/**
 * Finding an object, rather than reading a wall of chips.
 *
 * The sidebar's permanent object-chip row was a twelve-item sample of an
 * index, frequency-sorted and always on screen whether or not the reader was
 * looking for an object. These are the rules of what replaced it: a search,
 * ranked so the obvious answer is first, matched to conversations by
 * canonical id and never by label.
 */
import { describe, it, expect } from 'vitest'
import {
  DISCOVERY_TYPES, OBJECT_SEARCH_FLOOR, conversationsAbout, describeObjectThreads,
  discoveryKey, isDiscoveryType, objectTag, rankObjects,
  shouldSearchObjects as shouldSearch,
} from '../object-discovery'

const result = (type: string, id: string, title: string, subtitle?: string) =>
  ({ type, id, title, subtitle })

describe('what counts as an object', () => {
  it('is the four types ACT AI can be asked about', () => {
    expect([...DISCOVERY_TYPES]).toEqual(['asset', 'portfolio', 'theme', 'note'])
  })

  it('rejects a type the AI surface cannot hold as context', () => {
    /* `useEntitySearch` can return users, workflows, meetings and trade
       sheets. None of them is something the request can carry, so letting
       one into the list would offer the reader a dead end. */
    expect(isDiscoveryType('user')).toBe(false)
    expect(isDiscoveryType('meeting')).toBe(false)
    expect(isDiscoveryType('asset')).toBe(true)
  })

  it('keys an object by type and database id', () => {
    expect(discoveryKey({ type: 'asset', id: 'a1' })).toBe('asset:a1')
  })
})

describe('when to search', () => {
  it('waits for two characters', () => {
    /* One character matches most of the database and costs the same four
       round trips. Two is the shortest query that can mean something. */
    expect(OBJECT_SEARCH_FLOOR).toBe(2)
    expect(shouldSearch('')).toBe(false)
    expect(shouldSearch('a')).toBe(false)
    expect(shouldSearch('aa')).toBe(true)
  })

  it('does not count whitespace towards it', () => {
    expect(shouldSearch('  ')).toBe(false)
    expect(shouldSearch(' a ')).toBe(false)
  })
})

describe('ranking', () => {
  it('puts an exact match first, whatever order it arrived in', () => {
    /*
     * The failure this exists to stop. `useEntitySearch` pushes its per-type
     * results in as they land, so for a reader who typed AAPL an asset note
     * whose title contains AAPL can arrive before the asset itself -- a
     * worse answer in a higher position, decided by network timing.
     */
    const ranked = rankObjects([
      result('note', 'n1', 'AAPL margin build'),
      result('asset', 'a1', 'AAPL', 'Apple Inc.'),
    ], 'AAPL')

    expect(ranked.map(o => o.id)).toEqual(['a1', 'n1'])
  })

  it('puts a prefix match above a mere containment', () => {
    const ranked = rankObjects([
      result('theme', 't1', 'Global power demand'),
      result('theme', 't2', 'Power demand'),
    ], 'power')

    expect(ranked.map(o => o.id)).toEqual(['t2', 't1'])
  })

  it('breaks a tie by type, so the asset beats the note about it', () => {
    const ranked = rankObjects([
      result('note', 'n1', 'Power demand'),
      result('portfolio', 'p1', 'Power demand'),
      result('asset', 'a1', 'Power demand'),
    ], 'power demand')

    expect(ranked.map(o => o.type)).toEqual(['asset', 'portfolio', 'note'])
  })

  it('keeps arrival order among equals, so the list does not shuffle', () => {
    /* Re-sorting equal things differently on every keystroke makes a list
       that moves under the pointer. */
    const ranked = rankObjects([
      result('asset', 'a1', 'Zeta Power'),
      result('asset', 'a2', 'Alpha Power'),
    ], 'power')

    expect(ranked.map(o => o.id)).toEqual(['a1', 'a2'])
  })

  it('is case-insensitive about the exact match', () => {
    const ranked = rankObjects([
      result('note', 'n1', 'aapl thoughts'),
      result('asset', 'a1', 'AAPL'),
    ], 'aapl')
    expect(ranked[0].id).toBe('a1')
  })

  it('drops a result with no label rather than drawing a blank row', () => {
    const ranked = rankObjects([
      result('asset', 'a1', '   '),
      result('asset', 'a2', 'MSFT'),
    ], 'ms')
    expect(ranked.map(o => o.id)).toEqual(['a2'])
  })

  it('drops a result with no id, which nothing could be tagged with', () => {
    expect(rankObjects([result('asset', '', 'MSFT')], 'ms')).toEqual([])
  })

  it('de-duplicates by canonical key, first occurrence winning', () => {
    const ranked = rankObjects([
      result('asset', 'a1', 'MSFT', 'Microsoft'),
      result('asset', 'a1', 'MSFT', 'something else'),
    ], 'msft')
    expect(ranked).toHaveLength(1)
    expect(ranked[0].detail).toBe('Microsoft')
  })

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => result('asset', `a${i}`, `AA${i}`))
    expect(rankObjects(many, 'aa')).toHaveLength(8)
    expect(rankObjects(many, 'aa', 3)).toHaveLength(3)
  })

  it('survives nothing to rank', () => {
    expect(rankObjects(null, 'aapl')).toEqual([])
    expect(rankObjects(undefined, 'aapl')).toEqual([])
    expect(rankObjects([], 'aapl')).toEqual([])
  })

  it('carries the subtitle through as the detail line', () => {
    const [o] = rankObjects([result('asset', 'a1', 'AAPL', 'Apple Inc.')], 'aapl')
    expect(o.detail).toBe('Apple Inc.')
  })
})

describe('an object’s conversations', () => {
  const convo = (id: string, tags: { type: string; id: string }[]) => ({ id, tags })

  it('are the ones tagged with it', () => {
    const list = [
      convo('c1', [{ type: 'asset', id: 'a1' }]),
      convo('c2', [{ type: 'asset', id: 'a2' }]),
      convo('c3', [{ type: 'portfolio', id: 'p1' }, { type: 'asset', id: 'a1' }]),
    ]
    expect(conversationsAbout(list, { type: 'asset', id: 'a1' }).map(c => c.id))
      .toEqual(['c1', 'c3'])
  })

  it('are matched by id, never by a label', () => {
    /*
     * The theme called "Power demand" and an asset whose company name
     * contains "power demand" are different objects. A label match would put
     * one in the other's list, which is the kind of wrong that looks right.
     */
    const list = [convo('c1', [{ type: 'theme', id: 'power-demand' }])]
    expect(conversationsAbout(list, { type: 'asset', id: 'power-demand' })).toEqual([])
    expect(conversationsAbout(list, { type: 'theme', id: 'power-demand' })).toHaveLength(1)
  })

  it('are none when there is no object open', () => {
    const list = [convo('c1', [{ type: 'asset', id: 'a1' }])]
    expect(conversationsAbout(list, null)).toEqual([])
    expect(conversationsAbout(list, { type: 'asset', id: '' })).toEqual([])
  })

  it('tolerate a conversation with no tags at all', () => {
    expect(conversationsAbout([{ id: 'c1' } as never], { type: 'asset', id: 'a1' })).toEqual([])
  })
})

describe('what the band says', () => {
  it('distinguishes none yet from one and from several', () => {
    expect(describeObjectThreads(0, 'AAPL')).toBe('No conversations about AAPL yet.')
    expect(describeObjectThreads(1, 'AAPL')).toBe('1 conversation about AAPL.')
    expect(describeObjectThreads(4, 'AAPL')).toBe('4 conversations about AAPL.')
  })
})

describe('attaching it', () => {
  it('becomes a tag carrying the canonical id and the label', () => {
    expect(objectTag({ type: 'asset', id: 'a1', label: 'AAPL', detail: 'Apple Inc.' }))
      .toEqual({ type: 'asset', id: 'a1', label: 'AAPL' })
  })
})
