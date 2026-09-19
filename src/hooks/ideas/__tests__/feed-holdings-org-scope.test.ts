import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The Ideas feed may not read the book without saying which organization's.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `portfolio_holdings` carries no `organization_id`. The org lives on
 * `portfolios`, so scope only exists if the query joins across and filters on
 * the joined column. Two reads in this feed did not, and they failed in two
 * different ways:
 *
 *   useSignalCards.generateStaleCoverageSignals — read every holding RLS
 *   admitted, then asked "has anyone worked on this lately" in the current
 *   org only. A name held and actively worked in org B had none of that work
 *   visible to the org-A probes, so it was maximally likely to be called
 *   stale and rendered in org A's feed as "<SYMBOL>: held position with no
 *   recent activity". Both halves false where the reader was standing, and
 *   the card discloses that somebody visible holds the name.
 *
 *   useIdeasFeed's holdings context — same unscoped read, used as a ranking
 *   boost. Nothing rendered, so this was influence rather than disclosure:
 *   posts about names held in another org outranked names held in this one.
 *
 * ── Why this test reads source instead of running the query ───────────────
 *
 * The subject is the shape of a query builder chain inside a react-query
 * `queryFn` inside a hook. Reaching it at runtime means a Supabase mock deep
 * enough that the mock's own fidelity becomes the thing under test — and a
 * mock that returns rows will happily return them whether or not `.eq` was
 * called, which is precisely the bug. Reading the chain asserts the one thing
 * that matters and cannot be satisfied by a lenient double.
 *
 * It is deliberately a RATCHET over the whole file rather than two pinned
 * assertions: the failure mode this class has shown is a third read being
 * added later by someone who did not know the rule. A new
 * `.from('portfolio_holdings')` in either file fails this test by existing
 * without a filter, which is the only way the rule outlives the two sites
 * that prompted it.
 *
 * Scope is these two files. The same pattern recurs across roughly seventy
 * call sites elsewhere; widening this ratchet to the repository is the
 * tenant-scoping audit's job, not this test's — see
 * docs/tickets/ideas-feed-unscoped-holdings.md §8.
 */

const HOOKS_DIR = path.resolve(__dirname, '..')

const FILES = ['useIdeasFeed.ts', 'useSignalCards.ts'] as const

/**
 * The chain that follows a `.from('portfolio_holdings')`, up to the point it
 * stops being a query.
 *
 * A Supabase chain ends at the `await`/destructure that consumed it, so the
 * cheap and stable boundary is the next blank line or the next `.from(`.
 * Deliberately generous: a filter that appears after the slice would be a
 * false failure, and a false failure on a security ratchet gets it deleted.
 */
function chainAfter(source: string, fromIndex: number): string {
  const rest = source.slice(fromIndex)
  const nextFrom = rest.indexOf(".from('", 1)
  const blankLine = rest.search(/\n[ \t]*\n/)
  const ends = [nextFrom, blankLine].filter(i => i > 0)
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest
}

/** Every `.from('portfolio_holdings')` read in a file, with its chain. */
export function holdingsReadsIn(source: string): string[] {
  const reads: string[] = []
  const needle = ".from('portfolio_holdings')"
  let at = source.indexOf(needle)
  while (at !== -1) {
    reads.push(chainAfter(source, at))
    at = source.indexOf(needle, at + needle.length)
  }
  return reads
}

/**
 * Whether a chain names an organization.
 *
 * Two accepted forms, because both are already canonical in this codebase:
 * the join filter for tables whose org is on `portfolios`, and a direct `.eq`
 * for the views that carry `organization_id` themselves.
 */
export function isOrgScoped(chain: string): boolean {
  return (
    chain.includes("'portfolios.organization_id'") ||
    chain.includes("'organization_id'")
  )
}

describe('the Ideas feed never reads holdings without an organization', () => {
  for (const file of FILES) {
    it(`${file} scopes every portfolio_holdings read`, () => {
      const source = readFileSync(path.join(HOOKS_DIR, file), 'utf8')
      const reads = holdingsReadsIn(source)

      // A file that stopped reading holdings at all is a real change and
      // should be noticed, not silently passed by a loop over nothing.
      expect(reads.length, `${file} reads portfolio_holdings`).toBeGreaterThan(0)

      for (const chain of reads) {
        expect(isOrgScoped(chain), `unscoped read in ${file}:\n${chain}`).toBe(true)
      }
    })
  }

  it('the holdings cache key carries the org, not just the user', () => {
    /*
     * A second, independent defect from the same ticket. Scoping the query
     * without keying on the org leaves the previous org's Set cached for the
     * full 60s staleTime, so org A's feed keeps ranking by org B's book after
     * a switch. The fix is only half applied if this key is wrong.
     */
    const source = readFileSync(path.join(HOOKS_DIR, 'useIdeasFeed.ts'), 'utf8')
    expect(source).toContain("['feed-context', 'holdings', user?.id, currentOrgId]")
  })
})

describe('the ratchet can see its own failure', () => {
  /*
   * Required by the repository's rule that a gate prove it fails when it
   * should. These run the detector over sources written to fail, so the
   * assertions above are known to be load bearing rather than vacuously true
   * on any input.
   */
  const UNSCOPED = `
    const { data } = await supabase
      .from('portfolio_holdings')
      .select('asset_id, portfolios!inner(id)')
  `

  const SCOPED = `
    const { data } = await supabase
      .from('portfolio_holdings')
      .select('asset_id, portfolios!inner(organization_id)')
      .eq('portfolios.organization_id', currentOrgId)
  `

  it('rejects the exact chain that shipped', () => {
    const [chain] = holdingsReadsIn(UNSCOPED)
    expect(chain).toBeDefined()
    expect(isOrgScoped(chain)).toBe(false)
  })

  it('accepts the chain that replaced it', () => {
    const [chain] = holdingsReadsIn(SCOPED)
    expect(isOrgScoped(chain)).toBe(true)
  })

  it('finds a second read rather than stopping at the first', () => {
    expect(holdingsReadsIn(SCOPED + '\n' + UNSCOPED)).toHaveLength(2)
  })

  it('does not let a filter on a LATER query scope an earlier one', () => {
    /*
     * The subtlest way a ratchet like this goes quietly vacuous: if the slice
     * ran to end-of-file, an unscoped read followed anywhere below by a
     * scoped one would pass. The chain must stop at the next `.from(`.
     */
    const [first] = holdingsReadsIn(UNSCOPED + SCOPED)
    expect(isOrgScoped(first)).toBe(false)
  })
})
