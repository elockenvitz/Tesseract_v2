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

describe('UX1c-1: the four Research modes are clearly labelled', () => {
  it('each read-mode carries a visible text label, not just an icon tooltip', () => {
    // Pin the visible <span> label, not the title="" attribute — the old
    // icon-only buttons already had the titles, so asserting the bare text
    // would pass vacuously. The label lives in a `hidden xl:inline` span.
    // "All sections" became "Investment Case" in Lane A: it names the thing
    // being read rather than describing the renderer.
    for (const label of ['Investment Case', 'AI summary', 'History', 'Key references']) {
      expect(ASSET_TAB, `visible label "${label}" should be rendered`).toContain(`>${label}</span>`)
    }
  })

  it('offers the two-mode perspective selector (UX2 P1: My Research / Organization)', () => {
    // UX2 Phase 1 renamed the "Firm valuation" pill to "Organization" and added
    // an explicit "My Research" pill; the aggregated destination is unchanged.
    expect(ASSET_TAB).toContain('Organization')
    expect(ASSET_TAB).toContain('>My Research<')
    expect(ASSET_TAB).toMatch(/chooseResearchView\('aggregated'\)/)
  })
})

describe('UX1c-1: the case reading cards use the quiet chrome variant', () => {
  it('ContributionSection accepts and applies a plainChrome variant', () => {
    expect(CONTRIB).toContain('plainChrome')
    // It gates the coloured accent / amber hover / shadow behind the flag, so
    // the default (editing + other callers) keeps its existing chrome.
    expect(CONTRIB).toMatch(/plainChrome\s*[?]/)
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
     * silently re-opening the argument. The prop itself survives on
     * ContributionSection for other callers.
     */
    expect(ASSET_TAB).not.toContain('plainChrome')
  })

  it('does not add a second references or notes surface to the reading view', () => {
    // UX1c-1 must not duplicate references/notes. References still render once,
    // via the single KeyReferences path; no new inline reference block was added.
    expect(CONTRIB).not.toMatch(/ViewReferences[\s\S]{0,400}ViewReferences/)
  })
})
