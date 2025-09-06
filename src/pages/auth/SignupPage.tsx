import { AuthLayout } from '../../components/auth/AuthLayout'
import { SignupForm } from '../../components/auth/SignupForm'

export function SignupPage() {
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start managing your investment ideas today."
    >
      <SignupForm />
    </AuthLayout>
  )
}