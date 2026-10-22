/**
 * The one line of context that sits above every Work surface.
 *
 * ── Why lists are here and not in the navigator ─────────────────────────
 *
 * Membership is not work. Which lists a name sits in is a fact about the
 * name, true whatever the reader is doing, so it belongs where it is always
 * visible rather than behind a selection. Putting it in the navigator would
 * also have promoted filing to the same rank as deciding.
 *
 * It is deliberately one line. The orientation band this replaces was 286px
 * of a 661px viewport; a strip that grows controls will become that band
 * again.
 *
 * The chips, the permission-gated remove and the Add dialog are the Step B
 * implementation, moved rather than rebuilt: `canRemove` is still the
 * existing per-row rule from `lib/lists/list-permissions`, asked by the
 * caller, and the Add control is still the existing `AddToListButton`.
 */
import { clsx } from 'clsx'
import { X, Users, ExternalLink } from 'lucide-react'

/** One list this asset sits in, with the removal answer already decided. */
export interface ContextStripList {
  /** `asset_list_items.id` — what a removal deletes. Not the list id. */
  itemId: string
  listId: string
  name: string
  listType: 'mutual' | 'collaborative'
  /**
   * The existing rule from `lib/lists/list-permissions`, already asked. On a
   * collaborative list write access is NOT permission to remove somebody
   * else's row, and re-deriving that here is how two surfaces drift apart.
   */
  canRemove: boolean
}

export interface AssetContextStripProps {
  /** `null` means "not loaded" and renders nothing — distinct from `[]`. */
  lists?: ContextStripList[] | null
  onOpenList?: (listId: string) => void
  onRemoveFromList?: (itemId: string) => void
  removingListItemId?: string | null
  /** The existing "Add to List" control, passed in rather than rebuilt. */
  addToListSlot?: React.ReactNode
  /** The full cross-asset Lists experience, which stays reachable. */
  onOpenAllLists?: () => void
  className?: string
}

export function AssetContextStrip({
  lists = null, onOpenList, onRemoveFromList, removingListItemId = null,
  addToListSlot, onOpenAllLists, className,
}: AssetContextStripProps) {
  if (lists === null) return null

  return (
    <div
      id="lists-section-listsContent"
      data-testid="asset-context-strip"
      className={clsx(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800',
        className,
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Lists</span>

      {lists.length === 0 ? (
        <span className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="context-strip-none">
          Not in any lists.
        </span>
      ) : (
        lists.map(l => {
          const removing = removingListItemId === l.itemId
          return (
            <span
              key={l.itemId}
              data-testid={`context-list-${l.listId}`}
              className={clsx(
                'inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 pl-2 text-[12px] font-medium text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100',
                l.canRemove ? 'pr-0.5' : 'pr-2',
                removing && 'opacity-50',
              )}
            >
              {onOpenList ? (
                <button
                  type="button"
                  onClick={() => onOpenList(l.listId)}
                  data-testid={`context-list-open-${l.listId}`}
                  className="py-0.5 hover:text-primary-600 hover:underline"
                >
                  {l.name}
                </button>
              ) : (
                <span className="py-0.5">{l.name}</span>
              )}
              {l.listType === 'collaborative' && (
                <Users className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
              )}
              {/* Shown only where the existing rule permits THIS row. A
                  disabled control would advertise a capability the list's
                  owner has not granted. */}
              {l.canRemove && onRemoveFromList && (
                <button
                  type="button"
                  onClick={() => onRemoveFromList(l.itemId)}
                  disabled={removing}
                  aria-label={`Remove from ${l.name}`}
                  data-testid={`context-list-remove-${l.listId}`}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:cursor-default dark:hover:bg-gray-700"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </span>
          )
        })
      )}

      <span className="ml-auto flex items-center gap-1">
        {addToListSlot}
        {/* List-driven workflows are cross-asset, and this asset page is not
            where they happen. The full Lists surface stays one click away. */}
        {onOpenAllLists && (
          <button
            type="button"
            onClick={onOpenAllLists}
            data-testid="context-open-all-lists"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
          >
            All lists <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
  )
}
