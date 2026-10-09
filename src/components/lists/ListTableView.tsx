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
import { clsx } from 'clsx'
import { AssetTableView } from '../table/AssetTableView'
import { ListAssigneeCell } from './ListAssigneeCell'
import { ListStatusCell } from './ListStatusCell'
import { ListTagsCell } from './ListTagsCell'
import { ListRowExpansion, type ModeOverride } from './ListRowExpansion'
import { ListWorkspaceOverlay } from './ListWorkspaceOverlay'
import {
  LIST_SIGNAL_COLUMNS, renderSignalCell, listSortComparators,
} from './ListRowCells'
import {
  LIST_EXPANSION_ENTRY_COLUMNS, expandedRowHeightFor, modeForEntryColumn,
} from './listRowModes'
import { useListRowSignals } from '../../hooks/lists/useListRowSignals'
import { useListPriceHistory } from '../../hooks/lists/useListPriceHistory'
import {
  LIST_VIEWS, DEFAULT_LIST_VIEW, presetFor, storageKeyFor,
  LIST_COLUMN_PRESET_VERSION, type ListView,
} from './listViewPresets'
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
  /** Controlled preset, when the caller renders the switch itself. */
  view?: ListView
  onViewChange?: (v: ListView) => void
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

/**
 * The three readings of the list, as a segmented control.
 *
 * A tablist rather than a row of buttons: these are mutually exclusive views
 * of one thing, and the arrow-key behaviour a tablist gets for free is the
 * behaviour a reader expects from a segment. The hint under each label is
 * what the view ANSWERS — "what moved", "what we think", "what is owed" —
 * because the names alone do not distinguish Research from Decide for someone
 * seeing the surface for the first time.
 */
export function ListViewSwitch({ view, onChange }: { view: ListView; onChange: (v: ListView) => void }) {
  const ids = LIST_VIEWS.map(v => v.id)
  const move = (delta: number) => {
    const next = ids[(ids.indexOf(view) + delta + ids.length) % ids.length]
    onChange(next)
  }
  return (
    <div className="flex-shrink-0 px-1 pb-2">
      <div
        role="tablist"
        aria-label="List view"
        className="inline-flex gap-[2px] rounded-lg bg-gray-900/[0.055] p-[2.5px] dark:bg-black/30"
        onKeyDown={e => {
          if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
        }}
      >
        {LIST_VIEWS.map(v => {
          const on = v.id === view
          return (
            <button
              key={v.id}
              role="tab"
              aria-selected={on}
              // Only the active tab is in the tab order; the arrows move
              // between them. That is the tablist contract, and it stops a
              // three-stop detour on the way to the table.
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(v.id)}
              className={clsx(
                'rounded-md px-3.5 py-[5px] text-left leading-tight transition-colors duration-100',
                on
                  ? 'bg-white text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.12)] dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
              )}
            >
              <span className="block text-[12px] font-semibold tracking-[-0.005em]">{v.label}</span>
              <span className={clsx(
                'block text-[9.5px]',
                on ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400 dark:text-gray-500',
              )}>{v.hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

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
  // Destructured so the spread below cannot put the un-suffixed key back:
  // each preset persists its own layout. See `storageKeyFor`.
  storageKey,
  view: controlledView,
  onViewChange,
  ...passthrough
}: ListTableViewProps) {

  /*
   * Which reading of the list is on screen.
   *
   * A preset is a presentation choice over rows that are already loaded, so
   * switching must not remount the table, refetch anything, or disturb the
   * reader's scroll position and selection. All three views read the same
   * `signalFor` and the same `marketFor`. See `listViewPresets`.
   *
   * Controlled by `ListTab` where it supplies one, because the switcher
   * belongs on the command band beside the pulse rather than on a row of its
   * own — four stacked bands put ~200px of chrome above the first security.
   * Uncontrolled otherwise, so a caller that only wants the table still gets
   * a working switch.
   */
  const [ownView, setOwnView] = React.useState<ListView>(DEFAULT_LIST_VIEW)
  const view = controlledView ?? ownView
  const setView = onViewChange ?? setOwnView
  const viewPreset = useMemo(() => presetFor(view), [view])

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

  /*
   * Cached closes for the whole list in one batched read.
   *
   * `useListRowSignals` carries `closes` too, but those come from the
   * `yahoo-chart-proxy` edge function, which answers 502 in this deployment —
   * so the Market column had no series and no change at all. This reads
   * `price_history_cache`, the same table the opened inspector charts, so the
   * row and the panel below it cannot show different history.
   */
  const { marketFor } = useListPriceHistory(
    useMemo(() => assets.map(a => a?.symbol), [assets]),
  )

  /*
   * Which open row, if any, is filling the viewport.
   *
   * Held here rather than inside the expansion because the expansion is
   * virtualised: the table owns the row's lifetime, so the table owns the
   * question of whether that row is maximized. One at a time by construction —
   * it is a row id, not a set — which matches the table's own single-expansion
   * model and means there is no state to reconcile when the open row changes.
   *
   * It is deliberately NOT persisted. Maximizing is a momentary request for
   * room, not a preference; restoring a list into a modal nobody asked for
   * would hide the list the reader came back to.
   */
  const [maximizedRowId, setMaximizedRowId] = React.useState<string | null>(null)

  /*
   * The open row's tab choice, held above the thing that gets remounted.
   *
   * Maximizing re-parents the expansion into an overlay, and React remounts a
   * subtree whose depth changes — so a mode chosen in the row would be thrown
   * away by the act of asking for more room to look at it. Keyed by row id so
   * it cannot leak onto the next security the reader opens, and the entry
   * stamp inside the value does the rest (see `ModeOverride`).
   */
  const [modeOverride, setModeOverride] =
    React.useState<{ rowId: string; value: ModeOverride | null } | null>(null)

  // Stable per `signalFor`, which is itself memoised on the batch — so the
  // table's filtered-list memo is not invalidated on every render.
  // `marketFor` too, so Last / 1M / 6M / Trend sort by what they display
  // rather than by the dead proxy series `signal.closes` still carries.
  const extraSortComparators = useMemo(
    () => listSortComparators(signalFor, marketFor),
    [signalFor, marketFor],
  )

  /*
   * One frame for the inspector, whatever mode is showing — the entry is
   * deliberately ignored. See `expandedRowHeightForDensity`, which owns the
   * reasoning and the numbers.
   */
  /*
   * Each mode gets the height its content needs.
   *
   * The entry the table hands in resolves to the mode on screen — the panel
   * echoes its own state back through `onEntryChange`, so this follows a tab
   * switch as well as a cell click. See `expandedRowHeightFor`.
   */
  const expandedHeightFor = useCallback(
    (entry: string | undefined, density: string) =>
      expandedRowHeightFor(modeForEntryColumn(entry), density),
    [],
  )

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
    const signalCell = renderSignalCell(
      columnId, asset, signalFor(asset.id), quote,
      marketFor(asset.symbol),
    )
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
  }, [listId, canEditRow, signalFor, marketFor])

  const expandedRowSlot = useCallback((
    asset: any,
    rowId: string,
    // Already resolved by the table for the whole page — see `expandedRowSlot`
    // in AssetTableView. Passing it down avoids a per-row coverage read.
    coverage?: Array<{ analyst: string; team: string; isLead: boolean }>,
    entryColumnId?: string,
    // Lets the inspector restate its entry when the reader switches mode, so
    // the row re-measures. See `onEntryChange` in AssetTableView.
    onEntryChange?: (entryColumnId: string) => void,
    // The table's own resolved quote. The inspector quotes THIS, so the open
    // panel and the row above it can never state two different prices.
    quote?: { price?: number | null; changePercent?: number | null } | null,
  ) => {
    const isMax = maximizedRowId === rowId
    const panel = (
      <ListRowExpansion
        listId={listId}
        rowId={rowId}
        asset={asset}
        coverage={coverage}
        quote={quote}
        canEdit={canEditRow(asset)}
        // The field the reader clicked. See `listRowModes`.
        entryColumnId={entryColumnId}
        onEntryChange={onEntryChange}
        // Already batched for the whole list — the expansion reuses the same
        // sparkline and weight rather than issuing its own.
        signal={signalFor(asset.id)}
        onOpenAsset={onAssetSelect ? () => onAssetSelect(asset) : undefined}
        onCreateTradeIdea={onCreateTradeIdea}
        maximized={isMax}
        onToggleMaximize={() => setMaximizedRowId(cur => (cur === rowId ? null : rowId))}
        modeOverride={modeOverride?.rowId === rowId ? modeOverride.value : null}
        onModeOverride={next => setModeOverride({ rowId, value: next })}
      />
    )

    if (!isMax) return panel

    /*
     * Maximized: the same COMPONENT, re-parented into a full-viewport shell.
     *
     * Not a second workspace — `panel` above is built once and used by both
     * branches, so the overlay shows the same five modes, the same hooks, the
     * same canonical actions and the same permission checks. The expansion
     * does remount on the way in (the depth changes); that is why the mode
     * override is held up here rather than inside it.
     *
     * The row keeps its slot and its height — the placeholder below holds it
     * open — so the list underneath is untouched: same preset, same filters,
     * same selection, same scroll offset to come back to.
     */
    return (
      <>
        <div
          aria-hidden
          data-testid="expansion-placeholder"
          className="flex h-full items-center justify-center text-[12px] text-gray-400 dark:text-gray-500"
        >
          {asset.symbol} is open in the maximized workspace
        </div>
        <ListWorkspaceOverlay
          label={asset.symbol}
          onClose={() => setMaximizedRowId(null)}
        >
          {panel}
        </ListWorkspaceOverlay>
      </>
    )
  }, [listId, canEditRow, onAssetSelect, onCreateTradeIdea, signalFor, maximizedRowId, modeOverride])

  /**
   * The attention rail: one 3px mark at the left edge of a row.
   *
   * ── Why attention outranks the list's own status ──────────────────────
   *
   * This accent used to be coloured by `_status`, the curation state of the
   * row within this list. That is real, but it is a fact about the LIST, and
   * the question a reader scans a watchlist to answer is a fact about the
   * SECURITY: is something owed on this name. A rail that lights up for
   * "In progress" and stays dark for "a PM owes a decision" points the eye
   * at the wrong rows.
   *
   * Two tiers only, and no third:
   *   • a decision is owed      amber
   *   • unreviewed research     blue
   *   • everything else         no rail
   *
   * Three colours would be a legend; two are a glance. Everything quieter
   * than those is carried by the Attention column's own words, and a name
   * with nothing outstanding gets no mark at all — which is what makes the
   * marked ones findable. `work.tier` is the same ranking the Work column
   * and its comparator already use, so the rail cannot disagree with the
   * cell beside it.
   *
   * Terminal list statuses still dim the row: that one IS about the list,
   * and dimming is a different channel from the rail.
   */
  const rowAccentFn = useCallback((asset: any): { color?: string | null; dim?: boolean } | null => {
    if (hideListColumns) return null
    const status = asset._status as { name?: string; color?: string } | null
    const dim = !!status && TERMINAL_STATUS_NAMES.has((status.name ?? '').toLowerCase())

    const tier = signalFor(asset.id).work.tier
    const color = tier === 'decision'
      ? 'rgb(217 119 6)'
      : tier === 'evidence'
        ? 'rgb(37 99 235)'
        : null

    if (!color && !dim) return null
    return { color, dim }
  }, [hideListColumns, signalFor])

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
    {/* Only when uncontrolled. `ListTab` renders it on the command band. */}
    {controlledView === undefined && <ListViewSwitch view={view} onChange={setView} />}
    <AssetTableView
      assets={assets}
      isLoading={isLoading}
      onAssetSelect={onAssetSelect}
      listId={listId}
      extraColumns={extraColumns}
      columnPreset={viewPreset}
      columnPresetVersion={LIST_COLUMN_PRESET_VERSION}
      /*
       * One saved layout per view, keyed through `storageKeyFor`.
       *
       * Changing the key is what makes a preset switch instant AND
       * non-destructive: each view merges against its own saved state rather
       * than three views fighting over one blob. Monitor keeps the original
       * unsuffixed key, so layouts saved before presets existed survive.
       */
      storageKey={storageKeyFor(storageKey, view)}
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
      /*
       * ~44px, which is the V2 line.
       *
       * These were 62 / 52 / 38 and they OVERRIDE `DENSITY_CONFIG`, whose
       * compact row is already 44 — so the surface shipped a 62px row while
       * the density control said Compact, and about nine names fitted where
       * fourteen should. A watchlist is read by scanning, and scanning is a
       * function of how many rows are on screen.
       *
       * Two lines of identity need ~34px of content, so the floor is set by
       * the vertical padding, which `lists-surface.css` tightens to match.
       */
      rowHeights={{ comfortable: 44, compact: 38, ultra: 32, micro: 26 }}
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
