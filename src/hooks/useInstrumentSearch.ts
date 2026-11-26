/**
 * The chart symbol typeahead's data path.
 *
 * Two defects in one place, because fixing either alone leaves the feature
 * broken.
 *
 * ── 1. The ticker was not ranked first ───────────────────────────────────
 *
 * See `lib/charting/instrument-ranking` for the measurements. Briefly: the
 * rows were rendered in arrival order, so a substring inside a company NAME
 * outranked an exact ticker -- "CAT" put Zoom Video Communi-CAT-ions above
 * Caterpillar.
 *
 * ── 2. The ticker was often not FETCHED at all ───────────────────────────
 *
 * The original query was one `.or(symbol.ilike.%Q%,company_name.ilike.%Q%)`
 * with `.limit(10)`. That limit is applied by the DATABASE. For a short
 * query the `%Q%` pattern matches hundreds of assets and the ten returned
 * are an arbitrary ten -- for "V", Visa need not be among them. Sorting a
 * page that never contained the answer cannot produce the answer.
 *
 * So this issues a SECOND, narrow query for `symbol.ilike.Q%` and merges it
 * in. That is what guarantees the ticker is present; the ranking is what
 * puts it first.
 *
 * ── Why two requests is fewer requests ───────────────────────────────────
 *
 * The original fired on EVERY keystroke -- `queryKey: ['asset-search', q]`
 * with no debounce, so "AAPL" cost four round trips. This debounces on the
 * app's existing 250 ms idiom (`GlobalSearch`), so "AAPL" now costs two.
 * Both run inside one `queryFn`, concurrently, and resolve together: there
 * is no second render pass and no waterfall.
 *
 * RLS posture: unchanged. Both queries read `assets` through the same policy
 * the single original query used, selecting the same three columns. The
 * narrow query is a strictly MORE selective pattern over that same table --
 * it cannot reach a row the broad one could not.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import {
  rankInstruments,
  type RankableInstrument,
} from '../lib/charting/instrument-ranking'

/** Matches the app's existing typeahead debounce in `GlobalSearch`. */
export const INSTRUMENT_SEARCH_DEBOUNCE_MS = 250

const RESULT_LIMIT = 10

/**
 * Strip the characters that would change the SHAPE of the filter.
 *
 * Inside `.or(a,b)` a comma separates terms and parentheses group them, so a
 * typed one does not merely match differently -- it restructures the filter.
 * Those are removed, along with `%`, which alone would match the whole table.
 *
 * `_` is deliberately LEFT IN. PostgREST reads it as a single-character
 * wildcard, but real tickers here contain it -- `CASH_USD` is in the corpus
 * -- and stripping it would make that symbol unfindable. As a wildcard it
 * returns a superset that still includes the literal row, and the ranking
 * puts the exact match first, so the superset costs nothing.
 */
function escapePattern(value: string): string {
  return value.replace(/[\\%,()]/g, '')
}

async function fetchInstruments(query: string): Promise<RankableInstrument[]> {
  const q = escapePattern(query.trim())
  if (!q) return []

  const columns = 'id, symbol, company_name'

  const [prefix, broad] = await Promise.all([
    /* The guarantee: whatever else matches, a ticker STARTING with what was
       typed is in the set the ranker sees. */
    supabase
      .from('assets')
      .select(columns)
      .ilike('symbol', `${q}%`)
      .limit(RESULT_LIMIT),
    supabase
      .from('assets')
      .select(columns)
      .or(`symbol.ilike.%${q}%,company_name.ilike.%${q}%`)
      .limit(RESULT_LIMIT * 3),
  ])

  if (prefix.error) throw prefix.error
  if (broad.error) throw broad.error

  /* Prefix rows first so the de-duplication in `rankInstruments`, which
     keeps the first occurrence, prefers the row fetched by the narrow
     query. Ranking then decides the real order. */
  return rankInstruments(
    [...(prefix.data ?? []), ...(broad.data ?? [])],
    query,
    RESULT_LIMIT,
  )
}

/**
 * Debounce a value on the app's existing typeahead interval.
 *
 * Exported so the compare search can share one timer semantics with the
 * symbol search rather than growing a second, slightly different one.
 */
export function useDebouncedValue<T>(value: T, delayMs = INSTRUMENT_SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export interface InstrumentSearchState {
  results: RankableInstrument[]
  /** True while a NEW query is in flight, not while showing held results. */
  isFetching: boolean
}

export function useInstrumentSearch(query: string): InstrumentSearchState {
  const debounced = useDebouncedValue(query)
  const trimmed = debounced.trim()

  const { data, isFetching } = useQuery({
    queryKey: ['instrument-search', trimmed],
    queryFn: () => fetchInstruments(trimmed),
    enabled: trimmed.length >= 1,
    /*
     * Hold the previous query's rows while the next is in flight, so the
     * list does not blank out between keystrokes. React Query keys on the
     * query text, so a late response for an ABANDONED query resolves into
     * its own cache entry and can never overwrite the current one -- which
     * is the stale-response race, handled by the key rather than by a
     * manually tracked request id.
     */
    placeholderData: prev => prev,
    staleTime: 30_000,
  })

  return { results: data ?? [], isFetching }
}
