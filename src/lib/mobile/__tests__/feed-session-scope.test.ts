import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { loadFeedSession, saveFeedSession, clearFeedSession } from '../feed-session'

/**
 * `feed-session` was one entry for the whole origin.
 *
 * It carries no intelligence — a shuffle seed, a cycle count and a scroll
 * offset — so nothing leaked. What it did was worse than nothing: "put me back
 * where I was" put a second reader on the same phone back where the FIRST one
 * was, and after an org switch it restored a position in a feed that no longer
 * contained those cards.
 */

const A = { userId: 'user-a', orgId: 'org-x' }
const B = { userId: 'user-b', orgId: 'org-x' }
const AY = { userId: 'user-a', orgId: 'org-y' }

const SESSION = { seed: 12345, cycle: 2, scrollTop: 840 }

beforeEach(() => {
  sessionStorage.clear()
  // `loadFeedSession` refuses to resume across an explicit reload. Every case
  // here is an in-app navigation, which is the path that restores.
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'navigate' } as any])
})
afterEach(() => vi.restoreAllMocks())

describe('a feed session belongs to one reader in one organization', () => {
  it('restores the session it saved', () => {
    saveFeedSession(A, SESSION)
    expect(loadFeedSession(A)).toMatchObject(SESSION)
  })

  /** User A's place is not user B's place. */
  it('does not hand user A the session to user B', () => {
    saveFeedSession(A, SESSION)
    expect(loadFeedSession(B)).toBeNull()
  })

  /** Nor org X's to org Y — the cards are not even the same set. */
  it('does not hand org X the session to org Y', () => {
    saveFeedSession(A, SESSION)
    expect(loadFeedSession(AY)).toBeNull()
  })

  it('keeps two readers on one device independent', () => {
    saveFeedSession(A, SESSION)
    saveFeedSession(B, { seed: 999, cycle: 0, scrollTop: 10 })
    expect(loadFeedSession(A)).toMatchObject(SESSION)
    expect(loadFeedSession(B)).toMatchObject({ seed: 999, cycle: 0, scrollTop: 10 })
  })

  it('clears only the scope it was asked to clear', () => {
    saveFeedSession(A, SESSION)
    saveFeedSession(B, { seed: 999, cycle: 0, scrollTop: 10 })
    clearFeedSession(A)
    expect(loadFeedSession(A)).toBeNull()
    expect(loadFeedSession(B)).not.toBeNull()
  })

  /**
   * The dashboard's first render can precede the org query. Writing under half
   * a scope produces an entry the next render cannot find and a different
   * reader could, so a partial scope writes nothing at all.
   */
  it.each([
    ['no org', { userId: 'user-a', orgId: null }],
    ['no user', { userId: null, orgId: 'org-x' }],
    ['neither', { userId: null, orgId: null }],
    ['undefined', { userId: undefined, orgId: undefined }],
  ])('neither saves nor loads with %s', (_name, scope) => {
    saveFeedSession(scope as any, SESSION)
    expect(loadFeedSession(scope as any)).toBeNull()
    // And nothing was written that another scope could pick up.
    expect(sessionStorage.length).toBe(0)
  })

  /**
   * The pre-scoping entry is deleted, never adopted. There is no way to know
   * whose it was, and guessing assigns one reader's position to whoever opens
   * the tab next — the exact bug the scoping removes.
   */
  it('discards the legacy unscoped entry rather than migrating it', () => {
    sessionStorage.setItem(
      'tesseract:feed-session',
      JSON.stringify({ ...SESSION, savedAt: Date.now() }),
    )
    expect(loadFeedSession(A)).toBeNull()
    expect(sessionStorage.getItem('tesseract:feed-session')).toBeNull()
  })

  /** The age check survived the scoping. */
  it('does not resume a session older than the window', () => {
    sessionStorage.setItem(
      'tesseract:feed-session:user-a:org-x',
      JSON.stringify({ ...SESSION, savedAt: Date.now() - 31 * 60 * 1000 }),
    )
    expect(loadFeedSession(A)).toBeNull()
  })

  /** As did the reload rule: a refresh is a request for a fresh feed. */
  it('does not resume across an explicit reload', () => {
    saveFeedSession(A, SESSION)
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as any])
    expect(loadFeedSession(A)).toBeNull()
  })

  /** Still only ordering state. Nothing about what the cards say. */
  it('stores nothing but seed, cycle and scroll', () => {
    saveFeedSession(A, SESSION)
    const stored = JSON.parse(sessionStorage.getItem('tesseract:feed-session:user-a:org-x')!)
    expect(Object.keys(stored).sort()).toEqual(['cycle', 'savedAt', 'scrollTop', 'seed'])
  })
})
