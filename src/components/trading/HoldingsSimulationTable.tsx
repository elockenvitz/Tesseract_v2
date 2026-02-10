/**
 * Holdings Simulation Table (Trade Lab v3)
 *
 * Keyboard-driven spreadsheet-style table with sortable columns and
 * per-column search filters. Arrow keys move cell-by-cell,
 * Enter activates the focused cell, Escape exits editing, Delete removes trade.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect, type ChangeEvent } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, FileText, Info, Plus, Search, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { SimulationRow, SimulationRowSummary } from '../../hooks/useSimulationRows'
import type { TradeAction } from '../../types/trading'

// =============================================================================
// CONSTANTS
// =============================================================================

const ACTION_BG: Record<TradeAction, string> = {
  buy:  'bg-emerald-500 text-white',
  add:  'bg-emerald-500/80 text-white',
  sell: 'bg-red-500 text-white',
  trim: 'bg-red-500/80 text-white',
}

const ACTION_BORDER: Record<TradeAction, string> = {
  buy:  'border-l-emerald-500',
  add:  'border-l-emerald-400',
  sell: 'border-l-red-500',
  trim: 'border-l-red-400',
}

/** Specific badge label based on action + whether position exists in portfolio */
function actionLabel(action: TradeAction, isNew: boolean, isRemoved: boolean): string {
  switch (action) {
    case 'buy':  return 'BUY NEW'
    case 'add':  return 'BUY ADD'
    case 'sell': return isNew ? 'SELL SHORT' : 'SELL ALL'
    case 'trim': return isRemoved ? 'SELL ALL' : 'SELL TRIM'
  }
}

const COL = {
  SYMBOL: 0,
  NAME: 1,
  SHARES: 2,
  WEIGHT: 3,
  BENCH: 4,
  ACTIVE: 5,
  SIM_WT: 6,
  SIM_SHARES: 7,
  DELTA_WT: 8,
  DELTA_SHARES: 9,
  DELTA_NOTIONAL: 10,
} as const

type ColKey = keyof typeof COL

const COL_COUNT = 11

type GroupBy = 'none' | 'sector' | 'action' | 'change'
type SortDir = 'asc' | 'desc' | null

// Alternating row colors
const ROW_EVEN = 'bg-gray-50/70 dark:bg-gray-800/30'
const ROW_ODD = ''

const CELL_FOCUS = 'bg-primary-50/70 dark:bg-primary-900/20 outline outline-[1.5px] -outline-offset-[1.5px] outline-primary-400/60 dark:outline-primary-500/50 rounded-sm'

// =============================================================================
// COLUMN DEFINITIONS
// =============================================================================

interface ColDef {
  key: ColKey
  label: string
  align: 'left' | 'right'
  sortable: boolean
  filterable: boolean
  width?: string
}

const COLUMNS: ColDef[] = [
  { key: 'SYMBOL',        label: 'Symbol',    align: 'left',  sortable: true,  filterable: true, width: 'w-0' },
  { key: 'NAME',          label: 'Name',      align: 'left',  sortable: true,  filterable: true },
  { key: 'SHARES',        label: 'Shares',    align: 'right', sortable: true,  filterable: true },
  { key: 'WEIGHT',        label: 'Wt%',       align: 'right', sortable: true,  filterable: true },
  { key: 'BENCH',         label: 'Bench',     align: 'right', sortable: true,  filterable: true },
  { key: 'ACTIVE',        label: 'Active',    align: 'right', sortable: true,  filterable: true },
  { key: 'SIM_WT',        label: 'Sim Wt',    align: 'right', sortable: true,  filterable: true },
  { key: 'SIM_SHARES',    label: 'Sim Shrs',  align: 'right', sortable: true,  filterable: true },
  { key: 'DELTA_WT',      label: 'Δ Wt',      align: 'right', sortable: true,  filterable: true },
  { key: 'DELTA_SHARES',  label: 'Δ Shrs',    align: 'right', sortable: true,  filterable: true },
  { key: 'DELTA_NOTIONAL', label: 'Δ $',      align: 'right', sortable: true,  filterable: true },
]

// =============================================================================
// HELPERS
// =============================================================================

function fmtNotional(v: number): string {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtWt(v: number, signed = false): string {
  if (signed) return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  return `${v.toFixed(2)}%`
}

function fmtShares(v: number, signed = false): string {
  const a = Math.abs(v)
  const n = a >= 1000 ? a.toLocaleString() : a.toString()
  if (!signed) return n
  if (v > 0) return `+${n}`
  if (v < 0) return `-${n}`
  return n
}

function getGroupKey(row: SimulationRow, g: GroupBy): string {
  switch (g) {
    case 'sector': return row.sector || 'Other'
    case 'action': {
      if (row.isNew) return 'New Positions'
      if (row.isRemoved) return 'Sold'
      if (row.variant) return row.derivedAction === 'buy' || row.derivedAction === 'add' ? 'Adding' : 'Trimming'
      return 'Unchanged'
    }
    case 'change': {
      if (row.isRemoved || row.deltaWeight < -1) return 'Decreasing (>1%)'
      if (row.deltaWeight < -0.1) return 'Slightly Decreasing'
      if (row.deltaWeight > 1) return 'Increasing (>1%)'
      if (row.deltaWeight > 0.1) return 'Slightly Increasing'
      return 'No Change'
    }
    default: return 'All'
  }
}

const dc = (v: number) => v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'

/** Get the sortable numeric/string value for a row+column */
function getSortValue(row: SimulationRow, col: ColKey): string | number {
  switch (col) {
    case 'SYMBOL': return row.symbol.toLowerCase()
    case 'NAME': return row.company_name.toLowerCase()
    case 'SHARES': return row.currentShares
    case 'WEIGHT': return row.currentWeight
    case 'BENCH': return row.benchWeight ?? -Infinity
    case 'ACTIVE': return row.activeWeight ?? -Infinity
    case 'SIM_WT': return row.simWeight
    case 'SIM_SHARES': return row.simShares
    case 'DELTA_WT': return row.deltaWeight
    case 'DELTA_SHARES': return row.deltaShares
    case 'DELTA_NOTIONAL': return row.notional
  }
}

/** Get the filterable text value for a row+column */
function getFilterValue(row: SimulationRow, col: ColKey): string {
  switch (col) {
    case 'SYMBOL': return row.symbol
    case 'NAME': return row.company_name
    case 'SHARES': return row.isNew ? 'new' : row.currentShares.toString()
    case 'WEIGHT': return row.isNew ? '' : fmtWt(row.currentWeight)
    case 'BENCH': return row.benchWeight !== null ? fmtWt(row.benchWeight) : ''
    case 'ACTIVE': return row.activeWeight !== null ? fmtWt(row.activeWeight, true) : ''
    case 'SIM_WT': return row.variant?.sizing_input || fmtWt(row.simWeight)
    case 'SIM_SHARES': return row.computed ? row.simShares.toString() : ''
    case 'DELTA_WT': return row.deltaWeight !== 0 ? fmtWt(row.deltaWeight, true) : ''
    case 'DELTA_SHARES': return row.deltaShares !== 0 ? row.deltaShares.toString() : ''
    case 'DELTA_NOTIONAL': return row.notional > 0 ? fmtNotional(row.notional) : ''
  }
}

// =============================================================================
// TYPES
// =============================================================================

export interface HoldingsSimulationTableProps {
  rows: SimulationRow[]
  tradedRows: SimulationRow[]
  untradedRows: SimulationRow[]
  newPositionRows: SimulationRow[]
  summary: SimulationRowSummary
  portfolioTotalValue: number
  hasBenchmark: boolean
  priceMap: Record<string, number>
  onUpdateVariant: (variantId: string, updates: { action?: TradeAction; sizingInput?: string }) => void
  onDeleteVariant: (variantId: string) => void
  onCreateVariant: (assetId: string, action: TradeAction) => void
  onFixConflict: (variantId: string, suggestedAction: TradeAction) => void
  onAddAsset: (asset: { id: string; symbol: string; company_name: string; sector: string | null }) => void
  assetSearchResults?: { id: string; symbol: string; company_name: string; sector: string | null }[]
  onAssetSearchChange?: (query: string) => void
  onCreateTradeSheet?: () => void
  canCreateTradeSheet?: boolean
  isCreatingTradeSheet?: boolean
  groupBy?: GroupBy
  onGroupByChange?: (groupBy: GroupBy) => void
  className?: string
}

// =============================================================================
// CELL STYLE CONSTANTS
// =============================================================================

const NUM = 'text-[13px] tabular-nums'
const DIM = `${NUM} text-gray-400 dark:text-gray-500`

// =============================================================================
// TABLE ROW
// =============================================================================

function HoldingRow({
  row, rowIndex, isEven, focusedCol, isEditing,
  onUpdateVariant, onFocusCell, onStartEdit, onStopEdit, onCreateVariantAndEdit, rowRef,
}: {
  row: SimulationRow
  rowIndex: number
  isEven: boolean
  focusedCol: number | null
  isEditing: boolean
  onUpdateVariant: (variantId: string, updates: { action?: TradeAction; sizingInput?: string }) => void
  onFocusCell: (row: number, col: number) => void
  onStartEdit: () => void
  onStopEdit: (committedValue?: string) => void
  onCreateVariantAndEdit: (assetId: string, col?: number) => void
  rowRef: (el: HTMLTableRowElement | null) => void
}) {
  const v = row.variant
  const isFocused = focusedCol !== null
  const hasSizing = !!v?.sizing_input && (Math.abs(row.deltaWeight) >= 0.005 || Math.abs(row.deltaShares) >= 0.5)
  const action = row.derivedAction

  // Local edit state — avoids server round-trip on every keystroke
  const [editValue, setEditValue] = useState('')
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (isEditing) {
      const raw = v?.sizing_input || ''
      const isSharesInput = raw.trim().startsWith('#')
      if (focusedCol === COL.SIM_SHARES && raw && !isSharesInput) {
        // Editing shares column but input is weight-based → show shares equivalent
        setEditValue(`#${row.simShares}`)
      } else if (focusedCol === COL.SIM_WT && raw && isSharesInput) {
        // Editing weight column but input is shares-based → show weight equivalent
        setEditValue(row.simWeight.toFixed(2))
      } else {
        setEditValue(raw)
      }
      cancelledRef.current = false
    }
  }, [isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  const cf = (col: number) => focusedCol === col ? CELL_FOCUS : ''

  const handleEditBlur = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false
      onStopEdit() // No value → parent may cleanup empty variant
      return
    }
    const trimmed = editValue.trim()
    if (trimmed && v) {
      onUpdateVariant(v.id, { sizingInput: trimmed })
    }
    onStopEdit(trimmed || undefined)
  }

  const sizingEditor = () => (
    <input
      type="text"
      autoFocus
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={handleEditBlur}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') { cancelledRef.current = true; e.currentTarget.blur() }
        else if (e.key === 'Enter') e.currentTarget.blur()
      }}
      placeholder={focusedCol === COL.SIM_SHARES ? '#500' : '2.5'}
      className="w-20 h-6 text-[13px] font-mono tabular-nums text-right px-1.5 rounded border border-primary-400 dark:border-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-400"
    />
  )

  const simWtContent = () => {
    if (!v) {
      return (
        <span className={clsx(DIM, 'group-hover/row:text-gray-500 dark:group-hover/row:text-gray-400 transition-colors')}>
          {fmtWt(row.currentWeight)}
        </span>
      )
    }

    if (isEditing && focusedCol === COL.SIM_WT) return sizingEditor()

    if (v.sizing_input) {
      return <span className={clsx(NUM, hasSizing ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500')}>{fmtWt(row.simWeight)}</span>
    }

    return (
      <span className="text-[13px] text-gray-300 dark:text-gray-600 italic">
        enter size
      </span>
    )
  }

  const simSharesContent = () => {
    if (!v) {
      return (
        <span className={clsx(DIM, 'group-hover/row:text-gray-500 dark:group-hover/row:text-gray-400 transition-colors')}>
          {fmtShares(row.currentShares)}
        </span>
      )
    }

    if (isEditing && focusedCol === COL.SIM_SHARES) return sizingEditor()

    if (v.sizing_input) {
      return <span className={clsx(NUM, hasSizing ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500')}>{fmtShares(row.simShares)}</span>
    }

    return (
      <span className="text-[13px] text-gray-300 dark:text-gray-600 italic">
        enter size
      </span>
    )
  }

  const leftBorder = hasSizing && v
    ? `border-l-2 ${ACTION_BORDER[action]}`
    : 'border-l-2 border-l-transparent'

  return (
    <tr
      ref={rowRef}
      className={clsx(
        'group/row transition-colors duration-75',
        isEven ? ROW_EVEN : ROW_ODD,
        row.isNew && !isFocused && (v?.action === 'sell' || v?.action === 'trim'
          ? '!bg-red-50/40 dark:!bg-red-950/10'
          : '!bg-emerald-50/40 dark:!bg-emerald-950/10'),
        row.isRemoved && '!bg-red-50/40 dark:!bg-red-950/10 opacity-50',
        !isFocused && 'hover:!bg-gray-100/70 dark:hover:!bg-white/[0.04]',
        isFocused && '!bg-primary-50/40 dark:!bg-primary-950/10',
      )}
    >
      {/* SYMBOL */}
      <td
        className={clsx('pl-3 pr-2 py-1.5 whitespace-nowrap', leftBorder, cf(COL.SYMBOL))}
        onClick={() => onFocusCell(rowIndex, COL.SYMBOL)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">
            {row.symbol}
          </span>
          {hasSizing && v && (
            <span
              className={clsx(
                'flex-shrink-0 px-1.5 py-px rounded-full text-[8px] font-bold uppercase tracking-wide text-center select-none shadow-sm whitespace-nowrap',
                ACTION_BG[action],
              )}
            >{actionLabel(action, row.isNew, row.isRemoved)}</span>
          )}
        </div>
      </td>

      {/* NAME */}
      <td className={clsx('px-2 py-1.5 whitespace-nowrap', cf(COL.NAME))} onClick={() => onFocusCell(rowIndex, COL.NAME)}>
        <span className="text-[12px] text-gray-500 dark:text-gray-400 truncate block max-w-[180px]">
          {row.company_name}
        </span>
      </td>

      {/* SHARES */}
      <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cf(COL.SHARES))} onClick={() => onFocusCell(rowIndex, COL.SHARES)}>
        <span className={DIM}>{fmtShares(row.currentShares)}</span>
      </td>

      {/* WEIGHT */}
      <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cf(COL.WEIGHT))} onClick={() => onFocusCell(rowIndex, COL.WEIGHT)}>
        <span className={DIM}>{fmtWt(row.currentWeight)}</span>
      </td>

      {/* BENCH */}
      <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cf(COL.BENCH))} onClick={() => onFocusCell(rowIndex, COL.BENCH)}>
        <span className={DIM}>{fmtWt(row.benchWeight ?? 0)}</span>
      </td>

      {/* ACTIVE */}
      <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cf(COL.ACTIVE))} onClick={() => onFocusCell(rowIndex, COL.ACTIVE)}>
        <span className={clsx(DIM)}>{fmtWt(row.activeWeight ?? 0, true)}</span>
      </td>

      {/* SIM WEIGHT */}
      <td
        className={clsx(
          'px-2 py-1.5 text-right whitespace-nowrap cursor-text',
          cf(COL.SIM_WT),
          !v && !isFocused && 'group-hover/row:[&_span]:underline group-hover/row:[&_span]:decoration-dashed group-hover/row:[&_span]:decoration-gray-300 dark:group-hover/row:[&_span]:decoration-gray-600 group-hover/row:[&_span]:underline-offset-2',
        )}
        onClick={() => {
          onFocusCell(rowIndex, COL.SIM_WT)
          if (v) onStartEdit()
          else onCreateVariantAndEdit(row.asset_id, COL.SIM_WT)
        }}
      >{simWtContent()}</td>

      {/* SIM SHARES */}
      <td
        className={clsx(
          'px-2 py-1.5 text-right whitespace-nowrap cursor-text',
          cf(COL.SIM_SHARES),
          !v && !isFocused && 'group-hover/row:[&_span]:underline group-hover/row:[&_span]:decoration-dashed group-hover/row:[&_span]:decoration-gray-300 dark:group-hover/row:[&_span]:decoration-gray-600 group-hover/row:[&_span]:underline-offset-2',
        )}
        onClick={() => {
          onFocusCell(rowIndex, COL.SIM_SHARES)
          if (v) onStartEdit()
          else onCreateVariantAndEdit(row.asset_id, COL.SIM_SHARES)
        }}
      >{simSharesContent()}</td>

      {/* Δ WT */}
      <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cf(COL.DELTA_WT))} onClick={() => onFocusCell(rowIndex, COL.DELTA_WT)}>
        <span className={clsx(NUM, row.deltaWeight !== 0 ? clsx('font-medium', dc(row.deltaWeight)) : 'text-gray-400 dark:text-gray-500')}>
          {fmtWt(row.deltaWeight, true)}
        </span>
      </td>

      {/* Δ SHARES */}
      <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cf(COL.DELTA_SHARES))} onClick={() => onFocusCell(rowIndex, COL.DELTA_SHARES)}>
        <span className={clsx(NUM, row.deltaShares !== 0 ? clsx('font-medium', dc(row.deltaShares)) : 'text-gray-400 dark:text-gray-500')}>
          {fmtShares(row.deltaShares, true)}
        </span>
      </td>

      {/* Δ NOTIONAL */}
      <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cf(COL.DELTA_NOTIONAL))} onClick={() => onFocusCell(rowIndex, COL.DELTA_NOTIONAL)}>
        <span className={clsx(NUM, row.notional !== 0 ? clsx('font-medium', dc(row.notional)) : 'text-gray-400 dark:text-gray-500')}>
          {row.notional !== 0 ? fmtNotional(row.notional) : '$0'}
        </span>
      </td>
    </tr>
  )
}

// =============================================================================
// GROUP HEADER
// =============================================================================

function GroupHeaderRow({ groupName, count, totalWeight, isCollapsed, onToggle }: {
  groupName: string; count: number; totalWeight: number; isCollapsed: boolean; onToggle: () => void
}) {
  return (
    <tr className="bg-gray-100/80 dark:bg-gray-800/60 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-75" onClick={onToggle}>
      <td className="px-3 py-1" colSpan={COL_COUNT}>
        <div className="flex items-center gap-2">
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
          <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">{groupName}</span>
          <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{count} &middot; {totalWeight.toFixed(1)}%</span>
        </div>
      </td>
    </tr>
  )
}

// =============================================================================
// PHANTOM ROW (inline asset search for Add Trade)
// =============================================================================

function PhantomRow({
  search, onSearchChange, results, highlightIndex, onHighlightChange,
  onSelect, onClose, inputRef,
}: {
  search: string
  onSearchChange: (v: string) => void
  results: { id: string; symbol: string; company_name: string; sector: string | null }[]
  highlightIndex: number
  onHighlightChange: (i: number) => void
  onSelect: (asset: { id: string; symbol: string; company_name: string; sector: string | null }) => void
  onClose: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  return (
    <tr className="bg-primary-50/30 dark:bg-primary-950/10 border-t border-dashed border-primary-300 dark:border-primary-700">
      <td className="pl-3 pr-2 py-1.5 border-l-2 border-l-primary-400" colSpan={2}>
        <div className="relative">
          <div className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                onSearchChange(e.target.value)
                onHighlightChange(0)
              }}
              onBlur={(e) => {
                // Don't close if clicking within the dropdown
                if (dropdownRef.current?.contains(e.relatedTarget as Node)) return
                // Small delay to allow click events on dropdown items
                setTimeout(() => {
                  if (!dropdownRef.current?.contains(document.activeElement)) onClose()
                }, 150)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') { onClose(); return }
                if (e.key === 'ArrowDown') { e.preventDefault(); onHighlightChange(Math.min(highlightIndex + 1, results.length - 1)); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); onHighlightChange(Math.max(highlightIndex - 1, 0)); return }
                if (e.key === 'Enter' && results.length > 0) {
                  e.preventDefault()
                  onSelect(results[highlightIndex])
                }
              }}
              placeholder="Search ticker or name..."
              className="w-full text-[13px] px-1.5 py-0.5 rounded border border-primary-300 dark:border-primary-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-400 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>

          {/* Dropdown */}
          {search.length >= 1 && results.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-[280px] overflow-y-auto"
            >
              {results.map((asset, i) => (
                <button
                  key={asset.id}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(asset)}
                  onMouseEnter={() => onHighlightChange(i)}
                  className={clsx(
                    'w-full text-left px-3 py-2 flex items-center gap-2 transition-colors text-[13px]',
                    i === highlightIndex
                      ? 'bg-primary-50 dark:bg-primary-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
                    i > 0 && 'border-t border-gray-100 dark:border-gray-700/50',
                  )}
                >
                  <span className="font-semibold text-gray-900 dark:text-white min-w-[4rem]">{asset.symbol}</span>
                  <span className="text-gray-500 dark:text-gray-400 truncate text-[12px]">{asset.company_name}</span>
                  {asset.sector && (
                    <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">{asset.sector}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* No results message */}
          {search.length >= 2 && results.length === 0 && (
            <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 px-3 py-3 text-[12px] text-gray-400 dark:text-gray-500">
              No assets found for &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      </td>
      {/* Empty cells for remaining columns */}
      <td colSpan={COL_COUNT - 2} className="px-2 py-1.5">
        <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">Type to search...</span>
      </td>
    </tr>
  )
}

// =============================================================================
// SORT ICON
// =============================================================================

function SortIcon({ dir, className }: { dir: SortDir; className?: string }) {
  const base = clsx('w-3 h-3 flex-shrink-0', className)
  if (dir === 'asc') return <ArrowUp className={clsx(base, 'text-primary-500')} />
  if (dir === 'desc') return <ArrowDown className={clsx(base, 'text-primary-500')} />
  return <ArrowUpDown className={clsx(base, 'text-gray-300 dark:text-gray-600 opacity-0 group-hover/th:opacity-100 transition-opacity')} />
}

// =============================================================================
// SUMMARY PANEL (bottom bar, expandable)
// =============================================================================

function SummaryPanel({ summary, tradedRows, onAddTrade: onShowPhantom, onCreateTradeSheet, canCreateTradeSheet, isCreatingTradeSheet }: {
  summary: SimulationRowSummary
  tradedRows: SimulationRow[]
  onAddTrade: () => void
  onCreateTradeSheet?: () => void
  canCreateTradeSheet?: boolean
  isCreatingTradeSheet?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const buys = tradedRows.filter(r => r.derivedAction === 'buy' || r.derivedAction === 'add')
  const sells = tradedRows.filter(r => r.derivedAction === 'sell' || r.derivedAction === 'trim')

  return (
    <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-3 py-2">
        <button onClick={onShowPhantom} tabIndex={-1}
          className="inline-flex items-center gap-1 text-[11px] text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-semibold transition-colors"
        ><Plus className="w-3 h-3" />Add Trade</button>

        <div className="h-3 w-px bg-gray-300 dark:bg-gray-600" />

        <div className="flex items-center gap-3 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
          <span><span className="font-medium text-gray-700 dark:text-gray-300">{summary.totalPositions}</span> positions</span>
          {summary.tradedCount > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              <span><span className="font-medium text-emerald-600 dark:text-emerald-400">{buys.length}</span> buy{buys.length !== 1 ? 's' : ''}</span>
              <span><span className="font-medium text-red-600 dark:text-red-400">{sells.length}</span> sell{sells.length !== 1 ? 's' : ''}</span>
              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              <span>Δ wt <span className={clsx('font-medium', summary.netDeltaWeight !== 0 ? dc(summary.netDeltaWeight) : '')}>{fmtWt(summary.netDeltaWeight, true)}</span></span>
              <span>notional <span className="font-medium text-gray-700 dark:text-gray-300">{fmtNotional(summary.totalNotional)}</span></span>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {summary.tradedCount > 0 && (
            <button
              onClick={() => setExpanded(p => !p)}
              tabIndex={-1}
              className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              {expanded ? 'Hide' : 'Show'} trades
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          )}

          {onCreateTradeSheet && summary.tradedCount > 0 && (
            <button
              onClick={onCreateTradeSheet}
              disabled={!canCreateTradeSheet || isCreatingTradeSheet}
              tabIndex={-1}
              className={clsx(
                'inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-md transition-colors',
                canCreateTradeSheet && !isCreatingTradeSheet
                  ? 'bg-primary-600 text-white hover:bg-primary-700'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
              )}
            >
              <FileText className="w-3 h-3" />
              {isCreatingTradeSheet ? 'Creating...' : 'Create Trade List'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded trade list */}
      {expanded && summary.tradedCount > 0 && (
        <div className="border-t border-gray-200/60 dark:border-gray-700/40 max-h-52 overflow-y-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">Action</th>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">Symbol</th>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">Name</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">Δ Wt</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">Δ Shrs</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 pr-3">Δ $</th>
              </tr>
            </thead>
            <tbody>
              {tradedRows.map((row, i) => {
                const action = row.derivedAction
                const isBuy = action === 'buy' || action === 'add'
                return (
                  <tr key={row.asset_id} className={clsx(
                    'border-b border-gray-100 dark:border-gray-700/30',
                    i % 2 === 0 ? ROW_EVEN : ROW_ODD,
                  )}>
                    <td className="px-3 py-1.5">
                      <span className={clsx(
                        'inline-block font-bold uppercase text-[8px] px-1.5 py-0.5 rounded-full whitespace-nowrap',
                        isBuy ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                               : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      )}>{actionLabel(action, row.isNew, row.isRemoved)}</span>
                    </td>
                    <td className="px-2 py-1.5 font-medium text-gray-900 dark:text-white">{row.symbol}</td>
                    <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 truncate max-w-[10rem]">{row.company_name}</td>
                    <td className={clsx('px-2 py-1.5 text-right font-medium', row.deltaWeight !== 0 ? dc(row.deltaWeight) : 'text-gray-400 dark:text-gray-500')}>{fmtWt(row.deltaWeight, true)}</td>
                    <td className={clsx('px-2 py-1.5 text-right font-medium', row.deltaShares !== 0 ? dc(row.deltaShares) : 'text-gray-400 dark:text-gray-500')}>{fmtShares(row.deltaShares, true)}</td>
                    <td className={clsx('px-2 py-1.5 text-right pr-3 font-medium', row.notional !== 0 ? dc(row.notional) : 'text-gray-400 dark:text-gray-500')}>{row.notional !== 0 ? fmtNotional(row.notional) : '$0'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// MAIN TABLE
// =============================================================================

export function HoldingsSimulationTable({
  rows, tradedRows, untradedRows, newPositionRows, summary,
  portfolioTotalValue, hasBenchmark, priceMap,
  onUpdateVariant, onDeleteVariant, onCreateVariant, onFixConflict,
  onAddAsset, assetSearchResults, onAssetSearchChange,
  onCreateTradeSheet, canCreateTradeSheet, isCreatingTradeSheet,
  groupBy: externalGroupBy, onGroupByChange, className = '',
}: HoldingsSimulationTableProps) {
  const [internalGroupBy, setInternalGroupBy] = useState<GroupBy>('none')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [focusRow, setFocusRow] = useState(-1)
  const [focusCol, setFocusCol] = useState(0)
  const [editing, setEditing] = useState(false)
  const [pendingEditAssetId, setPendingEditAssetId] = useState<string | null>(null)
  const [pendingEditCol, setPendingEditCol] = useState(COL.SIM_WT)

  // Popover state (conflicts + sizing help)
  const [showConflictPopover, setShowConflictPopover] = useState(false)
  const [showSizingHelp, setShowSizingHelp] = useState(false)
  const conflictPopoverRef = useRef<HTMLDivElement>(null)
  const sizingHelpRef = useRef<HTMLDivElement>(null)

  // Close popovers on outside click
  useEffect(() => {
    if (!showConflictPopover && !showSizingHelp) return
    const handler = (e: MouseEvent) => {
      if (showConflictPopover && conflictPopoverRef.current && !conflictPopoverRef.current.contains(e.target as Node)) {
        setShowConflictPopover(false)
      }
      if (showSizingHelp && sizingHelpRef.current && !sizingHelpRef.current.contains(e.target as Node)) {
        setShowSizingHelp(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showConflictPopover, showSizingHelp])

  // Phantom row state (inline asset search)
  const [showPhantomRow, setShowPhantomRow] = useState(false)
  const [phantomSearch, setPhantomSearch] = useState('')
  const [phantomHighlight, setPhantomHighlight] = useState(0)
  const phantomInputRef = useRef<HTMLInputElement>(null)

  // Sort state
  const [sortCol, setSortCol] = useState<ColKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  // Filter state
  const [filters, setFilters] = useState<Partial<Record<ColKey, string>>>({})

  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())

  // Stable row order: preserve existing positions across refetches/cache churn.
  // New rows append at end; removed rows are dropped. This prevents rows from
  // jumping when the variant cache is replaced by a DB refetch.
  const rowOrderRef = useRef<string[]>([])
  const stableRows = useMemo(() => {
    const knownOrder = rowOrderRef.current
    const rowMap = new Map(rows.map(r => [r.asset_id, r]))

    const result: SimulationRow[] = []
    const seen = new Set<string>()

    // Keep existing rows in their known order
    for (const id of knownOrder) {
      const row = rowMap.get(id)
      if (row) {
        result.push(row)
        seen.add(id)
      }
    }

    // Append new rows at end
    for (const row of rows) {
      if (!seen.has(row.asset_id)) {
        result.push(row)
      }
    }

    // Sync ref (benign side effect — ref update doesn't trigger re-render)
    rowOrderRef.current = result.map(r => r.asset_id)

    return result
  }, [rows])

  const groupBy = externalGroupBy ?? internalGroupBy
  const handleGroupByChange = onGroupByChange ?? setInternalGroupBy

  const activeFilterCount = Object.values(filters).filter(v => v && v.length > 0).length

  const toggleGroup = useCallback((name: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }, [])

  const handleSort = useCallback((col: ColKey) => {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc')
      else if (sortDir === 'desc') { setSortCol(null); setSortDir(null) }
      else setSortDir('asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }, [sortCol, sortDir])

  const setFilter = useCallback((col: ColKey, value: string) => {
    setFilters(prev => ({ ...prev, [col]: value }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({})
  }, [])

  // Pipeline: stableRows → filter → sort → group
  // Rows with direction conflicts (for popover)
  const conflictRows = useMemo(() => rows.filter(r => r.hasConflict), [rows])

  const processedRows = useMemo(() => {
    let result = stableRows

    // Apply filters
    const activeFilters = Object.entries(filters).filter(([, v]) => v && v.length > 0) as [ColKey, string][]
    if (activeFilters.length > 0) {
      result = result.filter(row =>
        activeFilters.every(([col, term]) =>
          getFilterValue(row, col).toLowerCase().includes(term.toLowerCase())
        )
      )
    }

    // Apply sort
    if (sortCol && sortDir) {
      const col = sortCol
      const dir = sortDir
      result = [...result].sort((a, b) => {
        const av = getSortValue(a, col)
        const bv = getSortValue(b, col)
        let cmp: number
        if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv)
        else cmp = (av as number) - (bv as number)
        return dir === 'desc' ? -cmp : cmp
      })
    }

    return result
  }, [stableRows, filters, sortCol, sortDir])

  // Display rows: apply grouping/collapse to processedRows
  const displayRows = useMemo(() => {
    if (groupBy === 'none') return processedRows
    const result: SimulationRow[] = []
    const groups: Record<string, SimulationRow[]> = {}
    processedRows.forEach(r => { (groups[getGroupKey(r, groupBy)] ??= []).push(r) })
    Object.entries(groups)
      .sort(([, a], [, b]) => b.reduce((s, r) => s + r.simWeight, 0) - a.reduce((s, r) => s + r.simWeight, 0))
      .forEach(([n, items]) => { if (!collapsedGroups.has(n)) result.push(...items) })
    return result
  }, [processedRows, groupBy, collapsedGroups])

  const groupedRows = useMemo(() => {
    if (groupBy === 'none') return null
    const groups: Record<string, SimulationRow[]> = {}
    processedRows.forEach(r => { (groups[getGroupKey(r, groupBy)] ??= []).push(r) })
    return Object.entries(groups)
      .map(([name, items]) => ({ name, rows: items, totalWeight: items.reduce((s, r) => s + r.simWeight, 0), count: items.length }))
      .sort((a, b) => b.totalWeight - a.totalWeight)
  }, [processedRows, groupBy])

  // Auto-open editor when pending variant appears
  useEffect(() => {
    if (!pendingEditAssetId) return
    const idx = displayRows.findIndex(r => r.asset_id === pendingEditAssetId && r.variant)
    if (idx >= 0) {
      // Only open editor if table still has focus
      if (containerRef.current?.contains(document.activeElement)) {
        setFocusRow(idx); setFocusCol(pendingEditCol); setEditing(true)
      } else {
        // Table lost focus — clean up the empty variant
        const row = displayRows[idx]
        if (row?.variant && !row.variant.sizing_input) onDeleteVariant(row.variant.id)
      }
      setPendingEditAssetId(null)
    }
  }, [displayRows, pendingEditAssetId, pendingEditCol, onDeleteVariant])

  useEffect(() => {
    if (focusRow >= 0) rowRefs.current.get(focusRow)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusRow])

  // Tracks whether the last edit was committed with a non-empty value.
  // When true, cleanupEmptyVariant skips deletion (the server update is in flight).
  // Reset only when a new edit session starts (not in cleanup) to survive double-blur
  // from React unmounting the input after commit.
  const committedEditRef = useRef(false)

  // Reset committed flag when editing starts (not in cleanup — cleanup can fire twice
  // due to input unmount triggering a second container blur)
  useEffect(() => {
    if (editing) committedEditRef.current = false
  }, [editing])

  // Delete variant if user exits editing without entering a value
  const cleanupEmptyVariant = useCallback((rowIdx: number) => {
    if (committedEditRef.current) return // Edit was committed — don't delete the variant
    if (rowIdx < 0 || rowIdx >= displayRows.length) return
    const row = displayRows[rowIdx]
    if (row?.variant && !row.variant.sizing_input) {
      onDeleteVariant(row.variant.id)
    }
  }, [displayRows, onDeleteVariant])

  const focusCell = useCallback((r: number, c: number) => {
    if (editing && focusRow >= 0) cleanupEmptyVariant(focusRow)
    setFocusRow(r); setFocusCol(c); setEditing(false)
  }, [editing, focusRow, cleanupEmptyVariant])

  const activateCell = useCallback((r: number, c: number) => {
    if (r < 0 || r >= displayRows.length) return
    const row = displayRows[r]
    if (c === COL.SIM_WT || c === COL.SIM_SHARES) {
      if (row.variant) setEditing(true)
      else { onCreateVariant(row.asset_id, 'add'); setPendingEditAssetId(row.asset_id); setPendingEditCol(c) }
    }
  }, [displayRows, onCreateVariant])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); cleanupEmptyVariant(focusRow); setEditing(false) }
      else if (e.key === 'Tab') {
        e.preventDefault(); cleanupEmptyVariant(focusRow); setEditing(false)
        const next = e.shiftKey ? Math.max(focusRow - 1, 0) : Math.min(focusRow + 1, displayRows.length - 1)
        setFocusRow(next)
        // Keep same column so Tab advances down the same editable column
        if (displayRows[next]?.variant) setEditing(true)
      }
      return
    }

    const maxRow = displayRows.length - 1

    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); setFocusRow(p => Math.min(p + 1, maxRow)); break
      case 'ArrowUp': case 'k': e.preventDefault(); setFocusRow(p => Math.max(p - 1, 0)); break
      case 'ArrowRight': case 'l': e.preventDefault(); setFocusCol(p => Math.min(p + 1, COL_COUNT - 1)); break
      case 'ArrowLeft': case 'h': e.preventDefault(); setFocusCol(p => Math.max(p - 1, 0)); break
      case 'Enter': e.preventDefault(); activateCell(focusRow, focusCol); break
      case 'e':
        if (focusRow >= 0 && displayRows[focusRow]?.variant) {
          e.preventDefault()
          // If already on an editable col, stay there; otherwise default to SIM_WT
          if (focusCol !== COL.SIM_WT && focusCol !== COL.SIM_SHARES) setFocusCol(COL.SIM_WT)
          setEditing(true)
        }
        break
      case 'Delete': case 'Backspace':
        if (focusRow >= 0 && displayRows[focusRow]?.variant) { e.preventDefault(); onDeleteVariant(displayRows[focusRow].variant!.id) }
        break
      case 'Tab': {
        e.preventDefault()
        if (e.shiftKey) {
          if (focusCol > COL.SIM_WT) setFocusCol(COL.SIM_WT)
          else if (focusCol > COL.SYMBOL) setFocusCol(COL.SYMBOL)
          else if (focusRow > 0) { setFocusRow(focusRow - 1); setFocusCol(COL.DELTA_NOTIONAL) }
        } else {
          if (focusCol < COL.SIM_WT) setFocusCol(COL.SIM_WT)
          else if (focusCol < COL.DELTA_NOTIONAL) setFocusCol(COL.DELTA_NOTIONAL)
          else if (focusRow < maxRow) { setFocusRow(focusRow + 1); setFocusCol(COL.SYMBOL) }
        }
        break
      }
      case 'Escape': setFocusRow(-1); setEditing(false); containerRef.current?.blur(); break
      case 'Home': e.preventDefault(); e.ctrlKey ? (setFocusRow(0), setFocusCol(0)) : setFocusCol(0); break
      case 'End': e.preventDefault(); e.ctrlKey ? (setFocusRow(maxRow), setFocusCol(COL_COUNT - 1)) : setFocusCol(COL_COUNT - 1); break
    }
  }, [displayRows, focusRow, focusCol, editing, activateCell, onDeleteVariant, cleanupEmptyVariant])

  const setRowRef = useCallback((i: number) => (el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(i, el); else rowRefs.current.delete(i)
  }, [])

  const handleCreateVariantAndEdit = useCallback((assetId: string, col: number = COL.SIM_WT) => {
    onCreateVariant(assetId, 'add'); setPendingEditAssetId(assetId); setPendingEditCol(col)
  }, [onCreateVariant])

  const handleStopEdit = useCallback((committedValue?: string) => {
    if (committedValue) committedEditRef.current = true
    setEditing(false)
  }, [])

  const handleShowPhantom = useCallback(() => {
    if (showPhantomRow) {
      // Already showing — refocus the input
      phantomInputRef.current?.focus()
      return
    }
    setPhantomSearch('')
    setPhantomHighlight(0)
    setShowPhantomRow(true)
    onAssetSearchChange?.('')
  }, [showPhantomRow, onAssetSearchChange])

  const handlePhantomSelect = useCallback((asset: { id: string; symbol: string; company_name: string; sector: string | null }) => {
    // Check if asset already exists in displayRows
    const existingIdx = displayRows.findIndex(r => r.asset_id === asset.id)
    if (existingIdx >= 0) {
      // Asset exists — navigate to it and open sizing
      setFocusRow(existingIdx)
      setFocusCol(COL.SIM_WT)
      const row = displayRows[existingIdx]
      if (row.variant) {
        setEditing(true)
      } else {
        onCreateVariant(row.asset_id, 'add')
        setPendingEditAssetId(row.asset_id)
        setPendingEditCol(COL.SIM_WT)
      }
    } else {
      // New asset — import it
      onAddAsset(asset)
      setPendingEditAssetId(asset.id)
      setPendingEditCol(COL.SIM_WT)
    }
    setShowPhantomRow(false)
    setPhantomSearch('')
    onAssetSearchChange?.('')
    // Re-focus the table container so keyboard nav works
    containerRef.current?.focus()
  }, [displayRows, onAddAsset, onCreateVariant, onAssetSearchChange])

  const handlePhantomClose = useCallback(() => {
    setShowPhantomRow(false)
    setPhantomSearch('')
    onAssetSearchChange?.('')
  }, [onAssetSearchChange])

  // Footer totals computed from displayRows (respects filters)
  const totals = useMemo(() => {
    const src = displayRows
    return {
      shares: src.reduce((s, r) => s + r.currentShares, 0),
      weight: src.reduce((s, r) => s + r.currentWeight, 0),
      bench: src.reduce((s, r) => s + (r.benchWeight ?? 0), 0),
      active: src.reduce((s, r) => s + (r.activeWeight ?? 0), 0),
      simWt: src.reduce((s, r) => s + r.simWeight, 0),
      deltaWt: src.reduce((s, r) => s + r.deltaWeight, 0),
      notional: src.reduce((s, r) => s + r.notional, 0),
    }
  }, [displayRows])

  const renderRow = (row: SimulationRow, idx: number) => (
    <HoldingRow
      key={row.asset_id} row={row} rowIndex={idx} isEven={idx % 2 === 0}
      focusedCol={focusRow === idx ? focusCol : null} isEditing={focusRow === idx && editing}
      onUpdateVariant={onUpdateVariant}
      onFocusCell={focusCell} onStartEdit={() => setEditing(true)} onStopEdit={handleStopEdit}
      onCreateVariantAndEdit={handleCreateVariantAndEdit} rowRef={setRowRef(idx)}
    />
  )

  return (
    <div
      ref={containerRef}
      className={clsx('h-full flex flex-col overflow-hidden focus:outline-none', className)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={() => { if (focusRow < 0 && displayRows.length > 0) { setFocusRow(0); setFocusCol(0) } }}
      onBlur={(e) => {
        // Clean up when focus leaves the table entirely
        // (but not when moving to phantom row input — that's still "in table")
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setPendingEditAssetId(null)
          if (focusRow >= 0) cleanupEmptyVariant(focusRow)
          setEditing(false)
          setFocusRow(-1)
        }
      }}
    >
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-3 py-1 border-b border-gray-200/80 dark:border-gray-700/60 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mr-1">Group</span>
          {(['none', 'sector', 'action', 'change'] as GroupBy[]).map(g => (
            <button key={g} tabIndex={-1}
              onClick={() => { handleGroupByChange(g); setCollapsedGroups(new Set()) }}
              className={clsx(
                'text-[11px] px-2 py-0.5 rounded-full transition-colors duration-100 capitalize',
                groupBy === g
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              )}
            >{g === 'none' ? 'None' : g}</button>
          ))}
        </div>

        <div className="ml-auto" />

        {summary.tradedCount > 0 && (
          <div className="relative" ref={conflictPopoverRef}>
            <button
              onClick={() => summary.conflictCount > 0 && setShowConflictPopover(prev => !prev)}
              className={clsx(
                'text-[11px] font-medium tabular-nums px-2 py-0.5 rounded-full transition-colors',
                summary.conflictCount > 0
                  ? 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 cursor-pointer'
                  : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 cursor-default',
              )}
            >
              {summary.tradedCount} trade{summary.tradedCount !== 1 ? 's' : ''}
              {summary.conflictCount > 0 && (
                <>
                  {' · '}<AlertTriangle className="inline h-3 w-3 -mt-px" /> {summary.conflictCount} conflict{summary.conflictCount !== 1 ? 's' : ''}
                </>
              )}
            </button>

            {/* Conflict details popover */}
            {showConflictPopover && conflictRows.length > 0 && (
              <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-red-200 dark:border-red-800/60 overflow-hidden">
                <div className="px-3 py-2 border-b border-red-100 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20">
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Direction Conflicts
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50">
                  {conflictRows.map(row => {
                    const conflict = row.conflict
                    return (
                      <div key={row.asset_id} className="px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-750">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={clsx(
                              'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0',
                              row.variant?.action === 'buy' || row.variant?.action === 'add'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
                            )}>
                              {row.variant?.action || row.derivedAction}
                            </span>
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">{row.symbol}</span>
                          </div>
                          {conflict?.suggested_direction && row.variant && (
                            <button
                              onClick={() => {
                                onFixConflict(row.variant!.id, conflict.suggested_direction as TradeAction)
                                setShowConflictPopover(false)
                              }}
                              className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                            >
                              Fix → {(conflict.suggested_direction as string).toUpperCase()}
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                          {conflict?.message || `${row.variant?.action?.toUpperCase()} action conflicts with computed ${row.deltaShares > 0 ? 'positive' : 'negative'} delta`}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filtered count */}
        {activeFilterCount > 0 && processedRows.length !== rows.length && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
            {processedRows.length}/{rows.length}
          </span>
        )}

        {/* Sizing input reference */}
        <div className="relative" ref={sizingHelpRef}>
          <button
            onClick={() => setShowSizingHelp(prev => !prev)}
            className={clsx(
              'p-1 rounded-full transition-colors',
              showSizingHelp
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            )}
            title="Sizing input reference"
          >
            <Info className="h-3.5 w-3.5" />
          </button>

          {showSizingHelp && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Sizing Input Reference</span>
              </div>
              <div className="p-3 space-y-3 text-[11px]">
                {/* Weight */}
                <div>
                  <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Weight %</div>
                  <div className="space-y-0.5 text-gray-500 dark:text-gray-400 font-mono">
                    <div className="flex justify-between"><span className="text-gray-900 dark:text-white">2.5</span><span>Target 2.5% weight</span></div>
                    <div className="flex justify-between"><span className="text-emerald-600 dark:text-emerald-400">+0.5</span><span>Add 0.5% to current</span></div>
                    <div className="flex justify-between"><span className="text-red-600 dark:text-red-400">-0.25</span><span>Reduce by 0.25%</span></div>
                  </div>
                </div>
                {/* Shares */}
                <div>
                  <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Shares</div>
                  <div className="space-y-0.5 text-gray-500 dark:text-gray-400 font-mono">
                    <div className="flex justify-between"><span className="text-gray-900 dark:text-white">#500</span><span>Target 500 shares</span></div>
                    <div className="flex justify-between"><span className="text-emerald-600 dark:text-emerald-400">#+100</span><span>Buy 100 more shares</span></div>
                    <div className="flex justify-between"><span className="text-red-600 dark:text-red-400">#-50</span><span>Sell 50 shares</span></div>
                  </div>
                </div>
                {/* Active weight */}
                <div>
                  <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Active Weight
                    {!hasBenchmark && <span className="font-normal text-gray-400 dark:text-gray-500 ml-1">(needs benchmark)</span>}
                  </div>
                  <div className="space-y-0.5 text-gray-500 dark:text-gray-400 font-mono">
                    <div className="flex justify-between"><span className="text-gray-900 dark:text-white">@t0.5</span><span>Target 0.5% active</span></div>
                    <div className="flex justify-between"><span className="text-emerald-600 dark:text-emerald-400">@d+0.25</span><span>Add 0.25% active</span></div>
                    <div className="flex justify-between"><span className="text-red-600 dark:text-red-400">@d-0.25</span><span>Reduce 0.25% active</span></div>
                  </div>
                </div>
                {/* Special */}
                <div className="pt-1 border-t border-gray-100 dark:border-gray-700">
                  <div className="space-y-0.5 text-gray-500 dark:text-gray-400 font-mono">
                    <div className="flex justify-between"><span className="text-gray-900 dark:text-white">0</span><span>Exit position (sell all)</span></div>
                    <div className="flex justify-between"><span className="text-gray-900 dark:text-white">#0</span><span>Exit position (sell all)</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            {/* Column headers */}
            <tr className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              {COLUMNS.map((col) => {
                const colIdx = COL[col.key]
                const isSorted = sortCol === col.key
                const isEditable = col.key === 'SIM_WT' || col.key === 'SIM_SHARES'
                return (
                  <th
                    key={col.key}
                    className={clsx(
                      'group/th px-2 py-2.5 whitespace-nowrap select-none',
                      col.align === 'left' ? 'text-left' : 'text-right',
                      colIdx === 0 && 'pl-3',
                      col.sortable && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors',
                      col.width,
                    )}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <div className={clsx(
                      'flex items-center gap-1',
                      col.align === 'right' && 'justify-end',
                    )}>
                      {col.align === 'right' && col.sortable && <SortIcon dir={isSorted ? sortDir : null} />}
                      <span className={clsx(
                        'text-xs font-semibold tracking-wide',
                        isEditable
                          ? 'text-primary-600 dark:text-primary-400'
                          : isSorted
                            ? 'text-gray-700 dark:text-gray-200'
                            : 'text-gray-500 dark:text-gray-400',
                      )}>
                        {col.label}
                      </span>
                      {col.align === 'left' && col.sortable && <SortIcon dir={isSorted ? sortDir : null} />}
                    </div>
                  </th>
                )
              })}
            </tr>

            {/* Filter row — always visible */}
            <tr className="bg-gray-200/60 dark:bg-gray-700/50 border-b border-gray-200/60 dark:border-gray-700/40">
              {COLUMNS.map((col) => (
                <td key={col.key} className={clsx('px-2 py-0.5', col.key === 'SYMBOL' && 'pl-3')}>
                  {col.filterable ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={filters[col.key] || ''}
                        onChange={(e) => setFilter(col.key, e.target.value)}
                        className={clsx(
                          'w-full text-[10px] px-1 py-px rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400',
                          col.key === 'NAME' ? 'max-w-[10rem]' : 'max-w-[5rem]',
                          col.align === 'right' && 'text-right ml-auto block',
                        )}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      {filters[col.key] && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setFilter(col.key, '') }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        ><X className="w-2.5 h-2.5" /></button>
                      )}
                    </div>
                  ) : null}
                </td>
              ))}
            </tr>
          </thead>

          <tbody>
            {displayRows.length === 0 && rows.length === 0 && !showPhantomRow ? (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-20 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <Plus className="w-6 h-6 text-gray-300 dark:text-gray-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No holdings yet</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Add a trade to start building your simulation</p>
                    </div>
                    <button onClick={handleShowPhantom}
                      className="text-[13px] font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 px-4 py-1.5 rounded-full border border-primary-200 dark:border-primary-800 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    >+ Add a trade</button>
                  </div>
                </td>
              </tr>
            ) : displayRows.length === 0 && rows.length > 0 && !showPhantomRow ? (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-12 text-center">
                  <p className="text-sm text-gray-400 dark:text-gray-500">No results match your filters</p>
                  <button onClick={clearFilters} className="text-xs text-primary-600 dark:text-primary-400 hover:underline mt-1">Clear filters</button>
                </td>
              </tr>
            ) : (
              <>
                {groupedRows ? (() => {
                  let flatIdx = 0
                  return groupedRows.map(group => (
                    <React.Fragment key={group.name}>
                      <GroupHeaderRow groupName={group.name} count={group.count} totalWeight={group.totalWeight}
                        isCollapsed={collapsedGroups.has(group.name)} onToggle={() => toggleGroup(group.name)} />
                      {!collapsedGroups.has(group.name) && group.rows.map(row => renderRow(row, flatIdx++))}
                    </React.Fragment>
                  ))
                })() : displayRows.map((row, idx) => renderRow(row, idx))}
              </>
            )}

            {/* Phantom row for inline asset search */}
            {showPhantomRow && (
              <PhantomRow
                search={phantomSearch}
                onSearchChange={(v) => { setPhantomSearch(v); onAssetSearchChange?.(v) }}
                results={assetSearchResults || []}
                highlightIndex={phantomHighlight}
                onHighlightChange={setPhantomHighlight}
                onSelect={handlePhantomSelect}
                onClose={handlePhantomClose}
                inputRef={phantomInputRef}
              />
            )}
          </tbody>

          {displayRows.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-gray-100 dark:bg-gray-800 border-t-2 border-gray-300 dark:border-gray-600">
                <td className="pl-3 pr-2 py-1.5 border-l-2 border-l-transparent">
                  <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{displayRows.length} positions</span>
                </td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <span className={clsx(NUM, 'font-semibold text-gray-600 dark:text-gray-300')}>{fmtShares(totals.shares)}</span>
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <span className={clsx(NUM, 'font-semibold text-gray-600 dark:text-gray-300')}>{fmtWt(totals.weight)}</span>
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <span className={clsx(NUM, 'text-gray-500 dark:text-gray-400')}>{fmtWt(totals.bench)}</span>
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <span className={clsx(NUM, 'text-gray-500 dark:text-gray-400')}>{fmtWt(totals.active, true)}</span>
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <span className={clsx(NUM, 'font-semibold text-gray-600 dark:text-gray-300')}>{fmtWt(totals.simWt)}</span>
                </td>
                {/* Sim Shrs — no total */}
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <span className={clsx(NUM, 'font-semibold', totals.deltaWt !== 0 ? dc(totals.deltaWt) : 'text-gray-500 dark:text-gray-400')}>{fmtWt(totals.deltaWt, true)}</span>
                </td>
                {/* Δ Shrs — no total */}
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <span className={clsx(NUM, 'font-semibold', totals.notional !== 0 ? dc(totals.notional) : 'text-gray-500 dark:text-gray-400')}>{totals.notional !== 0 ? fmtNotional(totals.notional) : '$0'}</span>
                </td>
              </tr>
            </tfoot>
          )}

        </table>
      </div>

      {/* Bottom Summary Panel */}
      {rows.length > 0 && (
        <SummaryPanel
          summary={summary}
          tradedRows={tradedRows}
          onAddTrade={handleShowPhantom}
          onCreateTradeSheet={onCreateTradeSheet}
          canCreateTradeSheet={canCreateTradeSheet}
          isCreatingTradeSheet={isCreatingTradeSheet}
        />
      )}
    </div>
  )
}

export default HoldingsSimulationTable
