/**
 * When a durable current org may be rewritten, and when it may not.
 *
 * The defect these pin was found in live data: a membership created moments
 * earlier was absent from a ten-minute React Query cache, the heal read that
 * absence as revocation, and it wrote an unrelated org over a correct one.
 * Every org-scoped query then returned nothing, permanently, because the write
 * is durable.
 */

import { describe, it, expect } from 'vitest'
import { effectiveOrgId, healDecision, type HealInput } from '../current-org-heal'

const PILOT = 'org-pilot'
const OTHER = 'org-other'
const THIRD = 'org-third'

const input = (over: Partial<HealInput> = {}): HealInput => ({
  rawCurrentOrgId: PILOT,
  cachedOrgIds: [PILOT],
  isLoading: false,
  ...over,
})

describe('nothing to do', () => {
  it('leaves a current org that is in the cached list alone', () => {
    expect(healDecision(input())).toEqual({ kind: 'none' })
  })

  /** A list that has not arrived is not a list that lacks the org. */
  it('decides nothing while the membership list is loading', () => {
    expect(healDecision(input({ cachedOrgIds: [], isLoading: true })))
      .toEqual({ kind: 'none' })
  })

  /**
   * No durable org is a first session, or a column the database nulled when
   * the organization it named was deleted. Nothing here can be clobbered by
   * choosing, and leaving it null showed a reader with a workspace a header
   * saying they had none.
   */
  it('adopts the only workspace available when there is no durable org', () => {
    expect(healDecision(input({ rawCurrentOrgId: null, cachedOrgIds: [OTHER] })))
      .toEqual({ kind: 'heal', target: OTHER })
  })

  it('has nowhere to put a user who belongs to nothing', () => {
    expect(healDecision(input({ rawCurrentOrgId: null, cachedOrgIds: [] })))
      .toEqual({ kind: 'stranded' })
  })

  /** Still never decided from a list that has not arrived. */
  it('adopts nothing while the membership list is loading', () => {
    expect(healDecision(input({ rawCurrentOrgId: null, cachedOrgIds: [], isLoading: true })))
      .toEqual({ kind: 'none' })
  })
})

describe('the Zverev reproduction', () => {
  /**
   * The exact shape found in live data: the pilot membership is active, and
   * it is missing from a stale cache that still lists the reader's older org.
   */
  const stale = input({ rawCurrentOrgId: PILOT, cachedOrgIds: [OTHER] })

  it('asks the database rather than assuming revocation', () => {
    expect(healDecision(stale)).toEqual({ kind: 'verify', orgId: PILOT })
  })

  it('keeps the org once the membership is confirmed active', () => {
    const d = healDecision({ ...stale, authoritativeIsActive: true })
    expect(d).toEqual({ kind: 'keep', orgId: PILOT })
  })

  /** The whole point: no write, so the durable column cannot be clobbered. */
  it('never reaches a heal while the membership is alive', () => {
    const d = healDecision({ ...stale, authoritativeIsActive: true })
    expect(d.kind).not.toBe('heal')
    expect(effectiveOrgId(d, PILOT)).toBe(PILOT)
  })

  /** And the reader stays in their workspace while the check is in flight. */
  it('does not drop the reader out of the org while verifying', () => {
    expect(effectiveOrgId(healDecision(stale), PILOT)).toBe(PILOT)
  })
})

describe('a genuine revocation', () => {
  const revoked = (cached: string[]) => healDecision(input({
    rawCurrentOrgId: PILOT,
    cachedOrgIds: cached,
    authoritativeIsActive: false,
  }))

  it('heals when exactly one org remains, because there is nothing to decide', () => {
    expect(revoked([OTHER])).toEqual({ kind: 'heal', target: OTHER })
    expect(effectiveOrgId(revoked([OTHER]), PILOT)).toBe(OTHER)
  })

  /**
   * It used to refuse here, on the grounds that `userOrgs[0]` is alphabetical
   * and therefore not a guess about intent. True, and the wrong trade:
   * refusing left `currentOrgId` null, which is a reader who has workspaces
   * being told they are in none. Changing it is one tap in a selector that is
   * always on screen; not picking looked like everything had vanished.
   */
  it('takes the first available when several orgs remain', () => {
    expect(revoked([OTHER, THIRD])).toEqual({ kind: 'heal', target: OTHER })
    expect(effectiveOrgId(revoked([OTHER, THIRD]), PILOT)).toBe(OTHER)
  })

  it('says so plainly when there is nowhere to go', () => {
    expect(revoked([])).toEqual({ kind: 'stranded' })
    expect(effectiveOrgId(revoked([]), PILOT)).toBeNull()
  })

  /**
   * A revocation the cache has not caught up with yet is simply not detected,
   * and that is right: the org is still listed, so nothing looks wrong, and
   * the next refresh of the list is what surfaces it. The rule is only ever
   * about what justifies a WRITE, and a stale list justifies none in either
   * direction.
   */
  it('does nothing while the revoked org is still in the cached list', () => {
    expect(revoked([PILOT, OTHER])).toEqual({ kind: 'none' })
  })
})
