import { useMemo } from 'react'
import {
  lensesToExplore, scenarioCardsToExplore, insightsToExplore,
  ideasToExplore, newsToExplore, aggregatesFor,
} from '../lib/mobile/explore-adapters'
import { diversifyExplore } from '../lib/mobile/explore-compose'
import { usePortfolioLenses } from './mobile/usePortfolioLenses'
import { useScenarioCards } from './mobile/useScenarioCards'
import { useDerivedInsights } from './mobile/useDerivedInsights'
import { useDesktopIdeasFeed } from './useDesktopIdeasFeed'
import type { ComposedExploreItem } from '../lib/mobile/explore-item'

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
 * Desktop honours that. Every producer here is an existing org-scoped query
 * with its own cache key, shared with whatever else already reads it, and the
 * Ideas half reuses the very same `useDesktopIdeasFeed` the Ideas mode holds —
 * so entering Explore refetches nothing.
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

export function useDesktopExplore(opts: { enabled?: boolean } = {}): DesktopExplore {
  const enabled = opts.enabled ?? true

  const { data: lenses, isLoading: lensesLoading } = usePortfolioLenses({ enabled })
  const { data: scenarioCards, isLoading: scenarioLoading } = useScenarioCards({ enabled })
  const { data: insights, isLoading: insightsLoading } = useDerivedInsights()
  /*
   * The same hook, the same key, the same cache entry the Ideas mode uses.
   * Explore does not get its own copy of the feed.
   */
  const feed = useDesktopIdeasFeed('all')

  const items = useMemo(() => {
    const base = [
      ...lensesToExplore(lenses as never),
      ...scenarioCardsToExplore((scenarioCards ?? []) as never),
      ...insightsToExplore((insights ?? []) as never),
      ...ideasToExplore(feed.items as never),
      ...newsToExplore([] as never),
    ]
    /*
     * Aggregates collapse a run of the same sort into one tile that resolves
     * to `filter` — the only action that narrows the grid rather than opening
     * something. Built from the composed set, as mobile does.
     */
    const now = Date.now()
    return diversifyExplore([...base, ...aggregatesFor(base, now)], now)
  }, [lenses, scenarioCards, insights, feed.items])

  /*
   * Reported, not substituted.
   *
   * `newsToExplore` is fed an empty array because the news source is a mobile
   * hook this shell does not yet call, and templates likewise. Saying so is the
   * instruction: a candidate missing its producer data is a gap to report, not
   * a hole to fill with something that looks similar.
   */
  const missing = useMemo(() => {
    const gaps: string[] = []
    if (!lenses) gaps.push('portfolio lenses')
    if (!scenarioCards?.length) gaps.push('scenario cards')
    if (!insights?.length) gaps.push('derived insights')
    gaps.push('news', 'templates')
    return gaps
  }, [lenses, scenarioCards, insights])

  return {
    items,
    isLoading: lensesLoading || scenarioLoading || insightsLoading,
    missing,
  }
}
