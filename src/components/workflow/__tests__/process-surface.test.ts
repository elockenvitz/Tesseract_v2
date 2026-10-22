/**
 * The Process surface's shape, pinned against source.
 *
 * InvestmentTimeline needs a live Supabase client, auth and organization
 * context to mount, so what it no longer CONTAINS is asserted here. Every
 * assertion below is a duplicate that was measured on the running page:
 * one progress number stated four times, and the next action 783px below the
 * checklist it acts on.
 *
 * A removed duplicate is easy to reintroduce — it always looks like adding a
 * helpful label — so each one is named with where its surviving copy lives.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const TL = strip(read('src/components/ui/InvestmentTimeline.tsx'))
const BAR = strip(read('src/components/workflow/StageActionBar.tsx'))

describe('the next action sits with the work', () => {
  it('renders the action bar above the checklist items', () => {
    const bar = TL.indexOf('<StageActionBar')
    const items = TL.indexOf('items.map(item =>')
    expect(bar).toBeGreaterThan(-1)
    expect(items).toBeGreaterThan(-1)
    expect(bar).toBeLessThan(items)
  })

  it('hands it the existing advance handler rather than a new one', () => {
    // There is one advance path. A second would be a second place that
    // writes `asset_workflow_progress`.
    expect(TL).toMatch(/onAdvance=\{handleAdvanceStage\}/)
    expect((TL.match(/const handleAdvanceStage/g) ?? []).length).toBe(1)
    expect(BAR).not.toMatch(/supabase/)
    expect(BAR).not.toMatch(/asset_workflow_progress/)
  })

  it('feeds it the counts the rest of the page already derives', () => {
    // `stageChecklists` is the one checklist derivation on this page. The
    // bar must not grow a second one.
    expect(TL).toMatch(/done=\{doneCount\}/)
    expect(TL).toMatch(/total=\{items\.length\}/)
    expect(BAR).not.toMatch(/useQuery/)
    expect(BAR).not.toMatch(/filter\(.*completed/)
  })

  it('tells it which stage is being viewed and which is current', () => {
    // The old footer button was governed by the workflow's index while the
    // card rendered the clicked stage, so from stage 3 it advanced stage 1.
    expect(TL).toMatch(/viewingStageId=\{showStageDetails\}/)
    expect(TL).toMatch(/currentStageId=\{effectiveCurrentStage\}/)
  })
})

describe('the footer gave up its copies', () => {
  it('no longer prints the stage position', () => {
    // The rail directly above numbers every stage and highlights the current
    // one.
    expect(TL).not.toMatch(/Stage \{currentIndex \+ 1\} of \{timelineStages\.length\}/)
  })

  it('no longer prints a second item count', () => {
    // The rail chip, the action bar and the Work band all carry it.
    expect(TL).not.toMatch(/items completed/)
  })

  it('no longer carries its own advance button', () => {
    expect(TL).not.toMatch(/Advance Stage →/)
    expect(TL).not.toMatch(/Complete Process ✓/)
  })

  it('keeps the step backwards, which has nowhere better to be', () => {
    expect(TL).toMatch(/onClick=\{handleRegressStage\}/)
    expect(TL).toMatch(/← Move to \{timelineStages\[currentIndex - 1\]\?\.label\}/)
  })

  it('offers the step backwards only on the stage being worked', () => {
    // Same rule as the advance control. Both were governed by the
    // WORKFLOW's index while the card renders the CLICKED stage, so
    // browsing stage 3 offered to move a workflow sitting on stage 2.
    expect(TL).toMatch(/canRegress =[\s\S]{0,200}showStageDetails === effectiveCurrentStage/)
  })

  it('renders no empty bordered strip when neither control applies', () => {
    expect(TL).toMatch(/if \(!canRegress && !isFinished\) return null/)
  })

  it('keeps the completed message, which a finished process still needs', () => {
    expect(TL).toMatch(/Process completed!/)
  })
})

describe('the stage rail states its progress once', () => {
  it('keeps the count', () => {
    expect(TL).toMatch(/\{completedTasks\}\/\{totalTasks\} tasks/)
  })

  it('drops the percentage beside it', () => {
    // The bar above IS the percentage and "2/5 tasks" is the same fact
    // again — three renderings of one number on one chip.
    expect(TL).not.toMatch(/\{Math\.round\(progressPercent\)\}%/)
    // The bar itself stays.
    expect(TL).toMatch(/width: `\$\{progressPercent\}%`/)
  })
})

describe('advancing cannot be fired twice', () => {
  it('guards the handler and releases it on every path', () => {
    expect(TL).toMatch(/if \(isAdvancing\) return/)
    expect(TL).toMatch(/setIsAdvancing\(true\)/)
    // One release in `finally`, one on the nothing-to-advance-to branch.
    expect((TL.match(/setIsAdvancing\(false\)/g) ?? []).length).toBe(2)
    expect(TL).toMatch(/\} finally \{\s*setIsAdvancing\(false\)/)
  })

  it('passes the in-flight state to the control', () => {
    expect(TL).toMatch(/isAdvancing=\{isAdvancing\}/)
  })
})

describe('the workflow state machine is untouched', () => {
  it('still writes progress through the one upsert path', () => {
    expect(TL).toMatch(/from\('asset_workflow_progress'\)/)
    expect(TL).toMatch(/onConflict: 'asset_id,workflow_id'/)
  })

  it('still marks the workflow complete only at the completed stage', () => {
    expect(TL).toMatch(/if \(nextStage\.id === 'completed'\)/)
    expect(TL).toMatch(/is_completed: true/)
  })

  it('still stamps completion times for items done before the advance', () => {
    expect(TL).toMatch(/isItemDone\(item\) && !item\.completedAt/)
  })

  it('does not auto-complete requirements on the way out', () => {
    // Advancing timestamps items ALREADY done. It must never mark an open
    // requirement done to make the stage look finished.
    const at = TL.indexOf('const handleAdvanceStage')
    const body = TL.slice(at, at + 1400)
    expect(body).not.toMatch(/completed: true/)
    expect(body).toMatch(/completed: item\.completed/)
  })
})
