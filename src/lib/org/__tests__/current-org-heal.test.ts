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

  it('decides nothing for a user with no durable org', () => {
    expect(healDecision(input({ rawCurrentOrgId: null, cachedOrgIds: [OTHER] })))
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
   * `userOrgs[0]` was alphabetical, which is not a guess about intent — it is
   * no guess at all. With several orgs the reader chooses, through the
   * selector that already exists.
   */
  it('refuses to choose when several orgs remain', () => {
    expect(revoked([OTHER, THIRD])).toEqual({ kind: 'choose' })
    expect(effectiveOrgId(revoked([OTHER, THIRD]), PILOT)).toBeNull()
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
