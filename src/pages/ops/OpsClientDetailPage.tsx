/**
 * OpsClientDetailPage — Single client organization detail view.
 * Shows members, portfolios, holdings status, and activity.
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Building2, Users, Briefcase, Database, Eye, Clock, Activity, CheckCircle2, TrendingUp, FileText, Target, MessageCircleQuestion, Ban, UserCheck } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useMorphSession } from '../../hooks/useMorphSession'
import { useToast } from '../../components/common/Toast'

type Tab = 'members' | 'portfolios' | 'holdings' | 'engagement' | 'onboarding'

export function OpsClientDetailPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { success, error: showError } = useToast()
  const { startMorph, isMorphing } = useMorphSession()
  const [activeTab, setActiveTab] = useState<Tab>('members')
  const [morphTargetId, setMorphTargetId] = useState<string | null>(null)
  const [morphReason, setMorphReason] = useState('')

  // Member access mutations
  const removeMemberM = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('organization_memberships')
        .update({ status: 'removed' })
        .eq('user_id', userId)
        .eq('organization_id', orgId!)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-client-members', orgId] })
      success('Access removed')
    },
    onError: (err: any) => showError(err.message),
  })

  const restoreMemberM = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('organization_memberships')
        .update({ status: 'active' })
        .eq('user_id', userId)
        .eq('organization_id', orgId!)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-client-members', orgId] })
      success('Access restored')
    },
    onError: (err: any) => showError(err.message),
  })

  // Org details
  const { data: org } = useQuery({
    queryKey: ['ops-client-detail', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, created_at, settings')
        .eq('id', orgId!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!orgId,
  })

  // Members
  const { data: members = [] } = useQuery({
    queryKey: ['ops-client-members', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_members_v')
        .select('id, user_id, status, is_org_admin, user_email, user_full_name')
        .eq('organization_id', orgId!)
        .order('user_full_name')
      if (error) throw error
      return data || []
    },
    enabled: !!orgId,
  })

  // Portfolios
  const { data: portfolios = [] } = useQuery({
    queryKey: ['ops-client-portfolios', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, is_active, created_at')
        .eq('organization_id', orgId!)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!orgId,
  })

  // Holdings snapshots (latest per portfolio)
  const { data: holdingsStatus = [] } = useQuery({
    queryKey: ['ops-client-holdings-status', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings_snapshots')
        .select('portfolio_id, snapshot_date, source, total_positions')
        .eq('organization_id', orgId!)
        .order('snapshot_date', { ascending: false })
        .limit(100)
      if (error) throw error
      // Get latest per portfolio
      const latest = new Map<string, any>()
      for (const row of data || []) {
        if (!latest.has(row.portfolio_id)) latest.set(row.portfolio_id, row)
      }
      return Array.from(latest.values())
    },
    enabled: !!orgId,
  })

  // Engagement data
  const { data: engagement } = useQuery({
    queryKey: ['ops-client-engagement', orgId],
    queryFn: async () => {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()
      const memberIds = members.map((m: any) => m.user_id)
      if (memberIds.length === 0) return { ideas: 0, notes: 0, ratings: 0, tradeIdeas: 0, sessions: 0, avgDuration: 0 }

      const [ideasRes, notesRes, ratingsRes, tradeIdeasRes, sessionsRes] = await Promise.all([
        supabase.from('quick_thoughts').select('id', { count: 'exact', head: true }).in('created_by', memberIds).gte('created_at', monthAgo).eq('is_archived', false),
        supabase.from('asset_notes').select('id', { count: 'exact', head: true }).in('created_by', memberIds).gte('created_at', monthAgo),
        supabase.from('analyst_ratings').select('id', { count: 'exact', head: true }).in('user_id', memberIds).gte('updated_at', monthAgo),
        supabase.from('quick_thoughts').select('id', { count: 'exact', head: true }).in('created_by', memberIds).eq('idea_type', 'trade_idea').gte('created_at', monthAgo),
        supabase.from('user_sessions').select('duration_seconds').in('user_id', memberIds).gte('started_at', monthAgo).not('duration_seconds', 'is', null),
      ])

      const durations = (sessionsRes.data || []).map((s: any) => s.duration_seconds).filter(Boolean)
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0

      return {
        ideas: ideasRes.count || 0,
        notes: notesRes.count || 0,
        ratings: ratingsRes.count || 0,
        tradeIdeas: tradeIdeasRes.count || 0,
        sessions: durations.length,
        avgDuration,
      }
    },
    enabled: !!orgId && members.length > 0,
  })

  // Onboarding checklist
  const { data: onboarding } = useQuery({
    queryKey: ['ops-client-onboarding', orgId],
    queryFn: async () => {
      const [orgChartRes, portfolioRes, coverageRes, holdingsRes, sessionsRes] = await Promise.all([
        supabase.from('org_chart_nodes').select('id', { count: 'exact', head: true }).eq('organization_id', orgId!),
        supabase.from('portfolios').select('id', { count: 'exact', head: true }).eq('organization_id', orgId!).eq('is_active', true),
        supabase.from('coverage').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('portfolio_holdings_snapshots').select('id', { count: 'exact', head: true }).eq('organization_id', orgId!),
        supabase.from('user_sessions').select('id', { count: 'exact', head: true }).eq('organization_id', orgId!),
      ])

      return {
        hasMultipleMembers: members.length > 1,
        memberCount: members.length,
        hasOrgChart: (orgChartRes.count || 0) > 0,
        orgChartNodes: orgChartRes.count || 0,
        hasPortfolios: (portfolioRes.count || 0) > 0,
        portfolioCount: portfolioRes.count || 0,
        hasHoldings: (holdingsRes.count || 0) > 0,
        holdingsSnapshots: holdingsRes.count || 0,
        hasLoggedIn: (sessionsRes.count || 0) > 0,
        sessionCount: sessionsRes.count || 0,
      }
    },
    enabled: !!orgId && members.length >= 0,
  })

  const onboardingItems = onboarding ? [
    { label: 'Users invited', done: onboarding.hasMultipleMembers, detail: `${onboarding.memberCount} member${onboarding.memberCount !== 1 ? 's' : ''}` },
    { label: 'Org chart created', done: onboarding.hasOrgChart, detail: `${onboarding.orgChartNodes} node${onboarding.orgChartNodes !== 1 ? 's' : ''}` },
    { label: 'Portfolios set up', done: onboarding.hasPortfolios, detail: `${onboarding.portfolioCount} portfolio${onboarding.portfolioCount !== 1 ? 's' : ''}` },
    { label: 'Holdings uploaded', done: onboarding.hasHoldings, detail: `${onboarding.holdingsSnapshots} snapshot${onboarding.holdingsSnapshots !== 1 ? 's' : ''}` },
    { label: 'Users have logged in', done: onboarding.hasLoggedIn, detail: `${onboarding.sessionCount} session${onboarding.sessionCount !== 1 ? 's' : ''}` },
  ] : []
  const onboardingDone = onboardingItems.filter(i => i.done).length

  const TABS: { key: Tab; label: string; icon: typeof Users; count?: number }[] = [
    { key: 'members', label: 'Members', icon: Users, count: members.length },
    { key: 'portfolios', label: 'Portfolios', icon: Briefcase, count: portfolios.length },
    { key: 'holdings', label: 'Holdings', icon: Database, count: holdingsStatus.length },
    { key: 'engagement', label: 'Engagement', icon: TrendingUp },
    { key: 'onboarding', label: 'Onboarding', icon: CheckCircle2, count: onboardingItems.length > 0 ? onboardingDone : undefined },
  ]

  const handleMorph = async (userId: string) => {
    if (!morphReason.trim()) return
    try {
      await startMorph.mutateAsync({ targetUserId: userId, reason: morphReason.trim() })
      success('Morph session started')
      setMorphTargetId(null)
      setMorphReason('')
    } catch (err: any) {
      showError(err.message || 'Failed to start morph')
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/ops/clients')} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            {org?.name || 'Loading...'}
          </h1>
          <p className="text-xs text-gray-400">{org?.slug} &middot; Created {org?.created_at ? new Date(org.created_at).toLocaleDateString() : ''}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              <span className="text-[10px] font-semibold bg-gray-100 text-gray-500 px-1.5 py-px rounded-full">{tab.count}</span>
            </button>
          )
        })}
      </div>

      {/* Members */}
      {activeTab === 'members' && (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {members.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No members</div>
          ) : members.map((m: any) => (
            <div key={m.id} className="px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0', m.is_org_admin ? 'bg-indigo-600' : 'bg-gray-500')}>
                  {(m.user_full_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{m.user_full_name}</span>
                    {m.is_org_admin && <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 rounded">Admin</span>}
                    <span className={clsx('px-1.5 py-0.5 text-[10px] rounded', m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>{m.status}</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{m.user_email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {m.status === 'active' ? (
                  <>
                    {morphTargetId === m.user_id ? (
                      <>
                        <input
                          type="text"
                          placeholder="Reason..."
                          value={morphReason}
                          onChange={(e) => setMorphReason(e.target.value)}
                          className="w-36 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-orange-500"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMorph(m.user_id); if (e.key === 'Escape') { setMorphTargetId(null); setMorphReason('') } }}
                        />
                        <button onClick={() => handleMorph(m.user_id)} disabled={!morphReason.trim() || startMorph.isPending} className="px-2 py-1 text-xs font-medium rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50">Go</button>
                        <button onClick={() => { setMorphTargetId(null); setMorphReason('') }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setMorphTargetId(m.user_id)}
                          disabled={isMorphing}
                          className="px-2 py-1 text-[10px] font-medium rounded border border-orange-200 text-orange-600 hover:bg-orange-50 disabled:opacity-40 transition-colors flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          Morph
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${m.user_email} from ${org?.name}?`)) {
                              removeMemberM.mutate(m.user_id)
                            }
                          }}
                          disabled={removeMemberM.isPending}
                          className="px-2 py-1 text-[10px] font-medium rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors flex items-center gap-1"
                        >
                          <Ban className="w-3 h-3" />
                          Remove
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => restoreMemberM.mutate(m.user_id)}
                    disabled={restoreMemberM.isPending}
                    className="px-2 py-1 text-[10px] font-medium rounded border border-green-200 text-green-600 hover:bg-green-50 transition-colors flex items-center gap-1"
                  >
                    <UserCheck className="w-3 h-3" />
                    Restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Portfolios */}
      {activeTab === 'portfolios' && (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {portfolios.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No portfolios</div>
          ) : portfolios.map((p: any) => {
            const hs = holdingsStatus.find((h: any) => h.portfolio_id === p.id)
            return (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.is_active ? 'Active' : 'Inactive'}</p>
                </div>
                <div className="text-xs text-right">
                  {hs ? (
                    <>
                      <p className="text-gray-600">{hs.total_positions} positions</p>
                      <p className="text-gray-400">Last: {hs.snapshot_date} ({hs.source})</p>
                    </>
                  ) : (
                    <p className="text-gray-400">No holdings uploaded</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Holdings */}
      {activeTab === 'holdings' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          {holdingsStatus.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">No holdings data uploaded for this client yet.</div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700">Latest Holdings Snapshots</h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Portfolio</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Source</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Positions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {holdingsStatus.map((hs: any) => {
                      const portfolio = portfolios.find((p: any) => p.id === hs.portfolio_id)
                      return (
                        <tr key={hs.portfolio_id}>
                          <td className="px-3 py-2 text-gray-900 font-medium">{portfolio?.name || 'Unknown'}</td>
                          <td className="px-3 py-2 text-gray-600">{hs.snapshot_date}</td>
                          <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">{hs.source}</span></td>
                          <td className="px-3 py-2 text-right text-gray-600">{hs.total_positions}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Engagement */}
      {activeTab === 'engagement' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <EngagementCard icon={MessageCircleQuestion} label="Ideas & Thoughts" value={engagement?.ideas || 0} period="Last 30 days" />
            <EngagementCard icon={Target} label="Trade Ideas" value={engagement?.tradeIdeas || 0} period="Last 30 days" />
            <EngagementCard icon={FileText} label="Notes" value={engagement?.notes || 0} period="Last 30 days" />
            <EngagementCard icon={TrendingUp} label="Ratings Updated" value={engagement?.ratings || 0} period="Last 30 days" />
            <EngagementCard icon={Activity} label="Sessions" value={engagement?.sessions || 0} period="Last 30 days" />
            <EngagementCard icon={Clock} label="Avg Session" value={engagement?.avgDuration ? `${Math.round(engagement.avgDuration / 60)}m` : '—'} period="Duration" />
          </div>
        </div>
      )}

      {/* Onboarding */}
      {activeTab === 'onboarding' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Onboarding Progress</h3>
            <span className="text-xs text-gray-400">{onboardingDone} of {onboardingItems.length} complete</span>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all', onboardingDone === onboardingItems.length ? 'bg-green-500' : 'bg-indigo-500')}
              style={{ width: `${onboardingItems.length > 0 ? (onboardingDone / onboardingItems.length) * 100 : 0}%` }}
            />
          </div>
          <div className="space-y-2">
            {onboardingItems.map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className={clsx('w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0', item.done ? 'bg-green-100' : 'bg-gray-100')}>
                  {item.done ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <span className="w-2 h-2 rounded-full bg-gray-300" />}
                </div>
                <div className="flex-1">
                  <p className={clsx('text-sm font-medium', item.done ? 'text-gray-900' : 'text-gray-500')}>{item.label}</p>
                  <p className="text-xs text-gray-400">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EngagementCard({ icon: Icon, label, value, period }: { icon: typeof Activity; label: string; value: number | string; period: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-indigo-500" />
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{period}</p>
    </div>
  )
}
