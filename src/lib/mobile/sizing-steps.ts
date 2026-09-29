/**
 * Quick-adjust chip arithmetic for the mobile sizing sheet.
 *
 * ── What a chip means ─────────────────────────────────────────────────────
 *
 * A chip NUDGES whatever is in the field. It does not replace it. If the field
 * holds a recommendation of `7.64` (take the position to 7.64%), tapping −0.25
 * yields `7.39` — the same recommendation, a quarter point smaller. If it holds
 * `+0.5` (add 50bps), tapping −0.25 yields `+0.25`.
 *
 * The adjustment is applied IN KIND: a target stays a target, a delta stays a
 * delta. That is the only way the number on screen and the number executed can
 * mean the same thing.
 *
 * ── The bug this replaces ─────────────────────────────────────────────────
 *
 * `applyStep` used to read a bare target as "no delta yet" and emit the raw
 * chip value, so a +0.50% recommendation on a 7.135% position became the
 * string `-0.25` — a fresh instruction to TRIM a quarter point from the live
 * holding. Executed, that was ~50bps away from what the user had agreed to and
 * inverted the direction from add to trim. A real AAPL trade went out that way.
 *
 * The old behaviour was deliberate and its comment argued that stepping from a
 * target would "silently reinterpret" it. The fear was right; the remedy was
 * backwards. Discarding the recommendation is the more destructive of the two
 * readings, because the field still LOOKS like it is describing the same trade.
 *
 * Every failure here is silent and lands in a real trade, so the rules live in
 * one place with tests rather than inside a component.
 */

export type SizingMode = 'weight' | 'shares' | 'active'

/** The prefix a mode's DELTA syntax carries. */
export function prefixForMode(mode: SizingMode): string {
  return mode === 'shares' ? '#' : mode === 'active' ? '@d' : ''
}

/** The prefix a mode's TARGET syntax carries. */
export function targetPrefixForMode(mode: SizingMode): string {
  return mode === 'shares' ? '#' : mode === 'active' ? '@t' : ''
}

/**
 * What the field currently says, in the terms it says it.
 *
 * `kind` is the distinction the whole module turns on:
 *
 *   target   an absolute destination — "take it to 7.64%"
 *   delta    a signed change         — "add 50bps"
 *   empty    nothing typed yet
 *   foreign  written in another mode's syntax; switching modes leaves the old
 *            string in the field for a moment and it must not be reinterpreted
 */
export interface SizingValue {
  kind: 'empty' | 'target' | 'delta' | 'foreign'
  value: number
}

export function readSizing(value: string, mode: SizingMode): SizingValue {
  const raw = value.trim()
  if (!raw) return { kind: 'empty', value: 0 }

  if (mode === 'shares') {
    if (!raw.startsWith('#')) return { kind: 'foreign', value: 0 }
    return classify(raw.slice(1).trim())
  }

  if (mode === 'active') {
    if (raw.startsWith('@d')) return classifyAs('delta', raw.slice(2).trim())
    if (raw.startsWith('@t')) return classifyAs('target', raw.slice(2).trim())
    return { kind: 'foreign', value: 0 }
  }

  // Weight mode owns the unprefixed syntax.
  if (raw.startsWith('#') || raw.startsWith('@')) return { kind: 'foreign', value: 0 }
  return classify(raw)
}

/** An explicit sign makes it a delta; a bare number is a target. */
function classify(body: string): SizingValue {
  const n = parseFloat(body)
  if (!Number.isFinite(n)) return { kind: 'foreign', value: 0 }
  return /^[+-]/.test(body) ? { kind: 'delta', value: n } : { kind: 'target', value: n }
}

function classifyAs(kind: 'delta' | 'target', body: string): SizingValue {
  const n = parseFloat(body)
  if (!Number.isFinite(n)) return { kind: 'foreign', value: 0 }
  return { kind, value: n }
}

/**
 * @deprecated Reads only the delta case. Use `readSizing`, which distinguishes
 * a target from a delta instead of collapsing the target to zero — collapsing
 * it is what discarded the recommendation.
 *
 * Retained because the sheet's tests and one call site still reference it.
 */
export function currentDelta(value: string, mode: SizingMode): number {
  const read = readSizing(value, mode)
  return read.kind === 'delta' ? read.value : 0
}

/**
 * Apply a chip, returning the new field value.
 *
 * In kind, always:
 *
 *   target + amount -> target    "7.64" , -0.25 -> "7.39"
 *   delta  + amount -> delta     "+0.5" , -0.25 -> "+0.25"
 *   empty  + amount -> delta     ""     , -0.25 -> "-0.25"
 *
 * A delta landing back on zero clears the field, so tapping +0.5 then −0.5
 * leaves nothing rather than a "+0" that reads as a deliberate no-change
 * instruction. A TARGET of zero is not cleared — "take this to 0%" is a real
 * instruction to exit the position, and is the floor: a target cannot go
 * negative, because a negative weight is not a thing you can hold.
 */
export function applyStep(value: string, mode: SizingMode, amount: number): string {
  const current = readSizing(value, mode)

  if (current.kind === 'target') {
    const next = Math.max(0, round2(current.value + amount))
    return `${targetPrefixForMode(mode)}${next}`
  }

  // empty, delta, or a value belonging to another mode: start or continue a delta.
  const base = current.kind === 'delta' ? current.value : 0
  const next = round2(base + amount)
  if (next === 0) return ''
  return `${prefixForMode(mode)}${next > 0 ? '+' : ''}${next}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
