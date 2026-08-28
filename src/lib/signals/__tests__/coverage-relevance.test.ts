import { describe, expect, it } from 'vitest'
import {
  coverageAttribution,
  coverageOwnership,
} from '../coverage-relevance'

const ASSET_A = '11111111-1111-4111-8111-111111111111'
const ASSET_B = '22222222-2222-4222-8222-222222222222'

const none = new Set<string>()
const covers = (...ids: string[]) => new Set(ids)

describe('coverageOwnership', () => {
  it('marks a covered asset as owned', () => {
    expect(
      coverageOwnership({ coveredAssetIds: covers(ASSET_A), entityId: ASSET_A }),
    ).toBe(true)
  })

  it('demotes an uncovered asset when the reader has coverage', () => {
    expect(
      coverageOwnership({ coveredAssetIds: covers(ASSET_A), entityId: ASSET_B }),
    ).toBe(false)
  })

  /**
   * Refusal 1. This is the case that protects every reader who has not
   * answered the coverage question yet — which, on the day this shipped, was
   * every user in every pilot workspace. Marking their whole feed unowned
   * would have flattened the ranking for the entire user base in exchange for
   * a signal nobody had supplied.
   */
  it('declines to answer when the reader has no coverage at all', () => {
    expect(
      coverageOwnership({ coveredAssetIds: none, entityId: ASSET_A }),
    ).toBeUndefined()
  })

  /**
   * Refusal 2 — the 12%-position case named in `PriorityInput.owned`. A held
   * name must never be demoted for lacking a coverage row, because most
   * workspaces have holdings and no coverage.
   */
  it('never demotes a held position', () => {
    expect(
      coverageOwnership({
        coveredAssetIds: covers(ASSET_A),
        entityId: ASSET_B,
        held: true,
      }),
    ).toBeUndefined()
  })

  it('still marks a held position owned when it is also covered', () => {
    expect(
      coverageOwnership({
        coveredAssetIds: covers(ASSET_A),
        entityId: ASSET_A,
        held: true,
      }),
    ).toBe(true)
  })

  /**
   * Refusal 3. A market card's entity id is a ticker, not a UUID; asking
   * whether "CPI" is in someone's coverage is a malformed question, not a
   * question with the answer "no".
   */
  it.each([
    ['a ticker', 'AAPL'],
    ['a synthetic id', 'signal-cluster-x'],
    ['an empty string', ''],
  ])('declines to answer for %s', (_label, entityId) => {
    expect(
      coverageOwnership({ coveredAssetIds: covers(ASSET_A), entityId }),
    ).toBeUndefined()
  })

  it('declines to answer when there is no entity at all', () => {
    expect(
      coverageOwnership({ coveredAssetIds: covers(ASSET_A), entityId: null }),
    ).toBeUndefined()
    expect(
      coverageOwnership({ coveredAssetIds: covers(ASSET_A) }),
    ).toBeUndefined()
  })
})

describe('coverageAttribution', () => {
  it('attributes a covered name to coverage', () => {
    expect(
      coverageAttribution({ coveredAssetIds: covers(ASSET_A), entityId: ASSET_A }),
    ).toEqual({ kind: 'covered', label: 'In your coverage' })
  })

  it('attributes a held-but-uncovered name to the book', () => {
    expect(
      coverageAttribution({
        coveredAssetIds: covers(ASSET_A),
        entityId: ASSET_B,
        held: true,
      }),
    ).toEqual({ kind: 'held', label: 'In your book' })
  })

  /**
   * The honest answer for a card the reader neither covers nor holds. Calling
   * this "recommended for you" would imply a personalization that was not
   * computed — `computePriority` reserves a `personalization` component that is
   * documented as always zero.
   */
  it('calls everything else a suggestion rather than implying personalization', () => {
    expect(
      coverageAttribution({ coveredAssetIds: covers(ASSET_A), entityId: ASSET_B }),
    ).toEqual({ kind: 'discovery', label: 'Suggested' })
  })

  it('does not claim coverage for a reader who has none', () => {
    expect(
      coverageAttribution({ coveredAssetIds: none, entityId: ASSET_A }).kind,
    ).toBe('discovery')
  })
})
