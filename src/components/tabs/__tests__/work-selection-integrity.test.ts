/**
 * The sidebar selection, the Process surface and the mutation target agree.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * Selecting a Process in the Work sidebar called `setWorkItemKey` and nothing
 * else. The Process surface — its header, stages, requirements and every
 * action taken on them — reads `effectiveWorkflowId`, which only the Process
 * dropdown moved. So a reader could select the Apr 3 run, watch it highlight,
 * and complete requirements belonging to Apr 10.
 *
 * For an investment workflow that is the one unacceptable failure: believing
 * you are working on one Process while editing another.
 *
 * ── Why this suite is asserted on source ──────────────────────────────────
 *
 * The rule lives in the wiring of a 4,900-line component that cannot be stood
 * up here — the same reason `asset-snapshot-landing` gives. What CAN be
 * pinned exactly is that one function performs the switch, that it moves both
 * halves, and that no other path moves only one of them. Comments are
 * stripped first: a rule described in prose is not a rule, and this fix's own
 * notes quote the broken code.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
const code = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const TAB = code(src('components/tabs/AssetTab.tsx'))

/** The canonical switch, from its signature to its closing brace. */
const SWITCH = TAB.match(
  /const handleWorkflowChange = async \(workflowId: string\) => \{[\s\S]*?\n {2}\}/,
)?.[0] ?? ''

/** The sidebar's selection handler. */
const ON_SELECT = TAB.match(
  /onSelect=\{\(item: WorkItem\) => \{[\s\S]*?\n {16}\}\}/,
)?.[0] ?? ''

describe('one function performs a Process switch', () => {
  it('the switch exists', () => {
    expect(SWITCH, 'handleWorkflowChange was renamed or removed').not.toBe('')
  })

  it('moves the surface', () => {
    // The optimistic write is what makes the workspace show the new run.
    expect(SWITCH).toMatch(/setQueryData\(\['asset-effective-workflow', effectiveAsset\.id\], workflowId\)/)
  })

  it('moves the sidebar selection in the SAME call', () => {
    // This is the half that was missing. Without it the dropdown moves the
    // surface and leaves the sidebar pointing at the previous run.
    expect(SWITCH).toMatch(/setWorkItemKey\(workItemKeyFor\.process\(workflowId\)\)/)
  })

  it('drops the previous run\'s stage and requirement', () => {
    // A requirement id belongs to one run's checklist. Carried across a
    // switch it aims completion and assignment at an item the displayed
    // process does not contain.
    expect(SWITCH).toMatch(/setViewingStageId\(null\)/)
    expect(SWITCH).toMatch(/setViewingRequirementId\(null\)/)
  })
})

describe('the sidebar routes a Process through that one function', () => {
  it('the handler exists', () => {
    expect(ON_SELECT, 'the WorkNavigator onSelect was renamed or removed').not.toBe('')
  })

  it('a process selection calls the switch, by id', () => {
    expect(ON_SELECT).toMatch(/item\.kind === 'process'/)
    expect(ON_SELECT).toMatch(/handleWorkflowChange\(item\.id\)/)
  })

  it('does not set the selection key directly for a process', () => {
    /*
     * The defect, stated as a prohibition. A bare `setWorkItemKey(item.key)`
     * reached by a process is exactly what moved the highlight without the
     * surface. Ideas still take that path, so the assertion is that the
     * process branch RETURNS before it.
     */
    const processBranch = ON_SELECT.match(/if \(item\.kind === 'process'\)[\s\S]*?\}/)?.[0] ?? ''
    expect(processBranch).toMatch(/return/)
    expect(processBranch).not.toMatch(/setWorkItemKey/)
  })

  it('still lets an Idea select without touching the workflow', () => {
    expect(ON_SELECT).toMatch(/setWorkItemKey\(item\.key\)/)
  })

  it('still sends a conversation to the pane instead of the surface', () => {
    expect(ON_SELECT).toMatch(/item\.kind === 'conversation'/)
    expect(ON_SELECT).toMatch(/askAI\(/)
  })
})

describe('the highlighted row is the displayed Process', () => {
  it('keys the highlight off effectiveWorkflowId, not off a fallback', () => {
    /*
     * `resolveSelection` answers an unresolvable key with the FIRST
     * in-progress item. That is right for work that was deleted and wrong
     * here: the dropdown can switch to a process the sidebar does not list
     * (not started, or complete), and the fallback would light up some other
     * run beside a surface showing this one.
     */
    expect(TAB).toMatch(
      /selectedWorkItem\?\.kind === 'process'[\s\S]{0,200}workItemKeyFor\.process\(effectiveWorkflowId\)/,
    )
  })
})

describe('per-asset state cannot leak into another asset', () => {
  const PAGE = code(src('pages/DashboardPage.tsx'))

  it('keys the Asset page by asset, so switching assets remounts it', () => {
    /*
     * Unkeyed, React keeps one AssetTab and swaps the `asset` prop. Every
     * per-asset value the component holds then survives into the next asset,
     * and the save effect — which lists `asset.id` as a dependency and builds
     * its record from current STATE — writes the PREVIOUS asset's state under
     * the NEW asset's id on the render where the prop has changed and the
     * state has not.
     *
     * Observed: open AMZN, switch it to Work, open TSLA, come back. AMZN's
     * saved record held TSLA's sub-page and TSLA's consumed focus id.
     */
    expect(PAGE).toMatch(/<AssetTab\s+key=\{activeTab\.id\}/)
  })

  it('still passes the tab data and the navigator', () => {
    expect(PAGE).toMatch(/<AssetTab[\s\S]{0,120}asset=\{activeTab\.data\}/)
    expect(PAGE).toMatch(/<AssetTab[\s\S]{0,160}onNavigate=\{handleSearchResult\}/)
  })

  it('initialises every per-asset value from that asset\'s own saved record', () => {
    // The initialisers were always right; they just never ran a second time.
    expect(TAB).toMatch(/useState<AssetSubPage>\(\(\) => \{[\s\S]{0,200}loadTabState\(asset\.id\)/)
    expect(TAB).toMatch(/consumedFocusIntent[\s\S]{0,200}loadTabState\(asset\.id\)/)
  })
})

describe('arrival focus is consumed, not replayed', () => {
  const EFFECT = TAB.match(
    /const focus = asset\.focus[\s\S]{0,1600}?\}, \[asset\.focus, asset\.focusRequestId, asset\.id\]\)/,
  )?.[0] ?? ''

  it('the effect exists', () => {
    expect(EFFECT).not.toBe('')
  })

  it('decides from the shared rule rather than an inline comparison', () => {
    expect(EFFECT).toMatch(/focusIntentKey\(focus, asset\.focusRequestId\)/)
    expect(EFFECT).toMatch(/shouldApplyFocus\(intent, saved\?\.consumedFocusIntent\)/)
  })

  it('reads the consumed record from durable per-asset storage, not a ref', () => {
    // The component is the thing being unmounted; a ref cannot outlive it.
    expect(EFFECT).toMatch(/TabStateManager\.loadTabState\(asset\.id\)/)
    expect(EFFECT).not.toMatch(/useRef/)
  })

  it('persists the consumption immediately, not only via the batched save', () => {
    // A reader can leave the tab in the same breath as arriving.
    expect(EFFECT).toMatch(/TabStateManager\.saveTabState\(asset\.id/)
    expect(EFFECT).toMatch(/consumedFocusIntent: intent/)
  })

  it('keeps carrying the consumed id on every later save', () => {
    /*
     * `saveTabState` REPLACES a tab's record. A key left out of `stateToSave`
     * is dropped by the next save, and the focus becomes replayable again --
     * a defect that would reappear only after some unrelated state changed.
     */
    expect(TAB).toMatch(/stateToSave = \{[\s\S]{0,600}consumedFocusIntent,/)
  })
})
