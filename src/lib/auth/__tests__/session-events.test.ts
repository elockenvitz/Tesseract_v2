/**
 * Returning to a backgrounded tab must not rebuild the application.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `onAuthStateChange` ran one unconditional handler for every event, and that
 * handler fetches the user's profile row over the network and then calls
 * `setUser` with a freshly constructed object.
 *
 * Supabase fires `TOKEN_REFRESHED` whenever its auto-refresh timer catches up,
 * and a backgrounded phone browser catches up the instant it is foregrounded.
 * So every return to the tab meant a network round trip and a new `user`
 * identity handed to every `useAuth` consumer — for an event that by definition
 * says nothing about the user has changed. Only the bearer token moved, and
 * supabase-js already owns that.
 *
 * ── What must NOT be weakened ─────────────────────────────────────────────
 *
 * This decides whether the REACT layer rebuilds. It is not a credential cache
 * and it does not judge whether a session is valid. So the cases that follow
 * matter more than the one being suppressed: a sign-in, a sign-out, an account
 * swap and a profile update all still rebuild, and an event nobody has
 * classified rebuilds rather than being dropped.
 */

import { describe, it, expect } from 'vitest'
import { isMaterialAuthChange } from '../session-events'

const ME = 'user-1'
const SOMEONE_ELSE = 'user-2'

describe('a token refresh for the same user changes nothing', () => {
  it('is not material', () => {
    expect(isMaterialAuthChange('TOKEN_REFRESHED', ME, ME)).toBe(false)
  })

  it('is not material however many times it arrives', () => {
    // A phone that has been asleep can deliver several in a row on resume.
    for (let i = 0; i < 5; i++) {
      expect(isMaterialAuthChange('TOKEN_REFRESHED', ME, ME)).toBe(false)
    }
  })
})

describe('a token refresh that carries a different user is a real change', () => {
  it('is material, despite the quiet event name', () => {
    // An account swap in another tab, or a morph session, arrives wearing this.
    expect(isMaterialAuthChange('TOKEN_REFRESHED', SOMEONE_ELSE, ME)).toBe(true)
  })

  it('is material when a session appears where there was none', () => {
    expect(isMaterialAuthChange('TOKEN_REFRESHED', ME, null)).toBe(true)
  })

  it('is material when the session goes away', () => {
    expect(isMaterialAuthChange('TOKEN_REFRESHED', null, ME)).toBe(true)
  })
})

describe('everything that genuinely changes who is using the app rebuilds', () => {
  it('signs a new user in', () => {
    expect(isMaterialAuthChange('SIGNED_IN', ME, null)).toBe(true)
  })

  it('signs the current user out', () => {
    expect(isMaterialAuthChange('SIGNED_OUT', null, ME)).toBe(true)
  })

  it('swaps accounts', () => {
    expect(isMaterialAuthChange('SIGNED_IN', SOMEONE_ELSE, ME)).toBe(true)
  })

  it('updates the profile row this layer caches', () => {
    expect(isMaterialAuthChange('USER_UPDATED', ME, ME)).toBe(true)
  })

  it('enters password recovery', () => {
    expect(isMaterialAuthChange('PASSWORD_RECOVERY', ME, ME)).toBe(true)
  })

  it('handles the first session of a cold load', () => {
    expect(isMaterialAuthChange('INITIAL_SESSION', ME, null)).toBe(true)
  })
})

describe('re-announcements of a session already rendered are ignored', () => {
  it('does not rebuild for a repeated SIGNED_IN of the same user', () => {
    // Some resume paths re-emit this for a user who is already signed in.
    expect(isMaterialAuthChange('SIGNED_IN', ME, ME)).toBe(false)
  })

  it('does not rebuild for a repeated INITIAL_SESSION of the same user', () => {
    expect(isMaterialAuthChange('INITIAL_SESSION', ME, ME)).toBe(false)
  })

  it('still rebuilds when there is nothing rendered yet', () => {
    expect(isMaterialAuthChange('SIGNED_IN', ME, null)).toBe(true)
    expect(isMaterialAuthChange('INITIAL_SESSION', ME, null)).toBe(true)
  })
})

describe('an unclassified event is treated as meaningful', () => {
  it('rebuilds rather than silently dropping something new', () => {
    // A future supabase-js event must not be swallowed by this switch.
    expect(isMaterialAuthChange('MFA_CHALLENGE_VERIFIED', ME, ME)).toBe(true)
    expect(isMaterialAuthChange('SOMETHING_NEW', ME, ME)).toBe(true)
  })
})

describe('nothing here caches or judges a credential', () => {
  it('takes no token, and so cannot be a credential cache', () => {
    // Three arguments: an event name and two ids. supabase-js remains the only
    // authority on whether a session is valid.
    expect(isMaterialAuthChange.length).toBe(3)
  })
})
