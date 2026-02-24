/**
 * SetupWizard — Guided organization setup in 5 steps.
 *
 * Step 1: Organization details (name, slug, logo URL)
 * Step 2: Invite admins/users (email + role)
 * Step 3: Create teams + portfolios (optional quick-create)
 * Step 4: Seed defaults (research sections, roles, coverage)
 * Step 5: Review + Finish
 *
 * Idempotent: re-opening shows existing invites, teams, etc.
 * Works for first-org users and admins creating additional orgs.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useToast } from '../common/Toast'
import { Button } from '../ui/Button'
import {
  Building2,
  Users,
  Briefcase,
  Sparkles,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  X,
  Plus,
  Trash2,
  Mail,
  Shield,
  UserCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { clsx } from 'clsx'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InviteEntry {
  email: string
  role: 'admin' | 'member'
}

interface TeamEntry {
  name: string
  portfolioName: string
}

interface SetupWizardProps {
  open: boolean
  onClose: () => void
  /** If true, this is a first-org flow — hide close button */
  isFirstOrg?: boolean
  /** If true, skip the "are you sure?" confirm for additional orgs */
  isPlatformAdmin?: boolean
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  { id: 1, label: 'Organization', icon: Building2 },
  { id: 2, label: 'Invite People', icon: Mail },
  { id: 3, label: 'Teams', icon: Users },
  { id: 4, label: 'Defaults', icon: Sparkles },
  { id: 5, label: 'Review', icon: CheckCircle },
] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SetupWizard({ open, onClose, isFirstOrg = false, isPlatformAdmin = false }: SetupWizardProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { switchOrg } = useOrganization()

  // Step state
  const [step, setStep] = useState(1)

  // Step 1: Org details
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [orgDescription, setOrgDescription] = useState('')
  const [orgLogoUrl, setOrgLogoUrl] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  // Step 2: Invites
  const [invites, setInvites] = useState<InviteEntry[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')

  // Step 3: Teams
  const [teams, setTeams] = useState<TeamEntry[]>([])
  const [teamName, setTeamName] = useState('')
  const [teamPortfolioName, setTeamPortfolioName] = useState('')

  // Step 4: Seed defaults
  const [seedDefaults, setSeedDefaults] = useState(true)

  // Created org ID (after step 5 bootstrap)
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null)
  const [isFinishing, setIsFinishing] = useState(false)
  const [isFinished, setIsFinished] = useState(false)

  // Confirm modal for multi-org users (not platform admins)
  const [showConfirm, setShowConfirm] = useState(false)
  const needsConfirm = !isFirstOrg && !isPlatformAdmin

  // Auto-generate slug from name
  const handleNameChange = useCallback((name: string) => {
    setOrgName(name)
    if (!slugTouched) {
      setOrgSlug(
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50)
      )
    }
  }, [slugTouched])

  // Validation
  const step1Valid = useMemo(() => {
    return orgName.trim().length >= 2 && /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(orgSlug)
  }, [orgName, orgSlug])

  // Add invite
  const addInvite = useCallback(() => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    if (invites.some((i) => i.email === email)) {
      toast.warning('Email already added')
      return
    }
    setInvites((prev) => [...prev, { email, role: inviteRole }])
    setInviteEmail('')
  }, [inviteEmail, inviteRole, invites, toast])

  const removeInvite = useCallback((email: string) => {
    setInvites((prev) => prev.filter((i) => i.email !== email))
  }, [])

  // Add team
  const addTeam = useCallback(() => {
    const name = teamName.trim()
    if (!name) return
    if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      toast.warning('Team already added')
      return
    }
    setTeams((prev) => [...prev, { name, portfolioName: teamPortfolioName.trim() }])
    setTeamName('')
    setTeamPortfolioName('')
  }, [teamName, teamPortfolioName, teams, toast])

  const removeTeam = useCallback((name: string) => {
    setTeams((prev) => prev.filter((t) => t.name !== name))
  }, [])

  // Bootstrap mutation
  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      // 1. Create org via RPC
      const { data, error } = await supabase.rpc('bootstrap_organization', {
        p_name: orgName.trim(),
        p_slug: orgSlug.trim(),
        p_description: orgDescription.trim() || null,
        p_logo_url: orgLogoUrl.trim() || null,
        p_seed_defaults: seedDefaults,
      })
      if (error) throw error
      const result = data as { organization_id: string; default_team_id?: string }
      return result
    },
  })

  // Finish handler
  const handleFinish = useCallback(async () => {
    setIsFinishing(true)
    try {
      // 1. Bootstrap org
      const result = await bootstrapMutation.mutateAsync()
      const orgId = result.organization_id
      setCreatedOrgId(orgId)

      // 2. Create additional teams + portfolios
      for (const team of teams) {
        const slug = team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        const { data: teamData, error: teamErr } = await supabase
          .from('teams')
          .insert({
            organization_id: orgId,
            name: team.name,
            slug: `${orgSlug}-${slug}`,
            color: '#6366f1',
            icon: 'users',
          })
          .select('id')
          .single()
        if (teamErr) {
          console.error('Team creation error:', teamErr)
          continue
        }

        // Add creator to team
        const { data: { user } } = await supabase.auth.getUser()
        if (user && teamData) {
          await supabase.from('team_memberships').insert({
            team_id: teamData.id,
            user_id: user.id,
            is_team_admin: true,
          })

          // Create portfolio if specified
          if (team.portfolioName) {
            const { data: portfolioData } = await supabase
              .from('portfolios')
              .insert({
                name: team.portfolioName,
                team_id: teamData.id,
                portfolio_type: 'equity',
              })
              .select('id')
              .single()

            if (portfolioData) {
              await supabase.from('portfolio_memberships').insert({
                portfolio_id: portfolioData.id,
                user_id: user.id,
                is_portfolio_manager: true,
              })
            }
          }
        }
      }

      // 3. Send invites (with role propagation)
      for (const invite of invites) {
        try {
          await supabase.rpc('create_org_invite', {
            p_organization_id: orgId,
            p_email: invite.email,
            p_is_org_admin: invite.role === 'admin',
          })
        } catch (err) {
          console.error('Invite error:', err)
        }
      }

      // 4. Switch into the new org
      await switchOrg(orgId)

      // Invalidate everything
      queryClient.invalidateQueries()

      setIsFinished(true)
      toast.success(`${orgName} is ready!`)
    } catch (err: any) {
      console.error('Setup error:', err)
      toast.error(err.message || 'Failed to create organization')
    } finally {
      setIsFinishing(false)
    }
  }, [bootstrapMutation, teams, invites, orgSlug, orgName, switchOrg, queryClient, toast])

  // Wrapper: show confirm modal if user has existing orgs (unless platform admin)
  const handleFinishOrConfirm = useCallback(() => {
    if (needsConfirm) {
      setShowConfirm(true)
    } else {
      handleFinish()
    }
  }, [needsConfirm, handleFinish])

  // Switch into org + close + reload
  const handleSwitchAndClose = useCallback(() => {
    onClose()
    window.location.reload()
  }, [onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {isFinished ? 'Setup Complete' : 'New Organization'}
              </h2>
              <p className="text-xs text-gray-500">
                {isFinished ? 'Your organization is ready' : `Step ${step} of 5`}
              </p>
            </div>
          </div>
          {!isFirstOrg && !isFinishing && (
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          )}
        </div>

        {/* Step indicator */}
        {!isFinished && (
          <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 dark:border-gray-800">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              const isActive = s.id === step
              const isDone = s.id < step
              return (
                <React.Fragment key={s.id}>
                  {i > 0 && (
                    <div className={clsx('flex-1 h-px', isDone ? 'bg-indigo-400' : 'bg-gray-200 dark:bg-gray-700')} />
                  )}
                  <div
                    className={clsx(
                      'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                      isActive && 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
                      isDone && 'text-indigo-500',
                      !isActive && !isDone && 'text-gray-400'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{s.label}</span>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isFinished ? (
            <FinishedView orgName={orgName} inviteCount={invites.length} teamCount={teams.length} seedDefaults={seedDefaults} onSwitch={handleSwitchAndClose} />
          ) : step === 1 ? (
            <Step1OrgDetails
              orgName={orgName} orgSlug={orgSlug} orgDescription={orgDescription} orgLogoUrl={orgLogoUrl}
              onNameChange={handleNameChange}
              onSlugChange={(s) => { setSlugTouched(true); setOrgSlug(s) }}
              onDescriptionChange={setOrgDescription}
              onLogoUrlChange={setOrgLogoUrl}
            />
          ) : step === 2 ? (
            <Step2Invites
              invites={invites} inviteEmail={inviteEmail} inviteRole={inviteRole}
              onEmailChange={setInviteEmail} onRoleChange={setInviteRole}
              onAdd={addInvite} onRemove={removeInvite}
            />
          ) : step === 3 ? (
            <Step3Teams
              teams={teams} teamName={teamName} teamPortfolioName={teamPortfolioName}
              onTeamNameChange={setTeamName} onPortfolioNameChange={setTeamPortfolioName}
              onAdd={addTeam} onRemove={removeTeam}
            />
          ) : step === 4 ? (
            <Step4Defaults seedDefaults={seedDefaults} onToggle={setSeedDefaults} />
          ) : (
            <Step5Review
              orgName={orgName} orgSlug={orgSlug} orgDescription={orgDescription}
              invites={invites} teams={teams} seedDefaults={seedDefaults}
              isAdditionalOrg={!isFirstOrg}
            />
          )}
        </div>

        {/* Footer */}
        {!isFinished && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <div>
              {step > 1 && (
                <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={isFinishing}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {step < 5 ? (
                <Button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={step === 1 && !step1Valid}
                >
                  {step === 2 || step === 3 ? 'Skip' : 'Next'} <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleFinishOrConfirm} disabled={isFinishing || !step1Valid}>
                  {isFinishing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Creating...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-1" /> Create new organization
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirm modal for multi-org users */}
      {showConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Create additional organization?</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              You already belong to an organization. Creating a new one will set up a separate workspace with
              its own teams, portfolios, and data. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
              <Button onClick={() => { setShowConfirm(false); handleFinish() }}>
                Yes, create organization
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1: Organization Details
// ---------------------------------------------------------------------------

function Step1OrgDetails({
  orgName, orgSlug, orgDescription, orgLogoUrl,
  onNameChange, onSlugChange, onDescriptionChange, onLogoUrlChange,
}: {
  orgName: string; orgSlug: string; orgDescription: string; orgLogoUrl: string
  onNameChange: (v: string) => void; onSlugChange: (v: string) => void
  onDescriptionChange: (v: string) => void; onLogoUrlChange: (v: string) => void
}) {
  const slugValid = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(orgSlug)

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Organization Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={orgName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Acme Capital Management"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Slug <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={orgSlug}
            onChange={(e) => onSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="acme-capital"
            className={clsx(
              'w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
              orgSlug && !slugValid ? 'border-red-300' : 'border-gray-300 dark:border-gray-600'
            )}
          />
        </div>
        {orgSlug && !slugValid && (
          <p className="text-xs text-red-500 mt-1">3-50 chars: lowercase letters, numbers, hyphens</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
        <textarea
          value={orgDescription}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Brief description of your organization..."
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Logo URL</label>
        <input
          type="text"
          value={orgLogoUrl}
          onChange={(e) => onLogoUrlChange(e.target.value)}
          placeholder="https://example.com/logo.png"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2: Invite People
// ---------------------------------------------------------------------------

function Step2Invites({
  invites, inviteEmail, inviteRole,
  onEmailChange, onRoleChange, onAdd, onRemove,
}: {
  invites: InviteEntry[]; inviteEmail: string; inviteRole: 'admin' | 'member'
  onEmailChange: (v: string) => void; onRoleChange: (v: 'admin' | 'member') => void
  onAdd: () => void; onRemove: (email: string) => void
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Invite colleagues to join your organization. You can always add more later.
      </p>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => onEmailChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAdd()}
            placeholder="colleague@firm.com"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <div className="w-32">
          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <select
            value={inviteRole}
            onChange={(e) => onRoleChange(e.target.value as 'admin' | 'member')}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button size="sm" onClick={onAdd} disabled={!inviteEmail.trim()}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {invites.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
          {invites.map((inv) => (
            <div key={inv.email} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <UserCircle className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-800 dark:text-gray-200">{inv.email}</span>
                <span className={clsx(
                  'px-1.5 py-0.5 text-[10px] rounded font-medium',
                  inv.role === 'admin' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'
                )}>
                  {inv.role}
                </span>
              </div>
              <button onClick={() => onRemove(inv.email)} className="p-1 hover:bg-gray-100 rounded">
                <Trash2 className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {invites.length === 0 && (
        <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <Mail className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No invites yet. You can skip this step.</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3: Teams & Portfolios
// ---------------------------------------------------------------------------

function Step3Teams({
  teams, teamName, teamPortfolioName,
  onTeamNameChange, onPortfolioNameChange, onAdd, onRemove,
}: {
  teams: TeamEntry[]; teamName: string; teamPortfolioName: string
  onTeamNameChange: (v: string) => void; onPortfolioNameChange: (v: string) => void
  onAdd: () => void; onRemove: (name: string) => void
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Create teams and optionally a portfolio for each. A default "General" team is always created.
      </p>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Team Name</label>
          <input
            type="text"
            value={teamName}
            onChange={(e) => onTeamNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAdd()}
            placeholder="Equity Research"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Portfolio (optional)</label>
          <input
            type="text"
            value={teamPortfolioName}
            onChange={(e) => onPortfolioNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAdd()}
            placeholder="US Large Cap"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <Button size="sm" onClick={onAdd} disabled={!teamName.trim()}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {teams.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
          {teams.map((t) => (
            <div key={t.name} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{t.name}</span>
                {t.portfolioName && (
                  <>
                    <span className="text-gray-300">/</span>
                    <Briefcase className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">{t.portfolioName}</span>
                  </>
                )}
              </div>
              <button onClick={() => onRemove(t.name)} className="p-1 hover:bg-gray-100 rounded">
                <Trash2 className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {teams.length === 0 && (
        <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            No additional teams. A "General" team will be created automatically.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4: Seed Defaults
// ---------------------------------------------------------------------------

function Step4Defaults({
  seedDefaults,
  onToggle,
}: {
  seedDefaults: boolean
  onToggle: (v: boolean) => void
}) {
  const items = [
    { label: 'Research sections', desc: 'Investment Thesis, Key Risks, Catalysts, Valuation, Management & Governance' },
    { label: 'Coverage roles', desc: 'Lead Analyst, Backup Analyst, PM Oversight' },
    { label: 'User role definitions', desc: 'Portfolio Manager, Research Analyst, Trader, Operations' },
  ]

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Optionally seed starter templates to get your team productive faster.
      </p>

      <label className="flex items-start gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
        <input
          type="checkbox"
          checked={seedDefaults}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <div>
          <span className="text-sm font-medium text-gray-900 dark:text-white">Seed default configuration</span>
          <p className="text-xs text-gray-500 mt-0.5">Creates a starter set of research sections, coverage roles, and user role definitions</p>
        </div>
      </label>

      {seedDefaults && (
        <div className="space-y-2 ml-1">
          {items.map((item) => (
            <div key={item.label} className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{item.label}</span>
                <p className="text-xs text-gray-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 5: Review
// ---------------------------------------------------------------------------

function Step5Review({
  orgName, orgSlug, orgDescription,
  invites, teams, seedDefaults, isAdditionalOrg,
}: {
  orgName: string; orgSlug: string; orgDescription: string
  invites: InviteEntry[]; teams: TeamEntry[]; seedDefaults: boolean
  isAdditionalOrg?: boolean
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">Review your setup before creating the organization.</p>

      {isAdditionalOrg && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            This will create a new, separate organization. Data is not shared between organizations.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {/* Org */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Organization</h4>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{orgName}</p>
              <p className="text-xs text-gray-500">/{orgSlug}</p>
              {orgDescription && <p className="text-xs text-gray-500 mt-0.5">{orgDescription}</p>}
            </div>
          </div>
        </div>

        {/* Invites */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Invites ({invites.length})
          </h4>
          {invites.length > 0 ? (
            <div className="space-y-1">
              {invites.map((i) => (
                <div key={i.email} className="flex items-center gap-2 text-sm">
                  <Mail className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-gray-700 dark:text-gray-300">{i.email}</span>
                  <span className={clsx(
                    'px-1.5 py-0.5 text-[10px] rounded font-medium',
                    i.role === 'admin' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'
                  )}>
                    {i.role}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">No invites — you can add people later</p>
          )}
        </div>

        {/* Teams */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Teams ({teams.length + 1})
          </h4>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Users className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-gray-700 dark:text-gray-300">General</span>
              <span className="text-[10px] text-gray-400">(default)</span>
            </div>
            {teams.map((t) => (
              <div key={t.name} className="flex items-center gap-2 text-sm">
                <Users className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-gray-700 dark:text-gray-300">{t.name}</span>
                {t.portfolioName && (
                  <>
                    <span className="text-gray-300">/</span>
                    <Briefcase className="w-3 h-3 text-emerald-500" />
                    <span className="text-gray-600 dark:text-gray-400">{t.portfolioName}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Defaults */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Defaults</h4>
          <div className="flex items-center gap-2 text-sm">
            {seedDefaults ? (
              <>
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-gray-700 dark:text-gray-300">Seed starter templates enabled</span>
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 text-gray-400" />
                <span className="text-gray-500">No default seeding — blank slate</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Finished View
// ---------------------------------------------------------------------------

function FinishedView({
  orgName, inviteCount, teamCount, seedDefaults, onSwitch,
}: {
  orgName: string; inviteCount: number; teamCount: number; seedDefaults: boolean
  onSwitch: () => void
}) {
  return (
    <div className="text-center py-8 space-y-6">
      <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
        <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
      </div>

      <div>
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{orgName} is ready!</h3>
        <p className="text-sm text-gray-500 mt-1">Your organization has been created successfully.</p>
      </div>

      <div className="flex justify-center gap-6 text-sm text-gray-600">
        {inviteCount > 0 && (
          <div className="flex items-center gap-1">
            <Mail className="w-4 h-4 text-indigo-500" />
            {inviteCount} invite{inviteCount !== 1 ? 's' : ''} sent
          </div>
        )}
        <div className="flex items-center gap-1">
          <Users className="w-4 h-4 text-blue-500" />
          {teamCount + 1} team{teamCount !== 0 ? 's' : ''}
        </div>
        {seedDefaults && (
          <div className="flex items-center gap-1">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Defaults seeded
          </div>
        )}
      </div>

      <Button onClick={onSwitch} size="lg">
        Enter {orgName} <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  )
}
