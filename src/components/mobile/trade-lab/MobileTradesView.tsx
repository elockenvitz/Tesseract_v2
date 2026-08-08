import { clsx } from 'clsx'
import { ArrowDownRight, ArrowUpRight, ListChecks } from 'lucide-react'
import type { TradeAction } from '../../../types/trading'

export interface MobileTradeRow {
  id: string
  symbol: string
  company_name: string
  sector: string | null
  shares: number
  price: number
  value: number
  weight: number
  currentHolding: number
  currentWeight: number
  cashImpact: number
}

export interface MobileTradeGroup {
  action: TradeAction
  trades: MobileTradeRow[]
  totalValue: number
  totalCashImpact: number
  totalWeight: number
  count: number
}

interface MobileTradesViewProps {
  groups: MobileTradeGroup[]
  totalBuyValue: number
  totalSellValue: number
  netCashFlow: number
  tradeStats: { total: number; buys: number; sells: number }
}

const ACTION_LABEL: Record<string, string> = {
  buy: 'Buys',
  add: 'Adds',
  sell: 'Sells',
  trim: 'Trims',
}

const isBuySide = (action: TradeAction) => action === 'buy' || action === 'add'

/**
 * The trade blotter on a phone.
 *
 * The desktop view puts each action group in a table inside `overflow-x-auto`.
 * On a 390px screen that is a table you drag sideways, and the moment you do
 * the column headers leave — shares, price, value and weight all become
 * unlabelled numbers. For a blotter, where the whole point is knowing which
 * figure is which, that is worse than not showing them.
 *
 * Each trade becomes a row of labelled pairs instead. Nothing is hidden and
 * nothing needs horizontal scrolling; the cost is vertical length, which a
 * phone has and horizontal space it does not.
 */
export function MobileTradesView({
  groups,
  totalBuyValue,
  totalSellValue,
  netCashFlow,
  tradeStats,
}: MobileTradesViewProps) {
  if (!groups.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
        <ListChecks className="h-8 w-8 opacity-50" />
        <p className="text-sm">No trades in this simulation yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Cash flow first: the one number a PM checks before anything else is
          whether this simulation needs cash or releases it. */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Net cash
          </span>
          <span
            className={clsx(
              'ml-auto text-xl font-bold tabular-nums',
              netCashFlow >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            )}
          >
            {netCashFlow >= 0 ? '+' : '−'}
            {formatUsd(Math.abs(netCashFlow))}
          </span>
        </div>

        {/* Buys and sells as opposing halves of one bar, because the question
            is their balance, not their absolute sizes. */}
        <CashBar buy={totalBuyValue} sell={totalSellValue} />

        <div className="mt-2 grid grid-cols-3 gap-2">
          <Figure label="Trades" value={String(tradeStats.total)} />
          <Figure label="Buying" value={formatUsd(totalBuyValue)} tone="up" />
          <Figure label="Selling" value={formatUsd(totalSellValue)} tone="down" />
        </div>
      </div>

      {groups.map(group => (
        <section key={group.action} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <header className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <span
              className={clsx(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide',
                isBuySide(group.action)
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              )}
            >
              {isBuySide(group.action) ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {ACTION_LABEL[group.action] ?? group.action}
            </span>
            <span className="text-[11px] text-gray-400">{group.count}</span>
            <span className="ml-auto text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
              {formatUsd(Math.abs(group.totalValue))}
            </span>
          </header>

          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {group.trades.map(t => (
              <div key={t.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{t.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
                    {t.company_name}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                    {formatUsd(Math.abs(t.value))}
                  </span>
                </div>

                {/* Labelled pairs rather than columns — the label travels with
                    the number instead of living in a header that scrolls away. */}
                <dl className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1">
                  <Pair label="Shares" value={formatShares(t.shares)} />
                  <Pair label="Price" value={t.price ? `$${t.price.toFixed(2)}` : '—'} />
                  <Pair
                    label="Weight"
                    value={`${t.currentWeight.toFixed(2)}% → ${(t.currentWeight + t.weight).toFixed(2)}%`}
                  />
                </dl>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function CashBar({ buy, sell }: { buy: number; sell: number }) {
  const total = buy + sell
  if (total <= 0) return null
  return (
    <div className="mt-2 flex h-2 w-full rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
      <span className="block h-full bg-emerald-500" style={{ width: `${(buy / total) * 100}%` }} aria-hidden />
      <span className="block h-full bg-red-500" style={{ width: `${(sell / total) * 100}%` }} aria-hidden />
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div
        className={clsx(
          'mt-0.5 text-sm font-bold tabular-nums',
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

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="text-[12px] tabular-nums text-gray-700 dark:text-gray-200 truncate">{value}</dd>
    </div>
  )
}

function formatShares(n: number): string {
  const abs = Math.abs(n)
  return `${n < 0 ? '−' : ''}${Math.round(abs).toLocaleString()}`
}

function formatUsd(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${value.toFixed(0)}`
}
