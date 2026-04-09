/**
 * OpsClientsPage — Client organization list and provisioning.
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus, Search, Users, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/common/Toast'

interface ClientOrg {
  id: string
  name: string
  slug: string
  created_at: string
  member_count: number
  portfolio_count: number
}

export function OpsClientsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { success, error: showError } = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [showProvision, setShowProvision] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', email: '' })

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['ops-clients'],
    queryFn: async () => {
      const { data: orgs, error } = await supabase
        .from('organizations')
        .select('id, name, slug, created_at')
        .order('name')
      if (error) throw error

      // Get member counts
      const { data: memberships } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('status', 'active')

      const memberCounts = new Map<string, number>()
      for (const m of memberships || []) {
        memberCounts.set(m.organization_id, (memberCounts.get(m.organization_id) || 0) + 1)
      }

      // Get portfolio counts
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('organization_id')
        .eq('is_active', true)

      const portfolioCounts = new Map<string, number>()
      for (const p of portfolios || []) {
        if (p.organization_id) portfolioCounts.set(p.organization_id, (portfolioCounts.get(p.organization_id) || 0) + 1)
      }

      return (orgs || []).map((org): ClientOrg => ({
        ...org,
        member_count: memberCounts.get(org.id) || 0,
        portfolio_count: portfolioCounts.get(org.id) || 0,
      }))
    },
  })

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return clients
    const term = searchTerm.toLowerCase()
    return clients.filter(c => c.name.toLowerCase().includes(term) || c.slug.toLowerCase().includes(term))
  }, [clients, searchTerm])

  const provisionMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('provision_client_org', {
        p_name: form.name.trim(),
        p_slug: form.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        p_admin_email: form.email.trim().toLowerCase(),
      })
      if (error) throw error
      return data
    },
    onSuccess: (data: any) => {
      success(`"${form.name}" provisioned successfully`)
      queryClient.invalidateQueries({ queryKey: ['ops-clients'] })
      setShowProvision(false)
      setForm({ name: '', slug: '', email: '' })
      if (data?.organization_id) navigate(`/ops/clients/${data.organization_id}`)
    },
    onError: (err: any) => showError(err.message || 'Failed to provision'),
  })

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{clients.length} organization{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowProvision(!showProvision)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Client
        </button>
      </div>

      {/* Provision Form */}
      {showProvision && (
        <div className="bg-white border border-indigo-200 rounded-xl p-5 space-y-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-800">Provision New Client Organization</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Organization Name</label>
              <input
                type="text"
                placeholder="Acme Capital"
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value
                  setForm(prev => ({
                    ...prev,
                    name,
                    slug: prev.slug === prev.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
                      ? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
                      : prev.slug,
                  }))
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">URL Slug</label>
              <input
                type="text"
                placeholder="acme-capital"
                value={form.slug}
                onChange={(e) => setForm(prev => ({ ...prev, slug: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Admin Email</label>
              <input
                type="email"
                placeholder="admin@acmecapital.com"
                value={form.email}
                onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => provisionMutation.mutate()}
              disabled={!form.name.trim() || !form.slug.trim() || !form.email.trim() || provisionMutation.isPending}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
            >
              {provisionMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />Provisioning...</> : 'Create Organization'}
            </button>
            <button onClick={() => setShowProvision(false)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search clients..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
        />
      </div>

      {/* Client List */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading clients...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">{searchTerm ? 'No clients match your search' : 'No clients yet'}</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {filtered.map((client) => (
            <button
              key={client.id}
              onClick={() => navigate(`/ops/clients/${client.id}`)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{client.name}</p>
                  <p className="text-xs text-gray-400">{client.slug}</p>
                </div>
              </div>
              <div className="flex items-center gap-5 flex-shrink-0">
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Users className="w-3.5 h-3.5" />
                  {client.member_count}
                </div>
                <div className="text-xs text-gray-400">
                  {client.portfolio_count} portfolio{client.portfolio_count !== 1 ? 's' : ''}
                </div>
                <div className="text-[10px] text-gray-400">
                  {new Date(client.created_at).toLocaleDateString()}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
