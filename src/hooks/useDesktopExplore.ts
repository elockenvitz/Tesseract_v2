import { useMemo } from 'react'
import {
  lensesToExplore, scenarioCardsToExplore, insightsToExplore,
  ideasToExplore, newsToExplore, attentionToExplore, templatesToExplore,
  aggregatesFor, exploreSymbols,
} from '../lib/mobile/explore-adapters'
import {
  unusualMovers, outsizedActiveRisk, earningsAhead, earningsResult,
  corporateActions, economicReleases,
  type CoveredAsset, type HoldingLike, type QuoteLike,
} from '../lib/mobile/feed-templates'
import { useMarketNews } from './useMarketNews'
import { useMarketEvents } from './useMarketEvents'
import { useMarketData } from './useMarketData'
import { diversifyExplore } from '../lib/mobile/explore-compose'
import { exploreVisualFor } from '../lib/mobile/explore-visual'
import { renderableExploreItems } from '../lib/desktop-ideas/explore-renderable'
import { useDesktopCandidates } from './useDesktopCandidates'
import type { ComposedExploreItem, ExploreItem } from '../lib/mobile/explore-item'
import type { SignalCard } from '../lib/signals/contract'

/**
 * Scenario cards, as the adapter has always expected them.
 *
 * ── The blank tiles ───────────────────────────────────────────────────────
 *
 * `useScenarioCards` returns `CardResult[]` — `{ ok, card }` — and this hook
 * was handing those wrappers straight to `scenarioCardsToExplore`, which reads
 * `headline`, `entity`, `metric`, `provenance` and `evidence` off the card.
 * Every one of those is `undefined` on a wrapper, so each scenario produced an
 * item with no title, no symbol, no metric and no visual: a grid cell
 * containing the word DECISIONS and nothing else. Its id was
 * `scenario-undefined` for all of them, which is the second symptom.
 *
 * Mobile never had this. `MobileDashboard` does `scenarioResults.filter(r =>
 * r.ok).map(r => r.card)` before it calls the same adapter, and the adapter's
 * own test passes a bare card. Desktop is the only caller that got the shape
 * wrong, so the repair belongs here and neither the adapter nor mobile moves.
 *
 * The `ok` filter is not incidental: a suppression is a builder saying this
 * card should not exist, and admitting one to Explore renders the blank
 * rectangle a second way.
 */
function builtScenarioCards(results: unknown[] | null | undefined): SignalCard[] {
  const out: SignalCard[] = []
  for (const r of results ?? []) {
    const w = r as { ok?: boolean; card?: SignalCard } | null
    if (w?.ok && w.card) { out.push(w.card); continue }
    // Already-unwrapped cards are accepted too, the same tolerance the
    // attention feed applies to the same producer.
    if ((r as SignalCard | null)?.id && !('ok' in (r as object))) out.push(r as SignalCard)
  }
  return out
}

/**
 * Explore's candidates, for desktop.
 *
 * ── Explore is not the feed re-sorted ─────────────────────────────────────
 *
 * `explore-compose` states the distinction better than a summary can: Curate
 * ranks by CONSEQUENCE — the most important unresolved thing first — and
 * Explore ranks by INTERESTINGNESS, which is not a total order. The
 * fourth-most-consequential scenario gap is not the fourth-most-interesting
 * thing on a desk; it is the fourth time the reader has been told the same
 * sort of news. So `diversifyExplore` scores, dedupes and then applies
 * repulsion between neighbours of the same sort.
 *
 * That is why Explore cannot be a Curate filter or a grid of the same cards.
 * Different question, different arrangement, same material.
 *
 * ── Same material, no new queries ─────────────────────────────────────────
 *
 * Mobile's own note: "No new content query. Explore is a second arrangement of
 * material already in hand, which is why it can exist without a data programme
 * behind it — and why switching modes is instant rather than a load."
 *
 * Desktop honours that for its own material. Every producer here is an
 * existing org-scoped query with its own cache key, shared with whatever else
 * already reads it, and the Ideas half reuses the very same
 * `useDesktopIdeasFeed` the Ideas mode holds — so entering Explore refetches
 * nothing of the desk's own.
 *
 * News is the stated exception, and it has to be. A story is not material the
 * desk already holds: it is about the OUTSIDE, so nothing on this page could
 * have fetched it. Mobile reached the same conclusion and calls the same
 * cached hook. It is one request behind a five-minute stale time, keyed off
 * the names this page already decided to show, and gated with the surface.
 *
 * ── The adapters are already shared ───────────────────────────────────────
 *
 * `lensesToExplore` and its siblings live under `lib/mobile` but import no
 * React, no Supabase and no clock. The directory name is historical. Nothing
 * here is a desktop copy of an adapter.
 *
 * ── What the producers unlock besides Explore ─────────────────────────────
 *
 * `usePortfolioLenses` and `useScenarioCards` are the producers behind the
 * three tile-engine families already adopted — stale target, scenario gap and
 * target hit. Reaching them here is what makes those families available to
 * desktop at all, through their existing builders. No new family is adopted,
 * and no desktop-only generator exists.
 */
export interface DesktopExplore {
  items: ComposedExploreItem[]
  isLoading: boolean
  /** Producers that returned nothing, so a gap can be reported not filled. */
  missing: string[]
}

export function useDesktopExplore(
  opts: {
    enabled?: boolean
    /**
     * Extra candidates, composed WITH the producers rather than after them.
     *
     * ── Why a supplier and not an array ─────────────────────────────────────
     *
     * Desktop Ideas tops a thin field up with coverage prompts, and how many
     * it may add depends on how many real candidates the producers found --
     * the rule `coverage-prompts` has always applied, counting a different
     * population. The count is not known until `base` exists, so the caller
     * cannot compute the array in advance without duplicating the composition
     * it is trying to join.
     *
     * ── Why here and not in the caller ──────────────────────────────────────
     *
     * `diversifyExplore` scores, dedupes and applies repulsion across the
     * WHOLE set. Prompts concatenated after it would be an unranked block
     * stapled to a ranked one -- a separate section wearing the same tiles.
     * Admitting them to `base` is what makes "ranked alongside" true rather
     * than merely claimed.
     *
     * Explore itself passes nothing and is unchanged.
     */
    extra?: (realCount: number) => ExploreItem[]
  } = {},
): DesktopExplore {
  const enabled = opts.enabled ?? true
  const extra = opts.extra

  /*
   * The same pool Ideas reads. Not a second set of producer calls — both modes
   * are questions about one desk, and the difference is the arrangement below.
   */
  const pool = useDesktopCandidates({ enabled })
  const { lenses, scenarioCards, insights } = pool

  /**
   * Everything the desk's own producers found, before any story is added.
   *
   * Split from the composition below so the news query can be keyed off it.
   * News is the one producer whose INPUT depends on what the other producers
   * found -- it is asked about names, and the names are whatever the desk is
   * already looking at.
   */
  const produced = useMemo(() => [
    ...lensesToExplore(lenses as never),
    ...scenarioCardsToExplore(builtScenarioCards(scenarioCards)),
    ...insightsToExplore((insights ?? []) as never),
    ...ideasToExplore(pool.feedItems as never),
    /*
     * Outstanding work, which this field carried none of.
     *
     * `attentionToExplore` is the only producer that emits the Workflow
     * category, and desktop never called it -- so Workflow was a declared
     * member of the taxonomy, with a filter row and a colour, that no tile
     * could belong to. The rows come from the pool, where the eligibility
     * rule and the trade-row exclusion are documented.
     */
    ...attentionToExplore(pool.attention as never),
  ], [lenses, scenarioCards, insights, pool.feedItems, pool.attention])

  /**
   * The names worth asking about, most consequential first.
   *
   * ── Why the order matters and is not the producers' ─────────────────────
   *
   * `useMarketNews` truncates to `MAX_NEWS_SYMBOLS` (12), and each name costs
   * three upstream calls inside the edge function -- so this is a budget, not
   * a list. Handing it the producers' own emission order would spend the
   * twelve on whichever family happened to run first.
   *
   * Sorted by `importance` instead, which is the bounded nudge each producer
   * already computed, so the budget goes to the findings most likely to be
   * near the top of the field. Beyond twelve a name simply has no story tile.
   * That is a graceful degradation and not a silent one: every other tile on
   * the page stands on its own, and none of them claims a story it has not
   * got. The same lesson mobile recorded for its sparkline batch.
   */
  const newsSymbols = useMemo(
    () => exploreSymbols([...produced].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))),
    [produced],
  )

  /*
   * One org-scoped query, shared with whatever else asks about the same names.
   * Gated with the surface, so an inactive Explore holds no request open.
   */
  const { data: news } = useMarketNews(newsSymbols, { enabled })

  /*
   * ── The market templates, which desktop never drew ──────────────────────
   *
   * `templatesToExplore` was the one producer this hook reported as a
   * permanent gap: `missing` pushed 'templates' unconditionally, so the
   * surface said "no templates" on every render whether or not there were
   * any. The reason given was that the builders need quotes, market events and
   * a symbol-to-asset map "that only MobileDashboard assembles". Two of those
   * three are hooks keyed off a symbol list this file already computes, and
   * the third is a projection of producer output already in memory.
   *
   * Both queries are keyed off `newsSymbols` -- the same budgeted twelve the
   * news query spends, so no name is asked about here that was not already
   * worth asking about -- and both are gated with the surface. That is one
   * additional edge call and one quote batch, which is the same price mobile
   * pays for the same six families.
   */
  const { data: events } = useMarketEvents(newsSymbols, { enabled })
  const { quotes } = useMarketData(newsSymbols, {
    enabled: enabled && newsSymbols.length > 0,
  })

  /**
   * Symbol to asset, for the templates that turn a market fact into something
   * openable.
   *
   * Built from producer output rather than fetched: every item that names a
   * ticker was emitted by an adapter that also knew the asset it belonged to.
   * `companyName` and `sector` are optional on `CoveredAsset` and are left
   * absent rather than guessed -- an adapter that did not carry them is not
   * grounds for inventing them.
   */
  const assetBySymbol = useMemo(() => {
    const map = new Map<string, CoveredAsset>()
    for (const i of produced) {
      const sym = i.symbol?.trim().toUpperCase()
      if (!sym || !i.assetId || map.has(sym)) continue
      map.set(sym, { id: i.assetId, symbol: sym })
    }
    return map
  }, [produced])

  /**
   * Quotes for the template builders, in the shape they take.
   *
   * `unusualMovers` judges a move against the MEDIAN of the set it is given,
   * so the set must be every name we have a quote for and not a filtered
   * selection -- narrowing it to the interesting ones is how a flat tape
   * manufactures drama. A quote with no finite change is dropped here because
   * it contributes nothing to a median either way.
   */
  const quoteList = useMemo<QuoteLike[]>(() => {
    const out: QuoteLike[] = []
    for (const sym of newsSymbols) {
      const q = quotes.get(sym.toUpperCase())
      if (!q) continue
      /* `changePercent` is legitimately nullable -- a change needs two
         observations and providers often give one. Checked by type and not
         only by `Number.isFinite`, which does not narrow. Dropping the quote
         is right: a name with no move contributes nothing to the median the
         unusual-mover test is taken against. */
      const { price, changePercent } = q
      if (typeof price !== 'number' || !Number.isFinite(price)) continue
      if (typeof changePercent !== 'number' || !Number.isFinite(changePercent)) continue
      out.push({ symbol: sym, price, changePercent })
    }
    return out
  }, [newsSymbols, quotes])

  /**
   * The whole book's active weights, which is the only population this
   * template may be given.
   *
   * ── Why it is not the twelve names on screen ────────────────────────────
   *
   * `outsizedActiveRisk` prints "X is your largest overweight at +N%". That
   * is a claim about the BOOK. Fed the dozen names the lenses happened to
   * surface, it would still print the superlative, and it would be wrong --
   * the largest active weight among twelve selected names is not the largest
   * active weight the desk holds. This codebase has a documented defect class
   * for exactly this (portfolio holdings collapsing at aggregating query
   * sites), and a figure a reader cannot trust is worse than a tile that is
   * not drawn.
   *
   * So it reads `lenses.weightIndex`, which covers EVERY (asset, book)
   * exposure in the organisation on the canonical methodology, labelled by
   * `lenses.symbolByAssetId`. No new query: both are projections of holdings
   * the lenses query already fetched.
   *
   * An exposure whose weight or benchmark weight is null is skipped rather
   * than defaulted to zero. Null means the book cannot support the claim -- no
   * denominator, too few positions, or no benchmark file at all -- and reading
   * that as 0% would turn "we cannot say" into "the benchmark does not hold
   * it", which is a different and much stronger statement.
   */
  const activeRiskRows = useMemo<HoldingLike[]>(() => {
    const index = lenses?.weightIndex
    const labels = lenses?.symbolByAssetId
    if (!index || !labels) return []
    const out: HoldingLike[] = []
    for (const [assetId, exposures] of index) {
      const symbol = labels.get(assetId)
      if (!symbol) continue
      for (const e of exposures) {
        if (e.portfolioPct == null || e.benchmarkPct == null) continue
        out.push({
          assetId,
          symbol,
          weight: e.portfolioPct,
          benchmarkWeight: e.benchmarkPct,
        })
      }
    }
    return out
  }, [lenses])

  /** The six market families, from the data gathered above. */
  const templateCards = useMemo(() => [
    ...unusualMovers(quoteList, assetBySymbol),
    ...outsizedActiveRisk(activeRiskRows),
    ...earningsAhead(events?.upcomingEarnings ?? [], assetBySymbol),
    ...earningsResult(
      events?.recentEarnings ?? [],
      assetBySymbol,
      new Map(quoteList.map(q => [q.symbol.toUpperCase(), q])),
    ),
    ...corporateActions(
      events?.corporateActions ?? [],
      assetBySymbol,
      new Map(quoteList.map(q => [q.symbol.toUpperCase(), q])),
    ),
    ...economicReleases(events?.economicReleases ?? []),
  ], [quoteList, assetBySymbol, activeRiskRows, events])

  /**
   * What the desk knows about each name, for the stories about it.
   *
   * ── Why a story needs this to be worth a cell ───────────────────────────
   *
   * A news row carries a matched ticker and nothing about the book, so every
   * story looks identical to the composition rule AND to the tile: a headline
   * and a source. Fifteen of those is an RSS mosaic, which is the failure
   * mobile recorded against this exact producer.
   *
   * Whether the desk owns the name, and how much of it, is what separates "a
   * story" from "an event that matters to us". It is already in memory from
   * the producers above, so this is a join and not a fetch, and it fills a
   * gap rather than overwriting anything a producer was sure of. It also
   * carries `assetId`, which `useMarketNews` does not return at all -- the
   * reason a story could never open the name it was about.
   */
  const deskBySymbol = useMemo(() => {
    const map = new Map<string, { assetId: string | null; portfolio: ExploreItem['portfolio'] }>()
    for (const i of produced) {
      const s = i.symbol?.trim().toUpperCase()
      if (!s) continue
      const held = i.portfolio && (i.portfolio.weightPct != null || !!i.portfolio.heldInCount)
      const prior = map.get(s)
      // First writer wins for the asset id; the richest portfolio fact wins
      // for the book, so a story is not told the desk holds nothing because
      // the first finding about the name happened not to say.
      map.set(s, {
        assetId: prior?.assetId ?? i.assetId ?? null,
        portfolio: prior?.portfolio ?? (held ? i.portfolio : undefined),
      })
    }
    return map
  }, [produced])

  const items = useMemo(() => {
    const stories = newsToExplore((news?.items ?? []) as never).map(n => {
      const hit = n.symbol ? deskBySymbol.get(n.symbol.trim().toUpperCase()) : undefined
      if (!hit) return n
      return {
        ...n,
        assetId: n.assetId ?? hit.assetId,
        portfolio: n.portfolio ?? hit.portfolio,
        destination: n.destination.kind === 'article' && !n.destination.assetId
          ? { ...n.destination, assetId: hit.assetId }
          : n.destination,
      }
    })
    /* Topped up before anything is ranked, so the supplement competes for
       position on the same terms as everything else. The count it is given is
       what the producers actually found. */
    const withNews = [...produced, ...stories, ...templatesToExplore(templateCards)]
    const base = extra ? [...withNews, ...extra(withNews.length)] : withNews
    /*
     * Aggregates collapse a run of the same sort into one tile that resolves
     * to `filter` — the only action that narrows the grid rather than opening
     * something. Built from the composed set, as mobile does.
     */
    const now = Date.now()
    /*
     * Renderability is decided BEFORE composition, not after.
     *
     * `diversifyExplore` scores, dedupes, gives emphasis and allocates cells.
     * An item that cannot be drawn has by then been given a position and,
     * if it scored well, a double-width feature cell — so removing it later
     * leaves the hole it was standing in and distorts everything around it.
     * Filtered here, the grid simply repacks.
     *
     * Aggregates are filtered too: one that cannot say more than its category
     * name is suppressed rather than drawn as an empty shell.
     */
    const { items: drawable, dropped } = renderableExploreItems(
      [...base, ...aggregatesFor(base, now)],
      i => !!exploreVisualFor(i as never),
    )
    // Named, not silently absent. An adapter emitting one of these has a
    // defect, and a suppression nobody can see is how it survives.
    if (dropped.length) console.warn('[explore] not drawable', dropped)
    return diversifyExplore(drawable, now)
  }, [produced, news, deskBySymbol, templateCards, extra])

  /*
   * Reported, not substituted.
   *
   * A candidate missing its producer data is a gap to report, not a hole to
   * fill with something that looks similar. News is now called, so it is
   * listed only when it actually returned nothing -- an unconditional entry
   * would say "no news" on a page full of stories, which is the same kind of
   * untrue as an empty tile.
   *
   * Templates used to be pushed UNCONDITIONALLY here, with a note that the
   * producer was genuinely uncalled. It is called now, so the entry became the
   * same lie news had been: "no market templates" printed over a grid of them.
   * It is listed only when the six builders between them found nothing.
   */
  const missing = useMemo(() => {
    const gaps: string[] = []
    if (!lenses) gaps.push('portfolio lenses')
    if (!scenarioCards?.length) gaps.push('scenario cards')
    if (!insights?.length) gaps.push('derived insights')
    if (!news?.items?.length) gaps.push('news')
    if (!templateCards.length) gaps.push('templates')
    return gaps
  }, [lenses, scenarioCards, insights, news, templateCards])

  return {
    items,
    isLoading: pool.isLoading,
    missing,
  }
}
