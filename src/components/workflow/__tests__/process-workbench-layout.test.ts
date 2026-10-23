/**
 * The Process workbench states each fact once, and reaches the work sooner.
 *
 * ── What was measured, in the running app at 1920x889 ─────────────────────
 *
 *   before   first requirement at y=579 — 65% of the viewport spent first
 *   after    first requirement at y=535 — 60%
 *
 * and the duplication that paid for it:
 *
 *   stage title     "Momentum Check" in the rail, then "Momentum Check
 *                   Stage" as an 18px heading directly beneath it
 *   readiness       the rail's 0/4 bar, "0 of 4 done · 4 open" in the action
 *                   bar, and "0 of 4 requirements complete." in the empty
 *                   detail panel — three statements of one number
 *   orphan rows     a 24px row holding only the priority chip, above the
 *                   rail; a 296x24 row holding only the sidebar toggle
 *
 * ── What is NOT changed, and is asserted here because of it ───────────────
 *
 * Advancement logic, official-vs-viewed stage, and the readiness sentence
 * all still come from `stage-advance.ts` through `StageActionBar`, whose own
 * suite covers them. These cases pin that this slice moved presentation
 * only: the action bar is still rendered with the same inputs, ownership and
 * deadline are still on screen rather than behind a hover, and the empty
 * panel still refuses to auto-select.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
/** A rule described in prose is not a rule, and this slice's notes quote the
    markup they replaced. */
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

const TIMELINE = code(src('components/ui/InvestmentTimeline.tsx'))
const TAB = code(src('components/tabs/AssetTab.tsx'))

describe('the stage is named once', () => {
  it('no longer renders a "<Stage> Stage" heading under the rail', () => {
    /* The rail directly above already names, numbers and colours the stage.
       A heading repeating it is the duplication this slice removes. */
    expect(TIMELINE).not.toMatch(/\?\.label\}\s*Stage\s*</)
    expect(TIMELINE).not.toMatch(/label\} Stage/)
  })

  it('keeps the stage question, which the rail does not carry', () => {
    // The description is the one thing the rail cannot say.
    expect(TIMELINE).toMatch(/timelineStages\.find\(s => s\.id === showStageDetails\)\?\.description/)
  })

  it('drops the 40px status disc, whose job the rail already does', () => {
    expect(TIMELINE).not.toMatch(/w-10 h-10 rounded-full \$\{getStageColor/)
  })
})

describe('readiness is stated once in the stage block', () => {
  it('still renders the action bar, with the same inputs', () => {
    /* The sentence and the advance control are `StageActionBar`'s, and its
       own suite owns their behaviour. This only pins that it is still here
       and still fed the viewed stage against the official one. */
    expect(TIMELINE).toMatch(/<StageActionBar/)
    expect(TIMELINE).toMatch(/viewingStageId=\{showStageDetails\}/)
    expect(TIMELINE).toMatch(/currentStageId=\{effectiveCurrentStage\}/)
  })

  it('no longer restates the count in the empty detail panel', () => {
    // "{doneCount} of {items.length} requirements complete." was the third
    // statement of the same number, and the least useful of the three.
    expect(TIMELINE).not.toMatch(/\{doneCount\} of \{items\.length\} requirements complete/)
  })
})

describe('the unselected panel helps instead of counting', () => {
  /*
   * This used to pin the dashed "Pick a requirement" box and its
   * "Start with …" button. Both are gone, replaced by `StageOverview`,
   * which answers the same question better: it states the stage's
   * objective, derives which requirement to resume AND why, and shows what
   * has already been written. The assertions move to that surface; the
   * recommendation's own ordering is covered exhaustively in
   * `lib/asset-work/__tests__/stage-overview.test.ts`.
   */
  it('renders the stage overview rather than an empty prompt', () => {
    expect(TIMELINE).toMatch(/<StageOverview/)
    expect(TIMELINE).not.toMatch(/Pick a requirement to record what you found/)
  })

  it('feeds it the stage, the requirements and the findings already written', () => {
    expect(TIMELINE).toMatch(/stage=\{\{ label: stage\?\.label, description: stage\?\.description \}\}/)
    expect(TIMELINE).toMatch(/facts=\{facts\}/)
    expect(TIMELINE).toMatch(/findings=\{findings\}/)
  })

  it('opens a requirement through the existing selection handler', () => {
    expect(TIMELINE).toMatch(/onOpenRequirement=\{\(id\) => setSelectedRequirement\(id\)\}/)
  })

  it('still does not auto-select — opening one is the reader\'s move', () => {
    /*
     * Selecting on render would imply the reader had started a requirement,
     * and the panel is where notes and drafts live. The button is a prompt;
     * an effect would be a claim. Pinned because "just auto-select the first
     * one" is the obvious next suggestion and it changes draft semantics.
     */
    expect(TIMELINE).not.toMatch(/useEffect\([^)]*setSelectedRequirement\(items\[0\]/)
    expect(TIMELINE).not.toMatch(/setSelectedRequirement\(next\.id\)\s*\}\s*,\s*\[/)
  })
})

describe('ownership and deadline stay visible', () => {
  it('renders both, not behind a hover', () => {
    expect(TIMELINE).toMatch(/<AssignmentSelector/)
    expect(TIMELINE).toMatch(/<StageDeadlineManager/)
  })

  it('keeps them scoped to the viewed stage', () => {
    expect(TIMELINE).toMatch(/stageId=\{showStageDetails\}/)
  })
})

describe('no control owns a row by itself', () => {
  it('the priority chip shares the rail row', () => {
    /* It is a PROCESS-level control, so it stays on the rail card rather
       than moving into the stage block — but beside the rail, not above it. */
    expect(TIMELINE).toMatch(/data-testid="process-rail-row"/)
    expect(TIMELINE).toMatch(/hidden md:block flex-1 min-w-0/)
  })

  it('the sidebar toggle rides the navigator header', () => {
    expect(TAB).toMatch(/headerAction=\{<WorkSidebarToggle direction="collapse"/)
    expect(code(src('components/asset/work/AssetWorkSidebar.tsx'))).not.toMatch(/col-span-full -mb-1/)
  })

  it('the expand control rides the Process identity row when collapsed', () => {
    expect(TAB).toMatch(/\{workSidebarCollapsed && \(\s*<WorkSidebarToggle direction="expand"/)
  })
})

describe('the workbench is one block, not stacked sections', () => {
  it('spaces the Process identity and its rail as one unit', () => {
    /*
     * This used to assert that the identity row sat directly above the rail
     * with a 12px gap rather than 24px. It is now ON the rail's row: the
     * identity is handed to `InvestmentTimeline` as `headerSlot` and drawn
     * inside `process-rail-row`, so "which Process, which stage" is one
     * line. That is the same intent — one workbench, not stacked sections —
     * held more strongly, so the assertion moves rather than relaxes.
     */
    expect(TAB).toMatch(/headerSlot=\{processHeader\}/)
    expect(TIMELINE).toMatch(/data-testid="process-rail-row"[\s\S]{0,200}\{headerSlot\}/)
    expect(TAB).not.toMatch(/<div className="space-y-6">\s*<div className="flex justify-between items-center">/)
  })

  it('keeps the way back when a view REPLACES the rail', () => {
    /*
     * Timeline and Files render instead of the rail, so the identity row
     * cannot live only inside it — the control that switches back would be
     * inside the thing it switches away from. Same JSX, rendered standalone
     * for exactly those two views.
     */
    expect(TAB).toMatch(/\{\(showTemplatesView \|\| showTimelineView\) && \(/)
    expect(TAB).toMatch(/\{processHeader\}/)
  })

  it('does not spend 24px of card padding framing the working surface', () => {
    expect(TIMELINE).toMatch(/<Card key=\{`\$\{workflowId\}-\$\{showStageDetails\}`\} padding="sm"/)
  })
})
