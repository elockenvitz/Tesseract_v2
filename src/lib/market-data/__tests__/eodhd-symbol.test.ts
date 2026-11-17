/**
 * Choosing which EODHD listing a Tesseract ticker means.
 *
 * This is the step where a wrong answer is least visible. A failed lookup
 * draws an empty chart and somebody notices. A lookup that silently picks the
 * Frankfurt cross-listing of a US name draws a complete, plausible, correctly
 * labelled chart of a different instrument at a different price in a
 * different currency — and nothing on screen is wrong except the data.
 *
 * So the rule under test is: resolve from the PROVIDER, prefer deliberately,
 * and refuse when it is genuinely ambiguous.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chooseCandidate } from '../eodhd-symbol'
import type { ReferenceRecord } from '../contracts'

const ref = (symbol: string, over: Partial<ReferenceRecord> = {}): ReferenceRecord => ({
  symbol,
  ...over,
})

describe('a bare ticker resolves to one listing or to a refusal', () => {
  it('prefers the US listing when a ticker exists on several venues', () => {
    /*
     * The common case and the dangerous one. `AAPL` exists on EODHD as
     * AAPL.US, AAPL.MX, AAPL.F and more. This product's books are US-centric,
     * so the US line is what a user typing AAPL means — and taking the
     * provider's first row instead would be a coin toss between currencies.
     */
    const out = chooseCandidate('AAPL', [
      ref('AAPL.MX'),
      ref('AAPL.F'),
      ref('AAPL.US'),
    ])
    expect(out).toMatchObject({ ok: true, symbol: 'AAPL.US' })
  })

  it('falls through the venue order rather than stopping at US', () => {
    // SHOP trades in Toronto and New York; a Canada-only ticker must still
    // resolve rather than refusing because no US line exists.
    expect(chooseCandidate('RY', [ref('RY.TO')])).toMatchObject({ ok: true, symbol: 'RY.TO' })
    expect(chooseCandidate('SHEL', [ref('SHEL.L'), ref('SHEL.F')]))
      .toMatchObject({ ok: true, symbol: 'SHEL.L' })
  })

  it('never returns a listing whose ticker is merely similar', () => {
    /*
     * THE wrong-instrument path. EODHD's search matches names as well as
     * tickers, so asking for SHOP returns rows for other companies whose
     * NAME contains the word. Accepting one of those would chart a different
     * security under the requested symbol.
     */
    const out = chooseCandidate('SHOP', [
      ref('SHOPIFY.US', { name: 'Shopify Unsponsored ADR' }),
      ref('SHOP-A.US'),
      ref('SHOPC.L'),
    ])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.failure.kind).toBe('unknown_symbol')
  })

  it('matches the ticker case-insensitively but exactly', () => {
    expect(chooseCandidate('aapl', [ref('AAPL.US')])).toMatchObject({ ok: true, symbol: 'AAPL.US' })
    expect(chooseCandidate('AAP', [ref('AAPL.US')]).ok).toBe(false)
  })

  it('accepts a single match on a venue it has no ordering for', () => {
    // Unambiguous is unambiguous, even on a venue not in the preference list.
    expect(chooseCandidate('CBA', [ref('CBA.AU')])).toMatchObject({ ok: true, symbol: 'CBA.AU' })
  })

  it('refuses, naming the candidates, when several unranked venues match', () => {
    /*
     * Two exact tickers on two venues we have no basis to choose between.
     * Picking one would be a guess; the refusal names both so the user can
     * state the one they meant.
     */
    const out = chooseCandidate('XYZ', [ref('XYZ.AU'), ref('XYZ.NZ')])
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.failure.kind).toBe('not_supported')
      expect('detail' in out.failure && out.failure.detail).toContain('XYZ.AU')
      expect('detail' in out.failure && out.failure.detail).toContain('XYZ.NZ')
    }
  })

  it('refuses an empty candidate list as an unknown symbol', () => {
    const out = chooseCandidate('ZZZZ', [])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.failure).toEqual({ kind: 'unknown_symbol', symbol: 'ZZZZ' })
  })

  it('carries the reference record through, so the unit arrives with the symbol', () => {
    // Saves a second request, and more importantly means the currency unit
    // and the symbol come from the SAME provider response.
    const record = ref('SHEL.L', {
      currency: 'GBP',
      currencyUnit: { code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 },
    })
    const out = chooseCandidate('SHEL', [record])
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.reference?.currencyUnit?.code).toBe('GBX')
  })
})

describe('a suffix is never derived from our own exchange text', () => {
  it('builds no symbol from assets.exchange', () => {
    /*
     * `assets.exchange` is free text in which "NASDAQ", "NasdaqGS" and "XNAS"
     * all appear for one venue. A suffix derived from it produces a
     * valid-LOOKING symbol for the wrong instrument, which is strictly worse
     * than failing.
     */
    const src = readFileSync(resolve(__dirname, '../eodhd-symbol.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    expect(src).not.toMatch(/\.exchange\b/)
    expect(src).not.toMatch(/exchangeLabel\s*\)/)
    // And no string concatenation that appends a suffix to a ticker.
    expect(src).not.toMatch(/\$\{symbol\}\.\$\{/)
    expect(src).not.toMatch(/\+ '\.US'/)
    // It asks the provider instead.
    expect(src).toMatch(/eodhdResolve\(/)
  })

  it('passes a provider-format symbol through without spending a request', () => {
    const src = readFileSync(resolve(__dirname, '../eodhd-symbol.ts'), 'utf8')
    const fn = /export async function resolveEodhdSymbol[\s\S]*?\n\}/.exec(src)?.[0] ?? ''
    expect(fn, 'resolveEodhdSymbol was not found').not.toBe('')
    const dotCheck = fn.indexOf("includes('.')")
    const call = fn.indexOf('eodhdResolve(')
    expect(dotCheck).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(-1)
    expect(dotCheck, 'the already-qualified shortcut must come first').toBeLessThan(call)
  })
})
