import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { User, Calendar, Settings, Briefcase, Building2, Shield, Database, CheckCircle, Clock, Edit3, X, Check, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useOnboarding, UserProfileExtended } from '../hooks/useOnboarding'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface ProfilePageProps {
  onClose?: () => void
}

// Constants for options (shared with SetupWizard)
const INVESTMENT_STYLES = [
  { id: 'fundamental', label: 'Fundamental' },
  { id: 'quantitative', label: 'Quantitative' },
  { id: 'technical', label: 'Technical' },
  { id: 'macro', label: 'Macro' },
]

const TIME_HORIZONS = [
  { id: 'all', label: 'All Horizons' },
  { id: 'short_term', label: 'Short-term' },
  { id: 'medium_term', label: 'Medium-term' },
  { id: 'long_term', label: 'Long-term' },
  { id: 'very_long_term', label: 'Very Long-term' },
]

const MARKET_CAP_OPTIONS = [
  { id: 'all_cap', label: 'All Cap' },
  { id: 'large', label: 'Large Cap' },
  { id: 'mid', label: 'Mid Cap' },
  { id: 'small', label: 'Small Cap' },
  { id: 'micro', label: 'Micro Cap' },
]

const GEOGRAPHY_OPTIONS = [
  { id: 'us', label: 'United States' },
  { id: 'international', label: 'International Developed' },
  { id: 'emerging_markets', label: 'Emerging Markets' },
  { id: 'global', label: 'Global' },
]

const ASSET_CLASS_OPTIONS = [
  { id: 'equities', label: 'Equities' },
  { id: 'fixed_income', label: 'Fixed Income' },
  { id: 'alternatives', label: 'Alternatives' },
  { id: 'multi_asset', label: 'Multi-Asset' },
]

const SECTOR_OPTIONS = [
  'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Energy',
  'Financials', 'Generalist', 'Healthcare', 'Industrials', 'Materials', 'Real Estate',
  'Technology', 'Utilities'
]

const OPS_WORKFLOW_TYPES = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'onboarding', label: 'Onboarding' },
]

const COMPLIANCE_AREAS = [
  { id: 'trading', label: 'Trading Compliance' },
  { id: 'reporting', label: 'Regulatory Reporting' },
  { id: 'risk', label: 'Risk Management' },
  { id: 'aml_kyc', label: 'AML/KYC' },
  { id: 'policies', label: 'Policy Management' },
]

const MARKET_DATA_PROVIDERS = [
  { id: 'bloomberg', label: 'Bloomberg' },
  { id: 'factset', label: 'FactSet' },
  { id: 'capiq', label: 'Capital IQ' },
  { id: 'refinitiv', label: 'Refinitiv' },
  { id: 'other', label: 'Other' },
  { id: 'none', label: 'None / Not Sure' },
]

export function ProfilePage({ onClose }: ProfilePageProps) {
  const navigate = useNavigate()
  const { user, loading: isLoading } = useAuth()
  const { onboardingStatus, profileExtended, updateProfileExtended } = useOnboarding()

  // Edit modal states
  const [editingSection, setEditingSection] = useState<'role' | 'investor' | 'operations' | 'compliance' | 'integrations' | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<UserProfileExtended>>({})
  const [isSaving, setIsSaving] = useState(false)

  const userDetails = user as any

  const getUserInitials = () => {
    if (userDetails?.first_name && userDetails?.last_name) {
      return (userDetails.first_name[0] + userDetails.last_name[0]).toUpperCase()
    }
    const userEmail = userDetails?.email || user?.email
    if (!userEmail) return ''
    const parts = userEmail.split('@')[0].split('.')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    const name = userEmail.split('@')[0]
    return name.length >= 2 ? name.substring(0, 2).toUpperCase() : name.toUpperCase()
  }

  const getDisplayName = () => {
    if (userDetails?.first_name && userDetails?.last_name) {
      return `${userDetails.first_name} ${userDetails.last_name}`
    }
    const userEmail = userDetails?.email || user?.email
    if (!userEmail) return ''
    const emailParts = userEmail.split('@')[0].split('.')
    if (emailParts.length >= 2) {
      return emailParts.map((part: string) =>
        part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      ).join(' ')
    }
    return userEmail.split('@')[0]
  }

  const getUserTypeLabel = (type: string | null) => {
    switch (type) {
      case 'investor': return 'Investor'
      case 'operations': return 'Operations'
      case 'compliance': return 'Compliance'
      default: return 'Not Set'
    }
  }

  const getUserTypeIcon = (type: string | null) => {
    switch (type) {
      case 'investor': return Briefcase
      case 'operations': return Building2
      case 'compliance': return Shield
      default: return User
    }
  }

  const getMarketDataLabel = (provider: string | null, other?: string | null) => {
    switch (provider) {
      case 'factset': return 'FactSet'
      case 'bloomberg': return 'Bloomberg'
      case 'capiq': return 'Capital IQ'
      case 'refinitiv': return 'Refinitiv'
      case 'other': return other || 'Other'
      case 'none': return 'None'
      default: return 'Not Set'
    }
  }

  // Start editing a section
  const startEditing = (section: 'role' | 'investor' | 'operations' | 'compliance' | 'integrations') => {
    setEditFormData(profileExtended ? { ...profileExtended } : {})
    setEditingSection(section)
  }

  // Save changes
  const saveChanges = async () => {
    setIsSaving(true)
    try {
      await updateProfileExtended.mutateAsync(editFormData)
      setEditingSection(null)
    } catch (error) {
      console.error('Error saving profile:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Toggle item in array
  const toggleArrayItem = (field: keyof UserProfileExtended, item: string) => {
    const current = (editFormData[field] as string[]) || []
    if (current.includes(item)) {
      setEditFormData({ ...editFormData, [field]: current.filter(i => i !== item) })
    } else {
      setEditFormData({ ...editFormData, [field]: [...current, item] })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <Card>
            <div className="space-y-4">
              <div className="w-20 h-20 bg-gray-200 rounded-full mx-auto"></div>
              <div className="h-6 bg-gray-200 rounded w-1/2 mx-auto"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3 mx-auto"></div>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  const UserTypeIcon = getUserTypeIcon(profileExtended?.user_type || userDetails?.user_type)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-600 mt-1">Manage your personal information and preferences</p>
      </div>

      {/* Profile Card */}
      <Card>
        <div className="text-center mb-6">
          <div className="w-20 h-20 rounded-full bg-primary-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">
              {getUserInitials()}
            </span>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">{getDisplayName()}</h2>
          <p className="text-gray-600">{userDetails?.email}</p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <button
              onClick={() => startEditing('role')}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
            >
              <UserTypeIcon className="h-4 w-4" />
              {getUserTypeLabel(profileExtended?.user_type || userDetails?.user_type)}
              <Edit3 className="h-3 w-3 ml-1 opacity-50" />
            </button>
            {userDetails?.coverage_admin && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-800">
                Admin
              </span>
            )}
          </div>
          {profileExtended?.title && (
            <p className="text-sm text-gray-500 mt-2">{profileExtended.title}</p>
          )}
        </div>

        {/* Personal Information - Read Only */}
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900">Personal Information</h3>
            <p className="text-sm text-gray-500 mt-1">Contact your administrator to update your profile information</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
                {userDetails?.first_name || '-'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
                {userDetails?.last_name || '-'}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
              {userDetails?.email || '-'}
            </div>
          </div>
        </div>
      </Card>

      {/* Role-Specific Profile */}
      {profileExtended?.user_type && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <UserTypeIcon className="h-5 w-5 text-primary-600" />
              {getUserTypeLabel(profileExtended.user_type)} Profile
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startEditing(profileExtended.user_type as any)}
              className="text-gray-500 hover:text-gray-700"
            >
              <Edit3 className="h-4 w-4 mr-1.5" />
              Edit
            </Button>
          </div>

          {profileExtended.user_type === 'investor' && (
            <div className="space-y-4">
              {profileExtended.investment_style?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Investment Style</label>
                  <div className="flex flex-wrap gap-2">
                    {profileExtended.investment_style.map((style: string) => (
                      <span key={style} className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-sm capitalize">
                        {style.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profileExtended.time_horizon?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time Horizon</label>
                  <div className="flex flex-wrap gap-2">
                    {profileExtended.time_horizon.map((horizon: string) => (
                      <span key={horizon} className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-sm capitalize">
                        {horizon.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profileExtended.market_cap_focus?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Market Cap Focus</label>
                  <div className="flex flex-wrap gap-2">
                    {profileExtended.market_cap_focus.map((cap: string) => (
                      <span key={cap} className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-sm capitalize">
                        {cap.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profileExtended.geography_focus?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Geography Focus</label>
                  <div className="flex flex-wrap gap-2">
                    {profileExtended.geography_focus.map((geo: string) => (
                      <span key={geo} className="px-2.5 py-1 bg-cyan-100 text-cyan-700 rounded-full text-sm capitalize">
                        {geo.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profileExtended.sector_focus?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sector Focus</label>
                  <div className="flex flex-wrap gap-2">
                    {profileExtended.sector_focus.map((sector: string) => (
                      <span key={sector} className="px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
                        {sector}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profileExtended.strategy_description && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Strategy Description</label>
                  <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 text-sm">
                    {profileExtended.strategy_description}
                  </div>
                </div>
              )}

              {/* Empty state for investor */}
              {!profileExtended.investment_style?.length && !profileExtended.sector_focus?.length && !profileExtended.strategy_description && (
                <div className="text-center py-4">
                  <p className="text-gray-500 text-sm">No investment profile configured yet.</p>
                  <Button variant="ghost" size="sm" onClick={() => startEditing('investor')} className="mt-2">
                    <Edit3 className="h-4 w-4 mr-1.5" />
                    Add Details
                  </Button>
                </div>
              )}
            </div>
          )}

          {profileExtended.user_type === 'operations' && (
            <div className="space-y-4">
              {profileExtended.ops_workflow_types?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Workflow Types</label>
                  <div className="flex flex-wrap gap-2">
                    {profileExtended.ops_workflow_types.map((type: string) => (
                      <span key={type} className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-sm capitalize">
                        {type.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profileExtended.ops_role_description && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role Description</label>
                  <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 text-sm">
                    {profileExtended.ops_role_description}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!profileExtended.ops_workflow_types?.length && !profileExtended.ops_role_description && (
                <div className="text-center py-4">
                  <p className="text-gray-500 text-sm">No operations profile configured yet.</p>
                  <Button variant="ghost" size="sm" onClick={() => startEditing('operations')} className="mt-2">
                    <Edit3 className="h-4 w-4 mr-1.5" />
                    Add Details
                  </Button>
                </div>
              )}
            </div>
          )}

          {profileExtended.user_type === 'compliance' && (
            <div className="space-y-4">
              {profileExtended.compliance_areas?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Compliance Areas</label>
                  <div className="flex flex-wrap gap-2">
                    {profileExtended.compliance_areas.map((area: string) => (
                      <span key={area} className="px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-sm capitalize">
                        {area.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profileExtended.compliance_role_description && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role Description</label>
                  <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 text-sm">
                    {profileExtended.compliance_role_description}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!profileExtended.compliance_areas?.length && !profileExtended.compliance_role_description && (
                <div className="text-center py-4">
                  <p className="text-gray-500 text-sm">No compliance profile configured yet.</p>
                  <Button variant="ghost" size="sm" onClick={() => startEditing('compliance')} className="mt-2">
                    <Edit3 className="h-4 w-4 mr-1.5" />
                    Add Details
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* No role type set - prompt to set one */}
      {!profileExtended?.user_type && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-100 rounded-lg">
                <User className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">Set Your Role Type</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Tell us what type of work you do to personalize your experience.
                </p>
              </div>
            </div>
            <Button onClick={() => startEditing('role')}>
              Choose Role
            </Button>
          </div>
        </Card>
      )}

      {/* Data Integrations */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <Database className="h-5 w-5 text-cyan-600" />
            Data Integrations
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startEditing('integrations')}
            className="text-gray-500 hover:text-gray-700"
          >
            <Edit3 className="h-4 w-4 mr-1.5" />
            Edit
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Market Data Provider</label>
            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
              {getMarketDataLabel(profileExtended?.market_data_provider || null, profileExtended?.market_data_provider_other)}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Data Needs</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended?.needs_realtime_prices ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                {profileExtended?.needs_realtime_prices ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                Realtime Prices
              </div>
              <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended?.needs_index_data ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                {profileExtended?.needs_index_data ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                Index Data
              </div>
              <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended?.needs_fundamentals ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                {profileExtended?.needs_fundamentals ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                Fundamentals
              </div>
              <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended?.needs_estimates ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                {profileExtended?.needs_estimates ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                Estimates
              </div>
              <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended?.needs_news_feeds ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                {profileExtended?.needs_news_feeds ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                News Feeds
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Account Information */}
      <Card>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Account Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <Calendar className="h-5 w-5 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Member Since</p>
              <p className="text-sm text-gray-900">
                {userDetails?.created_at
                  ? formatDistanceToNow(new Date(userDetails.created_at), { addSuffix: true })
                  : 'Unknown'
                }
              </p>
            </div>
          </div>

          <div className="flex items-center">
            <div className="p-2 bg-success-100 rounded-lg">
              <CheckCircle className="h-5 w-5 text-success-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Setup Status</p>
              <p className="text-sm text-gray-900">
                {onboardingStatus?.wizard_completed ? 'Completed' : 'Incomplete'}
              </p>
              {onboardingStatus?.completed_at && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {formatDistanceToNow(new Date(onboardingStatus.completed_at), { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Subtle link to setup wizard */}
        <div className="mt-6 pt-4 border-t border-gray-100">
          <button
            onClick={() => {
              if (onClose) onClose()
              navigate('/setup')
            }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
          >
            <Settings className="h-3 w-3" />
            Run full setup wizard
          </button>
        </div>
      </Card>

      {/* Edit Modal - Role Type */}
      {editingSection === 'role' && (
        <EditModal
          title="Choose Your Role"
          onClose={() => setEditingSection(null)}
          onSave={saveChanges}
          isSaving={isSaving}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title (Optional)</label>
              <input
                type="text"
                value={editFormData.title || ''}
                onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                placeholder="e.g., Senior Analyst, Portfolio Manager"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">What best describes your role?</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'investor', label: 'Investor', icon: TrendingUp, color: 'green' },
                  { id: 'operations', label: 'Operations', icon: Settings, color: 'blue' },
                  { id: 'compliance', label: 'Compliance', icon: Shield, color: 'purple' },
                ].map((role) => {
                  const Icon = role.icon
                  const isSelected = editFormData.user_type === role.id
                  return (
                    <button
                      key={role.id}
                      onClick={() => setEditFormData({ ...editFormData, user_type: role.id as any })}
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
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </EditModal>
      )}

      {/* Edit Modal - Investor Profile */}
      {editingSection === 'investor' && (
        <EditModal
          title="Investment Profile"
          onClose={() => setEditingSection(null)}
          onSave={saveChanges}
          isSaving={isSaving}
        >
          <div className="space-y-6 max-h-[60vh] overflow-y-auto">
            {/* Investment Style */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Investment Style</label>
              <div className="flex flex-wrap gap-2">
                {INVESTMENT_STYLES.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => toggleArrayItem('investment_style', style.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      (editFormData.investment_style || []).includes(style.id)
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Time Horizon */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time Horizon</label>
              <div className="flex flex-wrap gap-2">
                {TIME_HORIZONS.map((horizon) => (
                  <button
                    key={horizon.id}
                    onClick={() => toggleArrayItem('time_horizon', horizon.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      (editFormData.time_horizon || []).includes(horizon.id)
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {horizon.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Market Cap */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Market Cap Focus</label>
              <div className="flex flex-wrap gap-2">
                {MARKET_CAP_OPTIONS.map((cap) => (
                  <button
                    key={cap.id}
                    onClick={() => toggleArrayItem('market_cap_focus', cap.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      (editFormData.market_cap_focus || []).includes(cap.id)
                        ? 'bg-amber-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {cap.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Geography */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Geography Focus</label>
              <div className="flex flex-wrap gap-2">
                {GEOGRAPHY_OPTIONS.map((geo) => (
                  <button
                    key={geo.id}
                    onClick={() => toggleArrayItem('geography_focus', geo.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      (editFormData.geography_focus || []).includes(geo.id)
                        ? 'bg-cyan-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {geo.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Asset Classes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Asset Classes</label>
              <div className="flex flex-wrap gap-2">
                {ASSET_CLASS_OPTIONS.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => toggleArrayItem('asset_class_focus', asset.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      (editFormData.asset_class_focus || []).includes(asset.id)
                        ? 'bg-indigo-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {asset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sectors */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sector Focus</label>
              <div className="flex flex-wrap gap-2">
                {SECTOR_OPTIONS.map((sector) => (
                  <button
                    key={sector}
                    onClick={() => toggleArrayItem('sector_focus', sector)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      (editFormData.sector_focus || []).includes(sector)
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {sector}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategy Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Strategy Description</label>
              <textarea
                value={editFormData.strategy_description || ''}
                onChange={(e) => setEditFormData({ ...editFormData, strategy_description: e.target.value })}
                placeholder="Describe your investment strategy..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Focus Summary */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Focus Areas</label>
              <textarea
                value={editFormData.investment_focus_summary || ''}
                onChange={(e) => setEditFormData({ ...editFormData, investment_focus_summary: e.target.value })}
                placeholder="What are you currently researching or focused on?"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        </EditModal>
      )}

      {/* Edit Modal - Operations Profile */}
      {editingSection === 'operations' && (
        <EditModal
          title="Operations Profile"
          onClose={() => setEditingSection(null)}
          onSave={saveChanges}
          isSaving={isSaving}
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Workflow Areas</label>
              <div className="flex flex-wrap gap-2">
                {OPS_WORKFLOW_TYPES.map((workflow) => (
                  <button
                    key={workflow.id}
                    onClick={() => toggleArrayItem('ops_workflow_types', workflow.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      (editFormData.ops_workflow_types || []).includes(workflow.id)
                        ? 'bg-amber-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {workflow.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role Description</label>
              <textarea
                value={editFormData.ops_role_description || ''}
                onChange={(e) => setEditFormData({ ...editFormData, ops_role_description: e.target.value })}
                placeholder="Describe your day-to-day responsibilities..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        </EditModal>
      )}

      {/* Edit Modal - Compliance Profile */}
      {editingSection === 'compliance' && (
        <EditModal
          title="Compliance Profile"
          onClose={() => setEditingSection(null)}
          onSave={saveChanges}
          isSaving={isSaving}
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Compliance Areas</label>
              <div className="flex flex-wrap gap-2">
                {COMPLIANCE_AREAS.map((area) => (
                  <button
                    key={area.id}
                    onClick={() => toggleArrayItem('compliance_areas', area.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      (editFormData.compliance_areas || []).includes(area.id)
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {area.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role Description</label>
              <textarea
                value={editFormData.compliance_role_description || ''}
                onChange={(e) => setEditFormData({ ...editFormData, compliance_role_description: e.target.value })}
                placeholder="Describe your compliance responsibilities..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        </EditModal>
      )}

      {/* Edit Modal - Data Integrations */}
      {editingSection === 'integrations' && (
        <EditModal
          title="Data Integrations"
          onClose={() => setEditingSection(null)}
          onSave={saveChanges}
          isSaving={isSaving}
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Market Data Provider</label>
              <div className="grid grid-cols-3 gap-2">
                {MARKET_DATA_PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => setEditFormData({ ...editFormData, market_data_provider: provider.id as any })}
                    className={clsx(
                      'p-3 rounded-lg border-2 text-center transition-all',
                      editFormData.market_data_provider === provider.id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    <div className="font-medium text-sm">{provider.label}</div>
                  </button>
                ))}
              </div>
              {editFormData.market_data_provider === 'other' && (
                <input
                  type="text"
                  value={editFormData.market_data_provider_other || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, market_data_provider_other: e.target.value })}
                  placeholder="Enter provider name"
                  className="mt-3 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Data Needs</label>
              <div className="space-y-2">
                {[
                  { key: 'needs_realtime_prices', label: 'Real-time Prices' },
                  { key: 'needs_index_data', label: 'Index Data' },
                  { key: 'needs_fundamentals', label: 'Fundamentals' },
                  { key: 'needs_estimates', label: 'Estimates' },
                  { key: 'needs_news_feeds', label: 'News Feeds' },
                ].map((item) => (
                  <label key={item.key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editFormData[item.key as keyof UserProfileExtended] as boolean || false}
                      onChange={(e) => setEditFormData({ ...editFormData, [item.key]: e.target.checked })}
                      className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Integration Notes</label>
              <textarea
                value={editFormData.integration_notes || ''}
                onChange={(e) => setEditFormData({ ...editFormData, integration_notes: e.target.value })}
                placeholder="Any specific integration requirements?"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        </EditModal>
      )}
    </div>
  )
}

// Edit Modal Component
function EditModal({
  title,
  onClose,
  onSave,
  isSaving,
  children
}: {
  title: string
  onClose: () => void
  onSave: () => void
  isSaving: boolean
  children: React.ReactNode
}) {
  // Lock body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving} loading={isSaving}>
            <Check className="h-4 w-4 mr-1.5" />
            Save Changes
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
