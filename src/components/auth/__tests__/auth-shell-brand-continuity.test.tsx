/**
 * The sign-in screens belong to the same product as the public site.
 *
 * ── The defect this pins ─────────────────────────────────────────────────
 *
 * `AuthLayout` is the shell for all six authentication screens: Login,
 * Signup, Reset Password, Update Password, the SSO callback and the invite
 * page. It rendered a centred card on `bg-gray-50` beneath
 * `/Tesseract Logo.png`, a YELLOW wordmark that appears nowhere else in the
 * product, while the public landing page is near-black with the geometric
 * `TesseractLogo` and one blue accent. The tab even said a different thing:
 * index.html carried "Tesseract | Investment Intelligence", the older
 * positioning, against the landing page's "decision operating system".
 *
 * A prospect who read the site and then clicked Sign in arrived somewhere
 * that looked like different software from a different company.
 *
 * ── Why these assertions and not a snapshot ──────────────────────────────
 *
 * A snapshot would pin the markup and fail on every legitimate restyle. What
 * has to survive a restyle is narrower: the brand panel exists on the wide
 * layout, it carries the positioning the site uses, the yellow wordmark is
 * gone, and -- the part that matters most -- the FORM still renders, because
 * a redesign that quietly broke a password field would otherwise look green.
 *
 * Non-vacuity is recorded in the PR rather than asserted here: restoring the
 * old `AuthLayout` fails `the brand panel`, `the positioning`, `the lifecycle`
 * and `no yellow wordmark`, four of the six cases below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  },
}))

import { LoginPage } from '../../../pages/auth/LoginPage'
import { SignupPage } from '../../../pages/auth/SignupPage'
import { ResetPasswordPage } from '../../../pages/auth/ResetPasswordPage'

const at = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

beforeEach(() => {
  document.getElementById('tesseract-boot-loader')?.remove()
})

describe('every auth screen is visibly the same product as the public site', () => {
  it('carries the brand panel', () => {
    at(<LoginPage />)
    expect(screen.getByTestId('auth-brand-panel')).toBeInTheDocument()
  })

  it('states the positioning the landing page states', () => {
    at(<LoginPage />)
    const panel = screen.getByTestId('auth-brand-panel')
    expect(panel.textContent).toMatch(/the decision operating system for investment teams/i)
    /* The thematic line the site is built around, kept verbatim. */
    expect(panel.textContent).toMatch(/every investment decision has a story/i)
    expect(panel.textContent).toMatch(/make sure your firm remembers it/i)
  })

  it('names the lifecycle stages the landing page names', () => {
    at(<LoginPage />)
    const panel = screen.getByTestId('auth-brand-panel')
    for (const stage of ['Research', 'Develop', 'Recommend', 'Decide', 'Review']) {
      expect(panel.textContent, stage).toContain(stage)
    }
  })

  it('no longer shows the yellow wordmark that exists nowhere else', () => {
    const { container } = at(<LoginPage />)
    const srcs = [...container.querySelectorAll('img')].map(i => i.getAttribute('src') ?? '')
    expect(srcs.join(' | ')).not.toMatch(/Tesseract Logo\.png/i)
  })

  /*
   * EXACTLY ONCE, which is the bug this caught.
   *
   * The brand panel carried the not-an-adviser disclaimer and so does
   * `LegalFooter` in the form column. At 1440x900 both were on screen
   * together, twenty lines apart. The panel's copy was removed and the
   * footer keeps it, because the footer is the component that owns it.
   */
  it('states the not-an-adviser disclaimer once, not twice', () => {
    const { container } = at(<LoginPage />)
    const hits = (container.textContent ?? '')
      .match(/not an investment adviser or a broker-dealer/gi) ?? []
    expect(hits.length, 'one disclaimer per screen').toBe(1)
    expect(screen.getByTestId('auth-brand-panel').textContent)
      .not.toMatch(/not an investment adviser/i)
  })
})

describe('the redesign did not break what the screens are for', () => {
  it('Login still renders both credential fields and its submit', () => {
    at(<LoginPage />)
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('Login still offers password recovery and a route for a new firm', () => {
    at(<LoginPage />)
    expect(screen.getByRole('link', { name: /forgot your password/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument()
  })

  it('Reset Password still renders its email field', () => {
    at(<ResetPasswordPage />)
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
  })

  /*
   * The access-request route off `/signup` is the only lead-capture path the
   * authenticated side exposes, and it is the one Netlify Forms now registers.
   * It is asserted as reachable, not as a particular control, because it
   * renders as a link OR a button depending on `ACCESS_REQUEST_ROUTE.mode`.
   */
  it('Signup still routes a prospective firm somewhere', () => {
    const { container } = at(<SignupPage />)
    const reachable =
      screen.queryByRole('button', { name: /request access/i }) ??
      screen.queryByRole('link', { name: /request access/i }) ??
      container.querySelector('[data-contact-mode]')
    expect(reachable, 'a visitor must always have somewhere to go').toBeTruthy()
  })
})
