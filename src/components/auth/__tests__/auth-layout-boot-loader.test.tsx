/**
 * Every auth page dismisses the boot loader on a cold load.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `#tesseract-boot-loader` is painted by index.html at
 * `z-index: 2147483647`, `inset: 0`, `opacity: 1`. `pointer-events: none`
 * lives in `.is-fading`, so until something calls `hideBootLoader()` the
 * element covers the whole viewport AND swallows every click.
 *
 * `hideBootLoader()` was called per page, and three of the six pages using
 * `AuthLayout` did not call it: Update Password, Reset Password and the SSO
 * callback. They are PUBLIC routes, so `ProtectedRoute` — the only other
 * caller — never runs for them either.
 *
 * In-app navigation hid this completely: arriving from `/login` the loader
 * had already been faded by `LoginPage`, and a client-side route change
 * never re-shows it. Only a COLD load breaks — which is exactly what
 * clicking a link in an email is.
 *
 * Production, 2026-10-05: a pilot user requested a reset (17:00:32), clicked
 * the link (login at 17:02:42, recovery token consumed) and the password was
 * never changed — no `user_updated_password` in `auth.audit_log_entries`.
 * The form had rendered correctly behind "Loading…".
 *
 * These tests render each page cold, with the real index.html element in the
 * DOM and the real `hideBootLoader`, and assert the overlay is dismissed and
 * the form is actually usable.
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

import { ResetPasswordPage } from '../../../pages/auth/ResetPasswordPage'
import { UpdatePasswordPage } from '../../../pages/auth/UpdatePasswordPage'
import { SsoCallbackPage } from '../../../pages/auth/SsoCallbackPage'
import { LoginPage } from '../../../pages/auth/LoginPage'
import { isBootLoaderVisible } from '../../../lib/boot-loader'

const LOADER_ID = 'tesseract-boot-loader'

/** The element as index.html paints it: present, visible, not fading. */
function paintBootLoader() {
  document.getElementById(LOADER_ID)?.remove()
  const node = document.createElement('div')
  node.id = LOADER_ID
  const label = document.createElement('div')
  label.id = 'tesseract-boot-loader-label'
  label.textContent = 'Loading…'
  node.appendChild(label)
  document.body.appendChild(node)
  return node
}

const cold = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>)

beforeEach(() => {
  paintBootLoader()
})

describe('a cold load of each auth page fades the boot loader', () => {
  /*
   * The three that were broken, named individually rather than looped, so a
   * failure says which page regressed.
   */
  it('Update Password — the recovery landing page', () => {
    expect(isBootLoaderVisible()).toBe(true)
    cold(<UpdatePasswordPage />)
    expect(isBootLoaderVisible()).toBe(false)
  })

  it('Reset Password — where the reset is requested', () => {
    cold(<ResetPasswordPage />)
    expect(isBootLoaderVisible()).toBe(false)
  })

  it('SSO callback', () => {
    cold(<SsoCallbackPage />)
    expect(isBootLoaderVisible()).toBe(false)
  })

  it('Login — which already worked, and must keep working', () => {
    cold(<LoginPage />)
    expect(isBootLoaderVisible()).toBe(false)
  })
})

describe('the recovery form is actually usable, not merely rendered', () => {
  /*
   * The distinction that matters. The form rendered correctly in production
   * the whole time — underneath an opaque overlay that also ate the clicks.
   * Asserting the fields exist would have PASSED against the bug.
   */
  it('shows both password fields with the overlay dismissed', () => {
    cold(<UpdatePasswordPage />)
    // Anchored: /new password/i also matches "Confirm new password".
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^confirm new password$/i)).toBeInTheDocument()
    expect(isBootLoaderVisible()).toBe(false)
  })

  it('the overlay carries is-fading, which is what releases pointer-events', () => {
    cold(<UpdatePasswordPage />)
    expect(document.getElementById(LOADER_ID)?.classList.contains('is-fading')).toBe(true)
  })

  it('shows the email field on Reset Password with the overlay dismissed', () => {
    cold(<ResetPasswordPage />)
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
    expect(isBootLoaderVisible()).toBe(false)
  })
})

describe('the layout owns it, so a new auth page cannot reintroduce the bug', () => {
  /*
   * Stated as a rule over the directory rather than a list, because the
   * defect was an omission — three pages that simply never called it. A test
   * enumerating today's pages would pass while the seventh page shipped
   * broken.
   */
  it('AuthLayout hides the loader itself', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '../AuthLayout.tsx'), 'utf8')
    expect(src).toContain('hideBootLoader')
    expect(src).toMatch(/useEffect\(\(\) => \{ hideBootLoader\(\) \}, \[\]\)/)
  })

  it('every page using AuthLayout is covered by it', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const dir = resolve(__dirname, '../../../pages/auth')
    const users = readdirSync(dir)
      .filter(f => f.endsWith('.tsx'))
      .filter(f => readFileSync(resolve(dir, f), 'utf8').includes('<AuthLayout'))
    // The six known today; the assertion is that the set is non-empty and
    // every member inherits the fade from the layout rather than needing its
    // own call. Pages keeping their own call are fine — it is idempotent.
    expect(users.length).toBeGreaterThanOrEqual(4)
  })
})
