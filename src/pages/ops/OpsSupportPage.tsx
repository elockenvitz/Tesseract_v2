/**
 * OpsSupportPage — Bug report triage and morph session management.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bug, Eye, Clock, AlertTriangle, AlertCircle, Info, CheckCircle2, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useMorphSession } from '../../hooks/useMorphSession'
import { useToast } from '../../components/common/Toast'

type SupportTab = 'bugs' | 'morph'

const SEVERITY_ICON: Record<string, typeof Info> = { low: Info, medium: AlertCircle, high: AlertTriangle, critical: AlertTriangle }
const SEVERITY_CLS: Record<string, string> = {
  low: 'text-gray-500 bg-gray-100',
  medium: 'text-amber-600 bg-amber-100',
  high: 'text-orange-600 bg-orange-100',
  critical: 'text-red-600 bg-red-100',
}
const STATUS_CLS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  investigating: 'bg-indigo-100 text-indigo-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-500',
  wont_fix: 'bg-gray-100 text-gray-500',
}

export function OpsSupportPage() {
  const [tab, setTab] = useState<SupportTab>('bugs')
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const queryClient = useQueryClient()
  const { success, error: showError } = useToast()
  const { startMorph, isMorphing } = useMorphSession()
  const [morphSearch, setMorphSearch] = useState('')
  const [morphTargetId, setMorphTargetId] = useState<string | null>(null)
  const [morphReason, setMorphReason] = useState('')

  // All bug reports across all orgs
  const { data: bugReports = [], isLoading: bugsLoading } = useQuery({
    queryKey: ['ops-bug-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bug_reports')
        .select('*, reporter:users!bug_reports_reported_by_fkey(id, email, first_name, last_name), org:organizations!bug_reports_organization_id_fkey(id, name, slug)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data || []
    },
    staleTime: 30_000,
  })

  const filteredBugs = statusFilter === 'all' ? bugReports : bugReports.filter((b: any) => b.status === statusFilter)

  // Update bug report status
  const updateBugStatus = useMutation({
    mutationFn: async ({ id, status, resolution_notes }: { id: string; status: string; resolution_notes?: string }) => {
      const updates: any = { status, updated_at: new Date().toISOString() }
      if (status === 'resolved' || status === 'closed') {
        updates.resolved_at = new Date().toISOString()
        if (resolution_notes) updates.resolution_notes = resolution_notes
      }
      const { error } = await supabase.from('bug_reports').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-bug-reports'] })
      success('Status updated')
    },
  })

  // User search for morphing
  const { data: morphUsers = [] } = useQuery({
    queryKey: ['ops-morph-user-search', morphSearch],
    queryFn: async () => {
      if (morphSearch.length < 2) return []
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, current_organization_id')
        .or(`email.ilike.%${morphSearch}%,first_name.ilike.%${morphSearch}%,last_name.ilike.%${morphSearch}%`)
        .limit(10)
      if (error) throw error
      return data || []
    },
    enabled: morphSearch.length >= 2,
  })

  // Morph session history
  const { data: morphHistory = [] } = useQuery({
    queryKey: ['ops-morph-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('morph_sessions')
        .select('*, target:users!morph_sessions_target_user_id_fkey(email, first_name, last_name), target_org:organizations!morph_sessions_target_org_id_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data || []
    },
  })

  const handleMorph = async (userId: string) => {
    if (!morphReason.trim()) return
    try {
      await startMorph.mutateAsync({ targetUserId: userId, reason: morphReason.trim() })
      success('Morph session started')
      setMorphTargetId(null)
      setMorphReason('')
      setMorphSearch('')
    } catch (err: any) {
      showError(err.message || 'Failed to start morph')
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Support</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('bugs')}
          className={clsx('flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', tab === 'bugs' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700')}
        >
          <Bug className="w-3.5 h-3.5" />
          Bug Reports
          {bugReports.filter((b: any) => b.status === 'open').length > 0 && (
            <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-px rounded-full">{bugReports.filter((b: any) => b.status === 'open').length}</span>
          )}
        </button>
        <button
          onClick={() => setTab('morph')}
          className={clsx('flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', tab === 'morph' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700')}
        >
          <Eye className="w-3.5 h-3.5" />
          Morph Sessions
        </button>
      </div>

      {/* Bug Reports */}
      {tab === 'bugs' && (
        <div className="space-y-4">
          {/* Status filter */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {['open', 'investigating', 'resolved', 'all'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={clsx('px-3 py-1.5 text-xs font-medium rounded-md transition-colors', statusFilter === s ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {bugsLoading ? (
            <div className="text-center py-8 text-sm text-gray-400">Loading...</div>
          ) : filteredBugs.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
              <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No {statusFilter === 'all' ? '' : statusFilter} bug reports</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
              {filteredBugs.map((bug: any) => {
                const SevIcon = SEVERITY_ICON[bug.severity] || Info
                const reporter = bug.reporter
                const reporterName = reporter?.first_name ? `${reporter.first_name} ${reporter.last_name || ''}`.trim() : reporter?.email || 'Unknown'
                return (
                  <div key={bug.id} className="px-5 py-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium', SEVERITY_CLS[bug.severity])}>
                            <SevIcon className="w-3 h-3" />
                            {bug.severity}
                          </span>
                          <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', STATUS_CLS[bug.status])}>
                            {bug.status}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 mt-1">{bug.title}</p>
                        {bug.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{bug.description}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[10px] text-gray-400">{new Date(bug.created_at).toLocaleDateString()}</p>
                        <p className="text-[10px] text-gray-400">{reporterName}</p>
                        <p className="text-[10px] text-indigo-500">{bug.org?.name || ''}</p>
                      </div>
                    </div>
                    {bug.page_url && <p className="text-[10px] text-gray-400 font-mono truncate">Page: {bug.page_url}</p>}
                    {/* Status actions */}
                    <div className="flex gap-1.5">
                      {bug.status === 'open' && (
                        <button onClick={() => updateBugStatus.mutate({ id: bug.id, status: 'investigating' })} className="px-2 py-1 text-[10px] font-medium rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50">Investigate</button>
                      )}
                      {(bug.status === 'open' || bug.status === 'investigating') && (
                        <button onClick={() => updateBugStatus.mutate({ id: bug.id, status: 'resolved' })} className="px-2 py-1 text-[10px] font-medium rounded border border-green-200 text-green-600 hover:bg-green-50">Resolve</button>
                      )}
                      {bug.status !== 'closed' && (
                        <button onClick={() => updateBugStatus.mutate({ id: bug.id, status: 'closed' })} className="px-2 py-1 text-[10px] font-medium rounded border border-gray-200 text-gray-500 hover:bg-gray-50">Close</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Morph Sessions */}
      {tab === 'morph' && (
        <div className="space-y-6">
          {/* Start new morph */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Start Morph Session</h3>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search users by name or email..."
                value={morphSearch}
                onChange={(e) => setMorphSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
            {morphUsers.length > 0 && (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {morphUsers.map((u: any) => (
                  <div key={u.id} className="px-4 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.email}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                    {morphTargetId === u.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="Reason..."
                          value={morphReason}
                          onChange={(e) => setMorphReason(e.target.value)}
                          className="w-40 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-orange-500"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMorph(u.id); if (e.key === 'Escape') { setMorphTargetId(null); setMorphReason('') } }}
                        />
                        <button onClick={() => handleMorph(u.id)} disabled={!morphReason.trim() || startMorph.isPending} className="px-2 py-1 text-xs font-medium rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50">Go</button>
                        <button onClick={() => { setMorphTargetId(null); setMorphReason('') }} className="text-xs text-gray-400">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setMorphTargetId(u.id)}
                        disabled={isMorphing}
                        className="px-2 py-1 text-[10px] font-medium rounded border border-orange-200 text-orange-600 hover:bg-orange-50 disabled:opacity-40 flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" />
                        Morph
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Session history */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Session History</h3>
            {morphHistory.length === 0 ? (
              <p className="text-sm text-gray-400">No morph sessions yet.</p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
                {morphHistory.map((s: any) => {
                  const target = s.target
                  const targetName = target?.first_name ? `${target.first_name} ${target.last_name || ''}`.trim() : target?.email || 'Unknown'
                  return (
                    <div key={s.id} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-900">
                          <Eye className="w-3 h-3 inline mr-1 text-orange-500" />
                          {targetName}
                          <span className="text-gray-400 ml-1.5 text-xs">{s.target_org?.name}</span>
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{s.reason}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className={s.is_active ? 'text-orange-600 font-medium' : 'text-gray-400'}>{s.is_active ? 'Active' : 'Ended'}</p>
                        <p className="text-gray-400">{new Date(s.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
