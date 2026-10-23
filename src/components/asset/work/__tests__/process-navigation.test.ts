/**
 * The Work tab's navigation and completion hierarchy, pinned against source.
 *
 * `AssetTab` and `InvestmentTimeline` need Supabase, auth and organization
 * context to mount, so the structural rules are asserted here. Each one
 * below was broken by the surface this change replaces.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const TAB = strip(read('src/components/tabs/AssetTab.tsx'))
const SWITCHER = strip(read('src/components/asset/work/ProcessSwitcher.tsx'))
const BAR = strip(read('src/components/workflow/StageActionBar.tsx'))
const TL = strip(read('src/components/ui/InvestmentTimeline.tsx'))

describe('process switching is one layer, not three', () => {
  it('hangs the switcher off the process title', () => {
    /* The title states the answer; opening it offers the alternatives. */
    expect(SWITCHER).toMatch(/data-testid="process-switcher-trigger"/)
    expect(SWITCHER).toMatch(/data-testid="process-identity"/)
  })

  it('no longer nests a selector inside the actions menu', () => {
    /*
     * The flow this replaces: "⋯" → a dropdown TRIGGER inside the menu →
     * a 384px panel. The actions menu must not carry a `header` slot with
     * another selector in it again.
     */
    expect(TAB).not.toMatch(/AssetWorkflowSelectorEnhanced/)
    expect(TAB).not.toMatch(/Switch or add a process/)
  })

  it('states the open run instead of offering it as a choice', () => {
    expect(SWITCHER).toMatch(/Open now/)
    /* The current entry renders as a div, never as a selectable Row. */
    const at = SWITCHER.indexOf('Open now')
    expect(SWITCHER.slice(Math.max(0, at - 700), at)).not.toMatch(/<Row/)
  })

  it('keeps the panel on screen instead of a fixed oversized one', () => {
    /* `w-96` with `max-h-[500px]` regardless of available space. */
    expect(SWITCHER).not.toMatch(/w-96/)
    expect(SWITCHER).toMatch(/max-w-\[calc\(100vw-32px\)\]/)
    /* Anchor flips and height is capped against the measured viewport. */
    expect(SWITCHER).toMatch(/window\.innerWidth/)
    expect(SWITCHER).toMatch(/window\.innerHeight/)
    expect(SWITCHER).toMatch(/place\.right \? 'right-0' : 'left-0'/)
  })

  it('carries documents and activity with the process they belong to', () => {
    expect(SWITCHER).toMatch(/data-testid="process-switcher-documents"/)
    expect(SWITCHER).toMatch(/data-testid="process-switcher-activity"/)
  })

  it('closes on Escape and on an outside click', () => {
    expect(SWITCHER).toMatch(/e\.key === 'Escape'/)
    expect(SWITCHER).toMatch(/!root\.current\.contains/)
  })
})

describe('the three completions are told apart', () => {
  it('has no generic "Mark Complete" left in the Work header', () => {
    /*
     * A solid blue primary button beside the process title that finished
     * the whole PROCESS, while "Mark complete" on a requirement and
     * "Advance to <stage>" meant two other things.
     */
    expect(TAB).not.toMatch(/Mark Complete/)
    expect(TAB).not.toMatch(/<WorkflowActionButton/)
  })

  it('names the process-level action for what it ends', () => {
    expect(TAB).toMatch(/label: 'Complete process'/)
    /* Same mutation, same handler — only the label and placement moved. */
    const at = TAB.indexOf("label: 'Complete process'")
    expect(TAB.slice(at, at + 400)).toMatch(/markWorkflowCompleteMutation\.mutate/)
  })

  it('still offers reopening a finished process', () => {
    expect(TAB).toMatch(/label: 'Reopen process'/)
    const at = TAB.indexOf("label: 'Reopen process'")
    expect(TAB.slice(at, at + 400)).toMatch(/restartWorkflowMutation\.mutate/)
  })

  it('keeps the removal action, which the old selector owned', () => {
    expect(TAB).toMatch(/removeFromWorkflowMutation\.mutate/)
  })
})

describe('stage advancement sits at the stage boundary', () => {
  it('is suppressed while a requirement is open', () => {
    /*
     * The gate used to be inside the bar (`canAdvance`). With the
     * duplicate progress gone too, the bar had nothing left to show over
     * a requirement but two stage controls, so the whole row is now
     * conditional and those controls ride the requirement's own header.
     */
    expect(BAR).toMatch(/canAdvance = true/)
    expect(BAR).toMatch(/state\.kind !== 'hidden' && canAdvance/)
    expect(TL).toMatch(/\{!selectedRequirement && \(\s*<StageActionBar/)
    /* Same components, not a second copy. */
    expect(TL).toMatch(/trailing=\{stageOwnershipControls\}/)
    expect(TL).toMatch(/stageControls=\{stageOwnershipControls\}/)
  })

  it('states the stage progress once, where it is a summary', () => {
    /*
     * This asserted the opposite — that progress stayed visible while a
     * requirement was open. Measured, that meant the same number four
     * times on one screen: the rail chip's `0/5` directly above, this
     * bar's "0 of 5 done · 5 open", the requirement header's
     * "REQUIREMENT 3 OF 5 · 0 DONE", and the Work overview's bar.
     *
     * The rail chip is the one that shows every stage at once, so it is
     * the one that stays beside a requirement. This bar keeps the count
     * on the stage overview, where there is no requirement to read it
     * against and it is the screen's subject.
     */
    expect(BAR).toMatch(/data-testid="stage-progress"/)
    expect(BAR).toMatch(/\{canAdvance \? \(/)
    /* And the header no longer repeats it. */
    const WS = strip(read('src/components/asset/work/RequirementWorkspace.tsx'))
    expect(WS).not.toMatch(/Requirement \{index\} of \{total\}/)
  })

  it('never calls the advance action "complete"', () => {
    expect(BAR).not.toMatch(/>\s*Complete\s*</)
  })
})

describe('the context margin can be put away', () => {
  const WS = strip(read('src/components/asset/work/RequirementWorkspace.tsx'))

  it('collapses and can be brought back', () => {
    expect(WS).toMatch(/data-testid="requirement-context-hide"/)
    expect(WS).toMatch(/data-testid="requirement-context-show"/)
  })

  it('gives the work the full measure once the margin is away', () => {
    expect(WS).toMatch(/contextOpen \? 'xl:grid-cols-\[minmax\(0,1fr\)_320px\]' : 'xl:grid-cols-1'/)
  })

  it('treats the preference as this viewer\'s, and survives it being unreadable', () => {
    /* A private window or blocked site data makes the accessor throw; the
       margin must open rather than the surface failing to render. */
    expect(WS).toMatch(/localStorage/)
    expect(WS).toMatch(/catch \{ return true \}/)
  })
})
