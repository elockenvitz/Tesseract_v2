import { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Star, ChevronUp, ChevronDown,
  Lock, Users, Eye, Pencil, MoreHorizontal, X,
  ExternalLink, Copy, Share2, Trash2, Bell, Clock
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { clsx } from 'clsx'
import type { ListSurface, ListSurfaceMetrics, ListSortKey, LastListActivity } from '../../hooks/lists/useListSurfaces'
import type { ListGroupKey } from './ListSurfaceControls'
import { useListActivity, type ListActivity } from '../../hooks/lists/useListActivity'

// ── Types ───────────────────────────────────────────────────────────────

type TableSortCol = 'name' | 'access' | 'portfolio' | 'assets' | 'owner' | 'updated' | 'updatedBy'
type TableSortDir = 'asc' | 'desc'

const PAGE_SIZE = 25

const COL_TO_SORT: Record<TableSortCol, ListSortKey> = {
  name: 'alpha', access: 'access', portfolio: 'portfolio',
  assets: 'assets', owner: 'owner', updated: 'recent', updatedBy: 'recent'
}
const SORT_TO_COL: Partial<Record<ListSortKey, TableSortCol>> = {
  alpha: 'name', access: 'access', portfolio: 'portfolio',
  assets: 'assets', owner: 'owner', recent: 'updated'
}
const COL_DEFAULT_DIR: Record<TableSortCol, TableSortDir> = {
  name: 'asc', access: 'asc', portfolio: 'asc',
  assets: 'desc', owner: 'asc', updated: 'desc', updatedBy: 'asc'
}

interface ListsTableViewProps {
  lists: ListSurface[]
  metrics: Map<string, ListSurfaceMetrics>
  favoriteSet: Set<string>
  userId: string | undefined
  sortBy: ListSortKey
  onSortByChange: (key: ListSortKey) => void
  onListClick: (list: ListSurface) => void
  onEditList: (list: ListSurface, e: React.MouseEvent) => void
  onToggleFavorite: (listId: string) => void
  groupBy: ListGroupKey
  lastOpenedMap: Map<string, string>
  updateCountMap: Map<string, number>
  selfUpdateCountMap: Map<string, number>
  lastActivityMap: Map<string, LastListActivity>
}

// ── Access helpers ──────────────────────────────────────────────────────

interface AccessInfo { label: string; icon: typeof Lock; className: string; weight: number }

function getAccess(list: ListSurface, userId: string | undefined): AccessInfo {
  if (list.list_type === 'collaborative')
    return { label: 'Collaborative', icon: Users, className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', weight: 1 }
  if (list.created_by === userId)
    return { label: 'Private', icon: Lock, className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', weight: 0 }
  const collab = list.collaborators?.find(c => c.user_id === userId)
  if (collab?.permission === 'write')
    return { label: 'Shared Edit', icon: Pencil, className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', weight: 2 }
  return { label: 'Shared Read', icon: Eye, className: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400', weight: 3 }
}

function getOwnerName(list: ListSurface): string {
  const u = list.created_by_user
  if (u?.first_name && u?.last_name) return `${u.first_name} ${u.last_name}`
  if (u?.email) return u.email
  return '-'
}

function getUpdatedByName(list: ListSurface): string {
  const u = list.updated_by_user
  if (u?.first_name && u?.last_name) return `${u.first_name} ${u.last_name}`
  if (u?.email) return u.email
  return '-'
}

function isSharedList(list: ListSurface, userId: string | undefined): boolean {
  return list.list_type === 'collaborative' ||
    (list.created_by !== userId && list.collaborators.length > 0) ||
    (list.created_by === userId && list.collaborators.length > 0)
}

function secondarySort(a: ListSurface, b: ListSurface): number {
  const t = new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
  if (t !== 0) return t
  return a.name.localeCompare(b.name)
}

// Responsive visibility classes
const rAccess    = 'hidden md:table-cell'   // show ≥768
const rPortfolio = 'hidden lg:table-cell'   // show ≥1024
const rOwner     = 'hidden xl:table-cell'   // show ≥1280
const rUpdatedBy = 'hidden lg:table-cell'   // show ≥1024

// ── Component ───────────────────────────────────────────────────────────

export function ListsTableView({
  lists, metrics, favoriteSet, userId,
  sortBy, onSortByChange, onListClick, onEditList, onToggleFavorite,
  groupBy, lastOpenedMap, updateCountMap, selfUpdateCountMap, lastActivityMap
}: ListsTableViewProps) {
  const activeSortCol = SORT_TO_COL[sortBy] ?? 'updated'
  const [sortDir, setSortDir] = useState<TableSortDir>(sortBy === 'alpha' ? 'asc' : 'desc')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  const handleHeaderClick = useCallback((col: TableSortCol) => {
    if (activeSortCol === col) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      onSortByChange(COL_TO_SORT[col])
      setSortDir(COL_DEFAULT_DIR[col])
    }
  }, [activeSortCol, onSortByChange])

  const sortedLists = useMemo(() => {
    const sorted = [...lists]
    const dir = sortDir === 'asc' ? 1 : -1
    sorted.sort((a, b) => {
      const ma = metrics.get(a.id); const mb = metrics.get(b.id)
      let primary = 0
      switch (activeSortCol) {
        case 'name': primary = a.name.localeCompare(b.name); break
        case 'access': primary = getAccess(a, userId).weight - getAccess(b, userId).weight; break
        case 'portfolio': primary = (ma?.portfolioName || '').localeCompare(mb?.portfolioName || ''); break
        case 'assets': primary = (ma?.assetCount ?? 0) - (mb?.assetCount ?? 0); break
        case 'owner': primary = (a.created_by === userId ? 0 : 1) - (b.created_by === userId ? 0 : 1); break
        case 'updated': primary = new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime(); break
        case 'updatedBy': primary = getUpdatedByName(a).localeCompare(getUpdatedByName(b)); break
      }
      if (primary !== 0) return dir * primary
      return secondarySort(a, b)
    })
    return sorted
  }, [lists, activeSortCol, sortDir, metrics, userId])

  // ── Grouping ────────────────────────────────────────────────────────
  const groupedLists = useMemo(() => {
    if (groupBy === 'none') return null
    const groups = new Map<string, ListSurface[]>()
    for (const list of sortedLists) {
      let key: string
      switch (groupBy) {
        case 'access': key = getAccess(list, userId).label; break
        case 'portfolio': key = metrics.get(list.id)?.portfolioName || 'No portfolio'; break
        case 'owner': key = getOwnerName(list); break
        case 'updatedBy': key = getUpdatedByName(list); break
        default: key = 'Other'
      }
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(list)
    }
    return groups
  }, [sortedLists, groupBy, userId, metrics])

  const visibleLists = sortedLists.slice(0, visibleCount)
  const hasMore = sortedLists.length > visibleCount
  const remainingCount = sortedLists.length - visibleCount

  // ── Selection ─────────────────────────────────────────────────────────
  const allVisibleSelected = visibleLists.length > 0 && visibleLists.every(l => selected.has(l.id))
  const someSelected = selected.size > 0

  const toggleSelectAll = useCallback(() => {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleLists.map(l => l.id)))
  }, [allVisibleSelected, visibleLists])

  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
    })
  }, [])

  const handleBulkFavorite = useCallback(() => {
    for (const id of selected) onToggleFavorite(id)
    setSelected(new Set())
  }, [selected, onToggleFavorite])

  if (sortedLists.length === 0) return null

  return (
    <div className="max-w-7xl mx-auto">
      {/* Bulk actions bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-primary-50 dark:bg-primary-950/30 border border-primary-200 dark:border-primary-800 rounded-t-lg text-xs">
          <span className="font-medium text-primary-700 dark:text-primary-300">{selected.size} selected</span>
          <button onClick={handleBulkFavorite}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors">
            <Star className="h-3 w-3" /> Toggle Favorite
          </button>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <X className="h-3 w-3" /> Clear
          </button>
        </div>
      )}

      <div className={clsx(
        'border border-gray-200 dark:border-gray-700 overflow-hidden',
        someSelected ? 'rounded-b-lg border-t-0' : 'rounded-lg'
      )}>
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
              <th className="w-9 px-2 py-1.5">
                <input type="checkbox" checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allVisibleSelected }}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              </th>
              <SortTh col="name" label="Name" active={activeSortCol} dir={sortDir} onClick={handleHeaderClick} className="w-auto" />
              <SortTh col="access" label="Access" active={activeSortCol} dir={sortDir} onClick={handleHeaderClick} className={clsx(rAccess, 'w-28')} />
              <SortTh col="portfolio" label="Portfolio" active={activeSortCol} dir={sortDir} onClick={handleHeaderClick} className={clsx(rPortfolio, 'w-32')} />
              <SortTh col="assets" label="Assets" active={activeSortCol} dir={sortDir} onClick={handleHeaderClick} align="right" className="w-16" />
              <SortTh col="owner" label="Owner" active={activeSortCol} dir={sortDir} onClick={handleHeaderClick} className={clsx(rOwner, 'w-32')} />
              <SortTh col="updated" label="Updated" active={activeSortCol} dir={sortDir} onClick={handleHeaderClick} className="w-36" />
              <SortTh col="updatedBy" label="Updated By" active={activeSortCol} dir={sortDir} onClick={handleHeaderClick} className={clsx(rUpdatedBy, 'w-28')} />
              <th className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center hidden lg:table-cell">
                Updates
              </th>
              <th className="w-9 py-1.5" />
              <th className="w-9 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {groupedLists
              ? Array.from(groupedLists.entries()).map(([groupLabel, groupItems]) => (
                  <GroupRows
                    key={groupLabel}
                    groupLabel={groupLabel}
                    lists={groupItems}
                    metrics={metrics}
                    favoriteSet={favoriteSet}
                    userId={userId}
                    selected={selected}
                    menuOpenId={menuOpenId}
                    updateCountMap={updateCountMap}
                    selfUpdateCountMap={selfUpdateCountMap}
                    lastOpenedMap={lastOpenedMap}
                    lastActivityMap={lastActivityMap}
                    onListClick={onListClick}
                    onEditList={onEditList}
                    onToggleFavorite={onToggleFavorite}
                    toggleSelect={toggleSelect}
                    setMenuOpenId={setMenuOpenId}
                  />
                ))
              : visibleLists.map((list, i) => (
                  <ListRow
                    key={list.id}
                    list={list}
                    index={i}
                    metrics={metrics}
                    favoriteSet={favoriteSet}
                    userId={userId}
                    selected={selected}
                    menuOpenId={menuOpenId}
                    updateCountMap={updateCountMap}
                    selfUpdateCountMap={selfUpdateCountMap}
                    lastOpenedMap={lastOpenedMap}
                    lastActivityMap={lastActivityMap}
                    onListClick={onListClick}
                    onEditList={onEditList}
                    onToggleFavorite={onToggleFavorite}
                    toggleSelect={toggleSelect}
                    setMenuOpenId={setMenuOpenId}
                  />
                ))
            }
          </tbody>
        </table>

        {hasMore && !groupedLists && (
          <div className="flex justify-center py-1.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">
            <button onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium transition-colors">
              Show more ({remainingCount} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared row props ────────────────────────────────────────────────────

interface ListRowProps {
  list: ListSurface
  index: number
  metrics: Map<string, ListSurfaceMetrics>
  favoriteSet: Set<string>
  userId: string | undefined
  selected: Set<string>
  menuOpenId: string | null
  updateCountMap: Map<string, number>
  selfUpdateCountMap: Map<string, number>
  lastOpenedMap: Map<string, string>
  lastActivityMap: Map<string, LastListActivity>
  onListClick: (list: ListSurface) => void
  onEditList: (list: ListSurface, e: React.MouseEvent) => void
  onToggleFavorite: (listId: string) => void
  toggleSelect: (id: string, e: React.MouseEvent) => void
  setMenuOpenId: (id: string | null) => void
}

function formatLastActivity(a: LastListActivity): string {
  const meta = a.metadata || {}
  switch (a.activity_type) {
    case 'item_added':
      return `${a.actor_name} added ${(meta.asset_symbol as string) || 'an asset'}`
    case 'item_removed':
      return `${a.actor_name} removed ${(meta.asset_symbol as string) || 'an asset'}`
    case 'metadata_updated': {
      const fields = (meta.changed_fields as string[]) || []
      return `${a.actor_name} updated ${fields.length > 0 ? fields.join(', ') : 'list details'}`
    }
    case 'collaborator_added':
      return `${a.actor_name} added ${(meta.user_name as string) || 'a collaborator'}`
    case 'collaborator_removed':
      return `${a.actor_name} removed ${(meta.user_name as string) || 'a collaborator'}`
    default:
      return `${a.actor_name} made a change`
  }
}

function ListRow({
  list, index: i, metrics, favoriteSet, userId, selected, menuOpenId,
  updateCountMap, selfUpdateCountMap, lastOpenedMap, lastActivityMap,
  onListClick, onEditList, onToggleFavorite, toggleSelect, setMenuOpenId
}: ListRowProps) {
  const m = metrics.get(list.id)
  const access = getAccess(list, userId)
  const AccessIcon = access.icon
  const isFav = favoriteSet.has(list.id)
  const isSelected = selected.has(list.id)
  const assetCount = m?.assetCount ?? 0
  const portfolioLabel = m?.portfolioName || 'All portfolios'
  const updatedByName = getUpdatedByName(list)
  const updateCount = updateCountMap.get(list.id) ?? 0
  const selfCount = selfUpdateCountMap.get(list.id) ?? 0
  const shared = isSharedList(list, userId)
  const lastOpened = lastOpenedMap.get(list.id)
  const lastActivity = lastActivityMap.get(list.id)

  return (
    <tr onClick={() => onListClick(list)}
      className={clsx(
        'group cursor-pointer border-b last:border-b-0 border-gray-100 dark:border-gray-800 transition-colors',
        'hover:bg-gray-50 dark:hover:bg-gray-800/40',
        isSelected && 'bg-primary-50/60 dark:bg-primary-900/20',
        !isSelected && i % 2 === 1 && 'bg-gray-50/30 dark:bg-gray-800/15'
      )}>
      <td className="w-9 px-2 py-2 align-middle">
        <input type="checkbox" checked={isSelected}
          onChange={() => {}} onClick={(e) => toggleSelect(list.id, e)}
          className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: list.color || '#3b82f6' }} />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate leading-tight">
              {list.name}
            </p>
            {list.description && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate leading-tight mt-0.5">
                {list.description}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className={clsx('px-3 py-2 align-middle whitespace-nowrap', rAccess)}>
        <span className={clsx(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium',
          access.className
        )}>
          <AccessIcon className="h-3 w-3" />
          {access.label}
        </span>
      </td>
      <td className={clsx('px-3 py-2 align-middle whitespace-nowrap', rPortfolio)}>
        <span className="text-xs text-gray-500 dark:text-gray-400">{portfolioLabel}</span>
      </td>
      <td className="px-3 py-2 text-right align-middle whitespace-nowrap">
        <span className="text-xs text-gray-700 dark:text-gray-300 tabular-nums font-medium">{assetCount}</span>
      </td>
      <td className={clsx('px-3 py-2 align-middle whitespace-nowrap', rOwner)}>
        <span className="text-xs text-gray-500 dark:text-gray-400">{getOwnerName(list)}</span>
      </td>
      <td className="px-3 py-2 align-middle whitespace-nowrap"
        title={lastActivity
          ? `${formatLastActivity(lastActivity)}\n${list.updated_at ? format(new Date(list.updated_at), 'PPpp') : ''}`
          : list.updated_at ? format(new Date(list.updated_at), 'PPpp') : 'No recent list activity recorded'
        }>
        <div className="flex flex-col">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {list.updated_at ? formatDistanceToNow(new Date(list.updated_at), { addSuffix: true }) : 'Unknown'}
          </span>
          {lastActivity && (
            <span className="text-[10px] text-gray-400/70 dark:text-gray-500/70 truncate max-w-[140px]">
              {formatLastActivity(lastActivity)}
            </span>
          )}
        </div>
      </td>
      <td className={clsx('px-3 py-2 align-middle whitespace-nowrap', rUpdatedBy)}>
        <span className="text-xs text-gray-500 dark:text-gray-400">{updatedByName}</span>
      </td>
      <td className="px-3 py-2 align-middle text-center hidden lg:table-cell">
        {shared && updateCount > 0 ? (
          <UpdatesBadge listId={list.id} count={updateCount} sinceTimestamp={lastOpened} showOwnActivity={false} />
        ) : !shared && selfCount > 0 ? (
          <SelfActivityIcon listId={list.id} sinceTimestamp={lastOpened} />
        ) : null}
      </td>
      <td className="w-9 py-2 align-middle text-center">
        <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(list.id) }}
          className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">
          <Star className={clsx('h-3.5 w-3.5',
            isFav ? 'text-yellow-500 fill-yellow-500'
              : 'text-gray-300 dark:text-gray-600 group-hover:text-gray-400'
          )} />
        </button>
      </td>
      <td className="w-9 py-2 align-middle text-center">
        <RowMenuTrigger
          isOpen={menuOpenId === list.id}
          onToggle={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === list.id ? null : list.id) }}
          onOpen={() => { setMenuOpenId(null); onListClick(list) }}
          onRename={(e) => { setMenuOpenId(null); onEditList(list, e) }}
          onClose={() => setMenuOpenId(null)}
        />
      </td>
    </tr>
  )
}

// ── GroupRows ───────────────────────────────────────────────────────────

const TOTAL_COLUMNS = 11

function GroupRows({ groupLabel, lists, ...rowProps }: {
  groupLabel: string
  lists: ListSurface[]
} & Omit<ListRowProps, 'list' | 'index'>) {
  return (
    <>
      <tr className="bg-gray-100/80 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <td colSpan={TOTAL_COLUMNS} className="px-3 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
            {groupLabel}
          </span>
          <span className="ml-2 text-[11px] text-gray-400 dark:text-gray-500">
            {lists.length}
          </span>
        </td>
      </tr>
      {lists.map((list, i) => (
        <ListRow key={list.id} list={list} index={i} {...rowProps} />
      ))}
    </>
  )
}

// ── SortTh ──────────────────────────────────────────────────────────────

function SortTh({
  col, label, active, dir, onClick, align = 'left', className = ''
}: {
  col: TableSortCol; label: string; active: TableSortCol; dir: TableSortDir
  onClick: (col: TableSortCol) => void; align?: 'left' | 'right'; className?: string
}) {
  const isActive = active === col
  return (
    <th
      onClick={() => onClick(col)}
      className={clsx(
        'px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider select-none cursor-pointer transition-colors',
        'hover:bg-gray-100 dark:hover:bg-gray-700/40',
        align === 'right' ? 'text-right' : 'text-left',
        isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400',
        className
      )}>
      <span className={clsx('inline-flex items-center gap-0.5', align === 'right' && 'justify-end')}>
        {label}
        {isActive && (dir === 'asc'
          ? <ChevronUp className="h-3 w-3 flex-shrink-0" />
          : <ChevronDown className="h-3 w-3 flex-shrink-0" />
        )}
      </span>
    </th>
  )
}

// ── UpdatesBadge ────────────────────────────────────────────────────────

function UpdatesBadge({ listId, count, sinceTimestamp, showOwnActivity }: {
  listId: string; count: number; sinceTimestamp?: string; showOwnActivity: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(prev => !prev) }}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
        title={`${count} update${count !== 1 ? 's' : ''} since you last opened`}
      >
        <Bell className="h-3 w-3" />
        {count}
      </button>
      {open && (
        <UpdatesDropdown
          listId={listId}
          sinceTimestamp={sinceTimestamp}
          showOwnActivity={showOwnActivity}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

// ── SelfActivityIcon ────────────────────────────────────────────────────

function SelfActivityIcon({ listId, sinceTimestamp }: {
  listId: string; sinceTimestamp?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(prev => !prev) }}
        className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        title="Your recent changes"
      >
        <Clock className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
      </button>
      {open && (
        <UpdatesDropdown
          listId={listId}
          sinceTimestamp={sinceTimestamp}
          showOwnActivity
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

// ── UpdatesDropdown ─────────────────────────────────────────────────────

function UpdatesDropdown({ listId, sinceTimestamp, showOwnActivity = false, onClose }: {
  listId: string; sinceTimestamp?: string; showOwnActivity?: boolean; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: activities, isLoading } = useListActivity(listId, sinceTimestamp, showOwnActivity)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-30 py-2 max-h-64 overflow-y-auto"
    >
      <div className="px-3 py-1 border-b border-gray-100 dark:border-gray-800 mb-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {showOwnActivity ? 'Your Recent Changes' : 'Recent Updates'}
        </span>
      </div>
      {isLoading ? (
        <div className="px-3 py-4 text-center text-xs text-gray-400">Loading...</div>
      ) : !activities || activities.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-gray-400">No recent updates</div>
      ) : (
        activities.map(a => (
          <div key={a.id} className="px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/40">
            <p className="text-xs text-gray-700 dark:text-gray-300">
              {formatActivityMessage(a)}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
              {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
            </p>
          </div>
        ))
      )}
    </div>
  )
}

// ── Activity message formatter ──────────────────────────────────────────

function formatActivityMessage(activity: ListActivity): string {
  const actorName = activity.actor
    ? (activity.actor.first_name && activity.actor.last_name
        ? `${activity.actor.first_name} ${activity.actor.last_name}`
        : activity.actor.email || 'Someone')
    : 'Someone'

  const meta = activity.metadata || {}

  switch (activity.activity_type) {
    case 'item_added':
      return `${actorName} added ${(meta.asset_symbol as string) || 'an asset'}`
    case 'item_removed':
      return `${actorName} removed ${(meta.asset_symbol as string) || 'an asset'}`
    case 'metadata_updated': {
      const fields = (meta.changed_fields as string[]) || []
      return `${actorName} updated ${fields.length > 0 ? fields.join(', ') : 'list details'}`
    }
    case 'collaborator_added':
      return `${actorName} added ${(meta.user_name as string) || 'a collaborator'}`
    case 'collaborator_removed':
      return `${actorName} removed ${(meta.user_name as string) || 'a collaborator'}`
    default:
      return `${actorName} made a change`
  }
}

// ── RowMenuTrigger + Portal Menu ────────────────────────────────────────

function RowMenuTrigger({ isOpen, onToggle, onOpen, onRename, onClose }: {
  isOpen: boolean
  onToggle: (e: React.MouseEvent) => void
  onOpen: () => void
  onRename: (e: React.MouseEvent) => void
  onClose: () => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={btnRef}
        onClick={onToggle}
        className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        title="Actions">
        <MoreHorizontal className="h-4 w-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
      </button>
      {isOpen && (
        <RowMenuPortal
          anchorRef={btnRef}
          onOpen={onOpen}
          onRename={onRename}
          onClose={onClose}
        />
      )}
    </>
  )
}

function RowMenuPortal({ anchorRef, onOpen, onRename, onClose }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onOpen: () => void
  onRename: (e: React.MouseEvent) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; flipUp: boolean }>({ top: 0, left: 0, flipUp: false })

  useLayoutEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const menuHeight = 200 // approximate
    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < menuHeight && rect.top > menuHeight
    setPos({
      top: flipUp ? rect.top : rect.bottom + 4,
      left: rect.right - 160, // w-40 = 10rem = 160px, right-aligned
      flipUp
    })
  }, [anchorRef])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  const cls = 'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left'

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.flipUp ? undefined : pos.top,
        bottom: pos.flipUp ? window.innerHeight - pos.top + 4 : undefined,
        left: Math.max(8, pos.left),
      }}
      className="w-40 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1"
    >
      <button className={cls} onClick={onOpen}>
        <ExternalLink className="h-3.5 w-3.5 text-gray-400" /> Open
      </button>
      <button className={cls} onClick={onRename}>
        <Pencil className="h-3.5 w-3.5 text-gray-400" /> Rename
      </button>
      <button className={clsx(cls, 'opacity-50 cursor-not-allowed')} disabled>
        <Copy className="h-3.5 w-3.5 text-gray-400" /> Duplicate
      </button>
      <button className={clsx(cls, 'opacity-50 cursor-not-allowed')} disabled>
        <Share2 className="h-3.5 w-3.5 text-gray-400" /> Share
      </button>
      <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
      <button className={clsx(cls, 'text-red-600 dark:text-red-400 opacity-50 cursor-not-allowed')} disabled>
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    </div>,
    document.body
  )
}
