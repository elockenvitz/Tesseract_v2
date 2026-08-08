import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, ArrowDownUp, Lock, Plus, Search, X } from 'lucide-react'
import type { SimulationRow, SimulationRowSummary } from '../../../hooks/useSimulationRows'
import type { TradeAction } from '../../../types/trading'
import { BottomSheet } from '../BottomSheet'
import { MobileSizingSheet } from './MobileSizingSheet'

interface MobileSimulationListProps {
  rows: SimulationRow[]
  summary: SimulationRowSummary
  portfolioTotalValue: number
  hasBenchmark: boolean
  readOnly?: boolean
  onUpdateVariant: (variantId: string, updates: { action?: TradeAction; sizingInput?: string }) => void
  /** Matches the desktop table's signature; 'add' is the neutral seed action,
   *  and the real action is derived from the deltas once sizing is entered. */
  onCreateVariant: (assetId: string, action: TradeAction) => void
  onDeleteVariant?: (variantId: string) => void
  onAddPosition?: () => void
}

type Filter = 'all' | 'changed' | 'new'

/**
 * Named for what the list contains, not for a state a position is in.
 * "Trading / All positions / New" made the reader work out that the first was a
 * subset of the second, and defaulting to it showed an empty screen on any lab
 * where nothing had been sized yet.
 */
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Holdings' },
  { key: 'changed', label: 'Changed' },
  { key: 'new', label: 'New' },
]

/**
 * Which measure the numeric columns are expressed in.
 *
 * All eleven desktop columns at once means ~11 columns of horizontal travel to
 * reach the deltas, and the deltas are what you look at. Splitting by measure
 * keeps the shape that matters — Now / Sim / Δ — and drops the count to four or
 * seven, which fits a phone without dragging. Nothing is lost; the same figures
 * are one tap away instead of one scroll.
 */
type Measure = 'weight' | 'shares' | 'value'

const MEASURES: { key: Measure; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'shares', label: 'Shares' },
  { key: 'value', label: 'Dollars' },
]

interface Col {
  key: string
  label: string
  /** Simulated columns are tinted so "what it becomes" reads as a group. */
  accent?: boolean
  strong?: boolean
  /** Rendered as an em dash on rows with no sizing, rather than repeating the
   *  current figure under a simulated heading. */
  simOnly?: boolean
  value: (r: SimulationRow) => string
  tone?: (r: SimulationRow) => 'up' | 'down' | undefined
}

const signTone = (n: number | null | undefined) =>
  n == null ? undefined : n >= 0 ? ('up' as const) : ('down' as const)

/** Current market value of the position; the baseline carries it directly. */
const curValue = (r: SimulationRow) => r.baseline?.value ?? 0

function columnsFor(measure: Measure, hasBenchmark: boolean): Col[] {
  if (measure === 'shares') {
    return [
      { key: 'shs', label: 'Shares', value: r => fmtShares(r.currentShares) },
      { key: 'sim', label: 'Sim', accent: true, strong: true, simOnly: true, value: r => fmtShares(r.simShares) },
      { key: 'd', label: 'Δ Shares', simOnly: true, value: r => signedShares(r.deltaShares), tone: r => signTone(r.deltaShares) },
    ]
  }
  if (measure === 'value') {
    return [
      { key: 'val', label: 'Value', value: r => formatCompactUsd(curValue(r)) },
      { key: 'sim', label: 'Sim', accent: true, strong: true, simOnly: true, value: r => formatCompactUsd(r.simNotional) },
      {
        key: 'd', label: 'Δ $', simOnly: true,
        value: r => `${r.notional >= 0 ? '+' : '−'}${formatCompactUsd(Math.abs(r.notional))}`,
        tone: r => signTone(r.notional),
      },
    ]
  }
  // Weight. Benchmark and active live here because they are weight-space
  // figures — a share count has no benchmark to be active against.
  const cols: Col[] = [
    { key: 'wt', label: 'Wt%', value: r => r.currentWeight.toFixed(2) },
    { key: 'sim', label: 'Sim', accent: true, strong: true, simOnly: true, value: r => r.simWeight.toFixed(2) },
    { key: 'd', label: 'Δ Wt', simOnly: true, value: r => signed(r.deltaWeight, 2), tone: r => signTone(r.deltaWeight) },
  ]
  if (hasBenchmark) {
    cols.push(
      { key: 'bench', label: 'Bench', value: r => (r.benchWeight != null ? r.benchWeight.toFixed(2) : '—') },
      {
        key: 'act', label: 'Act',
        value: r => (r.activeWeight != null ? signed(r.activeWeight, 2) : '—'),
        tone: r => signTone(r.activeWeight),
      },
      {
        key: 'simact', label: 'Sim Act', accent: true, strong: true, simOnly: true,
        value: r => (r.benchWeight != null ? signed(r.simWeight - r.benchWeight, 2) : '—'),
        tone: r => (r.benchWeight != null ? signTone(r.simWeight - r.benchWeight) : undefined),
      },
    )
  }
  return cols
}

/**
 * The desktop sorts by clicking a column header. These headers are too narrow
 * to carry a sort affordance as well as a label, so the sort is its own control.
 */
type Sort = 'weight' | 'delta' | 'active' | 'symbol'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'delta', label: 'Change' },
  { key: 'active', label: 'Active' },
  { key: 'symbol', label: 'Symbol' },
]

/**
 * The holdings simulation, as a table, on a phone.
 *
 * An earlier version stacked each position's figures into labelled rows. That
 * made one position legible on its own and made comparing twenty of them
 * impossible — which is the entire job of a simulation table. It is a table
 * again.
 *
 * What makes a wide table work on a narrow screen is not fewer columns, it is
 * anchoring: the symbol column is frozen to the left and the header row is
 * stuck to the top, so you drag the numbers sideways and both the name of the
 * row and the name of the column stay on screen. Nothing is hidden, nothing is
 * behind a mode, and the column order matches the desktop board so the same
 * figures sit in the same relative places.
 *
 * Editing is the one thing that does not happen in the grid: a cell at this
 * width cannot hold a text field plus a keyboard without covering the numbers
 * the edit is being judged against. Tapping a row opens the sizing sheet, where
 * the before/after has room to be shown.
 *
 * Every write goes back through the props the desktop table already receives,
 * so the sync, convergence and ordering machinery in SimulationPage is
 * untouched and both surfaces stay one implementation deep.
 */
export function MobileSimulationList({
  rows,
  summary,
  portfolioTotalValue,
  hasBenchmark,
  readOnly,
  onUpdateVariant,
  onCreateVariant,
  onDeleteVariant,
  onAddPosition,
}: MobileSimulationListProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('weight')
  const [sortOpen, setSortOpen] = useState(false)
  const [measure, setMeasure] = useState<Measure>('weight')

  const cols = useMemo(() => columnsFor(measure, hasBenchmark), [measure, hasBenchmark])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (r.isCash) return false
      if (filter === 'changed' && !r.variant?.sizing_input) return false
      if (filter === 'new' && !r.isNew) return false
      if (q && !`${r.symbol} ${r.company_name}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filter, search])

  const sorted = useMemo(() => {
    const list = [...visible]
    switch (sort) {
      case 'symbol':
        return list.sort((a, b) => a.symbol.localeCompare(b.symbol))
      case 'delta':
        return list.sort((a, b) => Math.abs(b.deltaWeight) - Math.abs(a.deltaWeight))
      case 'active':
        return list.sort((a, b) => Math.abs(b.activeWeight ?? 0) - Math.abs(a.activeWeight ?? 0))
      default:
        return list.sort((a, b) => b.simWeight - a.simWeight)
    }
  }, [visible, sort])

  // Resolved from `rows` rather than captured: the row is recomputed on every
  // variant change, and a captured copy would show the sheet the pre-edit
  // numbers it just edited.
  const editingRow = editing ? rows.find(r => r.asset_id === editing) ?? null : null

  const openRow = (row: SimulationRow) => {
    if (row.isCommittedPending) return
    if (!row.variant) onCreateVariant(row.asset_id, 'add')
    setEditing(row.asset_id)
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* What this simulation does, in three numbers. On the desktop these are
          a table footer; a footer is a scroll away from what it summarises and
          is the first question, not the last. */}
      <div className="flex-shrink-0 px-3 pt-3">
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
          <Stat label="Trades" value={String(summary.tradedCount)} />
          <Stat
            label="Net Δ wt"
            value={`${summary.netDeltaWeight >= 0 ? '+' : ''}${summary.netDeltaWeight.toFixed(2)}%`}
            tone={summary.netDeltaWeight >= 0 ? 'up' : 'down'}
          />
          <Stat label="Turnover" value={formatCompactUsd(Math.abs(summary.totalNotional))} />
        </div>

        {summary.conflictCount > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-[12px] text-amber-800 dark:text-amber-200">
              {summary.conflictCount} {summary.conflictCount === 1 ? 'position conflicts' : 'positions conflict'} with the idea behind them.
            </p>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-3 pt-2 pb-2 space-y-2">
        <div className="flex gap-1">
          {FILTERS.map(f => {
            const count = rows.filter(r => {
              if (r.isCash) return false
              if (f.key === 'changed') return !!r.variant?.sizing_input
              if (f.key === 'new') return r.isNew
              return true
            }).length
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-current={filter === f.key}
                className={clsx(
                  'flex-1 h-9 rounded-lg text-sm font-medium transition-colors no-touch-target',
                  filter === f.key
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                    : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
                )}
              >
                {f.label}
                <span className="ml-1 text-[11px] tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find a position"
              className="w-full h-9 pl-8 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-full text-gray-400"
                aria-label="Clear"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSortOpen(true)}
            className="shrink-0 h-9 px-2.5 inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-medium text-gray-600 dark:text-gray-300 no-touch-target"
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
            {SORTS.find(x => x.key === sort)?.label}
          </button>
        </div>

        {/* Which measure the columns speak in. Sits directly above the table it
            governs, so the relationship needs no explaining. */}
        <div className="flex items-center p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800">
          {MEASURES.map(m => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMeasure(m.key)}
              aria-current={measure === m.key}
              className={clsx(
                'flex-1 h-8 rounded-md text-[12px] font-semibold transition-colors no-touch-target',
                measure === m.key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* The table. Frozen symbol column, sticky header, everything else scrolls
          sideways as one. */}
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain pb-24">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 px-3 text-gray-400">
            <p className="text-sm text-center">
              {search
                ? 'No position matches that.'
                : filter === 'changed'
                  ? 'Nothing changed yet. Tap a holding to size it.'
                  : filter === 'new'
                    ? 'No new positions in this simulation.'
                    : 'This portfolio has no holdings.'}
            </p>
          </div>
        ) : (
          <table className="w-max min-w-full border-separate border-spacing-0 text-[11px] tabular-nums">
            <thead>
              <tr>
                <Th sticky>Sym</Th>
                {cols.map(c => (
                  <Th key={c.key} accent={c.accent}>{c.label}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <Row
                  key={row.asset_id}
                  row={row}
                  cols={cols}
                  even={i % 2 === 1}
                  onOpen={() => openRow(row)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!readOnly && onAddPosition && (
        <button
          type="button"
          onClick={onAddPosition}
          className="absolute bottom-5 right-5 h-14 w-14 flex items-center justify-center rounded-full bg-primary-600 text-white shadow-lg no-touch-target"
          aria-label="Add a position to the simulation"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      <BottomSheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort by" fitContent>
        <div className="px-3 pb-3 space-y-1">
          {SORTS.map(o => (
            <button
              key={o.key}
              type="button"
              onClick={() => { setSort(o.key); setSortOpen(false) }}
              className={clsx(
                'w-full flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm no-touch-target',
                sort === o.key
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300 font-semibold'
                  : 'text-gray-700 dark:text-gray-200 active:bg-gray-50 dark:active:bg-gray-800'
              )}
            >
              {o.label}
              <span className="ml-auto text-[11px] text-gray-400">
                {o.key === 'symbol' ? 'A–Z' : 'largest first'}
              </span>
            </button>
          ))}
        </div>
      </BottomSheet>

      {editingRow && (
        <MobileSizingSheet
          row={editingRow}
          portfolioTotalValue={portfolioTotalValue}
          hasBenchmark={hasBenchmark}
          readOnly={readOnly || editingRow.isCommittedPending}
          onCommit={sizingInput => {
            if (editingRow.variant) onUpdateVariant(editingRow.variant.id, { sizingInput })
          }}
          onRemove={
            onDeleteVariant && editingRow.variant
              ? () => {
                  onDeleteVariant(editingRow.variant!.id)
                  setEditing(null)
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div
        className={clsx(
          'mt-0.5 text-base font-bold tabular-nums',
          tone === 'up' ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'down' ? 'text-red-600 dark:text-red-400'
            : 'text-gray-900 dark:text-white'
        )}
      >
        {value}
      </div>
    </div>
  )
}

/** Header cell. `sticky` freezes the symbol column; `accent` marks simulated values. */
function Th({
  children, sticky, accent,
}: {
  children: React.ReactNode
  sticky?: boolean
  accent?: boolean
}) {
  return (
    <th
      className={clsx(
        'sticky top-0 whitespace-nowrap px-2 py-1.5 font-semibold uppercase tracking-wider text-[9px]',
        'bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700',
        accent ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400',
        // The corner cell has to outrank both the sticky row and the sticky
        // column, or the scrolling headers slide underneath or over it.
        sticky ? 'left-0 z-30 text-left border-r border-gray-200 dark:border-gray-700' : 'z-20 text-right'
      )}
    >
      {children}
    </th>
  )
}

/**
 * One position.
 *
 * The whole row is the tap target. There is no in-cell editing: a cell this
 * narrow cannot hold a text field and its keyboard without covering the numbers
 * the edit is being judged against.
 */
function Row({
  row, cols, even, onOpen,
}: {
  row: SimulationRow
  cols: Col[]
  even: boolean
  onOpen: () => void
}) {
  const traded = !!row.variant?.sizing_input
  const locked = row.isCommittedPending

  // The frozen cell needs its own opaque background or the scrolling columns
  // show through it, so the stripe colour is shared rather than set on the row.
  const bg = even ? 'bg-gray-50 dark:bg-gray-800/40' : 'bg-white dark:bg-gray-900'

  return (
    <tr
      onClick={locked ? undefined : onOpen}
      className={clsx(bg, locked && 'opacity-60', !locked && 'cursor-pointer active:bg-primary-50 dark:active:bg-primary-900/20')}
    >
      <td
        className={clsx(
          'sticky left-0 z-10 px-2 py-2 whitespace-nowrap border-b border-r border-gray-100 dark:border-gray-800',
          bg,
          traded && (row.deltaWeight >= 0
            ? 'border-l-[3px] border-l-emerald-500'
            : 'border-l-[3px] border-l-red-500')
        )}
      >
        <div className="flex items-center gap-1">
          <span className="font-bold text-[12px] text-gray-900 dark:text-white">{row.symbol}</span>
          {row.isNew && <span className="text-[8px] font-bold uppercase text-blue-600 dark:text-blue-400">new</span>}
          {row.hasConflict && <AlertTriangle className="h-3 w-3 text-amber-500" />}
          {locked && <Lock className="h-3 w-3 text-gray-400" />}
        </div>
      </td>

      {cols.map(c => (
        <Td key={c.key} strong={c.strong} tone={c.tone?.(row)}>
          {c.simOnly && !traded ? '—' : c.value(row)}
        </Td>
      ))}
    </tr>
  )
}

function Td({
  children, strong, tone,
}: {
  children: React.ReactNode
  strong?: boolean
  tone?: 'up' | 'down'
}) {
  const blank = children === '—'
  return (
    <td
      className={clsx(
        'px-2 py-2 text-right whitespace-nowrap border-b border-gray-100 dark:border-gray-800',
        blank && 'text-gray-300 dark:text-gray-600',
        !blank && strong && 'font-semibold text-gray-900 dark:text-white',
        !blank && !strong && (
          tone === 'up' ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'down' ? 'text-red-600 dark:text-red-400'
            : 'text-gray-600 dark:text-gray-300'
        )
      )}
    >
      {children}
    </td>
  )
}

function signed(n: number, dp: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(dp)}`
}

function fmtShares(n: number): string {
  const abs = Math.abs(n)
  const body = abs >= 10_000 ? `${(abs / 1000).toFixed(1)}k` : Math.round(abs).toLocaleString()
  return `${n < 0 ? '−' : ''}${body}`
}

function signedShares(n: number): string {
  return `${n >= 0 ? '+' : '−'}${fmtShares(Math.abs(n))}`
}

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${value.toFixed(0)}`
}
