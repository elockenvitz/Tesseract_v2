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
import { InvitePage } from './pages/auth/InvitePage'
// SetupWizardPage removed — org creation is invite-only
import { TesseractLoader } from './components/ui/TesseractLoader'
import { LOADER_ANCHOR } from './components/ui/PageLoader'
import { CaptureOverlay } from './components/capture/CaptureOverlay'
import { CaptureConfigModal } from './components/capture/CaptureConfigModal'
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
      /* The feed's loading state, exactly.
         It was a blue-to-indigo gradient behind a differently-sized mark, so
         the app boot and the ideas feed were visibly two different loading
         screens for the same wait. This is the same background, the same 96px
         mark and the same compact caption the feed uses — and the same clock,
         so a mark appearing here is already in phase with the boot element
         above it and with whatever the feed mounts next. */
      <div className={LOADER_ANCHOR} data-testid="app-loader">
        <TesseractLoader size={96} compact text="Loading…" />
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

      {/* Invitation deep link — the one way into Early Access.
          Deliberately NOT redirected away when a session exists: the page has
          to handle "signed in as the wrong person" and "already accepted",
          and it is what an email-confirmation round-trip returns to. */}
      <Route path="/invite/:token" element={<InvitePage />} />

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