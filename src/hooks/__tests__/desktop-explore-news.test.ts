import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { newsToExplore, exploreSymbols } from '../../lib/mobile/explore-adapters'
import type { ExploreItem } from '../../lib/mobile/explore-item'
import { MAX_NEWS_SYMBOLS } from '../useMarketNews'

/**
 * News reaches the desktop field, and the budget goes where it is worth most.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * `useDesktopExplore` called `newsToExplore([])`. The News category had a
 * filter chip, a colour and a registry entry, and no tile could ever belong to
 * it, so the chip selected an empty grid. Desktop was the only surface with
 * that hole; mobile has called the real hook all along.
 *
 * ── The three things this pins ────────────────────────────────────────────
 *
 * 1. The hook calls the news hook at all, with symbols derived from its OWN
 *    composed set rather than a list handed in from elsewhere. That is the
 *    trap this project has hit three times: ask first and compose second, and
 *    the names queried are not the names on screen.
 * 2. The cap spends its budget in the caller's order. `useMarketNews` used to
 *    sort before slicing, which replaced any ranking with the alphabet.
 * 3. A story carries what the desk knows about the name. Without it every
 *    story is a headline and a source, which is what made this family read as
 *    an RSS mosaic.
 */

const ROOT = resolve(__dirname, '../../../')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const HOOK = 'src/hooks/useDesktopExplore.ts'

const story = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  headline: 'Supplier raises guidance',
  url: 'https://example.test/a',
  source: 'Reuters',
  publishedAt: '2026-11-01T12:00:00Z',
  primarySymbol: 'AAPL',
  ...over,
})

const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
  id: 'i1',
  dedupeKey: 'k1',
  signalType: 'no_target',
  category: 'portfolio',
  subtype: 'signal',
  title: 'A finding',
  destination: { kind: 'filter', category: 'portfolio' },
  ...over,
})

describe('the desktop field actually asks for news', () => {
  it('calls the news hook rather than handing the adapter an empty array', () => {
    const src = read(HOOK)
    expect(src).toContain("import { useMarketNews } from './useMarketNews'")
    expect(src).toMatch(/useMarketNews\(newsSymbols, \{ enabled \}\)/)
    expect(src).toMatch(/newsToExplore\(\(news\?\.items \?\? \[\]\) as never\)/)
    // The empty-array call that made News an unreachable category.
    expect(src).not.toContain('newsToExplore([] as never)')
  })

  it('derives the symbols from its own composed set, not a list passed in', () => {
    const src = read(HOOK)
    // Composed first...
    const producedAt = src.indexOf('const produced = useMemo(')
    // ...asked second, off that very set.
    const symbolsAt = src.indexOf('const newsSymbols = useMemo(')
    const queryAt = src.indexOf('useMarketNews(newsSymbols')
    expect(producedAt).toBeGreaterThan(-1)
    expect(symbolsAt).toBeGreaterThan(producedAt)
    expect(queryAt).toBeGreaterThan(symbolsAt)
    expect(src.slice(symbolsAt, queryAt)).toContain('exploreSymbols(')
    expect(src.slice(symbolsAt, queryAt)).toContain('produced')
  })

  it('stops claiming news is missing when stories arrived', () => {
    const src = read(HOOK)
    expect(src).toMatch(/if \(!news\?\.items\?\.length\) gaps\.push\('news'\)/)
    // The unconditional push, which said "no news" over a page of stories.
    expect(src).not.toContain("gaps.push('news', 'templates')")
    // Templates genuinely are still uncalled here, so that one stays.
    expect(src).toContain("gaps.push('templates')")
  })
})

describe('the symbol budget is spent in the caller order', () => {
  /**
   * THE case for the sort-before-slice defect. `useMarketNews` capped at 12
   * AFTER sorting, so a ranked list of thirteen names lost its thirteenth to
   * the alphabet rather than to its rank.
   */
  it('takes the first N the caller ranked, then sorts only for the key', () => {
    const hook = read('src/hooks/useMarketNews.ts')
    const sliceAt = hook.indexOf('.slice(0, MAX_SYMBOLS)')
    const sortAt = hook.indexOf('.sort()')
    expect(sliceAt).toBeGreaterThan(-1)
    expect(sortAt).toBeGreaterThan(-1)
    // Cap first, sort second. The other way round is the defect.
    expect(sliceAt).toBeLessThan(sortAt)
  })

  it('ranks the names by importance before the cap can bite', () => {
    const src = read(HOOK)
    const at = src.indexOf('const newsSymbols = useMemo(')
    const body = src.slice(at, at + 400)
    expect(body).toMatch(/sort\(\(a, b\) => \(b\.importance \?\? 0\) - \(a\.importance \?\? 0\)\)/)
  })

  /**
   * Non-vacuity for the two checks above: a ranking that is thrown away by a
   * later sort is no ranking, so the budget must be reachable from both ends.
   */
  it('keeps the cap a single stated number', () => {
    expect(MAX_NEWS_SYMBOLS).toBe(12)
    expect(read(HOOK)).toContain('exploreSymbols')
  })

  it('returns the names in the order given, deduped and uppercased', () => {
    const got = exploreSymbols([
      item({ id: 'a', symbol: 'zts' }),
      item({ id: 'b', symbol: 'AAPL' }),
      item({ id: 'c', symbol: 'ZTS' }),
      item({ id: 'd', symbol: null }),
    ])
    // Order preserved: a sorted answer would put AAPL first.
    expect(got).toEqual(['ZTS', 'AAPL'])
  })
})

describe('a story carries what the desk knows about the name', () => {
  it('has neither asset nor position of its own, which is why the join exists', () => {
    const [n] = newsToExplore([story()])
    expect(n.symbol).toBe('AAPL')
    // The provider returns neither, so a story could not open the name.
    expect(n.assetId).toBeNull()
    expect(n.portfolio).toBeUndefined()
    expect(n.destination.kind).toBe('article')
    expect((n.destination as { assetId?: string | null }).assetId).toBeNull()
  })

  it('wires the join in the hook, on the article destination too', () => {
    const src = read(HOOK)
    expect(src).toContain('const deskBySymbol = useMemo(')
    expect(src).toMatch(/assetId: n\.assetId \?\? hit\.assetId/)
    expect(src).toMatch(/portfolio: n\.portfolio \?\? hit\.portfolio/)
    // The destination is what a tap reads; filling only the item would leave
    // the story opening nothing.
    expect(src).toMatch(/n\.destination\.kind === 'article' && !n\.destination\.assetId/)
  })

  it('prefers the richest position fact over the first one seen', () => {
    const src = read(HOOK)
    const at = src.indexOf('const deskBySymbol = useMemo(')
    const body = src.slice(at, at + 1200)
    // A finding that names the asset but says nothing about the book must not
    // teach the map that the desk holds nothing.
    expect(body).toMatch(/weightPct != null \|\| !!i\.portfolio\.heldInCount/)
    expect(body).toContain('prior?.assetId ?? i.assetId')
  })

  it('matches the symbol case-insensitively, since the sources disagree', () => {
    const src = read(HOOK)
    expect(src).toMatch(/deskBySymbol\.get\(n\.symbol\.trim\(\)\.toUpperCase\(\)\)/)
    const at = src.indexOf('const deskBySymbol = useMemo(')
    expect(src.slice(at, at + 600)).toMatch(/i\.symbol\?\.trim\(\)\.toUpperCase\(\)/)
  })
})

describe('a story is still a story when the desk knows nothing', () => {
  it('stays drawable with no symbol at all', () => {
    const [n] = newsToExplore([story({ primarySymbol: null })])
    expect(n.category).toBe('news')
    expect(n.title).toBe('Supplier raises guidance')
    // No ticker, no book, and still an openable article.
    expect(n.destination.kind).toBe('article')
  })
})
