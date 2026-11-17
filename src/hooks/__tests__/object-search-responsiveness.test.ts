/**
 * Why the global search felt slow.
 *
 * Two separate faults, both in the wait before anything could render:
 *
 *  1. The static page matches -- "Charting", "Trade Book", "Coverage" -- were
 *     computed INSIDE the `queryFn`, behind the whole network waterfall. They
 *     are a substring test over a compile-time constant array, so typing
 *     "chart" showed an empty dropdown until the round trips finished, in
 *     order to display a row that was a constant in the source.
 *
 *  2. The RPC and the portfolio-mnemonic read ran in series, and nothing
 *     required it: the RPC searches `portfolios.name`, the other searches
 *     `portfolios.portfolio_id`, and neither reads the other's output.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { matchStaticPages } from '../useObjectSearch'

const PAGES = [
  { id: 'charting', title: 'Charting', subtitle: 'Price charts', type: 'page' as const, keywords: ['chart', 'graph'] },
  { id: 'trade-book', title: 'Trade Book', subtitle: 'Committed trades', type: 'page' as const, keywords: ['trades'] },
  { id: 'coverage', title: 'Coverage', subtitle: 'Analyst coverage', type: 'page' as const, keywords: ['analyst'] },
]

/* ───────────────── the local match, with no network at all ────────────── */

describe('local page matches are pure', () => {
  it('finds a page by title', () => {
    expect(matchStaticPages(PAGES, 'chart').map(r => r.id)).toEqual(['charting'])
  })

  it('finds a page by keyword and by subtitle', () => {
    expect(matchStaticPages(PAGES, 'graph').map(r => r.id)).toEqual(['charting'])
    expect(matchStaticPages(PAGES, 'committed').map(r => r.id)).toEqual(['trade-book'])
  })

  it('ignores case and surrounding spaces, the way typing produces them', () => {
    expect(matchStaticPages(PAGES, '  CHARTing ').map(r => r.id)).toEqual(['charting'])
  })

  it('returns nothing for an empty query rather than everything', () => {
    // A dropdown listing every page on an empty box is worse than an empty one.
    expect(matchStaticPages(PAGES, '')).toEqual([])
    expect(matchStaticPages(PAGES, '   ')).toEqual([])
  })

  it('carries the shape the dropdown needs, so no remote row is required', () => {
    const [row] = matchStaticPages(PAGES, 'chart')
    expect(row).toMatchObject({
      id: 'charting',
      title: 'Charting',
      type: 'page',
      data: { pageType: 'charting' },
    })
  })

  it('matches several pages at once', () => {
    expect(matchStaticPages(PAGES, 'o').length).toBeGreaterThan(1)
  })
})

/* ─────────────────────── the waterfall is gone ────────────────────────── */

describe('the search no longer serialises independent reads', () => {
  const hook = readFileSync(resolve(__dirname, '../useObjectSearch.ts'), 'utf8')

  it('issues the RPC and the mnemonic read together', () => {
    expect(hook.length).toBeGreaterThan(2000)
    const parallel = /const \[rpcResult, mnemonicResult\] = await Promise\.all\(\[[\s\S]*?\]\)/.exec(hook)?.[0] ?? ''
    expect(parallel, 'the Promise.all was not found').not.toBe('')
    expect(parallel.length).toBeGreaterThan(200)
    // Both reads must be INSIDE it, not one inside and one left behind.
    expect(parallel).toMatch(/callGlobalSearch\(/)
    expect(parallel).toMatch(/portfolio_id/)
  })

  it('still calls the RPC it says it calls', () => {
    /*
     * `callGlobalSearch` is a typed wrapper, which means the assertion above
     * no longer sees the RPC name. If the wrapper were pointed at a different
     * function, or stubbed, that test would still pass -- so the name is
     * checked where it now lives.
     */
    const helper = /function callGlobalSearch\([\s\S]*?\n\}/.exec(hook)?.[0] ?? ''
    expect(helper, 'the callGlobalSearch helper was not found').not.toBe('')
    expect(helper.length).toBeGreaterThan(100)
    expect(helper).toMatch(/rpc\('global_search', \{ search_query: query, result_limit: 5 \}\)/)
  })

  it('does not issue the mnemonic search a second time', () => {
    /*
     * The specific way this regresses: the Promise.all is added, the original
     * sequential read is left in place, and the request is simply made twice
     * -- so the waterfall survives AND the request count goes up.
     */
    expect((hook.match(/\.ilike\('portfolio_id'/g) ?? []).length).toBe(1)
    const sequential = /await supabase\s*\n?\s*\.from\('portfolios'\)\s*\n?\s*\.select\('id, name, description/.exec(hook)
    expect(sequential, 'the sequential mnemonic search is still there').toBeNull()
  })

  it('leaves the dependent mnemonic back-fill conditional', () => {
    /*
     * A THIRD round trip survives, and honestly cannot be parallelised: the
     * `global_search` RPC returns portfolios without `portfolio_id`, so this
     * fills them in from ids the RPC produced. Removing the hop needs the RPC
     * to select the column, which is a migration and out of scope here.
     *
     * What it must stay is CONDITIONAL, so the common case -- the RPC already
     * carrying the mnemonic -- costs nothing.
     */
    const backfill = /if \(needMnemonic\.length > 0\) \{[\s\S]*?\n {10}\}/.exec(hook)?.[0] ?? ''
    expect(backfill, 'the back-fill guard was not found').not.toBe('')
    expect(backfill.length).toBeGreaterThan(80)
    expect(backfill).toMatch(/from\('portfolios'\)/)
  })

  it('still searches the mnemonic at all', () => {
    // Deleting the read would also remove the waterfall. It would also stop
    // portfolios being findable by their mnemonic.
    expect(hook).toMatch(/\.ilike\('portfolio_id', `%\$\{debouncedQuery\.trim\(\)\}%`\)/)
  })

  it('takes a live query for the local matches and a debounced one for the network', () => {
    /*
     * The debounce is what the network needs and what the local matches must
     * not pay. Both arguments have to be threaded through or the local rows
     * are still 250 ms late.
     */
    expect(hook).toMatch(/matchStaticPages\(visibleStaticPages, liveQuery \?\? debouncedQuery\)/)
    expect(hook).toMatch(/queryKey:[\s\S]{0,200}debouncedQuery/)
  })
})

/* ───────────────── the dropdown renders the local rows first ──────────── */

describe('the dropdown shows local matches before the network answers', () => {
  const ui = readFileSync(resolve(__dirname, '../../components/search/GlobalSearch.tsx'), 'utf8')

  it('passes the live query to the hook', () => {
    expect(ui.length).toBeGreaterThan(2000)
    expect(ui).toMatch(/useObjectSearch\(debouncedQuery, query\)/)
  })

  it('falls back to the local rows when there are no remote rows yet', () => {
    const memo = /const displayResults = useMemo\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\)/.exec(ui)?.[0] ?? ''
    expect(memo, 'the displayResults memo was not found').not.toBe('')
    expect(memo.length).toBeGreaterThan(200)
    // The empty-remote branch must return the local rows, not [].
    expect(memo).toMatch(/if \(remote\.length === 0\) return localResults/)
    expect(memo).toMatch(/\[\.\.\.localResults, \.\.\.remote\.filter/)
  })

  it('deduplicates, because the queryFn returns the static matches too', () => {
    /*
     * The query function has to include them -- its result is what the cache
     * replays on a warm query, so it must be complete on its own. That makes
     * a duplicate certain unless the merge removes it.
     */
    const memo = /const displayResults = useMemo\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\)/.exec(ui)?.[0] ?? ''
    expect(memo).toMatch(/new Set\(localResults\.map/)
    expect(memo).toMatch(/seen\.has\(`\$\{r\.type\}:\$\{r\.id\}`\)/)
  })

  it('recomputes when the local matches change', () => {
    const deps = /const displayResults = useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\)/.exec(ui)?.[1] ?? ''
    expect(deps, 'the memo deps were not found').not.toBe('')
    expect(deps).toContain('localResults')
  })
})
