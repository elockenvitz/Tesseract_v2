/**
 * One asset's benchmark weight, with "not in the benchmark" kept apart from
 * "we don't know".
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * The Outcomes chart read the asset's benchmark row and turned every null into
 * 0%: no row, a failed query, and a portfolio with no benchmark file at all all
 * became "off-benchmark", and active weight was then drawn as the full
 * portfolio weight. For a failed query that is a fabricated number.
 *
 * 0% is only a fact when the portfolio's benchmark file was read and the asset
 * is not in it. So this reads the file first:
 *
 *   1. the portfolio's newest benchmark file date (the `latestBenchmarkRows`
 *      rule: dated files win, an undated file stands only when there is no
 *      dated one);
 *   2. the asset's row in THAT file.
 *
 * A row → its weight. A file without the asset → 0%. No file, a row without a
 * weight → unavailable. A query error is thrown, not returned, so react-query
 * treats it as a failure: it retries, it is not cached as an answer, and a
 * refetch can still turn it into a real weight.
 *
 * Read path: `portfolio_benchmark_weights` through the user's own client, the
 * same table and RLS every other benchmark read already uses. Nothing here
 * widens access.
 */

export type BenchmarkWeight =
  /** The asset is in the portfolio's newest benchmark file. */
  | { status: 'member'; weightPct: number; asOfDate: string | null }
  /** The file was read and the asset is not in it: a real 0%. */
  | { status: 'not_member'; weightPct: 0; asOfDate: string | null }
  /** No benchmark file for the portfolio, or a row with no weight. */
  | { status: 'unavailable' }

interface QueryResult<T> { data: T | null; error: { message: string } | null }

/** The slice of the Supabase query builder this uses. */
export interface BenchmarkQueryClient {
  from(table: 'portfolio_benchmark_weights'): {
    select(columns: string): BenchmarkFilter
  }
}
interface BenchmarkFilter extends PromiseLike<QueryResult<Array<Record<string, unknown>>>> {
  eq(column: string, value: string): BenchmarkFilter
  is(column: string, value: null): BenchmarkFilter
  order(column: string, options: { ascending: boolean; nullsFirst: boolean }): BenchmarkFilter
  limit(n: number): BenchmarkFilter
}

export class BenchmarkLookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BenchmarkLookupError'
  }
}

export async function fetchBenchmarkWeight(
  client: BenchmarkQueryClient,
  portfolioId: string,
  assetId: string,
): Promise<BenchmarkWeight> {
  const file = await client
    .from('portfolio_benchmark_weights')
    .select('as_of_date')
    .eq('portfolio_id', portfolioId)
    .order('as_of_date', { ascending: false, nullsFirst: false })
    .limit(1)
  if (file.error) throw new BenchmarkLookupError(file.error.message)
  if (!file.data || file.data.length === 0) return { status: 'unavailable' }

  const asOfDate = (file.data[0].as_of_date as string | null | undefined) ?? null

  const inFile = client
    .from('portfolio_benchmark_weights')
    .select('weight, as_of_date')
    .eq('portfolio_id', portfolioId)
    .eq('asset_id', assetId)
  const row = await (asOfDate == null ? inFile.is('as_of_date', null) : inFile.eq('as_of_date', asOfDate)).limit(1)
  if (row.error) throw new BenchmarkLookupError(row.error.message)
  if (!row.data || row.data.length === 0) return { status: 'not_member', weightPct: 0, asOfDate }

  const raw = row.data[0].weight
  const weightPct = raw == null ? NaN : Number(raw)
  if (!Number.isFinite(weightPct)) return { status: 'unavailable' }
  return { status: 'member', weightPct, asOfDate }
}

/** The weight the chart may subtract, or null when it must not. */
export function knownBenchmarkWeightPct(benchmark: BenchmarkWeight | null | undefined): number | null {
  if (!benchmark || benchmark.status === 'unavailable') return null
  return benchmark.weightPct
}
