import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Research presentation — the ORIGINAL per-section design, restored.
 *
 * The Phase-2 "one continuous Investment Case document" presentation
 * (documentChrome, always-visible Edit, a single rounded container) was reverted
 * at the founder's direction. Research sections are again individual cards with
 * the blue/amber accent, section hover-highlight and a hover-reveal Edit pencil,
 * while the corrected full-width in-page editor (fullPageEditor) is kept. Pinned
 * against comment-stripped source (the suite idiom); editor/draft/publish keep
 * their own behavioural coverage in the contributions suites.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))
const CONTRIB = codeOf(readFileSync(resolve(SRC, 'components/contributions/ContributionSection.tsx'), 'utf8'))

describe('Research presentation: original per-section cards restored', () => {
  it('renders each section as a <Card> with alternating shade (not one document container)', () => {
    expect(ASSET_TAB).toContain('padding="none" className={sectionShade}')
    expect(ASSET_TAB).toMatch(/sectionIdx % 2 === 1 \? '!bg-gray-50\/60'/)
    // the UX2 "one document" wrapper and flat hairline section rows are gone
    expect(ASSET_TAB).not.toContain('rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden')
    expect(ASSET_TAB).not.toContain('border-t border-gray-200 first:border-t-0')
  })

  it('keeps the blue left-accent + amber hover-highlight on fields (elevated: thin rail)', () => {
    expect(ASSET_TAB).toContain('border-l-[3px] border-l-blue-500')
    expect(ASSET_TAB).toContain('hover:border-amber-200 hover:bg-amber-50/30')
  })

  it('drops the invented document / quiet / always-on chrome; Edit pencil is hover-reveal again', () => {
    expect(ASSET_TAB).not.toContain('documentChrome')
    expect(ASSET_TAB).not.toContain('alwaysShowToolbar')
    expect(ASSET_TAB).not.toContain('plainChrome')
    // ContributionSection still gates the toolbar on hover (not permanently on)
    expect(CONTRIB).toContain('showToolbar = isHovered || isEditing || showHistory || alwaysShowToolbar')
  })

  it('keeps the full-width in-page editor on the case sections', () => {
    expect((ASSET_TAB.match(/fullPageEditor/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('keeps personal valuation visibly distinct from firm consensus', () => {
    expect(ASSET_TAB).toContain('personal, not the firm consensus')
    // only on the reader's own view
    expect(ASSET_TAB).toMatch(/isViewingOwnThesisTab && \([\s\S]{0,400}personal, not the firm consensus/)
  })

  /*
   * Re-pointed, not deleted. This read `['AI summary', 'History', 'Key
   * references']`.
   *
   * "AI summary" is no longer a read mode. It rendered the executive summary,
   * the sentiment split, the agreement and disagreement and a per-analyst
   * comparison -- the firm's perspective, its aggregate and its individual
   * views -- from the same `allAssetContributions` the Firm perspective reads.
   * So it answered that perspective's question from a control on the other
   * axis: this row is HOW to read a case, the pills are WHOSE. The split put
   * the firm's numbers in one and the firm's argument in the other with no way
   * to see both.
   *
   * The synthesis moved into the Firm branch rather than going away, so the
   * subject here is still "every read mode carries a visible label" and the
   * count is now three.
   */
  it('preserves the Research read-modes (Investment Case / History / Key references)', () => {
    for (const label of ['Investment Case', 'History', 'Key references']) {
      expect(ASSET_TAB).toContain(`>${label}</span>`)
    }
    /* Gone as a mode: no button, no branch, and no member in the union a
       persisted tab is narrowed to. A leftover `'summary'` arm would restore
       a mode with nothing to leave it by. */
    expect(ASSET_TAB).not.toContain('>AI summary</span>')
    expect(ASSET_TAB).not.toMatch(/thesisViewMode === 'summary'/)
    expect(ASSET_TAB).not.toMatch(/goToThesisMode\('summary'\)/)
    expect(ASSET_TAB).toMatch(/useState<'all' \| 'history' \| 'references'>/)
  })

  /*
   * The other half of that move: the synthesis has to be SOMEWHERE, and the
   * only place it can be is the branch that answers the same question.
   *
   * Without this, deleting the button alone satisfies the case above while
   * removing the feature outright, which is the failure the pair exists to
   * catch.
   */
  it('renders the synthesis inside the Firm perspective, between the numbers and the words', () => {
    const firmBranch = ASSET_TAB.slice(ASSET_TAB.indexOf('isAggregatedView ?'))
    const at = (needle: string) => firmBranch.indexOf(needle)
    expect(at('<PriceTargetsSummary'), 'no aggregated price targets').toBeGreaterThan(-1)
    expect(at('<ThesisUnifiedSummary'), 'the synthesis is not in the Firm branch').toBeGreaterThan(-1)
    expect(at('<OurViewSummary'), 'no attributed per-field record').toBeGreaterThan(-1)
    /* Computed, then generated, then written. The generated band must not sit
       above the numbers (where it reads as one of them) or below the record
       (where the record it summarises has already been read). */
    expect(at('<PriceTargetsSummary')).toBeLessThan(at('<ThesisUnifiedSummary'))
    expect(at('<ThesisUnifiedSummary')).toBeLessThan(at('<OurViewSummary'))
  })

  it('does NOT invent section-linked evidence (no per-section evidence source)', () => {
    expect(ASSET_TAB).not.toContain('Linked evidence')
    expect(ASSET_TAB).not.toContain('newer firm notes since')
  })
})
