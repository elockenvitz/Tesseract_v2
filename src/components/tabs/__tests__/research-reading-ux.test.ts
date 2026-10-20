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
    for (const label of ['All sections', 'AI summary', 'History', 'Key references']) {
      expect(ASSET_TAB, `visible label "${label}" should be rendered`).toContain(`>${label}</span>`)
    }
  })

  it('still offers the Firm-vs-analyst perspective selector', () => {
    expect(ASSET_TAB).toContain('Firm valuation')
    expect(ASSET_TAB).toMatch(/chooseResearchView\('aggregated'\)/)
  })
})

describe('UX1c-1: the case reading cards use the quiet chrome variant', () => {
  it('ContributionSection accepts and applies a plainChrome variant', () => {
    expect(CONTRIB).toContain('plainChrome')
    // It gates the coloured 4px accent / amber hover / shadow behind the flag,
    // so the default (editing + other callers) keeps its existing chrome.
    expect(CONTRIB).toMatch(/plainChrome\s*[?]/)
    expect(CONTRIB).toContain("'border-l-4'")
  })

  it('AssetTab passes plainChrome to both case ContributionSection renders', () => {
    const count = (ASSET_TAB.match(/plainChrome/g) ?? []).length
    expect(count).toBeGreaterThanOrEqual(2)
  })

  it('does not add a second references or notes surface to the reading view', () => {
    // UX1c-1 must not duplicate references/notes. References still render once,
    // via the single KeyReferences path; no new inline reference block was added.
    expect(CONTRIB).not.toMatch(/ViewReferences[\s\S]{0,400}ViewReferences/)
  })
})
