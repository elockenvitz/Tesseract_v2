/**
 * Quick-adjust chip arithmetic for the mobile sizing sheet.
 *
 * The chips accumulate: tapping +0.25 three times should read "+0.75", not
 * replace the field each time. That requires reading the number already there,
 * which is where the danger is — a bare "2.5" is a *target weight*, and adding
 * a chip to it would silently convert the user's target into a delta and size
 * the position to something they never asked for.
 *
 * Extracted from the sheet so that rule is pinned by tests rather than living
 * inside a component. Every failure here is silent and lands in a real trade.
 */

export type SizingMode = 'weight' | 'shares' | 'active'

/** The prefix a mode's delta syntax carries. */
export function prefixForMode(mode: SizingMode): string {
  return mode === 'shares' ? '#' : mode === 'active' ? '@d' : ''
}

/**
 * The signed delta currently expressed by `value`, or 0 if it is not a delta.
 *
 * Returns 0 — meaning "start from nothing" — for a bare target, for an empty
 * field, for unparseable text, and for a value written in a different mode's
 * syntax. In every one of those cases the alternative is inventing a base the
 * user did not type.
 */
export function currentDelta(value: string, mode: SizingMode): number {
  const raw = value.trim()
  if (!raw) return 0

  const prefix = prefixForMode(mode)
  if (prefix) {
    if (!raw.startsWith(prefix)) return 0
    const body = raw.slice(prefix.length).trim()
    return signedOrZero(body)
  }

  // Weight mode owns the unprefixed syntax, so anything carrying another
  // mode's marker belongs to that mode and must not be stepped here.
  if (raw.startsWith('#') || raw.startsWith('@')) return 0
  return signedOrZero(raw)
}

function signedOrZero(body: string): number {
  // Only an explicitly signed number is a delta. "2.5" is a target.
  if (!/^[+-]/.test(body)) return 0
  const n = parseFloat(body)
  return Number.isFinite(n) ? n : 0
}

/**
 * Apply a chip, returning the new field value.
 *
 * Returns '' when the accumulated delta lands back on zero, so tapping +0.5
 * then −0.5 clears the field rather than leaving a "+0" that reads as a
 * deliberate no-change instruction.
 */
export function applyStep(value: string, mode: SizingMode, amount: number): string {
  const prefix = prefixForMode(mode)
  const next = round2(currentDelta(value, mode) + amount)
  if (next === 0) return ''
  return `${prefix}${next > 0 ? '+' : ''}${next}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
