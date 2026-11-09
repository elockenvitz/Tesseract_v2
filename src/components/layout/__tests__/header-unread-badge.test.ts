/**
 * The header's unread-message badge: wiring and cadence.
 *
 * The rule itself (what counts as unread) is tested for real against a stub
 * client in `src/lib/messaging/__tests__/unread-direct-messages.test.ts`.
 * What is pinned here is what only the component decides: that it goes
 * through that seam rather than carrying its own loop, and that the two
 * responsiveness paths survive the slower interval.
 *
 * Source is read rather than rendered because `Header` needs a live Supabase
 * client, auth, an organization context, a morph session and a router to
 * mount, and none of that is what these assertions are about.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const HEADER = strip(read('src/components/layout/Header.tsx'))

/** The badge's own useQuery block, so neighbouring queries cannot satisfy these. */
const badgeBlock = (() => {
  const at = HEADER.indexOf("queryKey: ['unread-direct-messages'")
  return HEADER.slice(at, HEADER.indexOf('})', at) + 2)
})()

describe('the badge reads through the messaging seam', () => {
  it('calls the shared reader instead of querying in the component', () => {
    expect(HEADER).toContain(
      "import { readUnreadDirectMessages } from '../../lib/messaging/unread-direct-messages'"
    )
    expect(badgeBlock).toContain('queryFn: () => readUnreadDirectMessages(user!.id)')
  })

  it('no longer loops over conversations inside the component', () => {
    /* This is the defect being prevented, not a style preference: one count
       query per conversation, on a 5s timer, on every page. Measured at
       1,308,978 calls and 2,464 s of database time over 169 days. */
    expect(badgeBlock, 'the per-conversation count loop is back in Header')
      .not.toMatch(/for \(const conv of/)
    expect(badgeBlock).not.toMatch(/count: 'exact'/)
    expect(badgeBlock).not.toMatch(/\.from\('conversation_messages'\)/)
  })

  it('keys the badge on the user id', () => {
    // Same morph-era cache-bleed concern as the notification pane.
    expect(badgeBlock).toContain("queryKey: ['unread-direct-messages', user?.id]")
  })
})

describe('the cadence trades the timer, not responsiveness', () => {
  it('polls on a human interval rather than every five seconds', () => {
    expect(badgeBlock).toContain('refetchInterval: 20000')
    expect(badgeBlock, 'the 5s timer is back').not.toContain('refetchInterval: 5000')
  })

  it('keeps the immediate check when the reader returns to the tab', () => {
    /* The path that actually makes the badge feel live. Removing this while
       slowing the timer is what would make the feature feel broken. */
    expect(badgeBlock).toContain('refetchOnWindowFocus: true')
  })

  it('does not let focus and interval both fire a request at once', () => {
    /* staleTime was 0, so a focus event and a timer tick seconds apart were
       two round trips. 15s is under the 20s interval, so a genuine return to
       the tab still refetches. */
    expect(badgeBlock).toContain('staleTime: 15000')
    expect(badgeBlock, 'staleTime is back to 0, so focus and interval double up')
      .not.toMatch(/staleTime: 0\b/)
  })
})
