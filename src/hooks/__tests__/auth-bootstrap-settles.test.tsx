/**
 * The bootstrap always settles, whatever the stored session turns out to be.
 *
 * ── What was actually wrong, and what was not ─────────────────────────────
 *
 * `loading` starts true and is cleared only at the end of
 * `handleAuthSession`. That call hung off a bare `.then`, so any rejection
 * from `getSession()` skipped it and left `loading` true for the life of the
 * page: no error, no sign-in screen, nothing to click.
 *
 * It is worth being precise about what this does NOT fix, because an earlier
 * report of mine got it wrong. An EXPIRED ACCESS TOKEN does not reach this
 * path. supabase-js refreshes it from the refresh token and `getSession()`
 * resolves normally — verified in the running app, where a token eight days
 * expired refreshed on load and the Dashboard rendered. What I had taken for
 * a hang was a slow cold start: the refresh serialises every `useAuth` caller
 * behind supabase-js's single auth lock, and I did not wait it out.
 *
 * The rejection path is still real and still strands the reader. It is
 * reached by a persisted session that will not parse, a refresh token the
 * server has revoked, and a network failure during refresh — three of the
 * states this suite enumerates.
 *
 * ── Why there is no timeout ───────────────────────────────────────────────
 *
 * A legitimate cold start with a refresh can take tens of seconds on a dev
 * build. Any timeout short enough to catch a stuck bootstrap would sign out
 * readers who were merely waiting, so the fix handles the rejection rather
 * than guessing a deadline. `settlesEventually` below asserts the outcome,
 * never a duration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

const env = vi.hoisted(() => ({
  getSession: vi.fn(),
  authCallback: null as null | ((e: string, s: unknown) => void),
  profile: { id: 'u1', email: 'eric@bogey.cap', first_name: 'Eric', current_organization_id: 'org-1' },
  profileRejects: false,
}))

vi.mock('@sentry/react', () => ({ setUser: vi.fn(), setTag: vi.fn() }))
vi.mock('../../lib/org-domain-routing', () => ({
  titleCase: (s: string) => s,
  routeOrgByEmail: vi.fn(async () => ({ profile: env.profile, routeResult: null })),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => env.getSession(),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        env.authCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (env.profileRejects) throw new Error('profile read failed')
            return { data: env.profile, error: null }
          },
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: async () => ({ error: null }),
    }),
  },
}))

import { useAuth } from '../useAuth'

/** Renders the three facts a reader can distinguish: loading, signed in, signed out. */
function Consumer() {
  const { user, loading } = useAuth()
  return (
    <span data-testid="state">
      {loading ? 'loading' : user ? `signed-in:${(user as { id: string }).id}` : 'signed-out'}
    </span>
  )
}

const SESSION = { access_token: 't1', user: { id: 'u1', email: 'eric@bogey.cap', user_metadata: {} } }

/** The outcome, never a duration — see the note above about timeouts. */
const settlesEventually = async (expected: string) =>
  waitFor(() => expect(screen.getByTestId('state').textContent).toBe(expected))

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  env.getSession.mockReset()
  env.authCallback = null
  env.profileRejects = false
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('sessions that resolve', () => {
  it('a valid session signs the reader in', async () => {
    env.getSession.mockResolvedValue({ data: { session: SESSION } })
    render(<Consumer />)
    await settlesEventually('signed-in:u1')
  })

  it('an expired access token is NOT this path — a refreshed session just resolves', async () => {
    /*
     * supabase-js hands back the refreshed session; the hook never learns the
     * old one had expired. Asserted so the distinction survives: the earlier
     * diagnosis blamed this case for a stranding it cannot cause.
     */
    env.getSession.mockResolvedValue({ data: { session: { ...SESSION, access_token: 'refreshed' } } })
    render(<Consumer />)
    await settlesEventually('signed-in:u1')
  })

  it('no session at all settles signed out rather than loading', async () => {
    env.getSession.mockResolvedValue({ data: { session: null } })
    render(<Consumer />)
    await settlesEventually('signed-out')
  })
})

describe('sessions that cannot be read — the stranding this fixes', () => {
  it.each([
    ['a revoked refresh token', new Error('AuthApiError: Invalid Refresh Token')],
    ['a persisted session that will not parse', new SyntaxError('Unexpected token < in JSON')],
    ['a network failure during refresh', new TypeError('Failed to fetch')],
  ])('%s settles signed out, not stuck loading', async (_label, reason) => {
    env.getSession.mockRejectedValue(reason)
    render(<Consumer />)
    await settlesEventually('signed-out')
  })

  it('does not sign the user out of Supabase — the stored session is left alone', async () => {
    /*
     * A blink of the network must not destroy a session that is still good.
     * `signOut` is absent from the client mock entirely: if the hook called
     * it, this test would throw rather than quietly pass.
     */
    env.getSession.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<Consumer />)
    await settlesEventually('signed-out')
  })

  it('recovers when the session arrives later through the auth listener', async () => {
    /* The listener stays subscribed, so a session that failed to load is
       restored without the reader doing anything. */
    env.getSession.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<Consumer />)
    await settlesEventually('signed-out')

    await act(async () => { env.authCallback?.('SIGNED_IN', SESSION) })
    await settlesEventually('signed-in:u1')
  })
})

describe('failures after the session is read', () => {
  it('a failing profile read still settles, on the auth user', async () => {
    /* `loadSessionUser` degrades to the auth user; what matters here is that
       `loading` clears either way. */
    env.getSession.mockResolvedValue({ data: { session: SESSION } })
    env.profileRejects = true
    render(<Consumer />)
    await settlesEventually('signed-in:u1')
  })

  it('an auth change that throws does not re-strand the reader', async () => {
    env.getSession.mockResolvedValue({ data: { session: null } })
    render(<Consumer />)
    await settlesEventually('signed-out')

    env.profileRejects = true
    await act(async () => { env.authCallback?.('SIGNED_IN', SESSION) })
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).not.toBe('loading'))
  })
})

describe('no conflicting completion', () => {
  it('reads the session once for several mounted consumers', async () => {
    env.getSession.mockResolvedValue({ data: { session: SESSION } })
    render(<><Consumer /><Consumer /><Consumer /></>)
    await waitFor(() =>
      expect(screen.getAllByTestId('state')[0].textContent).toBe('signed-in:u1'))
    /* The in-flight share is `readSession`'s job and has its own suite; this
       only pins that the catch added here did not break it into one read per
       consumer. */
    expect(env.getSession.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('every consumer ends in the same state', async () => {
    env.getSession.mockRejectedValue(new Error('nope'))
    render(<><Consumer /><Consumer /></>)
    await waitFor(() => {
      const states = screen.getAllByTestId('state').map(n => n.textContent)
      expect(new Set(states)).toEqual(new Set(['signed-out']))
    })
  })
})
