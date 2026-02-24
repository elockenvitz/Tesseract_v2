import { useState, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../hooks/useAuth'
import { checkSsoForEmail } from '../../lib/org-domain-routing'
import type { SsoCheckResult } from '../../types/organization'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Shield } from 'lucide-react'

const loginSchema = z.object({
  email: z.string()
    .email('Please enter a valid email address')
    .min(1, 'Email is required'),
  password: z.string()
    .min(6, 'Password must be at least 6 characters'),
})

type LoginFormData = z.infer<typeof loginSchema>

type SsoState = 'idle' | 'checking' | 'no_sso' | 'sso_optional' | 'sso_required'

export function LoginForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ssoState, setSsoState] = useState<SsoState>('idle')
  const [ssoResult, setSsoResult] = useState<SsoCheckResult | null>(null)
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const lastCheckedDomain = useRef<string | null>(null)

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const handleSsoCheck = useCallback(async (email: string) => {
    // Extract domain to avoid redundant checks
    const atIdx = email.lastIndexOf('@')
    if (atIdx < 1) return
    const domain = email.slice(atIdx + 1).toLowerCase()
    if (!domain.includes('.')) return
    if (domain === lastCheckedDomain.current) return

    lastCheckedDomain.current = domain
    setSsoState('checking')

    const result = await checkSsoForEmail(email)
    setSsoResult(result)

    if (!result.has_sso) {
      setSsoState('no_sso')
    } else if (result.sso_only) {
      setSsoState('sso_required')
    } else {
      setSsoState('sso_optional')
    }
  }, [])

  const handleEmailBlur = useCallback(() => {
    const email = getValues('email')
    if (email && email.includes('@')) {
      handleSsoCheck(email)
    }
  }, [getValues, handleSsoCheck])

  const handleSsoLogin = useCallback(() => {
    if (!ssoResult?.discovery_url || !ssoResult?.client_id) return
    setError(null)

    // Store SSO context for callback
    const state = crypto.randomUUID()
    const nonce = crypto.randomUUID()
    const codeVerifier = crypto.randomUUID() + crypto.randomUUID()
    sessionStorage.setItem('sso_state', state)
    sessionStorage.setItem('sso_nonce', nonce)
    sessionStorage.setItem('sso_code_verifier', codeVerifier)
    sessionStorage.setItem('sso_org_id', ssoResult.org_id || '')

    // Generate PKCE code challenge (S256)
    const encoder = new TextEncoder()
    crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier)).then((hash) => {
      const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

      // Fetch discovery document to get authorization_endpoint
      fetch(ssoResult.discovery_url!)
        .then((r) => r.json())
        .then((config) => {
          const authUrl = new URL(config.authorization_endpoint)
          authUrl.searchParams.set('client_id', ssoResult.client_id!)
          authUrl.searchParams.set('redirect_uri', `${window.location.origin}/auth/sso/callback`)
          authUrl.searchParams.set('response_type', 'code')
          authUrl.searchParams.set('scope', 'openid email profile')
          authUrl.searchParams.set('state', state)
          authUrl.searchParams.set('nonce', nonce)
          authUrl.searchParams.set('code_challenge', codeChallenge)
          authUrl.searchParams.set('code_challenge_method', 'S256')

          window.location.href = authUrl.toString()
        })
        .catch(() => {
          setError('Failed to connect to identity provider. Please try again.')
        })
    })
  }, [ssoResult])

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true)
    setError(null)

    try {
      // Ensure SSO check has run (handles autofill/paste where blur never fires)
      let effectiveSsoState = ssoState
      if (ssoState === 'idle' || ssoState === 'checking') {
        const result = await checkSsoForEmail(data.email)
        setSsoResult(result)
        if (result.has_sso && result.sso_only) {
          effectiveSsoState = 'sso_required'
          setSsoState('sso_required')
        } else if (result.has_sso) {
          effectiveSsoState = 'sso_optional'
          setSsoState('sso_optional')
        } else {
          effectiveSsoState = 'no_sso'
          setSsoState('no_sso')
        }
      }

      // Block password login for SSO-required orgs
      if (effectiveSsoState === 'sso_required') {
        setError('This organization requires SSO sign-in. Use the "Sign in with SSO" button.')
        return
      }

      const { error } = await signIn(data.email, data.password)
      if (error) {
        setError(error.message)
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const showPasswordField = ssoState !== 'sso_required'
  const showSsoButton = ssoState === 'sso_optional' || ssoState === 'sso_required'

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <div className="bg-error-50 border border-error-200 text-error-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <Input
        label="Email address"
        type="email"
        autoComplete="off"
        {...register('email')}
        onBlur={handleEmailBlur}
        error={errors.email?.message}
        loading={ssoState === 'checking'}
      />

      {/* SSO-required banner */}
      {ssoState === 'sso_required' && ssoResult?.org_name && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <Shield className="w-4 h-4 mt-0.5 flex-shrink-0 text-indigo-600" />
          <div>
            <p className="text-sm font-medium">{ssoResult.org_name} requires SSO</p>
            <p className="text-xs text-indigo-600 mt-0.5">
              Password sign-in is disabled for this organization. Use the SSO button below.
            </p>
          </div>
        </div>
      )}

      {showPasswordField && (
        <>
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
            error={errors.password?.message}
          />

          <div className="flex items-center justify-between">
            <Link
              to="/reset-password"
              className="text-sm text-primary-600 hover:text-primary-500"
            >
              Forgot your password?
            </Link>
          </div>

          <Button
            type="submit"
            loading={loading}
            className="w-full"
          >
            Sign in
          </Button>
        </>
      )}

      {/* SSO button */}
      {showSsoButton && (
        <>
          {showPasswordField && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-400">or</span>
              </div>
            </div>
          )}

          <Button
            type="button"
            variant={ssoState === 'sso_required' ? 'primary' : 'outline'}
            className="w-full"
            onClick={handleSsoLogin}
          >
            <Shield className="w-4 h-4 mr-2" />
            Sign in with SSO
            {ssoResult?.org_name && (
              <span className="ml-1 text-xs opacity-75">({ssoResult.org_name})</span>
            )}
          </Button>
        </>
      )}

      <div className="text-center">
        <span className="text-sm text-gray-600">
          Don't have an account?{' '}
          <Link
            to="/signup"
            className="font-medium text-primary-600 hover:text-primary-500"
          >
            Sign up
          </Link>
        </span>
      </div>
    </form>
  )
}
