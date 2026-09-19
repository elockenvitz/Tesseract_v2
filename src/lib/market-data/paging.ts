/**
 * Reading a table that is larger than one request.
 *
 * ── The blocker this removes, stated with the number ──────────────────────
 *
 * PostgREST on this project is configured `{"max_rows": 1000}`.
 * `usePriceHistory` documents it and pages around it; `backfill-price-history
 * .mjs` records the same cap. Everything else does not.
 *
 * Seventeen call sites select from `assets` with no `.limit()` and no filter,
 * and each one loads the whole table to filter it in the browser. Today that
 * table has 911 rows, so all seventeen are correct by four percent. Past 1,000
 * they do not fail — PostgREST returns the first 1,000 rows and a 200 — so:
 *
 *   - `useScreenResults` screens a universe missing everything after the
 *     thousandth ticker, and reports a clean result
 *   - `InvestableUniverseSection` derives its sector, industry, country and
 *     exchange filter menus from the truncated set, so whole sectors vanish
 *     from the filter list rather than from the results
 *   - `backfill-links` builds a ticker-to-asset map that silently stops
 *     linking mentions of anything late in the alphabet
 *
 * A wrong answer delivered confidently, at exactly the universe size this lane
 * exists to reach. It is the single largest scale blocker in the data layer,
 * and it is invisible until someone counts.
 *
 * ── Why a helper rather than a `.limit(5000)` at each site ────────────────
 *
 * `max_rows` caps the response whatever the client asks for, so a larger
 * `.limit()` does nothing at all. Ranged paging is the only mechanism, and
 * writing it seventeen times is seventeen chances to get the loop termination
 * wrong. More importantly this helper cannot silently truncate: it either
 * returns every row or it throws, which converts the failure mode from a wrong
 * answer into a loud one.
 */

/**
 * The server-side cap. Requesting more per page has no effect.
 *
 * A page smaller than the cap is what proves the read is complete: PostgREST
 * cannot tell us a total without a count request, so a short page is the only
 * end-of-data signal that costs nothing.
 */
export const POSTGREST_MAX_ROWS = 1000

/** Default page size. One below the cap, so a full page is never ambiguous. */
export const DEFAULT_PAGE_SIZE = 999

/**
 * A ceiling on total rows, so a runaway loop cannot page a table forever.
 *
 * 50,000 is roughly fifty times the current universe and well past the
 * thousand-name target, while still being a number a browser can hold. Hitting
 * it throws, because a read that large from the client is a design problem to
 * be seen rather than a load to be absorbed.
 */
export const DEFAULT_MAX_ROWS = 50_000

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/** A query narrowed to one row window. Supabase's `.range(from, to)` shape. */
export type PageFetcher<T> = (from: number, to: number) => PromiseLike<PageResult<T>>

export interface PagingOptions {
  pageSize?: number
  maxRows?: number
  /** Named in the error when the ceiling is hit, so the message says where. */
  label?: string
}

export class TruncatedReadError extends Error {
  constructor(
    public readonly label: string,
    public readonly rowsRead: number,
    public readonly maxRows: number,
  ) {
    super(
      `[market-data] read of ${label} hit the ${maxRows}-row ceiling after ${rowsRead} rows. ` +
        'The result would be silently incomplete, so it is refused. Filter server-side ' +
        'or raise maxRows deliberately.',
    )
    this.name = 'TruncatedReadError'
  }
}

/**
 * Every row a query matches, or an error. Never a prefix.
 *
 * Sequential rather than parallel by design. The pages are only known to be
 * complete when a short one arrives, so issuing them concurrently means
 * guessing a page count from a row estimate that PostgREST did not give us.
 * The cost is real — a 5,000-row universe is six round trips — and it is the
 * right trade for a read that runs once per session behind React Query, which
 * is what all seventeen call sites are.
 */
export async function fetchAllRows<T>(
  fetchPage: PageFetcher<T>,
  options: PagingOptions = {},
): Promise<T[]> {
  const pageSize = Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, POSTGREST_MAX_ROWS)
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const label = options.label ?? 'query'

  const out: T[] = []
  let from = 0

  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw new Error(`[market-data] ${label}: ${error.message}`)

    const rows = data ?? []
    out.push(...rows)

    // Short page: the server had nothing more to give, so the read is complete.
    // This is the only termination condition that does not require a count.
    if (rows.length < pageSize) return out

    if (out.length >= maxRows) throw new TruncatedReadError(label, out.length, maxRows)

    from += pageSize
  }
}

/**
 * Assert that a single-request read was not clipped by the server cap.
 *
 * For call sites that legitimately want one request and a bounded result, but
 * must not mistake "the first thousand" for "all of them". Cheap enough to put
 * at every unpaged read; the alternative is finding out from a user that a
 * sector disappeared.
 */
export function assertComplete<T>(rows: readonly T[], label: string): readonly T[] {
  if (rows.length >= POSTGREST_MAX_ROWS) {
    throw new TruncatedReadError(label, rows.length, POSTGREST_MAX_ROWS)
  }
  return rows
}
