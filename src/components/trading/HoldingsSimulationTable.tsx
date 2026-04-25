/**
 * Holdings Simulation Table (Trade Lab v3)
 *
 * Keyboard-driven spreadsheet-style table with sortable columns and
 * per-column search filters. Arrow keys move cell-by-cell,
 * Enter activates the focused cell, Escape exits editing, Delete removes trade.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect, type ChangeEvent } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronDown, ChevronRight, FileCheck, FileText, Info, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { SimulationRow, SimulationRowSummary } from '../../hooks/useSimulationRows'
import type { TradeAction, ExecutionStatus } from '../../types/trading'
import { AcceptedTradeBadge } from './AcceptedTradeBadge'
import { PairBadge } from './PairBadge'
import type { PairLegInfo } from '../../lib/trade-lab/pair-info'
import type { SimulationSuggestion } from '../../hooks/useSimulationSuggestions'
import { SuggestionIndicator } from './SuggestionIndicator'

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
  if (isNew) {
    return action === 'sell' || action === 'trim' ? 'NEW SHORT' : 'NEW LONG'
  }
  if (isRemoved || action === 'sell') return 'CLOSE'
  switch (action) {
    case 'buy':
    case 'add':  return 'INCREASE'
    case 'trim': return 'REDUCE'
    default:     return action.toUpperCase()
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
  SIM_NOTIONAL: 8,
  DELTA_WT: 9,
  DELTA_SHARES: 10,
  DELTA_NOTIONAL: 11,
} as const

type ColKey = keyof typeof COL

const COL_COUNT = 12

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
  { key: 'SIM_NOTIONAL',  label: 'Sim $',     align: 'right', sortable: true,  filterable: true },
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
  // Clamp near-zero values to exactly 0 so floating-point residue from
  // 100 − sum-of-weights doesn't surface as "-0.00%". Anything within
  // half-a-bp is visually zero after 2-decimal formatting anyway.
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) v = 0
  if (signed) return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  return `${v.toFixed(2)}%`
}

/** Parse a user-typed dollar amount. Accepts `$1,000,000`, `1M`, `500K`,
 *  `2.5B`, plain numbers, and optional `$` prefix. Returns null on
 *  unparseable input so callers can short-circuit. */
function parseDollars(input: string): number | null {
  const s = input.trim().replace(/[$,\s]/g, '').toUpperCase()
  if (!s) return null
  const m = s.match(/^([+-]?\d*\.?\d+)([KMB])?$/)
  if (!m) return null
  const num = parseFloat(m[1])
  if (!Number.isFinite(num)) return null
  const mult = m[2] === 'B' ? 1_000_000_000 : m[2] === 'M' ? 1_000_000 : m[2] === 'K' ? 1_000 : 1
  return num * mult
}

function fmtShares(v: number, signed = false): string {
  const a = Math.abs(Math.round(v))
  const n = a.toLocaleString()
  if (!signed) return n
  if (v > 0) return `+${n}`
  if (v < 0) return `-${n}`
  return n
}

function getGroupKey(row: SimulationRow, g: GroupBy): string {
  switch (g) {
    case 'sector': return row.sector || 'Other'
    case 'action': {
      if (row.isNew) {
        return row.derivedAction === 'sell' || row.derivedAction === 'trim' ? 'New Short' : 'New Long'
      }
      if (row.isRemoved) return 'Sold'
      if (row.variant && row.variant.sizing_input) return row.derivedAction === 'buy' || row.derivedAction === 'add' ? 'Increasing' : 'Reducing'
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
    case 'SIM_NOTIONAL': return row.simNotional
    case 'DELTA_WT': return row.deltaWeight
    case 'DELTA_SHARES': return row.deltaShares
    case 'DELTA_NOTIONAL': return row.notional
  }
}

/** Get the filterable text value for a row+column */
/** Get the raw numeric value for a column (for comparison filters like >4, <2) */
function getNumericValue(row: SimulationRow, col: ColKey): number | null {
  switch (col) {
    case 'SHARES': return row.currentShares
    case 'WEIGHT': return row.currentWeight
    case 'BENCH': return row.benchWeight
    case 'ACTIVE': return row.activeWeight
    case 'SIM_WT': return row.simWeight
    case 'SIM_SHARES': return row.simShares
    case 'SIM_NOTIONAL': return row.simNotional
    case 'DELTA_WT': return row.deltaWeight
    case 'DELTA_SHARES': return row.deltaShares
    case 'DELTA_NOTIONAL': return row.notional
    default: return null
  }
}

/** Check if a filter term is a numeric comparison (e.g. >4, <=2.5, <0) */
function matchesNumericFilter(row: SimulationRow, col: ColKey, term: string): boolean | null {
  const match = term.match(/^([><]=?)\s*(-?\d+\.?\d*)$/)
  if (!match) return null // not a numeric filter — fall through to text match
  const op = match[1]
  const threshold = parseFloat(match[2])
  const value = getNumericValue(row, col)
  if (value === null) return false
  switch (op) {
    case '>': return value > threshold
    case '<': return value < threshold
    case '>=': return value >= threshold
    case '<=': return value <= threshold
    default: return null
  }
}

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
  cashRow?: SimulationRow | null
  tradedRows: SimulationRow[]
  untradedRows: SimulationRow[]
  newPositionRows: SimulationRow[]
  summary: SimulationRowSummary
  portfolioTotalValue: number
  hasBenchmark: boolean
  priceMap: Record<string, number>
  onUpdateVariant: (variantId: string, updates: { action?: TradeAction; sizingInput?: string }) => void
  onDeleteVariant: (variantId: string) => void
  /** Remove an asset entirely from the simulation (uncheck from left panel) */
  onRemoveAsset?: (assetId: string) => void
  onCreateVariant: (assetId: string, action: TradeAction) => void
  onFixConflict: (variantId: string, suggestedAction: TradeAction) => void
  /** Pro-rata cash rebalance. Given a target cash weight (0-100), scale
   *  every non-cash baseline position proportionally so the residual
   *  lands at the target. Creating/updating a variant per holding is
   *  the caller's responsibility. */
  onSetCashTarget?: (targetCashWeightPct: number) => void
  /** Wipe every in-progress trade (variants + simulation_trades) from
   *  the current simulation. Fired from the "Clear all" button in the
   *  summary bar. Parent should prompt for confirmation before calling. */
  onClearAllTrades?: () => void
  onAddAsset: (asset: { id: string; symbol: string; company_name: string; sector: string | null }) => void
  assetSearchResults?: { id: string; symbol: string; company_name: string; sector: string | null }[]
  onAssetSearchChange?: (query: string) => void
  onCreateTradeSheet?: () => void
  canCreateTradeSheet?: boolean
  isCreatingTradeSheet?: boolean
  groupBy?: GroupBy
  onGroupByChange?: (groupBy: GroupBy) => void
  readOnly?: boolean
  className?: string
  // Suggest mode props
  suggestMode?: boolean
  onSubmitSuggestion?: (assetId: string, sizingInput: string, notes?: string) => void
  pendingSuggestionsByAsset?: Map<string, SimulationSuggestion[]>
  pendingSuggestionCount?: number
  onOpenSuggestionReview?: () => void
  // Promote to Trade Book
  onBulkPromote?: (
    variantIds: string[],
    opts?: {
      batchName?: string | null
      /** Batch-level rationale. Lands on trade_batch.description. */
      batchDescription?: string | null
      /** Optional per-variant PM rationale typed in the Execute modal.
       *  Keys are variant IDs. Empty/missing values mean "PM wants to
       *  contextualize later in the Trade Book / Outcomes surface." */
      reasons?: Record<string, string>
    },
  ) => void
  isBulkPromoting?: boolean
  /** Set by the parent the moment its DecisionConfirmationModal becomes
   *  ready to display (i.e., the success record was built and assigned).
   *  Used to coordinate the hand-off out of the in-modal loading state
   *  so the loading modal stays up until the confirmation actually
   *  appears — without this flag the loading modal closes the instant
   *  `isBulkPromoting` flips false, leaving a brief blank frame before
   *  the success modal mounts. */
  decisionConfirmationOpen?: boolean
  /** Map of asset_id → pair info. Rows whose asset is part of a pair render
   *  a "↔ pair" badge alongside the symbol. Derived from trade_queue_items
   *  pair_id/pair_leg_type in SimulationPage. */
  pairInfoByAsset?: Map<string, import('../../lib/trade-lab/pair-info').PairLegInfo>
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
  onUpdateVariant, onFocusCell, onStartEdit, onStopEdit, onCreateVariantAndEdit, onClickEditableCell, rowRef,
  suggestMode, onSubmitSuggestion, pendingSuggestions, onOpenSuggestionReview,
  promoteSelected, onTogglePromote, showCheckboxCol,
  pairInfo,
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
  onClickEditableCell: (row: number, col: number, assetId: string, hasVariant: boolean) => void
  rowRef: (el: HTMLTableRowElement | null) => void
  suggestMode?: boolean
  onSubmitSuggestion?: (assetId: string, sizingInput: string) => void
  pendingSuggestions?: SimulationSuggestion[]
  onOpenSuggestionReview?: () => void
  promoteSelected?: boolean
  onTogglePromote?: (variantId: string) => void
  /** When true, render a leading checkbox column (empty on rows with no
   *  trade). */
  showCheckboxCol?: boolean
  pairInfo?: PairLegInfo
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
      if (focusedCol === COL.SIM_NOTIONAL) {
        // Editing dollar column: prefill with the current sim notional as a
        // plain number (no $, no suffix). User can type `$1M` or `500000`
        // or `100K` — parseDollars handles all of them on commit.
        setEditValue(row.simNotional > 0 ? String(Math.round(row.simNotional)) : '')
      } else if (focusedCol === COL.SIM_SHARES && raw && !isSharesInput) {
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

  /** Transform the raw editor value into a canonical sizing_input based on
   *  which column is being edited. For Sim $, the user types a dollar
   *  amount — we convert it to shares using the row's effective price and
   *  emit a `#<shares>` string so the server's sizing pipeline handles
   *  it like any other shares-based input. Returns null if the input is
   *  unparseable / unusable (caller should treat as cancel). */
  const canonicalizeSizingInput = (raw: string): string | null => {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    if (focusedCol !== COL.SIM_NOTIONAL) return trimmed

    const dollars = parseDollars(trimmed)
    if (dollars == null) return null
    // Derive price: baseline holdings have it directly; new positions
    // can derive from simNotional / simShares when sizing already exists.
    const effectivePrice = row.baseline?.price
      ?? (row.simShares > 0 ? row.simNotional / row.simShares : 0)
    if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) return null
    const targetShares = Math.max(0, Math.round(dollars / effectivePrice))
    return `#${targetShares}`
  }

  const handleEditBlur = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false
      onStopEdit() // No value → parent may cleanup empty variant
      return
    }
    const canonical = canonicalizeSizingInput(editValue)
    if (canonical === null) {
      // Unparseable dollar input → treat as cancel.
      onStopEdit()
      return
    }
    if (suggestMode) {
      // Suggest mode: submit a suggestion instead of updating the variant
      if (canonical && onSubmitSuggestion) {
        onSubmitSuggestion(row.asset_id, canonical)
      }
      onStopEdit(canonical || undefined)
      return
    }
    if (v && canonical !== (v.sizing_input || '').trim()) {
      onUpdateVariant(v.id, { sizingInput: canonical })
    }
    onStopEdit(canonical || undefined)
  }

  const sizingEditor = () => (
    <input
      type="text"
      ref={(el) => {
        // Focus without scrolling — autoFocus triggers browser scrollIntoView
        // which can jump the table container in overflow:auto layouts.
        if (el && document.activeElement !== el) {
          el.focus({ preventScroll: true })
          el.select()
        }
      }}
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onBlur={handleEditBlur}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelledRef.current = true
          onStopEdit()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          // Commit directly without blur — preserves table focus for arrow key navigation
          const canonical = canonicalizeSizingInput(editValue)
          if (canonical === null) {
            // Unparseable dollar input — treat as cancel.
            onStopEdit()
            return
          }
          if (suggestMode) {
            if (canonical && onSubmitSuggestion) onSubmitSuggestion(row.asset_id, canonical)
            onStopEdit(canonical || undefined)
            return
          }
          if (v && canonical !== (v.sizing_input || '').trim()) {
            onUpdateVariant(v.id, { sizingInput: canonical })
          }
          onStopEdit(canonical || undefined)
        }
      }}
      placeholder={
        focusedCol === COL.SIM_NOTIONAL ? '$1M'
        : focusedCol === COL.SIM_SHARES ? '#500'
        : '2.5'
      }
      className="w-20 h-5 text-[13px] font-mono tabular-nums text-right px-1.5 -my-0.5 rounded border border-primary-400 dark:border-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-400"
    />
  )

  const simWtContent = () => {
    // Editor check first — so the input shows even if the temp variant hasn't
    // propagated to the row yet (instant open on click).
    if (isEditing && focusedCol === COL.SIM_WT) return sizingEditor()

    // Has active sizing → show the computed sim weight.
    if (v?.sizing_input) {
      return (
        <span className={clsx(NUM, hasSizing ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500')}>
          {fmtWt(row.simWeight)}
          {pendingSuggestions && pendingSuggestions.length > 0 && (
            <SuggestionIndicator suggestions={pendingSuggestions} onClick={onOpenSuggestionReview} />
          )}
        </span>
      )
    }

    // Variant exists but no sizing yet (e.g. user just checked an idea with
    // no suggested weight). Show the "enter size" prompt so they know the
    // row is queued and waiting on a size, rather than looking identical to
    // an untraded row.
    if (v) {
      return (
        <span className="text-[13px] text-primary-500 dark:text-primary-400 italic">
          {suggestMode ? 'suggest' : 'enter size'}
        </span>
      )
    }

    // No variant at all: for existing baseline holdings, show the current
    // weight as the sim weight (untraded → sim equals current). For genuine
    // new positions with zero baseline, show the "enter size" placeholder.
    if (!row.isNew) {
      const hoverClass = suggestMode
        ? 'group-hover/row:text-amber-500 dark:group-hover/row:text-amber-400'
        : 'group-hover/row:text-gray-500 dark:group-hover/row:text-gray-400'
      return (
        <span className={clsx(DIM, hoverClass, 'transition-colors')}>
          {fmtWt(row.currentWeight)}
          {pendingSuggestions && pendingSuggestions.length > 0 && (
            <SuggestionIndicator suggestions={pendingSuggestions} onClick={onOpenSuggestionReview} />
          )}
        </span>
      )
    }

    return (
      <span className="text-[13px] text-gray-300 dark:text-gray-600 italic">
        {suggestMode ? 'suggest' : 'enter size'}
      </span>
    )
  }

  const simSharesContent = () => {
    // Editor check first — instant open before variant propagates
    if (isEditing && focusedCol === COL.SIM_SHARES) return sizingEditor()

    if (v?.sizing_input) {
      return <span className={clsx(NUM, hasSizing ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500')}>{row.simShares < 0 ? fmtShares(row.simShares, true) : fmtShares(row.simShares)}</span>
    }

    // No sizing: existing baseline → show current shares as sim shares.
    // New position with zero baseline → "enter size" placeholder.
    if (!row.isNew) {
      return (
        <span className={clsx(DIM, 'group-hover/row:text-gray-500 dark:group-hover/row:text-gray-400 transition-colors')}>
          {fmtShares(row.currentShares)}
        </span>
      )
    }

    return (
      <span className="text-[13px] text-gray-300 dark:text-gray-600 italic">
        enter size
      </span>
    )
  }

  const simNotionalContent = () => {
    // Editor check first — instant open before variant propagates.
    if (isEditing && focusedCol === COL.SIM_NOTIONAL) return sizingEditor()

    // Has active sizing → always render the sim $ figure, including
    // exactly $0 when the row is a CLOSE. Previously we rendered `—`
    // for `simNotional === 0`, which made a sold-to-zero row look
    // identical to an untouched/unknown row. $0 is the correct value
    // and should be shown.
    if (v?.sizing_input) {
      return (
        <span className={clsx(NUM, hasSizing ? 'font-medium text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500')}>
          {fmtNotional(row.simNotional)}
        </span>
      )
    }

    // No sizing: existing baseline → show current notional as sim notional.
    // New position with zero baseline → "enter size" placeholder.
    if (!row.isNew) {
      return (
        <span className={clsx(DIM, 'group-hover/row:text-gray-500 dark:group-hover/row:text-gray-400 transition-colors')}>
          {fmtNotional(row.simNotional)}
        </span>
      )
    }

    return (
      <span className="text-[13px] text-gray-300 dark:text-gray-600 italic">
        enter size
      </span>
    )
  }

  // Pending-sizing state: variant exists but no sizing has been entered yet
  // (e.g. user just checked an idea that had no proposed weight). Shown with
  // a softer tint + dashed left accent so the user can tell their click
  // landed and knows to enter a size.
  const isPendingSizing = !!v && !v.sizing_input

  const leftBorder = hasSizing && v
    ? `border-l-2 ${ACTION_BORDER[action]}`
    : isPendingSizing
      ? 'border-l-2 border-dashed border-l-primary-300 dark:border-l-primary-600'
      : 'border-l-2 border-l-transparent'

  return (
    <tr
      ref={rowRef}
      className={clsx(
        'group/row transition-colors duration-75',
        isEven ? ROW_EVEN : ROW_ODD,
        // New positions (not in baseline)
        row.isNew && !isFocused && (action === 'sell' || action === 'trim'
          ? '!bg-red-50 dark:!bg-red-950/20'
          : '!bg-emerald-50 dark:!bg-emerald-950/20'),
        // Existing positions with active sizing (ideas/recommendations)
        !row.isNew && hasSizing && !isFocused && !row.isRemoved && (action === 'sell' || action === 'trim'
          ? '!bg-amber-50/80 dark:!bg-amber-950/15'
          : '!bg-blue-50/80 dark:!bg-blue-950/15'),
        // Pending-sizing tint (lighter than active sizing, only when not
        // already painted by hasSizing / isNew branches above).
        !row.isNew && !hasSizing && isPendingSizing && !isFocused && !row.isRemoved &&
          '!bg-primary-50/40 dark:!bg-primary-950/10',
        row.isRemoved && '!bg-red-50 dark:!bg-red-950/20 opacity-50',
        !isFocused && 'hover:!bg-gray-100/70 dark:hover:!bg-white/[0.04]',
        isFocused && '!bg-primary-50/40 dark:!bg-primary-950/10',
      )}
    >
      {/* CHECKBOX column — only present when bulk-promote mode is active.
          Rows without sizing render an empty cell so column alignment stays
          stable. */}
      {showCheckboxCol && (
        <td
          className="pl-2 pr-1 py-1.5 w-6 align-middle"
          onClick={(e) => e.stopPropagation()}
        >
          {onTogglePromote && hasSizing && v ? (
            <input
              type="checkbox"
              checked={promoteSelected ?? false}
              onChange={(e) => { e.stopPropagation(); onTogglePromote(v.id) }}
              className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              title="Select for execution"
            />
          ) : null}
        </td>
      )}
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
            <span className="flex-shrink-0 flex items-center gap-0.5">
              <span
                className={clsx(
                  'px-1.5 py-px rounded-full text-[8px] font-bold uppercase tracking-wide text-center select-none shadow-sm whitespace-nowrap',
                  ACTION_BG[action],
                )}
              >{actionLabel(action, row.isNew, row.isRemoved)}</span>
              {row.hasIdeaDirectionConflict && !row.hasConflict && (
                <span
                  title={`Sizing conflicts with idea direction — idea intends to ${row.deltaShares > 0 ? 'sell/reduce' : 'buy/add'} but current sizing ${row.deltaShares > 0 ? 'increases' : 'decreases'} exposure`}
                  className="cursor-help"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                </span>
              )}
            </span>
          )}
          {row.acceptedTrade && (
            <AcceptedTradeBadge
              executionStatus={row.acceptedTrade.execution_status as ExecutionStatus}
              reconciliationStatus={row.acceptedTrade.reconciliation_status}
              className="flex-shrink-0"
            />
          )}
          {pairInfo && <PairBadge info={pairInfo} className="flex-shrink-0" />}
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
          'px-2 py-1.5 text-right whitespace-nowrap',
          cf(COL.SIM_WT),
          row.isCommittedPending
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-default',
          !v && !isFocused && !row.isCommittedPending && 'group-hover/row:[&_span]:underline group-hover/row:[&_span]:decoration-dashed group-hover/row:[&_span]:decoration-gray-300 dark:group-hover/row:[&_span]:decoration-gray-600 group-hover/row:[&_span]:underline-offset-2',
        )}
        title={row.isCommittedPending ? 'Committed trade pending — revert via Trade Book to edit' : undefined}
        onClick={() => onClickEditableCell(rowIndex, COL.SIM_WT, row.asset_id, !!v)}
      >{simWtContent()}</td>

      {/* SIM SHARES */}
      <td
        className={clsx(
          'px-2 py-1.5 text-right whitespace-nowrap',
          cf(COL.SIM_SHARES),
          row.isCommittedPending
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-default',
          !v && !isFocused && !row.isCommittedPending && 'group-hover/row:[&_span]:underline group-hover/row:[&_span]:decoration-dashed group-hover/row:[&_span]:decoration-gray-300 dark:group-hover/row:[&_span]:decoration-gray-600 group-hover/row:[&_span]:underline-offset-2',
        )}
        title={row.isCommittedPending ? 'Committed trade pending — revert via Trade Book to edit' : undefined}
        onClick={() => onClickEditableCell(rowIndex, COL.SIM_SHARES, row.asset_id, !!v)}
      >{simSharesContent()}</td>

      {/* SIM NOTIONAL — editable: type a dollar amount (accepts `$1M`,
          `500K`, `1,000,000`, etc.). Value is converted to shares using
          the row's effective price and stored as `#<shares>` in the
          variant's sizing_input so the server's normal sizing pipeline
          handles the rest. */}
      <td
        className={clsx(
          'px-2 py-1.5 text-right whitespace-nowrap',
          cf(COL.SIM_NOTIONAL),
          row.isCommittedPending
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-default',
          !v && !isFocused && !row.isCommittedPending && 'group-hover/row:[&_span]:underline group-hover/row:[&_span]:decoration-dashed group-hover/row:[&_span]:decoration-gray-300 dark:group-hover/row:[&_span]:decoration-gray-600 group-hover/row:[&_span]:underline-offset-2',
        )}
        title={row.isCommittedPending ? 'Committed trade pending — revert via Trade Book to edit' : undefined}
        onClick={() => onClickEditableCell(rowIndex, COL.SIM_NOTIONAL, row.asset_id, !!v)}
      >{simNotionalContent()}</td>

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

function GroupHeaderRow({ groupName, count, totalWeight, isCollapsed, onToggle, showCheckboxCol }: {
  groupName: string; count: number; totalWeight: number; isCollapsed: boolean; onToggle: () => void
  showCheckboxCol?: boolean
}) {
  return (
    <tr className="bg-gray-100/80 dark:bg-gray-800/60 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-75" onClick={onToggle}>
      <td className="px-3 py-1" colSpan={COL_COUNT + (showCheckboxCol ? 1 : 0)}>
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
  onSelect, onClose, inputRef, showCheckboxCol,
}: {
  search: string
  onSearchChange: (v: string) => void
  results: { id: string; symbol: string; company_name: string; sector: string | null }[]
  highlightIndex: number
  onHighlightChange: (i: number) => void
  onSelect: (asset: { id: string; symbol: string; company_name: string; sector: string | null }) => void
  onClose: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
  showCheckboxCol?: boolean
}) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  return (
    <tr className="bg-primary-50/30 dark:bg-primary-950/10">
      {showCheckboxCol && (
        <td className="pl-2 pr-1 py-1.5 w-6 border-t border-dashed border-primary-300 dark:border-primary-700" />
      )}
      <td className="pl-3 pr-2 py-1.5 border-l-2 border-l-primary-400 border-t border-dashed border-primary-300 dark:border-primary-700" colSpan={2}>
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
      <td colSpan={COL_COUNT - 2} className="px-2 py-1.5 border-t border-dashed border-primary-300 dark:border-primary-700">
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
// MAIN TABLE
// =============================================================================

export function HoldingsSimulationTable({
  rows, cashRow, tradedRows, untradedRows, newPositionRows, summary,
  portfolioTotalValue, hasBenchmark, priceMap,
  onUpdateVariant, onDeleteVariant, onRemoveAsset, onCreateVariant, onFixConflict,
  onSetCashTarget, onClearAllTrades,
  onAddAsset, assetSearchResults, onAssetSearchChange,
  onCreateTradeSheet, canCreateTradeSheet, isCreatingTradeSheet,
  groupBy: externalGroupBy, onGroupByChange, readOnly = false, className = '',
  suggestMode, onSubmitSuggestion, pendingSuggestionsByAsset, pendingSuggestionCount, onOpenSuggestionReview,
  onBulkPromote, isBulkPromoting, decisionConfirmationOpen,
  pairInfoByAsset,
}: HoldingsSimulationTableProps) {
  const [internalGroupBy, setInternalGroupBy] = useState<GroupBy>('none')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [focusRow, setFocusRow] = useState(-1)
  const [focusCol, setFocusCol] = useState(0)
  const [editing, setEditing] = useState(false)
  const [pendingEditAssetId, setPendingEditAssetId] = useState<string | null>(null)
  const [pendingEditCol, setPendingEditCol] = useState(COL.SIM_WT)

  // Execute confirmation modal
  const [showExecuteConfirm, setShowExecuteConfirm] = useState(false)
  // Track whether the user has actually clicked Execute inside the
  // modal — separates "modal is open with the form" from "modal is
  // mid-mutation." When true the modal swaps its body for a loading
  // state, locks dismiss handlers, and waits for `isBulkPromoting`
  // to flip false before closing. This keeps the transition into
  // the Decision Recorded modal smooth: form → loading → success,
  // never form → blank screen → success.
  const [executeSubmitted, setExecuteSubmitted] = useState(false)
  // Wall-clock at submit time, used to enforce a minimum display
  // period for the loading state. Without it, fast mutations close
  // the loading screen so quickly it reads as a flicker rather than
  // a deliberate "we're committing your decision" beat.
  const executeSubmittedAtRef = useRef<number | null>(null)
  // The loading modal stays up until BOTH:
  //   (a) the mutation finished (`!isBulkPromoting`), AND
  //   (b) either the parent has the success modal ready
  //       (`decisionConfirmationOpen`) or a small grace window
  //       elapsed (covers the error path so the loader doesn't
  //       hang forever, plus a min-display floor for the success
  //       path so the loading state is visibly long enough to feel
  //       like a real action.)
  useEffect(() => {
    if (!executeSubmitted) return
    if (isBulkPromoting) return
    const elapsed = Date.now() - (executeSubmittedAtRef.current ?? Date.now())
    const MIN_DISPLAY_MS = 700
    const SAFETY_FALLBACK_MS = 4000
    const closeNow = () => {
      setShowExecuteConfirm(false)
      setExecuteSubmitted(false)
      executeSubmittedAtRef.current = null
    }
    // Success path — confirmation modal is already mounted; honor
    // the minimum display floor and hand off cleanly.
    if (decisionConfirmationOpen) {
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed)
      if (remaining === 0) { closeNow(); return }
      const t = setTimeout(closeNow, remaining)
      return () => clearTimeout(t)
    }
    // No confirmation yet — likely an error path. Hold a moment in
    // case `decisionRecord` is still propagating, then close anyway.
    const fallbackRemaining = Math.max(MIN_DISPLAY_MS, SAFETY_FALLBACK_MS - elapsed)
    const t = setTimeout(closeNow, fallbackRemaining)
    return () => clearTimeout(t)
  }, [executeSubmitted, isBulkPromoting, decisionConfirmationOpen])
  // Optional batch name the PM can type in the Execute Trades modal.
  // Passed through to executeSimVariants so the resulting trade_batch
  // row is labelled in the Trade Book. Cleared on every modal open.
  const [executeBatchName, setExecuteBatchName] = useState('')
  // Optional batch-level rationale — the overall "why" behind the
  // whole batch. Lands on trade_batch.description in the Trade Book.
  const [executeBatchDescription, setExecuteBatchDescription] = useState('')
  // Optional per-row rationale / why-now for each committed trade.
  // Keyed by variant id. Empty entries mean "PM will contextualize
  // later in Trade Book / Outcomes." Cleared on modal open.
  const [executeReasons, setExecuteReasons] = useState<Record<string, string>>({})

  // Clear-all confirmation modal — styled, app-native, matches the
  // Execute Trades modal pattern instead of using window.confirm.
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Summary bar expansion (inlined into the sticky tfoot so it shares the
  // same DOM block as the totals row — no gap between them).
  const [summaryExpanded, setSummaryExpanded] = useState(false)

  // Cash row inline editor: the synthetic CASH_USD row isn't tied to a
  // variant, so it bypasses the normal sizingEditor flow. The PM types a
  // target cash weight (or shares via `#` prefix → weight via
  // notional/total) and on commit we call onSetCashTarget to fan the
  // delta out pro-rata across every non-cash baseline holding.
  const [editingCash, setEditingCash] = useState(false)
  const [cashEditValue, setCashEditValue] = useState('')

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

  // Promote state (Trade Book)
  const [selectedForPromote, setSelectedForPromote] = useState<Set<string>>(new Set())
  const togglePromoteSelection = useCallback((variantId: string) => {
    setSelectedForPromote(prev => {
      const next = new Set(prev)
      next.has(variantId) ? next.delete(variantId) : next.add(variantId)
      return next
    })
  }, [])
  const promotableRows = useMemo(() =>
    rows.filter(r => r.variant?.sizing_input && !r.isCash),
    [rows]
  )

  // Prune the selection against the current variant set. When a bulk
  // execute commits a subset of selected trades, those variants vanish
  // from `rows` on the next render — we drop them from the checked set
  // so only the leftover (failed or pending) ones stay visually
  // selected. Conversely, if execute fails wholesale and the variants
  // remain, the selection is untouched, so the user can retry without
  // re-checking anything.
  useEffect(() => {
    if (selectedForPromote.size === 0) return
    const liveVariantIds = new Set(
      rows
        .map(r => r.variant?.id)
        .filter((id): id is string => !!id),
    )
    let changed = false
    const next = new Set<string>()
    for (const id of selectedForPromote) {
      if (liveVariantIds.has(id)) {
        next.add(id)
      } else {
        changed = true
      }
    }
    if (changed) setSelectedForPromote(next)
  }, [rows, selectedForPromote])

  // Dedicated checkbox column — only rendered when the user can actually
  // bulk-promote. In shared/readonly/suggest views the column is hidden.
  const showCheckboxCol = !readOnly && !suggestMode && !!onBulkPromote

  // Select-all state: 'none' | 'some' | 'all'. Drives the header checkbox's
  // checked + indeterminate attributes. Computed against promotableRows so
  // untraded rows are not part of the denominator.
  const selectAllState: 'none' | 'some' | 'all' = useMemo(() => {
    if (promotableRows.length === 0 || selectedForPromote.size === 0) return 'none'
    const allSelected = promotableRows.every(r => r.variant && selectedForPromote.has(r.variant.id))
    if (allSelected) return 'all'
    return 'some'
  }, [promotableRows, selectedForPromote])

  const toggleSelectAll = useCallback(() => {
    setSelectedForPromote(prev => {
      // If anything is currently selected, clear. Otherwise select all
      // promotable rows. Matches the behavior of a tri-state select-all.
      if (prev.size > 0) return new Set()
      const next = new Set<string>()
      for (const r of promotableRows) {
        if (r.variant) next.add(r.variant.id)
      }
      return next
    })
  }, [promotableRows])

  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())

  // Stable row order: preserve existing positions across refetches/cache churn.
  // New rows append at end; temporarily missing rows are retained from the
  // previous snapshot to prevent flicker during cache transitions.
  const rowOrderRef = useRef<string[]>([])
  const lastRowSnapshotRef = useRef<Map<string, SimulationRow>>(new Map())
  // Tracks asset IDs that were missing from `rows` but retained from snapshot.
  // If still missing on the NEXT render, they're dropped for real.
  const graceSetRef = useRef<Set<string>>(new Set())
  const stableRows = useMemo(() => {
    const knownOrder = rowOrderRef.current
    const rowMap = new Map(rows.map(r => [r.asset_id, r]))
    const prevSnapshot = lastRowSnapshotRef.current
    const prevGrace = graceSetRef.current
    const nextGrace = new Set<string>()

    const result: SimulationRow[] = []
    const seen = new Set<string>()

    // Keep existing rows in their known order
    for (const id of knownOrder) {
      const row = rowMap.get(id)
      if (row) {
        result.push(row)
        seen.add(id)
      } else if (!prevGrace.has(id)) {
        // First render missing — grace: retain last known version
        const prev = prevSnapshot.get(id)
        if (prev) {
          result.push(prev)
          seen.add(id)
          nextGrace.add(id)
        }
      }
      // else: was in grace last render AND still missing → drop it
    }

    // Append new rows at end
    for (const row of rows) {
      if (!seen.has(row.asset_id)) {
        result.push(row)
      }
    }

    // Sync refs
    graceSetRef.current = nextGrace
    rowOrderRef.current = result.map(r => r.asset_id)
    lastRowSnapshotRef.current = new Map(result.map(r => [r.asset_id, r]))

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
        activeFilters.every(([col, term]) => {
          // Try numeric comparison first (>4, <=2.5, etc.)
          const numericResult = matchesNumericFilter(row, col, term.trim())
          if (numericResult !== null) return numericResult
          // Fall back to text match
          return getFilterValue(row, col).toLowerCase().includes(term.toLowerCase())
        })
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

  // Only scroll focused row into view for keyboard navigation.
  // Mouse clicks don't need scrollIntoView — the clicked row is already visible.
  const focusSourceRef = useRef<'keyboard' | 'mouse' | null>(null)
  useEffect(() => {
    if (focusRow >= 0 && focusSourceRef.current === 'keyboard') {
      rowRefs.current.get(focusRow)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    focusSourceRef.current = null
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

  // Delete variant if user exits editing without entering a value.
  // Uses a ref to prevent double-firing from both input blur and container blur.
  const cleanupInFlightRef = useRef(false)
  const cleanupEmptyVariant = useCallback((rowIdx: number) => {
    if (committedEditRef.current) return // Edit was committed — don't delete the variant
    if (cleanupInFlightRef.current) return // Already cleaning up from another blur path
    if (rowIdx < 0 || rowIdx >= displayRows.length) return
    const row = displayRows[rowIdx]
    if (!row?.variant || row.variant.sizing_input) return // Has content — keep it
    // Delete empty variants that have no backing trade idea.
    if (!row.variant.trade_queue_item_id) {
      cleanupInFlightRef.current = true
      // Defer the delete so the UI settles before the row shifts
      requestAnimationFrame(() => {
        onDeleteVariant(row.variant!.id)
        cleanupInFlightRef.current = false
      })
    }
  }, [displayRows, onDeleteVariant])

  const focusCell = useCallback((r: number, c: number) => {
    if (editing && focusRow >= 0) cleanupEmptyVariant(focusRow)
    setFocusRow(r); setFocusCol(c); setEditing(false)
  }, [editing, focusRow, cleanupEmptyVariant])

  const activateCell = useCallback((r: number, c: number) => {
    if (readOnly && !suggestMode) return
    if (r < 0 || r >= displayRows.length) return
    const row = displayRows[r]
    if (c === COL.SIM_WT || c === COL.SIM_SHARES || c === COL.SIM_NOTIONAL) {
      if (suggestMode) {
        // Suggest mode: open inline editor for suggestion input (no variant needed)
        setFocusRow(r)
        setFocusCol(c)
        setEditing(true)
        return
      }
      if (row.variant) {
        setEditing(true)
      } else {
        // onCreateVariant inserts a temp variant optimistically — open editor instantly
        onCreateVariant(row.asset_id, 'add')
        setEditing(true)
        setPendingEditAssetId(row.asset_id)
        setPendingEditCol(c)
      }
    }
  }, [readOnly, suggestMode, displayRows, onCreateVariant])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (readOnly && !suggestMode && (e.key === 'Enter' || e.key === 'e' || e.key === 'Delete' || e.key === 'Backspace')) return
    if (readOnly && suggestMode && (e.key === 'Delete' || e.key === 'Backspace')) return // Suggest mode: allow Enter/e but not Delete
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); cleanupEmptyVariant(focusRow); setEditing(false) }
      else if (e.key === 'Tab') {
        e.preventDefault(); cleanupEmptyVariant(focusRow); setEditing(false)
        const next = e.shiftKey ? Math.max(focusRow - 1, 0) : Math.min(focusRow + 1, displayRows.length - 1)
        focusSourceRef.current = 'keyboard'; setFocusRow(next)
        // Keep same column so Tab advances down the same editable column
        if (displayRows[next]?.variant) setEditing(true)
      }
      return
    }

    const maxRow = displayRows.length - 1
    const kbFocus = (fn: (prev: number) => number) => { focusSourceRef.current = 'keyboard'; setFocusRow(fn) }

    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); kbFocus(p => Math.min(p + 1, maxRow)); break
      case 'ArrowUp': case 'k': e.preventDefault(); kbFocus(p => Math.max(p - 1, 0)); break
      case 'ArrowRight': case 'l': e.preventDefault(); setFocusCol(p => Math.min(p + 1, COL_COUNT - 1)); break
      case 'ArrowLeft': case 'h': e.preventDefault(); setFocusCol(p => Math.max(p - 1, 0)); break
      case 'Enter': e.preventDefault(); activateCell(focusRow, focusCol); break
      case 'e':
        if (focusRow >= 0 && displayRows[focusRow]?.variant && !displayRows[focusRow]?.isCommittedPending) {
          e.preventDefault()
          // If already on an editable col, stay there; otherwise default to SIM_WT
          if (focusCol !== COL.SIM_WT && focusCol !== COL.SIM_SHARES && focusCol !== COL.SIM_NOTIONAL) setFocusCol(COL.SIM_WT)
          setEditing(true)
        }
        break
      case 'Delete': case 'Backspace': {
        if (focusRow < 0) break
        const delRow = displayRows[focusRow]
        if (!delRow) break
        // Locked: committed-pending rows must be reverted via Trade Book
        if (delRow.isCommittedPending) break
        e.preventDefault()
        if (delRow.baseline && !delRow.isNew) {
          // Existing position: remove variant + simulation_trade to revert to baseline.
          // To sell to 0%, the user should explicitly enter 0 in the sizing input.
          if (delRow.variant) {
            // Remove both simulation_trade and variant so row reverts fully to baseline
            if (onRemoveAsset) onRemoveAsset(delRow.asset_id)
            onDeleteVariant(delRow.variant.id)
          }
          // If no variant exists, row is already at baseline — nothing to do
        } else if (delRow.variant) {
          // New position (no baseline): remove from simulation entirely
          if (onRemoveAsset) {
            onRemoveAsset(delRow.asset_id)
          } else {
            onDeleteVariant(delRow.variant.id)
          }
        }
        break
      }
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
      case 'Home': e.preventDefault(); e.ctrlKey ? (focusSourceRef.current = 'keyboard', setFocusRow(0), setFocusCol(0)) : setFocusCol(0); break
      case 'End': e.preventDefault(); e.ctrlKey ? (focusSourceRef.current = 'keyboard', setFocusRow(maxRow), setFocusCol(COL_COUNT - 1)) : setFocusCol(COL_COUNT - 1); break
    }
  }, [displayRows, focusRow, focusCol, editing, activateCell, onDeleteVariant, cleanupEmptyVariant])

  const setRowRef = useCallback((i: number) => (el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(i, el); else rowRefs.current.delete(i)
  }, [])

  const handleCreateVariantAndEdit = useCallback((assetId: string, col: number = COL.SIM_WT) => {
    onCreateVariant(assetId, 'add'); setPendingEditAssetId(assetId); setPendingEditCol(col)
  }, [onCreateVariant])

  // Combined focus + edit for mouse clicks on editable cells.
  // Avoids the focusCell (editing=false) → onStartEdit (editing=true) split
  // which can race with cleanupEmptyVariant deleting the variant mid-batch.
  // For untraded rows, onCreateVariant inserts a temp variant optimistically
  // so the editor opens instantly in the same render cycle.
  const handleClickEditable = useCallback((r: number, c: number, assetId: string, hasVariant: boolean) => {
    if (readOnly && !suggestMode) { setFocusRow(r); setFocusCol(c); return }
    // Committed-pending rows: an accepted_trade is in flight for this asset.
    // Editing is locked — the PM must revert the pending trade in the Trade
    // Book before making further changes to this position. Allow focus so
    // the row stays keyboard-navigable.
    const rowData = displayRows[r]
    if (rowData?.isCommittedPending) {
      setFocusRow(r); setFocusCol(c); return
    }
    if (suggestMode) {
      // Suggest mode: just open the editor — no variant needed
      setFocusRow(r); setFocusCol(c); setEditing(true)
      return
    }
    // Clean up previous row's empty variant only when moving to a different row
    if (editing && focusRow >= 0 && focusRow !== r) cleanupEmptyVariant(focusRow)
    setFocusRow(r)
    setFocusCol(c)
    if (hasVariant) {
      setEditing(true)
    } else {
      // onCreateVariant inserts a temp variant into the cache, so the row will
      // have a variant by next render. Open editor immediately — pendingEditAssetId
      // serves as a fallback in case the temp variant hasn't propagated yet.
      onCreateVariant(assetId, 'add')
      setEditing(true)
      setPendingEditAssetId(assetId)
      setPendingEditCol(c)
    }
  }, [editing, focusRow, cleanupEmptyVariant, onCreateVariant, readOnly, suggestMode, displayRows])

  const handleStopEdit = useCallback((committedValue?: string) => {
    if (suggestMode) {
      setEditing(false)
      containerRef.current?.focus({ preventScroll: true })
      return
    }
    if (committedValue) {
      committedEditRef.current = true
    } else if (!committedEditRef.current) {
      cleanupEmptyVariant(focusRow)
    }
    setEditing(false)
    // Refocus the table container so arrow keys work immediately.
    // Use preventScroll to avoid jumping the scroll position.
    requestAnimationFrame(() => containerRef.current?.focus({ preventScroll: true }))
  }, [focusRow, cleanupEmptyVariant, suggestMode])

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

  // Footer totals computed from displayRows (respects filters) + cash row
  const totals = useMemo(() => {
    const src = displayRows
    const cashWt = cashRow?.simWeight ?? 0
    const cashDeltaWt = cashRow?.deltaWeight ?? 0
    return {
      shares: src.reduce((s, r) => s + r.currentShares, 0),
      weight: src.reduce((s, r) => s + r.currentWeight, 0) + (cashRow?.currentWeight ?? 0),
      bench: src.reduce((s, r) => s + (r.benchWeight ?? 0), 0),
      active: src.reduce((s, r) => s + (r.activeWeight ?? 0), 0),
      simWt: src.reduce((s, r) => s + r.simWeight, 0) + cashWt,
      simNotional: src.reduce((s, r) => s + r.simNotional, 0) + (cashRow?.simNotional ?? 0),
      deltaWt: src.reduce((s, r) => s + r.deltaWeight, 0) + cashDeltaWt,
      notional: src.reduce((s, r) => s + r.notional, 0),
    }
  }, [displayRows, cashRow])

  const renderRow = (row: SimulationRow, idx: number) => (
    <HoldingRow
      key={row.asset_id} row={row} rowIndex={idx} isEven={idx % 2 === 0}
      focusedCol={focusRow === idx ? focusCol : null} isEditing={focusRow === idx && editing}
      onUpdateVariant={onUpdateVariant}
      onFocusCell={focusCell} onStartEdit={() => setEditing(true)} onStopEdit={handleStopEdit}
      onCreateVariantAndEdit={handleCreateVariantAndEdit} onClickEditableCell={handleClickEditable} rowRef={setRowRef(idx)}
      suggestMode={suggestMode}
      onSubmitSuggestion={onSubmitSuggestion}
      pendingSuggestions={pendingSuggestionsByAsset?.get(row.asset_id)}
      onOpenSuggestionReview={onOpenSuggestionReview}
      promoteSelected={row.variant ? selectedForPromote.has(row.variant.id) : false}
      onTogglePromote={!readOnly && !suggestMode && onBulkPromote ? togglePromoteSelection : undefined}
      showCheckboxCol={showCheckboxCol}
      pairInfo={pairInfoByAsset?.get(row.asset_id)}
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
          if (focusRow >= 0 && !suggestMode) cleanupEmptyVariant(focusRow)
          setEditing(false)
          // Defer focus row reset so the cleanup animation frame runs first,
          // preventing a flash where the row loses focus highlight before deletion
          requestAnimationFrame(() => setFocusRow(-1))
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
                            {row.variant?.proposal_id && (
                              <FileCheck className="h-3 w-3 text-teal-500 dark:text-teal-400 shrink-0" title="From analyst recommendation" />
                            )}
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

        {/* Suggestions badge (owner view) */}
        {!suggestMode && pendingSuggestionCount != null && pendingSuggestionCount > 0 && (
          <button
            onClick={onOpenSuggestionReview}
            className="text-[11px] font-medium tabular-nums px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors cursor-pointer flex items-center gap-1"
          >
            <MessageSquare className="h-3 w-3" />
            {pendingSuggestionCount} suggestion{pendingSuggestionCount !== 1 ? 's' : ''}
          </button>
        )}

        {/* Cash-negative badge — compact warning that the simulation's staged
            buys exceed available cash. Shows the shortfall in dollars as a
            tooltip so the user can size the fix without the big banner. */}
        {cashRow && (cashRow.simNotional < -0.005 || cashRow.simWeight < -0.005) && (
          <span
            title={`Cash is negative by ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(cashRow.simNotional))}. Reduce a buy, add a trim, or raise the target cash weight.`}
            className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 flex items-center gap-1 border border-red-200/70 dark:border-red-800/40"
          >
            <AlertTriangle className="h-3 w-3" />
            Cash negative
          </span>
        )}

        {/* Execute Trades — commit checked trades to Trade Book */}
        {!readOnly && !suggestMode && onBulkPromote && promotableRows.length > 0 && (
          <button
            onClick={() => {
              if (selectedForPromote.size === 0) return
              setExecuteBatchName('')
              setExecuteBatchDescription('')
              setExecuteReasons({})
              setShowExecuteConfirm(true)
            }}
            disabled={selectedForPromote.size === 0 || isBulkPromoting}
            title="Commit selected trades to Trade Book for execution"
            className={clsx(
              'text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors flex items-center gap-1',
              selectedForPromote.size > 0
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm cursor-pointer'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-default'
            )}
          >
            <CheckCircle2 className="h-3 w-3" />
            {isBulkPromoting
              ? 'Executing...'
              : selectedForPromote.size > 0
                ? `Execute ${selectedForPromote.size} Trade${selectedForPromote.size !== 1 ? 's' : ''}`
                : 'Execute Trades'}
          </button>
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
        {/* border-separate + border-spacing-0 instead of border-collapse.
            Rationale: border-collapse breaks sticky row backgrounds — the
            browser composites the collapsed-border layer over the cell bg,
            producing 1-2px edge bleed on sticky thead/tfoot. With
            border-separate, sticky works cleanly. Cost: borders on <tr>
            don't render in this box model, so row separators have to live
            on the tds. The filter row, cash row, phantom row, and tfoot
            are all migrated accordingly. */}
        <table className="w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-20 bg-white dark:bg-gray-900 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {/* Column headers */}
            <tr className="bg-white dark:bg-gray-900">
              {/* Empty th to keep alignment — the select-all lives in the
                  filter row below. */}
              {showCheckboxCol && (
                <th className="pl-2 pr-1 py-2.5 w-6 bg-white dark:bg-gray-900" />
              )}
              {COLUMNS.map((col) => {
                const colIdx = COL[col.key]
                const isSorted = sortCol === col.key
                const isEditable = col.key === 'SIM_WT' || col.key === 'SIM_SHARES' || col.key === 'SIM_NOTIONAL'
                return (
                  <th
                    key={col.key}
                    className={clsx(
                      'group/th px-2 py-2.5 whitespace-nowrap select-none bg-white dark:bg-gray-900',
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

            {/* Filter row — always visible, solid bg so content doesn't show through */}
            <tr className="bg-gray-100 dark:bg-gray-800">
              {/* Select-all checkbox. Tri-state: none / some / all. Clicking
                  clears selection if anything is selected, otherwise selects
                  every row with sizing. Lives in the filter row for better
                  vertical alignment with per-row checkboxes. */}
              {showCheckboxCol && (
                <td className="pl-2 pr-1 py-0.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 w-6 align-middle">
                  <input
                    type="checkbox"
                    ref={(el) => { if (el) el.indeterminate = selectAllState === 'some' }}
                    checked={selectAllState === 'all'}
                    onChange={toggleSelectAll}
                    disabled={promotableRows.length === 0}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title={selectAllState === 'all' ? 'Clear selection' : 'Select all trades'}
                  />
                </td>
              )}
              {COLUMNS.map((col) => (
                <td key={col.key} className={clsx('px-2 py-0.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700', col.key === 'SYMBOL' && 'pl-3')}>
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
                <td colSpan={COL_COUNT + (showCheckboxCol ? 1 : 0)} className="px-4 py-20 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <Plus className="w-6 h-6 text-gray-300 dark:text-gray-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No holdings yet</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Add a trade to start building your simulation</p>
                    </div>
                    {!readOnly && (
                      <button onClick={handleShowPhantom}
                        className="text-[13px] font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 px-4 py-1.5 rounded-full border border-primary-200 dark:border-primary-800 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                      >+ Add a trade</button>
                    )}
                  </div>
                </td>
              </tr>
            ) : displayRows.length === 0 && rows.length > 0 && !showPhantomRow ? (
              <tr>
                <td colSpan={COL_COUNT + (showCheckboxCol ? 1 : 0)} className="px-4 py-12 text-center">
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
                        isCollapsed={collapsedGroups.has(group.name)} onToggle={() => toggleGroup(group.name)}
                        showCheckboxCol={showCheckboxCol} />
                      {!collapsedGroups.has(group.name) && group.rows.map(row => renderRow(row, flatIdx++))}
                    </React.Fragment>
                  ))
                })() : displayRows.map((row, idx) => renderRow(row, idx))}
              </>
            )}

            {/* Phantom row for inline asset search */}
            {!readOnly && showPhantomRow && (
              <PhantomRow
                search={phantomSearch}
                onSearchChange={(v) => { setPhantomSearch(v); onAssetSearchChange?.(v) }}
                results={assetSearchResults || []}
                highlightIndex={phantomHighlight}
                onHighlightChange={setPhantomHighlight}
                onSelect={handlePhantomSelect}
                onClose={handlePhantomClose}
                inputRef={phantomInputRef}
                showCheckboxCol={showCheckboxCol}
              />
            )}

            {/* Synthetic cash row — pinned at bottom, shows net cash impact of trades */}
            {cashRow && (() => {
              // With border-separate, row-level borders don't render. The
              // top dashed separator lives on every td instead.
              const cashIsNegative = cashRow.simNotional < -0.005 || cashRow.simWeight < -0.005
              const cashSep = clsx(
                'border-t border-dashed',
                cashIsNegative
                  ? 'border-red-300 dark:border-red-700/60 bg-red-50/70 dark:bg-red-900/20'
                  : 'border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/40'
              )
              return (
              <tr>
                {showCheckboxCol && <td className={clsx('px-2 py-1.5 w-6', cashSep)} />}
                <td className={clsx('pl-3 pr-2 py-1.5 border-l-2 whitespace-nowrap', cashSep, cashIsNegative ? 'border-l-red-500' : 'border-l-transparent')}>
                  <span className={clsx('text-[13px] font-semibold inline-flex items-center gap-1', cashIsNegative ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300')}>
                    {cashIsNegative && <AlertTriangle className="h-3 w-3" />}
                    CASH_USD
                  </span>
                </td>
                <td className={clsx('px-2 py-1.5 whitespace-nowrap', cashSep)}>
                  <span className={clsx('text-[12px]', cashIsNegative ? 'text-red-600 dark:text-red-300/80' : 'text-gray-400 dark:text-gray-500')}>
                    {cashIsNegative ? 'Over-invested — cash is negative' : 'Cash & Equivalents'}
                  </span>
                </td>
                {/* Shares — not applicable */}
                <td className={clsx('px-2 py-1.5', cashSep)} />
                {/* Wt% */}
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cashSep)}>
                  <span className={DIM}>{cashRow.currentWeight !== 0 ? fmtWt(cashRow.currentWeight) : '—'}</span>
                </td>
                {/* Bench */}
                <td className={clsx('px-2 py-1.5', cashSep)} />
                {/* Active */}
                <td className={clsx('px-2 py-1.5', cashSep)} />
                {/* Sim Wt — editable: click to set a target cash weight that
                    rebalances every non-cash position pro-rata. */}
                <td
                  className={clsx(
                    'px-2 py-1.5 text-right whitespace-nowrap',
                    cashSep,
                    onSetCashTarget && !readOnly && 'cursor-pointer hover:bg-primary-50/40 dark:hover:bg-primary-900/10',
                  )}
                  onClick={() => {
                    if (!onSetCashTarget || readOnly) return
                    setCashEditValue(
                      Math.abs(cashRow.simWeight) < 0.005 ? '0' : cashRow.simWeight.toFixed(2),
                    )
                    setEditingCash(true)
                  }}
                  title={onSetCashTarget && !readOnly ? 'Click to set a target cash weight — rebalances all positions pro-rata' : undefined}
                >
                  {editingCash && onSetCashTarget ? (
                    <input
                      type="text"
                      autoFocus
                      value={cashEditValue}
                      onChange={(e) => setCashEditValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => {
                        const parsed = parseFloat(cashEditValue.replace(/[%\s]/g, ''))
                        setEditingCash(false)
                        if (!Number.isFinite(parsed)) return
                        // Clamp to [0, 100] — negative cash or >100% cash don't
                        // describe a realizable rebalance.
                        const clamped = Math.max(0, Math.min(100, parsed))
                        onSetCashTarget!(clamped)
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Escape') { setEditingCash(false); return }
                        if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
                      }}
                      placeholder="5"
                      className="w-16 h-5 text-[13px] font-mono tabular-nums text-right px-1.5 -my-0.5 rounded border border-primary-400 dark:border-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-400"
                    />
                  ) : (
                    <span className={clsx(NUM, cashIsNegative ? 'text-red-700 dark:text-red-300 font-semibold' : 'text-gray-600 dark:text-gray-300')}>
                      {fmtWt(cashRow.simWeight)}
                    </span>
                  )}
                </td>
                {/* Sim Shrs — not applicable */}
                <td className={clsx('px-2 py-1.5', cashSep)} />
                {/* Sim $ — post-trade cash value. When cash is negative
                    the real (signed) figure is shown in red so the user
                    can see exactly how much they're over-invested by. */}
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cashSep)}>
                  <span className={clsx(NUM, 'font-medium', cashIsNegative ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300')}>
                    {fmtNotional(cashRow.simNotional)}
                  </span>
                </td>
                {/* Δ Wt */}
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cashSep)}>
                  <span className={clsx(NUM, 'font-medium', dc(cashRow.deltaWeight))}>{fmtWt(cashRow.deltaWeight, true)}</span>
                </td>
                {/* Δ Shrs — not applicable */}
                <td className={clsx('px-2 py-1.5', cashSep)} />
                {/* Δ $ */}
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', cashSep)}>
                  <span className={clsx(NUM, 'font-medium', dc(cashRow.notional))}>{fmtNotional(cashRow.notional)}</span>
                </td>
              </tr>
              )
            })()}
          </tbody>

          {displayRows.length > 0 && (() => {
            // Combined sticky footer: summary bar + totals row, both in the
            // same <tfoot> so there's zero visual gap between them. With
            // border-separate + border-spacing-0 sticky works cleanly.
            // Each td carries its own bg (tr bg doesn't reliably paint
            // during sticky layout) and totals cells carry their own top
            // border (tr borders don't render in border-separate).
            const hasSummaryBar = !readOnly && rows.length > 0
            // Combined row: Add Trade + positions + totals all on one line.
            // 2px top border is the visual boundary with scrolling content.
            const footCell = 'bg-gray-100 dark:bg-gray-800 border-t-2 border-gray-300 dark:border-gray-600'
            const buys = tradedRows.filter(r => r.derivedAction === 'buy' || r.derivedAction === 'add')
            const sells = tradedRows.filter(r => r.derivedAction === 'sell' || r.derivedAction === 'trim')
            return (
            <tfoot className="sticky bottom-0 z-10">
              {/* Single combined row: Add Trade + positions count occupy the
                  Symbol + Name columns, totals fill the remaining columns.
                  Everything on one line. */}
              <tr>
                {/* Leading empty td to align with the checkbox column. */}
                {showCheckboxCol && <td className={clsx('px-2 py-1.5 w-6', footCell)} />}
                {/* Symbol column → Add Trade button (or empty in readOnly) */}
                <td className={clsx('pl-3 pr-2 py-1.5 whitespace-nowrap', footCell)}>
                  {hasSummaryBar && (
                    <button
                      onClick={handleShowPhantom}
                      tabIndex={-1}
                      className="inline-flex items-center gap-1 text-[11px] text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-semibold transition-colors"
                    >
                      <Plus className="w-3 h-3" />Add Trade
                    </button>
                  )}
                </td>
                {/* Name column → positions count + buys/sells + Show trades toggle */}
                <td className={clsx('px-2 py-1.5 whitespace-nowrap', footCell)}>
                  <div className="flex items-center gap-2 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                    <span>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">{summary.totalPositions}</span> positions
                    </span>
                    {summary.tradedCount > 0 && (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                        <span>
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">{buys.length}</span>
                          <span className="text-gray-400 dark:text-gray-500"> buy{buys.length !== 1 ? 's' : ''}</span>
                        </span>
                        <span>
                          <span className="font-medium text-red-600 dark:text-red-400">{sells.length}</span>
                          <span className="text-gray-400 dark:text-gray-500"> sell{sells.length !== 1 ? 's' : ''}</span>
                        </span>
                        {hasSummaryBar && (
                          <button
                            onClick={() => setSummaryExpanded(p => !p)}
                            tabIndex={-1}
                            className="flex items-center gap-0.5 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ml-1"
                            title={summaryExpanded ? 'Hide trades' : 'Show trades'}
                          >
                            {summaryExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                        )}
                        {hasSummaryBar && onClearAllTrades && (
                          <>
                            <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                            <button
                              onClick={() => setShowClearConfirm(true)}
                              tabIndex={-1}
                              className="text-[11px] font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors ml-1"
                              title="Remove every pending trade from the simulation"
                            >
                              Clear all
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </td>
                {/* Totals — aligned to their columns */}
                {/* Shares — no total (summing share counts across tickers
                    isn't a meaningful number for the PM). Matches Sim Shrs
                    and Δ Shrs which are also blank in the footer. */}
                <td className={clsx('px-2 py-1.5', footCell)} />
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', footCell)}>
                  <span className={clsx(NUM, 'font-semibold text-gray-600 dark:text-gray-300')}>{fmtWt(totals.weight)}</span>
                </td>
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', footCell)}>
                  <span className={clsx(NUM, 'text-gray-500 dark:text-gray-400')}>{fmtWt(totals.bench)}</span>
                </td>
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', footCell)}>
                  <span className={clsx(NUM, 'text-gray-500 dark:text-gray-400')}>{fmtWt(totals.active, true)}</span>
                </td>
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', footCell)}>
                  <span className={clsx(NUM, 'font-semibold text-gray-600 dark:text-gray-300')}>{fmtWt(totals.simWt)}</span>
                </td>
                {/* Sim Shrs — no total */}
                <td className={clsx('px-2 py-1.5', footCell)} />
                {/* Sim $ total — total portfolio value at simulated prices */}
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', footCell)}>
                  <span className={clsx(NUM, 'font-semibold text-gray-600 dark:text-gray-300')}>
                    {fmtNotional(totals.simNotional)}
                  </span>
                </td>
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', footCell)}>
                  <span className={clsx(NUM, 'font-semibold', totals.deltaWt !== 0 ? dc(totals.deltaWt) : 'text-gray-500 dark:text-gray-400')}>{fmtWt(totals.deltaWt, true)}</span>
                </td>
                {/* Δ Shrs — no total */}
                <td className={clsx('px-2 py-1.5', footCell)} />
                <td className={clsx('px-2 py-1.5 text-right whitespace-nowrap', footCell)}>
                  <span className={clsx(NUM, 'font-semibold', totals.notional !== 0 ? dc(totals.notional) : 'text-gray-500 dark:text-gray-400')}>{totals.notional !== 0 ? fmtNotional(totals.notional) : '$0'}</span>
                </td>
              </tr>

              {/* Expanded trade list — optional second row below the combined bar */}
              {hasSummaryBar && summaryExpanded && summary.tradedCount > 0 && (
                <tr>
                  <td colSpan={COL_COUNT + (showCheckboxCol ? 1 : 0)} className="bg-gray-100 dark:bg-gray-800 border-t border-gray-200/60 dark:border-gray-700/40">
                    <div className="max-h-[11rem] overflow-y-auto">
                      <table className="w-full text-[11px] tabular-nums border-separate border-spacing-0">
                        <thead>
                          <tr>
                            <th className="px-3 py-1.5 text-left text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">Action</th>
                            <th className="px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">Symbol</th>
                            <th className="px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">Name</th>
                            <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">Δ Wt</th>
                            <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">Δ Shrs</th>
                            <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 pr-3 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">Δ $</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tradedRows.map((row, i) => {
                            const action = row.derivedAction
                            const isBuy = action === 'buy' || action === 'add'
                            return (
                              <tr key={row.asset_id} className={clsx(i % 2 === 0 ? ROW_EVEN : ROW_ODD)}>
                                <td className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700/30">
                                  <span className={clsx(
                                    'inline-block font-bold uppercase text-[8px] px-1.5 py-0.5 rounded-full whitespace-nowrap',
                                    isBuy ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                           : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                  )}>{actionLabel(action, row.isNew, row.isRemoved)}</span>
                                </td>
                                <td className="px-2 py-1.5 font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700/30">{row.symbol}</td>
                                <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 truncate max-w-[10rem] border-b border-gray-100 dark:border-gray-700/30">{row.company_name}</td>
                                <td className={clsx('px-2 py-1.5 text-right font-medium border-b border-gray-100 dark:border-gray-700/30', row.deltaWeight !== 0 ? dc(row.deltaWeight) : 'text-gray-400 dark:text-gray-500')}>{fmtWt(row.deltaWeight, true)}</td>
                                <td className={clsx('px-2 py-1.5 text-right font-medium border-b border-gray-100 dark:border-gray-700/30', row.deltaShares !== 0 ? dc(row.deltaShares) : 'text-gray-400 dark:text-gray-500')}>{fmtShares(row.deltaShares, true)}</td>
                                <td className={clsx('px-2 py-1.5 text-right pr-3 font-medium border-b border-gray-100 dark:border-gray-700/30', row.notional !== 0 ? dc(row.notional) : 'text-gray-400 dark:text-gray-500')}>{row.notional !== 0 ? fmtNotional(row.notional) : '$0'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
            </tfoot>
            )
          })()}

        </table>
      </div>

      {/* Summary bar is now inlined into the sticky <tfoot> above — no
          separate panel here. See the tfoot render for the Add Trade
          button + stats + expandable trade list. */}

      {/* Execute Trades Confirmation Modal */}
      {showExecuteConfirm && onBulkPromote && (() => {
        const selectedRows = rows.filter(r => r.variant && selectedForPromote.has(r.variant.id))
        const totalNotional = selectedRows.reduce((s, r) => s + Math.abs(r.notional), 0)
        // Signed cash impact: buys consume cash (negative), sells add cash
        // (positive). row.notional is already signed (positive for buys,
        // negative for sells), so cash impact = -sum(notional).
        const netNotional = selectedRows.reduce((s, r) => s + r.notional, 0)
        const cashImpact = -netNotional
        const fmtN = (v: number) => {
          const abs = Math.abs(v)
          const body = abs >= 1_000_000
            ? `$${(abs / 1_000_000).toFixed(1)}M`
            : abs >= 1_000
              ? `$${(abs / 1_000).toFixed(0)}K`
              : `$${abs.toFixed(0)}`
          return v < 0 ? `-${body}` : body
        }
        const fmtSignedN = (v: number) => v > 0 ? `+${fmtN(v)}` : fmtN(v)
        // Shared submit helper so the batch-name Enter path and the
        // primary Execute button don't drift out of sync. Modal stays
        // OPEN during the mutation — the body swaps to a loading
        // state via `executeSubmitted`. The useEffect higher up
        // closes the modal once `isBulkPromoting` flips false, at
        // which point the parent's Decision Recorded modal pops in
        // for a clean hand-off.
        const submitExecute = () => {
          if (isBulkPromoting || executeSubmitted) return
          const trimmedName = executeBatchName.trim()
          const trimmedDesc = executeBatchDescription.trim()
          const trimmedReasons: Record<string, string> = {}
          for (const [vid, text] of Object.entries(executeReasons)) {
            const t = text.trim()
            if (t) trimmedReasons[vid] = t
          }
          setExecuteSubmitted(true)
          executeSubmittedAtRef.current = Date.now()
          onBulkPromote(Array.from(selectedForPromote), {
            batchName: trimmedName || null,
            batchDescription: trimmedDesc || null,
            reasons: trimmedReasons,
          })
          setExecuteBatchName('')
          setExecuteBatchDescription('')
          setExecuteReasons({})
        }
        const reasonCount = Object.values(executeReasons).filter(r => r.trim()).length
        // While the mutation is in flight, the modal swaps to a
        // compact loading card. Backdrop dismiss + X close are
        // suppressed so the user can't accidentally interrupt the
        // commit. The success modal renders right after this one
        // unmounts (handled by the useEffect higher up that watches
        // `isBulkPromoting`).
        const isLoading = executeSubmitted || isBulkPromoting
        if (isLoading) {
          return (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
              <div className="flex min-h-full items-center justify-center p-4">
                <div
                  className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full mx-auto border border-gray-200 dark:border-gray-700 px-8 py-10 flex flex-col items-center text-center"
                  role="dialog"
                  aria-modal="true"
                  aria-busy="true"
                  aria-label="Recording decision"
                >
                  <div className="relative w-14 h-14 mb-5">
                    {/* Soft pulsing halo + spinning ring → calm but
                        clearly active. The halo eases at a different
                        cadence than the ring so the motion stays
                        organic rather than mechanical. */}
                    <div className="absolute inset-0 rounded-full bg-emerald-100 dark:bg-emerald-900/30 animate-ping opacity-75" />
                    <div className="absolute inset-0 rounded-full bg-emerald-50 dark:bg-emerald-900/40" />
                    <div className="absolute inset-1 rounded-full border-[3px] border-emerald-200 dark:border-emerald-800/60 border-t-emerald-600 dark:border-t-emerald-400 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    Recording your {selectedRows.length === 1 ? 'decision' : 'decisions'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed max-w-[28ch]">
                    Committing {selectedRows.length} {selectedRows.length === 1 ? 'trade' : 'trades'} to the Trade Book — this is the system of record.
                  </p>
                </div>
              </div>
            </div>
          )
        }
        return (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            onClick={() => { if (!isLoading) setShowExecuteConfirm(false) }}
          >
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="flex min-h-full items-center justify-center p-4">
              <div
                className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full mx-auto border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="execute-confirm-title"
              >
                {/* Header */}
                <div className="flex items-start gap-4 px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3
                      id="execute-confirm-title"
                      className="text-base font-semibold text-gray-900 dark:text-white"
                    >
                      Execute {selectedRows.length} Trade{selectedRows.length !== 1 ? 's' : ''}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Commit to Trade Book. Add context now or fill it in later from{' '}
                      <span className="font-medium text-gray-600 dark:text-gray-300">Trade Book → Outcomes</span>.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowExecuteConfirm(false)}
                    className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 -m-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                  {/* Batch context: name + description, side by side on wide
                      screens, stacked on mobile. */}
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3">
                    <div>
                      <label
                        htmlFor="execute-batch-name"
                        className="block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5"
                      >
                        Batch name
                      </label>
                      <input
                        id="execute-batch-name"
                        type="text"
                        autoFocus
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        data-lpignore="true"
                        data-form-type="other"
                        name="execute-batch-name"
                        value={executeBatchName}
                        onChange={(e) => setExecuteBatchName(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter' && !isBulkPromoting) {
                            e.preventDefault()
                            submitExecute()
                          }
                        }}
                        placeholder="Morning rebalance"
                        maxLength={120}
                        className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-colors"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="execute-batch-description"
                        className="block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5"
                      >
                        Batch rationale <span className="normal-case font-normal text-gray-400 dark:text-gray-500">(overall why)</span>
                      </label>
                      <input
                        id="execute-batch-description"
                        type="text"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        data-lpignore="true"
                        data-form-type="other"
                        name="execute-batch-description"
                        value={executeBatchDescription}
                        onChange={(e) => setExecuteBatchDescription(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter' && !isBulkPromoting) {
                            e.preventDefault()
                            submitExecute()
                          }
                        }}
                        placeholder="e.g. Quarterly rebalance — trim winners, redeploy into PLTR / V"
                        maxLength={500}
                        className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Per-trade list */}
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <h4 className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Trades
                      </h4>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        {reasonCount > 0
                          ? `${reasonCount} of ${selectedRows.length} with reason`
                          : executeBatchDescription.trim()
                            ? 'Inheriting batch rationale'
                            : 'Reasons optional'}
                      </span>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-950/40 overflow-hidden">
                      <div className="max-h-[340px] overflow-y-auto divide-y divide-gray-200/70 dark:divide-gray-800/80">
                        {selectedRows.map(row => {
                          const fromWt = row.currentWeight
                          const toWt = row.computed?.target_weight ?? row.simWeight
                          const rowNotional = row.notional
                          const variantId = row.variant?.id
                          const reason = variantId ? (executeReasons[variantId] || '') : ''
                          const isBuySide = row.derivedAction === 'buy' || row.derivedAction === 'add'
                          return (
                            <div
                              key={row.asset_id}
                              className="px-4 py-3 hover:bg-white dark:hover:bg-gray-900/40 transition-colors"
                            >
                              {/* Row header: action · symbol · weight change · notional */}
                              <div className="flex items-center gap-3 text-xs mb-2">
                                <span className={clsx(
                                  'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider flex-shrink-0',
                                  isBuySide
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                                )}>
                                  {actionLabel(row.derivedAction, row.isNew, row.isRemoved)}
                                </span>
                                <span className="font-semibold text-sm text-gray-900 dark:text-white">{row.symbol}</span>
                                <span className="text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                                  {fromWt.toFixed(2)}% → {toWt.toFixed(2)}%
                                </span>
                                <span className={clsx(
                                  'ml-auto font-mono tabular-nums text-xs font-semibold',
                                  rowNotional > 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : rowNotional < 0
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-gray-400 dark:text-gray-500',
                                )}>
                                  {rowNotional !== 0 ? fmtSignedN(rowNotional) : '—'}
                                </span>
                              </div>
                              {/* Reason field — full width, easy to type in.
                                  When the PM has written an overall batch
                                  rationale, the placeholder signals that
                                  leaving this blank is fine — the batch
                                  rationale will inherit onto this trade's
                                  acceptance_note. */}
                              {variantId && (() => {
                                const hasBatchRationale = !!executeBatchDescription.trim()
                                const rowAction = actionLabel(row.derivedAction, row.isNew, row.isRemoved).toLowerCase()
                                const placeholder = hasBatchRationale
                                  ? `Override batch rationale for ${row.symbol} (optional)`
                                  : `Why ${rowAction} ${row.symbol}?`
                                return (
                                  <input
                                    type="text"
                                    value={reason}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      setExecuteReasons((prev) => ({ ...prev, [variantId]: val }))
                                    }}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    data-lpignore="true"
                                    data-form-type="other"
                                    placeholder={placeholder}
                                    maxLength={280}
                                    className={clsx(
                                      'w-full text-xs px-3 py-1.5 rounded-md border bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 transition-colors',
                                      hasBatchRationale && !reason
                                        ? 'border-dashed border-gray-300 dark:border-gray-700'
                                        : 'border-gray-200 dark:border-gray-700',
                                    )}
                                  />
                                )
                              })()}
                            </div>
                          )
                        })}
                      </div>
                      {/* Totals footer */}
                      <div className="px-4 py-2.5 bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-gray-600 dark:text-gray-300">
                          {selectedRows.length} trade{selectedRows.length !== 1 ? 's' : ''}
                        </span>
                        <span className="font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                          {fmtN(totalNotional)} notional
                        </span>
                        <span className={clsx(
                          'font-semibold tabular-nums',
                          cashImpact > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : cashImpact < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-500 dark:text-gray-400',
                        )}>
                          Cash {fmtSignedN(cashImpact)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer actions */}
                <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 rounded-b-2xl flex items-center gap-3">
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 flex-1">
                    {executeBatchDescription.trim()
                      ? <>Each trade inherits the batch rationale unless you override it per-row.</>
                      : <>Blank reasons can be filled in later in <span className="font-medium text-gray-500 dark:text-gray-400">Trade Book → Outcomes</span>.</>
                    }
                  </p>
                  <button
                    onClick={() => setShowExecuteConfirm(false)}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitExecute}
                    disabled={isBulkPromoting}
                    className="px-5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-colors disabled:opacity-50"
                  >
                    {isBulkPromoting ? 'Executing…' : `Execute ${selectedRows.length} Trade${selectedRows.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Clear-all confirmation modal — same structure as Execute, red
          destructive styling, and a brief breakdown of what will be cleared. */}
      {showClearConfirm && onClearAllTrades && (() => {
        const clearedBuys = tradedRows.filter(r => r.derivedAction === 'buy' || r.derivedAction === 'add').length
        const clearedSells = tradedRows.filter(r => r.derivedAction === 'sell' || r.derivedAction === 'trim').length
        return (
          <div className="fixed inset-0 z-50 overflow-y-auto" onClick={() => setShowClearConfirm(false)}>
            <div className="fixed inset-0 bg-black/50" />
            <div className="flex min-h-full items-center justify-center p-4">
              <div
                className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-auto"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="clear-confirm-title"
              >
                <div className="p-6">
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                      <Trash2 className="h-6 w-6 text-red-600 dark:text-red-400" />
                    </div>
                  </div>
                  <h3
                    id="clear-confirm-title"
                    className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-1"
                  >
                    Clear {summary.tradedCount} pending trade{summary.tradedCount !== 1 ? 's' : ''}?
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-4">
                    This removes every draft variant from the current simulation. Committed trades in the Trade Book are not affected.
                  </p>

                  {/* What gets cleared */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 mb-4 overflow-hidden">
                    <div className="px-3 py-2 flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-600 dark:text-gray-300">{summary.tradedCount} trade{summary.tradedCount !== 1 ? 's' : ''}</span>
                      <span className="flex items-center gap-2 font-mono tabular-nums">
                        <span className="text-emerald-600 dark:text-emerald-400">{clearedBuys} buy{clearedBuys !== 1 ? 's' : ''}</span>
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <span className="text-red-600 dark:text-red-400">{clearedSells} sell{clearedSells !== 1 ? 's' : ''}</span>
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center mb-4 flex items-center justify-center gap-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    This cannot be undone — you&rsquo;ll need to re-enter sizing.
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setShowClearConfirm(false)
                        onClearAllTrades()
                      }}
                      className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors"
                    >
                      Clear all trades
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default HoldingsSimulationTable
