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
    /*
     * One now: the shell, which is the sidebar and the working surface.
     * The orientation band, the duplicate Open Items list and the stranded
     * themes/portfolios/projects cards are all gone — the sidebar holds the
     * relationships and the surface shows the selected work.
     */
    expect(work).toBeGreaterThanOrEqual(1)
  })

  it('anchors the Work sections that still exist', () => {
    /*
     * `decisions` no longer names a section: the Open Items list it
     * anchored is gone, and the ideas it held are navigator rows whose
     * surface is selected rather than scrolled to. `lists` is the shell and
     * `workflow` is the process surface inside it.
     */
    expect(TAB).toMatch(/id=\{WORK_SECTION_ID\.workflow\}/)
    expect(TAB).toMatch(/id=\{WORK_SECTION_ID\.lists\}/)
    expect(TAB).not.toMatch(/id=\{WORK_SECTION_ID\.decisions\}/)
  })

  it('does not leave a work anchor pending when its section never mounts', () => {
    /*
     * `WORK_SECTION_ID.decisions` is null now, but this is about the
     * mechanism rather than that one value.
     *
     * The anchor effect made a SINGLE attempt and cleared the anchor only on
     * success. Its deps are a stable state object and a string, so a failed
     * attempt never ran again: a target that had not mounted yet was missed,
     * and the stale anchor re-fired on every return to Work and scrolled
     * nowhere. The Process surface waits on queries, so "not mounted yet" is
     * the normal case for a deep link.
     *
     * Two rules: it retries across frames, and it stops — the anchor is
     * cleared whether or not the scroll ever landed.
     */
    const at = TAB.indexOf('const DEADLINE = Date.now() + 1000')
    expect(at).toBeGreaterThan(-1)
    const body = TAB.slice(at, at + 400)
    expect(body).toMatch(/requestAnimationFrame\(attempt\)/)
    expect(body).toMatch(/scrollToSection\(workAnchor\.id\) \|\| Date\.now\(\) > DEADLINE/)
    expect(body).toMatch(/setWorkAnchor\(null\)/)
  })

  it('nests the process inside the one Work shell', () => {
    /*
     * This asserted shell → sidebar → navigator → surface → process. The
     * sidebar and the navigator are gone: the Work overview is the only
     * navigator and the surface takes the full width. What the test was
     * really protecting — that the process is INSIDE the shell as the
     * active surface rather than a sibling section below it — is what
     * remains.
     */
    const shell = TAB.indexOf('id={WORK_SECTION_ID.lists}')
    const surface = TAB.indexOf('data-testid="work-surface"')
    const proc = TAB.indexOf('id={WORK_SECTION_ID.workflow}')
    expect(shell).toBeGreaterThan(-1)
    expect(shell).toBeLessThan(surface)
    expect(surface).toBeLessThan(proc)
    expect(TAB).not.toMatch(/<AssetWorkSidebar|<WorkNavigator/)
  })

  it('keeps every membership surface the Lists tab had, in what is RENDERED', () => {
    /*
     * Rewritten because it was reading a file the product does not run.
     *
     * This asserted `id="lists-section-{lists,themes,portfolios,projects}
     * Content"` inside AssetWorkSidebar.tsx, reasoning that the four sections
     * "carry the same ids, so the header's context chips still deep-link to
     * them". The sidebar stopped being rendered when Work became one
     * navigator, and those ids exist in NO rendered file — so the chips had
     * been scrolling nowhere while this test went on passing, because the
     * dead file still contained the string it asked for.
     *
     * The surfaces themselves did survive, into AssetTab. That is what is
     * checked now.
     */
    for (const control of [
      '<AddToListButton', '<AddToThemeButton', '<AddToProjectButton', '<RelatedProjects',
    ]) {
      expect(TAB, `membership control ${control}`).toContain(control)
    }
    // The escape hatches out to the full collections.
    for (const route of ['themes-list', 'portfolios-list']) {
      expect(TAB, `escape link ${route}`).toContain(route)
    }
    // The grouping that collapsed every list onto an absent 'list' key is gone.
    expect(TAB).not.toMatch(/listsByType/)
  })

  it('the header context chips land on a target that exists', () => {
    /*
     * `scrollToSection` returns false when the id is absent, and the effect
     * cleared `listsFocus` only on success — so a dead id both scrolled
     * nowhere AND stayed set, to fire again on the next return to Work.
     *
     * Two rules: there is a fallback to the Lists section, and the focus is
     * consumed whether or not the specific anchor resolved.
     */
    const at = TAB.indexOf('lists-section-${listsFocus.id}')
    expect(at).toBeGreaterThan(-1)
    const body = TAB.slice(at, at + 400)
    expect(body).toMatch(/scrollToSection\(WORK_SECTION_ID\.lists\)/)
    expect(body).toMatch(/setListsFocus\(null\)/)
    // And not gated on the scroll having succeeded, which was the bug.
    expect(body).not.toMatch(/if \(scrollToSection\([^)]*\)\)\s*setListsFocus\(null\)/)
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
     *
     * Stated as "not in the effect body" rather than by matching the shape
     * of a single frame, which is what this assertion used to do: it read
     * `setWorkAnchor(null) … }) … cancelAnimationFrame` and so pinned one
     * frame rather than the rule, and broke when the one attempt became a
     * bounded retry.
     */
    const at = TAB.indexOf("if (!workAnchor || activeMode !== 'work') return")
    const body = TAB.slice(at, at + 2400)
    const frameStarts = body.indexOf('const attempt = () => {')
    expect(frameStarts).toBeGreaterThan(-1)
    expect(body.slice(0, frameStarts)).not.toContain('setWorkAnchor(')
    expect(body.slice(frameStarts)).toContain('setWorkAnchor(null)')
    expect(body).toContain('cancelAnimationFrame(raf)')
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

  it('scrolls through the one helper, which scrolls the right container', () => {
    // scrollIntoView adjusts every scrollable ancestor; under this page's
    // sticky header it overshot by ~600px and left the section off-screen.
    // The measurement lives in `scroll-to-section` now, because the Lists
    // deep-link needed the identical fix and had the identical bug.
    const at = TAB.indexOf("if (!workAnchor || activeMode !== 'work') return")
    expect(TAB.slice(at, at + 1200)).toMatch(/scrollToSection\(workAnchor\.id\)/)
    /*
     * Every scroll INTO a Work section goes through the helper. The three
     * remaining `scrollIntoView` calls in the file are Research anchors with
     * their own retry loops and are deliberately untouched here; a fourth
     * appearing inside Work would be the overshoot bug returning.
     */
    /* The Open Items scroll is gone with the section: an attention signal
       about open items now selects the work instead of scrolling to a list
       of it. */
    expect(TAB).not.toMatch(/decisions-open-items/)
    expect((TAB.match(/scrollIntoView/g) ?? []).length).toBe(2)
  })

  it('does not scroll merely because the reader entered Work', () => {
    // goToMode clears the anchor; only an explicit destination sets one.
    const at = TAB.indexOf('const goToMode')
    expect(TAB.slice(at, at + 300)).toMatch(/setActiveSubPage\(MODE_LANDING\[mode\]\)/)
    expect(TAB.slice(at, at + 300)).toMatch(/focusWorkSection\(null\)/)
  })

  it('still routes asset.focus to a destination', () => {
    /* The mapping became a table when the arrival effect learned to consume a
       focus once per request rather than on every mount. Same two routes. */
    expect(TAB).toMatch(/focus === 'decisions' \? 'decisions'/)
    expect(TAB).toMatch(/focus === 'research' \? 'research'/)
    expect(TAB).toMatch(/setActiveSubPage\(target\)/)
  })

  it('keeps the Lists deep-link, with its within-section scroll', () => {
    expect(TAB).toMatch(/setActiveSubPage\('lists'\)/)
    expect(TAB).toMatch(/focusListsSection\(focus\)/)
    // Gated on the MODE, not on one sub-page: every Work destination renders
    // all of Work's sections, so 'decisions' must reach a membership card too.
    expect(TAB).toMatch(/if \(!listsFocus \|\| activeMode !== 'work'\) return/)
  })

  it('gives the lists deep-link the same nonce and in-frame clear as the Work anchor', () => {
    /*
     * This effect had BOTH defects the Work anchor had, and they were found
     * only after the first was fixed:
     *
     *  1. `setListsFocus(null)` ran in the effect body, re-rendering at once,
     *     changing the deps and running the cleanup — which cancelled the
     *     frame that was about to scroll.
     *  2. With that repaired, a bare string id made every SECOND click on the
     *     same chip a no-op, because React skips a write that changes nothing.
     */
    expect(TAB).toMatch(/setListsFocus\(id \? \{ id, nonce: Date\.now\(\) \} : null\)/)
    const at = TAB.indexOf("if (!listsFocus || activeMode !== 'work') return")
    expect(at).toBeGreaterThan(-1)
    const body = TAB.slice(at, at + 700)
    /*
     * Cleared inside the frame — but no longer ONLY when the target was
     * found, which was defect 3.
     *
     * This required `if (scrollToSection(...)) setListsFocus(null)`. That
     * reads as caution ("don't consume a focus we failed to honour") and was
     * the opposite: when the anchor did not exist, the chip scrolled nowhere
     * AND the focus stayed set, so it fired again on the next return to Work.
     * It also meant the test passed while every one of these chips was inert,
     * because it was checking the shape of the call rather than whether the
     * id it names is in the DOM.
     *
     * The id-exists rule is asserted separately above; here the rule is that
     * the focus is consumed unconditionally, still inside the frame.
     */
    expect(body).toMatch(/setListsFocus\(null\)[\s\S]{0,60}\}\)[\s\S]{0,80}cancelAnimationFrame/)
    expect(body).not.toMatch(/if \(scrollToSection\([^)]*\)\)\s*setListsFocus\(null\)/)
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
