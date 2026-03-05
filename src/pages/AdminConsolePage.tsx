/**
 * AdminConsolePage — Platform admin support console.
 *
 * Lists all organizations, shows org details (members, invites, temp access),
 * and provides grant/revoke temporary access actions.
 * Gated to platform admins via is_platform_admin() RPC.
 */

import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { csvSanitizeCell } from '../lib/csv-sanitize'
import {
  Building2,
  Users,
  Search,
  ChevronRight,
  ArrowLeft,
  Shield,
  Clock,
  UserPlus,
  UserMinus,
  AlertTriangle,
  Download,
  Archive,
  Trash2,
  FileText,
  XCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useToast } from '../components/common/Toast'
import { format } from 'date-fns'
import { logOrgActivity } from '../lib/org-activity-log'

interface OrgSummary {
  id: string
  name: string
  slug: string
  created_at: string
  member_count: number
  active_count: number
  inactive_count: number
}

interface OrgMemberRow {
  id: string
  user_id: string
  status: string
  is_org_admin: boolean
  role: string
  expires_at: string | null
  suspended_at: string | null
  suspended_by: string | null
  suspension_reason: string | null
  user_email: string
  user_full_name: string
}

interface PendingInvite {
  id: string
  email: string
  status: string
  created_at: string
}

interface ExportJob {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  scope: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  result_bytes: number | null
  result_expires_at: string | null
  storage_path: string | null
  attempt_count: number
  max_attempts: number
  error_message: string | null
}

const ADMIN_STATUS_PILL: Record<ExportJob['status'], string> = {
  queued: 'bg-blue-100 text-blue-700',
  running: 'bg-indigo-100 text-indigo-700',
  succeeded: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function AdminConsolePage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)

  // Grant temp access form
  const [grantUserId, setGrantUserId] = useState('')
  const [grantDuration, setGrantDuration] = useState('60')

  // ─── All Organizations ──────────────────────────────────────
  const { data: orgs = [], isLoading: orgsLoading } = useQuery({
    queryKey: ['admin-console-orgs'],
    queryFn: async () => {
      // Platform admin can query organizations + count members
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, created_at')
        .order('name')
      if (error) throw error

      // Get member counts per org
      const { data: counts, error: countErr } = await supabase
        .from('organization_memberships')
        .select('organization_id, status')
      if (countErr) throw countErr

      const countMap = new Map<string, { total: number; active: number; inactive: number }>()
      for (const row of counts || []) {
        const entry = countMap.get(row.organization_id) || { total: 0, active: 0, inactive: 0 }
        entry.total++
        if (row.status === 'active') entry.active++
        else if (row.status === 'inactive') entry.inactive++
        countMap.set(row.organization_id, entry)
      }

      return (data || []).map((org): OrgSummary => {
        const c = countMap.get(org.id) || { total: 0, active: 0, inactive: 0 }
        return {
          ...org,
          member_count: c.total,
          active_count: c.active,
          inactive_count: c.inactive,
        }
      })
    },
  })

  const filteredOrgs = useMemo(() => {
    if (!searchTerm.trim()) return orgs
    const term = searchTerm.toLowerCase()
    return orgs.filter(
      (o) => o.name.toLowerCase().includes(term) || o.slug.toLowerCase().includes(term)
    )
  }, [orgs, searchTerm])

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId) || null

  // ─── Org Detail: Members ────────────────────────────────────
  const { data: orgMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: ['admin-console-org-members', selectedOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_members_v')
        .select('id, user_id, status, is_org_admin, suspended_at, suspended_by, suspension_reason, user_email, user_full_name')
        .eq('organization_id', selectedOrgId!)
        .order('user_full_name')
      if (error) throw error

      // Also get role + expires_at from memberships table
      const { data: memberships, error: mErr } = await supabase
        .from('organization_memberships')
        .select('id, role, expires_at')
        .eq('organization_id', selectedOrgId!)
      if (mErr) throw mErr

      const roleMap = new Map<string, { role: string; expires_at: string | null }>()
      for (const m of memberships || []) {
        roleMap.set(m.id, { role: m.role, expires_at: m.expires_at })
      }

      return (data || []).map((row: any): OrgMemberRow => {
        const extra = roleMap.get(row.id) || { role: 'member', expires_at: null }
        return { ...row, role: extra.role, expires_at: extra.expires_at }
      })
    },
    enabled: !!selectedOrgId,
  })

  // ─── Org Detail: Pending Invites ────────────────────────────
  const { data: orgInvites = [] } = useQuery({
    queryKey: ['admin-console-org-invites', selectedOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_invites')
        .select('id, email, status, created_at')
        .eq('organization_id', selectedOrgId!)
        .in('status', ['pending', 'sent'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as PendingInvite[]
    },
    enabled: !!selectedOrgId,
  })

  // ─── Derived stats ─────────────────────────────────────────
  const activeMembers = orgMembers.filter((m) => m.status === 'active')
  const inactiveMembers = orgMembers.filter((m) => m.status === 'inactive')
  const tempAccessMembers = orgMembers.filter((m) => m.expires_at)

  // ─── Grant temporary access ─────────────────────────────────
  const grantTempMutation = useMutation({
    mutationFn: async ({ orgId, userId, duration }: { orgId: string; userId: string; duration: number }) => {
      const { data, error } = await supabase.rpc('grant_temporary_org_membership', {
        p_org_id: orgId,
        p_user_id: userId,
        p_duration_minutes: duration,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-console-org-members', selectedOrgId] })
      toast.success('Temporary access granted')

      logOrgActivity({
        organizationId: variables.orgId,
        action: 'member.temporary_access_granted',
        targetType: 'user',
        targetId: variables.userId,
        entityType: 'organization_membership',
        actionType: 'temporary_access_granted',
        targetUserId: variables.userId,
        details: { duration_minutes: variables.duration },
      })

      setGrantUserId('')
      setGrantDuration('60')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to grant temporary access')
    },
  })

  // ─── Revoke temporary access ────────────────────────────────
  const revokeTempMutation = useMutation({
    mutationFn: async ({ orgId, userId }: { orgId: string; userId: string }) => {
      const { data, error } = await supabase.rpc('revoke_temporary_org_membership', {
        p_org_id: orgId,
        p_user_id: userId,
        p_reason: 'Revoked via admin console',
      })
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-console-org-members', selectedOrgId] })
      toast.success('Temporary access revoked')

      logOrgActivity({
        organizationId: variables.orgId,
        action: 'member.temporary_access_revoked',
        targetType: 'user',
        targetId: variables.userId,
        entityType: 'organization_membership',
        actionType: 'temporary_access_revoked',
        targetUserId: variables.userId,
        details: { reason: 'Revoked via admin console' },
      })
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to revoke temporary access')
    },
  })

  // ─── Governance data ────────────────────────────────────────
  const { data: governance } = useQuery({
    queryKey: ['admin-console-governance', selectedOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_governance')
        .select('*')
        .eq('organization_id', selectedOrgId!)
        .maybeSingle()
      if (error) throw error
      return data as {
        retention_days_audit_log: number
        legal_hold: boolean
        archived_at: string | null
        archived_by: string | null
        deletion_scheduled_at: string | null
      } | null
    },
    enabled: !!selectedOrgId,
  })

  // ─── Export jobs for selected org ──────────────────────────
  const { data: exportJobs = [] } = useQuery({
    queryKey: ['admin-console-export-jobs', selectedOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_export_jobs')
        .select('id, status, scope, created_at, started_at, finished_at, result_bytes, result_expires_at, storage_path, attempt_count, max_attempts, error_message')
        .eq('organization_id', selectedOrgId!)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data || []) as ExportJob[]
    },
    enabled: !!selectedOrgId,
    refetchInterval: (query) => {
      const jobs = query.state.data as ExportJob[] | undefined
      return jobs?.some((j) => j.status === 'queued' || j.status === 'running') ? 5000 : false
    },
  })

  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null)

  const handleDownloadExport = async (job: ExportJob) => {
    if (!job.storage_path) return
    setDownloadingJobId(job.id)
    try {
      const { data: urlData, error } = await supabase.rpc('get_export_download_url', { p_job_id: job.id })
      if (error) throw error
      const path = (urlData as any)?.storage_path || job.storage_path
      const { data: signedData, error: signErr } = await supabase.storage
        .from('org-exports')
        .createSignedUrl(path, 600)
      if (signErr) throw signErr
      if (signedData?.signedUrl) {
        window.open(signedData.signedUrl, '_blank')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate download link')
    } finally {
      setDownloadingJobId(null)
    }
  }

  const cancelExportJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc('cancel_export_job', { p_job_id: jobId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-console-export-jobs', selectedOrgId] })
      toast.success('Export cancelled')
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to cancel export'),
  })

  // ─── Governance mutations ─────────────────────────────────
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletionDays, setDeletionDays] = useState('30')

  const toggleLegalHoldMutation = useMutation({
    mutationFn: async ({ orgId, hold }: { orgId: string; hold: boolean }) => {
      const { data, error } = await supabase.rpc('set_org_governance', {
        p_org_id: orgId,
        p_legal_hold: hold,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-console-governance', selectedOrgId] })
      toast.success(`Legal hold ${governance?.legal_hold ? 'removed' : 'enabled'}`)
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to toggle legal hold'),
  })

  const archiveOrgMutation = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await supabase.rpc('archive_org', { p_org_id: orgId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-console-governance', selectedOrgId] })
      toast.success('Organization archived')
      setShowArchiveConfirm(false)
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to archive'),
  })

  const scheduleDeletionMutation = useMutation({
    mutationFn: async ({ orgId, days }: { orgId: string; days: number }) => {
      const at = new Date(Date.now() + days * 86400000).toISOString()
      const { error } = await supabase.rpc('schedule_org_deletion', { p_org_id: orgId, p_at: at })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-console-governance', selectedOrgId] })
      toast.success('Deletion scheduled')
      setShowDeleteConfirm(false)
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to schedule deletion'),
  })

  const cancelDeletionMutation = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await supabase.rpc('cancel_org_deletion', { p_org_id: orgId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-console-governance', selectedOrgId] })
      toast.success('Deletion cancelled')
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to cancel deletion'),
  })

  const requestExportMutation = useMutation({
    mutationFn: async (orgId: string) => {
      const { data, error } = await supabase.rpc('request_org_export', {
        p_org_id: orgId,
        p_scope: 'metadata_only',
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-console-export-jobs', selectedOrgId] })
      toast.success('Export requested')
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to request export'),
  })

  // ─── CSV export ─────────────────────────────────────────────
  const handleExportMembers = useCallback(() => {
    if (!orgMembers.length || !selectedOrg) return
    const csv = [
      ['Name', 'Email', 'Status', 'Role', 'Admin', 'Temp Expires'].join(','),
      ...orgMembers.map((m) =>
        [
          m.user_full_name,
          m.user_email,
          m.status,
          m.role,
          m.is_org_admin ? 'Yes' : 'No',
          m.expires_at || '',
        ]
          .map(csvSanitizeCell)
          .join(',')
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedOrg.slug}-members-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [orgMembers, selectedOrg])

  // ─── Org List View ──────────────────────────────────────────
  if (!selectedOrgId) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center">
              <Shield className="w-5 h-5 mr-2 text-indigo-600" />
              Admin Console
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Platform support — view organizations and manage temporary access
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search organizations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
          />
        </div>

        {/* Org List */}
        {orgsLoading ? (
          <div className="text-center py-12">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Loading organizations...</p>
          </div>
        ) : filteredOrgs.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No organizations found</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {filteredOrgs.map((org) => (
              <button
                key={org.id}
                onClick={() => setSelectedOrgId(org.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4.5 h-4.5 text-indigo-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{org.name}</p>
                    <p className="text-xs text-gray-500">{org.slug}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4 flex-shrink-0">
                  <div className="text-right">
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-600">
                        <Users className="w-3 h-3 inline mr-0.5" />
                        {org.member_count}
                      </span>
                      <span className="text-green-600">{org.active_count} active</span>
                      {org.inactive_count > 0 && (
                        <span className="text-amber-600">{org.inactive_count} suspended</span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Created {new Date(org.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── Org Detail View ────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Back + Header */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => setSelectedOrgId(null)}
          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center">
            <Building2 className="w-5 h-5 mr-2 text-indigo-600" />
            {selectedOrg?.name}
          </h1>
          <p className="text-xs text-gray-500">{selectedOrg?.slug}</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-xs text-gray-500">Total Members</p>
          <p className="text-lg font-bold text-gray-900">{orgMembers.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">Active</p>
          <p className="text-lg font-bold text-green-600">{activeMembers.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">Suspended</p>
          <p className="text-lg font-bold text-amber-600">{inactiveMembers.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">Pending Invites</p>
          <p className="text-lg font-bold text-blue-600">{orgInvites.length}</p>
        </Card>
      </div>

      {/* Governance */}
      <Card className="p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-700 flex items-center">
          <FileText className="w-4 h-4 mr-1.5 text-indigo-500" />
          Governance
        </h3>

        {/* Status badges */}
        <div className="flex flex-wrap gap-2">
          {governance?.legal_hold && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              <Shield className="w-3 h-3" /> Legal Hold
            </span>
          )}
          {governance?.archived_at && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
              <Archive className="w-3 h-3" /> Archived
            </span>
          )}
          {governance?.deletion_scheduled_at && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              <Trash2 className="w-3 h-3" /> Deletion: {new Date(governance.deletion_scheduled_at).toLocaleDateString()}
            </span>
          )}
          {!governance?.legal_hold && !governance?.archived_at && !governance?.deletion_scheduled_at && (
            <span className="text-xs text-gray-400">No governance flags active</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => toggleLegalHoldMutation.mutate({ orgId: selectedOrgId!, hold: !governance?.legal_hold })}
            disabled={toggleLegalHoldMutation.isPending}
            className={governance?.legal_hold ? 'text-green-600 border-green-200 hover:bg-green-50' : 'text-red-600 border-red-200 hover:bg-red-50'}
          >
            <Shield className="w-3.5 h-3.5 mr-1" />
            {governance?.legal_hold ? 'Remove Legal Hold' : 'Enable Legal Hold'}
          </Button>

          {!governance?.archived_at ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowArchiveConfirm(true)}
              className="text-amber-600 border-amber-200 hover:bg-amber-50"
            >
              <Archive className="w-3.5 h-3.5 mr-1" /> Archive
            </Button>
          ) : null}

          {governance?.deletion_scheduled_at ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancelDeletionMutation.mutate(selectedOrgId!)}
              disabled={cancelDeletionMutation.isPending}
              className="text-green-600 border-green-200 hover:bg-green-50"
            >
              <XCircle className="w-3.5 h-3.5 mr-1" /> Cancel Deletion
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Schedule Deletion
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => requestExportMutation.mutate(selectedOrgId!)}
            disabled={requestExportMutation.isPending}
          >
            <Download className="w-3.5 h-3.5 mr-1" /> Export
          </Button>
        </div>
      </Card>

      {/* Export Jobs */}
      {exportJobs.length > 0 && (
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-700 flex items-center">
            <Download className="w-4 h-4 mr-1.5 text-indigo-500" />
            Export Jobs ({exportJobs.length})
          </h3>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Requested</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {exportJobs.map((job) => {
                  const expired = job.result_expires_at && new Date(job.result_expires_at) < new Date()
                  return (
                    <tr key={job.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${ADMIN_STATUS_PILL[job.status]}`}>
                          {job.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {job.status}
                        </span>
                        {job.status === 'failed' && job.error_message && (
                          <span className="ml-1 text-red-500 cursor-help" title={job.error_message}>
                            <AlertTriangle className="w-3 h-3 inline" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {format(new Date(job.created_at), 'MMM d, h:mm a')}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {job.finished_at ? format(new Date(job.finished_at), 'MMM d, h:mm a') : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {job.result_bytes != null ? formatBytes(job.result_bytes) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {job.attempt_count}/{job.max_attempts}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {job.status === 'succeeded' && job.storage_path && !expired && (
                            <button
                              onClick={() => handleDownloadExport(job)}
                              disabled={downloadingJobId === job.id}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded hover:bg-indigo-50 transition-colors disabled:opacity-50"
                            >
                              <Download className="w-3 h-3" />
                              {downloadingJobId === job.id ? '...' : 'Download'}
                            </button>
                          )}
                          {job.status === 'succeeded' && expired && (
                            <span className="text-[10px] text-gray-400">Expired</span>
                          )}
                          {(job.status === 'queued' || job.status === 'failed') && (
                            <button
                              onClick={() => cancelExportJobMutation.mutate(job.id)}
                              disabled={cancelExportJobMutation.isPending}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-500 hover:text-red-600 border border-gray-200 rounded hover:bg-red-50 transition-colors"
                            >
                              <XCircle className="w-3 h-3" /> Cancel
                            </button>
                          )}
                          {job.status === 'failed' && (
                            <button
                              onClick={() => requestExportMutation.mutate(selectedOrgId!)}
                              disabled={requestExportMutation.isPending}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-500 hover:text-indigo-600 border border-gray-200 rounded hover:bg-indigo-50 transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" /> Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Deletion Schedule Detail */}
      {governance?.deletion_scheduled_at && (
        <Card className="p-4 border-red-200 bg-red-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <Trash2 className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-red-900">Deletion Scheduled</div>
                <p className="text-xs text-red-700 mt-0.5">
                  This organization is scheduled for deletion on{' '}
                  <strong>{format(new Date(governance.deletion_scheduled_at), 'MMM d, yyyy \'at\' h:mm a')}</strong>.
                  {governance.legal_hold && ' Deletion is currently blocked by legal hold.'}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancelDeletionMutation.mutate(selectedOrgId!)}
              disabled={cancelDeletionMutation.isPending}
              className="text-green-600 border-green-200 hover:bg-green-50 flex-shrink-0"
            >
              <XCircle className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Archive Confirmation */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowArchiveConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 mx-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Archive className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Archive Organization?</h3>
                <p className="text-sm text-gray-500">This will mark the org as archived. It can be restored later.</p>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="outline" size="sm" onClick={() => setShowArchiveConfirm(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700"
                disabled={archiveOrgMutation.isPending}
                onClick={() => archiveOrgMutation.mutate(selectedOrgId!)}
              >
                {archiveOrgMutation.isPending ? 'Archiving...' : 'Archive'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 mx-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Schedule Deletion?</h3>
                <p className="text-sm text-gray-500">Choose how many days from now to delete this organization.</p>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-1">Days from now</label>
              <input
                type="number"
                value={deletionDays}
                onChange={(e) => setDeletionDays(e.target.value)}
                min={1}
                max={365}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700"
                disabled={scheduleDeletionMutation.isPending}
                onClick={() => {
                  const d = parseInt(deletionDays, 10)
                  if (!d || d < 1) return toast.error('Enter a valid number of days')
                  scheduleDeletionMutation.mutate({ orgId: selectedOrgId!, days: d })
                }}
              >
                {scheduleDeletionMutation.isPending ? 'Scheduling...' : 'Schedule'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Grant Temporary Access */}
      <Card className="p-4">
        <h3 className="text-sm font-medium text-gray-700 flex items-center mb-3">
          <UserPlus className="w-4 h-4 mr-1.5 text-indigo-500" />
          Grant Temporary Access
        </h3>
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-xs">
            <label className="block text-xs text-gray-500 mb-1">User ID</label>
            <input
              type="text"
              value={grantUserId}
              onChange={(e) => setGrantUserId(e.target.value)}
              placeholder="UUID of user"
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="w-32">
            <label className="block text-xs text-gray-500 mb-1">Duration (min)</label>
            <input
              type="number"
              value={grantDuration}
              onChange={(e) => setGrantDuration(e.target.value)}
              min={1}
              max={1440}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!grantUserId.trim()) return toast.error('Enter a user ID')
              const dur = parseInt(grantDuration, 10)
              if (!dur || dur < 1 || dur > 1440) return toast.error('Duration: 1–1440 minutes')
              grantTempMutation.mutate({ orgId: selectedOrgId!, userId: grantUserId.trim(), duration: dur })
            }}
            disabled={grantTempMutation.isPending}
          >
            <UserPlus className="w-3.5 h-3.5 mr-1" />
            {grantTempMutation.isPending ? 'Granting...' : 'Grant'}
          </Button>
        </div>
      </Card>

      {/* Temporary Access Grants */}
      {tempAccessMembers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700 flex items-center">
            <Clock className="w-4 h-4 mr-1.5 text-purple-500" />
            Temporary Access ({tempAccessMembers.length})
          </h3>
          <div className="bg-purple-50 border border-purple-200 rounded-lg divide-y divide-purple-100">
            {tempAccessMembers.map((m) => (
              <div key={m.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{m.user_full_name}</p>
                  <p className="text-xs text-gray-500">{m.user_email}</p>
                  <p className="text-xs text-purple-600 mt-0.5">
                    Expires {m.expires_at ? format(new Date(m.expires_at), 'MMM d, yyyy h:mm a') : '—'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => revokeTempMutation.mutate({ orgId: selectedOrgId!, userId: m.user_id })}
                  disabled={revokeTempMutation.isPending}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  <UserMinus className="w-3.5 h-3.5 mr-1" />
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700 flex items-center">
            <Users className="w-4 h-4 mr-1.5 text-green-500" />
            Members ({orgMembers.length})
          </h3>
          <Button size="sm" variant="outline" onClick={handleExportMembers} disabled={!orgMembers.length}>
            <Download className="w-3.5 h-3.5 mr-1" />
            CSV
          </Button>
        </div>

        {membersLoading ? (
          <div className="text-center py-8">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {orgMembers.map((m) => (
              <div key={m.id} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      m.status === 'inactive' ? 'bg-gray-400' : m.is_org_admin ? 'bg-indigo-600' : 'bg-primary-600'
                    }`}
                  >
                    <span className="text-white text-xs font-semibold">
                      {m.user_full_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase() || '?'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{m.user_full_name}</span>
                      {m.is_org_admin && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 rounded">Admin</span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 text-[10px] rounded ${
                          m.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {m.status}
                      </span>
                      {m.role !== 'member' && m.role !== 'admin' && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">{m.role}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{m.user_email}</p>
                  </div>
                </div>
                {m.status === 'inactive' && m.suspension_reason && (
                  <span className="text-xs text-amber-600 flex items-center flex-shrink-0 ml-2">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {m.suspension_reason}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Invites */}
      {orgInvites.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700 flex items-center">
            <Clock className="w-4 h-4 mr-1.5 text-blue-500" />
            Pending Invites ({orgInvites.length})
          </h3>
          <div className="bg-blue-50 border border-blue-200 rounded-lg divide-y divide-blue-100">
            {orgInvites.map((inv) => (
              <div key={inv.id} className="px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{inv.email}</p>
                  <p className="text-xs text-gray-500">
                    Sent {new Date(inv.created_at).toLocaleDateString()} · {inv.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
