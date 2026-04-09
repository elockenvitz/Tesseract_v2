/**
 * OpsHoldingsPage — Cross-client holdings monitoring and integration management.
 *
 * Two views:
 *   1. Overview — health table across all clients
 *   2. Integration detail — configure SFTP/API/manual for a specific client, view run history
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Database, Building2, CheckCircle2, AlertTriangle, Clock, Upload,
  Plus, Settings, Play, Pause, Trash2, Server, Key, FileSpreadsheet,
  ChevronRight, ArrowLeft, Loader2, RefreshCw,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/common/Toast'
import { useAuth } from '../../hooks/useAuth'

// ─── Types ────────────────────────────────────────────────────

interface ClientHoldingSummary {
  org: { id: string; name: string; slug: string }
  latestDate: string | null
  totalPortfolios: number
  totalPositions: number
  errorCount: number
  activeIntegrations: number
  integrationTypes: string[]
  health: 'good' | 'stale' | 'error' | 'none'
}

interface IntegrationConfig {
  id: string
  organization_id: string
  portfolio_id: string | null
  integration_type: 'sftp' | 'api' | 'manual'
  name: string
  description: string | null
  sftp_host: string | null
  sftp_port: number
  sftp_path: string | null
  sftp_username: string | null
  sftp_file_pattern: string | null
  schedule_cron: string | null
  timezone: string
  is_active: boolean
  last_run_at: string | null
  last_success_at: string | null
  last_error: string | null
  consecutive_failures: number
  created_at: string
}

interface IntegrationRun {
  id: string
  config_id: string
  status: 'running' | 'success' | 'partial' | 'failed'
  file_name: string | null
  positions_count: number | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

type View = 'overview' | 'client-detail'

const HEALTH_CONFIG = {
  good: { label: 'Healthy', cls: 'text-green-600 bg-green-50', icon: CheckCircle2 },
  stale: { label: 'Stale', cls: 'text-amber-600 bg-amber-50', icon: Clock },
  error: { label: 'Errors', cls: 'text-red-600 bg-red-50', icon: AlertTriangle },
  none: { label: 'No Data', cls: 'text-gray-400 bg-gray-50', icon: Database },
}

const INTEGRATION_ICONS = { sftp: Server, api: Key, manual: Upload }

// ─── Component ────────────────────────────────────────────────

export function OpsHoldingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { success, error: showError } = useToast()
  const { user } = useAuth()

  const [view, setView] = useState<View>('overview')
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [showNewIntegration, setShowNewIntegration] = useState(false)
  const [newConfig, setNewConfig] = useState({
    name: '',
    integration_type: 'sftp' as 'sftp' | 'api' | 'manual',
    sftp_host: '',
    sftp_port: '22',
    sftp_path: '',
    sftp_username: '',
    sftp_file_pattern: '*.csv',
    schedule_cron: '0 6 * * *',
    timezone: 'America/New_York',
  })

  // ─── Overview data ──────────────────────────────────────────

  const { data: clientHoldings = [], isLoading } = useQuery({
    queryKey: ['ops-holdings-overview'],
    queryFn: async () => {
      const { data: orgs } = await supabase.from('organizations').select('id, name, slug').order('name')
      if (!orgs?.length) return []

      const { data: snapshots } = await supabase
        .from('portfolio_holdings_snapshots')
        .select('organization_id, snapshot_date, source, total_positions, portfolio_id')
        .order('snapshot_date', { ascending: false })

      const { data: recentErrors } = await supabase
        .from('holdings_upload_log')
        .select('organization_id, status, created_at')
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(50)

      const { data: configs } = await supabase
        .from('holdings_integration_configs')
        .select('organization_id, integration_type, is_active, last_run_at, last_success_at, last_error')

      return orgs.map((org): ClientHoldingSummary => {
        const orgSnapshots = (snapshots || []).filter(s => s.organization_id === org.id)
        const latestDate = orgSnapshots[0]?.snapshot_date || null
        const totalPortfolios = new Set(orgSnapshots.map(s => s.portfolio_id)).size
        const totalPositions = orgSnapshots.reduce((sum, s) => sum + (s.total_positions || 0), 0)
        const orgErrors = (recentErrors || []).filter(e => e.organization_id === org.id)
        const orgConfigs = (configs || []).filter(c => c.organization_id === org.id)
        const activeIntegrations = orgConfigs.filter(c => c.is_active)

        let health: 'good' | 'stale' | 'error' | 'none' = 'none'
        if (latestDate) {
          const daysSince = Math.floor((Date.now() - new Date(latestDate).getTime()) / 86400000)
          if (orgErrors.length > 0 && new Date(orgErrors[0].created_at) > new Date(latestDate)) health = 'error'
          else if (daysSince > 3) health = 'stale'
          else health = 'good'
        }

        return { org, latestDate, totalPortfolios, totalPositions, errorCount: orgErrors.length, activeIntegrations: activeIntegrations.length, integrationTypes: [...new Set(activeIntegrations.map(c => c.integration_type))], health }
      })
    },
    staleTime: 60_000,
  })

  // ─── Client detail data ─────────────────────────────────────

  const selectedOrg = clientHoldings.find(c => c.org.id === selectedOrgId)

  const { data: integrations = [] } = useQuery({
    queryKey: ['ops-holdings-integrations', selectedOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holdings_integration_configs')
        .select('*')
        .eq('organization_id', selectedOrgId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as IntegrationConfig[]
    },
    enabled: !!selectedOrgId,
  })

  const { data: recentRuns = [] } = useQuery({
    queryKey: ['ops-holdings-runs', selectedOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holdings_integration_runs')
        .select('*')
        .eq('organization_id', selectedOrgId!)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data || []) as IntegrationRun[]
    },
    enabled: !!selectedOrgId,
  })

  const { data: orgPortfolios = [] } = useQuery({
    queryKey: ['ops-holdings-portfolios', selectedOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .eq('organization_id', selectedOrgId!)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!selectedOrgId,
  })

  // ─── Mutations ──────────────────────────────────────────────

  const createIntegration = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('holdings_integration_configs').insert({
        organization_id: selectedOrgId,
        integration_type: newConfig.integration_type,
        name: newConfig.name.trim(),
        sftp_host: newConfig.integration_type === 'sftp' ? newConfig.sftp_host.trim() || null : null,
        sftp_port: newConfig.integration_type === 'sftp' ? parseInt(newConfig.sftp_port) || 22 : 22,
        sftp_path: newConfig.integration_type === 'sftp' ? newConfig.sftp_path.trim() || null : null,
        sftp_username: newConfig.integration_type === 'sftp' ? newConfig.sftp_username.trim() || null : null,
        sftp_file_pattern: newConfig.integration_type === 'sftp' ? newConfig.sftp_file_pattern.trim() || null : null,
        schedule_cron: newConfig.schedule_cron.trim() || '0 6 * * *',
        timezone: newConfig.timezone,
        is_active: true,
        created_by: user?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      success('Integration created')
      queryClient.invalidateQueries({ queryKey: ['ops-holdings-integrations', selectedOrgId] })
      queryClient.invalidateQueries({ queryKey: ['ops-holdings-overview'] })
      setShowNewIntegration(false)
      setNewConfig({ name: '', integration_type: 'sftp', sftp_host: '', sftp_port: '22', sftp_path: '', sftp_username: '', sftp_file_pattern: '*.csv', schedule_cron: '0 6 * * *', timezone: 'America/New_York' })
    },
    onError: (err: any) => showError(err.message || 'Failed to create'),
  })

  const toggleIntegration = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('holdings_integration_configs').update({ is_active, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-holdings-integrations', selectedOrgId] })
      queryClient.invalidateQueries({ queryKey: ['ops-holdings-overview'] })
    },
  })

  // API keys for the selected org
  const { data: apiKeys = [] } = useQuery({
    queryKey: ['ops-holdings-api-keys', selectedOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holdings_api_keys')
        .select('*')
        .eq('organization_id', selectedOrgId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!selectedOrgId,
  })

  const [generatedKey, setGeneratedKey] = useState<string | null>(null)

  const generateApiKey = useMutation({
    mutationFn: async (name: string) => {
      // Generate a random API key
      const randomBytes = new Uint8Array(32)
      crypto.getRandomValues(randomBytes)
      const rawKey = 'hk_' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      const prefix = rawKey.slice(0, 11) // hk_ + 8 chars

      // Hash the key for storage
      const encoder = new TextEncoder()
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey))
      const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

      const { error } = await supabase.from('holdings_api_keys').insert({
        organization_id: selectedOrgId,
        key_hash: keyHash,
        key_prefix: prefix,
        name,
        created_by: user!.id,
      })
      if (error) throw error

      return rawKey // Return the raw key so user can copy it (shown only once)
    },
    onSuccess: (rawKey) => {
      setGeneratedKey(rawKey)
      queryClient.invalidateQueries({ queryKey: ['ops-holdings-api-keys', selectedOrgId] })
    },
    onError: (err: any) => showError(err.message || 'Failed to generate key'),
  })

  const revokeApiKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase.from('holdings_api_keys').update({ is_active: false }).eq('id', keyId)
      if (error) throw error
    },
    onSuccess: () => {
      success('API key revoked')
      queryClient.invalidateQueries({ queryKey: ['ops-holdings-api-keys', selectedOrgId] })
    },
  })

  const deleteIntegration = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('holdings_integration_configs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      success('Integration deleted')
      queryClient.invalidateQueries({ queryKey: ['ops-holdings-integrations', selectedOrgId] })
      queryClient.invalidateQueries({ queryKey: ['ops-holdings-overview'] })
    },
  })

  // ─── Render: Client Detail ─────────────────────────────────

  if (view === 'client-detail' && selectedOrgId) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => { setView('overview'); setSelectedOrgId(null) }} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" />
              {selectedOrg?.org.name || 'Client'} — Holdings Integrations
            </h1>
            <p className="text-xs text-gray-400">{integrations.length} integration{integrations.length !== 1 ? 's' : ''} configured</p>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowNewIntegration(!showNewIntegration)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Integration
          </button>
        </div>

        {/* New Integration Form */}
        {showNewIntegration && (
          <div className="bg-white border border-indigo-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-800">Configure New Integration</h3>

            {/* Type selector */}
            <div className="flex gap-2">
              {(['sftp', 'api', 'manual'] as const).map(type => {
                const Icon = INTEGRATION_ICONS[type]
                return (
                  <button
                    key={type}
                    onClick={() => setNewConfig(prev => ({ ...prev, integration_type: type }))}
                    className={clsx(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all',
                      newConfig.integration_type === type
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {type === 'sftp' ? 'SFTP' : type === 'api' ? 'API' : 'Manual'}
                  </button>
                )
              })}
            </div>

            {/* Common fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Integration Name</label>
                <input
                  type="text"
                  placeholder="e.g., State Street Daily Feed"
                  value={newConfig.name}
                  onChange={e => setNewConfig(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Schedule (cron)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="0 6 * * *"
                    value={newConfig.schedule_cron}
                    onChange={e => setNewConfig(prev => ({ ...prev, schedule_cron: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <select
                    value={newConfig.timezone}
                    onChange={e => setNewConfig(prev => ({ ...prev, timezone: e.target.value }))}
                    className="px-2 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="America/New_York">ET</option>
                    <option value="America/Chicago">CT</option>
                    <option value="America/Denver">MT</option>
                    <option value="America/Los_Angeles">PT</option>
                    <option value="UTC">UTC</option>
                    <option value="Europe/London">London</option>
                  </select>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">Default: daily at 6 AM</p>
              </div>
            </div>

            {/* SFTP fields */}
            {newConfig.integration_type === 'sftp' && (
              <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SFTP Host</label>
                  <input type="text" placeholder="sftp.custodian.com" value={newConfig.sftp_host} onChange={e => setNewConfig(prev => ({ ...prev, sftp_host: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Port</label>
                  <input type="text" placeholder="22" value={newConfig.sftp_port} onChange={e => setNewConfig(prev => ({ ...prev, sftp_port: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Remote Path</label>
                  <input type="text" placeholder="/outbound/holdings/" value={newConfig.sftp_path} onChange={e => setNewConfig(prev => ({ ...prev, sftp_path: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
                  <input type="text" placeholder="tesseract_feed" value={newConfig.sftp_username} onChange={e => setNewConfig(prev => ({ ...prev, sftp_username: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">File Pattern</label>
                  <input type="text" placeholder="*.csv" value={newConfig.sftp_file_pattern} onChange={e => setNewConfig(prev => ({ ...prev, sftp_file_pattern: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                  <p className="text-[10px] text-gray-400 mt-0.5">Glob pattern to match files in the remote directory</p>
                </div>
              </div>
            )}

            {/* API info */}
            {newConfig.integration_type === 'api' && (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-500">An API key will be generated after creation. The client's IT team can use it to push holdings data via the REST endpoint.</p>
              </div>
            )}

            {/* Manual info */}
            {newConfig.integration_type === 'manual' && (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-500">Manual integration — you'll upload CSV files for this client through the ops portal or the client detail page.</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => createIntegration.mutate()}
                disabled={!newConfig.name.trim() || createIntegration.isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
              >
                {createIntegration.isPending ? <><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />Creating...</> : 'Create Integration'}
              </button>
              <button onClick={() => setShowNewIntegration(false)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          </div>
        )}

        {/* Integration list */}
        {integrations.length === 0 && !showNewIntegration ? (
          <div className="text-center py-12 bg-white border border-gray-200 rounded-xl">
            <Database className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No integrations configured for this client</p>
            <button onClick={() => setShowNewIntegration(true)} className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium">Add one</button>
          </div>
        ) : (
          <div className="space-y-3">
            {integrations.map(config => {
              const TypeIcon = INTEGRATION_ICONS[config.integration_type]
              const configRuns = recentRuns.filter(r => r.config_id === config.id)
              return (
                <div key={config.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {/* Config header */}
                  <div className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center', config.is_active ? 'bg-indigo-50' : 'bg-gray-100')}>
                        <TypeIcon className={clsx('w-4 h-4', config.is_active ? 'text-indigo-600' : 'text-gray-400')} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">{config.name}</p>
                          <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', config.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                            {config.is_active ? 'Active' : 'Paused'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium uppercase">{config.integration_type}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                          {config.schedule_cron && <span>Schedule: {config.schedule_cron} ({config.timezone})</span>}
                          {config.sftp_host && <span>Host: {config.sftp_host}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleIntegration.mutate({ id: config.id, is_active: !config.is_active })}
                        title={config.is_active ? 'Pause' : 'Activate'}
                        className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        {config.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => { if (window.confirm('Delete this integration?')) deleteIntegration.mutate(config.id) }}
                        className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Status row */}
                  <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center gap-6 text-xs">
                    <div>
                      <span className="text-gray-400">Last run: </span>
                      <span className="text-gray-600">{config.last_run_at ? new Date(config.last_run_at).toLocaleString() : 'Never'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Last success: </span>
                      <span className="text-gray-600">{config.last_success_at ? new Date(config.last_success_at).toLocaleString() : 'Never'}</span>
                    </div>
                    {config.last_error && (
                      <div className="text-red-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {config.last_error}
                      </div>
                    )}
                    {config.consecutive_failures > 0 && (
                      <span className="text-red-600 font-medium">{config.consecutive_failures} consecutive failures</span>
                    )}
                  </div>

                  {/* Run history */}
                  {configRuns.length > 0 && (
                    <div className="border-t border-gray-100">
                      <div className="px-5 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wide">Recent Runs</div>
                      {configRuns.slice(0, 5).map(run => (
                        <div key={run.id} className="px-5 py-2 flex items-center justify-between border-t border-gray-50 text-xs">
                          <div className="flex items-center gap-2">
                            <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                              run.status === 'success' ? 'bg-green-100 text-green-700' :
                              run.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                              run.status === 'failed' ? 'bg-red-100 text-red-700' :
                              'bg-blue-100 text-blue-700'
                            )}>
                              {run.status}
                            </span>
                            {run.file_name && <span className="text-gray-500 font-mono">{run.file_name}</span>}
                            {run.positions_count != null && <span className="text-gray-400">{run.positions_count} positions</span>}
                          </div>
                          <div className="text-gray-400">
                            {new Date(run.started_at).toLocaleString()}
                            {run.error_message && <span className="text-red-500 ml-2" title={run.error_message}><AlertTriangle className="w-3 h-3 inline" /></span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* API Keys Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
              <Key className="w-4 h-4 text-gray-500" />
              API Keys
            </h3>
            <button
              onClick={() => {
                const name = window.prompt('API key name (e.g., "State Street Daily Feed"):')
                if (name?.trim()) generateApiKey.mutate(name.trim())
              }}
              disabled={generateApiKey.isPending}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Generate Key
            </button>
          </div>

          {/* Show newly generated key (only once) */}
          {generatedKey && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-amber-800">Copy this API key now — it won't be shown again</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-white px-3 py-2 rounded border border-amber-300 font-mono break-all select-all">
                  {generatedKey}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(generatedKey); success('Key copied') }}
                  className="px-3 py-2 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700"
                >
                  Copy
                </button>
              </div>
              <button onClick={() => setGeneratedKey(null)} className="text-xs text-amber-600 hover:text-amber-800">
                Done — I've saved it
              </button>
            </div>
          )}

          {apiKeys.length === 0 && !generatedKey ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 text-center text-sm text-gray-400">
              No API keys. Generate one for the client's IT team to push holdings programmatically.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
              {apiKeys.map((key: any) => (
                <div key={key.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{key.name}</span>
                      <code className="text-xs text-gray-400 font-mono">{key.key_prefix}...</code>
                      <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', key.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                        {key.is_active ? 'Active' : 'Revoked'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Created {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at && <> · Last used {new Date(key.last_used_at).toLocaleDateString()}</>}
                    </p>
                  </div>
                  {key.is_active && (
                    <button
                      onClick={() => { if (window.confirm('Revoke this API key?')) revokeApiKey.mutate(key.id) }}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* API usage instructions */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-500 space-y-1">
            <p className="font-medium text-gray-700">API Endpoint</p>
            <code className="block bg-white px-2 py-1 rounded border text-[11px] font-mono">
              POST {window.location.origin.replace('localhost:5173', '<your-supabase-url>')}/functions/v1/holdings-api/upload
            </code>
            <p className="mt-2">Headers: <code className="bg-white px-1 rounded">Authorization: Bearer hk_...</code></p>
            <p>Body: <code className="bg-white px-1 rounded">{`{"positions": [{"symbol": "AAPL", "shares": 1000, "price": 180.50}]}`}</code></p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Render: Overview ───────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Holdings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Holdings integration status across all clients</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Total Clients</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{clientHoldings.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">With Holdings</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{clientHoldings.filter(c => c.health !== 'none').length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Stale ({'>'} 3 days)</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{clientHoldings.filter(c => c.health === 'stale').length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Errors</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{clientHoldings.filter(c => c.health === 'error').length}</p>
        </div>
      </div>

      {/* Client holdings table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-gray-400">Loading holdings data...</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Client</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Portfolios</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Positions</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Last Upload</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Integration</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clientHoldings.map((client) => {
                const healthCfg = HEALTH_CONFIG[client.health]
                const HealthIcon = healthCfg.icon
                return (
                  <tr key={client.org.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="font-medium text-gray-900">{client.org.name}</p>
                          <p className="text-xs text-gray-400">{client.org.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', healthCfg.cls)}>
                        <HealthIcon className="w-3 h-3" />
                        {healthCfg.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600">{client.totalPortfolios || '—'}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{client.totalPositions || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{client.latestDate || '—'}</td>
                    <td className="px-5 py-3">
                      {client.integrationTypes.length > 0 ? (
                        <div className="flex gap-1">
                          {client.integrationTypes.map(t => (
                            <span key={t} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-medium uppercase">{t}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => { setSelectedOrgId(client.org.id); setView('client-detail') }}
                        className="px-2.5 py-1 text-xs font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors flex items-center gap-1 ml-auto"
                      >
                        <Settings className="w-3 h-3" />
                        Configure
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
