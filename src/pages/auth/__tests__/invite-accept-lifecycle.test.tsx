/**
 * An invited person joins on the first attempt, without reloading.
 *
 * ── The defect this pins ─────────────────────────────────────────────────
 *
 * Observed in production with a real disposable invitation: signup succeeded,
 * the Auth user was created and auto-confirmed, the page showed "Setting up
 * your workspace" — and `accept_org_invite` was never called. The invitation
 * stayed `pending`, no membership existed, and the screen offered no error
 * and no retry. It sat there indefinitely. Reloading completed it instantly.
 *
 * The cause was a deadlock between two flags, not a race:
 *
 *   `onCreateAccount` left `busy = true` after a successful signup, on the
 *   theory that the accept effect would take over. The accept effect required
 *   `!busy`. It woke when the session arrived, found `busy` still true,
 *   declined — and none of its three dependencies ever changed again, so it
 *   was never asked twice. The gate could not open. A reload cleared it only
 *   because a fresh mount starts with `busy = false`.
 *
 * These cases drive the real component through that exact sequence: signed
 * out, submit signup, session appears, auth context updates. Reverting either
 * half of the fix puts them red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const TOKEN = 'b68a8504-3463-4718-91d2-6fbd7f84b7d9'
const INVITED = 'invited@firm.test'

/** Every call the page made to the acceptance RPC. */
const acceptCalls: string[] = []
/** What `acceptInvite` should return next. */
let acceptResult: { error?: string; needsEmailConfirmation?: boolean } = {}

vi.mock('../../../lib/invites', () => ({
  acceptInvite: async (token: string) => {
    acceptCalls.push(token)
    return acceptResult
  },
  getInvitePreview: async () => ({
    valid: true,
    email: INVITED,
    orgName: 'North Harbor Capital',
  }),
  clearPendingInvite: () => {},
  stashPendingInvite: () => {},
  markPendingInviteMismatch: () => {},
  inviteConfirmationRedirect: () => `https://app.test/invite/${TOKEN}`,
}))

vi.mock('../../../lib/boot-loader', () => ({ hideBootLoader: () => {} }))

/**
 * A controllable auth context.
 *
 * The whole defect lives in the moment between "signUp resolved with a
 * session" and "the auth context reports a user", so the test has to own that
 * transition rather than let a mock resolve both at once.
 */
const auth = {
  user: null as null | { id: string; email: string },
  loading: false,
  signUpResult: { data: { session: {} }, error: null } as unknown,
}
const signUp = vi.fn(async () => auth.signUpResult)
const signIn = vi.fn(async () => ({ error: null }))

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: auth.user,
    loading: auth.loading,
    signUp,
    signIn,
    signOut: vi.fn(),
    resendConfirmation: vi.fn(async () => ({ error: null })),
  }),
}))

import { InvitePage } from '../InvitePage'

/** Re-render with the auth context in its new state, as the provider would. */
let rerenderPage: () => void

function renderPage() {
  const view = render(
    <MemoryRouter initialEntries={[`/invite/${TOKEN}`]}>
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Routes>
    </MemoryRouter>,
  )
  rerenderPage = () =>
    view.rerender(
      <MemoryRouter initialEntries={[`/invite/${TOKEN}`]}>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
        </Routes>
      </MemoryRouter>,
    )
  return view
}

/** The session landing: what `useAuth` does a tick after signUp resolves. */
async function authSettles() {
  await act(async () => {
    auth.user = { id: 'u1', email: INVITED }
    rerenderPage()
    await Promise.resolve()
  })
}

async function submitSignup() {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('First name'), 'Dana')
  await user.type(screen.getByLabelText('Last name'), 'Reyes')
  await user.type(screen.getByLabelText('Password'), 'correct horse battery')
  await user.click(screen.getByRole('button', { name: /create account and join/i }))
}

beforeEach(() => {
  acceptCalls.length = 0
  acceptResult = {}
  auth.user = null
  auth.loading = false
  auth.signUpResult = { data: { session: {} }, error: null }
  signUp.mockClear()
  // jsdom refuses a real navigation; the page assigns on success.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: vi.fn() },
  })
})

describe('joining on the first attempt', () => {
  it('accepts the invitation once the session arrives, with no reload', async () => {
    renderPage()
    await submitSignup()
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))

    // Nothing has been accepted yet — there was no session to accept with.
    expect(acceptCalls).toHaveLength(0)

    await authSettles()

    // THE REGRESSION. Before the fix this stayed at zero forever: the effect
    // ran, saw the form's `busy` flag still raised, and declined permanently.
    await waitFor(() => expect(acceptCalls, 'acceptance never fired').toHaveLength(1))
    expect(acceptCalls[0]).toBe(TOKEN)
  })

  it('sends the user on to the product', async () => {
    renderPage()
    await submitSignup()
    await authSettles()

    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/dashboard'))
  })

  it('does not accept twice when the context updates again', async () => {
    // Auth providers re-publish. Acceptance is idempotent server-side, but a
    // second call would still be a second round trip and a second chance to
    // race, so the once-guard is pinned here.
    renderPage()
    await submitSignup()
    await authSettles()
    await waitFor(() => expect(acceptCalls).toHaveLength(1))

    await authSettles()
    await authSettles()

    expect(acceptCalls, 'the once-guard let a duplicate through').toHaveLength(1)
  })

  it('accepts for an already-signed-in arrival too', async () => {
    // The reload path, which was the only one that worked before. It must
    // keep working: it is what someone opening the link in a signed-in
    // browser does.
    auth.user = { id: 'u1', email: INVITED }
    renderPage()

    await waitFor(() => expect(acceptCalls).toHaveLength(1))
  })
})

describe('when acceptance genuinely fails', () => {
  it('leaves the spinner and offers a retry', async () => {
    acceptResult = { error: 'Something went wrong joining this workspace.' }
    renderPage()
    await submitSignup()
    await authSettles()

    await waitFor(() => expect(acceptCalls).toHaveLength(1))
    // The invariant: a failure must become actionable, never a forever
    // spinner. This is what the production hang failed to do.
    expect(await screen.findByText(/something went wrong joining/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    expect(screen.queryByText(/setting up your workspace/i)).toBeNull()
  })

  it('retries on demand, and succeeds', async () => {
    acceptResult = { error: 'Temporary failure.' }
    renderPage()
    await submitSignup()
    await authSettles()
    await waitFor(() => expect(acceptCalls).toHaveLength(1))

    acceptResult = {}
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => expect(acceptCalls).toHaveLength(2))
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/dashboard'))
  })

  it('routes an unconfirmed identity to the screen that can fix it', async () => {
    acceptResult = { error: 'Confirm your email', needsEmailConfirmation: true }
    renderPage()
    await submitSignup()
    await authSettles()

    await waitFor(() => expect(acceptCalls).toHaveLength(1))
    // Not a dead spinner and not a raw error — the one state with an obvious
    // next action.
    expect(await screen.findByText(/confirm your email/i)).toBeTruthy()
    expect(screen.queryByText(/setting up your workspace/i)).toBeNull()
  })

  it('never leaves the joining screen spinning with nothing in flight', async () => {
    // The shape of the production bug, asserted directly: if the page is on
    // the joining screen, either something is happening or there is a way
    // forward.
    acceptResult = { error: 'Nope.' }
    renderPage()
    await submitSignup()
    await authSettles()
    await waitFor(() => expect(acceptCalls).toHaveLength(1))

    const spinning = screen.queryByText(/setting up your workspace/i)
    const actionable =
      screen.queryByRole('button', { name: /try again/i }) ??
      screen.queryByRole('button', { name: /continue/i })
    expect(spinning === null && actionable !== null).toBe(true)
  })
})
