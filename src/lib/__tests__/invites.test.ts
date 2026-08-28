/**
 * The invitation token's journey through the browser.
 *
 * These are unit tests for the persistence layer specifically, because the
 * persistence layer is where the email-verification flow breaks in ways that
 * are invisible from the outside: the recipient comes back signed in, with no
 * invitation, to a "no workspace" screen, and there is nothing to see in the
 * network log. Every case below is a real journey the confirmation round-trip
 * puts people through.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// invites.ts imports the Supabase client, which throws at module load without
// credentials. The functions under test here are pure browser-storage and
// URL-building code that never touch it — so stub the module rather than
// handing the test suite real project credentials it has no use for.
vi.mock('../supabase', () => ({ supabase: { rpc: vi.fn() } }))

import {
  clearPendingInvite,
  inviteConfirmationRedirect,
  isInviteTokenShaped,
  markPendingInviteMismatch,
  readPendingInvite,
  stashPendingInvite,
} from '../invites'

const TOKEN = '3f1b6a5e-9c42-4d1a-8b77-2ea50c9d4411'
const OTHER = '8a2c4d6e-1f30-4b59-9c88-5d7e0a1b2c33'
const KEY = 'pending-invite-token'

/** The account the invitation was NOT sent to. */
const WRONG_UID = 'ffffffff-0000-4000-8000-000000000001'
/** The account it WAS sent to. */
const RIGHT_UID = 'ffffffff-0000-4000-8000-000000000002'
/** Someone else entirely, signing in on the same shared browser later. */
const THIRD_UID = 'ffffffff-0000-4000-8000-000000000003'

/**
 * Run `body` with one of the two web storages throwing on every access, the
 * way a private window or a locked-down in-app browser behaves. Restored
 * afterwards even if the body fails.
 */
function withBrokenStorage(which: 'localStorage' | 'sessionStorage', body: () => void) {
  const real = Object.getOwnPropertyDescriptor(window, which)
  const throwing = new Proxy({} as Storage, {
    get() { throw new Error('storage is denied in this context') },
    set() { throw new Error('storage is denied in this context') },
  })
  Object.defineProperty(window, which, { configurable: true, value: throwing })
  try {
    body()
  } finally {
    if (real) Object.defineProperty(window, which, real)
    else delete (window as unknown as Record<string, unknown>)[which]
  }
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.useRealTimers()
})

describe('parking a token across the confirmation round-trip', () => {
  it('reads back what it stored', () => {
    stashPendingInvite(TOKEN)
    expect(readPendingInvite()).toBe(TOKEN)
  })

  it('survives a new tab', () => {
    // The journey this whole mechanism exists for. A confirmation link opened
    // from a mail client is a fresh tab with a fresh, EMPTY sessionStorage —
    // which is why the stash cannot live there alone. Emptying sessionStorage
    // and leaving localStorage is exactly what that new tab sees.
    stashPendingInvite(TOKEN)
    sessionStorage.clear()
    expect(readPendingInvite()).toBe(TOKEN)
  })

  it('survives a refresh in the same tab', () => {
    stashPendingInvite(TOKEN)
    expect(readPendingInvite()).toBe(TOKEN)
    expect(readPendingInvite()).toBe(TOKEN)
  })

  it('keeps working when localStorage is unavailable', () => {
    // Private windows and some embedded/in-app browsers throw on localStorage
    // while leaving sessionStorage intact. The same-tab journey must still work.
    withBrokenStorage('localStorage', () => {
      expect(() => stashPendingInvite(TOKEN)).not.toThrow()
      expect(readPendingInvite()).toBe(TOKEN)
    })
  })

  it('keeps working when sessionStorage is unavailable', () => {
    withBrokenStorage('sessionStorage', () => {
      expect(() => stashPendingInvite(TOKEN)).not.toThrow()
      expect(readPendingInvite()).toBe(TOKEN)
    })
  })

  it('prefers the invitation opened in THIS tab over one another tab left behind', () => {
    // Two invitations, two tabs, one shared localStorage. The tab-local answer
    // is the one the person is actually looking at.
    stashPendingInvite(OTHER)
    sessionStorage.setItem(KEY, JSON.stringify({ token: TOKEN, at: Date.now() }))
    expect(readPendingInvite()).toBe(TOKEN)
  })

  it('clears from both stores at once', () => {
    stashPendingInvite(TOKEN)
    clearPendingInvite()
    expect(readPendingInvite()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})

describe('what the stash refuses to hand back', () => {
  it('expires after the TTL rather than lying in wait', () => {
    // A token that outlives its confirmation email is not a convenience — it
    // is a stale redirect waiting for whoever next uses this browser.
    stashPendingInvite(TOKEN)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
    expect(readPendingInvite()).toBeNull()
  })

  it('honours a token stored just inside the TTL', () => {
    stashPendingInvite(TOKEN)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 23 * 60 * 60 * 1000)
    expect(readPendingInvite()).toBe(TOKEN)
  })

  it('tolerates a clock that moved backwards', () => {
    // A timezone change or a restored machine reads as a negative age. That is
    // not a reason to strand someone mid-invitation.
    localStorage.setItem(KEY, JSON.stringify({ token: TOKEN, at: Date.now() + 60_000 }))
    expect(readPendingInvite()).toBe(TOKEN)
  })

  it('ignores a malformed token even if something wrote one', () => {
    localStorage.setItem(KEY, JSON.stringify({ token: 'not-a-token', at: Date.now() }))
    expect(readPendingInvite()).toBeNull()
  })

  it('ignores unparseable contents', () => {
    localStorage.setItem(KEY, '{oh no')
    expect(readPendingInvite()).toBeNull()
  })

  it('refuses to stash a malformed token in the first place', () => {
    stashPendingInvite('../../admin')
    expect(readPendingInvite()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('still reads a bare token left by the previously deployed bundle', () => {
    // Mid-deploy: someone parked a token in the old format and is now running
    // the new bundle. Dropping it would end their invitation for no reason.
    sessionStorage.setItem(KEY, TOKEN)
    expect(readPendingInvite()).toBe(TOKEN)
  })
})

describe('the confirmation redirect', () => {
  it('points back at this exact invitation', () => {
    expect(inviteConfirmationRedirect(TOKEN, 'https://app.example')).toBe(
      `https://app.example/invite/${TOKEN}`
    )
  })

  it('is built from the running origin, never from the token', () => {
    // The open-redirect question. Whatever arrives in the path, the host half
    // of the URL is ours — so there is no input here that could send the auth
    // service somewhere else.
    for (const hostile of [
      'https://evil.example',
      '//evil.example',
      '../../../evil',
      `${TOKEN}?next=https://evil.example`,
      `${TOKEN}#@evil.example`,
    ]) {
      const url = inviteConfirmationRedirect(hostile, 'https://app.example')
      expect(url === null || new URL(url).origin === 'https://app.example').toBe(true)
    }
  })

  it('returns nothing for a token that could never be valid', () => {
    expect(inviteConfirmationRedirect('not-a-token', 'https://app.example')).toBeNull()
    expect(inviteConfirmationRedirect('', 'https://app.example')).toBeNull()
  })
})

describe('token shape', () => {
  it('accepts a UUID and rejects everything else', () => {
    expect(isInviteTokenShaped(TOKEN)).toBe(true)
    expect(isInviteTokenShaped(TOKEN.toUpperCase())).toBe(true)
    expect(isInviteTokenShaped(` ${TOKEN} `)).toBe(true)
    expect(isInviteTokenShaped('not-a-token')).toBe(false)
    expect(isInviteTokenShaped(`${TOKEN}extra`)).toBe(false)
  })
})

/**
 * The shared-browser trap.
 *
 * A valid invitation parks in localStorage for up to 24 hours. Before this,
 * ProtectedRoute forwarded EVERY signed-in account with no workspace to it —
 * so an account the invitation was not for got sent to a page that refuses it,
 * sent back there from the next no-workspace screen, and so on until the park
 * window expired. Signing out and back in did not help: the token was still
 * there and the forward was unconditional.
 *
 * The fix marks the pairing rather than deleting the token, because the token
 * still has to work for the person it was actually sent to — quite possibly
 * the next person to sign in on this very browser.
 */
describe('a valid invitation parked for someone else', () => {
  it('1. still parks, and still forwards, before anything is known', () => {
    // The forward is not wrong in general — it is what carries someone back
    // from their confirmation email. It only becomes wrong once we have seen
    // this specific account refused.
    stashPendingInvite(TOKEN)
    expect(readPendingInvite(WRONG_UID)).toBe(TOKEN)
  })

  it('2. stops auto-routing the account it was refused for', () => {
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    expect(readPendingInvite(WRONG_UID)).toBeNull()
  })

  it('3. survives the sign-out that follows, unmarked for nobody in particular', () => {
    // "Sign out and switch account" is the intended exit from the mismatch
    // screen. Signed out there is no uid to scope by, and the invitation must
    // still be here — this is the step where deleting it would break the
    // rightful recipient.
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    expect(readPendingInvite()).toBe(TOKEN)
    expect(readPendingInvite(null)).toBe(TOKEN)
  })

  it('4. hands the invitation to the correct account when it signs in', () => {
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    expect(readPendingInvite(RIGHT_UID)).toBe(TOKEN)
  })

  it('5. leaves the invitation itself untouched — the mark is not a revocation', () => {
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    const raw = JSON.parse(localStorage.getItem(KEY)!)
    expect(raw.token).toBe(TOKEN)
    expect(raw.notFor).toEqual([WRONG_UID])
  })

  it('6. lets the correct account complete and clears on acceptance', () => {
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    expect(readPendingInvite(RIGHT_UID)).toBe(TOKEN)
    clearPendingInvite() // what runAccept does on success
    expect(readPendingInvite(RIGHT_UID)).toBeNull()
    expect(readPendingInvite()).toBeNull()
  })

  it('7. does not trap an unrelated later sign-in indefinitely', () => {
    // A third account arrives on the shared browser. It is forwarded once —
    // unavoidable, since nothing yet knows the address does not match — and
    // then never again.
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    expect(readPendingInvite(THIRD_UID)).toBe(TOKEN)
    markPendingInviteMismatch(TOKEN, THIRD_UID)
    expect(readPendingInvite(THIRD_UID)).toBeNull()
    // ...and the two marks are independent of each other.
    expect(readPendingInvite(WRONG_UID)).toBeNull()
    expect(readPendingInvite(RIGHT_UID)).toBe(TOKEN)
  })

  it('8. keeps the marks through the confirmation round-trip', () => {
    // Re-landing on /invite/:token re-parks it. The same invitation keeps what
    // it has learned; a DIFFERENT invitation starts clean.
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    stashPendingInvite(TOKEN) // the mount effect, on return from the email
    expect(readPendingInvite(WRONG_UID)).toBeNull()
    expect(readPendingInvite(RIGHT_UID)).toBe(TOKEN)

    stashPendingInvite(OTHER)
    expect(readPendingInvite(WRONG_UID)).toBe(OTHER)
  })

  it('9. marks both stores, so the cross-tab forward stops too', () => {
    // The trap was specifically a localStorage one: sessionStorage would have
    // died with the tab. Marking only the tab-local copy would leave every new
    // tab forwarding again.
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    expect(JSON.parse(sessionStorage.getItem(KEY)!).notFor).toEqual([WRONG_UID])
    expect(JSON.parse(localStorage.getItem(KEY)!).notFor).toEqual([WRONG_UID])
    sessionStorage.clear() // a brand-new tab
    expect(readPendingInvite(WRONG_UID)).toBeNull()
    expect(readPendingInvite(RIGHT_UID)).toBe(TOKEN)
  })

  it('does not extend the park window by marking', () => {
    // A mismatch is not a visit. If marking refreshed `at`, a wrong account
    // repeatedly bouncing off the page would keep the token alive forever.
    stashPendingInvite(TOKEN)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 23 * 60 * 60 * 1000)
    markPendingInviteMismatch(TOKEN, WRONG_UID)
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000)
    expect(readPendingInvite(RIGHT_UID)).toBeNull()
  })

  it('ignores a mark aimed at a different token, and malformed input', () => {
    stashPendingInvite(TOKEN)
    markPendingInviteMismatch(OTHER, WRONG_UID)
    expect(readPendingInvite(WRONG_UID)).toBe(TOKEN)
    markPendingInviteMismatch(TOKEN, '')
    expect(readPendingInvite(WRONG_UID)).toBe(TOKEN)
  })

  it('survives a browser where only one store works', () => {
    withBrokenStorage('localStorage', () => {
      stashPendingInvite(TOKEN)
      markPendingInviteMismatch(TOKEN, WRONG_UID)
      expect(readPendingInvite(WRONG_UID)).toBeNull()
      expect(readPendingInvite(RIGHT_UID)).toBe(TOKEN)
    })
  })

  it('bounds how many marks it will remember', () => {
    stashPendingInvite(TOKEN)
    for (let i = 0; i < 12; i++) markPendingInviteMismatch(TOKEN, `uid-${i}`)
    const notFor = JSON.parse(localStorage.getItem(KEY)!).notFor as string[]
    expect(notFor).toHaveLength(8)
    expect(notFor).toContain('uid-11')
    expect(notFor).not.toContain('uid-0')
  })
})
