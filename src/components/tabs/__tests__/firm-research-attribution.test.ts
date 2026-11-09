import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A2 — Firm Consensus integrated into Research.
 *
 * The aggregated "Firm" view of Research used to render the firm's NUMBERS
 * (price targets, rating consensus) and then redirect the reader to the
 * Snapshot to find out WHO wrote what and where they differ. A2 renders that
 * contributor context in place, read-only, without inventing a data model.
 *
 * AssetTab is a ~5,000-line component that cannot be mounted affordably, so —
 * like asset-page-trust.test.ts — these are pinned against comment-stripped
 * source. The substance (attribution, visibility scoping, read-only) is proven
 * by our-view-summary.test.ts against the component this wires in; what is
 * worth guarding HERE is the wiring: that the Firm view feeds the RLS-scoped
 * contributions into the read-only summary and no longer dead-ends at Snapshot.
 *
 * Every assertion runs on comment-stripped text, or the long rationale now
 * sitting above the call site would satisfy the gate on its own.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))

// The aggregated-view branch: `isAggregatedView ? (...firm...) : (...individual...)`.
// We pin assertions to the firm block so an edit to the individual view can't
// silently satisfy them. The block is anchored to STABLE boundaries that do
// not depend on its own body: it opens at the PriceTargetsSummary panel and
// ends where the individual "All" view begins (`displayedFieldsBySection.map`,
// the first token after the `) : (` on comment-stripped source). Anchoring
// this way is deliberate — a body-dependent end anchor (e.g. "...up to
// <OurViewSummary>") would collapse to an empty match the moment the body it
// guards is removed, and then every `.not.toMatch` over it would pass on "".
//
// The end anchor was `displayedFieldsBySection.map` until arrange mode made
// the same call site read
//   `(arrangingLayout ? sectionsForArranging : displayedFieldsBySection).map`
// — the individual view still begins in exactly the same place, but the token
// changed and the regex stopped matching. The `not.toBe('')` guard below is
// what reported it instead of three assertions quietly passing on an empty
// string, which is the whole reason that guard is there. The anchor now
// tolerates an optional `)` before `.map` so a future wrapper around the same
// expression does not re-break it.
const FIRM_BLOCK =
  /<PriceTargetsSummary[\s\S]*?displayedFieldsBySection\)?\.map/.exec(ASSET_TAB)?.[0] ?? ''

describe('A2: Firm Research shows contributor attribution in place', () => {
  it('renders the firm valuation panels AND the contributor summary together', () => {
    expect(FIRM_BLOCK, 'firm aggregated block should be found').not.toBe('')
    expect(FIRM_BLOCK).toContain('<PriceTargetsSummary')
    expect(FIRM_BLOCK).toContain('<FirmConsensusPanel')
    expect(FIRM_BLOCK).toContain('<OurViewSummary')
  })

  it('no longer dead-ends the reader at the Snapshot to find contributors', () => {
    // The redirect paragraph it replaces switched sub-page to 'snapshot'.
    expect(FIRM_BLOCK).not.toMatch(/setActiveSubPage\(['"]snapshot['"]\)/)
  })

  it('feeds the RLS-scoped contributions, not a fresh unfiltered source', () => {
    // allAssetContributions is the org- + visibility-scoped result of
    // useContributions; the Firm view inherits that boundary rather than
    // introducing a data path of its own.
    expect(FIRM_BLOCK).toMatch(/contributions=\{allAssetContributions\}/)
    expect(FIRM_BLOCK).toMatch(/fields=\{ourViewFields\}/)
    expect(FIRM_BLOCK).toMatch(/coveringAnalystIds=\{coveringAnalystIds\}/)
  })

  it('is read-only: it lists authors and opens their research, it does not edit', () => {
    // mode="full" is the attributed read-only summary. No save/draft/publish
    // handler is wired into this surface; the only action is navigation.
    expect(FIRM_BLOCK).toMatch(/mode="full"/)
    expect(FIRM_BLOCK).toMatch(/onOpenAnalyst=\{chooseResearchView\}/)
    expect(FIRM_BLOCK).not.toMatch(/onSave|onPublish|onDraft|onEdit/)
  })
})

describe('A2: the individual Investment Case authoring path is untouched', () => {
  it('the per-analyst editing seam still exists elsewhere in the component', () => {
    // A2 changed only the aggregated branch; personal editing/drafts/publishing
    // live in the individual view and must remain.
    expect(ASSET_TAB).toMatch(/handleSectionSave|onSaveValue|updateAssetMutation/)
  })

  it('OurViewSummary is imported as a value (the Firm view renders it)', () => {
    expect(ASSET_TAB).toMatch(/import\s*\{\s*OurViewSummary[\s\S]*?\}\s*from\s*['"]\.\.\/asset\/OurViewSummary['"]/)
  })
})
