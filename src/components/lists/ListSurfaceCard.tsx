/**
 * One List, as a universe panel.
 *
 * ── The question this page answers ────────────────────────────────────────
 *
 *   WHICH INVESTMENT UNIVERSE NEEDS MY ATTENTION, AND WHY?
 *
 * Three earlier versions did not clear that bar. As bordered tiles, an empty
 * list took the same several hundred pixels as one with two decisions pending.
 * As flat text rows, each universe became one 14px line with its attention
 * state set in 11.5px grey at the far right — the most important fact on the
 * row was the quietest thing on it. Both were directories with counts bolted on.
 *
 * ── What this is instead ──────────────────────────────────────────────────
 *
 * A panel with three bands, reading top to bottom in the order a reader asks:
 *
 *   IDENTITY   two lines, not four — name, scale and ownership on the first;
 *              purpose and the universe's own tickers on the second
 *   ATTENTION  the securities themselves, as investment objects: ticker and
 *              company above, "BUY · Recommendation ready" and its book and age
 *              below. Never counts alone — a count says a universe is loud
 *              without saying what is loud in it, so the only way to act on it
 *              was to open the list and look
 *   RECENT     one meaningful event and its age
 *
 * Hierarchy is type, alignment and spacing. The bands are separated by a single
 * hairline and whitespace, never by a tinted box or a nested card — a card
 * inside a card is what made this read as a SaaS dashboard. The one mark on the
 * panel is a 2px rule in the ticker gutter, and only a decision earns it.
 *
 * An empty list never renders here at all; see `ListsPage`, which collects them
 * into one quiet line of inventory beneath the active universes.
 */
import { Star, Users, Filter } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import type { ListSurface, ListSurfaceMetrics, LastListActivity } from '../../hooks/lists/useListSurfaces'
import type { ListAttention, ListAttentionItem } from '../../hooks/lists/useListAttention'
import { describeActivity } from '../../lib/lists/describeActivity'

interface ListSurfaceCardProps {
  list: ListSurface
  metrics: ListSurfaceMetrics | undefined
  isFavorite: boolean
  /** Decides the quiet ownership word. Mine / Collaborative / Shared. */
  isOwner?: boolean
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
  /** Map of asset_id → ticker, for the universe preview */
  symbolMap?: Map<string, string>
  /** Most recent activity event on this list */
  lastActivity?: LastListActivity
  /**
   * What on this list needs a person, folded from data already on the page.
   * See `useListAttention`. Absent is fine — the panel simply says less.
   */
  attention?: ListAttention
  /**
   * Open one attention security straight into its inspector.
   *
   * The panel is navigational, not a report: a reader who can see that TGT is
   * awaiting a decision should reach that decision in one click rather than
   * opening the list and finding the row again. `ListsPage` turns this into a
   * list tab carrying a focus, and the list expands that security in place.
   */
  onOpenSecurity?: (item: ListAttentionItem) => void
}

const TICKER_PREVIEW_COUNT = 6
const AVATAR_PREVIEW_COUNT = 2
/** Three is what a panel can show without the universe below it dropping off. */
const ATTENTION_PREVIEW_COUNT = 3

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

/** The small-caps label both bands share, so they rhyme rather than compete. */
function Band({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-gray-400 dark:text-gray-600 flex-shrink-0">
      {children}
    </span>
  )
}

/**
 * One security that wants a person.
 *
 * Two lines, because that is what makes it an investment object rather than a
 * notification: the identity reads across, and the claim about it reads
 * underneath with its book and age pushed right into a quiet metadata column.
 */
function AttentionRow({
  item, onOpen,
}: { item: ListAttentionItem; onOpen?: () => void }) {
  const decision = item.tier === 'decision'
  const research = item.tier === 'research'
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onOpen?.() }}
      disabled={!onOpen}
      data-testid="attention-item"
      data-tier={item.tier}
      className={clsx(
        'group/at relative w-full text-left grid grid-cols-[54px_minmax(0,1fr)] gap-x-3 py-1 rounded-sm',
        'border-t border-gray-900/[0.03] dark:border-white/[0.04] first:border-t-0',
        onOpen && 'hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors',
      )}
    >
      {/* The one mark on the panel, in the gutter. A decision is the only state
          that is blocking a person rather than merely open. */}
      {decision && (
        <span className="absolute -left-[9px] top-[7px] w-[2px] h-3 rounded-sm bg-primary-700 dark:bg-primary-400" />
      )}
      {research && (
        <span className="absolute -left-[9px] top-[7px] w-[2px] h-3 rounded-sm bg-amber-500" />
      )}

      <span className={clsx(
        'text-[13px] font-bold tracking-[-0.015em] leading-tight tabular-nums truncate',
        item.tier === 'review'
          ? 'text-gray-700 dark:text-gray-300 font-semibold'
          : 'text-gray-900 dark:text-gray-50',
      )}>
        {item.symbol ?? '—'}
      </span>
      <span className="text-[12px] text-gray-400 dark:text-gray-500 leading-tight truncate">
        {item.companyName ?? ''}
      </span>

      <span className="col-start-2 flex items-baseline gap-2 mt-[2px] min-w-0">
        <span className={clsx(
          'text-[11.5px] tracking-[-0.005em] truncate',
          decision && 'font-semibold text-primary-800 dark:text-primary-300',
          research && 'font-semibold text-amber-700 dark:text-amber-400',
          item.tier === 'review' && 'font-medium text-gray-500 dark:text-gray-400',
        )}>
          {item.reason}
        </span>
        {item.meta && (
          <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-600 whitespace-nowrap flex-shrink-0">
            {item.meta}
          </span>
        )}
      </span>
    </button>
  )
}

export function ListSurfaceCard({
  list,
  metrics,
  isFavorite,
  isOwner,
  onClick,
  onEdit,
  symbolMap,
  lastActivity,
  attention,
  onOpenSecurity,
}: ListSurfaceCardProps) {
  const isScreen = (list as any).content_mode === 'screen'
  const isCollab = list.list_type === 'collaborative'
  const assetCount = metrics?.assetCount ?? 0

  const tickers = symbolMap
    ? list.assetIds.slice(0, TICKER_PREVIEW_COUNT)
        .map(id => symbolMap.get(id))
        .filter((s): s is string => !!s)
    : []
  const overflowTickers = Math.max(0, list.assetIds.length - tickers.length)

  const needs = attention?.needsAttention ?? 0
  const items = attention?.items ?? []
  const shown = items.slice(0, ATTENTION_PREVIEW_COUNT)
  const rest = items.slice(ATTENTION_PREVIEW_COUNT)
  const blocking = (attention?.awaitingDecision ?? 0) > 0
  const collabs = list.collaborators ?? []

  // Mine / Collaborative / Shared, preserved as a word rather than a section.
  const ownership = isCollab ? 'Collaborative' : isOwner ? 'Mine' : 'Shared'

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick() }}
      data-testid="universe-panel"
      data-attention={needs > 0 ? (blocking ? 'blocking' : 'open') : 'calm'}
      className={clsx(
        'group relative cursor-pointer rounded bg-white dark:bg-gray-900',
        'border border-gray-900/[0.055] dark:border-white/[0.07]',
        'pl-[17px] pr-4 py-3 transition-colors hover:border-gray-900/[0.11] dark:hover:border-white/[0.13]',
      )}
    >
      {/*
        * The spine carries identity AND urgency in one element.
        *
        * The list's own colour when nothing is owed; amber when something is,
        * primary when a decision is. One element doing both jobs is what keeps
        * the panel from needing a badge — the eye finds the coloured edges down
        * the column before it reads a word.
        */}
      <span
        aria-hidden
        data-testid="universe-spine"
        className={clsx(
          'absolute -left-px -top-px -bottom-px w-[2px] rounded-l',
          blocking && 'bg-primary-700 dark:bg-primary-400',
          needs > 0 && !blocking && 'bg-amber-500',
        )}
        style={needs > 0 ? undefined : { backgroundColor: list.color || '#e3e6ea' }}
      />

      {/* ── Line one: identity, scale, ownership ──────────────────────── */}
      <div className="flex items-baseline gap-2 min-w-0">
        <h3 className="text-[16px] font-semibold tracking-[-0.022em] text-gray-900 dark:text-gray-50 truncate">
          {list.name}
        </h3>
        {isFavorite && <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
        {isScreen && <Filter className="h-2.5 w-2.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />}
        <span className="text-[12px] tabular-nums text-gray-400 dark:text-gray-500 flex-shrink-0">
          {assetCount} securit{assetCount === 1 ? 'y' : 'ies'}
        </span>

        <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[11px] text-gray-400 dark:text-gray-600">{ownership}</span>
          {isCollab && collabs.length === 0 && (
            <Users className="h-3 w-3 text-gray-300 dark:text-gray-600" aria-label="Collaborative" />
          )}
          {collabs.slice(0, AVATAR_PREVIEW_COUNT).map((c, i) => (
            <span
              key={c.id}
              title={displayName(c.user)}
              className={clsx(
                'w-[19px] h-[19px] rounded-full bg-gray-100 dark:bg-gray-800 text-[9px] font-semibold',
                'text-gray-500 dark:text-gray-400 flex items-center justify-center',
                i > 0 && '-ml-[7px] ring-2 ring-white dark:ring-gray-900',
              )}
            >
              {initialsOf(c.user)}
            </span>
          ))}
          <button
            onClick={onEdit}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-[11px] text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            title="Edit list"
          >
            Edit
          </button>
        </span>
      </div>

      {/* ── Line two: purpose and the universe itself ─────────────────── */}
      <div className="mt-[3px] flex items-baseline gap-3 min-w-0">
        {list.description && (
          <span className="text-[12.5px] text-gray-500 dark:text-gray-400 truncate flex-shrink">
            {list.description}
          </span>
        )}
        {list.description && tickers.length > 0 && (
          <span className="text-[11px] text-gray-200 dark:text-gray-700 flex-shrink-0">|</span>
        )}
        {/* The securities themselves, in the same tabular face the monitor
            uses — so a universe reads as a set of names, not as a folder. */}
        {tickers.length > 0 && (
          <span className="flex items-baseline gap-2.5 flex-shrink-0 overflow-hidden">
            {tickers.map(t => (
              <span key={t} className="text-[12px] font-semibold tabular-nums tracking-[-0.005em] text-gray-400 dark:text-gray-500">
                {t}
              </span>
            ))}
            {overflowTickers > 0 && (
              <span className="text-[12px] tabular-nums text-gray-300 dark:text-gray-600">+{overflowTickers}</span>
            )}
          </span>
        )}
      </div>

      {/* ── Attention: rows on the surface, no tinted box ─────────────── */}
      <div className="mt-2.5 pt-2 border-t border-gray-900/[0.045] dark:border-white/[0.06]">
        <div className="flex items-baseline gap-2 mb-1">
          <Band>Needs attention</Band>
          <span className="text-[10.5px] tabular-nums text-gray-300 dark:text-gray-600">
            {needs > 0 ? `${needs} of ${assetCount}` : 'none'}
          </span>
        </div>

        {needs > 0 ? (
          <>
            {shown.map(item => (
              <AttentionRow
                key={item.assetId}
                item={item}
                onOpen={onOpenSecurity ? () => onOpenSecurity(item) : undefined}
              />
            ))}
            {rest.length > 0 && (
              <div className="mt-1 text-[11.5px] text-gray-500 dark:text-gray-400">
                +{rest.length} more
                {rest.length <= 2 && (
                  <> · {rest.map(r => r.symbol).filter(Boolean).join(', ')} {rest[0].tier === 'review' ? 'review due' : ''}</>
                )}
              </div>
            )}
          </>
        ) : (
          /*
            * A healthy universe is stated, quietly, and never dressed up.
            *
            * Rendering nothing here would read as "we know nothing about this
            * list", which is a different answer to "where do I need to go".
            */
          <div className="text-[12.5px] text-gray-400 dark:text-gray-500 leading-relaxed">
            {attention && attention.noCase > 0
              ? `${attention.noCase} securit${attention.noCase === 1 ? 'y has' : 'ies have'} no case written.`
              : attention && attention.activeIdeas > 0
                ? `${attention.activeIdeas} idea${attention.activeIdeas === 1 ? '' : 's'} in progress. Nothing is waiting on a person.`
                : 'Every case is written and current. Nothing is waiting on a person.'}
          </div>
        )}
      </div>

      {/* ── Recent: its own line, not a note pinned to a border ───────── */}
      {(lastActivity || list.updated_at) && (
        <div className="mt-3 flex items-baseline gap-2.5 min-w-0">
          <Band>Recent</Band>
          <span className="text-[12px] text-gray-600 dark:text-gray-300 truncate min-w-0">
            {lastActivity ? (
              <>
                <span className="font-semibold text-gray-700 dark:text-gray-200">{lastActivity.actor_name}</span>
                {' '}{describeActivity(lastActivity)}
              </>
            ) : (
              'Updated'
            )}
          </span>
          <span className="ml-auto text-[11.5px] text-gray-300 dark:text-gray-600 whitespace-nowrap flex-shrink-0">
            {formatDistanceToNow(
              new Date(lastActivity?.created_at ?? list.updated_at!),
              { addSuffix: true },
            )}
          </span>
        </div>
      )}
    </div>
  )
}
