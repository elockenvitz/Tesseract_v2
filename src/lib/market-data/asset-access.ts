/**
 * The one way to read `assets`, and the only one that stays correct past 1,000.
 *
 * ── What it replaces ──────────────────────────────────────────────────────
 *
 * Twelve production call sites select from `assets` with no limit and no
 * filter, then filter the result in React. PostgREST caps a response at 1,000
 * rows on this project, so past that size each of them receives the first
 * 1,000 and HTTP 200 — a confident wrong answer. `docs/asset-universe.md`
 * targets ~10,000 names.
 *
 * The shapes those twelve actually need are four, not twelve:
 *
 *   the whole universe, to evaluate a screen or a filter rule client-side
 *   every id, to compute a set complement for an `exclude` rule
 *   a page of search results for a picker
 *   one asset, by id or by ticker
 *
 * Each is expressible without loading the table, or by loading it completely.
 * Both are here; neither is what the twelve do today.
 *
 * ── Why the source is injected ────────────────────────────────────────────
 *
 * This module never imports `src/lib/supabase`. Two reasons, and the second is
 * the load-bearing one:
 *
 *   The gallery build asserts no path from its entry to the Supabase client
 *   (`scripts/gallery-purity.mjs`), so a market-data module that reaches for
 *   the singleton would put every consumer one import away from breaking that
 *   guard.
 *
 *   And a paging loop tested through a mock of the Supabase builder is a test
 *   of the mock. With the source as a plain function, the >1,000 case can be
 *   exercised against an in-memory table that emulates the row cap exactly,
 *   which is the only way to prove the truncation is really gone.
 *
 * The Supabase binding is `supabase-asset-source.ts`, deliberately thin enough
 * to read in one pass.
 */

import {
  buildSymbolIndex,
  resolveSecurity,
  toSecurityRef,
  type SecurityRef,
  type SecurityResolution,
  type SecurityRow,
} from './identity'
import { DEFAULT_MAX_ROWS, POSTGREST_MAX_ROWS, TruncatedReadError } from './paging'

/**
 * A declarative read against `assets`.
 *
 * Declarative rather than a query builder so the transport can be swapped and
 * so a test source is a switch statement over an array rather than a fake
 * PostgREST. Every field narrows; a spec with none is a full-table read and
 * only `iterateUniverse` is allowed to issue one.
 */
export interface AssetQuerySpec {
  columns: readonly string[]
  /**
   * Exact ticker, matched case-insensitively against BOTH `symbol` and
   * `current_symbol`.
   *
   * Both, because a rename must resolve under either ticker: historical
   * records say SQ and a provider says XYZ, and they are one instrument. A
   * source that matches only `symbol` silently loses every renamed name.
   */
  symbol?: string
  /** ISO 10383 venue, to disambiguate a ticker that exists on several. */
  mic?: string
  /** Canonical ids. The source may be called once per chunk; see `byIds`. */
  ids?: readonly string[]
  /** Free text, matched against `symbol` and `company_name`. */
  search?: string
  /** Keyset cursor: rows with `id` strictly greater than this. */
  afterId?: string
  orderBy?: 'id' | 'symbol'
  limit?: number
  /** Offset window. Only for search pages; universe reads use `afterId`. */
  offset?: number
}

/**
 * Runs one spec and returns the rows.
 *
 * Must NOT page internally. Paging is this module's job, and a source that
 * quietly pages would hide the row cap again — which is the bug.
 */
export type AssetRowSource = (spec: AssetQuerySpec) => Promise<SecurityRow[]>

/**
 * The columns that establish identity, matching `ASSET_REFERENCE_COLUMNS`.
 *
 * Deliberately not `*`: the eight proprietary columns on `assets` are revoked
 * from `authenticated` at the column level, and Postgres expands `*` before
 * checking privileges, so a star select fails the whole query rather than
 * returning fewer fields.
 */
export const IDENTITY_COLUMNS = [
  'id',
  'symbol',
  'current_symbol',
  'company_name',
  'exchange',
  'mic',
  'currency',
  'isin',
  'figi',
  'asset_type',
  'lifecycle_status',
] as const

/**
 * How many ids to put in one `in (...)` filter.
 *
 * Not the row cap — a URL length limit. PostgREST takes the filter in the
 * query string, and a thousand UUIDs is roughly 37 KB, past what proxies and
 * servers accept. 200 keeps a chunk near 7 KB.
 */
export const ID_CHUNK_SIZE = 200

/** Page size for universe traversal. One below the server cap. */
export const UNIVERSE_PAGE_SIZE = 999

/** Largest page a search may ask for. A picker that wants more wants paging. */
export const MAX_SEARCH_PAGE_SIZE = 200

export interface SearchOptions {
  limit?: number
  /** Zero-based page index. */
  page?: number
  /** Include instruments that no longer trade. Default false. */
  includeDelisted?: boolean
}

export interface AssetSearchPage {
  rows: SecurityRef[]
  page: number
  /**
   * The next page index, or null when this page is the last.
   *
   * Derived from a short page, not from a total. PostgREST will not give a
   * count without a second request, and a `hasMore` guessed from a full page
   * is right often enough to be trusted and wrong at exactly the boundary.
   */
  nextPage: number | null
}

export interface UniverseOptions {
  columns?: readonly string[]
  pageSize?: number
  maxRows?: number
}

export interface AssetAccess {
  byId(assetId: string): Promise<SecurityRef | null>
  byIds(assetIds: readonly string[]): Promise<Map<string, SecurityRef>>
  resolveSymbol(symbol: string, opts?: { mic?: string }): Promise<SecurityResolution>
  search(query: string, opts?: SearchOptions): Promise<AssetSearchPage>
  universePages(opts?: UniverseOptions): AsyncIterable<SecurityRow[]>
  allRows(opts?: UniverseOptions): Promise<SecurityRow[]>
  allIds(opts?: { maxRows?: number }): Promise<Set<string>>
  symbolIndex(opts?: UniverseOptions): Promise<ReturnType<typeof buildSymbolIndex>>
}

export function createAssetAccess(source: AssetRowSource): AssetAccess {
  async function* universePages(opts: UniverseOptions = {}): AsyncIterable<SecurityRow[]> {
    const columns = opts.columns ?? IDENTITY_COLUMNS
    const pageSize = Math.min(opts.pageSize ?? UNIVERSE_PAGE_SIZE, POSTGREST_MAX_ROWS)
    const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS

    let afterId: string | undefined
    let seen = 0

    for (;;) {
      /**
       * Keyset on the primary key, not `offset`.
       *
       * Offset paging over a table that is being written to can return a row
       * twice and skip another, because the window is positional and the
       * positions move. The universe read is the one place where a skipped row
       * is invisible — it looks exactly like an asset that does not exist —
       * so it gets the paging mode that cannot skip.
       */
      const rows = await source({ columns, afterId, orderBy: 'id', limit: pageSize })
      if (rows.length === 0) return

      seen += rows.length
      if (seen > maxRows) throw new TruncatedReadError('assets universe', seen, maxRows)

      yield rows

      // A short page is the end of the table. It is the only completion signal
      // available without a second counting request.
      if (rows.length < pageSize) return

      const last = rows[rows.length - 1]
      // A source that ignored the cursor would loop forever on the same page.
      // Refusing here turns that into an error rather than a hung tab.
      if (!last?.id || last.id === afterId) {
        throw new Error(
          '[market-data] universe paging did not advance: the source ignored `afterId`.',
        )
      }
      afterId = last.id
    }
  }

  async function allRows(opts: UniverseOptions = {}): Promise<SecurityRow[]> {
    const out: SecurityRow[] = []
    for await (const page of universePages(opts)) out.push(...page)
    return out
  }

  return {
    universePages,
    allRows,

    async byId(assetId) {
      if (!assetId) return null
      const rows = await source({ columns: IDENTITY_COLUMNS, ids: [assetId], limit: 1 })
      return rows.length ? toSecurityRef(rows[0]) : null
    },

    async byIds(assetIds) {
      const unique = [...new Set(assetIds.filter(Boolean))]
      const out = new Map<string, SecurityRef>()
      // Chunked for URL length, and sequential so a batch of 5,000 ids does not
      // open 25 concurrent requests against a database that is also serving the
      // page that asked.
      for (let i = 0; i < unique.length; i += ID_CHUNK_SIZE) {
        const chunk = unique.slice(i, i + ID_CHUNK_SIZE)
        const rows = await source({ columns: IDENTITY_COLUMNS, ids: chunk, limit: chunk.length })
        for (const row of rows) out.set(row.id, toSecurityRef(row))
      }
      return out
    },

    async resolveSymbol(symbol, opts) {
      const want = typeof symbol === 'string' ? symbol.trim() : ''
      if (!want) return { status: 'not_found' }
      /**
       * Server-side narrowing, then the pure resolver over what comes back.
       *
       * The alternative — load the universe and call `resolveSecurity` on it —
       * is what the twelve call sites effectively do, and it is both the slow
       * answer and the wrong one past 1,000 rows. A ticker matches a handful
       * of rows at most, so the narrowed read is bounded by the number of
       * venues rather than by the size of the universe.
       *
       * `limit` is generous rather than 1 deliberately: a ticker on two venues
       * must come back as two rows so the resolver can REFUSE, and asking for
       * one row would turn an ambiguity into a silent pick.
       */
      const rows = await source({
        columns: IDENTITY_COLUMNS,
        symbol: want,
        mic: opts?.mic,
        limit: 32,
      })
      return resolveSecurity(rows, { by: 'symbol', value: want, mic: opts?.mic })
    },

    async search(query, opts = {}) {
      const text = typeof query === 'string' ? query.trim() : ''
      const limit = Math.min(Math.max(opts.limit ?? 25, 1), MAX_SEARCH_PAGE_SIZE)
      const page = Math.max(opts.page ?? 0, 0)
      if (!text) return { rows: [], page, nextPage: null }

      /**
       * One extra row, to answer "is there a next page" without a count.
       *
       * PostgREST can return an exact count, but it costs a second scan of the
       * match set on every keystroke. The extra row costs one row.
       */
      const rows = await source({
        columns: IDENTITY_COLUMNS,
        search: text,
        orderBy: 'symbol',
        offset: page * limit,
        limit: limit + 1,
      })

      const hasMore = rows.length > limit
      const window = hasMore ? rows.slice(0, limit) : rows
      const refs = window
        .map(toSecurityRef)
        .filter(ref => (opts.includeDelisted ?? false) || ref.lifecycle !== 'delisted')

      return { rows: refs, page, nextPage: hasMore ? page + 1 : null }
    },

    async allIds(opts = {}) {
      const ids = new Set<string>()
      for await (const page of universePages({ columns: ['id'], maxRows: opts.maxRows })) {
        for (const row of page) ids.add(row.id)
      }
      return ids
    },

    async symbolIndex(opts) {
      return buildSymbolIndex(await allRows(opts))
    },
  }
}
