import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * UX2 Phase 2 — Research as one coherent Investment Case document.
 *
 * AssetTab (~5k lines) and ContributionSection cannot be mounted affordably, so
 * these pin the wiring against comment-stripped source (the suite idiom). The
 * editor/draft/publish/visibility/history behaviour keeps its own behavioural
 * coverage in the contributions suites; here we prove the Phase-2 presentation:
 * one document container, flat per-section chrome, always-visible Edit, and the
 * personal-vs-consensus valuation note — all opt-in so other callers are intact.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))
const CONTRIB = codeOf(readFileSync(resolve(SRC, 'components/contributions/ContributionSection.tsx'), 'utf8'))

describe('UX2 P2: ContributionSection gains opt-in document presentation', () => {
  it('adds documentChrome + alwaysShowToolbar, both default OFF', () => {
    expect(CONTRIB).toMatch(/documentChrome\s*=\s*false/)
    expect(CONTRIB).toMatch(/alwaysShowToolbar\s*=\s*false/)
  })

  it('documentChrome renders flat (no card), keeping the card for other callers', () => {
    // flat branch has no border/fill/radius; the card branch (plainChrome etc.)
    // still exists for every non-document caller.
    expect(CONTRIB).toMatch(/documentChrome[\s\S]{0,120}bg-transparent rounded-none/)
    expect(CONTRIB).toContain("'border-l-4'") // card accent path preserved
  })

  it('Edit/Add-your-view no longer relies on hover', () => {
    expect(CONTRIB).toContain('showToolbar = isHovered || isEditing || showHistory || alwaysShowToolbar')
  })
})

describe('UX2 P2: AssetTab renders one Investment Case document', () => {
  it('wraps the individual-view sections in a single container (not a stack of cards)', () => {
    // one rounded container around the whole section map; sections are hairline-
    // separated flat regions, not per-section <Card>s.
    expect(ASSET_TAB).toContain('rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden')
    expect(ASSET_TAB).toContain('border-t border-gray-200 first:border-t-0')
    // the per-section case <Card> wrapper is gone (sections are flat divs now)
    expect(ASSET_TAB).not.toContain('padding="none" className={sectionShade}')
  })

  it('turns on documentChrome + alwaysShowToolbar for the case sections', () => {
    expect((ASSET_TAB.match(/documentChrome/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect((ASSET_TAB.match(/alwaysShowToolbar/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('keeps personal valuation visibly distinct from firm consensus', () => {
    expect(ASSET_TAB).toContain('personal, not the firm consensus')
    // only on the reader's own view
    expect(ASSET_TAB).toMatch(/isViewingOwnThesisTab && \([\s\S]{0,400}personal, not the firm consensus/)
  })

  it('preserves the Research read-modes (AI summary / History / Key references)', () => {
    for (const label of ['AI summary', 'History', 'Key references']) {
      expect(ASSET_TAB).toContain(`>${label}</span>`)
    }
  })

  it('does NOT invent section-linked evidence (no per-section evidence source added)', () => {
    // There is no real section→evidence relationship in the data model, so the
    // prototype's per-section evidence chips were deliberately NOT built. The
    // case-level freshness stays where it already lives (header/attention).
    expect(ASSET_TAB).not.toContain('Linked evidence')
    expect(ASSET_TAB).not.toContain('newer firm notes since')
  })
})
