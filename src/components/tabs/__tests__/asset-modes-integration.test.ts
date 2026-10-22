/**
 * The four-mode Asset page, wired into the real tab.
 *
 * AssetTab needs a live Supabase client, auth and organization context to
 * mount, so the wiring is pinned against source; the model itself is tested
 * in src/lib/asset-workspace/__tests__/modes.test.ts.
 *
 * The thing these assertions protect is that NOTHING was dropped. Five tabs
 * became four modes, and the three that merged — Process, Ideas, Lists — are
 * sections of one surface rather than pages that went away. A regression here
 * looks like a reader who can no longer reach their lists.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const TAB = strip(read('src/components/tabs/AssetTab.tsx'))
const SNAP = strip(read('src/components/asset/InvestmentSnapshot.tsx'))

describe('the nav shows four modes, driven by the model', () => {
  it('maps the model rather than hand-writing five buttons', () => {
    expect(TAB).toMatch(/ASSET_MODES\.map\(mode =>/)
    expect(TAB).toMatch(/\{MODE_LABEL\[mode\]\}/)
    expect(TAB).toMatch(/onClick=\{\(\) => goToMode\(mode\)\}/)
  })

  it('has no leftover per-tab button', () => {
    // The five buttons were deleted, not hidden behind a false guard.
    expect(TAB).not.toMatch(/goToSubPage\('snapshot'\)/)
    expect(TAB).not.toMatch(/goToSubPage\('lists'\)/)
    expect(TAB).not.toMatch(/goToSubPage\('workflow'\)/)
    expect(TAB).not.toMatch(/\{false &&/)
    expect(TAB).not.toMatch(/<span>Snapshot<\/span>/)
    expect(TAB).not.toMatch(/<span>Decisions<\/span>/)
  })

  it('marks the current mode for a screen reader, not only with colour', () => {
    expect(TAB).toMatch(/aria-current=\{current \? 'page' : undefined\}/)
    expect(TAB).toMatch(/aria-label="Asset modes"/)
  })

  it('keeps the running-process count on Work, from the same source', () => {
    expect(TAB).toMatch(/mode === 'work' && activeProcessCount > 0/)
  })
})

describe('every mode renders something', () => {
  it.each([
    ['overview', /\{activeMode === 'overview' && \(\s*\n?\s*<InvestmentSnapshot/],
    ['research', /\{activeMode === 'research' && \(\s*\n?\s*<div className="space-y-3 min-h-full">/],
    ['work', /\{activeMode === 'work' && \(/],
  ] as const)('%s has content', (_mode, pattern) => {
    expect(TAB).toMatch(pattern)
  })

  it('renders History from the same block as Work, so the holdings maths is computed once', () => {
    expect(TAB).toMatch(/\(activeMode === 'work' \|\| activeMode === 'history'\) && \(\(\) => \{/)
    expect(TAB).toMatch(/\{activeMode === 'history' && \(<>/)
  })

  it('leaves no guard on a sub-page key that no longer switches content', () => {
    // Every render branch is on the mode now. A stray `activeSubPage ===`
    // guard would be a section that only one of the merged destinations can
    // reach — the bug this refactor exists to remove.
    expect(TAB).not.toMatch(/\{activeSubPage === '/)
  })
})

describe('the three merged destinations are all still reachable', () => {
  it('renders Process, Ideas and Lists together under Work', () => {
    const work = (TAB.match(/\{activeMode === 'work' && \(/g) ?? []).length
    // The band, Process, Ideas and Lists.
    expect(work).toBeGreaterThanOrEqual(4)
  })

  it('anchors each Work section to the id the model names', () => {
    expect(TAB).toMatch(/id=\{WORK_SECTION_ID\.workflow\}/)
    expect(TAB).toMatch(/id=\{WORK_SECTION_ID\.decisions\}/)
    expect(TAB).toMatch(/id=\{WORK_SECTION_ID\.lists\}/)
  })

  it('orders them band → Process → Ideas → Lists', () => {
    const band = TAB.indexOf('<AssetWorkPane')
    const proc = TAB.indexOf('id={WORK_SECTION_ID.workflow}')
    const ideas = TAB.indexOf('id={WORK_SECTION_ID.decisions}')
    const lists = TAB.indexOf('id={WORK_SECTION_ID.lists}')
    expect(band).toBeGreaterThan(-1)
    expect(band).toBeLessThan(proc)
    expect(proc).toBeLessThan(ideas)
    expect(ideas).toBeLessThan(lists)
  })

  it('keeps the Lists section content, rather than dropping the tab', () => {
    // The old Lists tab's grouping, intact.
    expect(TAB).toMatch(/lists-section-/)
    expect(TAB).toMatch(/listsByType/)
  })
})

describe('handoffs land where they used to', () => {
  it('scrolls to a Work section instead of switching, and clears the anchor', () => {
    expect(TAB).toMatch(/focusWorkSection\(workSectionId\(next\)\)/)
    expect(TAB).toMatch(/if \(!workAnchor \|\| activeMode !== 'work'\) return/)
    /*
     * Cleared INSIDE the animation frame. Clearing it in the effect body
     * re-renders at once, changing this effect's deps and running its
     * cleanup — which cancels the frame that was about to scroll.
     */
    const at = TAB.indexOf("if (!workAnchor || activeMode !== 'work') return")
    const body = TAB.slice(at, at + 1200)
    expect(body).toMatch(/setWorkAnchor\(null\)[\s\S]{0,60}\}\)[\s\S]{0,80}cancelAnimationFrame/)
  })

  it('carries a nonce, so the same destination twice still scrolls twice', () => {
    /*
     * A bare id made every second request dead: if a frame was cancelled the
     * id was never cleared, and setting state to the value it already holds
     * is a no-op, so the effect never re-ran. Measured in the browser as
     * scroll / no-scroll / scroll on three identical clicks.
     */
    expect(TAB).toMatch(/setWorkAnchor\(id \? \{ id, nonce: Date\.now\(\) \} : null\)/)
    expect(TAB).toMatch(/useState<\{ id: string; nonce: number \} \| null>\(null\)/)
  })

  it('scrolls the container that actually scrolls, not every ancestor', () => {
    // scrollIntoView adjusts every scrollable ancestor; under this page's
    // sticky header it overshot by ~600px and left the section off-screen.
    const at = TAB.indexOf("if (!workAnchor || activeMode !== 'work') return")
    const body = TAB.slice(at, at + 1200)
    expect(body).toMatch(/sc\.scrollBy\(\{ top: delta, behavior: 'smooth' \}\)/)
    expect(body).toMatch(/getBoundingClientRect\(\)\.top - sc\.getBoundingClientRect\(\)\.top/)
  })

  it('does not scroll merely because the reader entered Work', () => {
    // goToMode clears the anchor; only an explicit destination sets one.
    const at = TAB.indexOf('const goToMode')
    expect(TAB.slice(at, at + 300)).toMatch(/setActiveSubPage\(MODE_LANDING\[mode\]\)/)
    expect(TAB.slice(at, at + 300)).toMatch(/focusWorkSection\(null\)/)
  })

  it('still routes asset.focus to a destination', () => {
    expect(TAB).toMatch(/asset\.focus === 'decisions'\) setActiveSubPage\('decisions'\)/)
    expect(TAB).toMatch(/asset\.focus === 'research'\) setActiveSubPage\('research'\)/)
  })

  it('keeps the Lists deep-link, with its within-section scroll', () => {
    expect(TAB).toMatch(/setActiveSubPage\('lists'\)/)
    expect(TAB).toMatch(/setListsFocus\(focus\)/)
    expect(TAB).toMatch(/activeSubPage !== 'lists'\) return/)
  })

  it('carries the attention target into the Work section it names', () => {
    expect(TAB).toMatch(/setActiveSubPage\(t\.subPage\)\s*\n\s*focusWorkSection\(workSectionId\(t\.subPage\)\)/)
  })

  it('sends the Overview through goToSubPage, so its links can scroll', () => {
    expect(TAB).toMatch(/onOpenSubPage=\{goToSubPage\}/)
    expect(TAB).not.toMatch(/onOpenSubPage=\{setActiveSubPage\}/)
  })
})

describe('the Overview distinguishes Work from History', () => {
  it('sends the decision timeline to History, not to Work', () => {
    expect(SNAP).toMatch(/onOpenTimeline=\{\(\) => onOpenSubPage\('history'\)\}/)
    expect(SNAP).toMatch(/'history'/)
  })

  it('still sends the open decisions and ideas to Work', () => {
    expect(SNAP).toMatch(/onClick=\{\(\) => onOpenSubPage\('decisions'\)\}/)
  })
})

describe('the timeline is fetched for History only', () => {
  it('gates useAssetDecisionTimeline on the History mode', () => {
    // It was gated on the Decisions tab, which is now two modes. Leaving it
    // on Work would fetch the whole decision history to render ideas.
    // Anchored on the CALL, not the import — indexOf finds the import first.
    const at = TAB.indexOf('useAssetDecisionTimeline({')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 300)).toMatch(/enabled: activeMode === 'history'/)
  })
})
