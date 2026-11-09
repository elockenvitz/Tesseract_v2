/**
 * Telling one run of a process from another.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * The Work sidebar listed three rows that read identically:
 *
 *     Weekly Portfolio Review - Vision Fund 10K - …
 *     Weekly Portfolio Review - Vision Fund 10K - …
 *     Weekly Portfolio Review - Vision Fund 10K - …
 *
 * The Apr 10, Apr 3 and Mar 27 runs. A 296px column truncates from the end,
 * so the 40-character shared prefix always survived and the date never did,
 * and no `title` existed to recover it by hovering. Choosing the right run
 * meant opening rows until one was correct.
 *
 * ── What is asserted ──────────────────────────────────────────────────────
 *
 * The real three names, not paraphrases, and the property that matters: the
 * three rows differ in what a reader can SEE, with the discriminator leading
 * the line that carries it. Plus the shapes that must not regress — a process
 * that is not a branch, a hand-edited name whose tail does not match, and two
 * runs that genuinely share a suffix.
 */
import { describe, it, expect } from 'vitest'
import { buildWorkItems, splitRunName } from '../work-items'

const EMPTY = {
  needsYourAction: [], awaitingOthers: [], ideas: [], processes: [], conversations: [],
}

/* The production rows, copied from `workflows` for AMZN. */
const WEEKLY = 'Weekly Portfolio Review - Vision Fund 10K'
const RUNS = [
  { workflowId: 'wf-apr10', name: `${WEEKLY} - Apr 10 2026`, branchSuffix: 'Apr 10 2026' },
  { workflowId: 'wf-apr03', name: `${WEEKLY} - Apr 3 2026`, branchSuffix: 'Apr 3 2026' },
  { workflowId: 'wf-mar27', name: `${WEEKLY} - Mar 27 2026`, branchSuffix: 'Mar 27 2026' },
].map(r => ({ ...r, stageLabel: 'Momentum Check', isStarted: true, isCompleted: false }))

describe('splitting a run name into process and run', () => {
  it('lifts the suffix out of the name', () => {
    expect(splitRunName(`${WEEKLY} - Apr 10 2026`, 'Apr 10 2026'))
      .toEqual({ process: WEEKLY, run: 'Apr 10 2026' })
  })

  it('leaves a process that is not a branch alone', () => {
    expect(splitRunName('Research Workflow', null))
      .toEqual({ process: 'Research Workflow', run: null })
  })

  it('keeps the whole name when the tail does not match the suffix', () => {
    /* A hand-edited or uniquified name owes this nothing. The suffix still
       shows beneath it — wording repeats, no fact is dropped. */
    expect(splitRunName('Renamed By Hand', 'Apr 10 2026'))
      .toEqual({ process: 'Renamed By Hand', run: 'Apr 10 2026' })
  })

  it('never returns an empty process name', () => {
    /* A name that is nothing but its suffix would otherwise leave a blank row. */
    expect(splitRunName('Apr 10 2026', 'Apr 10 2026').process).toBe('Apr 10 2026')
  })

  it('tolerates an en dash or a middle dot as the separator', () => {
    expect(splitRunName('Weekly Review — Apr 10 2026', 'Apr 10 2026').process).toBe('Weekly Review')
    expect(splitRunName('Weekly Review · Q2 2026', 'Q2 2026').process).toBe('Weekly Review')
  })

  it('ignores a blank suffix rather than trimming the name on it', () => {
    expect(splitRunName(`${WEEKLY} - Apr 10 2026`, '   '))
      .toEqual({ process: `${WEEKLY} - Apr 10 2026`, run: null })
  })
})

describe('the three runs a reader could not tell apart', () => {
  const rows = buildWorkItems({ ...EMPTY, processes: RUNS })

  it('lists all three', () => {
    expect(rows).toHaveLength(3)
  })

  it('gives each a different line AFTER truncation, with no hover needed', () => {
    /*
     * Truncation is the whole defect, so the assertion has to survive it.
     *
     * Comparing the full strings passes on the broken code too — the three
     * names DO differ, in characters the 296px column never showed. What has
     * to differ is the part a reader can actually see, so each line is cut to
     * roughly what fits at 12px and 10px before being compared.
     */
    const seen = rows.map(r => `${r.label.slice(0, 34)}|${(r.detail ?? '').slice(0, 20)}`)
    expect(new Set(seen).size).toBe(3)
  })

  it('leads the detail with the run, so truncation takes the stage not the date', () => {
    expect(rows[0].detail).toBe('Apr 10 2026 · Momentum Check')
    expect(rows[0].detail!.startsWith('Apr 10 2026')).toBe(true)
  })

  it('stops repeating the process name on every row', () => {
    rows.forEach(r => expect(r.label).toBe(WEEKLY))
  })

  it('keeps the full name reachable for the tooltip and the accessible name', () => {
    expect(rows[0].fullName).toBe(`${WEEKLY} - Apr 10 2026`)
    expect(rows.map(r => r.fullName)).toEqual([
      `${WEEKLY} - Apr 10 2026`, `${WEEKLY} - Apr 3 2026`, `${WEEKLY} - Mar 27 2026`,
    ])
  })
})

describe('shapes that must not regress', () => {
  it('still shows the stage alone when there is no suffix', () => {
    const [row] = buildWorkItems({
      ...EMPTY,
      processes: [{
        workflowId: 'wf-1', name: 'Research Workflow', branchSuffix: null,
        stageLabel: 'Expectations', isStarted: true, isCompleted: false,
      }],
    })
    expect(row.label).toBe('Research Workflow')
    expect(row.detail).toBe('Expectations')
  })

  it('shows the run alone when the stage is not known', () => {
    /* The stage is only populated for the open process; the others must still
       say which run they are. */
    const [row] = buildWorkItems({
      ...EMPTY,
      processes: [{
        workflowId: 'wf-1', name: `${WEEKLY} - Apr 3 2026`, branchSuffix: 'Apr 3 2026',
        stageLabel: null, isStarted: true, isCompleted: false,
      }],
    })
    expect(row.detail).toBe('Apr 3 2026')
  })

  it('reports null detail when there is neither run nor stage', () => {
    const [row] = buildWorkItems({
      ...EMPTY,
      processes: [{
        workflowId: 'wf-1', name: 'Research Workflow', branchSuffix: null,
        stageLabel: null, isStarted: true, isCompleted: false,
      }],
    })
    expect(row.detail).toBeNull()
  })

  it('still separates two runs that share a suffix, by their full name', () => {
    /* Two Mar 27 runs exist on AMZN. The visible line cannot part them, so the
       accessible name has to, and the selection key always did. */
    const dup = buildWorkItems({
      ...EMPTY,
      processes: [
        { workflowId: 'wf-a', name: `${WEEKLY} - Mar 27 2026`, branchSuffix: 'Mar 27 2026', stageLabel: null, isStarted: true, isCompleted: false },
        { workflowId: 'wf-b', name: `${WEEKLY} - Mar 27 2026 (2)`, branchSuffix: 'Mar 27 2026', stageLabel: null, isStarted: true, isCompleted: false },
      ],
    })
    expect(new Set(dup.map(r => r.key)).size).toBe(2)
    expect(new Set(dup.map(r => r.fullName)).size).toBe(2)
  })
})
