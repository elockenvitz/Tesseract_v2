import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useOnboarding } from '../hooks/useOnboarding'
import { TesseractLoader } from './ui/TesseractLoader'

interface ProtectedRouteProps {
  children: React.ReactNode
  skipOnboardingCheck?: boolean
}

export function ProtectedRoute({ children, skipOnboardingCheck = false }: ProtectedRouteProps) {
  const { user, loading: authLoading } = useAuth()
  const { shouldShowWizard, isLoading: onboardingLoading } = useOnboarding()
  const location = useLocation()

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <TesseractLoader size={100} text="Verifying access..." />
      </div>
    )
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Show loading while checking onboarding status (only if we need to check)
  if (!skipOnboardingCheck && onboardingLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <TesseractLoader size={100} text="Preparing your workspace..." />
      </div>
    )
  }

  // Redirect to setup wizard if not completed (unless we're skipping the check)
  if (!skipOnboardingCheck && shouldShowWizard && location.pathname !== '/setup') {
    return <Navigate to="/setup" state={{ from: location }} replace />
  }

  return <>{children}</>
}
