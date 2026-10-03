/**
 * Read a portfolio's newest benchmark file WITHOUT downloading its history.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * `latestBenchmarkRows` was written before `portfolio_benchmark_weights`
 * became a dated series, to stop five read sites merging index files across
 * dates once it did. It worked: correctness held. But it filters in the
 * BROWSER, so each of those sites kept selecting every historical row and
 * then discarding almost all of them.
 *
 * The table now holds 33 dates. Measured on production's largest portfolio:
 *
 *   unfiltered read   15,898 rows   2,575,476 bytes   (~2.46 MB)
 *   newest file only     481 rows      77,922 bytes   (~76 KB)
 *
 * A 33x amplification, growing by one more date every day the capture job
 * runs. Roughly 45 such reads a day accounted for ~110 MB of the 119.868 MB
 * of PostgREST egress observed on 2026-09-16.
 *
 * ── Why the date is resolved per portfolio ────────────────────────────────
 *
 * A single global `max(as_of_date)` would be smaller code and a correctness
 * bug. Benchmark files arrive per portfolio and are refreshed independently:
 * production currently holds 33 dates for 7 portfolios, 13 for 23 of them,
 * 5 for three and 1 for one. Their newest dates happen to coincide today
 * because one capture run touched all of them, which is an accident of
 * scheduling and not a guarantee. A global max would silently empty every
 * portfolio whose file had not been refreshed that morning — the same
 * reasoning as `latestSnapshotRows`, and the same shape of bug.
 *
 * So the date is resolved per portfolio, and `latestBenchmarkRows` is still
 * applied to whatever comes back. It is cheap once the payload is already
 * narrow, and it is the backstop that makes a mistake here a performance
 * regression rather than a wrong number.
 */
import { latestBenchmarkRows } from './latest-benchmark'

interface QueryResult<T> { data: T | null; error: { message: string } | null }
type Row = Record<string, unknown>

/** The slice of the Supabase query builder this needs. */
export interface BenchmarkWeightsClient {
  from(table: 'portfolio_benchmark_weights'): { select(columns: string): BenchmarkWeightsFilter }
}
export interface BenchmarkWeightsFilter extends PromiseLike<QueryResult<Row[]>> {
  eq(column: string, value: string): BenchmarkWeightsFilter
  in(column: string, values: readonly string[]): BenchmarkWeightsFilter
  is(column: string, value: null): BenchmarkWeightsFilter
  or(filter: string): BenchmarkWeightsFilter
  order(column: string, options: { ascending: boolean; nullsFirst: boolean }): BenchmarkWeightsFilter
  limit(n: number): BenchmarkWeightsFilter
}

/** The columns every benchmark consumer reads. */
export const BENCHMARK_COLUMNS = 'asset_id, weight, portfolio_id, as_of_date'

/**
 * The newest `as_of_date` on record for one portfolio.
 *
 * `undefined` means the portfolio has no benchmark file at all; `null` means
 * its only rows predate the column. The two are different answers and callers
 * depend on the distinction — "no file" is not "an undated file".
 *
 * One row over the wire, ordered server-side.
 */
export async function fetchLatestBenchmarkDate(
  client: BenchmarkWeightsClient,
  portfolioId: string,
): Promise<string | null | undefined> {
  const { data, error } = await client
    .from('portfolio_benchmark_weights')
    .select('as_of_date')
    .eq('portfolio_id', portfolioId)
    .order('as_of_date', { ascending: false, nullsFirst: false })
    .limit(1)

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return undefined
  return (data[0].as_of_date as string | null | undefined) ?? null
}

/**
 * Every row of one portfolio's newest benchmark file, and nothing older.
 *
 * Two round trips, the second one filtered — the pattern
 * `benchmark-membership.ts` already uses for a single asset, generalised to
 * the whole file.
 */
export async function fetchLatestBenchmarkWeights(
  client: BenchmarkWeightsClient,
  portfolioId: string,
  options?: { assetIds?: readonly string[] },
): Promise<Row[]> {
  const asOf = await fetchLatestBenchmarkDate(client, portfolioId)
  if (asOf === undefined) return []

  let query = client
    .from('portfolio_benchmark_weights')
    .select(BENCHMARK_COLUMNS)
    .eq('portfolio_id', portfolioId)

  // An undated file is matched with `is`, not `eq`: `as_of_date = NULL` is
  // never true in SQL and would return the file as empty.
  query = asOf === null ? query.is('as_of_date', null) : query.eq('as_of_date', asOf)
  if (options?.assetIds) query = query.in('asset_id', options.assetIds)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return latestBenchmarkRows((data ?? []) as never[]) as unknown as Row[]
}

/**
 * The newest benchmark file for each of several portfolios.
 *
 * Shape: one tiny date probe per portfolio in parallel, then ONE row read
 * restricted to the dates those probes returned.
 *
 * The row read filters `as_of_date` to the set of newest dates rather than
 * pairing each portfolio with its own. That is deliberate: PostgREST has no
 * composite `IN`, and the alternative — an `or=(and(portfolio_id.eq.X,
 * as_of_date.eq.D),…)` clause per portfolio — puts an unbounded filter in the
 * URL for a saving that is usually zero. The residual over-fetch is bounded by
 * the number of DISTINCT newest dates among the portfolios asked for: one
 * today, and at worst the portfolio count, instead of the 33 (and climbing)
 * that an unfiltered read transfers. `latestBenchmarkRows` discards the
 * remainder, so the answer is correct either way.
 */
export async function fetchLatestBenchmarkWeightsFor(
  client: BenchmarkWeightsClient,
  portfolioIds: readonly string[],
  options?: { assetIds?: readonly string[] },
): Promise<{ rows: Row[]; datesByPortfolio: Map<string, string | null | undefined> }> {
  const ids = Array.from(new Set(portfolioIds)).filter(Boolean)
  const empty = { rows: [] as Row[], datesByPortfolio: new Map<string, string | null | undefined>() }
  if (ids.length === 0) return empty

  const probes = await Promise.all(
    ids.map(async id => [id, await fetchLatestBenchmarkDate(client, id)] as const),
  )
  const datesByPortfolio = new Map<string, string | null | undefined>(probes)

  const withFile = probes.filter(([, d]) => d !== undefined)
  if (withFile.length === 0) return { rows: [], datesByPortfolio }

  const dated = Array.from(new Set(withFile.map(([, d]) => d).filter((d): d is string => d !== null)))
  const hasUndated = withFile.some(([, d]) => d === null)

  let query = client
    .from('portfolio_benchmark_weights')
    .select(BENCHMARK_COLUMNS)
    .in('portfolio_id', withFile.map(([id]) => id))

  if (dated.length > 0 && hasUndated) {
    // Some portfolios' newest file is dated and others' is not, so neither
    // filter alone covers the set.
    query = query.or(`as_of_date.is.null,as_of_date.in.(${dated.join(',')})`)
  } else if (dated.length > 0) {
    query = query.in('as_of_date', dated)
  } else {
    query = query.is('as_of_date', null)
  }

  if (options?.assetIds) query = query.in('asset_id', options.assetIds)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return {
    rows: latestBenchmarkRows((data ?? []) as never[]) as unknown as Row[],
    datesByPortfolio,
  }
}
