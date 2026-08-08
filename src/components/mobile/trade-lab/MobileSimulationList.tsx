import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, ChevronDown, ChevronUp, Layers, Lock, Plus, Search, X } from 'lucide-react'
import type { SimulationRow, SimulationRowSummary } from '../../../hooks/useSimulationRows'
import { useAssetGroupingMeta } from '../../../hooks/useAssetGroupingMeta'
import type { TradeAction } from '../../../types/trading'
import { BottomSheet } from '../BottomSheet'
import { MobileSizingSheet } from './MobileSizingSheet'
import { MobileAddPositionSheet, type AddableAsset } from './MobileAddPositionSheet'

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
  /** Adds an asset the portfolio does not hold. Omit to hide the add control. */
  onAddAsset?: (asset: AddableAsset) => void
  assetSearch?: string
  onAssetSearchChange?: (v: string) => void
  assetSearchResults?: AddableAsset[]
}

/**
 * Which measure the numeric columns are expressed in.
 *
 * All eleven desktop columns at once means roughly eleven columns of horizontal
 * travel to reach the deltas, and the deltas are what you look at. Splitting by
 * measure keeps the shape that matters — Now / Sim / Δ — and drops the count to
 * three or six, which fits without dragging.
 */
type Measure = 'weight' | 'shares' | 'value'

const MEASURES: { key: Measure; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'shares', label: 'Shares' },
  { key: 'value', label: '$' },
]

type GroupBy = 'none' | 'sector' | 'country' | 'industry'

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: 'none', label: 'No grouping' },
  { key: 'sector', label: 'Sector' },
  { key: 'country', label: 'Country' },
  { key: 'industry', label: 'Industry' },
]

interface Col {
  key: string
  label: string
  /** Simulated columns are tinted so "what it becomes" reads as a group. */
  accent?: boolean
  strong?: boolean
  /** Em dash on rows with no sizing, rather than repeating the current figure
   *  under a simulated heading. */
  simOnly?: boolean
  value: (r: SimulationRow) => string
  /** Sort key. Absent means the column is not sortable. */
  sortBy?: (r: SimulationRow) => number | string
  tone?: (r: SimulationRow) => 'up' | 'down' | undefined
}

const signTone = (n: number | null | undefined) =>
  n == null ? undefined : n >= 0 ? ('up' as const) : ('down' as const)

/** Current market value of the position; the baseline carries it directly. */
const curValue = (r: SimulationRow) => r.baseline?.value ?? 0

function columnsFor(measure: Measure): Col[] {
  if (measure === 'shares') {
    return [
      { key: 'shs', label: 'Shares', value: r => fmtShares(r.currentShares), sortBy: r => r.currentShares },
      { key: 'sim', label: 'Sim', accent: true, strong: true, simOnly: true, value: r => fmtShares(r.simShares), sortBy: r => r.simShares },
      { key: 'd', label: 'Δ Shs', simOnly: true, value: r => signedShares(r.deltaShares), sortBy: r => Math.abs(r.deltaShares), tone: r => signTone(r.deltaShares) },
    ]
  }
  if (measure === 'value') {
    return [
      { key: 'val', label: 'Value', value: r => formatCompactUsd(curValue(r)), sortBy: r => curValue(r) },
      { key: 'sim', label: 'Sim', accent: true, strong: true, simOnly: true, value: r => formatCompactUsd(r.simNotional), sortBy: r => r.simNotional },
      {
        key: 'd', label: 'Δ $', simOnly: true,
        value: r => `${r.notional >= 0 ? '+' : '−'}${formatCompactUsd(Math.abs(r.notional))}`,
        sortBy: r => Math.abs(r.notional),
        tone: r => signTone(r.notional),
      },
    ]
  }
  // Weight. Benchmark and active live here because they are weight-space
  // figures — a share count has no benchmark to be active against. They are
  // shown whether or not a benchmark is configured: an em-dash column says
  // "no benchmark on this portfolio", where a hidden one says nothing at all.
  return [
    { key: 'wt', label: 'Wt%', value: r => r.currentWeight.toFixed(2), sortBy: r => r.currentWeight },
    { key: 'sim', label: 'Sim', accent: true, strong: true, simOnly: true, value: r => r.simWeight.toFixed(2), sortBy: r => r.simWeight },
    { key: 'd', label: 'Δ Wt', simOnly: true, value: r => signed(r.deltaWeight, 2), sortBy: r => Math.abs(r.deltaWeight), tone: r => signTone(r.deltaWeight) },
    { key: 'bench', label: 'Bench', value: r => (r.benchWeight != null ? r.benchWeight.toFixed(2) : '—'), sortBy: r => r.benchWeight ?? -Infinity },
    {
      key: 'act', label: 'Act',
      value: r => (r.activeWeight != null ? signed(r.activeWeight, 2) : '—'),
      sortBy: r => r.activeWeight ?? -Infinity,
      tone: r => signTone(r.activeWeight),
    },
    {
      key: 'simact', label: 'Sim Act', accent: true, strong: true, simOnly: true,
      value: r => (r.benchWeight != null ? signed(r.simWeight - r.benchWeight, 2) : '—'),
      sortBy: r => (r.benchWeight != null ? r.simWeight - r.benchWeight : -Infinity),
      tone: r => (r.benchWeight != null ? signTone(r.simWeight - r.benchWeight) : undefined),
    },
  ]
}

/**
 * The holdings simulation table, on a phone.
 *
 * The chrome above it was five bands deep — a summary card, a Holdings/Changed/
 * New filter, a search field, a sort control and a measure toggle — which left
 * the table itself a third of the screen. Most of it was redundant. The filter
 * duplicated a distinction the Simulation/Impact/Trades tabs already draw, and
 * "changed" is what sorting by Δ tells you. The sort control existed only
 * because the headers were not clickable, which is where a table's sort belongs.
 *
 * What is left is one toolbar row and a one-line summary. Sorting is by tapping
 * a column header, grouping and search are behind icons, and the measure toggle
 * stays because it is the thing that decides what the table is about.
 *
 * The symbol column is frozen and the header row is sticky, which is what makes
 * a wide table usable on a narrow screen: the numbers move, the name of the row
 * and the name of the column do not.
 *
 * Every write goes back through the props the desktop table already receives,
 * so the sync, convergence and ordering machinery in SimulationPage is
 * untouched.
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
  onAddAsset,
  assetSearch = '',
  onAssetSearchChange,
  assetSearchResults = [],
}: MobileSimulationListProps) {
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [measure, setMeasure] = useState<Measure>('weight')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [groupOpen, setGroupOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [sortKey, setSortKey] = useState<string>('wt')
  const [sortDesc, setSortDesc] = useState(true)

  const cols = useMemo(() => columnsFor(measure), [measure])

  const assetIds = useMemo(() => rows.filter(r => !r.isCash).map(r => r.asset_id), [rows])
  // Only fetched when a grouping actually needs a field the row does not carry.
  const { data: meta } = useAssetGroupingMeta(
    groupBy === 'country' || groupBy === 'industry' ? assetIds : []
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (r.isCash) return false
      if (q && !`${r.symbol} ${r.company_name}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, search])

  const sorted = useMemo(() => {
    const list = [...visible]
    if (sortKey === 'symbol') {
      list.sort((a, b) => a.symbol.localeCompare(b.symbol))
    } else {
      const col = cols.find(c => c.key === sortKey)
      const get = col?.sortBy
      if (get) {
        list.sort((a, b) => {
          const av = get(a)
          const bv = get(b)
          return typeof av === 'string' || typeof bv === 'string'
            ? String(av).localeCompare(String(bv))
            : (av as number) - (bv as number)
        })
      }
    }
    return sortDesc ? list.reverse() : list
  }, [visible, sortKey, sortDesc, cols])

  /** Rows under their group heading, or a single unnamed group. */
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ name: null as string | null, rows: sorted }]
    const buckets = new Map<string, SimulationRow[]>()
    for (const r of sorted) {
      const name =
        groupBy === 'sector'
          ? r.sector || 'Unclassified'
          : (meta?.[r.asset_id]?.[groupBy] ?? null) || 'Unclassified'
      if (!buckets.has(name)) buckets.set(name, [])
      buckets.get(name)!.push(r)
    }
    // Largest group first — a sector holding a third of the book should not sit
    // below one holding a single name because of alphabetical order.
    return [...buckets.entries()]
      .map(([name, rs]) => ({ name, rows: rs }))
      .sort((a, b) => b.rows.length - a.rows.length)
  }, [sorted, groupBy, meta])

  // Resolved from `rows` rather than captured: the row is recomputed on every
  // variant change, and a captured copy would show the sheet the pre-edit
  // numbers it just edited.
  const editingRow = editing ? rows.find(r => r.asset_id === editing) ?? null : null

  const openRow = (row: SimulationRow) => {
    if (row.isCommittedPending) return
    if (!row.variant) onCreateVariant(row.asset_id, 'add')
    setEditing(row.asset_id)
  }

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDesc(d => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const colCount = 1 + cols.length

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* One line, not a card. Four figures do not need 64px and a border. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="tabular-nums">
          <span className="font-semibold text-gray-900 dark:text-white">{summary.tradedCount}</span> trades
        </span>
        <span className="text-gray-300">·</span>
        <span
          className={clsx(
            'tabular-nums font-semibold',
            summary.netDeltaWeight >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          )}
        >
          {summary.netDeltaWeight >= 0 ? '+' : ''}
          {summary.netDeltaWeight.toFixed(2)}%
        </span>
        <span className="text-gray-300">·</span>
        <span className="tabular-nums">{formatCompactUsd(Math.abs(summary.totalNotional))}</span>
        {summary.conflictCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            {summary.conflictCount}
          </span>
        )}
      </div>

      {/* The only toolbar. Measure decides what the table is about; grouping and
          search are occasional, so they are icons. */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-3 pb-2">
        {searchOpen ? (
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find a position"
              className="w-full h-9 pl-8 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={() => { setSearch(''); setSearchOpen(false) }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-full text-gray-400"
              aria-label="Close search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-1 min-w-0 items-center p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800">
              {MEASURES.map(m => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setMeasure(m.key)
                    // The old sort key belongs to columns that no longer exist.
                    setSortKey(m.key === 'weight' ? 'wt' : m.key === 'shares' ? 'shs' : 'val')
                    setSortDesc(true)
                  }}
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

            <button
              type="button"
              onClick={() => setGroupOpen(true)}
              aria-label="Group positions"
              className={clsx(
                'shrink-0 h-9 px-2.5 inline-flex items-center gap-1 rounded-lg border text-[12px] font-medium no-touch-target',
                groupBy === 'none'
                  ? 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                  : 'border-primary-300 dark:border-primary-800 text-primary-700 dark:text-primary-300'
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              {groupBy !== 'none' && GROUPS.find(g => g.key === groupBy)?.label}
            </button>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Find a position"
              className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 no-touch-target"
            >
              <Search className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto overscroll-contain pb-24">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 px-3 text-gray-400">
            <p className="text-sm text-center">
              {search ? 'No position matches that.' : 'This portfolio has no holdings.'}
            </p>
          </div>
        ) : (
          <table className="w-max min-w-full border-separate border-spacing-0 text-[11px] tabular-nums">
            <thead>
              <tr>
                <Th
                  sticky
                  sorted={sortKey === 'symbol' ? (sortDesc ? 'desc' : 'asc') : undefined}
                  onClick={() => toggleSort('symbol')}
                >
                  Sym
                </Th>
                {cols.map(c => (
                  <Th
                    key={c.key}
                    accent={c.accent}
                    sorted={sortKey === c.key ? (sortDesc ? 'desc' : 'asc') : undefined}
                    onClick={c.sortBy ? () => toggleSort(c.key) : undefined}
                  >
                    {c.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(group => (
                <GroupBlock
                  key={group.name ?? '__all__'}
                  name={group.name}
                  rows={group.rows}
                  cols={cols}
                  colCount={colCount}
                  onOpen={openRow}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* The only route to a name the portfolio does not already hold. Every
          other entry point starts from an existing holding or an existing
          idea. */}
      {!readOnly && onAddAsset && onAssetSearchChange && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="absolute bottom-5 right-5 h-14 w-14 flex items-center justify-center rounded-full bg-primary-600 text-white shadow-lg no-touch-target"
          aria-label="Add a position the portfolio does not hold"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {onAddAsset && onAssetSearchChange && (
        <MobileAddPositionSheet
          open={addOpen}
          onClose={() => setAddOpen(false)}
          search={assetSearch}
          onSearchChange={onAssetSearchChange}
          results={assetSearchResults}
          existingAssetIds={new Set(rows.map(r => r.asset_id))}
          onAdd={asset => {
            onAddAsset(asset)
            // Open the sizing sheet on the new row as soon as the variant
            // lands. Adding a position and not sizing it leaves a row that
            // changes nothing, which is never the intent.
            setEditing(asset.id)
          }}
        />
      )}

      <BottomSheet open={groupOpen} onClose={() => setGroupOpen(false)} title="Group by" fitContent>
        <div className="px-3 pb-3 space-y-1">
          {GROUPS.map(g => (
            <button
              key={g.key}
              type="button"
              onClick={() => { setGroupBy(g.key); setGroupOpen(false) }}
              className={clsx(
                'w-full flex items-center rounded-xl px-3 py-3 text-left text-sm no-touch-target',
                groupBy === g.key
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300 font-semibold'
                  : 'text-gray-700 dark:text-gray-200 active:bg-gray-50 dark:active:bg-gray-800'
              )}
            >
              {g.label}
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

/**
 * A group heading plus its rows.
 *
 * The heading spans the table and carries the group's share of the book, since
 * "Technology" is only useful next to how much of the portfolio it is.
 */
function GroupBlock({
  name, rows, cols, colCount, onOpen,
}: {
  name: string | null
  rows: SimulationRow[]
  cols: Col[]
  colCount: number
  onOpen: (r: SimulationRow) => void
}) {
  const weight = rows.reduce((s, r) => s + r.simWeight, 0)
  const delta = rows.reduce((s, r) => s + r.deltaWeight, 0)

  return (
    <>
      {name && (
        <tr>
          <td
            colSpan={colCount}
            className="sticky left-0 px-2 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
          >
            <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {name}
              <span className="tabular-nums text-gray-400">{weight.toFixed(1)}%</span>
              {Math.abs(delta) >= 0.005 && (
                <span
                  className={clsx(
                    'tabular-nums',
                    delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                </span>
              )}
              <span className="text-gray-400">{rows.length}</span>
            </span>
          </td>
        </tr>
      )}
      {rows.map((row, i) => (
        <Row key={row.asset_id} row={row} cols={cols} even={i % 2 === 1} onOpen={() => onOpen(row)} />
      ))}
    </>
  )
}

/** Header cell. `sticky` freezes the symbol column; tapping sorts. */
function Th({
  children, sticky, accent, sorted, onClick,
}: {
  children: React.ReactNode
  sticky?: boolean
  accent?: boolean
  sorted?: 'asc' | 'desc'
  onClick?: () => void
}) {
  return (
    <th
      onClick={onClick}
      className={clsx(
        'sticky top-0 whitespace-nowrap px-2 py-1.5 font-semibold uppercase tracking-wider text-[9px]',
        'bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700',
        onClick && 'cursor-pointer active:bg-gray-200 dark:active:bg-gray-700',
        sorted ? 'text-gray-900 dark:text-white' : accent ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400',
        // The corner cell has to outrank both the sticky row and the sticky
        // column, or the scrolling headers slide over it.
        sticky ? 'left-0 z-30 text-left border-r border-gray-200 dark:border-gray-700' : 'z-20 text-right'
      )}
    >
      <span className={clsx('inline-flex items-center gap-0.5', !sticky && 'justify-end')}>
        {children}
        {sorted === 'desc' && <ChevronDown className="h-2.5 w-2.5" />}
        {sorted === 'asc' && <ChevronUp className="h-2.5 w-2.5" />}
      </span>
    </th>
  )
}

/**
 * One position. The whole row is the tap target — a cell this narrow cannot
 * hold a text field and its keyboard without covering the numbers the edit is
 * being judged against, so editing happens in the sheet.
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
