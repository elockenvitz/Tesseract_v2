/**
 * OrgGovernanceSection — Data governance settings for org admins.
 *
 * Shows audit log retention (editable by org admin), legal hold status (read-only,
 * toggled by platform admin), export request button, and export jobs table.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Shield, Download, AlertTriangle, XCircle, RefreshCw, Loader2 } from 'lucide-react'
import { logOrgActivity } from '../../lib/org-activity-log'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../common/Toast'
import { format } from 'date-fns'

interface OrgGovernanceSectionProps {
  organizationId: string
}

interface GovernanceData {
  retention_days_audit_log: number
  legal_hold: boolean
  archived_at: string | null
  deletion_scheduled_at: string | null
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

const STATUS_PILL: Record<ExportJob['status'], string> = {
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

export function OrgGovernanceSection({ organizationId }: OrgGovernanceSectionProps) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [retentionDays, setRetentionDays] = useState(365)
  const [hasRetentionChange, setHasRetentionChange] = useState(false)

  const { data: governance, isLoading } = useQuery({
    queryKey: ['org-governance', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_governance')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (error) throw error
      return data as GovernanceData | null
    },
  })

  // Export jobs for this org
  const { data: exportJobs = [] } = useQuery({
    queryKey: ['org-export-jobs', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_export_jobs')
        .select('id, status, scope, created_at, started_at, finished_at, result_bytes, result_expires_at, storage_path, attempt_count, max_attempts, error_message')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data || []) as ExportJob[]
    },
    enabled: !!organizationId,
    refetchInterval: (query) => {
      const jobs = query.state.data as ExportJob[] | undefined
      return jobs?.some((j) => j.status === 'queued' || j.status === 'running') ? 5000 : false
    },
  })

  useEffect(() => {
    if (governance) {
      setRetentionDays(governance.retention_days_audit_log)
      setHasRetentionChange(false)
    }
  }, [governance])

  const updateRetentionMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('set_org_governance', {
        p_org_id: organizationId,
        p_retention_days: retentionDays,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-governance', organizationId] })
      toast.success('Retention policy updated')
      setHasRetentionChange(false)
      logOrgActivity({
        organizationId,
        action: 'settings.retention_changed',
        targetType: 'organization',
        targetId: organizationId,
        details: { retention_days: retentionDays },
        entityType: 'settings',
        actionType: 'updated',
      })
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update retention')
    },
  })

  const exportMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('request_org_export', {
        p_org_id: organizationId,
        p_scope: 'metadata_only',
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-export-jobs', organizationId] })
      toast.success('Export requested — you will be notified when ready')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to request export')
    },
  })

  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc('cancel_export_job', { p_job_id: jobId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-export-jobs', organizationId] })
      toast.success('Export cancelled')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to cancel export')
    },
  })

  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null)
  const [showExportConfirm, setShowExportConfirm] = useState(false)

  const handleDownload = async (job: ExportJob) => {
    if (!job.storage_path) return
    setDownloadingJobId(job.id)
    try {
      const { data: urlData, error } = await supabase.rpc('get_export_download_url', { p_job_id: job.id })
      if (error) throw error
      const path = (urlData as any)?.storage_path || job.storage_path
      const { data: signedData, error: signErr } = await supabase.storage
        .from('org-exports')
        .createSignedUrl(path, 600) // 10 min expiry
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

  if (isLoading) return null

  const isExpired = (job: ExportJob) =>
    job.result_expires_at && new Date(job.result_expires_at) < new Date()

  return (
    <Card className="p-4">
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Data Governance</h3>
          {governance && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              governance.legal_hold
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {governance.legal_hold ? 'Legal Hold: Active' : 'Legal Hold: Inactive'}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Audit log retention, legal hold status, and data export
        </p>
      </div>

      <div className="space-y-4">
        {/* Audit Log Retention */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Audit Log Retention (days)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={retentionDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v)) {
                  setRetentionDays(v)
                  setHasRetentionChange(v !== (governance?.retention_days_audit_log ?? 365))
                }
              }}
              min={30}
              max={3650}
              className="w-32 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <span className="text-xs text-gray-500">30–3650 days</span>
            {hasRetentionChange && (
              <Button
                size="sm"
                onClick={() => updateRetentionMutation.mutate()}
                disabled={retentionDays < 30 || retentionDays > 3650 || updateRetentionMutation.isPending}
              >
                {updateRetentionMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            )}
          </div>
        </div>

        {/* Legal Hold — distinct, serious sub-panel */}
        <div className={`rounded-lg border-2 p-3 ${
          governance?.legal_hold
            ? 'border-red-300 bg-red-50/60'
            : 'border-gray-200 bg-gray-50/50'
        }`}>
          <div className="flex items-start gap-2.5">
            <Shield className={`w-4 h-4 mt-0.5 flex-shrink-0 ${governance?.legal_hold ? 'text-red-600' : 'text-gray-400'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold ${governance?.legal_hold ? 'text-red-900' : 'text-gray-800'}`}>
                  Legal Hold
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  governance?.legal_hold
                    ? 'bg-red-200 text-red-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {governance?.legal_hold ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className={`text-xs mt-1 ${governance?.legal_hold ? 'text-red-800' : 'text-gray-500'}`}>
                {governance?.legal_hold
                  ? 'Audit logs cannot be deleted and organization deletion is blocked. Contact your platform administrator to lift the hold.'
                  : 'No hold in effect. Audit logs follow the retention policy above.'}
              </p>
            </div>
          </div>
        </div>

        {/* Archive / Deletion Status (read-only) */}
        {governance?.archived_at && (
          <div className="flex items-start gap-2.5 p-2.5 rounded-lg border border-amber-200 bg-amber-50">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-500 flex-shrink-0" />
            <div>
              <div className="text-xs font-semibold text-amber-900">Organization Archived</div>
              <p className="text-xs text-amber-700 mt-0.5">
                Archived on {new Date(governance.archived_at).toLocaleDateString()}. Contact platform admin to restore.
              </p>
            </div>
          </div>
        )}

        {governance?.deletion_scheduled_at && (
          <div className="flex items-start gap-2.5 p-2.5 rounded-lg border border-red-200 bg-red-50">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-red-500 flex-shrink-0" />
            <div>
              <div className="text-xs font-semibold text-red-900">Deletion Scheduled</div>
              <p className="text-xs text-red-700 mt-0.5">
                Scheduled for {new Date(governance.deletion_scheduled_at).toLocaleDateString()}. Contact platform admin to cancel.
              </p>
            </div>
          </div>
        )}

        {/* Exports */}
        <div className="pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-medium text-gray-900">Data Exports</div>
              <p className="text-xs text-gray-500">Export requests are logged. Exports may take time to prepare.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowExportConfirm(true)}
              disabled={exportMutation.isPending}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              {exportMutation.isPending ? 'Requesting...' : 'Request Export'}
            </Button>
          </div>

          {exportJobs.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-left">
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Requested</th>
                    <th className="px-3 py-2 font-medium">Completed</th>
                    <th className="px-3 py-2 font-medium">Size</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {exportJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${STATUS_PILL[job.status]}`}>
                          {job.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {job.status}
                        </span>
                        {job.status === 'failed' && job.error_message && (
                          <span className="ml-1 text-red-500 cursor-help" title={job.error_message}>
                            <AlertTriangle className="w-3 h-3 inline" />
                          </span>
                        )}
                        {job.attempt_count > 1 && (
                          <span className="ml-1 text-gray-400" title={`Attempt ${job.attempt_count}/${job.max_attempts}`}>
                            ({job.attempt_count}/{job.max_attempts})
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
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {job.status === 'succeeded' && job.storage_path && !isExpired(job) && (
                            <button
                              onClick={() => handleDownload(job)}
                              disabled={downloadingJobId === job.id}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded hover:bg-indigo-50 transition-colors disabled:opacity-50"
                            >
                              <Download className="w-3 h-3" />
                              {downloadingJobId === job.id ? 'Loading...' : 'Download'}
                            </button>
                          )}
                          {job.status === 'succeeded' && isExpired(job) && (
                            <span className="text-[10px] text-gray-400">Expired</span>
                          )}
                          {(job.status === 'queued' || job.status === 'failed') && (
                            <button
                              onClick={() => cancelJobMutation.mutate(job.id)}
                              disabled={cancelJobMutation.isPending}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-500 hover:text-red-600 border border-gray-200 rounded hover:bg-red-50 transition-colors"
                              title="Cancel export"
                            >
                              <XCircle className="w-3 h-3" />
                              Cancel
                            </button>
                          )}
                          {job.status === 'failed' && (
                            <button
                              onClick={() => exportMutation.mutate()}
                              disabled={exportMutation.isPending}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-500 hover:text-indigo-600 border border-gray-200 rounded hover:bg-indigo-50 transition-colors"
                              title="Re-request export"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Export confirmation modal */}
      {showExportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="export-confirm-title">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowExportConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 mx-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                <Download className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 id="export-confirm-title" className="text-base font-semibold text-gray-900">Request organization export?</h3>
                <p className="text-sm text-gray-500">
                  Exports may take time to prepare. This action will be logged.
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="outline" size="sm" onClick={() => setShowExportConfirm(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={exportMutation.isPending}
                onClick={() => {
                  exportMutation.mutate()
                  setShowExportConfirm(false)
                }}
              >
                {exportMutation.isPending ? 'Requesting...' : 'Confirm Export'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
