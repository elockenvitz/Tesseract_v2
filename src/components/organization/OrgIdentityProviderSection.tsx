/**
 * OrgIdentityProviderSection — SSO / Identity Provider settings for org admins.
 *
 * Allows configuring OIDC provider (discovery URL, client ID, SSO-only mode).
 * Uses upsert_identity_provider / delete_identity_provider RPCs.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Trash2, AlertTriangle, Info } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../common/Toast'
import { useOrgWriteEnabled } from '../../hooks/useOrgWriteEnabled'
import { mapMutationError } from '../../lib/archived-org-errors'

interface OrgIdentityProviderSectionProps {
  organizationId: string
  verifiedDomainCount?: number
}

interface IdentityProvider {
  id: string
  organization_id: string
  provider_type: string
  discovery_url: string
  client_id: string
  enabled: boolean
  sso_only: boolean
  created_at: string
  updated_at: string
}

function formatTimeAgo(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function OrgIdentityProviderSection({ organizationId, verifiedDomainCount = 0 }: OrgIdentityProviderSectionProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { canWrite, reason: archivedReason } = useOrgWriteEnabled()

  const [discoveryUrl, setDiscoveryUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [ssoOnly, setSsoOnly] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Fetch existing IdP config
  const { data: provider, isLoading } = useQuery({
    queryKey: ['org-identity-provider', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_identity_providers')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (error) throw error
      return data as IdentityProvider | null
    },
  })

  // Sync form state when provider loads
  useEffect(() => {
    if (provider) {
      setDiscoveryUrl(provider.discovery_url)
      setClientId(provider.client_id)
      setSsoOnly(provider.sso_only)
      setEnabled(provider.enabled)
    }
  }, [provider])

  const hasChanges = provider
    ? discoveryUrl !== provider.discovery_url ||
      clientId !== provider.client_id ||
      clientSecret.length > 0 ||
      ssoOnly !== provider.sso_only ||
      enabled !== provider.enabled
    : discoveryUrl.length > 0 || clientId.length > 0

  // Upsert mutation
  const upsertMutation = useMutation({
    mutationFn: async () => {
      const params: Record<string, any> = {
        p_organization_id: organizationId,
        p_discovery_url: discoveryUrl,
        p_client_id: clientId,
        p_sso_only: ssoOnly,
        p_enabled: enabled,
      }
      // Only send client_secret if user entered a new one
      if (clientSecret.trim()) {
        params.p_client_secret = clientSecret.trim()
      }
      const { data, error } = await supabase.rpc('upsert_identity_provider', params)
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-identity-provider', organizationId] })
      setClientSecret('')
      toast.success('Identity provider saved')
    },
    onError: (err: any) => {
      toast.error(mapMutationError(err))
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error('No provider to delete')
      const { error } = await supabase.rpc('delete_identity_provider', {
        p_provider_id: provider.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-identity-provider', organizationId] })
      setDiscoveryUrl('')
      setClientId('')
      setClientSecret('')
      setSsoOnly(false)
      setEnabled(true)
      setShowDeleteConfirm(false)
      toast.success('Identity provider removed')
    },
    onError: (err: any) => {
      toast.error(mapMutationError(err))
    },
  })

  if (isLoading) return null

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-gray-900">SSO / Identity Provider</h3>
              {!isLoading && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  provider?.enabled && provider?.sso_only
                    ? 'bg-amber-100 text-amber-700'
                    : provider?.enabled
                      ? 'bg-green-100 text-green-700'
                      : provider
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-gray-100 text-gray-500'
                }`}>
                  {provider?.enabled && provider?.sso_only
                    ? 'SSO-Only Mode'
                    : provider?.enabled
                      ? 'SSO Enabled'
                      : provider
                        ? 'SSO Disabled'
                        : 'Not Configured'}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Configure OIDC single sign-on for your organization
            </p>
            {provider?.updated_at && (
              <p className="text-[10px] text-gray-400 mt-0.5">Updated {formatTimeAgo(provider.updated_at)}</p>
            )}
          </div>
          {provider && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-600 hover:bg-red-50"
              disabled={!canWrite}
              title={!canWrite ? archivedReason : undefined}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Disconnect
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">Enable SSO</span>
          </label>

          {/* Discovery URL */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Discovery URL (OpenID Configuration)
            </label>
            <input
              type="url"
              value={discoveryUrl}
              onChange={(e) => setDiscoveryUrl(e.target.value)}
              placeholder="https://login.example.com/.well-known/openid-configuration"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Client ID */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Client ID
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="your-oidc-client-id"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Client Secret (optional, for confidential clients) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Client Secret <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={provider ? '••••••••  (leave blank to keep existing)' : 'For confidential OIDC clients'}
              autoComplete="off"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">
              Required for confidential clients. Not needed for PKCE-only (public) clients.
            </p>
          </div>

          {/* SSO-only toggle */}
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={ssoOnly}
              onChange={(e) => setSsoOnly(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <span className="text-sm text-gray-700">SSO-only mode</span>
              <p className="text-xs text-gray-500 mt-0.5">
                Require SSO for all users — password login will be disabled.
                Requires at least one verified domain.
              </p>
            </div>
          </label>

          {/* Warning: SSO-only with no verified domains */}
          {ssoOnly && verifiedDomainCount === 0 && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
              <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800">
                <strong>SSO-only requires at least one verified domain.</strong> Add and verify a domain in the Verified Domains section above before enabling SSO-only mode.
              </p>
            </div>
          )}

          {/* Save button */}
          <div className="flex justify-end pt-2">
            <Button
              size="sm"
              onClick={() => upsertMutation.mutate()}
              disabled={!hasChanges || !discoveryUrl.trim() || !clientId.trim() || upsertMutation.isPending || !canWrite}
              title={!canWrite ? archivedReason : undefined}
            >
              {upsertMutation.isPending ? 'Saving...' : provider ? 'Update' : 'Save'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 mx-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Disconnect SSO?</h3>
                <p className="text-sm text-gray-500">
                  This will remove the identity provider configuration. Users will need to use password login.
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? 'Removing...' : 'Remove'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
