/**
 * Showing a price in the currency it is actually in.
 *
 * The bug these close was in every chart in the product: `$${v.toFixed(2)}`.
 * For a US book that is right by accident. For SHEL.L it is wrong twice over
 * — the currency is pounds, not dollars, and the number is in PENCE, so the
 * label understates the currency and overstates the magnitude a hundredfold
 * in the same breath, and the result looks like an ordinary price.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  classifyQuotingCurrency,
  displayMoney,
  formatMoney,
  resolveDisplayUnit,
  toDisplayValue,
} from '../currency'

const WIRE_SRC = readFileSync(
  resolve(__dirname, '../../../../supabase/functions/_shared/eodhd.ts'),
  'utf8',
)

/* ──────────────────────────── the GBp/GBP trap ─────────────────────────── */

describe('pence and pounds are never confused', () => {
  it('reads GBp as pence, reporting GBP with a GBX unit', () => {
    // Yahoo's spelling for London.
    expect(classifyQuotingCurrency('GBp')).toEqual({
      currency: 'GBP',
      currencyUnit: { code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 },
    })
  })

  it('reads GBX as pence too, in any case', () => {
    // EODHD's spelling. No same-letters major counterpart, so case is safe.
    for (const spelling of ['GBX', 'gbx', 'GBx']) {
      expect(classifyQuotingCurrency(spelling).currencyUnit?.code, spelling).toBe('GBX')
    }
  })

  it('reads GBP as pounds, with NO minor unit', () => {
    /*
     * THE trap. `GBp` and `GBP` differ only by case. Any lookup that
     * lowercases first makes them equal, and then a pounds price gets
     * divided by 100 or a pence price does not — a hundredfold error in
     * whichever direction.
     */
    expect(classifyQuotingCurrency('GBP')).toEqual({ currency: 'GBP' })
    expect(classifyQuotingCurrency('GBP').currencyUnit).toBeUndefined()
  })

  it('keeps the same distinction for the other minor units', () => {
    expect(classifyQuotingCurrency('ZAc').currencyUnit?.code).toBe('ZAC')
    expect(classifyQuotingCurrency('ZAR').currencyUnit).toBeUndefined()
    expect(classifyQuotingCurrency('ILa').currencyUnit?.code).toBe('ILA')
    expect(classifyQuotingCurrency('ILS').currencyUnit).toBeUndefined()
  })

  it('upper-cases an ordinary code and states no unit', () => {
    expect(classifyQuotingCurrency('usd')).toEqual({ currency: 'USD' })
    expect(classifyQuotingCurrency(' cad ')).toEqual({ currency: 'CAD' })
  })

  it('says nothing at all when the provider said nothing', () => {
    for (const value of [undefined, null, '', '   ', 42, {}, []]) {
      expect(classifyQuotingCurrency(value), JSON.stringify(value)).toEqual({})
    }
  })

  it('agrees with the server copy of the same table', () => {
    /*
     * The rule is stated twice — here for the browser, and in the edge
     * function, which cannot be imported into the bundle. A drift means the
     * pence rule is fixed on one side only, and the two sides label the same
     * instrument differently.
     */
    expect(WIRE_SRC).toMatch(/MINOR_UNIT_EXACT/)
    expect(WIRE_SRC).toMatch(/GBp:\s*PENCE/)
    expect(WIRE_SRC).toMatch(/minorPerMajor:\s*100/)
    // And the server must not be lowercasing before the exact match.
    const fn = /export function classifyQuotingCurrency[\s\S]*?\n\}/.exec(WIRE_SRC)?.[0] ?? ''
    expect(fn, 'the server classifier was not found').not.toBe('')
    expect(fn.indexOf('MINOR_UNIT_EXACT')).toBeLessThan(fn.indexOf('toLowerCase'))
  })
})

/* ───────────────────────── no silent dollar default ────────────────────── */

describe('an unknown currency is never shown as dollars', () => {
  it('renders a bare number when nothing stated a currency', () => {
    /*
     * THE regression. A reader seeing `2,847.50` knows they do not know the
     * currency. A reader seeing `$2,847.50` believes something false. Only
     * the second can act on it and be wrong.
     */
    expect(formatMoney(2847.5)).not.toContain('$')
    expect(formatMoney(2847.5)).toBe('2,847.50')
    expect(displayMoney(2847.5, null).text).not.toContain('$')
    expect(displayMoney(2847.5, {}).text).not.toContain('$')
  })

  it('does not fall back to USD for a malformed code', () => {
    expect(formatMoney(100, 'DOLLARS')).toBe('100.00 DOLLARS')
    expect(formatMoney(100, 'X')).toBe('100.00 X')
    expect(formatMoney(100, 'DOLLARS')).not.toContain('$')
  })

  it('names a minor unit rather than attaching a major-unit symbol to it', () => {
    // An unconverted pence figure. `£2,847.50` would be the hundredfold lie.
    const out = formatMoney(2847.5, 'GBX')
    expect(out).toContain('GBX')
    expect(out).not.toContain('£')
  })

  it('reports a non-finite value as a dash, not as zero', () => {
    expect(formatMoney(Number.NaN)).toBe('—')
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

/* ───────────────────────── the four required currencies ────────────────── */

describe('each currency renders as itself', () => {
  const textOf = (value: number, currency?: string) => formatMoney(value, currency)

  it('USD renders in dollars', () => {
    expect(textOf(241.3, 'USD')).toMatch(/\$\s?241\.30/)
  })

  it('CAD renders distinguishably from USD', () => {
    /*
     * The one that matters most, because a bare `$` is ambiguous between
     * them and SHOP.TO is in the book. `Intl` renders CAD as `CA$`.
     */
    const cad = textOf(132.45, 'CAD')
    const usd = textOf(132.45, 'USD')
    expect(cad).not.toBe(usd)
    expect(cad).toMatch(/CA\$|CAD|\$/)
    expect(cad).toContain('132.45')
  })

  it('EUR renders in euros', () => {
    const out = textOf(89.2, 'EUR')
    expect(out).toMatch(/€|EUR/)
    expect(out).toContain('89.20')
  })

  it('GBX converts to GBP with no hundredfold error', () => {
    const out = displayMoney(2847.5, {
      currency: 'GBP',
      currencyUnit: { code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 },
    })
    expect(out.currency).toBe('GBP')
    expect(out.converted).toBe(true)
    expect(out.text).toContain('28.48')
    // And emphatically NOT the raw pence figure.
    expect(out.text).not.toContain('2,847')
    expect(out.text).toMatch(/£|GBP/)
  })

  it('GBP in pounds is left alone', () => {
    const out = displayMoney(28.475, { currency: 'GBP' })
    expect(out.converted).toBe(false)
    expect(out.text).toContain('28.48')
  })
})

/* ────────────────────── axis, tooltip and label agree ─────────────────── */

describe('every price on one screen uses one scale', () => {
  const pence = {
    currency: 'GBP',
    currencyUnit: { code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 },
  }

  it('scales an axis value exactly as the label is scaled', () => {
    /*
     * THE failure this prevents: an axis converted to pounds beside a
     * "Current" label left in pence puts the same price on screen twice, a
     * hundredfold apart, both looking reasonable. `toDisplayValue` and
     * `displayMoney` must agree on the factor.
     */
    const raw = 2847.5
    expect(toDisplayValue(raw, pence)).toBe(28.475)
    expect(displayMoney(raw, pence).text).toContain('28.48')
  })

  it('leaves a major-unit value untouched on both paths', () => {
    expect(toDisplayValue(241.3, { currency: 'USD' })).toBe(241.3)
    expect(toDisplayValue(241.3, undefined)).toBe(241.3)
  })

  it('prefers the first candidate that actually states something', () => {
    expect(resolveDisplayUnit(null, { currency: 'CAD' })).toEqual({ currency: 'CAD' })
    expect(resolveDisplayUnit({}, { currency: 'CAD' })).toEqual({ currency: 'CAD' })
    expect(resolveDisplayUnit({ currency: 'USD' }, { currency: 'CAD' }))
      .toEqual({ currency: 'USD' })
  })

  it('returns undefined when no candidate states anything', () => {
    // Which renders a bare number. Not a guess.
    expect(resolveDisplayUnit(null, undefined, {})).toBeUndefined()
  })

  it('refuses to convert against a nonsense scale rather than producing one', () => {
    expect(() => toDisplayValue(100, {
      currency: 'GBP',
      currencyUnit: { code: 'GBX', majorCode: 'GBP', minorPerMajor: 0 },
    })).toThrow(/Refusing to convert/)
  })
})

/* ─────────────────────── the charts actually use it ────────────────────── */

describe('no chart renders a hardcoded dollar sign on a price', () => {
  const stripComments = (s: string) =>
    s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

  const read = (p: string) =>
    stripComments(readFileSync(resolve(__dirname, '../../..', p), 'utf8'))

  it('AdvancedChart formats prices through the shared helper', () => {
    const src = read('components/charts/AdvancedChart.tsx')
    const fn = /const formatValue = useCallback[\s\S]*?\n {2}\}, \[[^\]]*\]\)/.exec(src)?.[0] ?? ''
    expect(fn, 'formatValue was not found').not.toBe('')
    expect(fn.length).toBeGreaterThan(150)
    expect(fn).toContain('displayMoney')
    // The default branch must not reinstate a dollar sign.
    expect(fn).not.toMatch(/`\$\$\{/)
    expect(fn).not.toMatch(/'\$'/)
  })

  it('AdvancedChart declares the unit above the effect that depends on it', () => {
    /*
     * A temporal dead zone check, not a style check. The statistics effect
     * lists `displayUnit` as a dependency, and a dependency array is built
     * during render — so a `const displayUnit` declared after it throws on
     * every render. That exact failure once broke the feed in banner code.
     */
    const src = read('components/charts/AdvancedChart.tsx')
    const declaration = src.indexOf('const displayUnit =')
    const depUse = src.indexOf('[chartData, displayUnit]')
    expect(declaration).toBeGreaterThan(-1)
    expect(depUse).toBeGreaterThan(-1)
    expect(declaration, 'displayUnit is read from inside its temporal dead zone')
      .toBeLessThan(depUse)
  })

  it('FinancialChart formats its quote through the shared helper', () => {
    const src = read('components/charts/FinancialChart.tsx')
    expect(src).toContain('displayMoney')
    // The two sites that carried a literal `$` before a price.
    expect(src).not.toMatch(/\$\{currentQuote\.price\.toFixed/)
    expect(src).not.toMatch(/'\$'\}\{currentQuote/)
    expect(src).not.toMatch(/\}\$\{currentQuote\.change\.toFixed/)
  })

  it('FinancialChart declares the unit above its first use', () => {
    const src = read('components/charts/FinancialChart.tsx')
    const declaration = src.indexOf('const displayUnit =')
    const use = src.indexOf('const priceDisplay =')
    expect(declaration).toBeGreaterThan(-1)
    expect(use).toBeGreaterThan(-1)
    expect(declaration).toBeLessThan(use)
  })
})
