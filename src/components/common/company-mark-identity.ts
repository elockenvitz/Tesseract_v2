/**
 * The pure half of `CompanyMark`: which colour, and which letters.
 *
 * Separate from the component for two reasons. Fast refresh only works when
 * a module exports components alone, so a shared function living beside the
 * component silently breaks HMR for every file that imports it. And these
 * two are the testable part — a monogram and a palette index are decidable
 * without a DOM.
 */

/**
 * Eight pairs, each a Tailwind background and a foreground with enough
 * contrast on it for a two-character monogram at 11-13px.
 *
 * Deliberately desaturated: this mark sits beside prices and must not
 * out-shout them.
 */
export const MARK_PALETTE = [
  'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
  'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100',
  'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100',
  'bg-cyan-100 text-cyan-900 dark:bg-cyan-900 dark:text-cyan-100',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100',
] as const

/**
 * Stable across sessions and across machines.
 *
 * A plain FNV-1a style accumulation over the code units. The whole point of
 * the colour is RECOGNITION: AAPL must look like itself in global search and
 * on the asset header, every session, with no round trip and nothing to
 * persist. `Math.random`, a `Date`, or anything keyed on render order would
 * give the same company a different colour on every mount, which is the
 * opposite of the point.
 *
 * Hashed over the SYMBOL rather than the row's uuid, so the same company
 * reached by two ids still looks like itself.
 */
export function markPaletteIndex(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % MARK_PALETTE.length
}

/**
 * One or two characters, and never a slice of punctuation.
 *
 * Tickers carry suffixes and separators — `BRK.B`, `RDS-A`, `0700.HK`. The
 * monogram takes letters and digits from the start of the first segment, so
 * `BRK.B` reads `BR` rather than `BR` or `B.` depending on where the dot
 * fell. Falls back to the company name when there is no symbol at all.
 */
export function monogramFor(symbol?: string | null, name?: string | null): string {
  const ticker = (symbol ?? '').trim().toUpperCase()
  const head = ticker.split(/[.\-/ ]/)[0]?.replace(/[^A-Z0-9]/g, '') ?? ''
  if (head.length >= 2) return head.slice(0, 2)
  if (head.length === 1) return head

  const words = (name ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] ?? '') + (words[1][0] ?? '')
  if (words.length === 1) return words[0].slice(0, 2)
  return '—'
}
