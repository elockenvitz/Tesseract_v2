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
 * The desktop sorts by clicking a column header. With no headers to click, the
 * sort is an explicit control — and the defaults differ by intent: scanning
 * holdings you want the biggest positions first, reviewing changes you want the
 * biggest moves first.
 */
type Sort = 'weight' | 'delta' | 'active' | 'symbol'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'delta', label: 'Change' },
  { key: 'active', label: 'Active' },
  { key: 'symbol', label: 'Symbol' },
]

/**
 * Named for what the list contains, not for a state a position is in.
 * "Trading / All positions / New" made the reader work out that the first was
 * a subset of the second, and defaulting to it showed an empty screen on any
 * lab where nothing had been sized yet.
 */
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Holdings' },
  { key: 'changed', label: 'Changed' },
  { key: 'new', label: 'New' },
]

const ACTION_TONE: Record<string, string> = {
  buy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  add: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  sell: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  trim: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

/**
 * The simulation as a list, for a phone.
 *
 * The desktop surface is an eleven-column keyboard-driven table. That does not
 * degrade to 390px — it is not a matter of hiding columns, because the columns
 * *are* the product: current versus simulated, in weight and in shares, with
 * both deltas. Reflowed to a phone it becomes a horizontally scrolling grid
 * whose headers leave the screen, which is worse than useless for numbers whose
 * meaning comes from their label.
 *
 * So each position becomes a card carrying the one comparison that matters —
 * where the weight is now and where the sizing takes it — and the rest moves
 * into the editor, which is a full sheet with room to show it. What is lost is
 * scanning twenty rows at once. What is gained is being able to change one
 * without a keyboard, which is the thing this surface is for on a phone: an
 * idea tested during a meeting, not a book rebalanced at a desk.
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

  // Kept resolved from `rows` rather than held as an object: the row is
  // recomputed on every variant change, and a captured copy would show the
  // pre-edit numbers in the sheet that just edited them.
  const editingRow = editing ? rows.find(r => r.asset_id === editing) ?? null : null

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* What this simulation does, in three numbers. On the desktop this is a
          footer of column totals; a footer is unreachable on a phone, and this
          is the first thing you want, not the last. */}
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

      <div className="flex-shrink-0 px-3 pt-2 pb-1 space-y-2">
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
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-24 space-y-2">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <p className="text-sm text-center">
              {search
                ? 'No position matches that.'
                : filter === 'changed'
                  ? 'Nothing changed yet. Open a holding to size it.'
                  : filter === 'new'
                    ? 'No new positions in this simulation.'
                    : 'This portfolio has no holdings.'}
            </p>
          </div>
        ) : (
          sorted.map(row => (
            <PositionCard
              key={row.asset_id}
              row={row}
              hasBenchmark={hasBenchmark}
              onOpen={() => {
                // An untraded row has no variant to edit yet. Creating it here
                // mirrors the desktop's click-to-create, and the sheet opens on
                // the row that comes back from the recompute.
                if (!row.variant) onCreateVariant(row.asset_id, 'add')
                setEditing(row.asset_id)
              }}
            />
          ))
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

/**
 * One position: where it is, where the sizing takes it, and what that costs.
 *
 * Untraded rows are deliberately quieter rather than hidden — the whole
 * portfolio has to stay reachable, because sizing a position you do not
 * currently hold starts from finding it.
 */
/**
 * One position, with every field the desktop table carries.
 *
 * The earlier card showed weight, shares and notional and dropped benchmark and
 * active weight entirely — which meant sizing against a benchmark, the reason
 * the active column exists, could not be done from a phone at all. All eleven
 * desktop columns are here; the difference is that they are labelled rows
 * rather than headed columns, so nothing depends on a header that has scrolled
 * out of view.
 *
 * Untraded rows show the current column only. Repeating the current figure in a
 * "simulated" column that has not changed would imply a change that has not
 * been made.
 */
function PositionCard({
  row,
  hasBenchmark,
  onOpen,
}: {
  row: SimulationRow
  hasBenchmark: boolean
  onOpen: () => void
}) {
  const traded = !!row.variant?.sizing_input
  const locked = row.isCommittedPending
  // Active weight after the trade. The row carries the current one; the
  // simulated one is the whole point of sizing in active space.
  const simActive = row.benchWeight != null ? row.simWeight - row.benchWeight : null
  const deltaActive =
    simActive != null && row.activeWeight != null ? simActive - row.activeWeight : null

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={locked}
      className={clsx(
        'w-full text-left rounded-xl border bg-white dark:bg-gray-900 p-3 active:bg-gray-50 dark:active:bg-gray-800 disabled:opacity-60',
        traded
          ? row.deltaWeight >= 0
            ? 'border-l-[3px] border-l-emerald-500 border-gray-200 dark:border-gray-700'
            : 'border-l-[3px] border-l-red-500 border-gray-200 dark:border-gray-700'
          : 'border-gray-200 dark:border-gray-700'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-gray-900 dark:text-white">{row.symbol}</span>
        {traded && (
          <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase', ACTION_TONE[row.derivedAction] ?? 'bg-gray-100 text-gray-600')}>
            {row.derivedAction}
          </span>
        )}
        {row.isNew && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            New
          </span>
        )}
        {row.hasConflict && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
        {locked && <Lock className="h-3.5 w-3.5 text-gray-400" />}
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">{row.company_name}</span>
        {traded && (
          <span
            className={clsx(
              'shrink-0 text-sm font-semibold tabular-nums',
              row.notional >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            )}
          >
            {row.notional >= 0 ? '+' : '−'}
            {formatCompactUsd(Math.abs(row.notional))}
          </span>
        )}
        {!traded && !locked && (
          <span className="shrink-0 text-[11px] text-primary-600 dark:text-primary-400">Size</span>
        )}
      </div>

      {/* Three columns, headed once. A grid rather than prose because these are
          the same figures the desk reads on the board and they should line up. */}
      <div className="mt-2 grid grid-cols-[3.25rem_1fr_1fr_1fr] gap-x-1.5 gap-y-1 items-baseline">
        <span />
        <Head>Now</Head>
        <Head>{traded ? 'Sim' : ''}</Head>
        <Head>{traded ? 'Δ' : ''}</Head>

        <Label>Weight</Label>
        <Num>{row.currentWeight.toFixed(2)}%</Num>
        <Num strong>{traded ? `${row.simWeight.toFixed(2)}%` : ''}</Num>
        <Num tone={row.deltaWeight >= 0 ? 'up' : 'down'}>
          {traded ? `${row.deltaWeight >= 0 ? '+' : ''}${row.deltaWeight.toFixed(2)}` : ''}
        </Num>

        <Label>Shares</Label>
        <Num>{formatShares(row.currentShares)}</Num>
        <Num strong>{traded ? formatShares(row.simShares) : ''}</Num>
        <Num tone={row.deltaShares >= 0 ? 'up' : 'down'}>
          {traded ? `${row.deltaShares >= 0 ? '+' : ''}${formatShares(row.deltaShares)}` : ''}
        </Num>

        {hasBenchmark && (
          <>
            <Label>Bench</Label>
            <Num>{row.benchWeight != null ? `${row.benchWeight.toFixed(2)}%` : '—'}</Num>
            <Num>—</Num>
            <Num>—</Num>

            <Label>Active</Label>
            <Num tone={(row.activeWeight ?? 0) >= 0 ? 'up' : 'down'}>
              {row.activeWeight != null ? `${row.activeWeight >= 0 ? '+' : ''}${row.activeWeight.toFixed(2)}` : '—'}
            </Num>
            <Num strong tone={(simActive ?? 0) >= 0 ? 'up' : 'down'}>
              {traded && simActive != null ? `${simActive >= 0 ? '+' : ''}${simActive.toFixed(2)}` : ''}
            </Num>
            <Num tone={(deltaActive ?? 0) >= 0 ? 'up' : 'down'}>
              {traded && deltaActive != null ? `${deltaActive >= 0 ? '+' : ''}${deltaActive.toFixed(2)}` : ''}
            </Num>
          </>
        )}
      </div>
    </button>
  )
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 text-right">
      {children}
    </span>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{children}</span>
  )
}

function Num({
  children, strong, tone,
}: {
  children: React.ReactNode
  strong?: boolean
  tone?: 'up' | 'down'
}) {
  const empty = children === '' || children == null
  return (
    <span
      className={clsx(
        'text-[12px] tabular-nums text-right',
        empty && 'text-transparent',
        !empty && strong && 'font-semibold text-gray-900 dark:text-white',
        !empty && !strong && (
          tone === 'up' ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'down' ? 'text-red-600 dark:text-red-400'
            : 'text-gray-600 dark:text-gray-300'
        )
      )}
    >
      {empty ? '—' : children}
    </span>
  )
}

function formatShares(n: number): string {
  const abs = Math.abs(n)
  const body = abs >= 10_000 ? `${(abs / 1000).toFixed(1)}k` : Math.round(abs).toLocaleString()
  return `${n < 0 ? '−' : ''}${body}`
}

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${value.toFixed(0)}`
}
