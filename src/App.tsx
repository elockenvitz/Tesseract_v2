import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from './lib/supabase'
import { useAuth } from './hooks/useAuth'
import { ThemeProvider } from './contexts/ThemeContext'
import { CaptureProvider } from './contexts/CaptureContext'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { ErrorBoundary, ToastProvider } from './components/common'
import { ProtectedRoute } from './components/ProtectedRoute'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/auth/LoginPage'
import { SignupPage } from './pages/auth/SignupPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { UpdatePasswordPage } from './pages/auth/UpdatePasswordPage'
import { SsoCallbackPage } from './pages/auth/SsoCallbackPage'
// SetupWizardPage removed — org creation is invite-only
import { TesseractLoader } from './components/ui/TesseractLoader'
import { CaptureOverlay } from './components/capture/CaptureOverlay'
import { CaptureConfigModal } from './components/capture/CaptureConfigModal'
import { MorphBanner } from './components/support/MorphBanner'
import { OpsGuard } from './components/ops/OpsGuard'
import { OpsLayout } from './components/ops/OpsLayout'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false, // Disable constant refetching on window focus
      refetchOnMount: true,
    },
  },
})

function AppRoutes() {
  const { user, loading, isRecoverySession } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <TesseractLoader size={120} text="Initializing Tesseract..." />
      </div>
    )
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/signup"
        element={user ? <Navigate to="/dashboard" replace /> : <SignupPage />}
      />
      <Route
        path="/reset-password"
        element={user ? <Navigate to="/dashboard" replace /> : <ResetPasswordPage />}
      />
      <Route
        path="/update-password"
        element={isRecoverySession ? <UpdatePasswordPage /> : <Navigate to={user ? "/dashboard" : "/login"} replace />}
      />
      <Route
        path="/auth/sso/callback"
        element={<SsoCallbackPage />}
      />

      {/* Setup Wizard disabled — org creation is invite-only */}
      <Route path="/setup" element={
        <Navigate to="/dashboard" replace />
      } />

      {/* Operations Portal — separate layout for platform staff */}
      <Route path="/ops/*" element={
        <ProtectedRoute>
          <OpsGuard>
            <OpsLayout />
          </OpsGuard>
        </ProtectedRoute>
      } />

      {/* Protected routes — the product */}
      <Route path="/*" element={
        <ProtectedRoute>
          <DashboardPage />
        </ProtectedRoute>
      } />

      {/* Default redirect */}
      <Route
        path="/"
        element={<Navigate to={user ? "/dashboard" : "/login"} replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <CaptureProvider>
              <Router>
                <OrganizationProvider>
                  <AppRoutes />
                  <MorphBanner />
                </OrganizationProvider>
                {/* Global capture mode components */}
                <CaptureOverlay />
                <CaptureConfigModal />
              </Router>
            </CaptureProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App