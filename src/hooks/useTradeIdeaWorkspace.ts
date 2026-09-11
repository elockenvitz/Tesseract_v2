import { useMemo } from 'react'
import { useIdeaDetail, useScanExposure } from './useDesktopIdeas'
import { ideaRowFromFeedItem } from '../lib/desktop-ideas/from-feed'
import type { IdeaRow } from '../lib/desktop-ideas'
import type { ScoredFeedItem } from './ideas/types'

/**
 * Everything the trade-idea work surface needs, for any shell.
 *
 * ── The coupling, as it actually was ──────────────────────────────────────
 *
 * I reported `IdeaDetail` as "built around the Dashboard's Idea object and not
 * embeddable". Tracing it properly, that was half right and the wrong half was
 * the conclusion. `IdeaDetail` takes an `IdeaRow`, an `IdeaEnrichment` and a
 * `ScanExposure` — three plain values. It imports the engagement seam, the
 * asset seam, the decision dispatcher and a research flag, none of which is
 * the Dashboard's focus seam or its selection state.
 *
 * What was genuinely missing was not a boundary inside the component. It was
 * that the standalone app had no way to PRODUCE those three values for one
 * idea: `useIdeaScan` supplies them for a gallery, and the standalone app has
 * no gallery. That is a data-plumbing gap, and this is the plumbing.
 *
 * So nothing was rewritten and no behaviour changed. Dashboard keeps supplying
 * its own values from its scan; this supplies the same values from one feed
 * row; both render the same component.
 *
 * ── Why the row comes from the feed and not a new query ───────────────────
 *
 * `ideaRowFromFeedItem` already maps a trade-idea feed row onto `IdeaRow`, and
 * a trade idea in this feed IS a `trade_queue_items` row — the same table the
 * scan reads. Fetching it again by id would be a second read of a row the
 * caller is holding, which is exactly what `IdeaDetail`'s own comment about
 * `exposure` says not to do.
 *
 * This is the one place that seam is used as intended. It remains wrong for
 * every other family, and returns null for all of them.
 *
 * ── The enrichment queries are NOT duplicated ─────────────────────────────
 *
 * `useIdeaDetail` keys on `['desktop-ideas', 'detail', assetId, orgId]` and
 * `useScanExposure` on the asset set. Opening the same idea from Dashboard and
 * from standalone Ideas hits one cache entry, because the key is the asset and
 * the org, not the shell.
 */
export interface TradeIdeaWorkspace {
  idea: IdeaRow | null
  detail: ReturnType<typeof useIdeaDetail>['detail']
  exposure: ReturnType<typeof useScanExposure>[string] | undefined
}

export function useTradeIdeaWorkspace(item: ScoredFeedItem | null): TradeIdeaWorkspace {
  const idea = useMemo(() => (item ? ideaRowFromFeedItem(item) : null), [item])

  /*
   * `useScanExposure` takes the list it is exposing. One idea is a list of
   * one, and the memo keeps the array identity stable so the query does not
   * re-key on every render.
   */
  const ideas = useMemo(() => (idea ? [idea] : []), [idea])
  const exposureByAsset = useScanExposure(ideas)
  const { detail } = useIdeaDetail(idea)

  return {
    idea,
    detail,
    exposure: idea?.assetId ? exposureByAsset[idea.assetId] : undefined,
  }
}
