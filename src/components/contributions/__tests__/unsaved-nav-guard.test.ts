import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * UX1c-2b — in-app unsaved-research protection, wiring pins.
 *
 * The guard's *logic* is covered behaviourally in
 * lib/contributions/__tests__/unsaved-edits-guard.test.ts. These pins prove the
 * three unmount-causing navigation surfaces are actually routed through it,
 * since AssetTab (~5k lines), ContributionSection and DashboardPage cannot be
 * mounted affordably. Each assertion targets a specific guarded call so it would
 * fail if a control were reverted to a raw, unguarded setter.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const CONTRIB = codeOf(readFileSync(resolve(SRC, 'components/contributions/ContributionSection.tsx'), 'utf8'))
const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))
const DASHBOARD = codeOf(readFileSync(resolve(SRC, 'pages/DashboardPage.tsx'), 'utf8'))
const PROMPT = codeOf(readFileSync(resolve(SRC, 'components/contributions/UnsavedEditsPrompt.tsx'), 'utf8'))

describe('UX1c-2b: the inline editor registers with the guard while mounted', () => {
  it('ContributionSection registers an editor, gated on inlineEditor', () => {
    expect(CONTRIB).toContain('registerUnsavedEditor')
    // Registration is opt-in: it bails when not the inline editor, so the other
    // (non-inline) callers never participate in the guard.
    expect(CONTRIB).toMatch(/if \(!inlineEditor\) return[\s\S]{0,120}registerUnsavedEditor/)
  })

  it('exposes live dirty state and the EXISTING draft-save handler (no new path)', () => {
    expect(CONTRIB).toMatch(/isDirty:\s*\(\)\s*=>\s*dirtyRef\.current/)
    expect(CONTRIB).toMatch(/saveDraft:\s*\(\)\s*=>\s*saveDraftRef\.current\(\)/)
    // The mirror points at the already-shipped handler, not a second save path.
    expect(CONTRIB).toContain('saveDraftRef.current = handleSaveDraft')
    expect(CONTRIB).toMatch(/dirtyRef\.current = inlineEditor && isDirty/)
  })
})

describe('UX1c-2b: in-tab navigation is routed through the guard', () => {
  it('sub-page and read-mode helpers call requestUnsavedNavigation', () => {
    expect(ASSET_TAB).toMatch(/const goToSubPage = useCallback[\s\S]{0,120}requestUnsavedNavigation\(\(\) => setActiveSubPage/)
    expect(ASSET_TAB).toMatch(/const goToThesisMode = useCallback[\s\S]{0,120}requestUnsavedNavigation\(\(\) => setThesisViewMode/)
  })

  it('perspective (Firm/personal) switch is guarded inside chooseResearchView', () => {
    expect(ASSET_TAB).toMatch(/chooseResearchView = useCallback[\s\S]{0,160}requestUnsavedNavigation/)
  })

  it('the sub-page nav bar buttons use the guarded helper, not raw setActiveSubPage', () => {
    for (const page of ['snapshot', 'research', 'workflow', 'decisions', 'lists']) {
      expect(ASSET_TAB, `nav button for ${page}`).toContain(`goToSubPage('${page}')`)
    }
    // The persistent context strip is visible while editing, so its deep-link is
    // guarded too. (UX2 P1 moved the strip into AssetWorkspaceHeader; AssetTab
    // still routes its navigation through the guarded helper.)
    expect(ASSET_TAB).toContain('onOpenSubPage={(sub) => goToSubPage(sub)}')
  })

  it('the four read-mode buttons use the guarded helper', () => {
    for (const mode of ['all', 'summary', 'history', 'references']) {
      expect(ASSET_TAB, `read-mode button for ${mode}`).toContain(`goToThesisMode('${mode}')`)
    }
  })
})

describe('UX1c-2b: main tab switch / close is routed through the guard', () => {
  it('wraps tab change, single close, and bulk close', () => {
    expect(DASHBOARD).toMatch(/const handleTabChange =[\s\S]{0,120}requestUnsavedNavigation\(\(\) => applyTabChange/)
    expect(DASHBOARD).toMatch(/const handleTabClose =[\s\S]{0,120}requestUnsavedNavigation\(\(\) => applyTabClose/)
    expect(DASHBOARD).toMatch(/const handleCloseTabs =[\s\S]{0,120}requestUnsavedNavigation\(\(\) => applyCloseTabs/)
  })

  it('the original handler bodies are preserved under apply* names', () => {
    expect(DASHBOARD).toContain('const applyTabChange = (tabId: string) =>')
    expect(DASHBOARD).toContain('const applyTabClose = (tabId: string) =>')
    expect(DASHBOARD).toContain('const applyCloseTabs = (tabIds: string[]) =>')
  })

  it('mounts the single guard prompt', () => {
    expect(DASHBOARD).toContain('<UnsavedEditsPrompt />')
  })
})

describe('UX1c-2b: the prompt offers exactly Stay / Discard / Save draft', () => {
  it('resolves the three outcomes and keeps the dialog open on save failure', () => {
    expect(PROMPT).toContain("resolveUnsavedNavigation('stay')")
    expect(PROMPT).toContain("resolveUnsavedNavigation('discard')")
    expect(PROMPT).toContain("resolveUnsavedNavigation('save')")
    // Save failure is caught and surfaced; the guard retains the gesture.
    expect(PROMPT).toMatch(/catch[\s\S]{0,160}setError/)
  })
})
