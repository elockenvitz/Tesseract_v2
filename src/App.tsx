import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from './lib/supabase'
import { useAuth } from './hooks/useAuth'
import { ThemeProvider } from './contexts/ThemeContext'
import { CaptureProvider } from './contexts/CaptureContext'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { CoverageRelevanceProvider } from './contexts/CoverageRelevanceProvider'
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
import { hideBootLoader } from './lib/boot-loader'

/* Legal pages: lazy, because react-markdown is a dependency nobody reaching
   the dashboard should pay for. */
const LegalIndexPage = lazy(() =>
  import('./pages/legal/LegalIndexPage').then(m => ({ default: m.LegalIndexPage })),
)
const LegalDocumentPage = lazy(() =>
  import('./pages/legal/LegalDocumentPage').then(m => ({ default: m.LegalDocumentPage })),
)

/* The Suspense fallback for the legal routes.
 *
 * Eager, not lazy. A lazy fallback would suspend while React was already
 * rendering a fallback, which React treats as an error -- so this must stay a
 * plain component even though its twin lives in LegalPageShell.tsx.
 *
 * It fades the boot loader, and it has to: index.html paints
 * #tesseract-boot-loader over everything at z-index 2147483647 until
 * hideBootLoader() is called, and neither AuthLayout nor ProtectedRoute runs
 * for these public routes. Without this call the pages render correctly
 * underneath an opaque "Loading…" -- which is exactly what happened on the
 * first browser check.
 *
 * Plain text rather than TesseractLoader: a full-screen animated mark for a
 * small chunk is heavier than the wait it covers. Light palette only, because
 * `darkMode: 'class'` means a signed-out visitor has no theme class and any
 * `dark:` variant here would be dead. */
function LegalFallback() {
  useEffect(() => { hideBootLoader() }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-12 text-slate-500 sm:px-6 lg:px-8">
        Loading…
      </div>
    </div>
  )
}

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

      {/* Legal documents — public, and public on purpose.

          Two things about the placement matter and neither is obvious:

          * These MUST sit above the `/*` catch-all below. react-router takes
            the first match, and `/*` is wrapped in ProtectedRoute — so placed
            underneath, /legal/privacy-policy would bounce a signed-out visitor
            to the login page. A privacy policy nobody can read without an
            account is not a published privacy policy.

          * They are NOT redirected away when a session exists. A signed-in
            user reading the terms they accepted is the normal case, and it is
            the one an auditor will ask about.

          Lazily loaded: they are read rarely, they pull in react-markdown, and
          this bundle's entry chunk has been a P0 once already. */}
      <Route path="/legal" element={
        <Suspense fallback={<LegalFallback />}>
          <LegalIndexPage />
        </Suspense>
      } />
      <Route path="/legal/:documentId" element={
        <Suspense fallback={<LegalFallback />}>
          <LegalDocumentPage />
        </Suspense>
      } />

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
                  {/* Inside the organization, because coverage is scoped to
                      it — see CoverageRelevanceContext. One fetch for the
                      whole tree; cards read the context, not the database. */}
                  <CoverageRelevanceProvider>
                    <AppRoutes />
                  </CoverageRelevanceProvider>
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