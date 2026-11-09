import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initialResearchView } from '../research-view'

/**
 * The Asset Page's opening research perspective.
 *
 * The defect these pin: the perspective was seeded to 'aggregated' and left
 * UNDECIDED for every reader, so an effect waiting on three async queries
 * corrected it one tick later. Measured on a cold asset open, the Organization
 * case rendered at 552ms and was replaced by My Research at 622ms — the page
 * flipping between two different cases.
 *
 * `decided` is the load-bearing field. A seed that lands on the right view but
 * reports itself undecided still gets overwritten by the resolver, which is
 * the flicker, so every case below asserts the pair.
 */
describe('initialResearchView', () => {
  it('lands a signed-in reader on their own view, DECIDED, with no wait', () => {
    expect(initialResearchView({ userId: 'u-reader' })).toEqual({
      filter: 'u-reader',
      decided: true,
      chosen: false,
    })
  })

  it('does not record that default as a choice (it must never be persisted)', () => {
    // A default persisted as a preference keeps sending the reader back to a
    // view they never picked — the exact outcome the default exists to avoid.
    expect(initialResearchView({ userId: 'u-reader' }).chosen).toBe(false)
  })

  it('an arriving navigation intent wins over the reader default, and is a choice', () => {
    expect(initialResearchView({ arriving: 'aggregated', userId: 'u-reader' })).toEqual({
      filter: 'aggregated',
      decided: true,
      chosen: true,
    })
    expect(initialResearchView({ arriving: 'u-other', userId: 'u-reader' })).toEqual({
      filter: 'u-other',
      decided: true,
      chosen: true,
    })
  })

  it('stays UNDECIDED only when there is no reader, so the async resolver runs', () => {
    // This is the one case that genuinely needs coverage/contributions: the
    // standin analyst can only be known once those land.
    expect(initialResearchView({})).toEqual({
      filter: 'aggregated',
      decided: false,
      chosen: false,
    })
    expect(initialResearchView({ userId: null, arriving: null })).toEqual({
      filter: 'aggregated',
      decided: false,
      chosen: false,
    })
  })

  it('treats an empty-string id as no reader rather than as a user id', () => {
    // Downstream consumers compare the filter against user ids; '' would match
    // nobody and render an empty "own" view with no way to tell why.
    expect(initialResearchView({ userId: '' }).decided).toBe(false)
    expect(initialResearchView({ arriving: '' }).decided).toBe(false)
  })
})

/**
 * The seam itself: AssetTab must take the seed from this helper rather than
 * re-deriving it, and must not re-introduce the deferred-for-everyone wait.
 *
 * AssetTab is ~5,000 lines and is not affordably mountable, so this is a
 * source guard — deliberately narrow, pinning only the three seeds and the
 * resolver's early return.
 */
describe('AssetTab takes its opening perspective from this helper', () => {
  const src = () =>
    readFileSync(resolve(__dirname, '../../../components/tabs/AssetTab.tsx'), 'utf8')

  it('seeds all three pieces of state from one initialResearchView call', () => {
    const body = src()
    expect(body).toMatch(/useRef\(initialResearchView\(\{/)
    expect(body).toMatch(/useState<'aggregated' \| string>\(researchSeed\.filter\)/)
    expect(body).toMatch(/useState<boolean>\(researchSeed\.decided\)/)
    expect(body).toMatch(/useState<boolean>\(researchSeed\.chosen\)/)
  })

  it('does not seed the perspective to the firm summary for everyone', () => {
    // The regressed form: an initialiser whose only fallthrough is the
    // aggregated sentinel, with the reader's own id never consulted.
    const body = src()
    expect(body).not.toMatch(/useState<'aggregated' \| string>\(\(\) => \{/)
  })

  it('still carries a resolver, gated on the decided flag', () => {
    // The no-reader fallback must survive this change, and must keep its
    // early return — without it the resolver would overwrite the seed.
    expect(src()).toMatch(/if \(researchDefaultDecided\) return/)
  })
})
