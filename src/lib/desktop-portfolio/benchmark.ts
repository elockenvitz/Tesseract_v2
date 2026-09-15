/**
 * The book against its benchmark file -- and when there is no file to compare.
 *
 * ── The defect this replaces ─────────────────────────────────────────────
 *
 * `useActiveWeights` read `portfolio_benchmark_weights` and folded the rows
 * into a `{ asset_id: weight }` map. A book with no file got `{}` back, and
 * `{}` passed the "do we have data" check, so every held line was compared
 * against `benchmark[asset] ?? 0`: benchmark weight zero, active weight equal
 * to its own weight. The strip then printed "Against the benchmark · ~50%
 * active share · 35 overweight · 0 underweight" for a book with no benchmark at
 * all -- a number with nothing behind it. On 2026-09-15, 29 active portfolios
 * had no file, every pilot book among them.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * Active weights exist only against a benchmark file that loaded and has rows.
 *
 *   loading      the read has not answered yet: draw nothing
 *   unavailable  the read failed, or the file has a constituent with no
 *                usable weight: say so, compute nothing
 *   none         the read succeeded and this book has no file: say so
 *   ready        a file with rows. A held name ABSENT from it is confirmed out
 *                of the index, so its benchmark weight is 0 -- that is a fact
 *                about a file we read, not an assumption about one we did not.
 */

import type { Book } from '../portfolio/holdings'

export interface ActiveWeight {
  assetId: string
  symbol: string | null
  companyName: string | null
  /** The book's weight. */
  weightPct: number
  /** The index's weight; zero only where a loaded file does not hold the name. */
  benchPct: number
  /** Book minus index. The decision. */
  activePct: number
}

/** What the benchmark read produced. */
export type BenchmarkFile =
  | { kind: 'loading' }
  | { kind: 'failed' }
  /** A successful read. An empty map means this book has no file. */
  | { kind: 'loaded'; weights: Record<string, number> }

export type BenchmarkComparison =
  | { state: 'loading'; rows: ActiveWeight[] }
  | { state: 'unavailable'; rows: ActiveWeight[] }
  | { state: 'none'; rows: ActiveWeight[] }
  | { state: 'ready'; rows: ActiveWeight[] }

/** Index names this small are rounding, not a decision. */
export const UNHELD_MIN_PCT = 0.25

/**
 * Turn the newest file's rows into weights, or refuse.
 *
 * A row with a missing or non-numeric weight makes the file incomplete: that
 * constituent's weight is unknown, and treating it as zero would be the same
 * assumed-zero this module exists to stop.
 */
export function benchmarkFileFrom(rows: ReadonlyArray<{ asset_id: string | null; weight: unknown }>): BenchmarkFile {
  const weights: Record<string, number> = {}
  for (const r of rows) {
    if (!r.asset_id) continue
    const w = r.weight == null || r.weight === '' ? NaN : Number(r.weight)
    if (!Number.isFinite(w)) return { kind: 'failed' }
    weights[r.asset_id] = w
  }
  return { kind: 'loaded', weights }
}

export function compareToBenchmark(
  book: Pick<Book, 'positions'> | null,
  file: BenchmarkFile,
  names?: Record<string, { symbol: string | null; name: string | null }>,
): BenchmarkComparison {
  if (!book || file.kind === 'loading') return { state: 'loading', rows: [] }
  if (file.kind === 'failed') return { state: 'unavailable', rows: [] }
  const weights = file.weights
  if (Object.keys(weights).length === 0) return { state: 'none', rows: [] }

  const held = book.positions.filter(p => !p.isCash)
  const seen = new Set(held.map(p => p.assetId))

  const rows: ActiveWeight[] = held.map(p => {
    // Absent from a file that loaded with rows: confirmed not in the index.
    const bench = weights[p.assetId] ?? 0
    return {
      assetId: p.assetId,
      symbol: p.symbol,
      companyName: p.companyName,
      weightPct: p.weightPct,
      benchPct: bench,
      activePct: p.weightPct - bench,
    }
  })

  // The names the index holds and the book does not: decisions too.
  for (const [assetId, w] of Object.entries(weights)) {
    if (seen.has(assetId) || w < UNHELD_MIN_PCT) continue
    rows.push({
      assetId,
      symbol: names?.[assetId]?.symbol ?? null,
      companyName: names?.[assetId]?.name ?? null,
      weightPct: 0, benchPct: w, activePct: -w,
    })
  }

  return { state: 'ready', rows: rows.sort((a, b) => Math.abs(b.activePct) - Math.abs(a.activePct)) }
}
