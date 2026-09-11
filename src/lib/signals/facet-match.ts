import type { FeedFilter } from '../../hooks/mobile/useFeedFacets'

/**
 * Does one feed item survive a Curate filter?
 *
 * ── Why this is extracted ─────────────────────────────────────────────────
 *
 * The rule lived inside a `useMemo` in `MobileDashboard`, wrapped around that
 * shell's own entry union — lens entries with no `.card`, insight entries whose
 * framing hides under `insight.issue.framing`, capital stamps read from two
 * places. All of that is mobile's job of working out WHAT an entry is. None of
 * it is the filtering rule.
 *
 * The rule underneath is small and identical everywhere, and a second shell
 * re-deriving it is how two surfaces start disagreeing about what "European
 * industrials" means. So the rule moves here and each shell supplies the facts
 * from its own entry shape.
 *
 * ── The boolean behaviour, which is not obvious ───────────────────────────
 *
 * Values WITHIN a facet are OR — picking two sectors widens.
 * Facets ACROSS each other are AND — adding a country narrows.
 *
 * That is what people expect from faceted filters and the opposite of OR-ing
 * everything together, which would make every extra selection show more.
 *
 * ── The asset-facet rule, which is easy to get wrong ──────────────────────
 *
 * Sector, country and exchange are properties of a SYMBOL. An item with no
 * symbol has no sector, so once any asset facet is set it cannot match — it is
 * not that it matches everything, it is that the question does not apply to it.
 * Mobile's matcher returns false on a missing symbol for exactly this reason,
 * and getting it backwards would flood a sector filter with unrelated tiles.
 *
 * Pure: no React, no Supabase, no clock. Mobile is not rewired onto it in this
 * pass — that is a mobile change — but the rule it encodes is mobile's.
 */

/** What a shell must be able to say about an item for filtering to apply. */
export interface FacetFacts {
  /** Canonical category key. Mobile's `categoryOf`. */
  category?: string | null
  /**
   * The keys on the item's own pill.
   *
   * An array because an item can answer to more than one — mobile resolves
   * research framings and capital issues alongside plain signal types, and all
   * three land in the same `signalTypes` facet.
   */
  signalTypes?: string[]
  /** Uppercased by the caller if the source's casing is unreliable. */
  symbol?: string | null
  sector?: string | null
  country?: string | null
  exchange?: string | null
}

/** True when any facet that is a property of a symbol has a selection. */
export function assetFacetsActive(filter: FeedFilter): boolean {
  return filter.sectors.length > 0 || filter.countries.length > 0 ||
    filter.exchanges.length > 0 || filter.symbols.length > 0
}

export function matchesFeedFacets(facts: FacetFacts, filter: FeedFilter): boolean {
  if (filter.kinds.length) {
    if (!facts.category || !filter.kinds.includes(facts.category)) return false
  }

  if (filter.signalTypes.length) {
    const mine = facts.signalTypes ?? []
    if (!mine.some(t => filter.signalTypes.includes(t))) return false
  }

  if (!assetFacetsActive(filter)) return true

  // No symbol, and the reader is asking a question about symbols.
  const sym = facts.symbol
  if (!sym) return false

  if (filter.symbols.length && !filter.symbols.includes(sym)) return false
  if (filter.sectors.length && !(facts.sector && filter.sectors.includes(facts.sector))) return false
  if (filter.countries.length && !(facts.country && filter.countries.includes(facts.country))) return false
  if (filter.exchanges.length && !(facts.exchange && filter.exchanges.includes(facts.exchange))) return false

  return true
}
