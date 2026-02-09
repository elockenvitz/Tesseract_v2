/**
 * @deprecated Use HoldingsSimulationTable + ExecutionReadinessPanel instead.
 *
 * Intent Board (Trade Lab v3) — kept for rollback safety.
 *
 * Layout: SANDBOX (left, scrollable) | DECISION PANEL (right, fixed)
 *
 * The sandbox holds trade cards. Each card leads with OUTCOME (loud),
 * followed by intent/input (quiet). The decision panel is always visible,
 * shows readiness, and owns the only Create Trade Sheet button.
 *
 * This is NOT a vertical form. It is a two-pane workspace.
 */

import React, { useRef, useCallback, useMemo } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileText,
  Pencil,
  Plus,
  Shield,
  Trash2,
  X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import { UnifiedSizingInput, type CurrentPosition } from './UnifiedSizingInput'
import { CardConflictRow } from './TradeCardConflictBadge'
import { parseSizingInput, toSizingSpec } from '../../lib/trade-lab/sizing-parser'
import type {
  IntentVariant,
  TradeAction,
  SizingValidationError,
  TradeSheet,
  SimulationTradeWithDetails,
  BaselineHolding,
} from '../../types/trading'

// =============================================================================
// TYPES
// =============================================================================

interface ConflictSummary {
  total: number
  conflicts: number
  warnings: number
  canCreateTradeSheet: boolean
}

export interface IntentBoardProps {
  variants: IntentVariant[]
  conflictSummary: ConflictSummary
  tradeSheets: TradeSheet[]
  simulationTrades: SimulationTradeWithDetails[]
  baselineHoldings: BaselineHolding[]
  portfolioTotalValue: number
  hasBenchmark: boolean
  priceMap: Record<string, number>
  isCreatingSheet: boolean
  onUpdateVariant: (variantId: string, updates: { action?: TradeAction; sizingInput?: string }) => void
  onDeleteVariant: (variantId: string) => void
  onFixConflict: (variantId: string, suggestedAction: TradeAction) => void
  onCreateTradeSheet: (name: string, description?: string) => Promise<void>
  onAddTrade: () => void
  onEditTrade: (tradeId: string) => void
  onRemoveTrade: (tradeId: string) => void
  className?: string
}

// =============================================================================
// HELPERS
// =============================================================================

function formatNotional(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function formatSignedShares(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs >= 1000 ? abs.toLocaleString() : abs.toString()
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return formatted
}

function buildIntentString(framework: string, value: number): string {
  switch (framework) {
    case 'weight_target': return `Target ${value.toFixed(2)}% weight`
    case 'weight_delta': return value >= 0 ? `Add ${value.toFixed(2)}% weight` : `Remove ${Math.abs(value).toFixed(2)}% weight`
    case 'shares_target': return `Target ${Math.abs(value).toLocaleString()} shares`
    case 'shares_delta': return value >= 0 ? `Add ${Math.abs(value).toLocaleString()} shares` : `Remove ${Math.abs(value).toLocaleString()} shares`
    case 'active_target': return `Target ${value >= 0 ? '+' : ''}${value.toFixed(2)}% active weight`
    case 'active_delta': return value >= 0 ? `Add ${value.toFixed(2)}% active weight` : `Remove ${Math.abs(value).toFixed(2)}% active weight`
    default: return ''
  }
}

// =============================================================================
// ACTION STYLES
// =============================================================================

const ACTION_CYCLE: TradeAction[] = ['buy', 'add', 'sell', 'trim']

const ACTION_STYLES: Record<TradeAction, { bg: string; label: string }> = {
  buy:  { bg: 'bg-emerald-600 text-white', label: 'BUY' },
  add:  { bg: 'bg-emerald-500 text-white', label: 'ADD' },
  sell: { bg: 'bg-red-600 text-white', label: 'SELL' },
  trim: { bg: 'bg-red-500 text-white', label: 'TRIM' },
}

// =============================================================================
// TRADE CARD — outcome-first decision object
//
//   [BUY] AAPL · Apple Inc                            [×]
//   ═══════════════════════════════════════════════════════
//   ██  +150 shares     +1.27% weight     $36.7K      ██  ← OUTCOME (loud)
//   ██  1.23% → 2.50%                                 ██
//   ═══════════════════════════════════════════════════════
//   → Target 2.5% weight                                  ← intent statement
//   [2.5_________________________] [?]                     ← input (quiet)
//   2,450 sh · 1.23% current
//   ───────────────────────────────────────────────────────
//   ✓ Conflict-free                                        ← status
// =============================================================================

interface IntentCardProps {
  variant: IntentVariant
  baseline: BaselineHolding | undefined
  price: number
  portfolioTotalValue: number
  hasBenchmark: boolean
  onUpdateAction: (action: TradeAction) => void
  onUpdateSizing: (sizingInput: string) => void
  onDelete: () => void
  onFixConflict: (suggestedAction: TradeAction) => void
  cardRef?: React.RefObject<HTMLDivElement | null>
}

function IntentCard({
  variant,
  baseline,
  price,
  portfolioTotalValue,
  hasBenchmark,
  onUpdateAction,
  onUpdateSizing,
  onDelete,
  onFixConflict,
  cardRef,
}: IntentCardProps) {
  const conflict = variant.direction_conflict as SizingValidationError | null
  const hasConflict = conflict !== null
  const computed = variant.computed as any
  const hasSizing = !!variant.sizing_input?.trim()
  const hasWarning = !!variant.below_lot_warning

  const currentPosition: CurrentPosition | null = baseline
    ? { shares: baseline.shares, weight: baseline.weight, cost_basis: null, active_weight: null }
    : null

  const symbol = (variant as any).asset?.symbol || 'Unknown'
  const companyName = (variant as any).asset?.company_name || ''
  const style = ACTION_STYLES[variant.action]
  const isBuyish = variant.action === 'buy' || variant.action === 'add'

  const intentString = useMemo(() => {
    if (!variant.sizing_input?.trim()) return null
    try {
      const parseResult = parseSizingInput(variant.sizing_input.trim(), { has_benchmark: hasBenchmark })
      if (!parseResult.is_valid) return null
      const spec = toSizingSpec(variant.sizing_input.trim(), parseResult)
      if (!spec) return null
      return buildIntentString(spec.framework, spec.value)
    } catch {
      return null
    }
  }, [variant.sizing_input, hasBenchmark])

  const cardStatus: 'ok' | 'conflict' | 'warning' | 'pending' =
    hasConflict ? 'conflict'
    : hasWarning ? 'warning'
    : hasSizing && computed ? 'ok'
    : 'pending'

  const hasOutcome = computed && (
    (computed.delta_shares !== undefined && computed.delta_shares !== 0) ||
    (computed.delta_weight !== undefined && computed.delta_weight !== 0) ||
    (computed.notional_value !== undefined && computed.notional_value > 0)
  )

  return (
    <div
      ref={cardRef}
      className={clsx(
        'rounded-xl overflow-hidden bg-white dark:bg-gray-800 transition-shadow',
        hasConflict
          ? 'ring-2 ring-red-300 dark:ring-red-700 shadow-lg shadow-red-100/50 dark:shadow-red-950/40'
          : cardStatus === 'ok'
          ? 'ring-1 ring-emerald-200/60 dark:ring-emerald-800/40 shadow-sm'
          : 'ring-1 ring-gray-200 dark:ring-gray-700 shadow-sm'
      )}
    >
      {/* ─── Identity Bar ─── */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-700/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => {
              const idx = ACTION_CYCLE.indexOf(variant.action)
              onUpdateAction(ACTION_CYCLE[(idx + 1) % ACTION_CYCLE.length])
            }}
            className={clsx(
              'flex-shrink-0 px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider',
              'transition-all hover:scale-105 active:scale-95 cursor-pointer select-none',
              style.bg
            )}
            title="Click to cycle action"
          >
            {style.label}
          </button>
          <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">{symbol}</span>
          {companyName && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate hidden sm:inline">{companyName}</span>
          )}
        </div>
        <button
          onClick={onDelete}
          className="flex-shrink-0 p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors"
          title="Remove"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ─── OUTCOME BLOCK — the loudest thing on the card ─── */}
      <div className={clsx(
        'px-4 py-4',
        hasConflict
          ? 'bg-red-50 dark:bg-red-950/30'
          : hasOutcome
          ? isBuyish ? 'bg-emerald-50/70 dark:bg-emerald-950/20' : 'bg-amber-50/50 dark:bg-amber-950/15'
          : 'bg-gray-50 dark:bg-gray-800/80'
      )}>
        {hasOutcome ? (
          <>
            {/* Metric row: large, dominant numbers */}
            <div className="flex items-end gap-5 flex-wrap">
              {computed.delta_shares !== undefined && computed.delta_shares !== 0 && (
                <div>
                  <div className={clsx(
                    'text-xl font-bold tabular-nums leading-tight',
                    computed.delta_shares > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                  )}>
                    {formatSignedShares(computed.delta_shares)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-0.5">shares</div>
                </div>
              )}

              {computed.delta_weight !== undefined && computed.delta_weight !== 0 && (
                <div>
                  <div className={clsx(
                    'text-xl font-bold tabular-nums leading-tight',
                    computed.delta_weight > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                  )}>
                    {computed.delta_weight > 0 ? '+' : ''}{computed.delta_weight.toFixed(2)}%
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-0.5">weight</div>
                </div>
              )}

              {computed.notional_value !== undefined && computed.notional_value > 0 && (
                <div>
                  <div className="text-lg font-semibold tabular-nums leading-tight text-gray-600 dark:text-gray-300">
                    {formatNotional(computed.notional_value)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-0.5">notional</div>
                </div>
              )}
            </div>

            {/* Trajectory */}
            {currentPosition && computed.target_weight !== undefined && (
              <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                {currentPosition.weight.toFixed(2)}%
                <ArrowDownRight className={clsx(
                  'w-3 h-3 inline mx-0.5',
                  computed.delta_weight >= 0 ? 'rotate-[-90deg] text-emerald-400' : 'text-red-400'
                )} />
                {computed.target_weight.toFixed(2)}% weight
              </div>
            )}
          </>
        ) : (
          /* Empty outcome — invite action */
          <div className="py-2 text-center">
            <div className="text-sm text-gray-400 dark:text-gray-500">
              {hasSizing ? 'Computing impact…' : 'No impact computed yet'}
            </div>
            {!hasSizing && (
              <div className="text-xs text-gray-300 dark:text-gray-600 mt-1">Enter sizing below</div>
            )}
          </div>
        )}
      </div>

      {/* ─── Intent + Input — quiet, secondary ─── */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/50">
        {/* Intent statement */}
        {intentString && (
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            → {intentString}
          </div>
        )}
        {!intentString && hasSizing && (
          <div className="text-xs text-red-500 dark:text-red-400 mb-2">Invalid sizing format</div>
        )}

        {/* Sizing input — compact, not the hero */}
        <UnifiedSizingInput
          value={variant.sizing_input || ''}
          onChange={onUpdateSizing}
          action={variant.action}
          currentPosition={currentPosition}
          price={price}
          portfolioTotalValue={portfolioTotalValue}
          hasBenchmark={hasBenchmark}
          onFixAction={onFixConflict}
          size="sm"
          showHelp={true}
          showPreview={false}
        />

        {/* Position context */}
        <div className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          {currentPosition
            ? `${currentPosition.shares.toLocaleString()} sh · ${currentPosition.weight.toFixed(2)}% current`
            : 'New position'}
        </div>
      </div>

      {/* ─── Status Footer ─── */}
      {hasConflict && conflict ? (
        <CardConflictRow conflict={conflict} onFixAction={onFixConflict} />
      ) : (
        <div className={clsx(
          'px-4 py-1.5 text-[11px] flex items-center gap-1.5 border-t',
          cardStatus === 'ok'
            && 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400',
          cardStatus === 'warning'
            && 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30 text-amber-600 dark:text-amber-400',
          cardStatus === 'pending'
            && 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700/50 text-gray-400 dark:text-gray-500',
        )}>
          {cardStatus === 'ok' && <><Check className="w-3 h-3" /><span>Conflict-free</span></>}
          {cardStatus === 'warning' && <><AlertTriangle className="w-3 h-3" /><span>Below lot size</span></>}
          {cardStatus === 'pending' && (
            <><span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" /><span>Enter sizing to validate</span></>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// SANDBOX TRADE CARD (non-variant legacy trades)
// =============================================================================

function SandboxTradeCard({ trade, onEdit, onRemove }: {
  trade: SimulationTradeWithDetails
  onEdit: () => void
  onRemove: () => void
}) {
  const symbol = trade.assets?.symbol || 'Unknown'
  const isBuy = trade.action === 'buy' || trade.action === 'add'

  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-white/50 dark:bg-gray-800/30 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={clsx(
            'flex-shrink-0 px-2 py-1 rounded text-xs font-bold uppercase',
            isBuy
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          )}>
            {trade.action}
          </span>
          <span className="font-semibold text-gray-900 dark:text-white">{symbol}</span>
          {trade.weight != null && <span className="text-sm text-gray-500">{trade.weight}%</span>}
          {trade.shares != null && <span className="text-sm text-gray-500">{trade.shares.toLocaleString()} sh</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} className="p-1.5 text-gray-400 hover:text-red-500 rounded" title="Remove">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// DECISION PANEL — persistent right sidebar
// =============================================================================

interface DecisionPanelProps {
  conflictSummary: ConflictSummary
  totalNotional: number
  isEmpty: boolean
  isCreatingSheet: boolean
  showCreateForm: boolean
  sheetName: string
  sheetDescription: string
  onSheetNameChange: (v: string) => void
  onSheetDescChange: (v: string) => void
  onCreateClick: () => void
  onCreateSheet: () => void
  onCancelCreate: () => void
  onAddTrade: () => void
  onConflictClick: () => void
}

function DecisionPanel({
  conflictSummary,
  totalNotional,
  isEmpty,
  isCreatingSheet,
  showCreateForm,
  sheetName,
  sheetDescription,
  onSheetNameChange,
  onSheetDescChange,
  onCreateClick,
  onCreateSheet,
  onCancelCreate,
  onAddTrade,
  onConflictClick,
}: DecisionPanelProps) {
  const isReady = conflictSummary.canCreateTradeSheet && conflictSummary.total > 0

  return (
    <div className="w-60 flex-shrink-0 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col">

      {/* Panel header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Decision
        </div>
      </div>

      {/* Stats section */}
      <div className="px-4 py-4 space-y-4 flex-1">

        {/* Count */}
        <div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums leading-none">
            {conflictSummary.total}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            intent{conflictSummary.total !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Notional */}
        {totalNotional > 0 && (
          <div>
            <div className="text-lg font-semibold text-gray-700 dark:text-gray-300 tabular-nums leading-tight">
              {formatNotional(totalNotional)}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">total notional</div>
          </div>
        )}

        {/* Blockers */}
        {conflictSummary.conflicts > 0 && (
          <button
            onClick={onConflictClick}
            className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 font-medium hover:underline"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {conflictSummary.conflicts} conflict{conflictSummary.conflicts !== 1 ? 's' : ''}
          </button>
        )}

        {conflictSummary.warnings > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {conflictSummary.warnings} warning{conflictSummary.warnings !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Readiness + Actions — anchored to bottom */}
      <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-700/50 space-y-3">

        {/* Readiness indicator */}
        {isEmpty ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            Add trades to begin shaping intent.
          </p>
        ) : isReady ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">READY</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              This reflects what you intend to do.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">NOT READY</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
              {conflictSummary.conflicts > 0
                ? 'Resolve conflicts to proceed.'
                : 'Size all intents to proceed.'}
            </p>
          </div>
        )}

        {/* Create Trade Sheet */}
        {showCreateForm ? (
          <div className="space-y-2">
            <input
              type="text"
              value={sheetName}
              onChange={(e) => onSheetNameChange(e.target.value)}
              placeholder="Sheet name"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') onCreateSheet() }}
            />
            <input
              type="text"
              value={sheetDescription}
              onChange={(e) => onSheetDescChange(e.target.value)}
              placeholder="Description (optional)"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onCancelCreate} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!sheetName.trim() || isCreatingSheet}
                loading={isCreatingSheet}
                onClick={onCreateSheet}
                className="flex-1"
              >
                Create
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant={isReady ? 'primary' : 'secondary'}
            size="sm"
            disabled={!isReady || isCreatingSheet}
            loading={isCreatingSheet}
            onClick={onCreateClick}
            className="w-full"
          >
            <FileText className="w-4 h-4 mr-1.5" />
            Create Trade Sheet
          </Button>
        )}

        {/* Add trade */}
        <button
          onClick={onAddTrade}
          className="w-full text-xs text-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors py-1"
        >
          + Add trade
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// MAIN INTENT BOARD — two-pane workspace
// =============================================================================

export function IntentBoard({
  variants,
  conflictSummary,
  tradeSheets,
  simulationTrades,
  baselineHoldings,
  portfolioTotalValue,
  hasBenchmark,
  priceMap,
  isCreatingSheet,
  onUpdateVariant,
  onDeleteVariant,
  onFixConflict,
  onCreateTradeSheet,
  onAddTrade,
  onEditTrade,
  onRemoveTrade,
  className = '',
}: IntentBoardProps) {
  const conflictCardRefs = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map())
  const [showCreateForm, setShowCreateForm] = React.useState(false)
  const [sheetName, setSheetName] = React.useState('')
  const [sheetDescription, setSheetDescription] = React.useState('')

  const baselineMap = useMemo(() => {
    const map = new Map<string, BaselineHolding>()
    baselineHoldings.forEach(h => map.set(h.asset_id, h))
    return map
  }, [baselineHoldings])

  const totalNotional = useMemo(() => {
    return variants.reduce((sum, v) => {
      const computed = v.computed as any
      return sum + (computed?.notional_value || 0)
    }, 0)
  }, [variants])

  const sandboxTrades = useMemo(() => {
    const variantAssetIds = new Set(variants.map(v => v.asset_id))
    return simulationTrades.filter(t => !variantAssetIds.has(t.asset_id))
  }, [variants, simulationTrades])

  const scrollToFirstConflict = useCallback(() => {
    const first = variants.find(v => v.direction_conflict !== null)
    if (first) {
      conflictCardRefs.current.get(first.id)?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [variants])

  const getCardRef = useCallback((variantId: string) => {
    if (!conflictCardRefs.current.has(variantId)) {
      conflictCardRefs.current.set(variantId, React.createRef<HTMLDivElement>())
    }
    return conflictCardRefs.current.get(variantId)!
  }, [])

  const handleCreateSheet = async () => {
    if (!sheetName.trim()) return
    await onCreateTradeSheet(sheetName.trim(), sheetDescription.trim() || undefined)
    setSheetName('')
    setSheetDescription('')
    setShowCreateForm(false)
  }

  const isEmpty = variants.length === 0 && sandboxTrades.length === 0

  return (
    <div className={clsx(
      'h-full flex overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700',
      className
    )}>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SANDBOX — scrollable card area, distinct background            */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-950 p-5 space-y-4">
        {isEmpty ? (
          /* Empty sandbox — invite action */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center mb-5">
              <Plus className="w-8 h-8 text-gray-300 dark:text-gray-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
              Shape your intent
            </h3>
            <p className="text-sm text-gray-400 dark:text-gray-500 max-w-xs leading-relaxed">
              Add trades from the ideas panel or start from scratch.
              Each trade becomes a decision you size, validate, and commit.
            </p>
            <Button variant="primary" size="sm" onClick={onAddTrade} className="mt-5">
              <Plus className="w-4 h-4 mr-1.5" />
              Add Trade
            </Button>
          </div>
        ) : (
          <>
            {/* Intent cards */}
            {variants.map((variant) => (
              <IntentCard
                key={variant.id}
                variant={variant}
                baseline={baselineMap.get(variant.asset_id)}
                price={priceMap[variant.asset_id] || 0}
                portfolioTotalValue={portfolioTotalValue}
                hasBenchmark={hasBenchmark}
                onUpdateAction={(action) => onUpdateVariant(variant.id, { action })}
                onUpdateSizing={(sizingInput) => onUpdateVariant(variant.id, { sizingInput })}
                onDelete={() => onDeleteVariant(variant.id)}
                onFixConflict={(suggestedAction) => onFixConflict(variant.id, suggestedAction)}
                cardRef={getCardRef(variant.id)}
              />
            ))}

            {/* Legacy sandbox trades */}
            {sandboxTrades.length > 0 && (
              <div className="pt-2">
                <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 px-1">
                  Sandbox Trades
                </div>
                <div className="space-y-2">
                  {sandboxTrades.map((trade) => (
                    <SandboxTradeCard
                      key={trade.id}
                      trade={trade}
                      onEdit={() => onEditTrade(trade.id)}
                      onRemove={() => onRemoveTrade(trade.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Add trade — inline in sandbox */}
            <button
              onClick={onAddTrade}
              className={clsx(
                'w-full py-2.5 rounded-xl text-xs font-medium transition-colors',
                'border-2 border-dashed border-gray-200 dark:border-gray-700',
                'text-gray-400 dark:text-gray-500',
                'hover:border-gray-300 dark:hover:border-gray-600',
                'hover:text-gray-500 dark:hover:text-gray-400',
                'hover:bg-white/40 dark:hover:bg-gray-800/30',
                'flex items-center justify-center gap-1.5'
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Trade
            </button>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DECISION PANEL — persistent right sidebar                     */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <DecisionPanel
        conflictSummary={conflictSummary}
        totalNotional={totalNotional}
        isEmpty={isEmpty}
        isCreatingSheet={isCreatingSheet}
        showCreateForm={showCreateForm}
        sheetName={sheetName}
        sheetDescription={sheetDescription}
        onSheetNameChange={setSheetName}
        onSheetDescChange={setSheetDescription}
        onCreateClick={() => setShowCreateForm(true)}
        onCreateSheet={handleCreateSheet}
        onCancelCreate={() => setShowCreateForm(false)}
        onAddTrade={onAddTrade}
        onConflictClick={scrollToFirstConflict}
      />
    </div>
  )
}

export default IntentBoard
