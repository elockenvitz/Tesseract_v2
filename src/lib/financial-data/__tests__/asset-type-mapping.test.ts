import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Every instrument a provider can return must map to something true, or to
 * `unknown` — never to `stock` by default.
 *
 * ── Why this is a source test and not a behavioural one ───────────────────
 *
 * The mapping lives in a private `transformSearchResult` on each provider,
 * behind a network call. Standing up three HTTP mocks to assert a lookup table
 * would test the mocks. What actually went wrong here is textual and is
 * exactly what this reads: a `|| 'stock'` fallback on every provider, plus IEX
 * mapping bonds, preferred stock, warrants and rights to common equity.
 *
 * A bond labelled `stock` is the same defect as a null benchmark weight read
 * as "the index excludes it" — absence, or non-recognition, rendered as a
 * confident and specific claim. It is worse here because it is invisible: the
 * search result looks like a perfectly ordinary equity match.
 */

const providers = [
  'src/lib/financial-data/providers/yahoo-finance.ts',
  'src/lib/financial-data/providers/alpha-vantage.ts',
  'src/lib/financial-data/providers/iex-cloud.ts',
]

const read = (p: string) => readFileSync(p, 'utf8')

describe('asset type mapping', () => {
  it('no provider falls back to stock for an unrecognised instrument', () => {
    for (const p of providers) {
      // Matched on the assetType line itself rather than with a bracket
      // pattern: Alpha Vantage indexes with `typeMap[match['3. type']]`, whose
      // nested `]` ended a `[^\]]+` class early and failed a correct file.
      const line = read(p).split('\n').find(l => l.includes('assetType: typeMap'))
      expect(line, `${p} has no assetType mapping line`).toBeTruthy()
      expect(line!, `${p} still defaults an unmapped instrument to 'stock'`)
        .not.toMatch(/'stock'/)
      expect(line!, `${p} has no explicit unknown fallback`)
        .toMatch(/\?\?\s*'unknown'/)
    }
  })

  it('IEX does not file bonds, preferred stock or warrants as common equity', () => {
    // Five distinct instrument kinds were mapped to 'stock'. A bond is not an
    // equity in any sense a portfolio system should paper over.
    const src = read('src/lib/financial-data/providers/iex-cloud.ts')
    expect(src).toMatch(/'bo':\s*'bond'/)
    expect(src).toMatch(/'ps':\s*'preferred'/)
    expect(src).toMatch(/'wa':\s*'warrant'/)
    expect(src).not.toMatch(/'bo':\s*'stock'/)
    expect(src).not.toMatch(/'ps':\s*'stock'/)
  })

  it('every provider maps the classes the product claims to cover', () => {
    // Indexes, ETFs and currencies are named requirements. Yahoo is the only
    // provider that returns all three, so it carries the assertion; the others
    // are checked for what they actually emit.
    const yahoo = read('src/lib/financial-data/providers/yahoo-finance.ts')
    for (const code of ['ETF', 'CRYPTOCURRENCY', 'CURRENCY', 'INDEX', 'MUTUALFUND']) {
      expect(yahoo, `yahoo does not map ${code}`).toMatch(new RegExp(`'${code}':`))
    }
    const alpha = read('src/lib/financial-data/providers/alpha-vantage.ts')
    expect(alpha).toMatch(/'Currency':\s*'forex'/)
    expect(alpha).toMatch(/'Index':\s*'index'/)
  })

  it('the union carries an explicit unknown member', () => {
    // If this is ever removed, every `?? 'unknown'` above becomes a type error
    // and someone will be tempted to "fix" it back to 'stock'.
    expect(read('src/lib/financial-data/types.ts')).toMatch(/\|\s*'unknown'/)
  })
})
