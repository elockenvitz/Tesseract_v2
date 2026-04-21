import React, { useState, useEffect } from 'react'
import { ExternalLink, Flag, Clock, Activity as ActivityIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow, format, parseISO } from 'date-fns'
import { ListAssigneeCell } from './ListAssigneeCell'
import { ListStatusCell } from './ListStatusCell'
import { ListTagsCell } from './ListTagsCell'
import { useUpdateListItem } from '../../hooks/lists/useUpdateListItem'
import { useListItemActivity, type ListItemActivity } from '../../hooks/lists/useListItemActivity'
import { describeActivity } from '../../lib/lists/describeActivity'

interface ListRowExpansionProps {
  listId: string
  rowId: string
  asset: any
  canEdit: boolean
  onOpenAsset?: () => void
}

export function ListRowExpansion({
  listId,
  rowId,
  asset,
  canEdit,
  onOpenAsset
}: ListRowExpansionProps) {
  const status = asset._status ?? null
  const assignee = asset._assignee ?? null
  const tags = asset._tags ?? []
  const dueDate: string | null = asset._dueDate ?? null
  const isFlagged: boolean = !!asset._isFlagged
  const listNote: string = asset._listNotes ?? ''

  const updateItem = useUpdateListItem(listId)

  // Local state for inputs; commit on blur to keep the cache calm
  const [dueDraft, setDueDraft] = useState(dueDate ?? '')
  const [noteDraft, setNoteDraft] = useState(listNote)
  useEffect(() => { setDueDraft(dueDate ?? '') }, [dueDate])
  useEffect(() => { setNoteDraft(listNote) }, [listNote])

  const handleDueCommit = () => {
    if ((dueDraft || null) !== dueDate) {
      updateItem.mutate({ itemId: rowId, updates: { due_date: dueDraft || null } })
    }
  }
  const handleNoteCommit = () => {
    if (noteDraft !== listNote) {
      updateItem.mutate({ itemId: rowId, updates: { notes: noteDraft } })
    }
  }
  const handleToggleFlag = () => {
    updateItem.mutate({ itemId: rowId, updates: { is_flagged: !isFlagged } })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Two-column body — main (case prose) + sidebar (metadata + activity) */}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_280px] gap-6 overflow-hidden">

        {/* ── Main: case content as readable prose ───────────────── */}
        <main className="min-w-0 overflow-y-auto pr-1">
          {/* Inline header: symbol + open case */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100 truncate">
                {asset.symbol}
              </span>
              {asset.company_name && (
                <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                  {asset.company_name}
                </span>
              )}
            </div>
            {onOpenAsset && (
              <button
                onClick={onOpenAsset}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:text-primary-700 hover:bg-primary-50 dark:hover:text-primary-300 dark:hover:bg-primary-900/20 rounded-md transition-colors flex-shrink-0"
              >
                Open case
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Case fields — readable prose, small-caps labels */}
          <div className="space-y-4">
            <CaseField label="Thesis" value={asset.thesis} />
            <CaseField label="Where different" value={asset.where_different} />
            <CaseField label="Quick note" value={asset.quick_note} />
            {Array.isArray(asset.price_targets) && asset.price_targets.length > 0 && (
              <div>
                <FieldLabel>Price targets</FieldLabel>
                <PriceTargetSummary targets={asset.price_targets} />
              </div>
            )}
          </div>
        </main>

        {/* ── Sidebar: list-scoped metadata + activity ───────────── */}
        <aside className="min-w-0 border-l border-gray-200 dark:border-gray-800 pl-6 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 space-y-3 pb-3">
            <SidebarRow label="Assignee">
              <ListAssigneeCell rowId={rowId} listId={listId} assignee={assignee} canEdit={canEdit} />
            </SidebarRow>

            <SidebarRow label="Status">
              <ListStatusCell rowId={rowId} listId={listId} status={status} canEdit={canEdit} />
            </SidebarRow>

            <SidebarRow label="Due">
              {canEdit ? (
                <input
                  type="date"
                  value={dueDraft}
                  onChange={(e) => setDueDraft(e.target.value)}
                  onBlur={handleDueCommit}
                  className="w-full text-xs px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              ) : (
                <DueDisplay dueDate={dueDate} />
              )}
            </SidebarRow>

            <SidebarRow label="Tags">
              <ListTagsCell rowId={rowId} listId={listId} tags={tags} canEdit={canEdit} />
            </SidebarRow>

            <SidebarRow label="Flag">
              <button
                onClick={canEdit ? handleToggleFlag : undefined}
                disabled={!canEdit}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors',
                  isFlagged
                    ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800',
                  !canEdit && 'cursor-default'
                )}
              >
                <Flag className={clsx('h-3 w-3', isFlagged && 'fill-current')} />
                {isFlagged ? 'Flagged' : 'Flag'}
              </button>
            </SidebarRow>

            <div>
              <FieldLabel>Note</FieldLabel>
              {canEdit ? (
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={handleNoteCommit}
                  placeholder="Short list-context note\u2026"
                  rows={2}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none leading-relaxed"
                />
              ) : (
                <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">
                  {listNote || <span className="text-gray-400">\u2014</span>}
                </div>
              )}
            </div>
          </div>

          {/* Activity below the metadata, scrolls with the sidebar */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-3 overflow-y-auto">
            <FieldLabel>
              <span className="inline-flex items-center gap-1">
                <ActivityIcon className="h-3 w-3" />
                Recent activity
              </span>
            </FieldLabel>
            <ActivityList listId={listId} assetId={asset.id} />
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── Building blocks ────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500 mb-1.5">
      {children}
    </div>
  )
}

function CaseField({ label, value }: { label: string; value: string | null | undefined }) {
  const text = (value ?? '').trim()
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {text ? (
        <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      ) : (
        <div className="text-xs text-gray-400 dark:text-gray-600 italic">Not set</div>
      )}
    </div>
  )
}

function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-16 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500 pt-1">
        {label}
      </div>
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}

function DueDisplay({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return <span className="text-xs text-gray-400">Not set</span>
  const d = parseISO(dueDate)
  return (
    <span className="text-xs text-gray-700 dark:text-gray-300">
      {format(d, 'MMM d, yyyy')}
    </span>
  )
}

function PriceTargetSummary({ targets }: { targets: any[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {targets.slice(0, 3).map((t, i) => (
        <span
          key={t.id ?? i}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700"
          title={t.rationale ?? undefined}
        >
          <span className="text-gray-400 uppercase text-[9px] tracking-wider">{t.target_type ?? 'target'}</span>
          {t.target_price != null && <span className="font-semibold tabular-nums">${t.target_price}</span>}
        </span>
      ))}
      {targets.length > 3 && (
        <span className="text-[10px] text-gray-400 self-center">+{targets.length - 3} more</span>
      )}
    </div>
  )
}

// ── Activity ────────────────────────────────────────────────────────────

function ActivityList({ listId, assetId }: { listId: string; assetId: string }) {
  const { data: activity = [], isLoading } = useListItemActivity(listId, assetId)

  if (isLoading) return <div className="text-xs text-gray-400">Loading\u2026</div>
  if (activity.length === 0) {
    return <div className="text-xs text-gray-400 dark:text-gray-600 italic">No changes yet</div>
  }

  return (
    <div className="space-y-2">
      {activity.slice(0, 8).map(a => <ActivityItem key={a.id} activity={a} />)}
    </div>
  )
}

function ActivityItem({ activity }: { activity: ListItemActivity }) {
  const actor = activity.actor
  const actorName = actor
    ? (actor.first_name && actor.last_name)
      ? `${actor.first_name} ${actor.last_name}`
      : actor.first_name ?? actor.email ?? 'Someone'
    : 'Someone'
  const verb = describeActivity(activity)
  const when = formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })

  return (
    <div className="flex items-start gap-1.5 text-[11px] leading-snug">
      <Clock className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-gray-800 dark:text-gray-200">{actorName}</span>{' '}
        <span className="text-gray-500 dark:text-gray-400">{verb}</span>
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{when}</div>
      </div>
    </div>
  )
}
