/**
 * OpsMetricsPage — Platform analytics for investor-grade metrics.
 *
 * Sections:
 * 1. DAU/WAU/MAU with ratio (stickiness)
 * 2. Workflow completion funnel
 * 3. Time-to-value (first login → first meaningful action)
 * 4. Feature adoption breakdown
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp, Users, Target, Clock, BarChart3,
  ArrowRight, CheckCircle2, Zap,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'

export function OpsMetricsPage() {
  // ─── Session data (last 30 days) ───────────────────────────

  const { data: sessionData } = useQuery({
    queryKey: ['ops-metrics-sessions'],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data, error } = await supabase
        .from('user_sessions')
        .select('user_id, organization_id, started_at, duration_seconds')
        .gte('started_at', thirtyDaysAgo)
        .order('started_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // ─── All users with first login ────────────────────────────

  const { data: allUsers = [] } = useQuery({
    queryKey: ['ops-metrics-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, created_at')
      if (error) throw error
      return data || []
    },
  })

  // ─── Workflow funnel data ──────────────────────────────────

  const { data: funnelData } = useQuery({
    queryKey: ['ops-metrics-funnel'],
    queryFn: async () => {
      const [
        sessionsRes,
        contributionsRes,
        notesRes,
        ratingsRes,
        thoughtsRes,
        ideasRes,
        simulationsRes,
        acceptedRes,
      ] = await Promise.all([
        supabase.from('user_sessions').select('user_id').then(r => new Set((r.data || []).map(d => d.user_id))),
        supabase.from('asset_contributions').select('user_id').then(r => new Set((r.data || []).map(d => d.user_id))),
        supabase.from('asset_notes').select('created_by').then(r => new Set((r.data || []).map(d => d.created_by))),
        supabase.from('analyst_ratings').select('user_id').then(r => new Set((r.data || []).map(d => d.user_id))),
        supabase.from('quick_thoughts').select('user_id').then(r => new Set((r.data || []).map(d => d.user_id))),
        supabase.from('trade_queue_items').select('created_by').then(r => new Set((r.data || []).map(d => d.created_by))),
        supabase.from('simulations').select('created_by').then(r => new Set((r.data || []).map(d => d.created_by))),
        supabase.from('accepted_trades').select('accepted_by').then(r => new Set((r.data || []).map(d => d.accepted_by))),
      ])

      return {
        loggedIn: sessionsRes,
        researched: new Set([...contributionsRes, ...notesRes, ...ratingsRes]),
        communicated: thoughtsRes,
        createdIdea: ideasRes,
        ranSimulation: simulationsRes,
        committedTrade: acceptedRes,
      }
    },
  })

  // ─── Time-to-value: first session → first action per user ──

  const { data: timeToValueData } = useQuery({
    queryKey: ['ops-metrics-ttv'],
    queryFn: async () => {
      // Get first session per user
      const { data: sessions } = await supabase
        .from('user_sessions')
        .select('user_id, started_at')
        .order('started_at', { ascending: true })

      const firstSession = new Map<string, string>()
      for (const s of sessions || []) {
        if (!firstSession.has(s.user_id)) firstSession.set(s.user_id, s.started_at)
      }

      // Get first meaningful action per user (contribution, note, rating, idea, thought)
      const actionTables = [
        { table: 'asset_contributions', userCol: 'user_id', dateCol: 'created_at' },
        { table: 'asset_notes', userCol: 'created_by', dateCol: 'created_at' },
        { table: 'analyst_ratings', userCol: 'user_id', dateCol: 'created_at' },
        { table: 'trade_queue_items', userCol: 'created_by', dateCol: 'created_at' },
        { table: 'quick_thoughts', userCol: 'user_id', dateCol: 'created_at' },
      ]

      const firstAction = new Map<string, string>()
      for (const { table, userCol, dateCol } of actionTables) {
        const { data } = await supabase
          .from(table)
          .select(`${userCol}, ${dateCol}`)
          .order(dateCol, { ascending: true })

        for (const row of data || []) {
          const userId = (row as any)[userCol]
          const date = (row as any)[dateCol]
          if (!firstAction.has(userId) || date < firstAction.get(userId)!) {
            firstAction.set(userId, date)
          }
        }
      }

      // Calculate time-to-value for each user
      const ttvMinutes: number[] = []
      for (const [userId, sessionDate] of firstSession) {
        const actionDate = firstAction.get(userId)
        if (actionDate) {
          const diff = (new Date(actionDate).getTime() - new Date(sessionDate).getTime()) / 60000
          if (diff >= 0) ttvMinutes.push(diff)
        }
      }

      return {
        ttvMinutes,
        usersWithSession: firstSession.size,
        usersWithAction: firstAction.size,
        activationRate: firstSession.size > 0 ? Math.round((firstAction.size / firstSession.size) * 100) : 0,
      }
    },
  })

  // ─── Compute DAU/WAU/MAU ───────────────────────────────────

  const engagement = useMemo(() => {
    if (!sessionData) return null

    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const weekAgo = new Date(now.getTime() - 7 * 86400000)
    const monthAgo = new Date(now.getTime() - 30 * 86400000)

    const dauUsers = new Set<string>()
    const wauUsers = new Set<string>()
    const mauUsers = new Set<string>()

    // Daily active by date for chart
    const dailyActive = new Map<string, Set<string>>()

    for (const s of sessionData) {
      const sessionDate = s.started_at.split('T')[0]
      const sessionTime = new Date(s.started_at)

      // DAU: sessions today
      if (sessionDate === today) dauUsers.add(s.user_id)
      // WAU: sessions in last 7 days
      if (sessionTime >= weekAgo) wauUsers.add(s.user_id)
      // MAU: sessions in last 30 days
      if (sessionTime >= monthAgo) mauUsers.add(s.user_id)

      // Daily breakdown
      if (!dailyActive.has(sessionDate)) dailyActive.set(sessionDate, new Set())
      dailyActive.get(sessionDate)!.add(s.user_id)
    }

    // DAU/WAU ratio (stickiness) — what % of weekly users come back daily (avg)
    // Calculate average DAU over last 7 days
    const last7Days: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0]
      last7Days.push(d)
    }
    const avgDau = last7Days.reduce((sum, d) => sum + (dailyActive.get(d)?.size || 0), 0) / 7
    const stickiness = wauUsers.size > 0 ? Math.round((avgDau / wauUsers.size) * 100) : 0

    // Total session time
    const totalMinutes = sessionData.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60
    const avgSessionMin = sessionData.length > 0 ? Math.round(totalMinutes / sessionData.length) : 0

    // Build daily chart data (last 14 days)
    const dailyChart: { date: string; users: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0]
      dailyChart.push({ date: d, users: dailyActive.get(d)?.size || 0 })
    }

    return {
      dau: dauUsers.size,
      wau: wauUsers.size,
      mau: mauUsers.size,
      stickiness,
      avgSessionMin,
      totalSessions: sessionData.length,
      dailyChart,
    }
  }, [sessionData])

  // ─── Workflow funnel ───────────────────────────────────────

  const funnel = useMemo(() => {
    if (!funnelData) return null
    const totalUsers = allUsers.length
    const steps = [
      { label: 'Signed Up', count: totalUsers, icon: Users },
      { label: 'Logged In', count: funnelData.loggedIn.size, icon: Zap },
      { label: 'Did Research', count: funnelData.researched.size, icon: BarChart3 },
      { label: 'Shared Thought', count: funnelData.communicated.size, icon: Target },
      { label: 'Created Idea', count: funnelData.createdIdea.size, icon: Target },
      { label: 'Ran Simulation', count: funnelData.ranSimulation.size, icon: TrendingUp },
      { label: 'Committed Trade', count: funnelData.committedTrade.size, icon: CheckCircle2 },
    ]
    return steps
  }, [funnelData, allUsers])

  // ─── Time-to-value stats ───────────────────────────────────

  const ttv = useMemo(() => {
    if (!timeToValueData || timeToValueData.ttvMinutes.length === 0) return null
    const sorted = [...timeToValueData.ttvMinutes].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const p90 = sorted[Math.floor(sorted.length * 0.9)]
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
    return {
      median,
      p90,
      avg,
      activationRate: timeToValueData.activationRate,
      usersWithAction: timeToValueData.usersWithAction,
      usersWithSession: timeToValueData.usersWithSession,
    }
  }, [timeToValueData])

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Platform Metrics</h1>
        <p className="text-sm text-gray-500 mt-1">Engagement, workflow adoption, and time-to-value</p>
      </div>

      {/* ── DAU / WAU / MAU ────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">User Engagement</h2>
        <div className="grid grid-cols-5 gap-3 mb-4">
          <MetricTile label="DAU" value={engagement?.dau ?? 0} sublabel="Today" accent="text-green-600" />
          <MetricTile label="WAU" value={engagement?.wau ?? 0} sublabel="Last 7 days" accent="text-blue-600" />
          <MetricTile label="MAU" value={engagement?.mau ?? 0} sublabel="Last 30 days" accent="text-indigo-600" />
          <MetricTile
            label="Stickiness"
            value={`${engagement?.stickiness ?? 0}%`}
            sublabel="DAU/WAU ratio"
            accent={engagement && engagement.stickiness >= 40 ? 'text-green-600' : engagement && engagement.stickiness >= 20 ? 'text-amber-600' : 'text-red-500'}
          />
          <MetricTile
            label="Avg Session"
            value={engagement ? `${engagement.avgSessionMin}m` : '—'}
            sublabel={`${engagement?.totalSessions ?? 0} sessions`}
            accent="text-gray-700"
          />
        </div>

        {/* Daily active users chart (simple bar chart) */}
        {engagement && engagement.dailyChart.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 mb-3">Daily Active Users (14 days)</p>
            <div className="flex items-end gap-1 h-24">
              {engagement.dailyChart.map((day, i) => {
                const maxUsers = Math.max(...engagement.dailyChart.map(d => d.users), 1)
                const height = (day.users / maxUsers) * 100
                const isToday = i === engagement.dailyChart.length - 1
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] text-gray-400 tabular-nums">{day.users || ''}</span>
                    <div
                      className={clsx(
                        'w-full rounded-t transition-all',
                        isToday ? 'bg-indigo-500' : day.users > 0 ? 'bg-indigo-200' : 'bg-gray-100'
                      )}
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    <span className="text-[8px] text-gray-300">
                      {new Date(day.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Workflow Completion Funnel ──────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Workflow Funnel</h2>
        <p className="text-xs text-gray-400 mb-4">How many users reach each stage of the core workflow (all time)</p>

        {funnel && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="space-y-2">
              {funnel.map((step, i) => {
                const pct = funnel[0].count > 0 ? Math.round((step.count / funnel[0].count) * 100) : 0
                const dropoff = i > 0 && funnel[i - 1].count > 0
                  ? Math.round(((funnel[i - 1].count - step.count) / funnel[i - 1].count) * 100)
                  : 0
                const Icon = step.icon
                return (
                  <div key={step.label}>
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-3.5 h-3.5 text-indigo-500" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-700">{step.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-900 tabular-nums">{step.count}</span>
                            <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right">{pct}%</span>
                            {i > 0 && dropoff > 0 && (
                              <span className="text-[10px] text-red-400 tabular-nums">-{dropoff}%</span>
                            )}
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    {i < funnel.length - 1 && (
                      <div className="ml-3 h-3 border-l border-gray-200" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Time-to-Value ──────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Time-to-Value</h2>
        <p className="text-xs text-gray-400 mb-4">How quickly new users take their first meaningful action after first login</p>

        <div className="grid grid-cols-4 gap-3">
          <MetricTile
            label="Activation Rate"
            value={ttv ? `${ttv.activationRate}%` : '—'}
            sublabel={ttv ? `${ttv.usersWithAction} of ${ttv.usersWithSession} users` : 'No data'}
            accent={ttv && ttv.activationRate >= 50 ? 'text-green-600' : 'text-amber-600'}
          />
          <MetricTile
            label="Median TTV"
            value={ttv ? formatDuration(ttv.median) : '—'}
            sublabel="50th percentile"
            accent="text-indigo-600"
          />
          <MetricTile
            label="P90 TTV"
            value={ttv ? formatDuration(ttv.p90) : '—'}
            sublabel="90th percentile"
            accent="text-gray-700"
          />
          <MetricTile
            label="Avg TTV"
            value={ttv ? formatDuration(ttv.avg) : '—'}
            sublabel="Mean time"
            accent="text-gray-700"
          />
        </div>

        {ttv && (
          <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
            <p>
              <strong>Activation Rate:</strong> {ttv.activationRate}% of users who logged in went on to take at least one action (research, note, rating, idea, or thought).
              {ttv.activationRate >= 70 && ' This is excellent.'}
              {ttv.activationRate >= 40 && ttv.activationRate < 70 && ' Room for improvement — check onboarding flow.'}
              {ttv.activationRate < 40 && ' Needs attention — users are logging in but not engaging.'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────

function MetricTile({ label, value, sublabel, accent }: {
  label: string; value: string | number; sublabel: string; accent: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-[11px] text-gray-500 font-medium">{label}</p>
      <p className={clsx('text-2xl font-bold mt-0.5', accent)}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{sublabel}</p>
    </div>
  )
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}
