import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Increment 1 of Asset Page 2.0: the page may not assert what it has not read.
 *
 * Both defects here were invisible in review and invisible at runtime — one
 * failed a request and swallowed the error, the other turned a warning off by
 * declining to fetch. Neither had a test, and neither would have produced a
 * stack trace. So they are pinned against the source: these are 4,500-line
 * components that cannot be mounted affordably, and the thing worth guarding
 * is one expression in each.
 *
 * Every assertion runs on COMMENT-STRIPPED text. Without that, the long
 * explanations now sitting above both fixes would satisfy the gate on their
 * own, and this file would guard nothing.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))
const HISTORY = codeOf(
  readFileSync(resolve(SRC, 'components/contributions/ThesisHistoryView.tsx'), 'utf8'),
)

describe('a price is fetched for every security, held or not', () => {
  /** THE regression. */
  it('does not gate the quote on owning the asset', () => {
    /*
     * `enabled: !!asset.symbol && portfolioHoldings && portfolioHoldings.length > 0`
     * meant a research candidate had no price, so its upside rendered blank
     * and its rating-vs-EV divergence warning was suppressed — on precisely
     * the assets nobody holds yet.
     */
    const quoteQuery = /queryKey: \['stock-quote'[\s\S]{0,600}?\}\)/.exec(ASSET_TAB)?.[0] ?? ''
    expect(quoteQuery, 'the stock-quote query should still exist').toContain('enabled')
    expect(quoteQuery).not.toMatch(/portfolioHoldings/)
    expect(quoteQuery).toMatch(/enabled:\s*!!asset\.symbol\s*,/)
  })

  it('still declines to fetch without a symbol', () => {
    // The one real precondition: there is nothing to ask a provider for.
    const quoteQuery = /queryKey: \['stock-quote'[\s\S]{0,600}?\}\)/.exec(ASSET_TAB)?.[0] ?? ''
    expect(quoteQuery).toMatch(/!!asset\.symbol/)
  })
})

describe('the thesis history does not read an abandoned table', () => {
  /** THE regression. */
  it('no longer selects a column that does not exist', () => {
    // `price_targets` has `price`, not `target_price` (types/database.ts:725).
    // The request was rejected and the error swallowed, so the timeline
    // rendered with no price-target events and said nothing about it.
    expect(HISTORY).not.toMatch(/target_price/)
  })

  it('does not query the legacy ladder table at all', () => {
    /*
     * Renaming the column would have been worse than leaving it broken:
     * `price_targets` has no writers (its only two are callerless, at
     * AssetTab.tsx:1645 and :1660), so a working query would render a frozen
     * snapshot of targets nobody maintains, in a view called History.
     */
    expect(HISTORY).not.toMatch(/from\('price_targets'\)/)
  })

  it('leaves no loop over a permanently empty array', () => {
    // Dead consumers outlive the query that fed them and read as live code.
    expect(HISTORY).not.toMatch(/priceTargetHistory/)
  })
})

describe('the capital bar strikes every figure at one price', () => {
  /*
   * Net Exposure summed `shares * (currentPrice || held)` — the live quote —
   * while the weight beside it was `(shares * held) / ptotal`, a book price
   * over a book-priced NAV. Two tiles from one array described different
   * portfolios, and a reader could divide the two visible columns of a
   * Current Exposure row and not recover the percentage printed next to them.
   *
   * The denominator (`portfolioTotals`) is never repriced, so the fix is to
   * strike both sides at the book price rather than reprice the numerator —
   * `useAssetLiveWeights.ts:34-37`: "repricing only the numerator against a
   * stale denominator is worse than leaving both stale."
   */
  const bar = /activeSubPage === 'decisions'[\s\S]{0,1400}?holdingMetrics\.reduce/.exec(ASSET_TAB)?.[0] ?? ''

  it('finds the capital bar', () => {
    expect(bar, 'the decisions sub-page block should be locatable').toContain('holdingMetrics')
  })

  it('does not mix a live quote into market value', () => {
    expect(bar).not.toMatch(/currentPrice\s*\|\|\s*held/)
    expect(bar).toMatch(/const mktVal = shares \* held/)
  })

  it('uses the same price in the numerator and the weight', () => {
    // Both must be `shares * held`; the weight additionally divides by the
    // book-priced NAV, which is the same basis.
    expect(bar).toMatch(/const weight = ptotal > 0 \? \(\(shares \* held\) \/ ptotal\) \* 100 : 0/)
  })

  it('prices the Current Exposure row the same way', () => {
    expect(ASSET_TAB).not.toMatch(/const currentValue = shares \* \(currentPrice \|\| held\)/)
    expect(ASSET_TAB).toMatch(/const currentValue = shares \* held/)
  })

  it('does not gate a book-priced exposure on having a quote', () => {
    // The old gate rendered an active-styled em-dash while a perfectly good
    // book-priced exposure was available.
    expect(ASSET_TAB).not.toMatch(/netExposure > 0 && currentPrice > 0/)
  })

  it('still reads the newest row per portfolio, not every upload', () => {
    // The documented holdings-collapse class: `portfolio_holdings` is dated,
    // so a book uploaded three times otherwise appears three times.
    expect(ASSET_TAB).toMatch(/currentRows\(/)
    expect(ASSET_TAB).toMatch(/latestSnapshotRows\(/)
  })
})

describe('the legacy ladder table keeps no live writer', () => {
  it('is written only from code with no callers, pending removal', () => {
    /*
     * Not a fix — a tripwire. `handlePriceTargetSave` and the two mutations
     * it reaches are callerless today, so the legacy table is inert. If a
     * future change wires a button to them, the second ladder becomes live
     * again and an asset's targets acquire two incompatible homes. This
     * fails if that happens, and the fix is to delete them, not to adjust
     * this number.
     */
    const writers = ASSET_TAB.match(/from\('price_targets'\)/g) ?? []
    expect(writers.length).toBeLessThanOrEqual(3)
    expect(ASSET_TAB.match(/handlePriceTargetSave/g) ?? []).toHaveLength(1)
  })
})
