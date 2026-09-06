import { describe, it, expect, vi } from 'vitest'

/**
 * A failed query is not an empty desk.
 *
 * ── The bug this pins ─────────────────────────────────────────────────────
 *
 * `useScenarioCards` destructured `data` from its Supabase calls and threw the
 * `error` away. Every way the request can fail — an expired JWT mid-refresh,
 * an RLS denial, a dropped connection — returns `data: null`, so `rows` was
 * `undefined`, `targets` was `[]`, and the next line returned `[]` as a
 * SUCCESSFUL result.
 *
 * React Query cached that empty array under the final key,
 * `['scenario-cards', orgId]`. The org id does not change afterwards, so the
 * key never changes; `staleTime` is five minutes and this feed deliberately
 * does not refetch on mount, focus or reconnect. Nothing recovered it. Case vs
 * Price was absent for the rest of the visit, and Curate correctly reported
 * zero because the candidate genuinely was not there.
 *
 * That is the reported shape exactly: present after a fresh login, absent
 * after a hard reload. A login holds a brand-new access token; a reload
 * restores a stored one that supabase-js may still be refreshing when this
 * query fires. The request loses the race and the failure is cached as an
 * answer.
 *
 * ── What is asserted here ─────────────────────────────────────────────────
 *
 * The property, at the seam where it broke: a failing read must REJECT, and a
 * genuinely empty read must resolve empty. Rejecting is what makes React Query
 * retry it and mark it an error rather than a result, so a lost race becomes a
 * second attempt a moment later — by which time the token is refreshed.
 *
 * The hook is not mounted here. Doing that needs the org context, the auth
 * hook and the quote service, and would test those instead of this. What
 * follows is the exact control flow of `queryFn`, run against a stubbed
 * client, which is where the defect lived and the only place it can return.
 */

type Result = { data: unknown[] | null; error: { message: string } | null }

/**
 * `queryFn`'s shape, transcribed from `useScenarioCards`.
 *
 * Kept in step with the hook by `reads the same two tables the hook reads`
 * below, which greps the source rather than trusting this copy.
 */
async function loadTargets(
  targetsResult: Result,
  holdingsResult: Result,
): Promise<unknown[]> {
  const { data: rows, error } = targetsResult
  if (error) throw error
  const targets = (rows ?? []) as unknown[]
  if (!targets.length) return []

  const { data: holdings, error: holdingsError } = holdingsResult
  if (holdingsError) throw holdingsError
  void holdings
  return targets
}

const ok = (data: unknown[]): Result => ({ data, error: null })
const failed = (message: string): Result => ({ data: null, error: { message } })
const TARGET = { id: 't1', asset_id: 'a1', price: 180 }

describe('a failed scenario read never becomes an empty result', () => {
  /** THE regression. This is what cached a false empty and hid the card. */
  it('throws when the price-target read fails, rather than returning []', async () => {
    await expect(loadTargets(failed('JWT expired'), ok([])))
      .rejects.toMatchObject({ message: 'JWT expired' })
  })

  it('throws when the holdings read fails', async () => {
    // Lower stakes, same rule: a silent failure here would claim every name is
    // unheld, which changes what the card says about the reader's exposure.
    await expect(loadTargets(ok([TARGET]), failed('RLS denied')))
      .rejects.toMatchObject({ message: 'RLS denied' })
  })

  /** And the honest empty still resolves empty — the fix must not invent rows. */
  it('resolves empty when the desk genuinely has no ladders', async () => {
    await expect(loadTargets(ok([]), ok([]))).resolves.toEqual([])
  })

  it('resolves the targets when both reads succeed', async () => {
    await expect(loadTargets(ok([TARGET]), ok([]))).resolves.toEqual([TARGET])
  })

  /**
   * Login versus hard reload, as a sequence.
   *
   * Attempt one loses the token race and rejects; the retry, a moment later
   * with a refreshed token, sees the same rows the login session saw. Same
   * org, same scenarios, same eligibility — therefore the same card. Before
   * the fix, attempt one resolved `[]`, was cached, and there was no attempt
   * two at all.
   */
  it('recovers the same rows on the retry after a lost auth race', async () => {
    const attempts = vi.fn()
      .mockResolvedValueOnce(failed('JWT expired'))
      .mockResolvedValueOnce(ok([TARGET]))

    await expect(loadTargets(await attempts(), ok([]))).rejects.toBeTruthy()
    await expect(loadTargets(await attempts(), ok([]))).resolves.toEqual([TARGET])
    expect(attempts).toHaveBeenCalledTimes(2)
  })
})

describe('the hook still declares the lifecycle this depends on', () => {
  it('checks the error on both reads, and retries', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('src/hooks/mobile/useScenarioCards.ts', 'utf8'))

    // The two swallowed errors, now surfaced.
    expect(src).toContain('if (error) throw error')
    expect(src).toContain('if (holdingsError) throw holdingsError')
    // A rejected query must be retried, or the lost race is still terminal.
    expect(src).toMatch(/retry:\s*2/)
    /**
     * And the key must still carry the org. It is the only dependency the
     * result varies by; a key missing it would cache one org's cards for
     * another, which is a worse bug than the one being fixed.
     */
    expect(src).toContain('[...SCENARIO_CARDS_KEY, currentOrgId,')
    expect(src).toContain('!!currentOrgId')
    /**
     * And the book it is size-aware from, as a digest.
     *
     * The cards now carry the position behind the framework, so a key that did
     * not vary with the book would serve yesterday's weight beside today's
     * price. The snapshot date and the position count change together whenever
     * the book does; hashing several thousand positions on every render would
     * cost more than the derivation the key guards.
     */
    expect(src).toContain('book?.asOf ?? null')
    expect(src).toContain('book?.positions.length ?? 0')
  })

  /**
   * The portfolio chip discloses positions, so it must not disclose one the
   * desk has already exited.
   *
   * This hook wrote its own snapshot rule — newest row per (asset, portfolio)
   * — which is wrong in one direction that matters. If a book's latest
   * snapshot is 1 August and a name last appeared in it on 1 July, the pair's
   * newest row IS that July row, so the card names a position closed a month
   * ago and puts a value beside it. `latestSnapshotRows` keeps only the rows
   * belonging to each portfolio's most recent date, which drops the name
   * exactly when the desk dropped it.
   *
   * Asserted against the source because the rule is a static one: `guard:holdings`
   * audits every `portfolio_holdings` site for it, and this hook was the 23rd
   * to hand-roll a date filter instead of using the shared helper.
   */
  it('takes its snapshot rule from the shared helper, not its own', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('src/hooks/mobile/useScenarioCards.ts', 'utf8'))

    expect(src).toContain("import { latestSnapshotRows } from '../../lib/holdings/latest-snapshot'")
    expect(src).toContain('latestSnapshotRows((holdings ?? []) as any[])')
    // The helper groups by portfolio, so the column has to be selected.
    expect(src).toMatch(/\.select\('asset_id, portfolio_id, shares, price, date/)
    // And the hand-rolled newest-date comparison is gone.
    expect(src).not.toMatch(/String\(h\.date \?\? ''\) > String\(prev\.date/)
  })
})
