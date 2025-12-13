import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import {
  User,
  Building2,
  Briefcase,
  Shield,
  TrendingUp,
  Database,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  SkipForward,
  X,
  Check,
  AlertCircle,
  Globe,
  BarChart3,
  Clock,
  Target,
  FileText,
  Settings,
  Layers,
  Users,
  FolderTree,
  Plus,
  Minus,
  UserCircle
} from 'lucide-react'
import { clsx } from 'clsx'

// Types
interface OnboardingStatus {
  id: string
  user_id: string
  wizard_completed: boolean
  current_step: number
  steps_completed: string[]
  skipped_steps: string[]
  started_at: string
  completed_at: string | null
  last_updated_at: string
}

interface UserProfileExtended {
  id?: string
  user_id: string
  title: string
  user_type: 'investor' | 'operations' | 'compliance' | null
  // Investor fields
  investment_style: string[]
  time_horizon: string[]
  market_cap_focus: string[]
  geography_focus: string[]
  sector_focus: string[]
  asset_class_focus: string[]
  universe_scope: 'broad' | 'specific' | null
  specific_tickers: string[]
  strategy_description: string
  investment_focus_summary: string
  // Operations fields
  ops_departments: string[]
  ops_workflow_types: string[]
  ops_role_description: string
  // Compliance fields
  compliance_areas: string[]
  compliance_divisions: string[]
  compliance_role_description: string
  // Data integrations
  market_data_provider: 'factset' | 'bloomberg' | 'capiq' | 'refinitiv' | 'other' | 'none' | null
  market_data_provider_other: string
  needs_realtime_prices: boolean
  needs_index_data: boolean
  needs_fundamentals: boolean
  needs_estimates: boolean
  needs_news_feeds: boolean
  integration_notes: string
}

interface TeamAccessRequest {
  id?: string
  request_type: 'team' | 'portfolio' | 'division' | 'department'
  target_id: string
  target_name: string
  requested_role: string
  reason: string
  status: 'pending' | 'approved' | 'denied' | 'cancelled'
}

interface OrgNode {
  id: string
  name: string
  node_type: 'division' | 'department' | 'team' | 'portfolio'
  parent_id: string | null
  children?: OrgNode[]
}

interface OrgNodeMember {
  node_id: string
  user_id: string
  role: string
  first_name: string | null
  last_name: string | null
  email: string
}

interface SetupWizardProps {
  onComplete: () => void
  onSkip?: () => void
  isModal?: boolean
}

const STEPS = [
  { id: 'profile', label: 'Profile', icon: User, description: 'Confirm your details' },
  { id: 'teams', label: 'Teams & Access', icon: Users, description: 'Request team access' },
  { id: 'role-specific', label: 'Your Focus', icon: Target, description: 'Tell us about your work' },
  { id: 'integrations', label: 'Data & Tools', icon: Database, description: 'Connect your tools' },
  { id: 'review', label: 'Review', icon: CheckCircle, description: 'Confirm and finish' },
]

// Investment style options
const INVESTMENT_STYLES = [
  { id: 'fundamental', label: 'Fundamental', description: 'Company analysis, financials, valuation' },
  { id: 'quantitative', label: 'Quantitative', description: 'Data-driven, algorithmic strategies' },
  { id: 'technical', label: 'Technical', description: 'Chart patterns, price action' },
  { id: 'macro', label: 'Macro', description: 'Economic trends, global themes' },
]

const TIME_HORIZONS = [
  { id: 'all', label: 'All Horizons', description: 'No time horizon restrictions' },
  { id: 'short_term', label: 'Short-term', description: 'Days to weeks' },
  { id: 'medium_term', label: 'Medium-term', description: 'Months to 1 year' },
  { id: 'long_term', label: 'Long-term', description: '1 - 3 years' },
  { id: 'very_long_term', label: 'Very Long-term', description: '3+ years' },
  { id: 'custom', label: 'Custom', description: 'Define your own horizon' },
]

const MARKET_CAP_OPTIONS = [
  { id: 'all_cap', label: 'All Cap', description: 'No market cap restrictions' },
  { id: 'large', label: 'Large Cap', description: '$75B+' },
  { id: 'mid', label: 'Mid Cap', description: '$10B - $75B' },
  { id: 'small', label: 'Small Cap', description: '$300M - $10B' },
  { id: 'micro', label: 'Micro Cap', description: '<$300M' },
  { id: 'custom', label: 'Custom', description: 'Define your own range' },
]

const GEOGRAPHY_OPTIONS = [
  { id: 'us', label: 'United States', description: 'US equities' },
  { id: 'international', label: 'International Developed', description: 'Europe, Japan, etc.' },
  { id: 'emerging_markets', label: 'Emerging Markets', description: 'China, India, Brazil, etc.' },
  { id: 'global', label: 'Global', description: 'All markets' },
]

const SECTOR_OPTIONS = [
  'Technology', 'Healthcare', 'Financials', 'Consumer Discretionary', 'Consumer Staples',
  'Industrials', 'Energy', 'Materials', 'Utilities', 'Real Estate', 'Communication Services'
]

const ASSET_CLASS_OPTIONS = [
  { id: 'equities', label: 'Equities', description: 'Stocks' },
  { id: 'fixed_income', label: 'Fixed Income', description: 'Bonds' },
  { id: 'alternatives', label: 'Alternatives', description: 'PE, hedge funds, etc.' },
  { id: 'multi_asset', label: 'Multi-Asset', description: 'Cross-asset strategies' },
]

const OPS_WORKFLOW_TYPES = [
  { id: 'approvals', label: 'Approvals', description: 'Trade/expense approvals' },
  { id: 'reporting', label: 'Reporting', description: 'Performance, regulatory' },
  { id: 'reconciliation', label: 'Reconciliation', description: 'Position/cash reconciliation' },
  { id: 'settlement', label: 'Settlement', description: 'Trade settlement' },
  { id: 'onboarding', label: 'Onboarding', description: 'Client/account onboarding' },
]

const COMPLIANCE_AREAS = [
  { id: 'trading', label: 'Trading Compliance', description: 'Pre/post-trade checks' },
  { id: 'reporting', label: 'Regulatory Reporting', description: 'SEC, FINRA filings' },
  { id: 'risk', label: 'Risk Management', description: 'Exposure monitoring' },
  { id: 'aml_kyc', label: 'AML/KYC', description: 'Anti-money laundering' },
  { id: 'policies', label: 'Policy Management', description: 'Internal policies' },
]

// TODO: Replace placeholder icons with actual company logos
const MARKET_DATA_PROVIDERS = [
  { id: 'bloomberg', label: 'Bloomberg' },
  { id: 'factset', label: 'FactSet' },
  { id: 'capiq', label: 'Capital IQ' },
  { id: 'refinitiv', label: 'Refinitiv' },
  { id: 'other', label: 'Other' },
  { id: 'none', label: 'None / Not Sure' },
]

export function SetupWizard({ onComplete, onSkip, isModal = false }: SetupWizardProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [currentStep, setCurrentStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form state
  const [profile, setProfile] = useState<UserProfileExtended>({
    user_id: user?.id || '',
    title: '',
    user_type: null,
    investment_style: [],
    time_horizon: [],
    market_cap_focus: [],
    geography_focus: [],
    sector_focus: [],
    asset_class_focus: [],
    universe_scope: null,
    specific_tickers: [],
    strategy_description: '',
    investment_focus_summary: '',
    ops_departments: [],
    ops_workflow_types: [],
    ops_role_description: '',
    compliance_areas: [],
    compliance_divisions: [],
    compliance_role_description: '',
    market_data_provider: null,
    market_data_provider_other: '',
    needs_realtime_prices: false,
    needs_index_data: false,
    needs_fundamentals: false,
    needs_estimates: false,
    needs_news_feeds: false,
    integration_notes: '',
  })

  const [accessRequests, setAccessRequests] = useState<TeamAccessRequest[]>([])
  const [skippedSteps, setSkippedSteps] = useState<string[]>([])

  // Fetch existing onboarding status
  const { data: onboardingStatus } = useQuery({
    queryKey: ['onboarding-status', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      const { data, error } = await supabase
        .from('user_onboarding_status')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data as OnboardingStatus | null
    },
    enabled: !!user?.id,
  })

  // Fetch existing profile
  const { data: existingProfile } = useQuery({
    queryKey: ['user-profile-extended', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      const { data, error } = await supabase
        .from('user_profile_extended')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data as UserProfileExtended | null
    },
    enabled: !!user?.id,
  })

  // Fetch org structure for team selection
  const { data: orgNodes } = useQuery({
    queryKey: ['org-nodes-for-wizard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .eq('is_active', true)
        .order('sort_order')

      if (error) throw error
      return data as OrgNode[]
    },
  })

  // Fetch portfolios
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-for-wizard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')

      if (error) throw error
      return data || []
    },
  })

  // Fetch org node members for hierarchy display
  const { data: orgNodeMembers } = useQuery({
    queryKey: ['org-node-members-for-wizard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .select(`
          node_id,
          user_id,
          role,
          users!inner(first_name, last_name, email)
        `)

      if (error) throw error
      // Flatten the response
      return (data || []).map((m: any) => ({
        node_id: m.node_id,
        user_id: m.user_id,
        role: m.role,
        first_name: m.users?.first_name,
        last_name: m.users?.last_name,
        email: m.users?.email,
      })) as OrgNodeMember[]
    },
  })

  // Fetch existing access requests
  const { data: existingRequests } = useQuery({
    queryKey: ['team-access-requests', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('team_access_requests')
        .select('*')
        .eq('user_id', user.id)

      if (error) throw error
      return data as TeamAccessRequest[]
    },
    enabled: !!user?.id,
  })

  // Track if we've initialized from existing data
  const [initialized, setInitialized] = useState(false)

  // Initialize form with existing data (only once on initial load)
  useEffect(() => {
    if (initialized) return

    if (existingProfile) {
      setProfile(prev => ({ ...prev, ...existingProfile }))
    }
    if (existingRequests) {
      setAccessRequests(existingRequests.filter(r => r.status === 'pending'))
    }
    if (onboardingStatus) {
      setCurrentStep(Math.max(0, (onboardingStatus.current_step || 1) - 1))
      setSkippedSteps(onboardingStatus.skipped_steps || [])
    }

    // Mark as initialized once we have tried to load data
    if (existingProfile !== undefined || existingRequests !== undefined || onboardingStatus !== undefined) {
      setInitialized(true)
    }
  }, [existingProfile, existingRequests, onboardingStatus, initialized])

  // Save progress mutation
  const saveProgressMutation = useMutation({
    mutationFn: async (stepId: string) => {
      if (!user?.id) throw new Error('No user')

      // Update onboarding status
      const { error: statusError } = await supabase
        .from('user_onboarding_status')
        .upsert({
          user_id: user.id,
          wizard_completed: false,
          current_step: currentStep + 2, // +2 because we're moving to the next step (0-indexed + 1 for next + 1 for 1-indexed db)
          steps_completed: [...new Set([...(onboardingStatus?.steps_completed || []), stepId])],
          skipped_steps: skippedSteps,
        }, { onConflict: 'user_id' })

      if (statusError) {
        console.error('Error saving onboarding status:', statusError)
        throw statusError
      }

      // Save profile data
      const { error: profileError } = await supabase
        .from('user_profile_extended')
        .upsert({
          user_id: user.id,
          title: profile.title || null,
          user_type: profile.user_type,
          investment_style: profile.investment_style || [],
          time_horizon: profile.time_horizon || [],
          market_cap_focus: profile.market_cap_focus || [],
          geography_focus: profile.geography_focus || [],
          sector_focus: profile.sector_focus || [],
          asset_class_focus: profile.asset_class_focus || [],
          universe_scope: profile.universe_scope || null,
          specific_tickers: profile.specific_tickers || [],
          strategy_description: profile.strategy_description || null,
          investment_focus_summary: profile.investment_focus_summary || null,
          ops_departments: profile.ops_departments || [],
          ops_workflow_types: profile.ops_workflow_types || [],
          ops_role_description: profile.ops_role_description || null,
          compliance_areas: profile.compliance_areas || [],
          compliance_divisions: profile.compliance_divisions || [],
          compliance_role_description: profile.compliance_role_description || null,
          market_data_provider: profile.market_data_provider || null,
          market_data_provider_other: profile.market_data_provider_other || null,
          needs_realtime_prices: profile.needs_realtime_prices || false,
          needs_index_data: profile.needs_index_data || false,
          needs_fundamentals: profile.needs_fundamentals || false,
          needs_estimates: profile.needs_estimates || false,
          needs_news_feeds: profile.needs_news_feeds || false,
          integration_notes: profile.integration_notes || null,
        }, { onConflict: 'user_id' })

      if (profileError) {
        console.error('Error saving profile:', profileError)
        throw profileError
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      queryClient.invalidateQueries({ queryKey: ['user-profile-extended'] })
    },
  })

  // Submit access requests mutation
  const submitAccessRequestsMutation = useMutation({
    mutationFn: async (requests: TeamAccessRequest[]) => {
      if (!user?.id) throw new Error('No user')

      for (const request of requests) {
        if (!request.id) {
          const { error } = await supabase
            .from('team_access_requests')
            .insert({
              user_id: user.id,
              request_type: request.request_type,
              target_id: request.target_id,
              target_name: request.target_name,
              requested_role: request.requested_role || 'member',
              reason: request.reason || '',
              status: 'pending',
            })

          if (error && !error.message.includes('duplicate')) throw error
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-access-requests'] })
    },
  })

  // Complete wizard mutation
  const completeWizardMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('No user')

      // Mark wizard as completed
      const { error } = await supabase
        .from('user_onboarding_status')
        .upsert({
          user_id: user.id,
          wizard_completed: true,
          completed_at: new Date().toISOString(),
          current_step: STEPS.length,
          steps_completed: STEPS.map(s => s.id),
          skipped_steps: skippedSteps,
        }, { onConflict: 'user_id' })

      if (error) throw error

      // Also update the user's user_type in the main users table
      // Note: DB constraint requires capitalized values (Investor, Operations, Compliance)
      if (profile.user_type) {
        const capitalizedType = profile.user_type.charAt(0).toUpperCase() + profile.user_type.slice(1)
        await supabase
          .from('users')
          .update({ user_type: capitalizedType })
          .eq('id', user.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      onComplete()
    },
  })

  const handleNext = async () => {
    const stepId = STEPS[currentStep].id

    try {
      await saveProgressMutation.mutateAsync(stepId)

      if (stepId === 'teams' && accessRequests.length > 0) {
        await submitAccessRequestsMutation.mutateAsync(accessRequests)
      }
    } catch (error) {
      console.error('Error saving progress:', error)
      // Still advance even if save fails - we don't want to block the user
    }

    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSkip = () => {
    const stepId = STEPS[currentStep].id
    setSkippedSteps(prev => [...new Set([...prev, stepId])])
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleComplete = async () => {
    console.log('handleComplete called')
    setIsSubmitting(true)
    try {
      console.log('Saving progress...')
      await saveProgressMutation.mutateAsync(STEPS[currentStep].id)
      console.log('Progress saved')
      if (accessRequests.length > 0) {
        console.log('Submitting access requests...')
        await submitAccessRequestsMutation.mutateAsync(accessRequests)
        console.log('Access requests submitted')
      }
      console.log('Completing wizard...')
      await completeWizardMutation.mutateAsync()
      console.log('Wizard completed, calling onComplete')
      // Navigate away after successful completion
      onComplete()
    } catch (error) {
      console.error('Error completing wizard:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleArrayItem = (array: string[], item: string, setter: (val: string[]) => void) => {
    if (array.includes(item)) {
      setter(array.filter(i => i !== item))
    } else {
      setter([...array, item])
    }
  }

  const addAccessRequest = (type: 'team' | 'portfolio' | 'division' | 'department', id: string, name: string) => {
    if (!accessRequests.find(r => r.target_id === id)) {
      setAccessRequests([...accessRequests, {
        request_type: type,
        target_id: id,
        target_name: name,
        requested_role: 'member',
        reason: '',
        status: 'pending',
      }])
    }
  }

  const removeAccessRequest = (targetId: string) => {
    setAccessRequests(accessRequests.filter(r => r.target_id !== targetId))
  }

  // Render step content
  const renderStepContent = () => {
    switch (STEPS[currentStep].id) {
      case 'profile':
        return <ProfileStep profile={profile} setProfile={setProfile} user={user} />
      case 'teams':
        return (
          <TeamsStep
            orgNodes={orgNodes || []}
            portfolios={portfolios || []}
            orgNodeMembers={orgNodeMembers || []}
            accessRequests={accessRequests}
            existingRequests={existingRequests || []}
            addAccessRequest={addAccessRequest}
            removeAccessRequest={removeAccessRequest}
          />
        )
      case 'role-specific':
        return (
          <RoleSpecificStep
            profile={profile}
            setProfile={setProfile}
            toggleArrayItem={toggleArrayItem}
          />
        )
      case 'integrations':
        return <IntegrationsStep profile={profile} setProfile={setProfile} />
      case 'review':
        return (
          <ReviewStep
            profile={profile}
            accessRequests={accessRequests}
            skippedSteps={skippedSteps}
          />
        )
      default:
        return null
    }
  }

  const canProceed = () => {
    switch (STEPS[currentStep].id) {
      case 'profile':
        return profile.user_type !== null
      default:
        return true
    }
  }

  return (
    <div className={clsx(
      'flex flex-col',
      isModal ? 'h-full' : 'min-h-screen bg-gray-50'
    )}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Welcome to Tesseract</h1>
              <p className="text-gray-600">Let's get you set up in just a few steps</p>
            </div>
            {onSkip && (
              <Button variant="ghost" onClick={onSkip}>
                <X className="h-4 w-4 mr-2" />
                Exit Setup
              </Button>
            )}
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => {
              const Icon = step.icon
              const isActive = index === currentStep
              const isCompleted = index < currentStep || (onboardingStatus?.steps_completed || []).includes(step.id)
              const isSkipped = skippedSteps.includes(step.id)

              return (
                <div key={step.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={clsx(
                        'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
                        isActive && 'bg-primary-600 text-white',
                        isCompleted && !isActive && 'bg-green-500 text-white',
                        isSkipped && !isActive && 'bg-gray-300 text-gray-500',
                        !isActive && !isCompleted && !isSkipped && 'bg-gray-200 text-gray-500'
                      )}
                    >
                      {isCompleted && !isActive ? (
                        <Check className="h-5 w-5" />
                      ) : isSkipped && !isActive ? (
                        <SkipForward className="h-4 w-4" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </div>
                    <span className={clsx(
                      'text-xs mt-1 font-medium',
                      isActive ? 'text-primary-600' : 'text-gray-500'
                    )}>
                      {step.label}
                    </span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <div className={clsx(
                      'flex-1 h-0.5 mx-2',
                      index < currentStep ? 'bg-green-500' : 'bg-gray-200'
                    )} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-8">
        <div className="max-w-4xl mx-auto px-6">
          {renderStepContent()}
        </div>
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <div className="flex items-center gap-3">
            {currentStep < STEPS.length - 1 && STEPS[currentStep].id !== 'profile' && (
              <Button variant="ghost" onClick={handleSkip}>
                <SkipForward className="h-4 w-4 mr-2" />
                Skip for now
              </Button>
            )}

            {currentStep < STEPS.length - 1 ? (
              <Button
                onClick={handleNext}
                disabled={!canProceed() || saveProgressMutation.isPending}
                loading={saveProgressMutation.isPending}
              >
                Continue
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={isSubmitting}
                loading={isSubmitting}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Complete Setup
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Step Components

function ProfileStep({ profile, setProfile, user }: {
  profile: UserProfileExtended
  setProfile: React.Dispatch<React.SetStateAction<UserProfileExtended>>
  user: any
}) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <User className="h-10 w-10 text-primary-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Confirm Your Profile</h2>
        <p className="text-gray-600 mt-1">Let's make sure we have your details right</p>
      </div>

      <Card className="max-w-xl mx-auto">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
                {user?.first_name || '—'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
                {user?.last_name || '—'}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
              {user?.email || '—'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title (Optional)</label>
            <input
              type="text"
              value={profile.title}
              onChange={(e) => setProfile(prev => ({ ...prev, title: e.target.value }))}
              placeholder="e.g., Senior Analyst, Portfolio Manager"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              What best describes your role? <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'investor', label: 'Investor', icon: TrendingUp, description: 'Portfolio management, research, trading' },
                { id: 'operations', label: 'Operations', icon: Settings, description: 'Back office, settlements, reporting' },
                { id: 'compliance', label: 'Compliance', icon: Shield, description: 'Risk, regulatory, legal' },
              ].map((role) => {
                const Icon = role.icon
                const isSelected = profile.user_type === role.id
                return (
                  <button
                    key={role.id}
                    onClick={() => setProfile(prev => ({ ...prev, user_type: role.id as any }))}
                    className={clsx(
                      'p-4 rounded-lg border-2 text-left transition-all',
                      isSelected
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <Icon className={clsx('h-6 w-6 mb-2', isSelected ? 'text-primary-600' : 'text-gray-400')} />
                    <div className={clsx('font-medium', isSelected ? 'text-primary-900' : 'text-gray-900')}>
                      {role.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{role.description}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

// Helper component for rendering a single org node with its members
function OrgNodeItem({
  node,
  members,
  isExpanded,
  onToggle,
  isSelected,
  existingRequest,
  onAdd,
  onRemove,
  children,
  depth = 0
}: {
  node: OrgNode
  members: OrgNodeMember[]
  isExpanded: boolean
  onToggle: () => void
  isSelected: boolean
  existingRequest?: TeamAccessRequest
  onAdd: () => void
  onRemove: () => void
  children?: React.ReactNode
  depth?: number
}) {
  const hasChildren = React.Children.count(children) > 0
  const nodeMembers = members.filter(m => m.node_id === node.id)

  const getNodeIcon = () => {
    switch (node.node_type) {
      case 'division': return <Building2 className="h-4 w-4" />
      case 'department': return <Layers className="h-4 w-4" />
      case 'team': return <Users className="h-4 w-4" />
      case 'portfolio': return <Briefcase className="h-4 w-4" />
      default: return <FolderTree className="h-4 w-4" />
    }
  }

  const getNodeTypeLabel = () => {
    switch (node.node_type) {
      case 'division': return 'Division'
      case 'department': return 'Department'
      case 'team': return 'Team'
      case 'portfolio': return 'Portfolio'
      default: return ''
    }
  }

  return (
    <div className={clsx('border-l-2', depth > 0 ? 'ml-4 border-gray-200' : 'border-transparent')}>
      <div
        className={clsx(
          'flex items-center gap-2 p-2 rounded-lg transition-colors',
          isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'
        )}
      >
        {/* Expand/collapse toggle */}
        <button
          onClick={onToggle}
          className={clsx(
            'p-1 rounded hover:bg-gray-100 transition-transform',
            !hasChildren && !nodeMembers.length && 'invisible'
          )}
        >
          <ChevronRight className={clsx('h-4 w-4 text-gray-400 transition-transform', isExpanded && 'rotate-90')} />
        </button>

        {/* Node icon and name */}
        <span className="text-gray-400">{getNodeIcon()}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">{node.name}</span>
            <span className="text-xs text-gray-400">{getNodeTypeLabel()}</span>
          </div>
          {nodeMembers.length > 0 && !isExpanded && (
            <span className="text-xs text-gray-500">{nodeMembers.length} member{nodeMembers.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Action button */}
        {existingRequest?.status === 'approved' ? (
          <span className="text-xs text-green-600 font-medium px-2 py-1 bg-green-50 rounded">Member</span>
        ) : existingRequest?.status === 'pending' ? (
          <span className="text-xs text-yellow-600 font-medium px-2 py-1 bg-yellow-50 rounded">Pending</span>
        ) : isSelected ? (
          <button
            onClick={onRemove}
            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
            title="Remove request"
          >
            <Minus className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={onAdd}
            className="p-1 text-primary-500 hover:text-primary-700 hover:bg-primary-50 rounded"
            title="Request access"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Expanded content: members and children */}
      {isExpanded && (
        <div className="ml-6">
          {/* Members list */}
          {nodeMembers.length > 0 && (
            <div className="py-2 space-y-1">
              {nodeMembers.map((member) => (
                <div key={member.user_id} className="flex items-center gap-2 px-2 py-1 text-sm text-gray-600">
                  <UserCircle className="h-4 w-4 text-gray-300" />
                  <span>
                    {member.first_name && member.last_name
                      ? `${member.first_name} ${member.last_name}`
                      : member.email}
                  </span>
                  {member.role && (
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{member.role}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Child nodes */}
          {children}
        </div>
      )}
    </div>
  )
}

function TeamsStep({ orgNodes, portfolios, orgNodeMembers, accessRequests, existingRequests, addAccessRequest, removeAccessRequest }: {
  orgNodes: OrgNode[]
  portfolios: { id: string; name: string }[]
  orgNodeMembers: OrgNodeMember[]
  accessRequests: TeamAccessRequest[]
  existingRequests: TeamAccessRequest[]
  addAccessRequest: (type: 'team' | 'portfolio' | 'division' | 'department', id: string, name: string) => void
  removeAccessRequest: (targetId: string) => void
}) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  // Build hierarchical tree from flat org nodes
  const divisions = orgNodes.filter(n => n.node_type === 'division')
  const departments = orgNodes.filter(n => n.node_type === 'department')
  const teams = orgNodes.filter(n => n.node_type === 'team')

  // Get children of a node
  const getChildNodes = (parentId: string, nodeType: 'department' | 'team') => {
    return orgNodes.filter(n => n.parent_id === parentId && n.node_type === nodeType)
  }

  const allSelectedIds = new Set([
    ...accessRequests.map(r => r.target_id),
    ...existingRequests.filter(r => r.status === 'pending' || r.status === 'approved').map(r => r.target_id)
  ])

  const toggleExpanded = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const expandAll = () => {
    const allIds = new Set(orgNodes.map(n => n.id))
    setExpandedNodes(allIds)
  }

  const collapseAll = () => {
    setExpandedNodes(new Set())
  }

  // Render the org tree recursively
  const renderOrgTree = () => {
    // If we have divisions, start from there
    if (divisions.length > 0) {
      return divisions.map(division => (
        <OrgNodeItem
          key={division.id}
          node={division}
          members={orgNodeMembers}
          isExpanded={expandedNodes.has(division.id)}
          onToggle={() => toggleExpanded(division.id)}
          isSelected={allSelectedIds.has(division.id)}
          existingRequest={existingRequests.find(r => r.target_id === division.id)}
          onAdd={() => addAccessRequest('division', division.id, division.name)}
          onRemove={() => removeAccessRequest(division.id)}
          depth={0}
        >
          {/* Departments under this division */}
          {getChildNodes(division.id, 'department').map(dept => (
            <OrgNodeItem
              key={dept.id}
              node={dept}
              members={orgNodeMembers}
              isExpanded={expandedNodes.has(dept.id)}
              onToggle={() => toggleExpanded(dept.id)}
              isSelected={allSelectedIds.has(dept.id)}
              existingRequest={existingRequests.find(r => r.target_id === dept.id)}
              onAdd={() => addAccessRequest('department', dept.id, dept.name)}
              onRemove={() => removeAccessRequest(dept.id)}
              depth={1}
            >
              {/* Teams under this department */}
              {getChildNodes(dept.id, 'team').map(team => (
                <OrgNodeItem
                  key={team.id}
                  node={team}
                  members={orgNodeMembers}
                  isExpanded={expandedNodes.has(team.id)}
                  onToggle={() => toggleExpanded(team.id)}
                  isSelected={allSelectedIds.has(team.id)}
                  existingRequest={existingRequests.find(r => r.target_id === team.id)}
                  onAdd={() => addAccessRequest('team', team.id, team.name)}
                  onRemove={() => removeAccessRequest(team.id)}
                  depth={2}
                />
              ))}
            </OrgNodeItem>
          ))}
          {/* Teams directly under division (if any) */}
          {getChildNodes(division.id, 'team').map(team => (
            <OrgNodeItem
              key={team.id}
              node={team}
              members={orgNodeMembers}
              isExpanded={expandedNodes.has(team.id)}
              onToggle={() => toggleExpanded(team.id)}
              isSelected={allSelectedIds.has(team.id)}
              existingRequest={existingRequests.find(r => r.target_id === team.id)}
              onAdd={() => addAccessRequest('team', team.id, team.name)}
              onRemove={() => removeAccessRequest(team.id)}
              depth={1}
            />
          ))}
        </OrgNodeItem>
      ))
    }

    // Fallback: if no divisions, show departments at top level
    if (departments.length > 0) {
      return departments.filter(d => !d.parent_id).map(dept => (
        <OrgNodeItem
          key={dept.id}
          node={dept}
          members={orgNodeMembers}
          isExpanded={expandedNodes.has(dept.id)}
          onToggle={() => toggleExpanded(dept.id)}
          isSelected={allSelectedIds.has(dept.id)}
          existingRequest={existingRequests.find(r => r.target_id === dept.id)}
          onAdd={() => addAccessRequest('department', dept.id, dept.name)}
          onRemove={() => removeAccessRequest(dept.id)}
          depth={0}
        >
          {getChildNodes(dept.id, 'team').map(team => (
            <OrgNodeItem
              key={team.id}
              node={team}
              members={orgNodeMembers}
              isExpanded={expandedNodes.has(team.id)}
              onToggle={() => toggleExpanded(team.id)}
              isSelected={allSelectedIds.has(team.id)}
              existingRequest={existingRequests.find(r => r.target_id === team.id)}
              onAdd={() => addAccessRequest('team', team.id, team.name)}
              onRemove={() => removeAccessRequest(team.id)}
              depth={1}
            />
          ))}
        </OrgNodeItem>
      ))
    }

    // Fallback: just show teams
    return teams.map(team => (
      <OrgNodeItem
        key={team.id}
        node={team}
        members={orgNodeMembers}
        isExpanded={expandedNodes.has(team.id)}
        onToggle={() => toggleExpanded(team.id)}
        isSelected={allSelectedIds.has(team.id)}
        existingRequest={existingRequests.find(r => r.target_id === team.id)}
        onAdd={() => addAccessRequest('team', team.id, team.name)}
        onRemove={() => removeAccessRequest(team.id)}
        depth={0}
      />
    ))
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FolderTree className="h-10 w-10 text-blue-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Request Team Access</h2>
        <p className="text-gray-600 mt-1">Browse the organization structure and request access to teams</p>
        <p className="text-sm text-gray-500 mt-2">
          <AlertCircle className="h-4 w-4 inline mr-1" />
          Expand nodes to see members and find the right team
        </p>
      </div>

      {/* Organization Hierarchy */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-gray-400" />
            Organization Structure
          </h3>
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="text-xs text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="text-xs text-gray-600 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50"
            >
              Collapse All
            </button>
          </div>
        </div>

        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {orgNodes.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No organization structure defined yet</p>
          ) : (
            renderOrgTree()
          )}
        </div>
      </Card>

      {/* Portfolios Section */}
      {portfolios.length > 0 && (
        <Card>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-gray-400" />
            Portfolios
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {portfolios.map((portfolio) => {
              const isSelected = allSelectedIds.has(portfolio.id)
              const existingRequest = existingRequests.find(r => r.target_id === portfolio.id)

              return (
                <div
                  key={portfolio.id}
                  className={clsx(
                    'flex items-center justify-between p-2 rounded-lg border',
                    isSelected ? 'bg-primary-50 border-primary-200' : 'hover:bg-gray-50 border-gray-200'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-900">{portfolio.name}</span>
                  </div>
                  {existingRequest?.status === 'approved' ? (
                    <span className="text-xs text-green-600 font-medium px-2 py-1 bg-green-50 rounded">Member</span>
                  ) : existingRequest?.status === 'pending' ? (
                    <span className="text-xs text-yellow-600 font-medium px-2 py-1 bg-yellow-50 rounded">Pending</span>
                  ) : isSelected ? (
                    <button
                      onClick={() => removeAccessRequest(portfolio.id)}
                      className="p-1 text-red-500 hover:text-red-700"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => addAccessRequest('portfolio', portfolio.id, portfolio.name)}
                      className="p-1 text-primary-500 hover:text-primary-700"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Selected Requests Summary */}
      {accessRequests.length > 0 && (
        <Card className="bg-primary-50 border-primary-200">
          <h4 className="font-medium text-primary-900 mb-2">Access Requests to Submit ({accessRequests.length})</h4>
          <div className="flex flex-wrap gap-2">
            {accessRequests.map((request) => (
              <span
                key={request.target_id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-full text-sm text-primary-700 border border-primary-200"
              >
                {request.target_name}
                <button
                  onClick={() => removeAccessRequest(request.target_id)}
                  className="text-primary-400 hover:text-primary-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function RoleSpecificStep({ profile, setProfile, toggleArrayItem }: {
  profile: UserProfileExtended
  setProfile: React.Dispatch<React.SetStateAction<UserProfileExtended>>
  toggleArrayItem: (array: string[], item: string, setter: (val: string[]) => void) => void
}) {
  if (profile.user_type === 'investor') {
    return <InvestorProfileStep profile={profile} setProfile={setProfile} toggleArrayItem={toggleArrayItem} />
  } else if (profile.user_type === 'operations') {
    return <OperationsProfileStep profile={profile} setProfile={setProfile} toggleArrayItem={toggleArrayItem} />
  } else if (profile.user_type === 'compliance') {
    return <ComplianceProfileStep profile={profile} setProfile={setProfile} toggleArrayItem={toggleArrayItem} />
  }

  return (
    <div className="text-center py-12">
      <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
      <p className="text-gray-600">Please go back and select your role type first.</p>
    </div>
  )
}

function InvestorProfileStep({ profile, setProfile, toggleArrayItem }: {
  profile: UserProfileExtended
  setProfile: React.Dispatch<React.SetStateAction<UserProfileExtended>>
  toggleArrayItem: (array: string[], item: string, setter: (val: string[]) => void) => void
}) {
  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="h-10 w-10 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Investment Profile</h2>
        <p className="text-gray-600 mt-1">Tell us about your investment focus and strategy</p>
      </div>

      {/* Investment Style */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Investment Style</h3>
        <p className="text-sm text-gray-500 mb-4">Select all that apply</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {INVESTMENT_STYLES.map((style) => (
            <button
              key={style.id}
              onClick={() => toggleArrayItem(
                profile.investment_style,
                style.id,
                (val) => setProfile(prev => ({ ...prev, investment_style: val }))
              )}
              className={clsx(
                'p-3 rounded-lg border-2 text-left transition-all',
                profile.investment_style.includes(style.id)
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <div className="font-medium text-sm">{style.label}</div>
              <div className="text-xs text-gray-500 mt-1">{style.description}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Time Horizon & Market Cap */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <h3 className="font-semibold text-gray-900 mb-3">Time Horizon</h3>
          <div className="space-y-2">
            {TIME_HORIZONS.map((horizon) => (
              <button
                key={horizon.id}
                onClick={() => toggleArrayItem(
                  profile.time_horizon,
                  horizon.id,
                  (val) => setProfile(prev => ({ ...prev, time_horizon: val }))
                )}
                className={clsx(
                  'w-full p-3 rounded-lg border-2 text-left transition-all flex items-center justify-between',
                  profile.time_horizon.includes(horizon.id)
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div>
                  <div className="font-medium text-sm">{horizon.label}</div>
                  <div className="text-xs text-gray-500">{horizon.description}</div>
                </div>
                {profile.time_horizon.includes(horizon.id) && <Check className="h-5 w-5 text-green-600" />}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-gray-900 mb-3">Market Cap Focus</h3>
          <div className="space-y-2">
            {MARKET_CAP_OPTIONS.map((cap) => (
              <button
                key={cap.id}
                onClick={() => toggleArrayItem(
                  profile.market_cap_focus,
                  cap.id,
                  (val) => setProfile(prev => ({ ...prev, market_cap_focus: val }))
                )}
                className={clsx(
                  'w-full p-3 rounded-lg border-2 text-left transition-all flex items-center justify-between',
                  profile.market_cap_focus.includes(cap.id)
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div>
                  <div className="font-medium text-sm">{cap.label}</div>
                  <div className="text-xs text-gray-500">{cap.description}</div>
                </div>
                {profile.market_cap_focus.includes(cap.id) && <Check className="h-5 w-5 text-green-600" />}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Geography & Asset Class */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <h3 className="font-semibold text-gray-900 mb-3">Geography Focus</h3>
          <div className="space-y-2">
            {GEOGRAPHY_OPTIONS.map((geo) => (
              <button
                key={geo.id}
                onClick={() => toggleArrayItem(
                  profile.geography_focus,
                  geo.id,
                  (val) => setProfile(prev => ({ ...prev, geography_focus: val }))
                )}
                className={clsx(
                  'w-full p-3 rounded-lg border-2 text-left transition-all flex items-center justify-between',
                  profile.geography_focus.includes(geo.id)
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div>
                  <div className="font-medium text-sm">{geo.label}</div>
                  <div className="text-xs text-gray-500">{geo.description}</div>
                </div>
                {profile.geography_focus.includes(geo.id) && <Check className="h-5 w-5 text-green-600" />}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-gray-900 mb-3">Asset Classes</h3>
          <div className="space-y-2">
            {ASSET_CLASS_OPTIONS.map((asset) => (
              <button
                key={asset.id}
                onClick={() => toggleArrayItem(
                  profile.asset_class_focus,
                  asset.id,
                  (val) => setProfile(prev => ({ ...prev, asset_class_focus: val }))
                )}
                className={clsx(
                  'w-full p-3 rounded-lg border-2 text-left transition-all flex items-center justify-between',
                  profile.asset_class_focus.includes(asset.id)
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div>
                  <div className="font-medium text-sm">{asset.label}</div>
                  <div className="text-xs text-gray-500">{asset.description}</div>
                </div>
                {profile.asset_class_focus.includes(asset.id) && <Check className="h-5 w-5 text-green-600" />}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Sectors */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Sector Focus</h3>
        <p className="text-sm text-gray-500 mb-4">Select the sectors you follow or cover</p>
        <div className="flex flex-wrap gap-2">
          {SECTOR_OPTIONS.map((sector) => (
            <button
              key={sector}
              onClick={() => toggleArrayItem(
                profile.sector_focus,
                sector,
                (val) => setProfile(prev => ({ ...prev, sector_focus: val }))
              )}
              className={clsx(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                profile.sector_focus.includes(sector)
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
            >
              {sector}
            </button>
          ))}
        </div>
      </Card>

      {/* Universe Scope */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Universe Scope</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <button
            onClick={() => setProfile(prev => ({ ...prev, universe_scope: 'broad' }))}
            className={clsx(
              'p-4 rounded-lg border-2 text-left transition-all',
              profile.universe_scope === 'broad'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-gray-300'
            )}
          >
            <Globe className="h-6 w-6 mb-2 text-gray-400" />
            <div className="font-medium">Broad Universe</div>
            <div className="text-xs text-gray-500">I follow the market broadly</div>
          </button>
          <button
            onClick={() => setProfile(prev => ({ ...prev, universe_scope: 'specific' }))}
            className={clsx(
              'p-4 rounded-lg border-2 text-left transition-all',
              profile.universe_scope === 'specific'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-gray-300'
            )}
          >
            <Target className="h-6 w-6 mb-2 text-gray-400" />
            <div className="font-medium">Specific Universe</div>
            <div className="text-xs text-gray-500">I focus on specific names</div>
          </button>
        </div>
      </Card>

      {/* Strategy Description */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Tell Us More</h3>
        <p className="text-sm text-gray-500 mb-4">
          This helps us personalize your experience and provide relevant context
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Describe your investment strategy
            </label>
            <textarea
              value={profile.strategy_description}
              onChange={(e) => setProfile(prev => ({ ...prev, strategy_description: e.target.value }))}
              placeholder="e.g., I focus on identifying undervalued growth companies in the technology sector with strong competitive moats..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              What are your current focus areas and interests?
            </label>
            <textarea
              value={profile.investment_focus_summary}
              onChange={(e) => setProfile(prev => ({ ...prev, investment_focus_summary: e.target.value }))}
              placeholder="e.g., Currently researching AI infrastructure plays, interested in semiconductor supply chain dynamics..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>
      </Card>
    </div>
  )
}

function OperationsProfileStep({ profile, setProfile, toggleArrayItem }: {
  profile: UserProfileExtended
  setProfile: React.Dispatch<React.SetStateAction<UserProfileExtended>>
  toggleArrayItem: (array: string[], item: string, setter: (val: string[]) => void) => void
}) {
  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Settings className="h-10 w-10 text-blue-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Operations Profile</h2>
        <p className="text-gray-600 mt-1">Tell us about your operations focus</p>
      </div>

      {/* Workflow Types */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Workflow Areas</h3>
        <p className="text-sm text-gray-500 mb-4">What types of workflows do you manage?</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {OPS_WORKFLOW_TYPES.map((workflow) => (
            <button
              key={workflow.id}
              onClick={() => toggleArrayItem(
                profile.ops_workflow_types,
                workflow.id,
                (val) => setProfile(prev => ({ ...prev, ops_workflow_types: val }))
              )}
              className={clsx(
                'p-3 rounded-lg border-2 text-left transition-all',
                profile.ops_workflow_types.includes(workflow.id)
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <div className="font-medium text-sm">{workflow.label}</div>
              <div className="text-xs text-gray-500 mt-1">{workflow.description}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Role Description */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Role Description</h3>
        <textarea
          value={profile.ops_role_description}
          onChange={(e) => setProfile(prev => ({ ...prev, ops_role_description: e.target.value }))}
          placeholder="Describe your day-to-day responsibilities and the teams/processes you support..."
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </Card>
    </div>
  )
}

function ComplianceProfileStep({ profile, setProfile, toggleArrayItem }: {
  profile: UserProfileExtended
  setProfile: React.Dispatch<React.SetStateAction<UserProfileExtended>>
  toggleArrayItem: (array: string[], item: string, setter: (val: string[]) => void) => void
}) {
  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Shield className="h-10 w-10 text-purple-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Compliance Profile</h2>
        <p className="text-gray-600 mt-1">Tell us about your compliance focus</p>
      </div>

      {/* Compliance Areas */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Compliance Areas</h3>
        <p className="text-sm text-gray-500 mb-4">What areas do you focus on?</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {COMPLIANCE_AREAS.map((area) => (
            <button
              key={area.id}
              onClick={() => toggleArrayItem(
                profile.compliance_areas,
                area.id,
                (val) => setProfile(prev => ({ ...prev, compliance_areas: val }))
              )}
              className={clsx(
                'p-3 rounded-lg border-2 text-left transition-all',
                profile.compliance_areas.includes(area.id)
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <div className="font-medium text-sm">{area.label}</div>
              <div className="text-xs text-gray-500 mt-1">{area.description}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Role Description */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Role Description</h3>
        <textarea
          value={profile.compliance_role_description}
          onChange={(e) => setProfile(prev => ({ ...prev, compliance_role_description: e.target.value }))}
          placeholder="Describe your compliance responsibilities, the teams you oversee, and key focus areas..."
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </Card>
    </div>
  )
}

function IntegrationsStep({ profile, setProfile }: {
  profile: UserProfileExtended
  setProfile: React.Dispatch<React.SetStateAction<UserProfileExtended>>
}) {
  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Database className="h-10 w-10 text-orange-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Data & Integrations</h2>
        <p className="text-gray-600 mt-1">Connect your market data tools</p>
      </div>

      {/* Market Data Provider */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Market Data Provider</h3>
        <p className="text-sm text-gray-500 mb-4">Which platform do you primarily use for market data?</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {MARKET_DATA_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              onClick={() => setProfile(prev => ({ ...prev, market_data_provider: provider.id as any }))}
              className={clsx(
                'p-4 rounded-lg border-2 text-center transition-all flex flex-col items-center justify-center min-h-[100px]',
                profile.market_data_provider === provider.id
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              {/* TODO: Replace with actual company logos */}
              <div className="h-10 w-10 mb-2 flex items-center justify-center rounded-lg bg-gray-100 text-gray-400">
                {provider.id === 'other' ? (
                  <Settings className="h-5 w-5" />
                ) : provider.id === 'none' ? (
                  <AlertCircle className="h-5 w-5" />
                ) : (
                  <Database className="h-5 w-5" />
                )}
              </div>
              <div className="font-medium text-sm">{provider.label}</div>
            </button>
          ))}
        </div>

        {profile.market_data_provider === 'other' && (
          <div className="mt-4">
            <input
              type="text"
              value={profile.market_data_provider_other}
              onChange={(e) => setProfile(prev => ({ ...prev, market_data_provider_other: e.target.value }))}
              placeholder="Enter your market data provider"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        )}
      </Card>

      {/* Data Needs */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Data Requirements</h3>
        <p className="text-sm text-gray-500 mb-4">What types of data do you need access to?</p>
        <div className="space-y-3">
          {[
            { key: 'needs_realtime_prices', label: 'Real-time Prices', description: 'Live streaming quotes' },
            { key: 'needs_index_data', label: 'Index Data', description: 'Benchmark indices and constituents' },
            { key: 'needs_fundamentals', label: 'Fundamentals', description: 'Financial statements, ratios' },
            { key: 'needs_estimates', label: 'Estimates', description: 'Analyst estimates and revisions' },
            { key: 'needs_news_feeds', label: 'News Feeds', description: 'Real-time news and filings' },
          ].map((item) => (
            <label key={item.key} className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={profile[item.key as keyof UserProfileExtended] as boolean}
                onChange={(e) => setProfile(prev => ({ ...prev, [item.key]: e.target.checked }))}
                className="mt-1 h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <div>
                <div className="font-medium text-sm text-gray-900">{item.label}</div>
                <div className="text-xs text-gray-500">{item.description}</div>
              </div>
            </label>
          ))}
        </div>
      </Card>

      {/* Integration Notes */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3">Additional Notes</h3>
        <textarea
          value={profile.integration_notes}
          onChange={(e) => setProfile(prev => ({ ...prev, integration_notes: e.target.value }))}
          placeholder="Any specific integration requirements or existing workflows you'd like to connect?"
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </Card>

      {/* Coming Soon Notice */}
      <Card className="bg-gray-50 border-gray-200">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-gray-200 rounded-lg">
            <Settings className="h-5 w-5 text-gray-500" />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Dashboard Customization</h4>
            <p className="text-sm text-gray-500 mt-1">
              Coming soon: Customize your dashboard widgets, layouts, and notification preferences.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}

function ReviewStep({ profile, accessRequests, skippedSteps }: {
  profile: UserProfileExtended
  accessRequests: TeamAccessRequest[]
  skippedSteps: string[]
}) {
  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="h-10 w-10 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Review & Complete</h2>
        <p className="text-gray-600 mt-1">Review your setup before finishing</p>
      </div>

      {/* Skipped Steps Warning */}
      {skippedSteps.length > 0 && (
        <Card className="bg-yellow-50 border-yellow-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-yellow-800">Some sections were skipped</h4>
              <p className="text-sm text-yellow-700 mt-1">
                You can complete these later in your settings. Some features may be limited until these are filled out.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Profile Summary */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User className="h-5 w-5 text-gray-400" />
          Profile
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Role:</span>
            <span className="ml-2 font-medium capitalize">{profile.user_type || '—'}</span>
          </div>
          {profile.title && (
            <div>
              <span className="text-gray-500">Title:</span>
              <span className="ml-2 font-medium">{profile.title}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Access Requests Summary */}
      {accessRequests.length > 0 && (
        <Card>
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-400" />
            Access Requests ({accessRequests.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {accessRequests.map((request) => (
              <span
                key={request.target_id}
                className="inline-flex items-center gap-1 px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm"
              >
                {request.target_name}
                <span className="text-primary-400 text-xs">({request.request_type})</span>
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            These requests will be sent to administrators for approval.
          </p>
        </Card>
      )}

      {/* Role-Specific Summary */}
      {profile.user_type === 'investor' && (
        <Card>
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-gray-400" />
            Investment Profile
          </h3>
          <div className="space-y-3 text-sm">
            {profile.investment_style.length > 0 && (
              <div>
                <span className="text-gray-500">Style:</span>
                <span className="ml-2">{profile.investment_style.map(s => s.replace('_', ' ')).join(', ')}</span>
              </div>
            )}
            {profile.sector_focus.length > 0 && (
              <div>
                <span className="text-gray-500">Sectors:</span>
                <span className="ml-2">{profile.sector_focus.join(', ')}</span>
              </div>
            )}
            {profile.geography_focus.length > 0 && (
              <div>
                <span className="text-gray-500">Geography:</span>
                <span className="ml-2">{profile.geography_focus.map(g => g.replace('_', ' ')).join(', ')}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Data Integrations Summary */}
      {profile.market_data_provider && (
        <Card>
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-gray-400" />
            Data & Integrations
          </h3>
          <div className="text-sm">
            <span className="text-gray-500">Market Data:</span>
            <span className="ml-2 font-medium capitalize">
              {profile.market_data_provider === 'other'
                ? profile.market_data_provider_other || 'Other'
                : profile.market_data_provider}
            </span>
          </div>
        </Card>
      )}

      <div className="text-center text-sm text-gray-500 pt-4">
        Click "Complete Setup" to finish and start using Tesseract
      </div>
    </div>
  )
}

export default SetupWizard
