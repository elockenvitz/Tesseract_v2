/**
 * The recents list, and the isolation it has to carry to be allowed on disk.
 *
 * `./workspace-state` keeps the chart workspace in memory on purpose. This
 * list is persisted instead -- a recents list that a reload empties has no
 * reason to exist -- which means the partitioning that the in-memory store
 * gets for free has to be proven here rather than assumed.
 *
 * The cases below are therefore in two groups: what the list DOES, and what
 * it must never do across a principal change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  readRecentInstruments,
  recordRecentInstrument,
  clearRecentInstruments,
  recentInstrumentsKey,
  RECENTS_LIMIT,
} from '../recent-instruments'

const USER = 'user-a'
const ORG = 'org-a'

const asset = (n: number) => ({
  id: `id-${n}`,
  symbol: `SYM${n}`,
  companyName: `Company ${n}`,
})

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('what the list does', () => {
  it('is empty before anything is chosen', () => {
    expect(readRecentInstruments(USER, ORG)).toEqual([])
  })

  it('returns the most recently chosen first', () => {
    recordRecentInstrument(USER, ORG, asset(1))
    recordRecentInstrument(USER, ORG, asset(2))
    recordRecentInstrument(USER, ORG, asset(3))
    expect(readRecentInstruments(USER, ORG).map(r => r.symbol))
      .toEqual(['SYM3', 'SYM2', 'SYM1'])
  })

  it('moves a repeat to the front instead of adding a second copy', () => {
    recordRecentInstrument(USER, ORG, asset(1))
    recordRecentInstrument(USER, ORG, asset(2))
    recordRecentInstrument(USER, ORG, asset(1))
    const list = readRecentInstruments(USER, ORG)
    expect(list.map(r => r.symbol)).toEqual(['SYM1', 'SYM2'])
    expect(list).toHaveLength(2)
  })

  it(`keeps ${RECENTS_LIMIT} DISTINCT instruments, dropping the oldest`, () => {
    for (let n = 1; n <= RECENTS_LIMIT + 4; n++) recordRecentInstrument(USER, ORG, asset(n))
    const list = readRecentInstruments(USER, ORG)
    expect(list).toHaveLength(RECENTS_LIMIT)
    expect(list[0].symbol).toBe(`SYM${RECENTS_LIMIT + 4}`)
    /* The four oldest are gone, not merely pushed past the end. */
    expect(list.map(r => r.symbol)).not.toContain('SYM1')
    expect(new Set(list.map(r => r.id)).size).toBe(RECENTS_LIMIT)
  })

  it('dedupes on the asset id, not the ticker', () => {
    /* Two organizations can hold different assets under one symbol, and a
       ticker is reassigned between companies over time. Collapsing these
       would hand the reader the wrong instrument. */
    recordRecentInstrument(USER, ORG, { id: 'id-old', symbol: 'FB', companyName: 'Facebook' })
    recordRecentInstrument(USER, ORG, { id: 'id-new', symbol: 'FB', companyName: 'Fabled Co' })
    const list = readRecentInstruments(USER, ORG)
    expect(list).toHaveLength(2)
    expect(list.map(r => r.companyName)).toEqual(['Fabled Co', 'Facebook'])
  })

  it('survives a reload, which is the whole point of persisting it', () => {
    recordRecentInstrument(USER, ORG, asset(1))
    /* No in-memory state is carried: a fresh read goes to storage. */
    expect(readRecentInstruments(USER, ORG).map(r => r.symbol)).toEqual(['SYM1'])
  })
})

describe('isolation across a principal change', () => {
  it('does not show one user their colleague list', () => {
    recordRecentInstrument(USER, ORG, asset(1))
    expect(readRecentInstruments('user-b', ORG)).toEqual([])
  })

  it('does not carry a list across an organization switch', () => {
    recordRecentInstrument(USER, ORG, asset(1))
    expect(readRecentInstruments(USER, 'org-b')).toEqual([])
  })

  it('keys a signed-out session separately from a signed-in one', () => {
    expect(recentInstrumentsKey(null, null)).not.toBe(recentInstrumentsKey(USER, ORG))
    recordRecentInstrument(null, null, asset(9))
    expect(readRecentInstruments(USER, ORG)).toEqual([])
  })

  it('clears EVERY principal list, not just the active one', () => {
    recordRecentInstrument(USER, ORG, asset(1))
    recordRecentInstrument('user-b', 'org-b', asset(2))
    clearRecentInstruments()
    expect(readRecentInstruments(USER, ORG)).toEqual([])
    expect(readRecentInstruments('user-b', 'org-b')).toEqual([])
  })

  it('leaves unrelated storage alone when it clears', () => {
    window.localStorage.setItem('sb-project-auth-token', 'keep-me')
    recordRecentInstrument(USER, ORG, asset(1))
    clearRecentInstruments()
    expect(window.localStorage.getItem('sb-project-auth-token')).toBe('keep-me')
  })
})

describe('storage that misbehaves', () => {
  it('reads an empty list rather than throwing on corrupt JSON', () => {
    window.localStorage.setItem(recentInstrumentsKey(USER, ORG), '{not json')
    expect(readRecentInstruments(USER, ORG)).toEqual([])
  })

  it('reads an empty list when the stored value is not an array', () => {
    window.localStorage.setItem(recentInstrumentsKey(USER, ORG), '{"id":"x"}')
    expect(readRecentInstruments(USER, ORG)).toEqual([])
  })

  it('drops entries of the wrong shape instead of rendering them', () => {
    window.localStorage.setItem(
      recentInstrumentsKey(USER, ORG),
      JSON.stringify([{ id: 'ok', symbol: 'OK' }, { symbol: 'NO_ID' }, null, 7, { id: 'x' }]),
    )
    expect(readRecentInstruments(USER, ORG).map(r => r.symbol)).toEqual(['OK'])
  })

  it('does not throw when the storage accessor itself throws', () => {
    /* A private window, or an origin with site data blocked, throws on
       ACCESS -- not merely returning null. An unguarded read here would take
       the charting page down on a browser setting. */
    const boom = () => { throw new Error('SecurityError') }
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(boom)
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(boom)
    expect(() => readRecentInstruments(USER, ORG)).not.toThrow()
    expect(readRecentInstruments(USER, ORG)).toEqual([])
    expect(() => recordRecentInstrument(USER, ORG, asset(1))).not.toThrow()
  })

  it('ignores a selection with no usable id or symbol', () => {
    recordRecentInstrument(USER, ORG, asset(1))
    recordRecentInstrument(USER, ORG, { id: '', symbol: '', companyName: 'nothing' })
    recordRecentInstrument(USER, ORG, { id: '  ', symbol: 'X' })
    expect(readRecentInstruments(USER, ORG).map(r => r.symbol)).toEqual(['SYM1'])
  })

  it('accepts an instrument with no company name', () => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'SYM1' })
    expect(readRecentInstruments(USER, ORG)[0]).toEqual({
      id: 'id-1', symbol: 'SYM1', companyName: null,
    })
  })
})
