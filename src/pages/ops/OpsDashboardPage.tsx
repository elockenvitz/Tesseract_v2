/**
 * OpsDashboardPage — At-a-glance health across all clients.
 *
 * Shows:
 *  - Active users right now
 *  - Per-client health cards: active users, last login, holdings freshness, onboarding progress
 *  - Recent activity feed
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Users, Activity, Clock, CheckCircle2, AlertTriangle,
  Database, TrendingUp, FileText, Target, MessageCircleQuestion,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'

// ─── Types ────────────────────────────────────────────────────

interface ClientHealth {
  org: { id: string; name: string; slug: string; created_at: string }
  activeUsersNow: number
  totalMembers: number
  lastLoginAt: string | null
  holdingsLastDate: string | null
  holdingsHealth: 'good' | 'stale' | 'none'
  onboardingPct: number
  engagementScore: number // 0-100 based on recent activity
  openBugReports: number
}

// ─── Component ────────────────────────────────────────────────

export function OpsDashboardPage() {
  const navigate = useNavigate()

  // All orgs
  const { data: orgs = [] } = useQuery({
    queryKey: ['ops-dash-orgs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('id, name, slug, created_at').order('name')
      if (error) throw error
      return data || []
    },
  })

  // Active sessions (right now)
  const { data: activeSessions = [] } = useQuery({
    queryKey: ['ops-dash-active-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_sessions')
        .select('user_id, organization_id, started_at, last_heartbeat_at')
        .eq('is_active', true)
      if (error) throw error
      return data || []
    },
    refetchInterval: 30_000,
  })

  // Members per org
  const { data: memberships = [] } = useQuery({
    queryKey: ['ops-dash-memberships'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_memberships')
        .select('organization_id, user_id, status')
        .eq('status', 'active')
      if (error) throw error
      return data || []
    },
  })

  // Recent logins (last 7 days of sessions)
  const { data: recentSessions = [] } = useQuery({
    queryKey: ['ops-dash-recent-sessions'],
    queryFn: async () => {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const { data, error } = await supabase
        .from('user_sessions')
        .select('user_id, organization_id, started_at, duration_seconds')
        .gte('started_at', weekAgo)
        .order('started_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data || []
    },
  })

  // Holdings snapshots
  const { data: holdingsSnapshots = [] } = useQuery({
    queryKey: ['ops-dash-holdings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings_snapshots')
        .select('organization_id, snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(500)
      if (error) throw error
      return data || []
    },
  })

  // Onboarding signals: org chart nodes, portfolios, coverage
  const { data: onboardingData } = useQuery({
    queryKey: ['ops-dash-onboarding'],
    queryFn: async () => {
      const [orgChartRes, portfoliosRes, coverageRes] = await Promise.all([
        supabase.from('org_chart_nodes').select('organization_id').not('organization_id', 'is', null),
        supabase.from('portfolios').select('organization_id').eq('is_active', true).not('organization_id', 'is', null),
        supabase.from('coverage').select('id').eq('is_active', true),
      ])
      return {
        orgChartByOrg: new Set((orgChartRes.data || []).map(r => r.organization_id)),
        portfoliosByOrg: (portfoliosRes.data || []).reduce((m: Map<string, number>, r: any) => {
          m.set(r.organization_id, (m.get(r.organization_id) || 0) + 1)
          return m
        }, new Map<string, number>()),
        hasCoverage: (coverageRes.data?.length || 0) > 0,
      }
    },
  })

  // Engagement: count of recent content creation per org (last 30 days)
  const { data: engagementData } = useQuery({
    queryKey: ['ops-dash-engagement'],
    queryFn: async () => {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()
      const [ideasRes, notesRes, ratingsRes] = await Promise.all([
        supabase.from('quick_thoughts').select('created_by').gte('created_at', monthAgo).eq('is_archived', false),
        supabase.from('asset_notes').select('created_by').gte('created_at', monthAgo),
        supabase.from('analyst_ratings').select('user_id').gte('updated_at', monthAgo),
      ])

      // Map user IDs to org IDs via memberships
      const userOrgMap = new Map<string, string>()
      for (const m of memberships) userOrgMap.set(m.user_id, m.organization_id)

      const orgActivity = new Map<string, number>()
      const countForOrg = (userId: string) => {
        const orgId = userOrgMap.get(userId)
        if (orgId) orgActivity.set(orgId, (orgActivity.get(orgId) || 0) + 1)
      }

      for (const r of ideasRes.data || []) countForOrg(r.created_by)
      for (const r of notesRes.data || []) countForOrg(r.created_by)
      for (const r of ratingsRes.data || []) countForOrg(r.user_id)

      return orgActivity
    },
    enabled: memberships.length > 0,
  })

  // Bug reports
  const { data: bugCounts } = useQuery({
    queryKey: ['ops-dash-bugs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bug_reports')
        .select('organization_id, status')
        .in('status', ['open', 'investigating'])
      if (error) throw error
      const counts = new Map<string, number>()
      for (const r of data || []) counts.set(r.organization_id, (counts.get(r.organization_id) || 0) + 1)
      return counts
    },
  })

  // ─── Build client health ────────────────────────────────────

  const clientHealth: ClientHealth[] = useMemo(() => {
    return orgs.map((org): ClientHealth => {
      const orgMembers = memberships.filter(m => m.organization_id === org.id)
      const activeNow = new Set(activeSessions.filter(s => s.organization_id === org.id).map((s: any) => s.user_id))
      const orgSessions = recentSessions.filter(s => s.organization_id === org.id)
      const lastLogin = orgSessions[0]?.started_at || null

      // Holdings
      const orgHoldings = holdingsSnapshots.filter(s => s.organization_id === org.id)
      const holdingsLastDate = orgHoldings[0]?.snapshot_date || null
      let holdingsHealth: 'good' | 'stale' | 'none' = 'none'
      if (holdingsLastDate) {
        const daysSince = Math.floor((Date.now() - new Date(holdingsLastDate).getTime()) / 86400000)
        holdingsHealth = daysSince > 3 ? 'stale' : 'good'
      }

      // Onboarding (5 checkpoints)
      let onboardingScore = 0
      if (orgMembers.length > 1) onboardingScore++ // Has invited users
      if (onboardingData?.orgChartByOrg.has(org.id)) onboardingScore++ // Has org chart
      if ((onboardingData?.portfoliosByOrg.get(org.id) || 0) > 0) onboardingScore++ // Has portfolios
      if (holdingsLastDate) onboardingScore++ // Has holdings
      if (orgSessions.length > 0) onboardingScore++ // Has logged in
      const onboardingPct = Math.round((onboardingScore / 5) * 100)

      // Engagement score (0-100, based on activity count in last 30 days)
      const activityCount = engagementData?.get(org.id) || 0
      const engagementScore = Math.min(100, Math.round(activityCount * 5)) // 20 actions = 100%

      return {
        org,
        activeUsersNow: activeNow.size,
        totalMembers: orgMembers.length,
        lastLoginAt: lastLogin,
        holdingsLastDate,
        holdingsHealth,
        onboardingPct,
        engagementScore,
        openBugReports: bugCounts?.get(org.id) || 0,
      }
    })
  }, [orgs, memberships, activeSessions, recentSessions, holdingsSnapshots, onboardingData, engagementData, bugCounts])

  // ─── Top Users by activity ──────────────────────────────────

  const { data: topUsers = [] } = useQuery({
    queryKey: ['ops-dash-top-users'],
    queryFn: async () => {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()

      const [
        thoughtsRes, notesRes, ratingsRes, tradesRes,
        contributionsRes, sessionsRes, ideasRes, usersRes,
      ] = await Promise.all([
        supabase.from('quick_thoughts').select('user_id').gte('created_at', monthAgo),
        supabase.from('asset_notes').select('created_by').gte('created_at', monthAgo),
        supabase.from('analyst_ratings').select('user_id').gte('updated_at', monthAgo),
        supabase.from('accepted_trades').select('accepted_by').gte('created_at', monthAgo),
        supabase.from('asset_contributions').select('user_id').gte('created_at', monthAgo),
        supabase.from('user_sessions').select('user_id, duration_seconds').gte('started_at', monthAgo),
        supabase.from('trade_queue_items').select('created_by').gte('created_at', monthAgo),
        supabase.from('users').select('id, email, first_name, last_name'),
      ])

      // Build per-user activity counts
      const userActivity = new Map<string, {
        thoughts: number; notes: number; ratings: number;
        trades: number; contributions: number; sessions: number;
        ideas: number; totalTime: number;
      }>()

      const inc = (userId: string | null, field: string) => {
        if (!userId) return
        if (!userActivity.has(userId)) {
          userActivity.set(userId, { thoughts: 0, notes: 0, ratings: 0, trades: 0, contributions: 0, sessions: 0, ideas: 0, totalTime: 0 })
        }
        ;(userActivity.get(userId)! as any)[field]++
      }

      for (const r of thoughtsRes.data || []) inc(r.user_id, 'thoughts')
      for (const r of notesRes.data || []) inc(r.created_by, 'notes')
      for (const r of ratingsRes.data || []) inc(r.user_id, 'ratings')
      for (const r of tradesRes.data || []) inc(r.accepted_by, 'trades')
      for (const r of contributionsRes.data || []) inc(r.user_id, 'contributions')
      for (const r of ideasRes.data || []) inc(r.created_by, 'ideas')
      for (const r of sessionsRes.data || []) {
        inc(r.user_id, 'sessions')
        if (r.user_id && userActivity.has(r.user_id)) {
          userActivity.get(r.user_id)!.totalTime += (r.duration_seconds || 0)
        }
      }

      // Build user lookup
      const userMap = new Map((usersRes.data || []).map(u => [u.id, u]))
      // Build user → org lookup
      const userOrgMap = new Map<string, string>()
      for (const m of memberships) userOrgMap.set(m.user_id, m.organization_id)
      const orgMap = new Map(orgs.map(o => [o.id, o.name]))

      // Rank by total actions
      return Array.from(userActivity.entries())
        .map(([userId, activity]) => {
          const u = userMap.get(userId)
          const totalActions = activity.thoughts + activity.notes + activity.ratings +
            activity.trades + activity.contributions + activity.ideas
          const topActivity = Object.entries(activity)
            .filter(([k]) => k !== 'totalTime' && k !== 'sessions')
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .filter(([, v]) => (v as number) > 0)
            .slice(0, 3)
            .map(([k, v]) => ({ type: k, count: v as number }))

          return {
            userId,
            email: u?.email || 'Unknown',
            name: [u?.first_name, u?.last_name].filter(Boolean).join(' ') || null,
            orgName: orgMap.get(userOrgMap.get(userId) || '') || '—',
            totalActions,
            sessions: activity.sessions,
            totalTimeMin: Math.round(activity.totalTime / 60),
            topActivity,
          }
        })
        .filter(u => u.totalActions > 0 || u.sessions > 0)
        .sort((a, b) => b.totalActions - a.totalActions)
        .slice(0, 15)
    },
    enabled: memberships.length > 0 && orgs.length > 0,
  })

  // ─── Aggregates ─────────────────────────────────────────────

  const totalActiveNow = new Set(activeSessions.map((s: any) => s.user_id)).size
  const totalMembers = memberships.length
  const totalClients = orgs.length
  const clientsWithActivity = clientHealth.filter(c => c.lastLoginAt).length

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>

      {/* Top-level metrics */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard icon={Activity} label="Active Now" value={totalActiveNow} accent="text-green-600" />
        <MetricCard icon={Building2} label="Clients" value={totalClients} accent="text-indigo-600" />
        <MetricCard icon={Users} label="Total Users" value={totalMembers} accent="text-gray-700" />
        <MetricCard icon={AlertTriangle} label="Open Bugs" value={clientHealth.reduce((s, c) => s + c.openBugReports, 0)} accent="text-red-600" />
      </div>

      {/* Client health table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Client Health</h2>
          <span className="text-xs text-gray-400">{clientsWithActivity} of {totalClients} active</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Client</th>
              <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500">Active Now</th>
              <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500">Users</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Last Login</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Holdings</th>
              <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500">Onboarding</th>
              <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500">Engagement</th>
              <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500">Bugs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {clientHealth.map((client) => (
              <tr
                key={client.org.id}
                onClick={() => navigate(`/ops/clients/${client.org.id}`)}
                className="hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <td className="px-5 py-3">
                  <p className="font-medium text-gray-900">{client.org.name}</p>
                  <p className="text-[10px] text-gray-400">{client.org.slug}</p>
                </td>
                <td className="px-5 py-3 text-center">
                  {client.activeUsersNow > 0 ? (
                    <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      {client.activeUsersNow}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-xs">0</span>
                  )}
                </td>
                <td className="px-5 py-3 text-center text-xs text-gray-600">{client.totalMembers}</td>
                <td className="px-5 py-3 text-xs text-gray-600">
                  {client.lastLoginAt ? formatTimeAgo(client.lastLoginAt) : <span className="text-gray-300">Never</span>}
                </td>
                <td className="px-5 py-3">
                  <HealthPill health={client.holdingsHealth} date={client.holdingsLastDate} />
                </td>
                <td className="px-5 py-3 text-center">
                  <ProgressBar pct={client.onboardingPct} />
                </td>
                <td className="px-5 py-3 text-center">
                  <EngagementDot score={client.engagementScore} />
                </td>
                <td className="px-5 py-3 text-center">
                  {client.openBugReports > 0 ? (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold">
                      {client.openBugReports}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-xs">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Top Users */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Top Users (Last 30 Days)</h2>
        </div>
        {topUsers.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No activity in the last 30 days</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">User</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Organization</th>
                <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500">Actions</th>
                <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500">Sessions</th>
                <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500">Time</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Most Used For</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topUsers.map((u, i) => (
                <tr key={u.userId} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={clsx(
                        'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0',
                        i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-amber-700' : 'bg-gray-300'
                      )}>
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{u.name || u.email}</p>
                        {u.name && <p className="text-[10px] text-gray-400 truncate">{u.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">{u.orgName}</td>
                  <td className="px-5 py-3 text-center text-xs font-semibold text-gray-800">{u.totalActions}</td>
                  <td className="px-5 py-3 text-center text-xs text-gray-600">{u.sessions}</td>
                  <td className="px-5 py-3 text-center text-xs text-gray-600">
                    {u.totalTimeMin > 60 ? `${Math.round(u.totalTimeMin / 60)}h` : `${u.totalTimeMin}m`}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.topActivity.map(a => (
                        <span key={a.type} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-medium">
                          {ACTIVITY_LABELS[a.type] || a.type}
                          <span className="text-indigo-400">{a.count}</span>
                        </span>
                      ))}
                      {u.topActivity.length === 0 && (
                        <span className="text-[10px] text-gray-300">Sessions only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const ACTIVITY_LABELS: Record<string, string> = {
  thoughts: 'Thoughts',
  notes: 'Notes',
  ratings: 'Ratings',
  trades: 'Trades',
  contributions: 'Research',
  ideas: 'Ideas',
}

// ─── Sub-components ───────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, accent }: { icon: typeof Activity; label: string; value: number; accent: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={clsx('w-4 h-4', accent)} />
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      <p className={clsx('text-2xl font-bold', accent)}>{value}</p>
    </div>
  )
}

function HealthPill({ health, date }: { health: 'good' | 'stale' | 'none'; date: string | null }) {
  if (health === 'none') return <span className="text-[10px] text-gray-300">No data</span>
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium',
      health === 'good' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
    )}>
      {health === 'good' ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {date}
    </span>
  )
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all', pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-500 tabular-nums w-7">{pct}%</span>
    </div>
  )
}

function EngagementDot({ score }: { score: number }) {
  const color = score >= 60 ? 'bg-green-500' : score >= 20 ? 'bg-amber-500' : 'bg-gray-300'
  return (
    <div className="flex items-center justify-center gap-1">
      <span className={clsx('w-2 h-2 rounded-full', color)} />
      <span className="text-[10px] text-gray-500 tabular-nums">{score}</span>
    </div>
  )
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}
