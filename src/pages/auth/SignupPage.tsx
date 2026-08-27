import { useEffect } from 'react'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { EarlyAccessNotice } from '../../components/auth/EarlyAccessNotice'
import { hideBootLoader } from '../../lib/boot-loader'

export function SignupPage() {
  useEffect(() => { hideBootLoader() }, [])
  return (
    <AuthLayout
      title="Tesseract Professional Early Access"
      subtitle="Access is by invitation."
    >
      <EarlyAccessNotice />
    </AuthLayout>
  )
}
