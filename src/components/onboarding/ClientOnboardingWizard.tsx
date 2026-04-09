/**
 * ClientOnboardingWizard — Guided org setup for new client admins.
 *
 * Shown instead of the main app when org_onboarding_status.is_completed = false.
 * 5 steps: Welcome → Org Structure → Portfolios → Invite Team → Review & Launch
 *
 * Progress is saved after each step. Steps can be skipped (tracked for ops).
 * Pre-created resources (from founder provisioning) are shown as already done.
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Users, Briefcase, GitBranch, CheckCircle2, ArrowRight,
  ArrowLeft, Plus, Trash2, Mail, Shield, UserCircle, Loader2, Hexagon,
  ChevronRight, SkipForward, Rocket,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useClientOnboarding, ONBOARDING_STEPS, type OnboardingStepKey } from '../../hooks/useClientOnboarding'
import { useToast } from '../common/Toast'

// ─── Types ────────────────────────────────────────────────────

interface TeamEntry { name: string }
interface PortfolioEntry { name: string; benchmark: string; teamName: string }
interface InviteEntry { email: string; role: 'admin' | 'member' }

// ─── Component ────────────────────────────────────────────────

export function ClientOnboardingWizard() {
  const { user } = useAuth()
  const { currentOrgId, currentOrg } = useOrganization()
  const { status, completeStep, skipStep, finishOnboarding, currentStepKey } = useClientOnboarding(currentOrgId)
  const { success, error: showError } = useToast()
  const queryClient = useQueryClient()

  // Local form state
  const [teams, setTeams] = useState<TeamEntry[]>([{ name: '' }])
  const [portfolios, setPortfolios] = useState<PortfolioEntry[]>([{ name: '', benchmark: '', teamName: '' }])
  const [invites, setInvites] = useState<InviteEntry[]>([{ email: '', role: 'member' }])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const currentStep = status?.current_step || 1
  const orgName = currentOrg?.name || 'Your Organization'

  // Pre-existing data queries
  const { data: existingTeams = [] } = useQuery({
    queryKey: ['onboarding-existing-teams', currentOrgId],
    queryFn: async () => {
      const { data } = await supabase.from('org_chart_nodes').select('id, name, node_type')
        .eq('organization_id', currentOrgId!).eq('node_type', 'team')
      return data || []
    },
    enabled: !!currentOrgId,
  })

  const { data: existingPortfolios = [] } = useQuery({
    queryKey: ['onboarding-existing-portfolios', currentOrgId],
    queryFn: async () => {
      const { data } = await supabase.from('portfolios').select('id, name')
        .eq('organization_id', currentOrgId!).eq('is_active', true)
      return data || []
    },
    enabled: !!currentOrgId,
  })

  const { data: existingMembers = [] } = useQuery({
    queryKey: ['onboarding-existing-members', currentOrgId],
    queryFn: async () => {
      const { data } = await supabase.from('organization_memberships').select('user_id')
        .eq('organization_id', currentOrgId!).eq('status', 'active')
      return data || []
    },
    enabled: !!currentOrgId,
  })

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['onboarding-pending-invites', currentOrgId],
    queryFn: async () => {
      const { data } = await supabase.from('organization_invites').select('id, email, role, status')
        .eq('organization_id', currentOrgId!).in('status', ['pending', 'sent'])
      return data || []
    },
    enabled: !!currentOrgId,
  })

  // ─── Step handlers ──────────────────────────────────────────

  const handleCompleteStep = async (stepKey: OnboardingStepKey) => {
    await completeStep.mutateAsync(stepKey)
  }

  const handleSkipStep = async (stepKey: OnboardingStepKey) => {
    await skipStep.mutateAsync(stepKey)
  }

  const handleCreateTeams = async () => {
    setIsSubmitting(true)
    try {
      const validTeams = teams.filter(t => t.name.trim())
      for (const team of validTeams) {
        await supabase.from('org_chart_nodes').insert({
          organization_id: currentOrgId,
          name: team.name.trim(),
          node_type: 'team',
        })
      }
      queryClient.invalidateQueries({ queryKey: ['onboarding-existing-teams'] })
      await handleCompleteStep('org_structure')
      success(`Created ${validTeams.length} team${validTeams.length !== 1 ? 's' : ''}`)
    } catch (err: any) {
      showError(err.message || 'Failed to create teams')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreatePortfolios = async () => {
    setIsSubmitting(true)
    try {
      const validPortfolios = portfolios.filter(p => p.name.trim())
      for (const p of validPortfolios) {
        await supabase.from('portfolios').insert({
          organization_id: currentOrgId,
          name: p.name.trim(),
          benchmark_name: p.benchmark.trim() || null,
          is_active: true,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['onboarding-existing-portfolios'] })
      await handleCompleteStep('portfolios')
      success(`Created ${validPortfolios.length} portfolio${validPortfolios.length !== 1 ? 's' : ''}`)
    } catch (err: any) {
      showError(err.message || 'Failed to create portfolios')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSendInvites = async () => {
    setIsSubmitting(true)
    try {
      const validInvites = invites.filter(i => i.email.trim() && i.email.includes('@'))
      for (const inv of validInvites) {
        await supabase.rpc('create_org_invite', {
          p_organization_id: currentOrgId,
          p_email: inv.email.trim().toLowerCase(),
          p_is_org_admin: inv.role === 'admin',
        })
      }
      queryClient.invalidateQueries({ queryKey: ['onboarding-pending-invites'] })
      await handleCompleteStep('invite_team')
      success(`Invited ${validInvites.length} team member${validInvites.length !== 1 ? 's' : ''}`)
    } catch (err: any) {
      showError(err.message || 'Failed to send invites')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLaunch = async () => {
    setIsSubmitting(true)
    try {
      await finishOnboarding.mutateAsync()
      success('Welcome to Tesseract!')
    } catch (err: any) {
      showError(err.message || 'Failed to complete setup')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-indigo-50 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <Hexagon className="w-6 h-6 text-indigo-600" />
          <span className="text-lg font-bold text-gray-900 tracking-tight">Tesseract</span>
        </div>
        <span className="text-sm text-gray-500">Setting up {orgName}</span>
      </header>

      {/* Progress bar */}
      <div className="px-8 pt-6">
        <div className="max-w-2xl mx-auto flex items-center gap-1">
          {ONBOARDING_STEPS.map((step, i) => {
            const isActive = step.number === currentStep
            const isDone = (status?.steps_completed || []).includes(step.key) || (status?.steps_skipped || []).includes(step.key)
            const isPast = step.number < currentStep
            return (
              <div key={step.key} className="flex-1 flex items-center gap-1">
                <div className={clsx(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-all',
                  isDone ? 'bg-indigo-600 text-white' :
                  isActive ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-600' :
                  'bg-gray-200 text-gray-500'
                )}>
                  {isDone ? <CheckCircle2 className="w-4 h-4" /> : step.number}
                </div>
                {i < ONBOARDING_STEPS.length - 1 && (
                  <div className={clsx('flex-1 h-0.5 rounded', isDone || isPast ? 'bg-indigo-600' : 'bg-gray-200')} />
                )}
              </div>
            )
          })}
        </div>
        <div className="max-w-2xl mx-auto flex justify-between mt-1.5 px-0.5">
          {ONBOARDING_STEPS.map(step => (
            <span key={step.key} className={clsx('text-[10px] font-medium', step.number === currentStep ? 'text-indigo-700' : 'text-gray-400')}>
              {step.label}
            </span>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-start justify-center px-8 py-8">
        <div className="w-full max-w-2xl">

          {/* Step 1: Welcome */}
          {currentStep === 1 && (
            <StepCard
              title={`Welcome to Tesseract, ${user?.user_metadata?.first_name || 'there'}!`}
              subtitle={`You're setting up ${orgName}. Let's get your team ready to go.`}
            >
              <div className="space-y-4">
                <div className="bg-indigo-50 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-medium text-indigo-900">Here's what we'll set up:</p>
                  <ul className="text-sm text-indigo-700 space-y-1.5">
                    <li className="flex items-center gap-2"><GitBranch className="w-4 h-4" /> Your team structure</li>
                    <li className="flex items-center gap-2"><Briefcase className="w-4 h-4" /> Portfolios you manage</li>
                    <li className="flex items-center gap-2"><Users className="w-4 h-4" /> Invite your team members</li>
                  </ul>
                </div>
                {(existingPortfolios.length > 0 || existingTeams.length > 0) && (
                  <div className="bg-green-50 rounded-xl p-4">
                    <p className="text-sm font-medium text-green-800">Already set up for you:</p>
                    <ul className="text-sm text-green-700 mt-1 space-y-0.5">
                      {existingPortfolios.length > 0 && <li>{existingPortfolios.length} portfolio{existingPortfolios.length !== 1 ? 's' : ''}</li>}
                      {existingTeams.length > 0 && <li>{existingTeams.length} team{existingTeams.length !== 1 ? 's' : ''}</li>}
                    </ul>
                  </div>
                )}
              </div>
              <StepActions onNext={() => handleCompleteStep('welcome')} isSubmitting={completeStep.isPending} />
            </StepCard>
          )}

          {/* Step 2: Org Structure */}
          {currentStep === 2 && (
            <StepCard
              title="Build Your Team Structure"
              subtitle="Create teams that reflect how your investment team is organized. You can always add more later."
            >
              {existingTeams.length > 0 && (
                <div className="bg-green-50 rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-green-700">Existing teams: {existingTeams.map(t => t.name).join(', ')}</p>
                </div>
              )}
              <div className="space-y-2">
                {teams.map((team, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={i === 0 ? 'e.g., Equity Research' : 'Team name'}
                      value={team.name}
                      onChange={e => setTeams(prev => prev.map((t, j) => j === i ? { name: e.target.value } : t))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    {teams.length > 1 && (
                      <button onClick={() => setTeams(prev => prev.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => setTeams(prev => [...prev, { name: '' }])} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                  <Plus className="w-4 h-4" /> Add another team
                </button>
              </div>
              <StepActions
                onNext={handleCreateTeams}
                onSkip={() => handleSkipStep('org_structure')}
                isSubmitting={isSubmitting}
                nextLabel={teams.some(t => t.name.trim()) ? 'Create Teams' : undefined}
                skippable
              />
            </StepCard>
          )}

          {/* Step 3: Portfolios */}
          {currentStep === 3 && (
            <StepCard
              title="Set Up Portfolios"
              subtitle="Create the portfolios your team manages. Each portfolio tracks holdings, performance, and research."
            >
              {existingPortfolios.length > 0 && (
                <div className="bg-green-50 rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-green-700">
                    Already created: {existingPortfolios.map(p => p.name).join(', ')}
                  </p>
                </div>
              )}
              <div className="space-y-3">
                {portfolios.map((p, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        placeholder={i === 0 ? 'e.g., US Large Cap Growth' : 'Portfolio name'}
                        value={p.name}
                        onChange={e => setPortfolios(prev => prev.map((pt, j) => j === i ? { ...pt, name: e.target.value } : pt))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      <input
                        type="text"
                        placeholder="Benchmark (optional, e.g., S&P 500)"
                        value={p.benchmark}
                        onChange={e => setPortfolios(prev => prev.map((pt, j) => j === i ? { ...pt, benchmark: e.target.value } : pt))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                    {portfolios.length > 1 && (
                      <button onClick={() => setPortfolios(prev => prev.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-500 mt-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => setPortfolios(prev => [...prev, { name: '', benchmark: '', teamName: '' }])} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                  <Plus className="w-4 h-4" /> Add another portfolio
                </button>
              </div>
              <StepActions
                onNext={handleCreatePortfolios}
                onSkip={() => handleSkipStep('portfolios')}
                isSubmitting={isSubmitting}
                nextLabel={portfolios.some(p => p.name.trim()) ? 'Create Portfolios' : undefined}
                skippable={existingPortfolios.length > 0}
              />
            </StepCard>
          )}

          {/* Step 4: Invite Team */}
          {currentStep === 4 && (
            <StepCard
              title="Invite Your Team"
              subtitle="Add your analysts, PMs, and operations team. They'll receive an email to join."
            >
              {pendingInvites.length > 0 && (
                <div className="bg-blue-50 rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-blue-700">
                    Pending invites: {pendingInvites.map(i => i.email).join(', ')}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                {invites.map((inv, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="email"
                      placeholder="Email address"
                      value={inv.email}
                      onChange={e => setInvites(prev => prev.map((v, j) => j === i ? { ...v, email: e.target.value } : v))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <select
                      value={inv.role}
                      onChange={e => setInvites(prev => prev.map((v, j) => j === i ? { ...v, role: e.target.value as 'admin' | 'member' } : v))}
                      className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    {invites.length > 1 && (
                      <button onClick={() => setInvites(prev => prev.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => setInvites(prev => [...prev, { email: '', role: 'member' }])} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                  <Plus className="w-4 h-4" /> Add another
                </button>
              </div>
              <StepActions
                onNext={handleSendInvites}
                onSkip={() => handleSkipStep('invite_team')}
                isSubmitting={isSubmitting}
                nextLabel={invites.some(i => i.email.trim()) ? 'Send Invites' : undefined}
                skippable
              />
            </StepCard>
          )}

          {/* Step 5: Review & Launch */}
          {currentStep === 5 && (
            <StepCard
              title="You're All Set!"
              subtitle="Here's a summary of your organization setup."
            >
              <div className="space-y-3">
                <SummaryRow icon={Building2} label="Organization" value={orgName} />
                <SummaryRow icon={Users} label="Team Members" value={`${existingMembers.length} member${existingMembers.length !== 1 ? 's' : ''}${pendingInvites.length > 0 ? ` + ${pendingInvites.length} invited` : ''}`} />
                <SummaryRow icon={GitBranch} label="Teams" value={existingTeams.length > 0 ? existingTeams.map(t => t.name).join(', ') : 'None yet'} />
                <SummaryRow icon={Briefcase} label="Portfolios" value={existingPortfolios.length > 0 ? existingPortfolios.map(p => p.name).join(', ') : 'None yet'} />
              </div>

              {(status?.steps_skipped || []).length > 0 && (
                <div className="bg-amber-50 rounded-lg p-3 mt-4">
                  <p className="text-xs text-amber-700">
                    You skipped: {(status?.steps_skipped || []).map(s => ONBOARDING_STEPS.find(st => st.key === s)?.label).filter(Boolean).join(', ')}.
                    You can set these up anytime from the Organization settings.
                  </p>
                </div>
              )}

              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleLaunch}
                  disabled={isSubmitting}
                  className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-base flex items-center gap-2 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
                  Launch Tesseract
                </button>
              </div>
            </StepCard>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────

function StepCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function StepActions({ onNext, onSkip, isSubmitting, nextLabel, skippable }: {
  onNext: () => void
  onSkip?: () => void
  isSubmitting: boolean
  nextLabel?: string
  skippable?: boolean
}) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-6">
      <div>
        {skippable && onSkip && (
          <button onClick={onSkip} disabled={isSubmitting} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50">
            <SkipForward className="w-4 h-4" /> Skip for now
          </button>
        )}
      </div>
      <button
        onClick={onNext}
        disabled={isSubmitting}
        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
      >
        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {nextLabel || 'Continue'}
        {!isSubmitting && <ArrowRight className="w-4 h-4" />}
      </button>
    </div>
  )
}

function SummaryRow({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-indigo-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
      </div>
    </div>
  )
}
