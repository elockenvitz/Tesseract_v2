/**
 * Candidate retrieval for the Ideas feed — which rows get to be considered.
 *
 * ── Why this is a separate concern ────────────────────────────────────────
 *
 * `useIdeasFeed` does three jobs in one function: it retrieves candidates,
 * ranks them, and hands a page to a shell. The three were never separable, and
 * that hid a defect that looked like a ranking problem and was not one.
 *
 * Every source asked for the newest 20 rows and the scorer ran on those. So
 * coverage — the whole point of which is "put the names this reader is
 * responsible for in front of them" — could only reorder rows that recency had
 * already selected. A covered name that was quiet this week was not ranked low;
 * it was never fetched. Measured on staging: declaring names moved the feed by
 * zero positions.
 *
 * Mobile inherits this. `MobileDashboard` consumes `useIdeasFeed`'s output as
 * one of its eight pooled kinds, so desktop's candidate ceiling is also mobile's
 * candidate ceiling, and no weight in `priorityFor` can reach past it. See
 * docs/tickets/ideas-ranking-divergence.md.
 *
 * This module holds the retrieval mechanics only — window arithmetic, merging,
 * ordering. It imports nothing but types, so it is testable without a Supabase
 * client, which is the same reason `CoverageRelevanceContext` was split in two.
 *
 * The full design, including the strategies that were rejected and the
 * performance budget this commits to, is in
 * docs/tickets/ideas-candidate-retrieval.md.
 */

/**
 * The recency window: how many rows each source contributes per page.
 *
 * Unchanged at `PAGE_SIZE + 5`. Widening it was the obvious fix and the wrong
 * one — it multiplies cost for every reader on every page and only moves the
 * ceiling from position 20 to position 60 without changing what kind of ceiling
 * it is.
 */
export const RECENT_WINDOW = 20

/**
 * The relevance window: how many additional rows a source contributes for
 * assets this reader actually covers.
 *
 * Small on purpose. Eight rows per source per page, ordered newest-first within
 * the covered set, is the reader's recent activity on their own names — which
 * is exactly the material that was missing. It is not a second feed, and it
 * cannot become one: four sources times eight is a hard 32-row ceiling.
 */
export const COVERAGE_WINDOW = 8

/**
 * How far back the relevance pool reaches, in days.
 *
 * Deliberately not the feed's 90-day rolling window, and for the reason
 * `PROPOSAL_DAYS_BACK` already gives about open proposals: the item is a
 * candidate BECAUSE the reader is responsible for the name, and responsibility
 * is not a fact about the calendar. A note on a covered name from five months
 * ago is worth considering; whether it wins a slot is the ranker's business,
 * not retrieval's.
 *
 * Still bounded — an unbounded feed query is a table scan waiting to happen —
 * just bounded by something other than scroll depth.
 */
export const COVERAGE_DAYS_BACK = 365

/**
 * The recency window for a page, as a PostgREST `.range()`.
 *
 * Left exactly as it was: `[offset, offset + 19]` with `offset` advancing by
 * PAGE_SIZE (15), so consecutive windows overlap by five rows. That overlap is
 * pre-existing and deliberate — it is the source's own overfetch for diversity
 * filtering — and the cross-page dedupe in `useIdeasFeed` already absorbs it.
 * Changing it here would alter what every reader sees for reasons unrelated to
 * this work.
 */
export function recentRange(offset: number, size: number = RECENT_WINDOW): [number, number] {
  const from = Math.max(0, offset)
  return [from, from + size - 1]
}

/**
 * The relevance window for a page, as a PostgREST `.range()`.
 *
 * Page-aligned and non-overlapping, unlike the recency window above: page 0
 * takes covered rows 0–7, page 1 takes 8–15, and so on. A pool that never
 * overlaps itself cannot duplicate itself across pages, which is the property
 * that keeps load-more stable without relying on the dedupe downstream to
 * clean up after it.
 */
export function relevanceRange(
  offset: number,
  pageSize: number,
  size: number = COVERAGE_WINDOW,
): [number, number] {
  const page = Math.max(0, Math.floor(offset / Math.max(1, pageSize)))
  const from = page * size
  return [from, from + size - 1]
}

/**
 * Merge candidate pools into one deterministic, duplicate-free set.
 *
 * Pool order is precedence: the first occurrence of an id wins and keeps its
 * position. That mirrors the cross-page dedupe already in `useIdeasFeed`'s
 * `items` memo rather than inventing a second rule, and it means the recency
 * pool — passed first — decides the shape of the merged list, with the
 * relevance pool appending only what recency did not already have.
 *
 * Determinism here is not a nicety. Two pools over the same table WILL overlap
 * for a reader whose covered names are also recently active, and a merge whose
 * output depended on which request resolved first would produce a different
 * candidate set on every load — which is unrankable, untestable, and
 * indistinguishable from a ranking bug.
 */
export function mergeCandidatePools<T>(
  pools: readonly (readonly T[])[],
  idOf: (item: T) => string,
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const pool of pools) {
    for (const item of pool) {
      const id = idOf(item)
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(item)
    }
  }
  return out
}

/** The minimum a candidate needs for a total order to exist over it. */
export interface OrderableCandidate {
  id: string | number
  created_at: string
  score: number
}

/**
 * The desktop feed's sort — a total order, which it previously was not.
 *
 * `scored.sort((a, b) => b.score - a.score)` left equal-scoring cards in
 * whatever order the sources happened to resolve in, so a page could reorder
 * itself between renders with nothing having changed. `compareRanked` on the
 * mobile side documents at length why that is unacceptable; desktop simply
 * never had the equivalent.
 *
 * It matters more now than it did. Merging two pools makes ties both likelier
 * and less obviously stable, and the whole claim of this work — "this covered
 * item can now be considered" — is unfalsifiable if the order it lands in is
 * not reproducible.
 *
 *   1. score       — the ranking decision itself
 *   2. created_at  — newer first, among genuinely equal cards
 *   3. id          — a stable string, so the result is a total order
 *
 * Step 3 is what makes it reproducible: without it `Array.sort` leaves equal
 * elements in input order, and input order is exactly what stopped being
 * meaningful when retrieval became a merge.
 */
export function compareScoredCandidates(
  a: OrderableCandidate,
  b: OrderableCandidate,
): number {
  if (a.score !== b.score) return b.score - a.score
  const at = Date.parse(a.created_at)
  const bt = Date.parse(b.created_at)
  const av = Number.isFinite(at) ? at : 0
  const bv = Number.isFinite(bt) ? bt : 0
  if (av !== bv) return bv - av
  const ai = String(a.id)
  const bi = String(b.id)
  return ai < bi ? -1 : ai > bi ? 1 : 0
}

/**
 * The closed-form upper bound on candidate rows for a page.
 *
 * Stated as a function rather than a comment so a test can hold the budget to
 * it. `pairLegs` grows with depth by design — see `pairLegWindow` — and is the
 * only term that does; everything else is flat per page.
 */
export function candidateRowBudget(
  page: number,
  opts: { sources?: number; hasCoverage?: boolean; pairLegsPerPage?: number } = {},
): number {
  const { sources = 4, hasCoverage = false, pairLegsPerPage = 18 } = opts
  const recent = sources * RECENT_WINDOW
  const relevance = hasCoverage ? sources * COVERAGE_WINDOW : 0
  const pairLegs = pairLegsPerPage * (Math.max(0, page) + 1)
  return recent + relevance + pairLegs
}

// ============================================================
// Reading one source as two pools
// ============================================================

/**
 * A query builder this module can compose against.
 *
 * Structural on purpose: it names the four PostgREST methods retrieval needs
 * and nothing else, so this file has no dependency on the Supabase client and
 * can be exercised against an in-memory table in tests. That is the same split
 * `CoverageRelevanceContext` makes for the same reason — a module that decides
 * policy should not drag a database client into everything that imports it.
 */
export interface CandidateQuery {
  gte(column: string, value: string): CandidateQuery
  in(column: string, values: readonly string[]): CandidateQuery
  range(from: number, to: number): PromiseLike<{ data: any[] | null; error: unknown }>
}

export interface CandidateSourceOptions {
  /**
   * A FRESH builder per call, carrying the table, columns, org scope, mode and
   * asset filters, and ordering — everything the two pools share. It
   * deliberately does not carry the `created_at` bound or the range, because
   * those are the only two things the pools differ on.
   *
   * Composing both pools from one builder is what guarantees the relevance
   * query cannot drift away from the tenant scoping of the recency query beside
   * it: there is exactly one place the filters are written.
   */
  build: () => CandidateQuery
  /** Lower bound for the recency pool — the feed's widening window. */
  recentSince: string
  /** Lower bound for the relevance pool — see COVERAGE_DAYS_BACK. */
  coverageSince: string
  offset: number
  pageSize: number
  /** Empty when the reader has declared nothing, which skips the second query. */
  coveredAssetIds: readonly string[]
  /** Injected so a test can assert what was reported without a console spy. */
  onError?: (pool: 'recent' | 'relevance', error: unknown) => void
}

/**
 * One source's read, as two bounded pools over the same query.
 *
 * ── Why a source needs more than one window ───────────────────────────────
 *
 * Every source used to be `.order('created_at', desc).range(offset, offset+19)`
 * and the scoring — coverage included — ran on whatever that returned. So
 * coverage could reorder a page and never pull a covered idea onto one. A
 * reader whose covered names were quiet this week saw nothing at all for having
 * declared them, and no weight anywhere in the product could change that,
 * because the rows were not in the result set.
 *
 * A reader with no coverage takes the early return: one query, the same rows,
 * the same cost as before this existed. That is the property worth protecting —
 * coverage that nobody has declared must not cost anybody a request.
 */
export async function fetchSourceCandidates(
  opts: CandidateSourceOptions,
): Promise<any[]> {
  const { build, recentSince, coverageSince, offset, pageSize, coveredAssetIds, onError } = opts

  const [recentFrom, recentTo] = recentRange(offset)
  const recent = build().gte('created_at', recentSince).range(recentFrom, recentTo)

  if (coveredAssetIds.length === 0) {
    const { data, error } = await recent
    if (error) onError?.('recent', error)
    return data ?? []
  }

  const [relevanceFrom, relevanceTo] = relevanceRange(offset, pageSize)
  const relevance = build()
    .in('asset_id', coveredAssetIds)
    .gte('created_at', coverageSince)
    .range(relevanceFrom, relevanceTo)

  // In one Promise.all, so the relevance pool costs one query's latency rather
  // than adding a round trip. The budget in the ticket depends on this.
  const [recentResult, relevanceResult] = await Promise.all([recent, relevance])

  if (recentResult.error) onError?.('recent', recentResult.error)
  /**
   * A failed relevance query costs relevance, not the feed.
   *
   * Same instinct as refusal 3 in coverage-relevance: the worst available
   * failure mode is burying everything because one query did not return. The
   * recency pool still stands on its own, so this degrades to exactly the
   * behaviour that shipped before this pool existed.
   */
  if (relevanceResult.error) onError?.('relevance', relevanceResult.error)

  return mergeCandidatePools(
    [recentResult.data ?? [], relevanceResult.data ?? []],
    (row: any) => String(row?.id ?? ''),
  )
}
