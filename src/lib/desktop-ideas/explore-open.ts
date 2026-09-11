import { resolveExploreItem } from '../mobile/explore-resolve'
import { findExploreMatch, type EntryDescriptor } from '../mobile/explore-match'
import { selectionFor, type IdeasSelection } from './selection'
import type { AttentionEntry } from '../../hooks/useDesktopAttentionFeed'
import type { ExploreItem } from '../mobile/explore-item'

/**
 * What opening an Explore tile does on desktop.
 *
 * ── Why this is a second function and not a second resolver ───────────────
 *
 * `resolveExploreItem` answers what a tile MEANS — focus, article, filter,
 * navigate, or an honest unsupported — and it is shared with mobile. Nothing
 * here second-guesses it. What it cannot answer is what "focus" means on a
 * surface that has a persistent workspace beside it, because mobile has no
 * such thing: there, focus opens an overlay.
 *
 * So this translates exactly one of its five answers, and passes the other
 * four through unchanged. A tile that filters still filters Explore; a story
 * still opens the story reader; a tab destination still opens its tab.
 *
 * ── Why a focus becomes the attention feed's OWN selection ────────────────
 *
 * The requirement is that the same trade idea reached from Ideas and from
 * Explore opens the same work surface. The strongest way to guarantee that is
 * not to build an equivalent selection — it is to build the SAME one: find the
 * attention candidate the preview stands for and hand it to `selectionFor`,
 * the function the feed already uses. Then the two paths are identical by
 * construction rather than by agreement, and a change to selection cannot
 * drift between them.
 *
 * `findExploreMatch` is the matcher that already does this on mobile, with its
 * own history: an asset match alone is not an object match, and a preview that
 * names its row is not answered by a sibling that merely shares the name.
 *
 * ── When there is no candidate behind the preview ─────────────────────────
 *
 * Explore reaches material the attention feed ranked away, and a preview can
 * legitimately have no card behind it. Two different cases, deliberately not
 * merged:
 *
 *   it names a ROW (`objectId`) and we did not find it — nothing is opened.
 *     Opening the asset instead would answer a question about one colleague's
 *     post with a page about the company, which is the class of defect the
 *     matcher's own header describes.
 *
 *   it names only an ASSET — the asset workspace opens at `overview`. That is
 *     the object the preview is about, and it is the honest whole of what the
 *     preview knows.
 *
 * Pure: no React, no Supabase, no clock. Takes the candidate list as an
 * argument so it can be tested without a feed.
 */

export type ExploreOpen =
  /** Put this in the workspace. Identical to what the Ideas feed would produce. */
  | { do: 'work'; selection: IdeasSelection }
  /** Explore's own grid narrows. Explore owns this and nothing leaves the surface. */
  | { do: 'filter'; category: string }
  /** The story reader — canonical, and deliberately not the Ideas workspace. */
  | {
      do: 'article'; url: string; title: string | null; source: string | null
      desk: { symbol: string; assetId: string | null; holding: string | null } | null
    }
  /** A tab destination. The shell opens it; Ideas does not try to embed it. */
  | { do: 'navigate'; target: { id: string; title: string; type: string; data: Record<string, unknown> } }
  /** Nothing to open. Said out loud, and the tile must not look actionable. */
  | { do: 'none'; why: string }

/** A candidate, as the matcher needs it. `key` IS the card id the ranker uses. */
export function describeEntry(e: AttentionEntry): EntryDescriptor {
  return { type: e.card.type, id: e.key, symbol: e.card.entity?.ticker ?? null }
}

export function exploreOpen(item: ExploreItem, entries: AttentionEntry[]): ExploreOpen {
  const action = resolveExploreItem(item)

  switch (action.do) {
    case 'filter':
      return { do: 'filter', category: action.category }
    case 'article':
      return {
        do: 'article', url: action.url, title: action.title,
        source: action.source, desk: action.desk,
      }
    case 'navigate':
      return { do: 'navigate', target: action.target }
    case 'unsupported':
      return { do: 'none', why: action.why }
  }

  // `focus`: the one answer that means something different here.
  const match = findExploreMatch(
    {
      dedupeKey: item.dedupeKey,
      objectId: item.objectId ?? null,
      signalType: item.signalType ?? null,
      assetId: item.assetId ?? null,
      symbol: item.symbol ?? null,
    },
    entries,
    describeEntry,
  )

  if (match) {
    return { do: 'work', selection: { ...selectionFor(match), origin: 'explore' } }
  }

  if (item.objectId) {
    return {
      do: 'none',
      why: `${item.id}: names a row the attention pool does not hold`,
    }
  }

  if (!item.assetId) {
    return { do: 'none', why: `${item.id}: no candidate and no asset` }
  }

  return {
    do: 'work',
    selection: {
      family: 'explore',
      origin: 'explore',
      // The preview's own id. Used only to mark the tile, never to resolve data
      // — the same rule `IdeasSelection.key` carries for a card id.
      key: item.id,
      objectId: null,
      postType: null,
      item: null,
      assetId: item.assetId,
      symbol: item.symbol ?? null,
      portfolioId: null,
      portfolioName: null,
      /*
       * The preview's own words, and only because this is the header of the
       * pane the reader is about to look at. Nothing routes on it — see the
       * branches above, every one of which keys on an id.
       */
      why: { headline: item.title, reason: item.context ?? null, occurredAt: null },
    },
  }
}
