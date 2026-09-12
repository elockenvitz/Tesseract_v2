/**
 * Staging a coverage selection from three sources that overlap.
 *
 * The claims worth pinning: a name reached twice is staged once, an
 * already-covered name can never enter the selection at all — which is what
 * makes the save path incapable of duplicating a row — and an org-assigned row
 * is as untouchable as a personal one.
 */

import { describe, it, expect } from 'vitest'
import {
  mergeCandidates, newFromSector, removeCandidate, toggleCandidate,
  type CoverageCandidate,
} from '../quick-start-selection'

const asset = (id: string, over: Partial<CoverageCandidate> = {}): CoverageCandidate => ({
  id, symbol: id.toUpperCase(), company_name: `${id} Inc`, sector: 'Technology', ...over,
})

const staged = (...ids: string[]) =>
  new Map(ids.map(id => [id, asset(id)]))

const NONE = new Set<string>()

describe('mergeCandidates', () => {
  it('stages every new name from a source', () => {
    const out = mergeCandidates(new Map(), [asset('a'), asset('b')], NONE)
    expect([...out.keys()]).toEqual(['a', 'b'])
  })

  /** A holding is usually in a sector; a searched name is often a holding. */
  it('stages a name reached from two sources only once', () => {
    const withSector = mergeCandidates(new Map(), [asset('a', { reason: 'sector', viaSector: 'Technology' })], NONE)
    const withSearch = mergeCandidates(withSector, [asset('a', { reason: 'search' })], NONE)
    expect(withSearch.size).toBe(1)
    // First arrival wins, so the name keeps saying how it got here.
    expect(withSearch.get('a')?.viaSector).toBe('Technology')
  })

  /**
   * The rule that makes the save path safe. A covered asset cannot enter the
   * selection, so the writer cannot be asked to duplicate one.
   */
  it('refuses a name the user already covers', () => {
    const out = mergeCandidates(new Map(), [asset('a'), asset('b')], new Set(['a']))
    expect([...out.keys()]).toEqual(['b'])
  })

  /**
   * `assetIds` spans both lanes, so an org-assigned name is refused for the
   * same reason a personal one is — and that row is not this user's to touch.
   */
  it('refuses an org-assigned name exactly as it refuses a personal one', () => {
    const out = mergeCandidates(new Map(), [asset('assigned')], new Set(['assigned']))
    expect(out.size).toBe(0)
  })

  it('leaves the input untouched', () => {
    const before = staged('a')
    mergeCandidates(before, [asset('b')], NONE)
    expect([...before.keys()]).toEqual(['a'])
  })

  it('ignores a candidate with no id', () => {
    const out = mergeCandidates(new Map(), [{ id: '' } as CoverageCandidate], NONE)
    expect(out.size).toBe(0)
  })
})

describe('toggleCandidate', () => {
  it('adds then removes', () => {
    const on = toggleCandidate(new Map(), asset('a'), NONE)
    expect(on.has('a')).toBe(true)
    expect(toggleCandidate(on, asset('a'), NONE).has('a')).toBe(false)
  })

  /** A covered name is inert, not removable — there is nothing to remove. */
  it('does nothing for a name the user already covers', () => {
    const current = staged('b')
    expect(toggleCandidate(current, asset('a'), new Set(['a']))).toBe(current)
  })
})

describe('removeCandidate', () => {
  it('drops one staged name and keeps the rest', () => {
    expect([...removeCandidate(staged('a', 'b', 'c'), 'b').keys()]).toEqual(['a', 'c'])
  })

  it('returns the same map when there is nothing to remove', () => {
    const current = staged('a')
    expect(removeCandidate(current, 'zzz')).toBe(current)
  })
})

describe('newFromSector', () => {
  /** What the button promises has to be what the press delivers. */
  it('counts only what a press would actually add', () => {
    const constituents = [asset('a'), asset('b'), asset('c')]
    expect(newFromSector(constituents, staged('a'), new Set(['b']))).toBe(1)
  })

  it('is zero once the sector adds nothing new', () => {
    const constituents = [asset('a')]
    expect(newFromSector(constituents, staged('a'), NONE)).toBe(0)
    expect(newFromSector([], new Map(), NONE)).toBe(0)
  })
})

describe('one sector plus several companies', () => {
  it('dedupes across sources and leaves covered names out', () => {
    const sector = [asset('a', { viaSector: 'Technology' }), asset('b', { viaSector: 'Technology' }), asset('c', { viaSector: 'Technology' })]
    const covered = new Set(['c'])

    let selection = mergeCandidates(new Map(), sector, covered)
    // Two searched names, one of which the sector already brought in.
    selection = mergeCandidates(selection, [asset('b', { reason: 'search' }), asset('d', { reason: 'search' })], covered)

    expect([...selection.keys()]).toEqual(['a', 'b', 'd'])
    expect(selection.get('b')?.viaSector).toBe('Technology')
    expect(selection.has('c')).toBe(false)
  })
})
