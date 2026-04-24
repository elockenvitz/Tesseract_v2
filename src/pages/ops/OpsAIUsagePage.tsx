/**
 * OpsAIUsagePage — Platform AI consumption + cost dashboard.
 *
 * Everything here is a read-only query against ai_usage_log. No infrastructure
 * dependencies beyond the edge function already writing token counts + cost.
 *
 * Sections:
 *  1. KPI tiles — month-to-date cost, tokens today, requests today, cache hit rate
 *  2. Daily spark (last 14 days) — requests and cost by day
 *  3. Top users this month by cost (table)
 *  4. Cost split by purpose (chat / column / snippet / analysis)
 *  5. Cost split by model
 *  6. Recent errors / rate-limit breaches (last 50)
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, DollarSign, Zap, Users, Database, RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'

type UsageRow = {
  id: string
  user_id: string
  created_at: string
  mode: string | null
  provider: string | null
  model: string | null
  purpose: string | null
  context_type: string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_write_tokens: number | null
  cache_read_tokens: number | null
  estimated_cost: number | null
  response_time_ms: number | null
}

type UserRow = { id: string; email: string | null; first_name: string | null; last_name: string | null }

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

function displayName(u: UserRow | null | undefined): string {
  if (!u) return 'Unknown'
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return full || u.email?.split('@')[0] || 'Unknown'
}

export function OpsAIUsagePage() {
  // ─── Pull all usage for the last 30 days (one query, everything derived in memory) ─
  const { data: rows = [], isLoading, refetch } = useQuery<UsageRow[]>({
    queryKey: ['ops-ai-usage-30d'],
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data, error } = await supabase
        .from('ai_usage_log')
        .select('id, user_id, created_at, mode, provider, model, purpose, context_type, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, estimated_cost, response_time_ms')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(10000)
      if (error) throw error
      return (data || []) as UsageRow[]
    },
    staleTime: 60_000,
  })

  // ─── Users (joined client-side) ────────────────────────────
  const userIds = useMemo(() => [...new Set(rows.map(r => r.user_id).filter(Boolean))], [rows])
  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ['ops-ai-usage-users', userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
      return (data || []) as UserRow[]
    },
  })
  const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users])

  // ─── Derived metrics ───────────────────────────────────────
  const now = Date.now()
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const sinceDay = now - 86400000

  const metrics = useMemo(() => {
    let costMtd = 0, costToday = 0
    let inputTokToday = 0, outputTokToday = 0
    let cacheReadTokToday = 0, cacheWriteTokToday = 0
    let requestsToday = 0
    let cacheableRequestsToday = 0

    for (const r of rows) {
      const t = new Date(r.created_at).getTime()
      const cost = Number(r.estimated_cost) || 0
      if (t >= startOfMonth) costMtd += cost
      if (t >= sinceDay) {
        costToday += cost
        inputTokToday += r.input_tokens || 0
        outputTokToday += r.output_tokens || 0
        cacheReadTokToday += r.cache_read_tokens || 0
        cacheWriteTokToday += r.cache_write_tokens || 0
        requestsToday += 1
        // Count a request as "cacheable" if it's Anthropic (we set cache_control)
        if (r.provider === 'anthropic') cacheableRequestsToday += 1
      }
    }
    const cacheHitRate = (cacheReadTokToday + cacheWriteTokToday) > 0
      ? cacheReadTokToday / (cacheReadTokToday + cacheWriteTokToday)
      : 0

    return {
      costMtd,
      costToday,
      requestsToday,
      tokensToday: inputTokToday + outputTokToday,
      cacheHitRate,
      cacheableRequestsToday,
    }
  }, [rows, startOfMonth, sinceDay])

  // ─── Daily spark (last 14 days) ────────────────────────────
  const daily = useMemo(() => {
    const buckets = new Map<string, { date: string; cost: number; requests: number }>()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      const key = d.toISOString().slice(0, 10)
      buckets.set(key, { date: key, cost: 0, requests: 0 })
    }
    for (const r of rows) {
      const key = r.created_at.slice(0, 10)
      const b = buckets.get(key)
      if (!b) continue
      b.cost += Number(r.estimated_cost) || 0
      b.requests += 1
    }
    return [...buckets.values()]
  }, [rows])

  const maxDailyCost = Math.max(...daily.map(d => d.cost), 0.0001)

  // ─── Top users this month ──────────────────────────────────
  const topUsersMtd = useMemo(() => {
    const byUser = new Map<string, { user_id: string; cost: number; tokens: number; requests: number }>()
    for (const r of rows) {
      const t = new Date(r.created_at).getTime()
      if (t < startOfMonth) continue
      const entry = byUser.get(r.user_id) || { user_id: r.user_id, cost: 0, tokens: 0, requests: 0 }
      entry.cost += Number(r.estimated_cost) || 0
      entry.tokens += (r.input_tokens || 0) + (r.output_tokens || 0)
      entry.requests += 1
      byUser.set(r.user_id, entry)
    }
    return [...byUser.values()].sort((a, b) => b.cost - a.cost).slice(0, 20)
  }, [rows, startOfMonth])

  // ─── By purpose / by model ─────────────────────────────────
  const byPurposeMtd = useMemo(() => {
    const m = new Map<string, { key: string; cost: number; requests: number }>()
    for (const r of rows) {
      const t = new Date(r.created_at).getTime()
      if (t < startOfMonth) continue
      const k = r.purpose || '(untagged)'
      const entry = m.get(k) || { key: k, cost: 0, requests: 0 }
      entry.cost += Number(r.estimated_cost) || 0
      entry.requests += 1
      m.set(k, entry)
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost)
  }, [rows, startOfMonth])

  const byModelMtd = useMemo(() => {
    const m = new Map<string, { key: string; cost: number; requests: number }>()
    for (const r of rows) {
      const t = new Date(r.created_at).getTime()
      if (t < startOfMonth) continue
      const k = r.model || '(unknown)'
      const entry = m.get(k) || { key: k, cost: 0, requests: 0 }
      entry.cost += Number(r.estimated_cost) || 0
      entry.requests += 1
      m.set(k, entry)
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost)
  }, [rows, startOfMonth])

  // ─── Recent activity (last 50) ─────────────────────────────
  const recent = useMemo(() => rows.slice(0, 50), [rows])

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-purple-500" />
            <h1 className="text-2xl font-semibold text-gray-900">AI Usage</h1>
          </div>
          <p className="text-sm text-gray-500">Token consumption and cost across all users. 30-day window.</p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-3">
        <KpiTile
          icon={DollarSign}
          iconClass="text-emerald-600 bg-emerald-50"
          label="Cost · MTD"
          value={fmtUsd(metrics.costMtd)}
          sub={`${fmtUsd(metrics.costToday)} today`}
        />
        <KpiTile
          icon={Database}
          iconClass="text-blue-600 bg-blue-50"
          label="Tokens · today"
          value={fmtTokens(metrics.tokensToday)}
          sub={`${metrics.requestsToday.toLocaleString()} requests`}
        />
        <KpiTile
          icon={Zap}
          iconClass="text-amber-600 bg-amber-50"
          label="Cache hit rate · today"
          value={`${(metrics.cacheHitRate * 100).toFixed(0)}%`}
          sub={`${metrics.cacheableRequestsToday} Anthropic requests`}
        />
        <KpiTile
          icon={Users}
          iconClass="text-purple-600 bg-purple-50"
          label="Active users · today"
          value={new Set(rows.filter(r => new Date(r.created_at).getTime() >= sinceDay).map(r => r.user_id)).size.toString()}
          sub={`${new Set(rows.map(r => r.user_id)).size} in last 30d`}
        />
      </div>

      {/* Daily spark + by-purpose/by-model side-by-side */}
      <div className="grid grid-cols-3 gap-4">
        {/* Daily cost chart (2 cols) */}
        <div className="col-span-2 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Daily cost · last 14 days</h3>
            <span className="text-xs text-gray-500">
              {fmtUsd(daily.reduce((s, d) => s + d.cost, 0))} total · {daily.reduce((s, d) => s + d.requests, 0).toLocaleString()} requests
            </span>
          </div>
          <div className="flex items-end gap-1 h-28">
            {daily.map(d => {
              const h = Math.max(2, (d.cost / maxDailyCost) * 100)
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center group relative">
                  <div
                    className={clsx(
                      'w-full rounded-t transition-colors',
                      d.cost > 0 ? 'bg-emerald-400 group-hover:bg-emerald-500' : 'bg-gray-100'
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

        {/* By purpose */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Cost by purpose · MTD</h3>
          {byPurposeMtd.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No AI activity this month yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {byPurposeMtd.map(p => {
                const total = byPurposeMtd.reduce((s, x) => s + x.cost, 0) || 1
                const pct = (p.cost / total) * 100
                return (
                  <li key={p.key}>
                    <div className="flex items-baseline justify-between text-xs mb-0.5">
                      <span className="font-medium text-gray-800 capitalize">{p.key}</span>
                      <span className="tabular-nums text-gray-700">{fmtUsd(p.cost)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-purple-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{p.requests.toLocaleString()} requests</div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Top users + by model */}
      <div className="grid grid-cols-3 gap-4">
        {/* Top users (2 cols) */}
        <div className="col-span-2 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">Top users · month-to-date</h3>
            <span className="text-xs text-gray-500">{topUsersMtd.length} with activity</span>
          </div>
          {topUsersMtd.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No usage this month yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">User</th>
                  <th className="text-right px-4 py-2 font-medium">Cost</th>
                  <th className="text-right px-4 py-2 font-medium">Tokens</th>
                  <th className="text-right px-4 py-2 font-medium">Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topUsersMtd.map((u, i) => {
                  const user = userMap.get(u.user_id)
                  return (
                    <tr key={u.user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 tabular-nums w-5">{i + 1}.</span>
                          <div>
                            <div className="font-medium">{displayName(user)}</div>
                            {user?.email && <div className="text-[11px] text-gray-500">{user.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-900">{fmtUsd(u.cost)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{fmtTokens(u.tokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{u.requests.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* By model */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Cost by model · MTD</h3>
          {byModelMtd.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No AI activity this month yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {byModelMtd.slice(0, 6).map(p => {
                const total = byModelMtd.reduce((s, x) => s + x.cost, 0) || 1
                const pct = (p.cost / total) * 100
                return (
                  <li key={p.key}>
                    <div className="flex items-baseline justify-between text-xs mb-0.5">
                      <span className="font-medium text-gray-800 truncate mr-2" title={p.key}>{p.key}</span>
                      <span className="tabular-nums text-gray-700 shrink-0">{fmtUsd(p.cost)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-sky-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{p.requests.toLocaleString()} requests</div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Recent activity</h3>
          <span className="text-xs text-gray-500">Most recent 50 requests</span>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No AI requests logged yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[10px] text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">When</th>
                <th className="text-left px-4 py-2 font-medium">User</th>
                <th className="text-left px-4 py-2 font-medium">Purpose</th>
                <th className="text-left px-4 py-2 font-medium">Model</th>
                <th className="text-right px-4 py-2 font-medium">In</th>
                <th className="text-right px-4 py-2 font-medium">Out</th>
                <th className="text-right px-4 py-2 font-medium">Cache</th>
                <th className="text-right px-4 py-2 font-medium">Cost</th>
                <th className="text-right px-4 py-2 font-medium">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recent.map(r => {
                const user = userMap.get(r.user_id)
                const when = new Date(r.created_at)
                const ago = Math.floor((Date.now() - when.getTime()) / 60000)
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-1.5 text-gray-600 whitespace-nowrap" title={when.toISOString()}>
                      {ago < 1 ? 'just now' : ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.floor(ago / 60)}h ago` : `${Math.floor(ago / 1440)}d ago`}
                    </td>
                    <td className="px-4 py-1.5 text-gray-800 truncate max-w-[14ch]">{displayName(user)}</td>
                    <td className="px-4 py-1.5 text-gray-600 capitalize">{r.purpose || '—'}</td>
                    <td className="px-4 py-1.5 text-gray-600 truncate max-w-[22ch]" title={r.model || undefined}>{r.model || '—'}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-gray-700">{fmtTokens(r.input_tokens || 0)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-gray-700">{fmtTokens(r.output_tokens || 0)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">
                      {r.cache_read_tokens ? `${fmtTokens(r.cache_read_tokens)} read` : r.cache_write_tokens ? `${fmtTokens(r.cache_write_tokens)} write` : '—'}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-gray-900 font-medium">{fmtUsd(Number(r.estimated_cost) || 0)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{r.response_time_ms ? `${r.response_time_ms}ms` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── KPI tile ─────────────────────────────────────────────────

function KpiTile({ icon: Icon, iconClass, label, value, sub }: {
  icon: typeof DollarSign
  iconClass: string
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className={clsx('p-2 rounded-lg', iconClass)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-3">
        <div className="text-2xl font-semibold text-gray-900 tabular-nums">{value}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
        {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}
