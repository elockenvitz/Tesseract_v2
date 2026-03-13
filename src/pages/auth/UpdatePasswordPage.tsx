import { AuthLayout } from '../../components/auth/AuthLayout'
import { UpdatePasswordForm } from '../../components/auth/UpdatePasswordForm'

export function UpdatePasswordPage() {
  return (
    <AuthLayout
      title="Set your new password"
      subtitle="Enter a new password for your account."
    >
      <UpdatePasswordForm />
    </AuthLayout>
  )
}
