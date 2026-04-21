/**
 * ListTableView — list-dedicated table surface
 *
 * Thin wrapper around AssetTableView that injects list-specific concerns:
 *   • Assignee / Status / Tags columns (+ renderExtraCell dispatch)
 *   • Row expansion with case mirror + list-specific editors + activity
 *
 * All of AssetTableView's features (kanban, groups, AI columns, saved views,
 * virtualization, bulk actions) remain available. The list adds behavior via
 * the opt-in extension points; it does not re-implement the table.
 */

import React, { useMemo, useCallback } from 'react'
import { AssetTableView } from '../table/AssetTableView'
import { ListAssigneeCell } from './ListAssigneeCell'
import { ListStatusCell } from './ListStatusCell'
import { ListTagsCell } from './ListTagsCell'
import { ListRowExpansion } from './ListRowExpansion'
import type { ListPermissions } from '../../hooks/lists/useListPermissions'

interface ListTableViewProps {
  listId: string
  assets: any[] // mapped by ListTab with _rowId, _assignee, _status, _tags, etc.
  isLoading?: boolean
  permissions: ListPermissions
  onAssetSelect?: (asset: any) => void

  /** The list's status taxonomy — enables "By Status" grouping. */
  listStatuses?: { id: string; name: string; color: string; sort_order: number }[]

  // Pass-throughs forwarded to AssetTableView
  storageKey?: string
  fillHeight?: boolean
  onBulkAction?: (assetIds: string[]) => void
  bulkActionLabel?: string
  bulkActionIcon?: React.ReactNode
  onRemoveFromList?: (rowId: string) => void
  canRemoveRow?: (rowId: string) => boolean
  onUpdateListNote?: (rowId: string, note: string) => void
  existingAssetIds?: string[]
  listGroupData?: { id: string; name: string; color: string | null; sort_order: number }[]
  initialGroupBy?: any
  onReorderItem?: (fromIndex: number, toIndex: number) => void
  onMoveItemToGroup?: (assetId: string, groupId: string | null) => void
  onRenameGroup?: (groupId: string, name: string) => void
  onDeleteGroup?: (groupId: string) => void
  onCreateGroup?: (params: { name: string; color: string }) => void
  onCreateTradeIdea?: (assetId: string) => void
  kanbanBoards?: { id: string; name: string }[]
  activeKanbanBoardId?: string | null
  onSelectKanbanBoard?: (boardId: string | null) => void
  onCreateKanbanBoard?: (name: string) => Promise<{ id: string }>
  onDeleteKanbanBoard?: (boardId: string) => void
  onRenameKanbanBoard?: (boardId: string, name: string) => void
  kanbanBoardLanes?: { id: string; name: string; color: string; sort_order: number }[]
  kanbanBoardLaneItems?: { lane_id: string; asset_list_item_id: string }[]
  onCreateKanbanLane?: (name: string, color: string) => void
  onDeleteKanbanLane?: (laneId: string) => void
  onRenameKanbanLane?: (laneId: string, name: string) => void
  onAssignToKanbanLane?: (laneId: string, assetId: string) => void
  onRemoveFromKanbanLane?: (assetId: string) => void

  filterBarSlot?: React.ReactNode

  /**
   * Hide all list-scoped columns (Assignee / Status / Tags) and disable
   * per-row edit affordances. Used for screen lists where rows are
   * computed from criteria rather than curated, so list-scoped
   * attributes don't apply.
   */
  hideListColumns?: boolean
}

// ── List-scoped extra columns ──────────────────────────────────────────

const LIST_COLUMNS = [
  { id: 'list_assignee', label: 'Assignee', visible: true, width: 150, minWidth: 100, sortable: false, pinned: false, category: 'core' as const },
  { id: 'list_status',   label: 'Status',   visible: true, width: 130, minWidth: 90,  sortable: false, pinned: false, category: 'core' as const },
  { id: 'list_tags',     label: 'Tags',     visible: true, width: 200, minWidth: 120, sortable: false, pinned: false, category: 'core' as const }
]

// Statuses whose presence should visually mute ("finished") the row.
// Matched case-insensitively against status.name so teams with custom
// taxonomies still get sensible behavior.
const TERMINAL_STATUS_NAMES = new Set(['passed', 'rejected', 'archived', 'done', 'closed'])

// ── Main ───────────────────────────────────────────────────────────────

export function ListTableView({
  listId,
  assets,
  isLoading,
  permissions,
  onAssetSelect,
  filterBarSlot,
  listStatuses,
  hideListColumns,
  ...passthrough
}: ListTableViewProps) {

  // Per-row edit gate — mirrors canEditItemNotes for list-scoped fields.
  // In collaborative lists, only the contributor can edit their row; in
  // mutual lists any write-collaborator can edit. Screens force no edit.
  const canEditRow = useCallback((asset: any) => {
    if (hideListColumns) return false
    return permissions.canEditItemNotes({ added_by: asset._addedBy ?? null })
  }, [permissions, hideListColumns])

  const renderExtraCell = useCallback((columnId: string, asset: any) => {
    const rowId: string = asset._rowId || asset.id
    const canEdit = canEditRow(asset)

    switch (columnId) {
      case 'list_assignee':
        return (
          <ListAssigneeCell
            rowId={rowId}
            listId={listId}
            assignee={asset._assignee ?? null}
            canEdit={canEdit}
          />
        )
      case 'list_status':
        return (
          <ListStatusCell
            rowId={rowId}
            listId={listId}
            status={asset._status ?? null}
            canEdit={canEdit}
          />
        )
      case 'list_tags':
        return (
          <ListTagsCell
            rowId={rowId}
            listId={listId}
            tags={asset._tags ?? []}
            canEdit={canEdit}
          />
        )
      default:
        return null
    }
  }, [listId, canEditRow])

  const expandedRowSlot = useCallback((asset: any, rowId: string) => {
    return (
      <ListRowExpansion
        listId={listId}
        rowId={rowId}
        asset={asset}
        canEdit={canEditRow(asset)}
        onOpenAsset={onAssetSelect ? () => onAssetSelect(asset) : undefined}
      />
    )
  }, [listId, canEditRow, onAssetSelect])

  // Left-border accent colored by the row's status. Terminal statuses dim.
  const rowAccentFn = useCallback((asset: any): { color?: string | null; dim?: boolean } | null => {
    if (hideListColumns) return null
    const status = asset._status as { name?: string; color?: string } | null
    if (!status) return null
    const isTerminal = TERMINAL_STATUS_NAMES.has((status.name ?? '').toLowerCase())
    return {
      color: status.color ?? null,
      dim: isTerminal
    }
  }, [hideListColumns])

  const extraColumns = useMemo(() => hideListColumns ? [] : LIST_COLUMNS, [hideListColumns])

  return (
    <AssetTableView
      assets={assets}
      isLoading={isLoading}
      onAssetSelect={onAssetSelect}
      listId={listId}
      extraColumns={extraColumns}
      renderExtraCell={renderExtraCell}
      expandedRowSlot={expandedRowSlot}
      filterBarSlot={filterBarSlot}
      rowAccentFn={rowAccentFn}
      listStatusData={listStatuses}
      {...passthrough}
    />
  )
}
