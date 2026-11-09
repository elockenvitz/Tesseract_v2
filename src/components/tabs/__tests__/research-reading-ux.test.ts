import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * UX1c-1 — Research navigation + Investment Case reading.
 *
 * AssetTab is a ~5,000-line component that cannot be mounted affordably, so —
 * like asset-page-trust.test.ts — these pin the wiring against comment-stripped
 * source: the four read-modes are now LABELLED (not icon-only), and the case
 * reading cards render with the quiet `plainChrome` variant. Behaviour (editing,
 * drafts, publishing, visibility, history) is covered by the ContributionSection
 * / contributions suites and is unchanged here.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))
const CONTRIB = codeOf(readFileSync(resolve(SRC, 'components/contributions/ContributionSection.tsx'), 'utf8'))

describe('UX1c-1: the three Research modes are clearly labelled', () => {
  it('each read-mode carries a visible text label, not just an icon tooltip', () => {
    // Pin the visible <span> label, not the title="" attribute — the old
    // icon-only buttons already had the titles, so asserting the bare text
    // would pass vacuously. The label lives in a `hidden xl:inline` span.
    // "All sections" became "Investment Case" in Lane A: it names the thing
    // being read rather than describing the renderer.
    //
    // Was four. "AI summary" is no longer a read mode: it read the same
    // contributions as the Firm perspective and answered that perspective's
    // question from the other axis (this row is HOW to read a case, the pills
    // are WHOSE), so it moved into the Firm branch beside the aggregated
    // valuation it never had. ux2-phase2 pins where it landed and its order
    // among the computed and written blocks.
    // "Key references" became "Artifacts", matching what that surface's own
    // contents already said ("Key Artifacts", "No matching artifacts").
    for (const label of ['Investment Case', 'History', 'Artifacts']) {
      expect(ASSET_TAB, `visible label "${label}" should be rendered`).toContain(`>${label}</span>`)
    }
    expect(ASSET_TAB, 'AI summary is no longer a read mode').not.toContain('>AI summary</span>')
  })

  it('offers the two-mode perspective selector (My Research / Firm)', () => {
    // UX2 Phase 1 renamed the "Firm valuation" pill to "Organization"; it is
    // now "Firm". Two earlier names were each true of the pane when written and
    // wrong once it changed, so this one names WHOSE view it is rather than
    // what happens to be in it. It is also the word the rest of the product
    // uses for this scope: visibility is team | division | firm, and
    // `ratingViewScope` has returned `{ type: 'firm' }` for this branch all
    // along. "Team" was rejected because it is the NARROWEST of those three
    // and this view is the widest.
    expect(ASSET_TAB).toContain('>My Research<')
    expect(ASSET_TAB).toMatch(/<Users className="w-3\.5 h-3\.5" \/>\s*Firm\s*<\/button>/)
    expect(ASSET_TAB).toContain('<option value="aggregated">Firm</option>')
    // The destination is unchanged: only the label moved, so a persisted tab
    // state and every `researchViewFilter` consumer still see 'aggregated'.
    expect(ASSET_TAB).toMatch(/chooseResearchView\('aggregated'\)/)
    expect(ASSET_TAB).toMatch(/const isAggregatedView = researchViewFilter === 'aggregated'/)
    // Both arms of one control say the same word. The pill shows at <= 5
    // analysts and the <option> above it, so a rename of one alone leaves the
    // product calling the same perspective two things by headcount.
    expect(ASSET_TAB).not.toContain('Organization (firm valuation)')
  })
})

describe('UX1c-1: the case reading cards use the quiet chrome variant', () => {
  it('has no quiet-chrome variant left to take', () => {
    /*
     * This required ContributionSection to ACCEPT and apply
     * `plainChrome`. The prop is gone: UX2 Phase 2 reversed the design
     * it existed for, no caller was left, and a presentational branch
     * nobody takes is a third rendering path to keep correct through
     * every later change, for no screen.
     *
     * Inverted rather than deleted so the removal is deliberate and
     * stays deliberate — `ux2-phase2.test.ts` already forbids AssetTab
     * from passing it, and this forbids the component from offering it.
     */
    expect(CONTRIB).not.toContain('plainChrome')
  })

  it('keeps the accent rail on the reading card', () => {
    // The accent was a 4px bar when this was written. UX2 Phase 2 made it a
    // thin 3px rail — `ux2-phase2.test.ts` pins that deliberately, under
    // "keeps the blue left-accent (elevated: thin rail)". Updated here rather
    // than left red, because asserting the old width made this suite claim a
    // regression every run while the real contract was being asserted,
    // correctly, two files away.
    expect(CONTRIB).toContain("'border-l-[3px]'")
  })

  it('does NOT pass plainChrome to the case sections — Phase 2 reversed that', () => {
    /*
     * This assertion is inverted from the one it replaces, which required
     * AssetTab to pass `plainChrome` at least twice.
     *
     * The two tests contradicted each other and one of them had to be
     * wrong: `ux2-phase2.test.ts:41` requires AssetTab NOT to contain
     * `plainChrome` at all, alongside `documentChrome` and
     * `alwaysShowToolbar`, under "drops the invented document / quiet /
     * always-on chrome".
     *
     * UX2 Phase 2 is the later lane and it won — deliberately. The case
     * no longer reads as one quiet document; each section is a <Card>
     * with alternating shade, which `ux2-phase2.test.ts` pins and which
     * the page actually renders. The quiet variant was the UX1c-1 design
     * that replaced.
     *
     * Kept as an assertion rather than deleted, so a future lane that
     * reaches for `plainChrome` on the case meets the decision instead of
     * silently re-opening the argument. The prop has since been removed
     * from ContributionSection too — see above.
     */
    expect(ASSET_TAB).not.toContain('plainChrome')
  })
})

describe('the "Show more" fold answers the width the card actually has', () => {
  it('re-measures when the element resizes, not only when the text changes', () => {
    /*
     * The effect ran on `[content]` alone, so the fold was decided once
     * at mount and then kept. Prose gets TALLER as its column narrows —
     * Investment Thesis measures 176px at a half and 309px at a quarter
     * — so once the Research page let a reader change a field's width,
     * every fold on the page was answering a question about a width
     * that no longer existed: a field widened to full kept a fold it no
     * longer needed, one narrowed lost the fold it had just earned.
     */
    expect(CONTRIB).toMatch(/new ResizeObserver\(measure\)/)
    expect(CONTRIB).toMatch(/observer\.observe\(el\)/)
    expect(CONTRIB).toMatch(/observer\.disconnect\(\)/)
  })

  it('degrades rather than throwing where ResizeObserver does not exist', () => {
    /* jsdom and older browsers. The first measurement still runs; only
       the re-measurement is skipped, which is the old behaviour. */
    expect(CONTRIB).toMatch(/typeof ResizeObserver === 'undefined'/)
  })

  it('clamps at the height it measured, not at a second literal', () => {
    /* It was a hardcoded `max-h-[240px]` beside a `COLLAPSED_MAX_HEIGHT
       = 240` — two sources of truth for one number, where changing
       either alone makes the page clamp at a height it never decided on
       and puts the fade and the button over content that was not cut. */
    expect(CONTRIB).toMatch(/style=\{!expanded && needsCollapse \? \{ maxHeight \} : undefined\}/)
    expect(CONTRIB).not.toContain('max-h-[240px]')
  })

  it('means ten lines by "ten lines"', () => {
    /* 240px was ten lines only at the font size it was written against.
       The limit now comes off the element's own computed line-height, so
       it follows the prose styles and the reader's browser font size;
       the pixel value survives only as the fallback. */
    expect(CONTRIB).toMatch(/COLLAPSED_LINES = 10/)
    expect(CONTRIB).toMatch(/lineHeight \* COLLAPSED_LINES/)
    expect(CONTRIB).toMatch(/Number\.isFinite\(lineHeight\) && lineHeight > 0/)
  })

  it('does not add a second references or notes surface to the reading view', () => {
    // UX1c-1 must not duplicate references/notes. References still render once,
    // via the single KeyReferences path; no new inline reference block was added.
    expect(CONTRIB).not.toMatch(/ViewReferences[\s\S]{0,400}ViewReferences/)
  })
})
