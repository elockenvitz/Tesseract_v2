/**
 * What makes `useAuth` call a page load a password recovery.
 *
 * This decides whether `/update-password` renders at all: `App.tsx` gates
 * that route on `isRecoverySession`, and when it is false the route
 * redirects to `/dashboard` or `/login` instead. So a wrong answer here is
 * the difference between "Set your new password" and silently signing the
 * user in with their old password still in place.
 *
 * It was untested, and it is read through `window.location` at mount, which
 * is a thing the app cannot retry. Covered behaviourally — through the
 * hook's own `isRecoverySession` — rather than by exporting the internal
 * helper, so nothing about the implementation changes to accommodate a test.
 *
 * The three shapes it must recognise:
 *   implicit flow   `#type=recovery&access_token=…`   (auth-js 2.x default,
 *                   confirmed in auth-js constants: flowType 'implicit')
 *   PKCE            `/update-password?code=…`
 *   resumed         the sessionStorage flag, for a reload mid-reset
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      // No session: this file is about URL interpretation, not sign-in.
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  },
}))
/*
 * Sentry is spread from the real module rather than stubbed field by field.
 * A hand-written stub has to enumerate every export `useAuth` touches, and
 * missing one (`setTag`) fails the test for a reason unrelated to what it
 * checks.
 */
vi.mock('@sentry/react', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
}))

import { useAuth } from '../useAuth'

const RECOVERY_SESSION_KEY = 'auth-recovery-session'

/** Point `window.location` at a URL without navigating the test runner. */
function at(url: string) {
  const u = new URL(url)
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      ...window.location,
      href: u.href,
      origin: u.origin,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
    },
  })
}

const original = window.location

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: original })
})

const detected = () => renderHook(() => useAuth()).result.current.isRecoverySession

describe('recovery is detected from the URL the email lands on', () => {
  it('implicit flow: #type=recovery in the hash', () => {
    at('https://tesseract2025.netlify.app/update-password#access_token=abc&type=recovery&expires_in=3600')
    expect(detected()).toBe(true)
  })

  it('implicit flow is recognised even if the redirect lands on another path', () => {
    /*
     * If `redirectTo` were ever not on the allowed-redirect list, GoTrue
     * falls back to the Site URL and the hash arrives at `/`. The hash check
     * is deliberately path-independent so that still reads as a recovery
     * rather than an ordinary sign-in.
     */
    at('https://tesseract2025.netlify.app/#access_token=abc&type=recovery')
    expect(detected()).toBe(true)
  })

  it('PKCE: ?code= on the update-password path', () => {
    at('https://tesseract2025.netlify.app/update-password?code=xyz')
    expect(detected()).toBe(true)
  })

  it('resumes from the stored flag after a reload mid-reset', () => {
    sessionStorage.setItem(RECOVERY_SESSION_KEY, 'true')
    at('https://tesseract2025.netlify.app/update-password')
    expect(detected()).toBe(true)
  })
})

describe('an ordinary load is not mistaken for a recovery', () => {
  it('a plain dashboard load is not', () => {
    at('https://tesseract2025.netlify.app/dashboard')
    expect(detected()).toBe(false)
  })

  it('a bare update-password visit with no token is not', () => {
    // Someone typing the URL, or returning after the flag was cleared. The
    // route then redirects rather than offering a password change to a
    // session that did not come from an email.
    at('https://tesseract2025.netlify.app/update-password')
    expect(detected()).toBe(false)
  })

  it('a ?code= on a DIFFERENT path is not — that is the SSO callback', () => {
    // `/auth/sso/callback?code=` must stay an SSO exchange.
    at('https://tesseract2025.netlify.app/auth/sso/callback?code=xyz&state=s')
    expect(detected()).toBe(false)
  })

  it('a non-recovery hash type is not', () => {
    at('https://tesseract2025.netlify.app/#access_token=abc&type=signup')
    expect(detected()).toBe(false)
  })
})
