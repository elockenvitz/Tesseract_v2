import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'

/**
 * The values the feed can actually be filtered by.
 *
 * Read from the assets the org holds or covers rather than from a fixed list,
 * so the picker only ever offers facets that will match something. A filter
 * that can return nothing is worse than no filter — the reader cannot tell an
 * empty result from a broken one.
 *
 * Index membership is deliberately absent: `assets` carries sector, country
 * and exchange, but nothing models index constituents, and inferring "S&P 500"
 * from an exchange would be wrong often enough to be misleading. It needs a
 * real join table before it can be offered.
 */

export interface FeedFacets {
  sectors: string[]
  countries: string[]
  exchanges: string[]
  /** Tickers held or covered, for the ticker picker's search. */
  symbols: { symbol: string; name: string | null }[]
  /**
   * Symbol to its facets, so the feed can decide whether a tile matches
   * without a second query. Keyed uppercase because feed items carry symbols
   * in whatever case their source used.
   */
  bySymbol: Map<string, { sector: string | null; country: string | null; exchange: string | null }>
}

export function useFeedFacets(options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery<FeedFacets>({
    queryKey: ['feed-facets', currentOrgId],
    enabled: (options?.enabled ?? true) && !!currentOrgId,
    // Facets change when coverage changes, which is rarely and never mid-session.
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('assets')
        .select('symbol, company_name, sector, country, exchange')
        .order('symbol')
        .limit(2000)

      const rows = (data ?? []) as any[]
      const uniq = (vals: (string | null)[]) =>
        Array.from(new Set(vals.filter(Boolean) as string[])).sort()

      const bySymbol = new Map<string, { sector: string | null; country: string | null; exchange: string | null }>()
      for (const r of rows) {
        if (!r.symbol) continue
        bySymbol.set(String(r.symbol).toUpperCase(), {
          sector: r.sector ?? null,
          country: r.country ?? null,
          exchange: r.exchange ?? null,
        })
      }

      return {
        bySymbol,
        sectors: uniq(rows.map(r => r.sector)),
        countries: uniq(rows.map(r => r.country)),
        exchanges: uniq(rows.map(r => r.exchange)),
        symbols: rows
          .filter(r => r.symbol)
          .map(r => ({ symbol: r.symbol as string, name: r.company_name ?? null })),
      }
    },
  })
}

/** Everything the reader has narrowed the feed to. Empty sets mean "all". */
export interface FeedFilter {
  /**
   * Canonical CATEGORIES — Decisions, Research, Ideas, Workflow, News.
   *
   * Named `kinds` for historical reasons; it has carried category keys since
   * Curate and Explore were made to filter the same objects by the same words.
   */
  kinds: string[]
  /**
   * `SignalType` keys — the word on the card's own pill.
   *
   * A category is five buckets over thirty card types, so "Research" answers
   * "no thesis", "unreviewed change" and "target expired" all at once. The pill
   * is the thing the reader actually recognises and the thing they mean when
   * they say "show me the no-thesis ones", and nothing filtered on it.
   *
   * Separate from `kinds` rather than folded into it: they compose. Research +
   * No thesis is a narrower question than either alone, and one list holding
   * both vocabularies could not express it.
   */
  signalTypes: string[]
  sectors: string[]
  countries: string[]
  exchanges: string[]
  symbols: string[]
}

export const EMPTY_FILTER: FeedFilter = {
  kinds: [], signalTypes: [], sectors: [], countries: [], exchanges: [], symbols: [],
}

export function filterCount(f: FeedFilter): number {
  return f.kinds.length + f.signalTypes.length + f.sectors.length +
         f.countries.length + f.exchanges.length + f.symbols.length
}

export function isFilterEmpty(f: FeedFilter): boolean {
  return filterCount(f) === 0
}
