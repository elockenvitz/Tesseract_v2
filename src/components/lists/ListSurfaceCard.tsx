/**
 * One List, as a universe summary.
 *
 * ── The question this page answers ────────────────────────────────────────
 *
 *   WHICH INVESTMENT UNIVERSE NEEDS MY ATTENTION, AND WHY?
 *
 * A reader should be able to look at /lists for three seconds and know "Work in
 * Process is where I need to go". Two earlier versions did not clear that bar
 * for the same underlying reason, from opposite directions:
 *
 *   • as bordered cards, an empty list and a list with two decisions pending
 *     occupied the same several hundred pixels, so the answer was below the
 *     fold and the page read as a filesystem of folders;
 *   • as flat text rows, every list became one 14px line with its attention
 *     state set in 11.5px grey at the far right — so the page read as a column
 *     of navigation links, and the most important fact on each row was the
 *     quietest thing on it.
 *
 * ── What dominates, and why it is allowed to ──────────────────────────────
 *
 * The attention state. It is set as a COUNT at figure size with a word under
 * it, in a three-zone row:
 *
 *   IDENTITY      what this universe is, how big, and which names are in it
 *   ATTENTION     what is owed, as figures — the loudest thing on the row
 *   PROVENANCE    who last moved it, and who else is in it. Deliberately quiet.
 *
 * A grid rather than flex spacers, so the three zones sit at fixed stations and
 * a 1600px screen does not strand them at opposite edges with a lake of nothing
 * between — which is the specific thing that made the previous version read as
 * an admin directory.
 *
 * Emphasis is type, size and one mark. Not a border, not a filled badge, not a
 * coloured background: on a page of thirty lists any of those becomes a wall of
 * decoration, and a wall of decoration is read as texture rather than signal.
 * The list's own colour survives as a 2px spine, which is identity, not status —
 * and it goes amber when something is owed, which is the one place the two meet.
 *
 * An empty list collapses to a single quiet line and consumes almost nothing.
 */
import { Star, Edit3, Users, Filter } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import type { ListSurface, ListSurfaceMetrics, LastListActivity } from '../../hooks/lists/useListSurfaces'
import type { ListAttention } from '../../hooks/lists/useListAttention'
import { describeActivity } from '../../lib/lists/describeActivity'

interface ListSurfaceCardProps {
  list: ListSurface
  metrics: ListSurfaceMetrics | undefined
  isFavorite: boolean
  /**
   * Kept in the contract, unused in the composition.
   *
   * Ownership used to drive a "Shared" badge. It is now carried by the
   * collaborator faces and the collaborative glyph, which say the same thing
   * without a third pill — but the callers still pass it and a future
   * treatment may want it.
   */
  isOwner?: boolean
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
  /** Map of asset_id → ticker, for the preview strip */
  symbolMap?: Map<string, string>
  /** Most recent activity event on this list */
  lastActivity?: LastListActivity
  /**
   * What on this list needs a person, folded from data already on the page.
   * See `useListAttention`. Absent is fine — the unit simply says less.
   */
  attention?: ListAttention
}

const TICKER_PREVIEW_COUNT = 6
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

/**
 * One thing that is owed, as a figure over a word.
 *
 * A count at 17px with its noun beneath is read in one saccade; the same fact as
 * "2 awaiting decision" in a 11.5px sentence has to be parsed. `tone` is the
 * only colour: primary where somebody owes a DECISION — the one state that is
 * blocking rather than merely open — amber where research is unanswered, and
 * neutral for a clock that has run out.
 */
function Owed({
  count, label, tone,
}: {
  count: number
  label: string
  tone: 'decision' | 'research' | 'clock'
}) {
  if (count <= 0) return null
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className={clsx(
        'text-[17px] font-semibold leading-none tabular-nums tracking-[-0.02em] flex-shrink-0',
        tone === 'decision' && 'text-primary-700 dark:text-primary-300',
        tone === 'research' && 'text-amber-700 dark:text-amber-400',
        tone === 'clock' && 'text-gray-700 dark:text-gray-300',
      )}>
        {count}
      </span>
      <span className={clsx(
        'text-[11px] leading-tight max-w-[74px]',
        tone === 'decision'
          ? 'font-semibold text-gray-700 dark:text-gray-200'
          : 'font-medium text-gray-500 dark:text-gray-400',
      )}>
        {label}
      </span>
    </div>
  )
}

export function ListSurfaceCard({
  list,
  metrics,
  isFavorite,
  onClick,
  onEdit,
  symbolMap,
  lastActivity,
  attention
}: ListSurfaceCardProps) {
  const color = list.color || '#3b82f6'
  const isScreen = (list as any).content_mode === 'screen'
  const isCollab = list.list_type === 'collaborative'
  const assetCount = metrics?.assetCount ?? 0
  const isEmpty = assetCount === 0

  const tickers = symbolMap
    ? list.assetIds.slice(0, TICKER_PREVIEW_COUNT)
        .map(id => symbolMap.get(id))
        .filter((s): s is string => !!s)
    : []
  const overflowTickers = Math.max(0, list.assetIds.length - tickers.length)

  const needs = attention?.needsAttention ?? 0
  const blocking = (attention?.awaitingDecision ?? 0) > 0
  const collabs = list.collaborators ?? []

  // ── The empty case: one quiet line, and almost no height ──────────────
  if (isEmpty) {
    return (
      <div
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') onClick() }}
        data-testid="list-unit"
        data-empty="true"
        className="group relative cursor-pointer rounded-md pl-4 pr-3 py-1.5 flex items-baseline gap-2 min-w-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full opacity-40"
          style={{ backgroundColor: color }}
        />
        <h3 className="truncate text-[13px] font-medium text-gray-500 dark:text-gray-400">
          {list.name}
        </h3>
        {isFavorite && <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
        {isScreen && <Filter className="h-2.5 w-2.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />}
        <span className="text-[11px] text-gray-300 dark:text-gray-600 flex-shrink-0">empty</span>
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick() }}
      data-testid="list-unit"
      data-attention={needs > 0 ? (blocking ? 'blocking' : 'open') : 'calm'}
      className={clsx(
        'group relative cursor-pointer rounded-md pl-4 pr-3 py-2.5 transition-colors',
        // One hover surface, no shadow and no lift — thirty lifting tiles is a
        // page that will not hold still.
        'hover:bg-gray-50 dark:hover:bg-gray-800/50',
      )}
    >
      {/*
        * The spine carries identity AND urgency.
        *
        * The list's own colour normally, amber when something is owed. One
        * element doing both jobs is what keeps the row from needing a badge: the
        * eye finds the coloured edges down the left before it reads a word.
        */}
      <span
        aria-hidden
        data-testid="list-spine"
        className={clsx(
          'absolute left-0 top-2 bottom-2 rounded-full',
          needs > 0 ? 'w-[3px]' : 'w-[2px] opacity-60 group-hover:opacity-100',
          blocking && 'bg-primary-600 dark:bg-primary-400',
          needs > 0 && !blocking && 'bg-amber-500',
        )}
        // The list's own colour only when nothing is owed. Urgency overrides
        // identity, because identity is already carried by the name beside it.
        style={needs > 0 ? undefined : { backgroundColor: color }}
      />

      {/*
        * Three stations, not three flex extremes.
        *
        * Attention gets a fixed column so the figures in it line up DOWN the
        * page — scanning a column of counts is the whole point, and it only
        * works if they share an x-position across rows.
        */}
      {/*
        * Identity is CAPPED, not elastic.
        *
        * With `1fr` it absorbed every pixel of a 1440px pane, which pushed the
        * attention figures roughly 900px away from the names they describe —
        * the row broke into two unrelated halves with a lake between them, and
        * that lake is what read as an admin directory. Capping identity puts the
        * three stations side by side and lets the slack fall off the right, where
        * it is ordinary page margin instead of a hole inside a row.
        */}
      <div className="grid grid-cols-1 justify-start md:grid-cols-[minmax(0,420px)_auto] lg:grid-cols-[minmax(0,420px)_minmax(0,272px)_minmax(0,340px)] gap-x-8 gap-y-2 items-center">

        {/* ── Identity: what this universe is, and what is in it ───────── */}
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className={clsx(
              'truncate tracking-[-0.015em]',
              needs > 0
                ? 'text-[15px] font-semibold text-gray-900 dark:text-gray-50'
                : 'text-[15px] font-medium text-gray-800 dark:text-gray-100',
            )}>
              {list.name}
            </h3>
            {isFavorite && <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
            {isScreen && (
              <span className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 flex-shrink-0">
                <Filter className="h-2.5 w-2.5" />
                Screen
              </span>
            )}
            {isCollab && (
              <Users className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" aria-label="Collaborative" />
            )}
            <span className="text-[12px] tabular-nums text-gray-400 dark:text-gray-500 flex-shrink-0">
              {assetCount} name{assetCount === 1 ? '' : 's'}
            </span>
            <button
              onClick={onEdit}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded flex-shrink-0"
              title="Edit list"
            >
              <Edit3 className="h-3 w-3" />
            </button>
          </div>

          {/*
            * The universe itself, in the same tabular face the monitor uses — so
            * a list reads as a set of securities rather than as a folder. This
            * is the line that makes the page feel like it is about investments.
            */}
          {tickers.length > 0 && (
            <div className="mt-1 flex items-baseline gap-2.5 min-w-0 overflow-hidden">
              {tickers.map(t => (
                <span key={t} className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums tracking-[-0.01em] flex-shrink-0">
                  {t}
                </span>
              ))}
              {overflowTickers > 0 && (
                <span className="text-[12px] text-gray-300 dark:text-gray-600 tabular-nums flex-shrink-0">
                  +{overflowTickers}
                </span>
              )}
            </div>
          )}

          {/* Purpose, last and quietest — it does not change day to day. */}
          {list.description && (
            <p className="mt-1 text-[11.5px] text-gray-400 dark:text-gray-500 leading-snug truncate">
              {list.description}
            </p>
          )}
        </div>

        {/* ── Attention: the loudest thing on the row ──────────────────── */}
        <div className="min-w-0 flex items-center gap-5">
          {needs > 0 ? (
            <>
              <Owed count={attention!.awaitingDecision} label="awaiting decision" tone="decision" />
              <Owed count={attention!.newResearch} label="new research" tone="research" />
              <Owed count={attention!.reviewDue} label="review due" tone="clock" />
            </>
          ) : (
            /*
              * Nothing owed is worth saying, quietly. A calm list that renders
              * blank here reads as a list we know nothing about, and the two are
              * very different answers to "where do I need to go".
              */
            <span className="text-[11.5px] text-gray-400 dark:text-gray-500 truncate">
              {attention && attention.activeIdeas > 0
                ? `${attention.activeIdeas} idea${attention.activeIdeas === 1 ? '' : 's'} in progress`
                : attention && attention.noCase > 0
                  ? `${attention.noCase} without a case`
                  : 'Nothing outstanding'}
            </span>
          )}
        </div>

        {/* ── Provenance: who moved it, who is in it. Quiet by design. ─── */}
        <div className="hidden lg:flex items-center gap-2 min-w-0">
          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
            {lastActivity ? (
              <>
                {lastActivity.actor_name} {describeActivity(lastActivity)}
                {' · '}
                {formatDistanceToNow(new Date(lastActivity.created_at), { addSuffix: true })}
              </>
            ) : list.updated_at ? (
              `Updated ${formatDistanceToNow(new Date(list.updated_at), { addSuffix: true })}`
            ) : null}
          </span>
          {collabs.length > 0 && (
            <span className="flex items-center flex-shrink-0" title={`${collabs.length} collaborator${collabs.length === 1 ? '' : 's'}`}>
              {collabs.slice(0, AVATAR_PREVIEW_COUNT).map(c => (
                <span
                  key={c.id}
                  title={displayName(c.user)}
                  className="w-[18px] h-[18px] rounded-full bg-gray-100 dark:bg-gray-800 text-[9px] font-semibold text-gray-500 dark:text-gray-400 flex items-center justify-center -ml-1 first:ml-0 ring-1 ring-white dark:ring-gray-900"
                >
                  {initialsOf(c.user)}
                </span>
              ))}
              {collabs.length > AVATAR_PREVIEW_COUNT && (
                <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                  +{collabs.length - AVATAR_PREVIEW_COUNT}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
