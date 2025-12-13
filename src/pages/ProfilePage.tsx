import { User, Calendar, Settings, RefreshCw, Briefcase, Building2, Shield, Database, CheckCircle, Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useOnboarding } from '../hooks/useOnboarding'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { formatDistanceToNow } from 'date-fns'

interface ProfilePageProps {
  onClose?: () => void
}

export function ProfilePage({ onClose }: ProfilePageProps) {
  const navigate = useNavigate()

  // Handler for navigating to setup - closes modal if in modal context
  const goToSetup = () => {
    if (onClose) {
      onClose()
    }
    navigate('/setup')
  }
  const { user, loading: isLoading } = useAuth()
  const { onboardingStatus, profileExtended, isLoading: onboardingLoading } = useOnboarding()

  // User details are already loaded in the user object from useAuth
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
          <p className="text-gray-600 mt-1">Manage your personal information and preferences</p>
        </div>
        <Button
          variant="outline"
          onClick={goToSetup}
          className="flex items-center gap-2"
        >
          <Settings className="h-4 w-4" />
          Update Profile Setup
        </Button>
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
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
              <UserTypeIcon className="h-4 w-4" />
              {getUserTypeLabel(profileExtended?.user_type || userDetails?.user_type)}
            </span>
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
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
            <UserTypeIcon className="h-5 w-5 text-primary-600" />
            {getUserTypeLabel(profileExtended.user_type)} Profile
          </h3>

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
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-gray-200">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToSetup}
              className="text-primary-600 hover:text-primary-700"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Update Profile
            </Button>
          </div>
        </Card>
      )}

      {/* Data Integrations */}
      {profileExtended && (
        <Card>
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-cyan-600" />
            Data Integrations
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Market Data Provider</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
                {getMarketDataLabel(profileExtended.market_data_provider, profileExtended.market_data_provider_other)}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Data Needs</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended.needs_realtime_prices ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                  {profileExtended.needs_realtime_prices ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  Realtime Prices
                </div>
                <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended.needs_index_data ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                  {profileExtended.needs_index_data ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  Index Data
                </div>
                <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended.needs_fundamentals ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                  {profileExtended.needs_fundamentals ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  Fundamentals
                </div>
                <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended.needs_estimates ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                  {profileExtended.needs_estimates ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  Estimates
                </div>
                <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${profileExtended.needs_news_feeds ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                  {profileExtended.needs_news_feeds ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  News Feeds
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToSetup}
              className="text-primary-600 hover:text-primary-700"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Update Integrations
            </Button>
          </div>
        </Card>
      )}

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
      </Card>

      {/* Setup Wizard CTA for incomplete profiles */}
      {!onboardingStatus?.wizard_completed && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-100 rounded-lg">
                <Settings className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">Complete Your Profile Setup</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Finish setting up your profile to unlock all features and personalized recommendations.
                </p>
              </div>
            </div>
            <Button onClick={goToSetup}>
              Continue Setup
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
