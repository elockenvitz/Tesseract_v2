import { useEffect } from 'react'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { LoginForm } from '../../components/auth/LoginForm'
import { hideBootLoader } from '../../lib/boot-loader'

export function LoginPage() {
  // Login is real content — fade the persistent boot loader if it
  // hasn't been faded already. (Cold-refreshing while signed out
  // lands here directly without going through ProtectedRoute's
  // terminal-screen path.)
  useEffect(() => { hideBootLoader() }, [])
  return (
    <AuthLayout
      title="Sign in to your account"
      subtitle="Welcome back! Please enter your details."
    >
      <LoginForm />
    </AuthLayout>
  )
}