import { AuthLayout } from '../../components/auth/AuthLayout'
import { ResetPasswordForm } from '../../components/auth/ResetPasswordForm'

export function ResetPasswordPage() {
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email address and we'll send you a reset link."
    >
      <ResetPasswordForm />
    </AuthLayout>
  )
}