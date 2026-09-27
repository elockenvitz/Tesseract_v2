/**
 * How a committed trade's numbers are written.
 *
 * These were module-local to `AcceptedTradesTable`, which meant the batches
 * view and the phone card each grew their own near-copies: three spellings of
 * a target weight, three of a delta, and two different thresholds for when a
 * dollar figure becomes "K". That is how a trade comes to read as $340K on one
 * screen and $340,000 on the next.
 *
 * The one rule that genuinely must not be re-derived is the sign.
 * `notional_value` is stored as an unsigned magnitude, and whether a trade
 * adds or reduces exposure comes from `action`. A surface that formats the
 * stored number directly shows a sell as a positive amount — which is not a
 * formatting slip, it is the wrong number.
 *
 * Pure: no React, no locale state beyond `toLocaleString`.
 */

/**
 * Apply the trade's direction to the stored magnitude.
 *
 * `sell` and `trim` reduce exposure and read negative; everything else adds.
 * Returns null for a trade with no notional rather than 0, because "not
 * recorded" and "zero dollars" are different facts.
 */
export function signedNotional(
  notional: number | null | undefined,
  action: string,
): number | null {
  if (notional == null) return null
  const mag = Math.abs(notional)
  return action === 'sell' || action === 'trim' ? -mag : mag
}

/**
 * A signed notional, short enough for a column or a phone row.
 *
 * Fully written out, an eight-figure trade is "$34,173,518" — thirteen
 * characters that no sane column width accommodates. Millions and above are
 * abbreviated to three significant figures; below that the exact number is
 * short enough to print. `fmtSignedNotionalFull` carries the precise figure
 * for a tooltip or a detail line, so precision is never actually lost.
 */
export function fmtSignedNotional(val: number | null): string {
  if (val == null) return '—'
  const sign = val < 0 ? '-' : ''
  const abs = Math.abs(val)
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 100_000) return `${sign}$${Math.round(abs / 1_000)}K`
  return `${sign}$${abs.toLocaleString()}`
}

/** The exact figure, for a tooltip or a detail row. */
export function fmtSignedNotionalFull(val: number | null): string {
  if (val == null) return ''
  const abs = Math.abs(val).toLocaleString(undefined, { maximumFractionDigits: 0 })
  return val < 0 ? `-$${abs}` : `$${abs}`
}

/** A target weight: an absolute position size, so never signed. */
export function fmtTargetWeight(weight: number | null | undefined): string {
  if (weight == null) return '—'
  return `${weight.toFixed(2)}%`
}

/** A weight change: signed, because the direction is the point. */
export function fmtDeltaWeight(delta: number | null | undefined): string {
  if (delta == null) return '—'
  return `${delta > 0 ? '+' : ''}${delta.toFixed(2)}%`
}

/** A share change: signed, and grouped, since these run to six figures. */
export function fmtDeltaShares(delta: number | null | undefined): string {
  if (delta == null) return '—'
  return `${delta > 0 ? '+' : ''}${delta.toLocaleString()}`
}

/**
 * The colour a signed figure is written in.
 *
 * Returned as a class rather than a boolean so the three call sites cannot
 * drift on which green or which red, and so zero stays neutral instead of
 * being coloured as a gain.
 */
export function directionalToneClass(value: number | null | undefined): string {
  if (value == null || value === 0) return 'text-gray-500 dark:text-gray-400'
  return value > 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400'
}

/**
 * The list total, as a phone reads it.
 *
 * The desktop table footer prints the exact sum, which at eight figures and
 * three decimal places is a number nobody parses at a glance — and on a phone
 * it is most of a line. This is the same value, abbreviated by the same rule
 * as every other dollar figure here. The precise total is still available
 * through `fmtSignedNotionalFull`.
 */
export function fmtTotalNotional(total: number): string {
  if (!Number.isFinite(total) || total === 0) return ''
  return fmtSignedNotional(Math.abs(total))
}
