import { clsx } from 'clsx'
import { Lightbulb } from 'lucide-react'
import { ContextualWorkHeader } from './ContextualWorkHeader'

/**
 * A list, seen from the asset that is on it.
 *
 * ── What this is not ────────────────────────────────────────────────────
 *
 * Not the Lists application. That application answers "what is on this
 * list"; a reader who opened it from AAPL's Work sidebar is asking the
 * other question — "what does this list say about AAPL" — and was
 * previously answered by having their asset workspace replaced by a grid of
 * other people's names.
 *
 * So this shows the membership and nothing it cannot source: the list's own
 * name, type and description, when this asset was added, and the two
 * actions that already exist (remove it, open the full list). No status, no
 * notes and no commentary are invented — `asset_list_items` stores none,
 * and an empty "Notes" heading would imply a field that is not there.
 *
 * ── Why there is now something to DO here ───────────────────────────────
 *
 * Stating "membership only" accurately is not the same as being useful. A
 * watchlist exists so that names on it become ideas, and this surface was a
 * dead end: everything it offered led away from the asset (open the full
 * list) or undid the membership (remove it). Starting an idea is the one
 * action that moves the name forward, and it is the reason most lists are
 * kept, so it is the primary action here.
 *
 * It is still not invented state. The idea is a `trade_queue_items` row
 * created through the existing modal and the audited create mutation; the
 * list is its origin, not its owner, and nothing about the idea is stored
 * on the membership.
 */

export interface ListWorkSurfaceList {
  listId: string
  /** The membership row's own id, which is what a removal needs. */
  itemId: string
  name: string
  description?: string | null
  listType?: 'mutual' | 'collaborative' | string | null
  addedAt?: string | null
  canRemove?: boolean
}

interface Props {
  list: ListWorkSurfaceList
  assetSymbol?: string | null
  back: { label: string; onBack: () => void }
  onOpenFull: () => void
  onRemove?: (itemId: string) => void
  removing?: boolean
  /** Opens the existing Add Idea modal with this asset preselected. */
  onStartIdea?: () => void
  className?: string
}

const stamp = (iso: string | null | undefined): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TYPE_LABEL: Record<string, string> = {
  mutual: 'Shared list',
  collaborative: 'Collaborative list',
}

export function ListWorkSurface({
  list, assetSymbol, back, onOpenFull, onRemove, removing, onStartIdea, className,
}: Props) {
  const added = stamp(list.addedAt)
  const kind = TYPE_LABEL[String(list.listType)] ?? 'List'

  return (
    <section className={clsx('min-w-0', className)} data-testid="list-work-surface">
      <ContextualWorkHeader
        title={list.name}
        kindLabel={kind}
        /* The membership IS the reason this list is in the sidebar, so it is
           the one fact worth stating under the name. */
        detail={assetSymbol
          ? `${assetSymbol} is on this list${added ? `, added ${added}` : ''}`
          : `On this list${added ? ` since ${added}` : ''}`}
        back={back}
        openFull={{ label: 'Open the full list', onOpen: onOpenFull }}
      />

      {list.description ? (
        <p className="mt-3 max-w-[78ch] text-[13px] leading-relaxed text-gray-700 dark:text-gray-200">
          {list.description}
        </p>
      ) : (
        <p className="mt-3 text-[12px] text-gray-400 dark:text-gray-500" data-testid="list-no-description">
          This list has no description.
        </p>
      )}

      {/*
        ── The thing a list is for ───────────────────────────────────────

        The reason a name sits on a watchlist is that somebody might act on
        it. This is the action, stated as the point of the page rather than
        buried with the destructive one below.
      */}
      {onStartIdea && (
        <div className="mt-4 rounded-lg border border-gray-200 px-3.5 py-3 dark:border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
                Act on {assetSymbol ?? 'this name'}
              </p>
              <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">
                A name is on a list so it can become an idea. The idea is its
                own record — the list is where it started, not where it lives.
              </p>
            </div>
            <button
              type="button"
              data-testid="list-start-idea"
              onClick={onStartIdea}
              className="inline-flex flex-none items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-700"
            >
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
              Start an idea
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          What this list records about {assetSymbol ?? 'this asset'}
        </span>
        {/*
          Stated absence, not an empty section. A list membership is a
          membership: the schema carries no per-asset status or note, and
          inventing headings for fields that do not exist is how a surface
          starts implying work that was never done.
        */}
        <p className="max-w-[78ch] text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
          Membership only. Lists record which assets belong to them and when
          they were added — there is no per-asset status or note to show.
        </p>
      </div>

      {onRemove && list.canRemove && (
        <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
          <button
            type="button"
            onClick={() => onRemove(list.itemId)}
            disabled={removing}
            data-testid="list-remove-asset"
            className="rounded border border-gray-300 px-2.5 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {removing ? 'Removing…' : `Remove ${assetSymbol ?? 'this asset'} from the list`}
          </button>
        </div>
      )}
    </section>
  )
}
