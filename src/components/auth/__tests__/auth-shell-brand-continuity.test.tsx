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

/*
 * ── The dead end ─────────────────────────────────────────────────────────
 *
 * Reported from the deploy preview: "when i click sign in it goes to split
 * pane but no way to return to nonsplit".
 *
 * It was literally true. The shell rendered the lockup as a plain <div>, and
 * nothing anywhere on the screen linked back to `/`. A visitor who clicked
 * Sign in from the landing page could only leave with the browser's Back
 * button, and somebody who arrived on `/login` from an email had no route to
 * the public site at all.
 *
 * Pinned as ROLES rather than as specific markup, because the way out has to
 * survive a restyle: what matters is that something focusable goes home, at
 * every viewport, not that it is a particular element in a particular corner.
 */
describe('there is always a way back to the public site', () => {
  it('offers at least one link home from every auth screen', () => {
    for (const [name, ui] of [
      ['Login', <LoginPage />],
      ['Signup', <SignupPage />],
      ['Reset Password', <ResetPasswordPage />],
    ] as const) {
      const { container, unmount } = at(ui)
      const home = [...container.querySelectorAll('a')]
        .filter(a => a.getAttribute('href') === '/')
      expect(home.length, `${name} must offer a way back`).toBeGreaterThan(0)
      unmount()
    }
  })

  it('names that way back in words, not only as a logo', () => {
    at(<LoginPage />)
    /*
      A linked mark is the control people TRY first, but it is not the one
      they can see is a control. The explicit link is what makes the way out
      discoverable, so it is asserted separately.
    */
    const back = screen.getByRole('link', { name: /back to site/i })
    expect(back).toHaveAttribute('href', '/')
  })

  /*
   * ── This test was VACUOUS on its first draft, and the rewrite is the point
   *
   * It first asserted only that SOME mark exists outside the brand panel.
   * That passed against the old shell as well, because the old shell did
   * have a mark outside the panel -- carrying `lg:hidden`, so it showed on a
   * phone and vanished on the wide layout, which is exactly the defect
   * reported. jsdom does not apply media queries, so the element was in the
   * DOM either way and the assertion could not tell the versions apart.
   *
   * Tailwind's responsive visibility IS the mechanism here, so the class is
   * the honest subject. The measured proof that it renders lives in the PR:
   * Playwright at 1440x900 against the built bundle.
   */
  it('shows the mark on the form side at EVERY width, not just on a phone', () => {
    const { container } = at(<LoginPage />)
    const panel = screen.getByTestId('auth-brand-panel')

    const outside = [...container.querySelectorAll('svg')]
      .filter(el => !panel.contains(el))
    expect(outside.length, 'a mark outside the brand panel').toBeGreaterThan(0)

    /* At least one of them must survive the wide layout. */
    const alwaysVisible = outside.filter(el => {
      for (let n: Element | null = el; n && n !== container; n = n.parentElement) {
        if ((n.getAttribute('class') ?? '').includes('lg:hidden')) return false
      }
      return true
    })
    expect(
      alwaysVisible.length,
      'the form column kept a mark that is hidden on the wide layout, which is the reported defect',
    ).toBeGreaterThan(0)
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
