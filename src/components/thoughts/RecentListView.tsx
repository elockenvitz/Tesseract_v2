import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { RecentRow } from './RecentQuickIdeas'
import { useRecentQuickIdeas } from '../../hooks/useRecentQuickIdeas'
import { useIsMobile } from '../../hooks/useMediaQuery'
import type { RecentItem } from '../../hooks/useRecentQuickIdeas'

/**
 * The whole Recent list, as a Quick Ideas subview.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * "View all" dispatched `openIdeasTab` and closed the pane, so asking to see
 * the rest of five recent items launched the legacy Ideas application and
 * threw away whatever the reader had open. It also forced a mixed list of
 * thoughts and prompts into that app's single taxonomy.
 *
 * This is the same pattern Open Prompts and Pending Review already use: a
 * subview inside the pane, with a back control, keeping the reader where they
 * were. No new app, no new overlay on mobile.
 *
 * ── Data ──────────────────────────────────────────────────────────────────
 *
 * Same source as the preview. `useRecentQuickIdeas` already takes a limit and
 * already reports `hasMore` from a total count, so there is no parallel query
 * here — only a larger number and a button that raises it.
 *
 * Mounted only while the subview is open, which is why the bigger fetch does
 * not run every time somebody opens Quick Ideas.
 */

/** The preview shows 5. This opens with a screenful and grows by the same. */
const PAGE = 50

export function RecentListView({
  onOpen,
}: {
  onOpen: (id: string, kind: RecentItem['kind']) => void
}) {
  const dense = useIsMobile()
  const [limit, setLimit] = useState(PAGE)
  const { data: items = [], hasMore, isLoading } = useRecentQuickIdeas(limit)

  if (isLoading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <p className="px-2 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
        Nothing captured yet.
      </p>
    )
  }

  return (
    <div>
      {/* Same separated list and same row as the preview — this is a longer
          version of that list, not a different presentation of it. */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {items.map(item => (
          <RecentRow
            key={item.id}
            item={item}
            dense={dense}
            onClick={() => onOpen(item.id, item.kind)}
          />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setLimit(n => n + PAGE)}
          disabled={isLoading}
          className="mt-2 w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 active:bg-gray-100 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {isLoading ? 'Loading…' : 'Show older'}
        </button>
      )}
    </div>
  )
}
