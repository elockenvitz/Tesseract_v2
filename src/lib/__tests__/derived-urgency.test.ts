/**
 * Derived urgency: two clocks, chosen by whether the idea is waiting on
 * somebody else.
 *
 * The bug this pins: the stage check was a hardcoded set of five LEGACY
 * labels, so the canonical stages were absent and every one of them fell
 * through to the `else` — the late-stage clock meant for ideas awaiting a
 * decision. Ideas nobody had been asked to decide started reporting
 * "Needs decision" after two days and "Critical" after seven.
 *
 * It was invisible to the type ceiling (the parameter is a plain `string`)
 * and invisible on a fresh idea (both clocks return null on day zero). It
 * only appears once rows age, which is the worst time to discover it.
 */
import { describe, it, expect } from 'vitest'
import { getDerivedUrgency, getUrgencySeverity, DERIVED_URGENCY_CONFIG } from '../derived-urgency'
import { IDEA_STAGES, FINAL_STAGE, LEGACY_STAGE_MAP } from '../ideas/stage-model'

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

/** Every stage that is NOT the end of the pipeline, both vocabularies. */
const WORKING_STAGES = [
  ...IDEA_STAGES.filter((s) => s !== FINAL_STAGE),
  ...Object.entries(LEGACY_STAGE_MAP)
    .filter(([, canonical]) => canonical !== FINAL_STAGE)
    .map(([legacy]) => legacy),
]

/** Every stage that IS the end of the pipeline, both vocabularies. */
const AWAITING_STAGES = [
  FINAL_STAGE,
  ...Object.entries(LEGACY_STAGE_MAP)
    .filter(([, canonical]) => canonical === FINAL_STAGE)
    .map(([legacy]) => legacy),
]

describe('ideas still being worked on get the patient clock', () => {
  it('covers the canonical stages, which is the regression', () => {
    // If `exploring` ever leaves this list the bug is back.
    expect(WORKING_STAGES).toEqual(expect.arrayContaining(['exploring', 'researching', 'developing']))
  })

  it.each(WORKING_STAGES)('%s is quiet for a fortnight', (stage) => {
    expect(getDerivedUrgency(stage, daysAgo(0))).toBeNull()
    expect(getDerivedUrgency(stage, daysAgo(6))).toBeNull()
    expect(getDerivedUrgency(stage, daysAgo(13))).toBeNull()
  })

  it.each(WORKING_STAGES)('%s escalates on the 28/14-day clock, never the 7/5/2 one', (stage) => {
    expect(getDerivedUrgency(stage, daysAgo(14))).toBe('needs_attention')
    expect(getDerivedUrgency(stage, daysAgo(28))).toBe('stale')
    // The specific wrong answers the old code gave.
    expect(getDerivedUrgency(stage, daysAgo(8))).not.toBe('critical')
    expect(getDerivedUrgency(stage, daysAgo(3))).not.toBe('needs_decision')
  })
})

describe('ideas awaiting a decision get the impatient clock', () => {
  it.each(AWAITING_STAGES)('%s escalates in days', (stage) => {
    expect(getDerivedUrgency(stage, daysAgo(0))).toBeNull()
    expect(getDerivedUrgency(stage, daysAgo(2))).toBe('needs_decision')
    expect(getDerivedUrgency(stage, daysAgo(5))).toBe('delayed')
    expect(getDerivedUrgency(stage, daysAgo(7))).toBe('critical')
  })

  it('treats a legacy deciding row the same as ready_to_recommend', () => {
    // Both mean "advocated, waiting on someone", so both are on the fast
    // clock during the rollout window.
    expect(getDerivedUrgency('deciding', daysAgo(7)))
      .toBe(getDerivedUrgency('ready_to_recommend', daysAgo(7)))
  })
})

describe('unreadable input does not get the impatient clock', () => {
  it('falls back to the patient one', () => {
    // `toIdeaStage` maps anything unknown to `exploring`. An idea whose stage
    // we cannot read must not be escalated on the strength of a value nobody
    // recognises — at 8 days the impatient clock says Critical and the
    // patient one says nothing at all.
    expect(getDerivedUrgency('nonsense', daysAgo(8))).toBeNull()
    expect(getDerivedUrgency('nonsense', daysAgo(14))).toBe('needs_attention')
    expect(getDerivedUrgency('', daysAgo(30))).toBe('stale')
  })
})

describe('severity ordering', () => {
  it('ranks the five levels and treats null as zero', () => {
    expect(getUrgencySeverity(null)).toBe(0)
    const ranked = (Object.keys(DERIVED_URGENCY_CONFIG) as Array<keyof typeof DERIVED_URGENCY_CONFIG>)
      .map(getUrgencySeverity)
    expect(new Set(ranked).size).toBe(ranked.length) // no ties
    expect(getUrgencySeverity('critical')).toBeGreaterThan(getUrgencySeverity('stale'))
  })
})
