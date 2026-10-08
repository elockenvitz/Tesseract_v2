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
import {
  LIST_SIGNAL_COLUMNS, listColumnPreset, renderSignalCell,
  LIST_COLUMN_PRESET_VERSION, listSortComparators,
} from './ListRowCells'
import { LIST_EXPANSION_ENTRY_COLUMNS, modeForEntryColumn } from './listRowModes'
import { useListRowSignals } from '../../hooks/lists/useListRowSignals'
import type { ListPermissions } from '../../hooks/lists/useListPermissions'
// Scoped under `.lists-surface` below — see the file header for why the table's
// visual language is overridden here rather than globally or by forking it.
import './lists-surface.css'

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

  /**
   * A security to open the list ON, and the field that states why.
   *
   * Set when the reader arrived from an attention row on Lists home. Forwarded
   * to the table as its initial expansion, so the row opens in the inspector
   * mode `MODE_FOR_COLUMN` gives that column — a decision opens Work, research
   * and an overdue review open Case. Applied once; after that the reader's own
   * clicks own the expansion.
   */
  focus?: { assetId?: string | null; columnId?: string | null } | null
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
  focus,
  // Pulled out of `passthrough` because the expansion needs it too — it is
  // still forwarded to the table below, so the row-menu entry is unchanged.
  onCreateTradeIdea,
  ...passthrough
}: ListTableViewProps) {

  // Per-row edit gate — mirrors canEditItemNotes for list-scoped fields.
  // In collaborative lists, only the contributor can edit their row; in
  // mutual lists any write-collaborator can edit. Screens force no edit.
  const canEditRow = useCallback((asset: any) => {
    if (hideListColumns) return false
    return permissions.canEditItemNotes({ added_by: asset._addedBy ?? null })
  }, [permissions, hideListColumns])

  // One read for the whole list — work state, position, sparkline, rating and
  // target. See `useListRowSignals`: nothing here may be per-row, because the
  // table is virtualised and a list can hold hundreds of names.
  const { signalFor } = useListRowSignals(assets)

  // Stable per `signalFor`, which is itself memoised on the batch — so the
  // table's filtered-list memo is not invalidated on every render.
  const extraSortComparators = useMemo(() => listSortComparators(signalFor), [signalFor])

  /**
   * How tall each inspector needs to be, by the mode its entry opens.
   *
   * Scaled off the density's own expanded height so Comfortable / Compact /
   * Ultra keep their relationship: a mode that needs 85% of the budget needs
   * 85% of it at every density. Module-level constants would have pinned one
   * density and squeezed the others.
   */
  const expandedHeightFor = useCallback((entry: string | undefined, density: string) => {
    const base = ({ comfortable: 340, compact: 320, ultra: 296, micro: 268 } as Record<string, number>)[density] ?? 320
    /*
     * Measured against real rows, not guessed.
     *
     * Only Work is reliably short: it is one headline, one metadata line and a
     * paragraph, and giving it the full budget left a third of the panel
     * empty. Everything else holds content whose length is the DATA's — a
     * holdings table with three books, a thesis somebody wrote at length — so
     * shrinking them buys dead space at the bottom in exchange for an inner
     * scrollbar, which is the worse trade.
     */
    /*
     * Market and Valuation get MORE than the budget, because a chart is the
     * one piece of content whose usefulness is a function of its height.
     *
     * Their panels are a single full-width interactive chart. At the shared
     * height the plot measured 1,074 × 139 on a 1,456px window — better than
     * 7:1, the aspect ratio of a banner, where a 3% move is a flat line and
     * the crosshair has no vertical room to resolve anything.
     *
     * Half again of vertical, with a wider rail taking width off the other
     * axis, brings the plot to roughly 4:1. That is still wide — a price
     * chart is a wide object — but it is the band where movement reads as
     * movement rather than as a horizon. Every other mode is text and
     * tables, which gain nothing from the extra and would show it as dead
     * space at the bottom.
     */
    const share: Record<string, number> = {
      overview: 1, case: 1, position: 1,
      market: 1.5,
      valuation: 1.45,
      work: 0.8,
    }
    const mode = modeForEntryColumn(entry)
    return Math.round(base * (share[mode] ?? 1))
  }, [])

  const renderExtraCell = useCallback((
    columnId: string,
    asset: any,
    // Resolved by the table for its own price cell; forwarded so MARKET and
    // VALUATION quote the same number the table does.
    quote?: { price?: number | null; changePercent?: number | null } | null,
  ) => {
    const rowId: string = asset._rowId || asset.id
    const canEdit = canEditRow(asset)

    // Investment-signal columns first: they apply to screens too, where the
    // list-scoped columns below are deliberately absent.
    const signalCell = renderSignalCell(columnId, asset, signalFor(asset.id), quote)
    if (signalCell !== undefined) return signalCell

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
  }, [listId, canEditRow, signalFor])

  const expandedRowSlot = useCallback((
    asset: any,
    rowId: string,
    // Already resolved by the table for the whole page — see `expandedRowSlot`
    // in AssetTableView. Passing it down avoids a per-row coverage read.
    coverage?: Array<{ analyst: string; team: string; isLead: boolean }>,
    entryColumnId?: string,
  ) => {
    return (
      <ListRowExpansion
        listId={listId}
        rowId={rowId}
        asset={asset}
        coverage={coverage}
        canEdit={canEditRow(asset)}
        // The field the reader clicked. See `listRowModes`.
        entryColumnId={entryColumnId}
        // Already batched for the whole list — the expansion reuses the same
        // sparkline and weight rather than issuing its own.
        signal={signalFor(asset.id)}
        onOpenAsset={onAssetSelect ? () => onAssetSelect(asset) : undefined}
        onCreateTradeIdea={onCreateTradeIdea}
      />
    )
  }, [listId, canEditRow, onAssetSelect, onCreateTradeIdea, signalFor])

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

  // Signal columns are about the security, so a screen gets them too. The
  // assignee/status/tags columns are about curating THIS list, which a
  // criteria-computed screen has no rows to curate.
  const extraColumns = useMemo(
    () => hideListColumns
      ? LIST_SIGNAL_COLUMNS
      : [...LIST_SIGNAL_COLUMNS, ...LIST_COLUMNS],
    [hideListColumns],
  )

  return (
    // The scope for `lists-surface.css`. Everything inside gets the Lists
    // typographic treatment; no other table moves.
    <div className="lists-surface flex-1 min-h-0 flex flex-col">
    <AssetTableView
      assets={assets}
      isLoading={isLoading}
      onAssetSelect={onAssetSelect}
      listId={listId}
      extraColumns={extraColumns}
      columnPreset={listColumnPreset}
      columnPresetVersion={LIST_COLUMN_PRESET_VERSION}
      expansionEntryColumns={LIST_EXPANSION_ENTRY_COLUMNS}
      // Arrived from an attention row on Lists home; see `focus` above.
      initialExpanded={focus?.assetId
        ? { assetId: focus.assetId, columnId: focus.columnId ?? undefined }
        : undefined}
      /*
       * Sized so the table survives the inspector.
       *
       * The inspector is a contextual surface unfolding from a row, not a
       * workspace — so the constraint that matters is how many SURROUNDING
       * securities stay on screen beside it. At 380 a 900px pane showed the
       * opened name and about two neighbours, which is not enough context to
       * compare against and is what made the expansion feel like a destination.
       *
       * 280-340 keeps roughly five or six rows visible around it, and every mode
       * scrolls its own regions rather than growing the row — the virtualiser
       * must know this height up front.
       */
      expandedRowHeights={{ comfortable: 340, compact: 320, ultra: 296, micro: 268 }}
      /*
       * Each mode gets the height ITS content needs.
       *
       * The virtualiser has to know a row's height before the inspector inside
       * it renders, so this cannot be measured — but the entry point already
       * names the mode, and each mode's shape is known. Giving all six the
       * tallest one's budget is what left Work and Position with a third of
       * their panel empty.
       *
       * The five-band strips (Overview, Case) need the most; Work and Position
       * lead with one figure and a paragraph and need the least.
       */
      expandedRowHeightFor={expandedHeightFor}
      // The identity cell carries the company under the ticker, which the
      // shared heights were not sized for — at 44px the second line clipped.
      // `micro` keeps the default: it hides the company anyway.
      rowHeights={{ comfortable: 62, compact: 52, ultra: 38 }}
      extraSortComparators={extraSortComparators}
      renderExtraCell={renderExtraCell}
      expandedRowSlot={expandedRowSlot}
      filterBarSlot={filterBarSlot}
      rowAccentFn={rowAccentFn}
      listStatusData={listStatuses}
      onCreateTradeIdea={onCreateTradeIdea}
      {...passthrough}
    />
    </div>
  )
}
