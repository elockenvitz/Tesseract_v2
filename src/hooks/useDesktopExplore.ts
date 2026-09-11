import { useMemo } from 'react'
import {
  lensesToExplore, scenarioCardsToExplore, insightsToExplore,
  ideasToExplore, newsToExplore, aggregatesFor,
} from '../lib/mobile/explore-adapters'
import { diversifyExplore } from '../lib/mobile/explore-compose'
import { exploreVisualFor } from '../lib/mobile/explore-visual'
import { renderableExploreItems } from '../lib/desktop-ideas/explore-renderable'
import { useDesktopCandidates } from './useDesktopCandidates'
import type { ComposedExploreItem } from '../lib/mobile/explore-item'
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

  /*
   * The same pool Ideas reads. Not a second set of producer calls — both modes
   * are questions about one desk, and the difference is the arrangement below.
   */
  const pool = useDesktopCandidates({ enabled })
  const { lenses, scenarioCards, insights } = pool

  const items = useMemo(() => {
    const base = [
      ...lensesToExplore(lenses as never),
      ...scenarioCardsToExplore(builtScenarioCards(scenarioCards)),
      ...insightsToExplore((insights ?? []) as never),
      ...ideasToExplore(pool.feedItems as never),
      ...newsToExplore([] as never),
    ]
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
  }, [lenses, scenarioCards, insights, pool.feedItems])

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
    isLoading: pool.isLoading,
    missing,
  }
}
