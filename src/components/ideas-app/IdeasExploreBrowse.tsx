import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Compass, Loader2, X } from 'lucide-react'
import { ExploreVisualBlock } from '../mobile/ExploreVisual'
import { exploreVisualFor } from '../../lib/mobile/explore-visual'
import { useDesktopExplore } from '../../hooks/useDesktopExplore'
import type { ExploreOpen } from '../../lib/desktop-ideas/explore-open'
import type { ComposedExploreItem, ExploreItem } from '../../lib/mobile/explore-item'

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

export function IdeasExploreBrowse({ resolve, onOpen, selectedKey = null }: {
  /**
   * What a tile would do, asked at RENDER time as well as on click.
   *
   * Rendering needs the answer too: a preview with nothing behind it must not
   * be drawn as a control. Asking the same function in both places is what
   * keeps the appearance and the behaviour from disagreeing.
   */
  resolve: (item: ExploreItem) => ExploreOpen
  /** Everything Explore does not own itself. The shell carries it out. */
  onOpen: (open: Exclude<ExploreOpen, { do: 'filter' }>) => void
  /** Which tile the open workspace belongs to. */
  selectedKey?: string | null
}) {
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
    /*
     * The scroll host is the container query's subject, and it is also the one
     * element whose scrollTop must survive the workspace opening. Both follow
     * from the same fact: this element is never unmounted or replaced — only
     * its width changes — so the grid re-flows and the scroll does not move.
     */
    <div className="explore-host h-full overflow-y-auto">
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

        {/* Columns from the CONTAINER, not the window. The same 1920px screen
            shows this grid at full width and at ~40rem beside an open
            workspace, and only the region's own width can say how many columns
            fit. See `.explore-grid`. */}
        <div className="explore-grid gap-4">
          {shown.map(composed => (
            <ExploreTile
              key={composed.item.id}
              composed={composed}
              now={now}
              selectedKey={selectedKey}
              open={resolve(composed.item)}
              onFilter={setCategory}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ExploreTile({
  composed, now, open, selectedKey, onFilter, onOpen,
}: {
  composed: ComposedExploreItem
  now: number
  open: ExploreOpen
  selectedKey: string | null
  onFilter: (category: string) => void
  onOpen: (open: Exclude<ExploreOpen, { do: 'filter' }>) => void
}) {
  const item = composed.item
  const visual = useMemo(() => exploreVisualFor(item as never), [item])

  /*
   * `diversifyExplore` already decided which candidates lead, and says so in
   * `emphasis`. Read, not re-derived — a second rule for what leads is exactly
   * how two surfaces start disagreeing about the same arrangement.
   */
  const feature = composed.emphasis === 'feature'
  const selected = open.do === 'work' && selectedKey != null && open.selection.key === selectedKey

  /*
   * A tile that cannot answer is not a control.
   *
   * Every tile used to be a `<button>`, including the ones whose action was
   * `unsupported` and the ones whose focus has nothing behind it — so the
   * surface offered a press, took it, and did nothing. An element with no
   * behaviour should not have the affordance; the preview is still worth
   * reading, which is why it stays and only its interactivity goes.
   */
  const Tag = open.do === 'none' ? 'div' : 'button'

  return (
    <Tag
      {...(open.do === 'none' ? {} : { type: 'button' as const })}
      onClick={() => {
        // The resolver is the grammar, and `filter` is the only answer this
        // surface owns — narrowing the grid never leaves Explore. Everything
        // else is the shell's, which is what stops Explore growing a second
        // detail system beside the workspace.
        if (open.do === 'filter') { onFilter(open.category); return }
        if (open.do === 'none') return
        onOpen(open)
      }}
      className={clsx(
        'flex flex-col overflow-hidden rounded-xl border bg-white text-left dark:bg-gray-800',
        open.do === 'none'
          ? 'border-gray-200 opacity-80 dark:border-gray-700'
          : 'border-gray-200 transition-shadow hover:shadow-md dark:border-gray-700',
        selected && 'border-primary-400 ring-1 ring-primary-400 dark:border-primary-500 dark:ring-primary-500',
        feature && 'explore-feature',
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
    </Tag>
  )
}
