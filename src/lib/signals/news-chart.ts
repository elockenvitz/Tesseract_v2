/**
 * Which symbol, if any, a news story's chart is allowed to be about.
 *
 * ── The bug ───────────────────────────────────────────────────────────────
 *
 * Reported from a phone: news cards showing MSFT charts, including for stories
 * that had nothing to do with Microsoft.
 *
 * The cause was not a fallback constant — there is no hardcoded MSFT anywhere.
 * It was this, in the feed's news branch:
 *
 *     const linked = n.symbols
 *       .map(s => assetBySymbol.get(s.toUpperCase()) ?? null)
 *       .find(Boolean) ?? null
 *     ...
 *     pricePane(n.primarySymbol ?? linked?.symbol)
 *
 * `n.symbols` is every ticker the provider tagged on the story — for a macro
 * piece that is routinely a dozen names. `.find(Boolean)` takes the FIRST that
 * happens to exist in our asset table. That is not the story's subject; it is
 * an artefact of the provider's ordering intersected with what this desk
 * happens to own. Large-cap tech is tagged on everything and is held here, so
 * it won that race constantly — and MSFT is one of only 135 symbols with
 * cached history, so it was also one of the few that could actually draw.
 *
 * Two independent selection effects pointing at the same name. It looked like
 * a hardcoded default and was not, which is why patching the visible examples
 * would have fixed nothing.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A chart under a headline is a claim that the headline is about that name. So
 * the symbol has to come from the SOURCE, never from a search over our own
 * holdings:
 *
 *   - the provider named a primary subject      -> use it
 *   - the story carries exactly one symbol      -> that is unambiguous, use it
 *   - several symbols and no declared primary   -> no chart
 *   - no symbols at all (macro, market colour)  -> no chart
 *
 * The last two are the ones that matter. No chart is a perfectly good news
 * card; a chart of the wrong company is a false statement about what happened.
 *
 * Pure — no React, no lookups, no knowledge of what we hold. That is
 * deliberate: what this desk owns must not influence what a story is about.
 */

export interface NewsSymbols {
  /** The provider's declared subject, where it declares one. */
  primarySymbol?: string | null
  /** Every ticker tagged on the story. */
  symbols?: string[] | null
}

export interface NewsChartChoice {
  symbol: string | null
  /** Why, for triage. Never rendered. */
  reason: 'declared_primary' | 'sole_symbol' | 'ambiguous' | 'no_symbols'
}

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null
  const up = s.trim().toUpperCase()
  // Placeholders are values in this data, not absences. See `price-availability`.
  if (!up || up === 'UNKNOWN' || up === 'N/A' || up === '-') return null
  return up
}

export function newsChartSymbol(news: NewsSymbols): NewsChartChoice {
  const primary = clean(news.primarySymbol)
  if (primary) return { symbol: primary, reason: 'declared_primary' }

  const tagged = Array.from(new Set((news.symbols ?? []).map(clean).filter(Boolean) as string[]))

  if (tagged.length === 0) return { symbol: null, reason: 'no_symbols' }
  if (tagged.length === 1) return { symbol: tagged[0], reason: 'sole_symbol' }

  /**
   * Several names and nothing saying which is the subject.
   *
   * The temptation is to pick the one we hold, or the one with history, or the
   * first. All three are the bug. A story about six companies gets no chart.
   */
  return { symbol: null, reason: 'ambiguous' }
}


/**
 * Every symbol a story may be charted against, in order.
 *
 * ── Why this is not the same question as `newsChartSymbol` ────────────────
 *
 * That function answers "which ONE name is this story about", and returns null
 * for a multi-name story on purpose: picking one would assert a subject the
 * source never declared, which is exactly the defect that produced MSFT charts
 * on unrelated headlines.
 *
 * Showing them ALL is a different claim, and an honest one. A carousel of
 * labelled charts says "these are the names this story mentions" — which is
 * true, is what the provider tagged, and lets the reader decide which matters.
 * Nothing is implied about primacy because nothing is singled out.
 *
 * The declared primary leads where there is one, because the source did say so
 * and it should be the first thing under a thumb. The rest follow in the order
 * they were tagged.
 *
 * Capped, because a macro print can carry twenty tickers and a twenty-pane
 * carousel is not evidence, it is a filing cabinet.
 */
export const MAX_NEWS_CHARTS = 4

export function newsChartSymbols(news: NewsSymbols): string[] {
  const primary = clean(news.primarySymbol)
  const tagged = Array.from(new Set((news.symbols ?? []).map(clean).filter(Boolean) as string[]))
  const ordered = primary ? [primary, ...tagged.filter(t => t !== primary)] : tagged
  return ordered.slice(0, MAX_NEWS_CHARTS)
}
