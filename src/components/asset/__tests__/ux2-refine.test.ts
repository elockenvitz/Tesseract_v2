import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * UX2 Phase 1/2 refinement pass — header integration, document hierarchy, the
 * near-full-screen focused editor, and the attention popover. Source-pinned
 * against comment-stripped source (the unmountable-AssetTab/ContributionSection
 * idiom). Behaviour keeps its own coverage in the editor/guard suites.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))
const CONTRIB = codeOf(readFileSync(resolve(SRC, 'components/contributions/ContributionSection.tsx'), 'utf8'))
const HEADER = codeOf(readFileSync(resolve(SRC, 'components/asset/AssetWorkspaceHeader.tsx'), 'utf8'))
const BAND = codeOf(readFileSync(resolve(SRC, 'components/asset/AttentionBand.tsx'), 'utf8'))
const CSS = readFileSync(resolve(SRC, 'components/asset/asset-ux2.css'), 'utf8')

describe('UX2 refine: header integration', () => {
  it('light mode: the band is a crisp white surface, not a dark or muddy banner', () => {
    expect(CSS).not.toContain('#101d31')
    expect(CSS).not.toContain('#223049') // the earlier "lighter navy" is gone
    expect(CSS).not.toContain('linear-gradient') // the gradient attempt is gone
    expect(CSS).toContain('--ux2-band:#ffffff') // white identity surface
    expect(CSS).toContain('--ux2-ink:#1e293b')  // dark ink on the white band
  })

  it('dark mode keeps a solid navy band, defined separately', () => {
    expect(CSS).toMatch(/\.dark \.ux2-scope\{[\s\S]*--ux2-band:#111c30/)
  })

  it('the band floats over the content: hairline border + soft shadow', () => {
    expect(CSS).toMatch(/\.ux2-band\{[\s\S]*border-bottom:1px solid var\(--ux2-band-line\)/)
    expect(CSS).toMatch(/\.ux2-band\{[\s\S]*box-shadow:/)
  })

  it('closes the white gutter between the tab bar and the band (-mt-4)', () => {
    expect(HEADER).toMatch(/ux2-band -mx-8 -mt-4/)
  })

  it('moves the collapse control into the band and off the tab nav', () => {
    expect(HEADER).toContain('onToggleCollapse')
    expect(HEADER).toMatch(/aria-pressed=\{collapsed\}/)
    expect(ASSET_TAB).toContain('onToggleCollapse={toggleHeaderCollapsed}')
    // the old nav button text is gone from the tab strip
    expect(ASSET_TAB).not.toContain("{headerCollapsed ? 'Expand header' : 'Collapse header'}")
  })
})

describe('UX2 refine: restored full-width in-page expand editor', () => {
  it('uses the proven in-page expand-takeover, NOT a modal overlay', () => {
    // The UX2 modal overlay was removed: no dialog, no dimmed backdrop, no
    // overlay prop / context rail.
    expect(CONTRIB).not.toContain('aria-modal="true"')
    expect(CONTRIB).not.toContain('overlayEditor')
    expect(CONTRIB).not.toMatch(/\boverlay\b/)
  })

  it('the takeover anchors on the stable .contribution-pane marker', () => {
    // documentChrome dropped the old `.rounded-lg` card, so the expand lookup
    // targets the marker the root always carries (fallback kept for old callers).
    expect(CONTRIB).toContain("'contribution-pane'")
    expect(CONTRIB).toContain("el.closest('.contribution-pane')")
    // the takeover effect runs for the default path (only inline bails)
    expect(CONTRIB).toContain('if (inline) return')
  })

  it('reuses the same editor + handlers (no second editor, no new save path)', () => {
    expect((CONTRIB.match(/function EditingPane/g) ?? []).length).toBe(1)
    expect(CONTRIB).toContain('const run = (action: () => void) => (inline ? action() : collapseAndRun(action))')
  })

  it('keeps the unsaved safeguards on the full-page editor (guardedEditor)', () => {
    expect(CONTRIB).toContain('const guardedEditor = inlineEditor || fullPageEditor')
    expect(CONTRIB).toMatch(/if \(!guardedEditor\) return[\s\S]{0,120}registerUnsavedEditor/)
    expect(CONTRIB).toMatch(/dirtyRef\.current = guardedEditor && isDirty/)
  })

  it('AssetTab opens the case editor with the full-page takeover', () => {
    expect((ASSET_TAB.match(/fullPageEditor/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(ASSET_TAB).not.toContain('overlayEditor')
  })
})

describe('UX2 refine: attention popover says what / why / where', () => {
  it('adds a readable destination label without touching the resolver', () => {
    expect(BAND).toContain('DEST_LABEL')
    expect(BAND).toMatch(/Open \{DEST_LABEL\[s\.destination\]\}/)
    // deep-link is unchanged: still onOpen(destination, focus)
    expect(BAND).toContain('onClick={() => onOpen(s.destination, s.focus)}')
  })
})
