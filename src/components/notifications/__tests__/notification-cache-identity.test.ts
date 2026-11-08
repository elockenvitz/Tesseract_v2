/**
 * A notification cache entry belongs to one reader.
 *
 * `NotificationPane` is the only notification surface the app mounts, and it
 * is mounted twice: once by `Layout` and once by `CommunicationPane`. The app
 * also supports morphing, where a platform admin views the product as another
 * user, so the signed-in identity can change without a reload.
 *
 * Its query key was `['notifications']` with no user id. The rows were always
 * fetched with `.eq('user_id', user.id)` and RLS backs that, so nothing was
 * ever mis-queried; the defect was that the cached result outlived the change
 * of identity and was handed to the next reader until a refetch landed.
 *
 * These assertions read source rather than rendering, because the pane needs a
 * live Supabase client, auth and a query client to mount, and what matters
 * here is the shape of the key rather than any rendered output.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const PANE = strip(read('src/components/notifications/NotificationPane.tsx'))
const LAYOUT = strip(read('src/components/layout/Layout.tsx'))
const COMMS = strip(read('src/components/communication/CommunicationPane.tsx'))

describe('the notification cache is scoped to the reader', () => {
  it('keys the notification query on the user id', () => {
    /* Scoped to the useQuery declaration, not the whole file. The two
       `invalidateQueries({ queryKey: ['notifications'] })` calls in the
       mutations below are the bare key ON PURPOSE -- prefix matching is how
       they still reach the longer key -- so a file-wide search for the bare
       key reports the fix as broken while it is working. */
    const decl = PANE.slice(PANE.indexOf('useQuery({'), PANE.indexOf('queryFn:'))
    expect(decl).toContain("queryKey: ['notifications', user?.id]")
    /* The bare key is what let one reader's rows reach another. Asserting its
       absence is the half that actually fails when the fix is reverted: a
       looser check would pass on the prefix alone. */
    expect(decl, "the useQuery declaration is back on the bare ['notifications'] key")
      .not.toMatch(/queryKey: \['notifications'\]/)
  })

  it('still filters the rows by user id, so the key is not the only guard', () => {
    // Belt and braces: the key stops cache bleed, this stops a bad fetch.
    expect(PANE).toMatch(/\.eq\('user_id', user\.id\)/)
  })

  it('leaves invalidation by prefix working', () => {
    /* TanStack matches query keys by prefix unless `exact: true` is passed, so
       every existing `invalidateQueries({ queryKey: ['notifications'] })` call
       still reaches the now-longer key. If any call site had added `exact`,
       lengthening the key would have silently stopped it from invalidating. */
    const exactInvalidations = PANE.match(/invalidateQueries\(\{[^}]*exact:\s*true[^}]*\}\)/g) ?? []
    expect(exactInvalidations).toHaveLength(0)
  })

  it('is the only notification pane the app mounts', () => {
    /* NotificationCenter and NotificationPanel carry near-identical queries and
       are imported by nothing. They are left on disk deliberately -- deleting
       them is a separate decision -- but if either is ever mounted it must get
       the same identity-scoped key before it ships, so this records which file
       the product actually runs. */
    expect(LAYOUT).toContain("import { NotificationPane } from '../notifications/NotificationPane'")
    expect(COMMS).toContain("import { NotificationPane } from '../notifications/NotificationPane'")
    expect(LAYOUT).not.toMatch(/<NotificationCenter|<NotificationPanel/)
    expect(COMMS).not.toMatch(/<NotificationCenter|<NotificationPanel/)
  })
})
