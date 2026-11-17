/**
 * Showing a price in the currency it is actually denominated in.
 *
 * ── Why a `$` is not a neutral default ────────────────────────────────────
 *
 * Every chart in this product rendered `$${value.toFixed(2)}`. For a US book
 * that is right by accident; for SHEL.L it states a Canadian, European or
 * British figure in dollars, and for a London listing it does it on a number
 * that is in PENCE — so the label is wrong about the currency and wrong
 * about the magnitude by a hundredfold at the same time, and both errors
 * look like an ordinary price.
 *
 * So there is no default here. A figure whose currency is unknown is
 * rendered as a bare number. A reader who sees `2,847.50` with no symbol
 * knows they do not know; a reader who sees `$2,847.50` believes something
 * false. Only the second one can lose money.
 *
 * ── The GBp / GBP trap ───────────────────────────────────────────────────
 *
 * `GBp` is pence and `GBP` is pounds, and they differ ONLY by case. Any
 * case-insensitive lookup conflates them, which is exactly the hundredfold
 * error above. `classifyQuotingCurrency` therefore checks a case-SENSITIVE
 * table first, and only then a case-insensitive one for codes like `GBX`
 * that have no same-letters counterpart.
 */
import type { CurrencyUnit } from './freshness'
import { toMajorUnits } from './freshness'

/* ──────────────────────────── quoting units ────────────────────────────── */

const PENCE: CurrencyUnit = { code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 }
const RAND_CENTS: CurrencyUnit = { code: 'ZAC', majorCode: 'ZAR', minorPerMajor: 100 }
const AGOROT: CurrencyUnit = { code: 'ILA', majorCode: 'ILS', minorPerMajor: 100 }

/**
 * Codes whose CASE carries meaning. Checked before anything is lowercased.
 *
 * Yahoo returns `GBp` for London listings and EODHD returns `GBX`; both mean
 * pence. `GBP` means pounds. Lowercasing first would make all three equal.
 */
const MINOR_UNIT_EXACT: Record<string, CurrencyUnit> = {
  GBp: PENCE,
  ZAc: RAND_CENTS,
  ILa: AGOROT,
}

/** Codes with no same-letters major counterpart, so case cannot mislead. */
const MINOR_UNIT_ANY_CASE: Record<string, CurrencyUnit> = {
  gbx: PENCE,
  zac: RAND_CENTS,
  ila: AGOROT,
}

export interface QuotingCurrency {
  /** ISO 4217 only. Absent when the provider said nothing. */
  currency?: string
  /** Present when prices are quoted in a minor unit, e.g. GBX pence. */
  currencyUnit?: CurrencyUnit
}

/**
 * A provider's currency string, split into an ISO code and a quoting unit.
 *
 * Mirrors `classifyQuotingCurrency` in
 * `supabase/functions/_shared/eodhd.ts`, which cannot be imported into the
 * browser bundle. `__tests__/currency.test.ts` asserts the two tables agree,
 * so the pence rule cannot be fixed on one side only.
 */
export function classifyQuotingCurrency(raw: unknown): QuotingCurrency {
  if (typeof raw !== 'string') return {}
  const code = raw.trim()
  if (!code) return {}

  const exact = MINOR_UNIT_EXACT[code]
  if (exact) return { currency: exact.majorCode, currencyUnit: exact }

  const anyCase = MINOR_UNIT_ANY_CASE[code.toLowerCase()]
  if (anyCase) return { currency: anyCase.majorCode, currencyUnit: anyCase }

  return { currency: code.toUpperCase() }
}

/** Every minor-unit code this module knows, for refusing to format one. */
const MINOR_UNIT_CODES = new Set(
  [...Object.values(MINOR_UNIT_EXACT), ...Object.values(MINOR_UNIT_ANY_CASE)].map(u => u.code),
)

/* ─────────────────────────────── formatting ────────────────────────────── */

const ISO_4217_SHAPE = /^[A-Z]{3}$/

/**
 * A price as text, in its own currency, or as a bare number.
 *
 * Returns no currency symbol at all when the code is unknown, malformed, or
 * a minor unit that has not been converted yet. That last case matters:
 * formatting a pence figure as `GBX 2,847.50` would be honest about the unit
 * but is still a number nobody wants to read, and formatting it as `£` would
 * be the hundredfold lie — so a caller is expected to run `displayMoney`,
 * which converts first.
 */
export function formatMoney(value: number, currency?: string): string {
  if (!Number.isFinite(value)) return '—'

  const fixed = Math.abs(value) >= 1000
    ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.toFixed(2)

  if (!currency) return fixed

  // A minor unit reaching here means the caller skipped the conversion. Say
  // the unit plainly rather than attaching a major-unit symbol to it.
  if (MINOR_UNIT_CODES.has(currency.toUpperCase())) return `${fixed} ${currency.toUpperCase()}`

  if (!ISO_4217_SHAPE.test(currency)) return `${fixed} ${currency}`

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    // An unknown-but-well-shaped code. `Intl` throws on some; the code
    // beside the number is still more use than a dollar sign.
    return `${fixed} ${currency}`
  }
}

/**
 * Convert to major units, then format. The one call a chart should make.
 *
 * `converted` is returned so a surface can say where the number came from —
 * "converted from GBX pence" beside a `£` figure is the difference between
 * a reader trusting it and a reader checking it against the venue.
 */
export function displayMoney(
  value: number,
  unit?: QuotingCurrency | null,
): { text: string; currency?: string; converted: boolean } {
  if (!unit) return { text: formatMoney(value), converted: false }

  const major = toMajorUnits(value, unit.currencyUnit, unit.currency)
  return {
    text: formatMoney(major.value, major.currency),
    currency: major.currency,
    converted: !!unit.currencyUnit,
  }
}

/**
 * The value a chart axis should plot, in major units.
 *
 * Axes, tooltips and the current-quote label must all apply the SAME
 * conversion or they disagree by a factor of 100 on the same screen. Every
 * one of them goes through this or through `displayMoney`.
 */
export function toDisplayValue(value: number, unit?: QuotingCurrency | null): number {
  if (!unit?.currencyUnit) return value
  return toMajorUnits(value, unit.currencyUnit, unit.currency).value
}

/**
 * Pick the unit to render a symbol's prices in.
 *
 * The quote is preferred over the series because it is the more specific
 * statement — but either will do, and when neither states a currency the
 * result is `undefined`, which renders as a bare number rather than a guess.
 */
export function resolveDisplayUnit(
  ...candidates: Array<QuotingCurrency | null | undefined>
): QuotingCurrency | undefined {
  for (const candidate of candidates) {
    if (candidate?.currency || candidate?.currencyUnit) return candidate
  }
  return undefined
}
