/**
 * SsoCallbackPage — Handles the OIDC authorization code callback.
 *
 * After the IdP redirects back with ?code=...&state=..., this page:
 * 1. Validates the state parameter against sessionStorage
 * 2. Sends code + code_verifier to the sso-token-exchange Edge Function
 * 3. On success, signs in via Supabase Auth and navigates to /dashboard
 * 4. On failure, shows an error with a link back to /login
 */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { TesseractLoader } from '../../components/ui/TesseractLoader'
import { Button } from '../../components/ui/Button'
import { AlertTriangle } from 'lucide-react'

export function SsoCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(true)

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const errorParam = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    // Handle IdP-side errors
    if (errorParam) {
      setError(errorDescription || `SSO error: ${errorParam}`)
      setProcessing(false)
      return
    }

    if (!code || !state) {
      setError('Missing authorization code or state. Please try signing in again.')
      setProcessing(false)
      return
    }

    // Validate state
    const savedState = sessionStorage.getItem('sso_state')
    const savedNonce = sessionStorage.getItem('sso_nonce')
    const codeVerifier = sessionStorage.getItem('sso_code_verifier')
    const orgId = sessionStorage.getItem('sso_org_id')

    if (state !== savedState) {
      setError('Invalid state parameter. This may be a CSRF attack. Please try again.')
      setProcessing(false)
      return
    }

    if (!codeVerifier) {
      setError('Missing PKCE verifier. Please try signing in again.')
      setProcessing(false)
      return
    }

    // Clear SSO session data
    sessionStorage.removeItem('sso_state')
    sessionStorage.removeItem('sso_nonce')
    sessionStorage.removeItem('sso_code_verifier')
    sessionStorage.removeItem('sso_org_id')

    // Exchange code for tokens via Edge Function
    exchangeCode(code, codeVerifier, orgId || undefined, savedNonce || undefined)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function exchangeCode(code: string, codeVerifier: string, orgId?: string, nonce?: string) {
    try {
      const { data, error: fnError } = await supabase.functions.invoke('sso-token-exchange', {
        body: {
          code,
          code_verifier: codeVerifier,
          redirect_uri: `${window.location.origin}/auth/sso/callback`,
          org_id: orgId,
          nonce,
        },
      })

      if (fnError || data?.error) {
        setError(fnError?.message || data?.error || 'Token exchange failed. Please try again.')
        setProcessing(false)
        return
      }

      // Handle response based on method
      if (data?.method === 'redirect' && data?.action_link) {
        // Edge Function returned a magic link — navigate to it for auto sign-in
        window.location.href = data.action_link
        return
      }

      if (data?.method === 'verify_otp' && data?.token_hash) {
        // Edge Function returned an OTP hash — verify it client-side
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: 'magiclink',
        })

        if (verifyError) {
          setError(verifyError.message)
          setProcessing(false)
          return
        }

        navigate('/dashboard', { replace: true })
        return
      }

      // Fallback: if Edge Function returned session tokens directly
      if (data?.access_token) {
        const { error: authError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        })

        if (authError) {
          setError(authError.message)
          setProcessing(false)
          return
        }

        navigate('/dashboard', { replace: true })
        return
      }

      setError('Unexpected response from SSO service. Please try again.')
      setProcessing(false)
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred during SSO sign-in.')
      setProcessing(false)
    }
  }

  if (processing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <TesseractLoader size={100} text="Completing SSO sign-in..." />
      </div>
    )
  }

  // Error state
  return (
    <AuthLayout title="SSO Sign-In Failed">
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-600" />
          </div>
        </div>
        <p className="text-sm text-gray-600">{error}</p>
        <Button
          variant="primary"
          className="w-full"
          onClick={() => navigate('/login', { replace: true })}
        >
          Back to Login
        </Button>
      </div>
    </AuthLayout>
  )
}
