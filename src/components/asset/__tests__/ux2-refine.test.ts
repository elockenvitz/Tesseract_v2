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
  it('lightens/desaturates the navy band (no longer the near-black #101d31)', () => {
    expect(CSS).not.toContain('#101d31')
    expect(CSS).toContain('--ux2-band:#223049')
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

describe('UX2 refine: near-full-screen focused editor', () => {
  it('EditingPane gains an overlay presentation + optional context rail', () => {
    expect(CONTRIB).toMatch(/overlay\s*=\s*false/)
    expect(CONTRIB).toContain('if (overlay) {')
    expect(CONTRIB).toContain('role="dialog" aria-modal="true"')
    expect(CONTRIB).toContain('contextNode')
  })

  it('reuses the same editor + handlers (no second editor, no new save path)', () => {
    // one EditingPane function; the overlay is a branch inside it
    expect((CONTRIB.match(/function EditingPane/g) ?? []).length).toBe(1)
    expect(CONTRIB).toContain('const run = (action: () => void) => (inline || overlay ? action() : collapseAndRun(action))')
  })

  it('keeps the unsaved safeguards for the overlay too (guardedEditor)', () => {
    expect(CONTRIB).toContain('const guardedEditor = inlineEditor || overlayEditor')
    expect(CONTRIB).toMatch(/if \(!guardedEditor\) return[\s\S]{0,120}registerUnsavedEditor/)
    expect(CONTRIB).toMatch(/dirtyRef\.current = guardedEditor && isDirty/)
  })

  it('AssetTab opens the case editor in the overlay', () => {
    expect((ASSET_TAB.match(/overlayEditor/g) ?? []).length).toBeGreaterThanOrEqual(2)
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
