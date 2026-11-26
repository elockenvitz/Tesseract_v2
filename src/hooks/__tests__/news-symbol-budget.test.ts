import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { MAX_NEWS_SYMBOLS } from '../useMarketNews'

/**
 * One number for how many names the desk may ask about.
 *
 * ── Two comments, one of them false ───────────────────────────────────────
 *
 * `useMarketNews` capped the list at 12 and said each name "costs a call at
 * two of the three providers". `MobileDashboard` passed 24 and said "the
 * marginal cost of a name is a longer query string". Both cannot be true,
 * and the edge function settles it: `market-news` fans out to THREE sources,
 * and every one of them loops the symbol list a name at a time. Alpha
 * Vantage, the one that batched and the one the mobile comment described, is
 * retired.
 *
 * The 24 never took effect. The hook sliced to 12 on the line after, so half
 * of what the feed built was discarded and its budgeting was against a
 * number that was not in force.
 */

const ROOT = resolve(__dirname, '../../../')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const FN = 'supabase/functions/market-news/index.ts'

describe('the fan-out is per symbol, which is what sets the cap', () => {
  /**
   * THE case, read off the edge function rather than asserted from memory.
   * If a provider is ever changed to batch, this fails and the cap can be
   * revisited with evidence instead of a guess.
   */
  it('loops the symbol list in every remaining source', () => {
    if (!existsSync(resolve(ROOT, FN))) {
      throw new Error(`${FN} is missing; the cap below has no evidence behind it`)
    }
    const fn = read(FN)
    for (const source of ['fromFinnhub', 'fromYahoo', 'fromYahooRss']) {
      const at = fn.indexOf(`async function ${source}(`)
      expect(at, source).toBeGreaterThan(-1)
      // The per-symbol loop, inside that function's first 40 lines.
      expect(fn.slice(at, at + 2000), source).toMatch(/for \(const symbol of symbols\)/)
    }
    /*
     * This used to add "and the one that does not": Alpha Vantage batched the
     * whole symbol list into one `tickers=` parameter, and it was the source
     * the false mobile comment described.
     *
     * It is retired (NEWS_SENTIMENT is a premium endpoint this plan does not
     * include; see `news-source-notes`), so the batching exception is gone and
     * ALL THREE remaining sources are per-symbol. That makes the cap below
     * strictly more load-bearing than it was, not less: there is no longer a
     * source whose cost is flat in the number of symbols.
     */
    // The DECLARATION, not the identifier: the function's own comments
    // explain the retirement by name, and prose must not fail this.
    expect(fn).not.toContain('async function fromAlphaVantage(')
  })
})

describe('the caller asks about exactly what it sends', () => {
  it('slices to the hook cap rather than a number of its own', () => {
    const dash = read('src/components/mobile/MobileDashboard.tsx')
    expect(dash).toContain('MAX_NEWS_SYMBOLS')
    expect(dash).toContain('slice(0, MAX_NEWS_SYMBOLS)')
    // The number that was never in force.
    expect(dash).not.toContain('slice(0, 24)')
  })

  it('states the cap once, where the truncation happens', () => {
    expect(MAX_NEWS_SYMBOLS).toBe(12)
    const hook = read('src/hooks/useMarketNews.ts')
    expect(hook).toContain('slice(0, MAX_SYMBOLS)')
    // The claim that was wrong, gone rather than merely contradicted.
    expect(hook).not.toContain('two of the three providers')
  })

  /**
   * Non-vacuity for the two source checks above: a file that said nothing
   * about either would satisfy a pair of `not.toContain`s. Both must still
   * carry a live reference to the constant.
   */
  it('keeps the constant reachable from both sides', () => {
    expect(read('src/hooks/useMarketNews.ts')).toContain('export const MAX_NEWS_SYMBOLS')
    expect(read('src/components/mobile/MobileDashboard.tsx'))
      .toMatch(/import \{[^}]*MAX_NEWS_SYMBOLS[^}]*\} from '\.\.\/\.\.\/hooks\/useMarketNews'/)
  })
})
