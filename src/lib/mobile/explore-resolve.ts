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
  /**
   * Narrow the grid. `MobileExplore` owns category state and handles this.
   *
   * Returned for an AGGREGATE and nothing else — see the `filter` case below.
   */
  | { do: 'filter'; category: string }
  /**
   * Leave for another surface — an asset page, a list, a workflow.
   *
   * Carries the target it is talking about. It used to carry nothing, so the
   * only thing a caller could do with it was guess, and `MobileDashboard`'s
   * switch had no arm for it at all: a `tab` destination fell through to
   * `default:` and focused instead of navigating. An action that names no
   * object is not an instruction, it is a category.
   */
  | { do: 'navigate'; target: { id: string; title: string; type: string; data: Record<string, unknown> } }
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
      /**
       * Narrowing the grid is an ANSWER for exactly one kind of tile.
       *
       * ── The conflation that made tiles inert ────────────────────────────
       *
       * `{ kind: 'filter' }` is doing two unrelated jobs in the adapters. On an
       * aggregate it is the intention: "4 new ideas this week" is a count, and
       * showing those four IS opening it. Everywhere else it is a FALLBACK,
       * reached whenever an item has no asset id — routine for a macro story,
       * an economic release, an unattributed template, a thought posted about
       * no particular name.
       *
       * `MobileExplore` spotted half of this and stopped non-aggregates from
       * filtering, keyed on the subtype. But nothing taught the resolver, so
       * those items still resolved to `filter`, and the dashboard's `filter`
       * arm returns early on the (now false) assumption that the grid has
       * already handled it. The tile therefore did nothing at all — which is
       * strictly worse than the re-filter it replaced, because a re-filter at
       * least moves the page.
       *
       * Every one of those items has a preview worth showing at level two, and
       * the focus overlay already states honestly what it knows and offers the
       * asset where there is one. So the fallback resolves to a fallback.
       */
      return item.subtype === 'aggregate'
        ? { do: 'filter', category: d.category }
        : { do: 'focus' }

    case 'tab':
      return { do: 'navigate', target: d.target }

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
