/**
 * One universe, as a row in a library index.
 *
 * ── What a List is ────────────────────────────────────────────────────────
 *
 * A collection of securities, and it can mean anything: work in progress, an
 * avoid list, consumer names, a research universe, an earnings watchlist.
 * Earlier versions of this page treated every List as a miniature workflow
 * dashboard, which was the core mistake — workflow state is something a
 * universe may or may not have, so it cannot be the architecture.
 *
 * So the row answers the questions a library answers, in this order:
 *
 *   UNIVERSE     what is this, and what is it for
 *   SIZE         how large
 *   ACCESS       who owns it, who shares it
 *   LAST ACTIVE  what happened in it, and when
 *   ATTENTION    what needs a person — SECONDARY, and often nothing
 *
 * A universe with no open work is a complete, valuable row: it keeps its name,
 * purpose, size, owner and history, and simply says nothing in the last column.
 * An EMPTY universe is still first class — same columns, same height class —
 * and offers its next step rather than being exiled to a pill at the bottom.
 *
 * ── Composition ───────────────────────────────────────────────────────────
 *
 * No cards, no nested containers, no constituent preview. The row is five grid
 * cells on a continuous surface divided by one hairline. Colour is limited to
 * the list's OWN identity dot — real `color` data, never invented — and the
 * single attention figure. Everything else is weight, alignment and space.
 */
import { Star } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import type { ListSurface, ListSurfaceMetrics, LastListActivity } from '../../hooks/lists/useListSurfaces'
import type { ListAttention } from '../../hooks/lists/useListAttention'
import { describeActivity } from '../../lib/lists/describeActivity'

/**
 * The one grid template, shared by the header and every row.
 *
 * Exported so the column header cannot drift out of alignment with the body —
 * two copies of a five-column template is the classic way an index ends up
 * with headings that sit over the wrong columns.
 */
export const UNIVERSE_GRID =
  'grid grid-cols-[minmax(0,1fr)_104px_176px_200px_228px] gap-x-11 items-center'

const AVATAR_PREVIEW_COUNT = 2

function initialsOf(u?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null) {
  if (!u) return '?'
  if (u.first_name && u.last_name) return `${u.first_name[0]}${u.last_name[0]}`.toUpperCase()
  if (u.first_name) return u.first_name[0].toUpperCase()
  if (u.email) return u.email[0].toUpperCase()
  return '?'
}

function displayName(u?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null) {
  if (!u) return 'Unknown'
  if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
  if (u.first_name) return u.first_name
  return u.email ?? 'Unknown'
}

/** The column header. Same template as the rows, by construction. */
export function UniverseIndexHeader() {
  const cell = 'text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-600'
  return (
    <div className={clsx(UNIVERSE_GRID, 'px-3 pt-4 pb-2 border-b border-gray-900/[0.07] dark:border-white/[0.09]')}>
      <span className={cell}>Universe</span>
      <span className={clsx(cell, 'text-right')}>Size</span>
      <span className={cell}>Access</span>
      <span className={clsx(cell, 'text-right')}>Last active</span>
      <span className={clsx(cell, 'text-right')}>Attention</span>
    </div>
  )
}

interface ListUniverseRowProps {
  list: ListSurface
  metrics: ListSurfaceMetrics | undefined
  isFavorite: boolean
  /** Decides the ownership word when the list is not collaborative. */
  isOwner?: boolean
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
  lastActivity?: LastListActivity
  attention?: ListAttention
  /** Opens the list ready to add names. Absent where the reader cannot edit. */
  onAddSecurities?: () => void
}

export function ListUniverseRow({
  list,
  metrics,
  isFavorite,
  isOwner,
  onClick,
  onEdit,
  lastActivity,
  attention,
  onAddSecurities,
}: ListUniverseRowProps) {
  const count = metrics?.assetCount ?? 0
  const isEmpty = count === 0
  const isCollab = list.list_type === 'collaborative'
  const collabs = list.collaborators ?? []

  // Mine / Collaborative / Shared — the semantics the filter above uses, kept
  // as a word on the row instead of as three sections of page structure.
  const ownership = isCollab ? 'Collaborative' : isOwner ? 'Mine' : 'Shared'

  const needs = attention?.needsAttention ?? 0
  const blocking = (attention?.awaitingDecision ?? 0) > 0

  /** "2 decisions · 1 research · 1 review" — only the parts that exist. */
  const breakdown = attention
    ? [
        attention.awaitingDecision > 0
          && `${attention.awaitingDecision} decision${attention.awaitingDecision === 1 ? '' : 's'}`,
        attention.newResearch > 0 && `${attention.newResearch} research`,
        attention.reviewDue > 0
          && `${attention.reviewDue} review${attention.reviewDue === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' · ')
    : ''

  // The event leads and the clock is the footnote: "28d ago" says a universe is
  // quiet, "Eric added GOOGL" says what happened in it.
  const when = lastActivity?.created_at ?? list.updated_at ?? list.created_at
  const event = lastActivity
    ? `${lastActivity.actor_name} ${describeActivity(lastActivity)}`
    : list.created_by_user
      ? `Created by ${displayName(list.created_by_user).split(' ')[0]}`
      : 'Created'

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick() }}
      data-testid="universe-row"
      data-empty={isEmpty ? 'true' : 'false'}
      className={clsx(
        UNIVERSE_GRID,
        'group cursor-pointer px-3 py-[18px] border-b border-gray-900/[0.045] dark:border-white/[0.06]',
        'transition-colors hover:bg-gray-50/70 dark:hover:bg-gray-800/40',
      )}
    >
      {/* ── Universe ─────────────────────────────────────────────────── */}
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Identity only where the list actually carries a colour. */}
          {list.color && (
            <span
              aria-hidden
              data-testid="universe-dot"
              className="h-1.5 w-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: list.color }}
            />
          )}
          <h3 className={clsx(
            'text-[15.5px] tracking-[-0.024em] truncate',
            isEmpty
              ? 'font-medium text-gray-700 dark:text-gray-300'
              : 'font-semibold text-gray-900 dark:text-gray-50',
          )}>
            {list.name}
          </h3>
          {isFavorite && (
            <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" aria-label="Favourite" />
          )}
          <button
            onClick={onEdit}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-[11px] text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0"
          >
            Edit
          </button>
        </div>
        {list.description && (
          <p className={clsx(
            'mt-1 text-[12.5px] text-gray-500 dark:text-gray-400 truncate',
            // Aligned under the name, past the identity dot.
            list.color && 'ml-4',
          )}>
            {list.description}
          </p>
        )}
      </div>

      {/* ── Size ─────────────────────────────────────────────────────── */}
      <div className={clsx(
        'text-right text-[12.5px] whitespace-nowrap',
        isEmpty ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400',
      )}>
        <span className={clsx(
          'tabular-nums font-semibold',
          isEmpty ? 'text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-gray-100',
        )}>
          {count}
        </span>
        {' '}securit{count === 1 ? 'y' : 'ies'}
      </div>

      {/* ── Access ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {ownership}
        </span>
        {collabs.slice(0, AVATAR_PREVIEW_COUNT).map((c, i) => (
          <span
            key={c.id}
            title={displayName(c.user)}
            className={clsx(
              'w-[20px] h-[20px] rounded-full bg-gray-100 dark:bg-gray-800 text-[9px] font-semibold',
              'text-gray-500 dark:text-gray-400 flex items-center justify-center flex-shrink-0',
              i > 0 && '-ml-[7px] ring-2 ring-white dark:ring-gray-900',
            )}
          >
            {initialsOf(c.user)}
          </span>
        ))}
        {collabs.length > AVATAR_PREVIEW_COUNT && (
          <span className="text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500">
            +{collabs.length - AVATAR_PREVIEW_COUNT}
          </span>
        )}
      </div>

      {/* ── Last active ──────────────────────────────────────────────── */}
      <div className="text-right min-w-0">
        <div className="text-[12.5px] font-medium text-gray-700 dark:text-gray-200 truncate">
          {event}
        </div>
        {when && (
          <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
            {formatDistanceToNow(new Date(when), { addSuffix: true })}
          </div>
        )}
      </div>

      {/* ── Attention — secondary, and often nothing ─────────────────── */}
      <div className="text-right min-w-0">
        {isEmpty ? (
          /*
            * An empty universe states its next step instead of a count.
            * A link, not a button with a fill: it is the quietest thing that
            * can still be clicked, which is right for a row that is otherwise
            * complete and simply has nothing in it yet.
            */
          onAddSecurities ? (
            <button
              onClick={e => { e.stopPropagation(); onAddSecurities() }}
              className="text-[12px] text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-100 transition-colors whitespace-nowrap"
            >
              Add securities →
            </button>
          ) : (
            <span className="text-[12px] text-gray-300 dark:text-gray-600">—</span>
          )
        ) : needs > 0 ? (
          <>
            <div className="flex items-baseline justify-end gap-1.5">
              <span className={clsx(
                'text-[13.5px] font-semibold tabular-nums leading-none',
                blocking
                  ? 'text-primary-800 dark:text-primary-300'
                  : 'text-amber-700 dark:text-amber-400',
              )}>
                {needs}
              </span>
              <span className="text-[12px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                need attention
              </span>
            </div>
            {breakdown && (
              <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                {breakdown}
              </div>
            )}
          </>
        ) : (
          /* Nothing outstanding. An em-dash, not a green tick: a calm universe
             is the normal state and does not deserve a mark. */
          <span className="text-[12px] text-gray-300 dark:text-gray-600">—</span>
        )}
      </div>
    </div>
  )
}
