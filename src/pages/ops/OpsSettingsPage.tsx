/**
 * OpsSettingsPage — Platform admin management.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield, Plus, Trash2, Loader2, AlertCircle, Building2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export function OpsSettingsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [addAdminEmail, setAddAdminEmail] = useState('')

  // ─── Platform Admins ───────────────────────────────────────

  const { data: platformAdmins = [], isLoading: adminsLoading } = useQuery({
    queryKey: ['ops-platform-admins'],
    queryFn: async () => {
      // Two-step: get admin IDs, then fetch user details
      const { data: admins, error } = await supabase
        .from('platform_admins')
        .select('user_id, created_at')
        .order('created_at')
      if (error) throw error
      if (!admins?.length) return []

      const { data: users } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', admins.map(a => a.user_id))

      const userMap = new Map((users || []).map(u => [u.id, u]))
      return admins.map(a => {
        const u = userMap.get(a.user_id)
        return {
          userId: a.user_id,
          email: u?.email || 'Unknown',
          name: [u?.first_name, u?.last_name].filter(Boolean).join(' ') || null,
          createdAt: a.created_at,
        }
      })
    },
  })

  const addAdminM = useMutation({
    mutationFn: async (email: string) => {
      const { data: targetUser, error: userErr } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle()
      if (userErr) throw userErr
      if (!targetUser) throw new Error(`No user found with email: ${email}`)

      const { error } = await supabase
        .from('platform_admins')
        .insert({ user_id: targetUser.id })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-platform-admins'] })
      setAddAdminEmail('')
    },
  })

  const removeAdminM = useMutation({
    mutationFn: async (userId: string) => {
      if (userId === user?.id) throw new Error('Cannot remove yourself as platform admin')
      const { error } = await supabase
        .from('platform_admins')
        .delete()
        .eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-platform-admins'] })
    },
  })

  // ─── Client Organizations ──────────────────────────────────

  const { data: clientOrgs = [], isLoading: orgsLoading } = useQuery({
    queryKey: ['ops-settings-orgs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, created_at, settings')
        .order('name')
      if (error) throw error
      return data || []
    },
  })

  const deleteOrgM = useMutation({
    mutationFn: async (orgId: string) => {
      await supabase.from('organization_memberships').delete().eq('organization_id', orgId)
      const { error } = await supabase.from('organizations').delete().eq('id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-settings-orgs'] })
      queryClient.invalidateQueries({ queryKey: ['ops-clients'] })
    },
  })

  const togglePilotModeM = useMutation({
    mutationFn: async ({ orgId, enabled }: { orgId: string; enabled: boolean }) => {
      const org = clientOrgs.find(o => o.id === orgId)
      const currentSettings = (org?.settings as any) || {}
      const { error } = await supabase
        .from('organizations')
        .update({ settings: { ...currentSettings, pilot_mode: enabled } })
        .eq('id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-settings-orgs'] })
    },
  })

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Platform Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage platform admins and client organizations</p>
      </div>

      {/* ── Platform Admins ─────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-gray-900">Platform Admins</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Platform admins can access the Operations Portal, provision clients, and manage all users.
        </p>

        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-3">
          {adminsLoading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          ) : platformAdmins.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-400">No platform admins found</div>
          ) : platformAdmins.map(admin => (
            <div key={admin.userId} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{admin.email}</p>
                {admin.name && <p className="text-xs text-gray-400">{admin.name}</p>}
              </div>
              <div className="flex items-center gap-2">
                {admin.userId === user?.id && (
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">You</span>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Remove ${admin.email} as platform admin?`)) {
                      removeAdminM.mutate(admin.userId)
                    }
                  }}
                  disabled={admin.userId === user?.id || removeAdminM.isPending}
                  className="p-1 text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title={admin.userId === user?.id ? 'Cannot remove yourself' : 'Remove admin'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={e => { e.preventDefault(); if (addAdminEmail.trim()) addAdminM.mutate(addAdminEmail) }}
          className="flex items-center gap-2"
        >
          <input
            type="email"
            placeholder="Email address of new admin..."
            value={addAdminEmail}
            onChange={e => setAddAdminEmail(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!addAdminEmail.trim() || addAdminM.isPending}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          >
            {addAdminM.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </form>
        {addAdminM.isError && (
          <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {(addAdminM.error as Error).message}
          </p>
        )}
        {removeAdminM.isError && (
          <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {(removeAdminM.error as Error).message}
          </p>
        )}
      </section>

      {/* ── Client Organizations ────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-gray-900">Client Organizations</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Toggle pilot mode or delete organizations. Manage users under Clients → [Client Name].
        </p>

        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {orgsLoading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          ) : clientOrgs.map(org => {
            const isPilot = (org.settings as any)?.pilot_mode === true
            return (
              <div key={org.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900">{org.name}</p>
                    {isPilot && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 rounded">
                        Pilot
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">{org.slug} &middot; {new Date(org.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => togglePilotModeM.mutate({ orgId: org.id, enabled: !isPilot })}
                    disabled={togglePilotModeM.isPending}
                    className={clsx(
                      'px-2 py-1 rounded text-[11px] font-medium transition-colors',
                      isPilot ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    )}
                  >
                    {isPilot ? 'Pilot On' : 'Pilot Off'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`DELETE "${org.name}"? This permanently removes the organization and all its data. This cannot be undone.`)) {
                        deleteOrgM.mutate(org.id)
                      }
                    }}
                    disabled={deleteOrgM.isPending}
                    className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                    title="Delete organization"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {deleteOrgM.isError && (
          <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {(deleteOrgM.error as Error).message}
          </p>
        )}
      </section>
    </div>
  )
}
