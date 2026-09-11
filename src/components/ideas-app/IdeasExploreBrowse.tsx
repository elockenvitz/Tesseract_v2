import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Compass, Loader2, X } from 'lucide-react'
import { ExploreVisualBlock } from '../mobile/ExploreVisual'
import { exploreVisualFor } from '../../lib/mobile/explore-visual'
import { resolveExploreItem } from '../../lib/mobile/explore-resolve'
import { useDesktopExplore } from '../../hooks/useDesktopExplore'
import type { ComposedExploreItem } from '../../lib/mobile/explore-item'

/**
 * Explore, on desktop.
 *
 * ── Why this is not the feed in a grid ────────────────────────────────────
 *
 * `explore-compose` draws the line: Curate ranks by CONSEQUENCE, Explore ranks
 * by INTERESTINGNESS, and interestingness is not a total order. The
 * fourth-most-consequential scenario gap is not the fourth-most-interesting
 * thing on a desk — it is the fourth time the reader has been told the same
 * sort of news. `diversifyExplore` therefore scores, dedupes and then repels
 * neighbours of the same sort, which no re-sorting of the feed produces.
 *
 * ── The hierarchy, preserved ──────────────────────────────────────────────
 *
 *   preview  →  investigate  →  richer object or destination
 *
 * A preview is a preview. Turning every candidate into a full feed card is the
 * failure this mode exists to avoid, and it is also what would make Explore a
 * second Curate. So a tile carries its title, its one piece of context, its
 * visual and nothing else, and opening it is a separate act.
 *
 * ── The resolver is the route grammar ─────────────────────────────────────
 *
 * `resolveExploreItem` already answers what a tile does — focus, article,
 * filter, navigate, or an honest "unsupported" for a kind nobody has taught it
 * about. Its own header explains why it reads the DESTINATION rather than
 * switching on type: thirty entries, twenty-six of which would say "focus it",
 * and a new kind silently missing from the map. Desktop does not get a second
 * grammar.
 *
 * ── Desktop composition ───────────────────────────────────────────────────
 *
 * More spatial than the feed, because discovery benefits from seeing several
 * candidates at once. Not a masonry wall: a fixed three-column grid on a wide
 * screen, two on a medium one, with feature tiles allowed to span two columns
 * so the arrangement has rhythm rather than uniformity.
 */

export function IdeasExploreBrowse() {
  /*
   * Explore's own category state, deliberately separate from the Ideas type
   * lens and from Curate. Mobile keeps `exploreCategory` apart from
   * `feedFilter` for the same reason, and its note says folding them would
   * make Explore look like a sixth category.
   */
  const [category, setCategory] = useState<string | null>(null)
  const { items, isLoading, missing } = useDesktopExplore()

  const shown = useMemo(
    () => (category ? items.filter(c => c.item.category === category) : items),
    [items, category],
  )

  const now = Date.now()

  if (isLoading && items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[76rem] px-6 py-5">
        {category && (
          <button
            onClick={() => setCategory(null)}
            className="mb-4 flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
            {category}
          </button>
        )}

        {shown.length === 0 && (
          <div className="py-16 text-center">
            <Compass className="mx-auto h-6 w-6 text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Nothing to explore here yet.
            </p>
            {missing.length > 0 && (
              /* Reported, not filled. A candidate missing its producer data is
                 a gap to name rather than a hole to plug with a substitute. */
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Not yet reaching desktop: {missing.join(', ')}.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map(composed => (
            <ExploreTile
              key={composed.item.id}
              composed={composed}
              now={now}
              onFilter={setCategory}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ExploreTile({
  composed, now, onFilter,
}: {
  composed: ComposedExploreItem
  now: number
  onFilter: (category: string) => void
}) {
  const item = composed.item
  const visual = useMemo(() => exploreVisualFor(item as never), [item])
  const action = resolveExploreItem(item)

  /*
   * `diversifyExplore` already decided which candidates lead, and says so in
   * `emphasis`. Read, not re-derived — a second rule for what leads is exactly
   * how two surfaces start disagreeing about the same arrangement.
   */
  const feature = composed.emphasis === 'feature'

  return (
    <button
      onClick={() => {
        // The resolver is the grammar. `filter` is the only action this
        // surface owns; everything else belongs to the Work stage and is left
        // deliberately unhandled rather than half-routed.
        if (action.do === 'filter') onFilter(action.category)
      }}
      className={clsx(
        'flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800',
        feature && 'xl:col-span-2',
      )}
    >
      {visual && (
        <div className="border-b border-gray-100 px-4 pt-4 dark:border-gray-800">
          <ExploreVisualBlock visual={visual} now={now} />
        </div>
      )}
      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          <span>{item.category}</span>
          {item.symbol && (
            <>
              <span aria-hidden>·</span>
              <span className="text-gray-600 dark:text-gray-300">{item.symbol}</span>
            </>
          )}
        </div>
        <p className="mt-1 text-sm font-semibold leading-snug text-gray-900 line-clamp-2 dark:text-white">
          {item.title}
        </p>
        {/* One line of context. A preview that carried the whole argument would
            be a feed card, which is the thing this is not. */}
        {item.context && (
          <p className="mt-1 text-xs leading-relaxed text-gray-500 line-clamp-2 dark:text-gray-400">
            {item.context}
          </p>
        )}
      </div>
    </button>
  )
}
