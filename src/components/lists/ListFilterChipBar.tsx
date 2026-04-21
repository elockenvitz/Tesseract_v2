import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  Filter, X, Flag, Search, User, UserCheck, UserX, CalendarClock,
  Circle, Tag as TagIcon, Check
} from 'lucide-react'
import { clsx } from 'clsx'
import { useListStatuses } from '../../hooks/lists/useListStatuses'
import { useListTags } from '../../hooks/lists/useListTags'
import { useListMembers } from '../../hooks/lists/useListMembers'
import { useAuth } from '../../hooks/useAuth'

export interface ListRowFilters {
  assigneeIds: string[]
  statusIds: string[]
  tagIds: string[]
  flaggedOnly: boolean
  /** Show only rows with no assignee. */
  unassignedOnly: boolean
  /** Show only rows with due_date within the next 7 days OR overdue. */
  dueSoon: boolean
}

export const EMPTY_FILTERS: ListRowFilters = {
  assigneeIds: [],
  statusIds: [],
  tagIds: [],
  flaggedOnly: false,
  unassignedOnly: false,
  dueSoon: false
}

interface ListFilterChipBarProps {
  listId: string
  filters: ListRowFilters
  onChange: (next: ListRowFilters) => void
}

export function ListFilterChipBar({ listId, filters, onChange }: ListFilterChipBarProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { user } = useAuth()
  const myUserId = user?.id ?? null

  // Load unconditionally so applied pills can resolve names even before the
  // popover has been opened (e.g., a filter applied from the progress strip).
  const { data: members = [] } = useListMembers(listId)
  const { statuses } = useListStatuses(listId)
  const { tags } = useListTags(listId)

  // Close on outside click; reset query when opening
  useEffect(() => {
    if (!open) { setQuery(''); return }
    // Focus search when opening
    requestAnimationFrame(() => searchRef.current?.focus())
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open])

  const membersMap = useMemo(() => new Map(members.map(m => [m.user_id, m])), [members])
  const statusesMap = useMemo(() => new Map(statuses.map(s => [s.id, s])), [statuses])
  const tagsMap = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags])

  // ── Filter counts ─────────────────────────────────────────────────
  const activeCount =
    (filters.flaggedOnly ? 1 : 0) +
    (filters.unassignedOnly ? 1 : 0) +
    (filters.dueSoon ? 1 : 0) +
    filters.assigneeIds.length +
    filters.statusIds.length +
    filters.tagIds.length
  const hasAnyFilter = activeCount > 0
  const myWorkActive = !!(myUserId && filters.assigneeIds.includes(myUserId))

  // ── Mutations ─────────────────────────────────────────────────────
  const toggleMyWork = () => {
    if (!myUserId) return
    onChange({
      ...filters,
      assigneeIds: myWorkActive
        ? filters.assigneeIds.filter(x => x !== myUserId)
        : [...filters.assigneeIds, myUserId],
      unassignedOnly: myWorkActive ? filters.unassignedOnly : false
    })
  }
  const toggleUnassigned = () => onChange({
    ...filters,
    unassignedOnly: !filters.unassignedOnly,
    assigneeIds: filters.unassignedOnly ? filters.assigneeIds : []
  })
  const toggleDueSoon = () => onChange({ ...filters, dueSoon: !filters.dueSoon })
  const toggleFlagged = () => onChange({ ...filters, flaggedOnly: !filters.flaggedOnly })
  const toggleAssignee = (userId: string) => {
    const has = filters.assigneeIds.includes(userId)
    onChange({
      ...filters,
      assigneeIds: has ? filters.assigneeIds.filter(x => x !== userId) : [...filters.assigneeIds, userId],
      // Adding a specific assignee clears "unassigned only" (contradicts)
      unassignedOnly: has ? filters.unassignedOnly : false
    })
  }
  const toggleStatus = (statusId: string) => {
    const has = filters.statusIds.includes(statusId)
    onChange({
      ...filters,
      statusIds: has ? filters.statusIds.filter(x => x !== statusId) : [...filters.statusIds, statusId]
    })
  }
  const toggleTag = (tagId: string) => {
    const has = filters.tagIds.includes(tagId)
    onChange({
      ...filters,
      tagIds: has ? filters.tagIds.filter(x => x !== tagId) : [...filters.tagIds, tagId]
    })
  }
  const clearAll = () => onChange(EMPTY_FILTERS)

  // ── Search filter ─────────────────────────────────────────────────
  const q = query.trim().toLowerCase()
  const matches = (label: string) => !q || label.toLowerCase().includes(q)

  const quickRows = [
    myUserId && {
      id: 'qf-mywork', label: 'My work',
      leading: <UserCheck className="h-3.5 w-3.5 text-gray-500" />,
      selected: myWorkActive, onToggle: toggleMyWork
    },
    {
      id: 'qf-flagged', label: 'Flagged',
      leading: <Flag className={clsx('h-3.5 w-3.5', filters.flaggedOnly ? 'text-amber-500 fill-amber-400' : 'text-gray-500')} />,
      selected: filters.flaggedOnly, onToggle: toggleFlagged
    },
    {
      id: 'qf-unassigned', label: 'Unassigned',
      leading: <UserX className="h-3.5 w-3.5 text-gray-500" />,
      selected: filters.unassignedOnly, onToggle: toggleUnassigned
    },
    {
      id: 'qf-duesoon', label: 'Due soon',
      leading: <CalendarClock className="h-3.5 w-3.5 text-gray-500" />,
      selected: filters.dueSoon, onToggle: toggleDueSoon
    }
  ].filter(Boolean) as Array<{
    id: string; label: string; leading: React.ReactNode; selected: boolean; onToggle: () => void
  }>

  const quickFiltered = quickRows.filter(r => matches(r.label))

  const memberRows = members
    .filter(m => !myUserId || m.user_id !== myUserId) // "My work" handles self
    .map(m => {
      const label = (m.first_name && m.last_name)
        ? `${m.first_name} ${m.last_name}`
        : (m.first_name ?? m.email ?? 'Unknown')
      const initials = ((m.first_name?.[0] ?? '') + (m.last_name?.[0] ?? '')).toUpperCase()
        || (m.email?.[0] ?? '?').toUpperCase()
      return {
        id: m.user_id, label,
        leading: (
          <div className="w-5 h-5 flex-shrink-0 rounded-full bg-primary-500 text-white flex items-center justify-center text-[9px] font-semibold">
            {initials}
          </div>
        ),
        selected: filters.assigneeIds.includes(m.user_id),
        onToggle: () => toggleAssignee(m.user_id)
      }
    })
    .filter(r => matches(r.label))

  const statusRows = statuses.map(s => ({
    id: s.id, label: s.name,
    leading: <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />,
    selected: filters.statusIds.includes(s.id),
    onToggle: () => toggleStatus(s.id)
  })).filter(r => matches(r.label))

  const tagRows = tags.map(t => ({
    id: t.id, label: t.name,
    leading: <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />,
    selected: filters.tagIds.includes(t.id),
    onToggle: () => toggleTag(t.id)
  })).filter(r => matches(r.label))

  const totalVisible = quickFiltered.length + memberRows.length + statusRows.length + tagRows.length

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* ── Primary trigger ────────────────────────────────────── */}
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className={clsx(
            'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border transition-colors',
            open
              ? 'bg-gray-100 text-gray-900 border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600'
              : hasAnyFilter
                ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800'
                : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:bg-gray-900 dark:border-gray-700 dark:hover:bg-gray-800'
          )}
        >
          <Filter className="h-3 w-3" />
          {hasAnyFilter ? (
            <>
              Filters
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary-500 text-white text-[10px] font-semibold">
                {activeCount}
              </span>
            </>
          ) : 'Filter'}
        </button>

        {hasAnyFilter && (
          <button
            onClick={(e) => { e.stopPropagation(); clearAll() }}
            className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 shadow-sm transition-colors"
            title="Clear all filters"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}

        {open && (
          <div
            className="absolute top-full left-0 mt-1.5 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col"
            style={{ maxHeight: '24rem' }}
          >
            {/* Search */}
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-gray-100 dark:border-gray-800">
              <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search filters…"
                className="flex-1 text-xs bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto py-1">
              {totalVisible === 0 ? (
                <div className="px-3 py-6 text-[11px] text-gray-400 text-center">
                  No matches for “{query}”
                </div>
              ) : (
                <>
                  {quickFiltered.length > 0 && (
                    <Section title="Quick filters">
                      {quickFiltered.map(r => (
                        <OptionRow key={r.id} {...r} />
                      ))}
                    </Section>
                  )}
                  {memberRows.length > 0 && (
                    <Section title="Assignee">
                      {memberRows.map(r => <OptionRow key={r.id} {...r} />)}
                    </Section>
                  )}
                  {statusRows.length > 0 && (
                    <Section title="Status">
                      {statusRows.map(r => <OptionRow key={r.id} {...r} />)}
                    </Section>
                  )}
                  {tagRows.length > 0 && (
                    <Section title="Tags">
                      {tagRows.map(r => <OptionRow key={r.id} {...r} />)}
                    </Section>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {hasAnyFilter && (
              <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/60">
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  {activeCount} active
                </span>
                <button
                  onClick={clearAll}
                  className="text-[11px] font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Applied pills (grouped) ────────────────────────────── */}
      {hasAnyFilter && (
        <>
          {myWorkActive && (
            <AppliedPill
              icon={<UserCheck className="h-3 w-3" />}
              label="My work"
              onRemove={toggleMyWork}
            />
          )}
          {filters.flaggedOnly && (
            <AppliedPill
              icon={<Flag className="h-3 w-3 fill-current" />}
              label="Flagged"
              onRemove={toggleFlagged}
            />
          )}
          {filters.unassignedOnly && (
            <AppliedPill
              icon={<UserX className="h-3 w-3" />}
              label="Unassigned"
              onRemove={toggleUnassigned}
            />
          )}
          {filters.dueSoon && (
            <AppliedPill
              icon={<CalendarClock className="h-3 w-3" />}
              label="Due soon"
              onRemove={toggleDueSoon}
            />
          )}

          {/* Specific assignees (excluding self if My work is on) */}
          <GroupPill
            visible={filters.assigneeIds.filter(id => id !== myUserId).length > 0}
            icon={<User className="h-3 w-3" />}
            label="Assignee"
            names={filters.assigneeIds
              .filter(id => id !== myUserId)
              .map(id => {
                const m = membersMap.get(id)
                return m
                  ? (m.first_name && m.last_name) ? `${m.first_name} ${m.last_name}` : (m.first_name ?? m.email ?? 'Unknown')
                  : '…'
              })}
            onRemoveAll={() => onChange({
              ...filters,
              assigneeIds: myUserId && filters.assigneeIds.includes(myUserId) ? [myUserId] : []
            })}
          />

          <GroupPill
            visible={filters.statusIds.length > 0}
            icon={<Circle className="h-3 w-3" />}
            label="Status"
            names={filters.statusIds.map(id => statusesMap.get(id)?.name ?? '…')}
            onRemoveAll={() => onChange({ ...filters, statusIds: [] })}
          />

          <GroupPill
            visible={filters.tagIds.length > 0}
            icon={<TagIcon className="h-3 w-3" />}
            label="Tags"
            names={filters.tagIds.map(id => tagsMap.get(id)?.name ?? '…')}
            onRemoveAll={() => onChange({ ...filters, tagIds: [] })}
          />
        </>
      )}
    </div>
  )
}

// ── Subcomponents ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {title}
      </div>
      {children}
    </div>
  )
}

function OptionRow({
  label, leading, selected, onToggle
}: {
  label: string
  leading: React.ReactNode
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={clsx(
        'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors',
        selected
          ? 'bg-primary-50 text-primary-900 dark:bg-primary-900/20 dark:text-primary-200'
          : 'text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'
      )}
    >
      {leading}
      <span className="flex-1 truncate">{label}</span>
      {selected && <Check className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />}
    </button>
  )
}

function AppliedPill({
  icon, label, onRemove
}: {
  icon: React.ReactNode
  label: string
  onRemove: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 text-[11px] font-medium rounded-full bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
      {icon}
      <span>{label}</span>
      <button
        onClick={onRemove}
        className="p-0.5 rounded hover:bg-primary-100 dark:hover:bg-primary-900/60"
        title={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function GroupPill({
  visible, icon, label, names, onRemoveAll
}: {
  visible: boolean
  icon: React.ReactNode
  label: string
  names: string[]
  onRemoveAll: () => void
}) {
  if (!visible) return null
  // Show up to 2 names inline, fold the rest into "+N"
  const MAX = 2
  const visibleNames = names.slice(0, MAX)
  const overflow = names.length - visibleNames.length
  const inline = visibleNames.join(', ') + (overflow > 0 ? ` +${overflow}` : '')
  return (
    <span
      className="inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 text-[11px] font-medium rounded-full bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
      title={`${label}: ${names.join(', ')}`}
    >
      {icon}
      <span className="max-w-[180px] truncate">
        <span className="text-primary-500/80 dark:text-primary-400/80">{label}:</span>{' '}{inline}
      </span>
      <button
        onClick={onRemoveAll}
        className="p-0.5 rounded hover:bg-primary-100 dark:hover:bg-primary-900/60"
        title={`Clear ${label.toLowerCase()}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
