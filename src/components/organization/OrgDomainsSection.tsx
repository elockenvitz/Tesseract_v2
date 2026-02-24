/**
 * OrgDomainsSection — Verified domain management for org admins.
 *
 * Allows admins to add email domains, generate verification tokens,
 * and verify domains. Used in the Settings tab of OrganizationPage.
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Plus, Copy, Check, Trash2, ShieldCheck, Clock, AlertCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { format } from 'date-fns'
import { useOrgWriteEnabled } from '../../hooks/useOrgWriteEnabled'
import { mapMutationError } from '../../lib/archived-org-errors'

interface Domain {
  id: string
  domain: string
  status: 'pending' | 'verified'
  verification_token: string | null
  verified_at: string | null
  created_at: string
}

interface OrgDomainsSectionProps {
  organizationId: string
}

export function OrgDomainsSection({ organizationId }: OrgDomainsSectionProps) {
  const queryClient = useQueryClient()
  const { canWrite, reason: archivedReason } = useOrgWriteEnabled()
  const [newDomain, setNewDomain] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [verifyToken, setVerifyToken] = useState('')
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [showVerifyInput, setShowVerifyInput] = useState<string | null>(null)

  // Fetch domains for this org
  const { data: domains = [], isLoading } = useQuery({
    queryKey: ['organization-domains', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_domains')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data || []) as Domain[]
    },
    enabled: !!organizationId,
  })

  const verifiedCount = domains.filter(d => d.status === 'verified').length

  // Add domain mutation
  const addDomainM = useMutation({
    mutationFn: async (domain: string) => {
      const { data, error } = await supabase.rpc('create_domain_verification', { p_domain: domain })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-domains', organizationId] })
      setNewDomain('')
      setAddError(null)
    },
    onError: (err: any) => {
      setAddError(mapMutationError(err))
    },
  })

  // Verify domain mutation
  const verifyDomainM = useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc('verify_domain', { p_token: token })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-domains', organizationId] })
      setVerifyToken('')
      setVerifyError(null)
      setShowVerifyInput(null)
    },
    onError: (err: any) => {
      setVerifyError(mapMutationError(err))
    },
  })

  // Delete domain mutation
  const deleteDomainM = useMutation({
    mutationFn: async (domainId: string) => {
      const { error } = await supabase
        .from('organization_domains')
        .delete()
        .eq('id', domainId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-domains', organizationId] })
    },
  })

  const handleAdd = useCallback(() => {
    const trimmed = newDomain.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('.')) {
      setAddError('Enter a valid domain (e.g., firm.com)')
      return
    }
    setAddError(null)
    addDomainM.mutate(trimmed)
  }, [newDomain, addDomainM])

  const handleCopyToken = useCallback((token: string) => {
    navigator.clipboard.writeText(token)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }, [])

  const handleVerify = useCallback((domainId: string) => {
    if (!verifyToken.trim()) {
      setVerifyError('Paste the verification token')
      return
    }
    setVerifyError(null)
    verifyDomainM.mutate(verifyToken.trim())
  }, [verifyToken, verifyDomainM])

  return (
    <Card className="p-4">
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Verified Domains</h3>
          {!isLoading && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              verifiedCount > 0
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {verifiedCount > 0
                ? `${verifiedCount} Verified Domain${verifiedCount !== 1 ? 's' : ''}`
                : '0 Verified Domains'}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Verified domains let new users be automatically routed to this organization on sign-up based on their email.
        </p>
      </div>

      {/* Domain list */}
      {isLoading ? (
        <div className="text-sm text-gray-400 py-3">Loading domains...</div>
      ) : domains.length > 0 ? (
        <div className="space-y-1.5 mb-3">
          {domains.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/40 rounded-lg"
            >
              <div className="flex items-center gap-3">
                {d.status === 'verified' ? (
                  <ShieldCheck className="w-4 h-4 text-green-600 flex-shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                )}
                <div>
                  <span className="text-sm font-medium text-gray-900">{d.domain}</span>
                  {d.status === 'verified' && d.verified_at && (
                    <span className="text-xs text-gray-400 ml-2">
                      Verified {format(new Date(d.verified_at), 'MMM d, yyyy')}
                    </span>
                  )}
                  {d.status === 'pending' && (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                      Pending
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {d.status === 'pending' && d.verification_token && (
                  <>
                    <button
                      onClick={() => handleCopyToken(d.verification_token!)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded transition-colors"
                      title="Copy verification token"
                    >
                      {copiedToken === d.verification_token ? (
                        <><Check className="w-3 h-3 text-green-600" /> Copied</>
                      ) : (
                        <><Copy className="w-3 h-3" /> Token</>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setShowVerifyInput(showVerifyInput === d.id ? null : d.id)
                        setVerifyToken(d.verification_token || '')
                        setVerifyError(null)
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-300 rounded transition-colors"
                    >
                      <ShieldCheck className="w-3 h-3" /> Verify
                    </button>
                  </>
                )}
                <button
                  onClick={() => deleteDomainM.mutate(d.id)}
                  className="p-1 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  title={!canWrite ? archivedReason : 'Remove domain'}
                  disabled={!canWrite}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Inline verify input */}
          {showVerifyInput && (
            <div className="flex items-center gap-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
              <input
                type="text"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                placeholder="Paste verification token"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <Button
                size="sm"
                onClick={() => handleVerify(showVerifyInput)}
                disabled={verifyDomainM.isPending}
              >
                {verifyDomainM.isPending ? 'Verifying...' : 'Confirm'}
              </Button>
              {verifyError && (
                <span className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {verifyError}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-400 py-2 mb-4">No domains added yet.</div>
      )}

      {/* Add domain form */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => { setNewDomain(e.target.value); setAddError(null) }}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="e.g. firm.com"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={addDomainM.isPending || !newDomain.trim() || !canWrite}
          title={!canWrite ? archivedReason : undefined}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          {addDomainM.isPending ? 'Adding...' : 'Add Domain'}
        </Button>
      </div>
      {addError && (
        <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {addError}
        </p>
      )}

      {/* Instructions */}
      {domains.some(d => d.status === 'pending') && (
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-xs text-blue-800 dark:text-blue-300">
            <strong>To verify:</strong> Add a DNS TXT record with the token value, or use the quick-verify button to paste the token directly (MVP).
            Once verified, users signing up with this email domain will be routed to your organization.
          </p>
        </div>
      )}
    </Card>
  )
}
