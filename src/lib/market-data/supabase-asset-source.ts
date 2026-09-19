/**
 * The Supabase half of `asset-access.ts`, and the only impure file in
 * `src/lib/market-data`.
 *
 * Deliberately thin: it translates an `AssetQuerySpec` into one PostgREST call
 * and returns rows. No paging, no retries, no caching — all of that lives in
 * `asset-access.ts` where it can be tested against an in-memory table.
 *
 * ── Not re-exported from `index.ts`, on purpose ───────────────────────────
 *
 * `scripts/gallery-purity.mjs` asserts the gallery entry has no import path to
 * `src/lib/supabase.ts`. Re-exporting this from the package index would put
 * every consumer of a pure type one hop from the client and make that guard
 * fail for a module that never touches a database. Import this file directly.
 */

import { supabase } from '../supabase'
import type { AssetQuerySpec, AssetRowSource } from './asset-access'
import { createAssetAccess } from './asset-access'
import type { SecurityRow } from './identity'

/**
 * Escape a value going into a PostgREST `or=(...)` filter.
 *
 * A comma ends a filter and a parenthesis ends the group, so a search for
 * `BRK,B` would otherwise be parsed as two filters and either error or — worse
 * — match something nobody asked for. Wrapping in double quotes is PostgREST's
 * own mechanism; an embedded quote is escaped by doubling.
 */
function quoteForOr(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * `%` and `_` are `ilike` wildcards.
 *
 * Without escaping, a user typing `%` matches the entire universe and a picker
 * that should show nothing shows everything. PostgREST does not expose an
 * ESCAPE clause, so the characters are stripped rather than escaped: a ticker
 * has never contained either, so removing them cannot lose a real match.
 */
function literalForIlike(value: string): string {
  return value.replace(/[%_]/g, '')
}

export const supabaseAssetSource: AssetRowSource = async (spec: AssetQuerySpec) => {
  let query = supabase.from('assets').select(spec.columns.join(', '))

  if (spec.ids) {
    if (spec.ids.length === 0) return []
    query = query.in('id', spec.ids as string[])
  }

  if (spec.symbol) {
    /**
     * Both tickers, case-insensitively.
     *
     * `ilike` with no wildcard is an exact case-insensitive match, which is
     * what a ticker lookup wants: `assets_current_symbol` is an index on
     * `upper(current_symbol)`, and the rows store uppercase, so this matches
     * what the classifier scripts wrote.
     */
    const s = quoteForOr(literalForIlike(spec.symbol))
    query = query.or(`symbol.ilike.${s},current_symbol.ilike.${s}`)
  }

  if (spec.mic) query = query.eq('mic', spec.mic.toUpperCase())

  if (spec.search) {
    const s = quoteForOr(`%${literalForIlike(spec.search)}%`)
    query = query.or(`symbol.ilike.${s},company_name.ilike.${s}`)
  }

  // Keyset cursor. Requires the matching `order`, which the caller sets.
  if (spec.afterId) query = query.gt('id', spec.afterId)

  if (spec.orderBy === 'symbol') {
    // `id` as a tiebreaker, because `symbol` is not unique — the same ticker on
    // two venues is two rows, and an unstable order between them would let a
    // page boundary drop one and repeat the other.
    query = query.order('symbol', { ascending: true }).order('id', { ascending: true })
  } else if (spec.orderBy === 'id') {
    query = query.order('id', { ascending: true })
  }

  if (spec.offset != null) {
    const size = spec.limit ?? 25
    query = query.range(spec.offset, spec.offset + size - 1)
  } else if (spec.limit != null) {
    query = query.limit(spec.limit)
  }

  const { data, error } = await query
  if (error) throw new Error(`[market-data] assets read failed: ${error.message}`)
  return (data ?? []) as unknown as SecurityRow[]
}

/**
 * The shared instance.
 *
 * One per module rather than one per call site, so React Query keys and the
 * chunking budget are the same everywhere. It holds no state of its own.
 */
export const assetAccess = createAssetAccess(supabaseAssetSource)
