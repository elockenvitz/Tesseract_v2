import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_PLACE, forgetPlace, readPlace, writePlace, type DashboardNextPlace } from '../place'

/**
 * The Dashboard keeping its place across a tab switch.
 *
 * ── Why the store is tested and not the component ─────────────────────────
 *
 * The thing that goes wrong is a LIFETIME: the component is unmounted and a
 * new one mounts later. A render test mounts once, and `render` twice in one
 * case is not the same event as the tab host dropping the tree -- it would
 * pass against a component that simply never unmounted, which is the state of
 * affairs this fix does not have.
 *
 * So the store's behaviour across mounts is asserted directly, including the
 * part that is a safety property rather than a convenience, and the component's
 * use of it is source-pinned. Both halves can fail on their own.
 */

const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

const ME = 'user-1'
const SOMEONE_ELSE = 'user-2'

const place = (over: Partial<DashboardNextPlace> = {}): DashboardNextPlace => ({
  lens: 'explore',
  selected: {
    selection: { key: 'k1', family: 'conviction', assetId: 'a-1', symbol: 'AMZN' } as never,
    entry: null,
  },
  workMode: null,
  splitOpen: true,
  ...over,
})

beforeEach(forgetPlace)

describe('the Dashboard keeps where the reader was', () => {
  it('hands back the lens, the selection and the open pane', () => {
    writePlace(ME, place())
    const back = readPlace(ME)
    expect(back.lens).toBe('explore')
    expect(back.splitOpen).toBe(true)
    expect(back.selected?.selection.key).toBe('k1')
  })

  /** A first open, which must not inherit anything. */
  it('starts on Ideas with nothing selected when there is nothing to resume', () => {
    expect(readPlace(ME)).toEqual(NO_PLACE)
    expect(NO_PLACE.lens).toBe('feed')
    expect(NO_PLACE.splitOpen).toBe(false)
    expect(NO_PLACE.selected).toBeNull()
  })

  /**
   * ── What the place does NOT carry ───────────────────────────────────────
   *
   * `portfolioSeen` was in it for a pass. The latch is set during the render
   * in which the lens is Portfolio, so a restored `lens: 'portfolio'` mounts
   * the book on its own; and in the one case where the flag would do anything
   * -- left from the feed, having opened the book earlier -- it mounts the
   * book hidden and charges the reader its several queries for a surface they
   * are not looking at. Pinned so it cannot drift back in as an obvious
   * addition.
   */
  it('remembers the lens, and not whether the book was ever mounted', () => {
    writePlace(ME, place({ lens: 'portfolio' }))
    const back = readPlace(ME)
    expect(back.lens).toBe('portfolio')
    expect(Object.keys(back).sort()).toEqual(['lens', 'selected', 'splitOpen', 'workMode'])
  })

  /**
   * THE safety case, and the reason the store is keyed at all.
   *
   * Signing out of this application does not reload the page -- `AuthProvider`
   * swaps `user` to null in place -- so an unkeyed module value would hand the
   * next reader to sign in the previous reader's selected name, with their
   * finding in the work pane. One reader's material on another reader's
   * screen.
   */
  it('never hands one reader the place another reader left', () => {
    writePlace(ME, place())
    expect(readPlace(SOMEONE_ELSE)).toEqual(NO_PLACE)
    // And it is FORGOTTEN, not merely withheld: the original reader coming
    // back must not find it waiting either, because by then the tab has been
    // through someone else's session.
    expect(readPlace(ME)).toEqual(NO_PLACE)
  })

  it('keeps nothing for a reader who is not signed in', () => {
    writePlace(null, place())
    expect(readPlace(null)).toEqual(NO_PLACE)
    expect(readPlace(ME)).toEqual(NO_PLACE)
  })

  it('reads nothing when asked with no reader, even for a place that exists', () => {
    writePlace(ME, place())
    expect(readPlace(null)).toEqual(NO_PLACE)
  })
})

describe('the shell actually uses the store', () => {
  const file = () => src('components/dashboard-next/DashboardNext.tsx')

  it('seeds every piece of the place from what was remembered', () => {
    const f = file()
    expect(f).toMatch(/readPlace\(owner\)/)
    expect(f).toMatch(/useState<NextLens>\(resume\.lens\)/)
    expect(f).toMatch(/useState<[^\n]*>\(resume\.selected\)/)
    expect(f).toMatch(/useState<Progression\['mode'\] \| null>\(resume\.workMode\)/)
    expect(f).toMatch(/useState\(resume\.splitOpen\)/)
    // And the latch is NOT seeded: see the case above for why that costs the
    // reader queries on a surface they did not come back to.
    expect(f).toMatch(/const seenPortfolio = useRef\(false\)/)
  })

  it('writes the place whenever any part of it changes', () => {
    const f = file()
    expect(f).toMatch(/writePlace\(owner, \{ lens, selected, workMode, splitOpen \}\)/)
    // Every value it writes is also a dependency, or the store holds a stale
    // place and the restore is worse than no restore at all.
    expect(f).toMatch(/\[owner, lens, selected, workMode, splitOpen\]/)
  })

  /**
   * The article reader is deliberately left out, and that is a decision rather
   * than an omission: it is a full-screen overlay, and restoring it means a
   * reader comes back to a modal they must dismiss before seeing the
   * Dashboard at all.
   */
  it('does not restore the article overlay', () => {
    const f = file()
    expect(f).not.toMatch(/useState\([^\n]*>\(resume\.article\)/)
    expect(f).not.toMatch(/resume\.article/)
  })

  /**
   * The store cannot be keyed without a reader to key it to.
   *
   * ── And it has to be the right `useAuth` ────────────────────────────────
   *
   * There are two in this codebase. `contexts/AuthContext` exports one whose
   * `AuthProvider` is mounted NOWHERE in this application, so it throws
   * "useAuth must be used within an AuthProvider" and takes the whole tab to
   * the error boundary. That is what the first version of this change did,
   * and the suite did not catch it: the render test mocks the module it is
   * told to mock, so mocking the wrong one passes. Opening the tab caught it.
   *
   * The import is therefore pinned by module, which is the part a mock cannot
   * stand in for.
   */
  it('takes the reader from the auth hook the application actually mounts', () => {
    const f = file()
    expect(f).toMatch(/useAuth\(\)/)
    expect(f).toMatch(/const owner = user\?\.id \?\? null/)
    expect(f).toMatch(/import \{ useAuth \} from '\.\.\/\.\.\/hooks\/useAuth'/)
    expect(f).not.toMatch(/^import \{ useAuth \} from '[^\n]*contexts\/AuthContext'/m)
  })
})
