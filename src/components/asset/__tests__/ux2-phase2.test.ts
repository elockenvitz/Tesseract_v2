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

  it('preserves the Research read-modes (AI summary / History / Key references)', () => {
    for (const label of ['AI summary', 'History', 'Key references']) {
      expect(ASSET_TAB).toContain(`>${label}</span>`)
    }
  })

  it('does NOT invent section-linked evidence (no per-section evidence source)', () => {
    expect(ASSET_TAB).not.toContain('Linked evidence')
    expect(ASSET_TAB).not.toContain('newer firm notes since')
  })
})
