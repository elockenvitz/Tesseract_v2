import type { ExploreItem } from './explore-item'

/**
 * What a tap on an Explore tile should do.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Explore had no resolver. Tapping a tile set `exploreFocus`, and the focus
 * overlay then tried to find a CURATE FEED ENTRY with the same signal type and
 * asset and re-render it. That works for anything the feed happens to be
 * carrying — which is why signals opened correctly — and for everything else it
 * fell through to a screen reading "This one lives on its own surface."
 *
 * The fall-through was the tell. Nothing decided what a trade idea or a news
 * story should open; the matcher simply failed and the copy apologised. A tile
 * that looks tappable and answers with an apology is worse than one that does
 * not look tappable, because the reader has already spent the tap.
 *
 * So: one function, given an item, returns what to do with it. The surface
 * carries out the instruction and does not decide anything itself.
 *
 * ── Why it is not a registry keyed on card type ───────────────────────────
 *
 * There are thirty signal types and four things a tap can actually do. Keying
 * on the type would mean thirty entries, twenty-six of which say "focus it",
 * and a new card type silently missing from the map. The DESTINATION already
 * carries the answer — every adapter sets one — so this reads that, and a kind
 * nobody has taught it about is reported rather than ignored.
 */

export type ExploreAction =
  /** Re-render the card Curate would show, matched from the feed. */
  | { do: 'focus' }
  /** Open the external story in the reader the feed already uses. */
  | { do: 'article'; url: string; title: string | null; source: string | null }
  /** Narrow the grid. `MobileExplore` owns category state and handles this. */
  | { do: 'filter'; category: string }
  /** Leave for another surface — an asset page, a list, a workflow. */
  | { do: 'navigate' }
  /**
   * Nothing sensible to do.
   *
   * Distinct from a silent no-op: the caller is expected to log it, and a tile
   * that resolves to this should not have been drawn as tappable. Returned only
   * when an item genuinely carries no destination, which no adapter currently
   * produces — it exists so a future one cannot fail quietly.
   */
  | { do: 'unsupported'; why: string }

export function resolveExploreItem(item: ExploreItem): ExploreAction {
  const d = item.destination
  if (!d) return { do: 'unsupported', why: `${item.id}: no destination` }

  switch (d.kind) {
    case 'article':
      // A story is read, not focused. The card the matcher would find is a
      // news TILE about the story; the story itself is the thing the reader
      // asked for.
      return d.url
        ? { do: 'article', url: d.url, title: d.title ?? item.title ?? null, source: d.source ?? null }
        : { do: 'unsupported', why: `${item.id}: article with no url` }

    case 'filter':
      return { do: 'filter', category: d.category }

    case 'tab':
      return { do: 'navigate' }

    case 'action':
      /**
       * `open_asset` is the adapters' default for anything asset-scoped, and
       * for most items it is a fallback rather than an intention — a news story
       * with no url, a research note, an idea. Focusing shows the card and
       * leaves navigation to the actions sheet, which is the order this mode is
       * meant to have: preview, then detail, then leave.
       */
      return { do: 'focus' }

    default:
      return { do: 'unsupported', why: `${item.id}: unknown destination kind` }
  }
}
