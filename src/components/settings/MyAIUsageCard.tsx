/**
 * MyAIUsageCard — user-facing AI usage + cost panel.
 *
 * Shows the current user their own ai_usage_log activity so they can track
 * what they've been spending through Tesseract. Works for BYOK (cost went
 * to their own provider bill) and platform mode (cost counted against
 * platform rate limits).
 */

import { Sparkles, DollarSign, Zap, BarChart3 } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '../ui/Card'
import { useMyAIUsage } from '../../hooks/useMyAIUsage'
import { useAIConfig } from '../../hooks/useAIConfig'

function fmtUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return '< $0.01'
  if (n < 1) return `$${n.toFixed(3)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtTokens(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function MyAIUsageCard() {
  const { effectiveConfig } = useAIConfig()
  const {
    isLoading, isError,
    costMtd, costToday, tokensToday, tokensMtd,
    requestsToday, cacheHitRate, cacheHasData,
    daily, byPurpose, byModel, rows,
  } = useMyAIUsage()

  const isBYOK = effectiveConfig.mode === 'byok'
  const totalRequests30d = rows.length
  const maxDailyCost = Math.max(...daily.map(d => d.cost), 0.0001)

  if (isError) {
    return (
      <Card>
        <div className="text-sm text-gray-500">Could not load usage history.</div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary-500" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Your AI Usage</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {isBYOK
                ? 'Your consumption through Tesseract — cost is what your provider (BYOK) charged.'
                : 'Your consumption against the platform AI budget.'}
            </p>
          </div>
          {totalRequests30d > 0 && (
            <span className="text-xs text-gray-500 shrink-0">
              {totalRequests30d.toLocaleString()} requests · last 30 days
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}
          </div>
        ) : totalRequests30d === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            <Sparkles className="w-6 h-6 mx-auto mb-2 text-gray-300" />
            No AI activity yet. Start using AI features and your usage will appear here.
          </div>
        ) : (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-3 gap-3">
              <KpiTile
                icon={DollarSign}
                iconClass="text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20"
                label="Cost · month-to-date"
                value={fmtUsd(costMtd)}
                sub={`${fmtUsd(costToday)} in last 24h`}
              />
              <KpiTile
                icon={Sparkles}
                iconClass="text-blue-600 bg-blue-50 dark:bg-blue-900/20"
                label="Tokens · last 24h"
                value={fmtTokens(tokensToday)}
                sub={`${requestsToday.toLocaleString()} requests · ${fmtTokens(tokensMtd)} MTD`}
              />
              <KpiTile
                icon={Zap}
                iconClass="text-amber-600 bg-amber-50 dark:bg-amber-900/20"
                label="Cache hit rate · 24h"
                value={cacheHasData ? `${(cacheHitRate * 100).toFixed(0)}%` : '—'}
                sub={cacheHasData ? 'Higher is cheaper' : 'No cached requests yet'}
              />
            </div>

            {/* Daily cost chart */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  Daily cost · last 14 days
                </h4>
                <span className="text-xs text-gray-500">
                  {fmtUsd(daily.reduce((s, d) => s + d.cost, 0))} total
                </span>
              </div>
              <div className="flex items-end gap-1 h-20">
                {daily.map(d => {
                  const h = Math.max(2, (d.cost / maxDailyCost) * 100)
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center group relative">
                      <div
                        className={clsx(
                          'w-full rounded-t transition-colors',
                          d.cost > 0 ? 'bg-primary-400 group-hover:bg-primary-500' : 'bg-gray-100 dark:bg-gray-700'
                        )}
                        style={{ height: `${h}%` }}
                      />
                      <div className="text-[9px] text-gray-400 mt-1">{d.date.slice(5)}</div>
                      <div className="absolute bottom-full mb-1 hidden group-hover:block px-2 py-1 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap z-10">
                        {d.date} · {fmtUsd(d.cost)} · {d.requests} req
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* By purpose + by model (side by side, compact) */}
            {(byPurpose.length > 0 || byModel.length > 0) && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                    By purpose · MTD
                  </h4>
                  {byPurpose.length === 0 ? (
                    <div className="text-xs text-gray-400 italic">No activity this month yet.</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {byPurpose.map(p => {
                        const total = byPurpose.reduce((s, x) => s + x.cost, 0) || 1
                        const pct = (p.cost / total) * 100
                        return (
                          <li key={p.key}>
                            <div className="flex items-baseline justify-between text-xs mb-0.5">
                              <span className="font-medium text-gray-800 dark:text-gray-200 capitalize">{p.key}</span>
                              <span className="tabular-nums text-gray-700 dark:text-gray-300">{fmtUsd(p.cost)}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                              <div className="h-full bg-primary-400 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
                <div>
                  <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                    By model · MTD
                  </h4>
                  {byModel.length === 0 ? (
                    <div className="text-xs text-gray-400 italic">No activity this month yet.</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {byModel.slice(0, 4).map(p => {
                        const total = byModel.reduce((s, x) => s + x.cost, 0) || 1
                        const pct = (p.cost / total) * 100
                        return (
                          <li key={p.key}>
                            <div className="flex items-baseline justify-between text-xs mb-0.5">
                              <span className="font-medium text-gray-800 dark:text-gray-200 truncate mr-2" title={p.key}>{p.key}</span>
                              <span className="tabular-nums text-gray-700 dark:text-gray-300 shrink-0">{fmtUsd(p.cost)}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                              <div className="h-full bg-sky-400 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {isBYOK && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">
                Cost estimates use public provider pricing. Authoritative billing is in your provider's dashboard.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

function KpiTile({ icon: Icon, iconClass, label, value, sub }: {
  icon: typeof DollarSign
  iconClass: string
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <div className={clsx('inline-flex p-1.5 rounded-lg', iconClass)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="mt-2">
        <div className="text-xl font-semibold text-gray-900 dark:text-white tabular-nums">{value}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
        {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}
