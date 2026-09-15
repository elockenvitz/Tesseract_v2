/**
 * The five-stage mission: one stage per app.
 *
 *   1 Capture an investment idea   the idea exists
 *   2 Develop the thesis           Idea Pipeline basics finished
 *   3 Test the trade               Trade Lab's last step — a trade executed
 *   4 Make the decision            Trade Book basics finished
 *   5 Close the loop               Outcomes' "Finish the loop" finished
 *
 * The claim worth pinning: the roadmap and the app the reader is in agree about
 * where they are. Executing a trade finishes stage 3 only — stage 4 is Trade
 * Book and stage 5 is Outcomes — and an idea that disappears sends the pilot
 * back to the start.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  MISSION_STEP_IDS, isPipelineAdvanced, missionState, tutorialIdeaKey,
  tutorialOutcomeReviewedKey, tradeBookBasicsKey, type MissionFacts,
  pipelineBasicsFromProgress, pipelineStepMovedKey, pipelineStepInboxKey, pipelineStepTradeLabKey,
} from '../mission'

const ALL_BASICS = { moved: true, inboxOpened: true, tradeLabOpened: true }
const AT = '2026-09-14T12:00:00.000Z'

const facts = (over: Partial<MissionFacts> = {}): MissionFacts => ({
  tutorialIdeaId: null,
  ideaExists: false,
  hasExecutedTrade: false,
  outcomeReviewedAt: null,
  ...over,
})

/** An idea that exists. */
const withIdea = (over: Partial<MissionFacts> = {}) =>
  facts({ tutorialIdeaId: 'tq-1', ideaExists: true, ...over })

const doneIds = (f: MissionFacts) => missionState(f).steps.filter(s => s.done).map(s => s.id)

/** Each app's Getting Started, finished up to and including stage `n`. */
const through = (n: 1 | 2 | 3 | 4 | 5): Partial<MissionFacts> => ({
  ...(n >= 2 ? { pipelineBasics: ALL_BASICS } : {}),
  ...(n >= 3 ? { hasExecutedTrade: true } : {}),
  ...(n >= 4 ? { tradeBookBasicsAt: AT } : {}),
  ...(n >= 5 ? { outcomeReviewedAt: AT } : {}),
})

describe('the mission', () => {
  it('is five stages in the order of one decision', () => {
    expect(MISSION_STEP_IDS).toEqual([
      'idea_created', 'pipeline_advanced', 'simulation_completed',
      'decision_submitted', 'outcome_reviewed',
    ])
  })

  it('starts a new pilot at nothing, pointing at stage one', () => {
    const m = missionState(facts())
    expect(m.completedCount).toBe(0)
    expect(m.total).toBe(5)
    expect(m.currentStepId).toBe('idea_created')
    expect(m.steps[0].available).toBe(true)
  })

  it('shows later stages as a journey, not as errors', () => {
    const m = missionState(facts())
    expect(m.steps[2].available).toBe(false)
    expect(m.steps[2].blockedBy).toBe('Develop the thesis first.')
    expect(m.steps).toHaveLength(5)
  })

  /** Each stage names its app and what finishes it, and its button opens that app. */
  it('names the app each stage happens in', () => {
    const m = missionState(facts())
    expect(m.steps.map(s => s.cta)).toEqual([
      'Capture idea', 'Open Pipeline', 'Open Trade Lab', 'Open Trade Book', 'Open Outcomes',
    ])
    expect(m.steps[1].hint).toMatch(/^In Idea Pipeline:/)
    expect(m.steps[2].hint).toMatch(/^In Trade Lab:.*execute/)
    expect(m.steps[3].hint).toMatch(/^In Trade Book:.*open Outcomes/)
    expect(m.steps[4].hint).toMatch(/^In Outcomes:/)
  })
})

describe('stage 1 — the idea', () => {
  it('completes when the stored id points at a row that exists', () => {
    expect(doneIds(withIdea())).toEqual(['idea_created'])
    expect(missionState(withIdea()).tutorialIdeaId).toBe('tq-1')
  })

  it('returns to stage one when the stored idea is gone, whatever else is done', () => {
    const m = missionState(facts({ tutorialIdeaId: 'tq-gone', ideaExists: false, ...through(5) }))
    expect(m.completedCount).toBe(0)
    expect(m.currentStepId).toBe('idea_created')
    expect(m.tutorialIdeaId).toBeNull()
  })

  it('credits nothing at all without an id', () => {
    expect(doneIds(facts(through(5)))).toEqual([])
  })
})

describe('one stage per app, each done when its Getting Started is finished', () => {
  it.each([
    [1, 'pipeline_advanced'],
    [2, 'simulation_completed'],
    [3, 'decision_submitted'],
    [4, 'outcome_reviewed'],
  ] as const)('after stage %i the roadmap is on %s', (n, current) => {
    const m = missionState(withIdea(through(n)))
    expect(m.completedCount).toBe(n)
    expect(m.currentStepId).toBe(current)
  })

  it('completes the mission only when all five are done', () => {
    expect(missionState(withIdea(through(4))).complete).toBe(false)
    const m = missionState(withIdea(through(5)))
    expect(m.complete).toBe(true)
    expect(m.currentStepId).toBeNull()
  })

  /**
   * The reported bug. Executing in Trade Lab is stage 3's last step; it used to
   * complete stage 4 as well and put the roadmap on stage 5 while the pilot was
   * still in Trade Book.
   */
  it('executing a trade finishes Trade Lab only — the roadmap moves to Trade Book, not Outcomes', () => {
    const m = missionState(withIdea({ ...through(2), hasExecutedTrade: true }))
    expect(m.steps[2].done).toBe(true)
    expect(m.steps[3].done).toBe(false)
    expect(m.currentStepId).toBe('decision_submitted')
    expect(m.steps[3].cta).toBe('Open Trade Book')
  })

  it('stays on Trade Book until Trade Book basics is finished, then moves to Outcomes', () => {
    expect(missionState(withIdea(through(3))).currentStepId).toBe('decision_submitted')
    expect(missionState(withIdea(through(4))).currentStepId).toBe('outcome_reviewed')
  })

  it('stays on Outcomes until "Finish the loop" is finished', () => {
    expect(missionState(withIdea(through(4))).steps[4].done).toBe(false)
    expect(missionState(withIdea(through(5))).steps[4].done).toBe(true)
  })

  it('adding or sizing a trade without executing does not finish Trade Lab', () => {
    expect(missionState(withIdea({ ...through(2), hasExecutedTrade: false })).currentStepId).toBe('simulation_completed')
  })

  /** Stages are independent facts: a gap does not hide a later truth, and the roadmap points at the gap. */
  it('points at the earliest unfinished app', () => {
    const m = missionState(withIdea({ hasExecutedTrade: true, tradeBookBasicsAt: AT }))
    expect(m.steps[1].done).toBe(false)
    expect(m.steps[3].done).toBe(true)
    expect(m.currentStepId).toBe('pipeline_advanced')
  })
})

describe('stage 2 — Idea Pipeline basics', () => {
  const ORG = 'org-1'
  const IDEA = 'tq-tutorial'

  /** Facts as `usePilotMission` builds them: the idea's row plus the stored marks. */
  const journey = (progress: Record<string, string>) =>
    missionState(facts({
      tutorialIdeaId: IDEA,
      ideaExists: true,
      pipelineBasics: pipelineBasicsFromProgress(progress, ORG),
    }))

  const afterStep1 = { [tutorialIdeaKey(ORG)]: IDEA, [pipelineStepMovedKey(ORG)]: AT }
  const afterStep2 = { ...afterStep1, [pipelineStepInboxKey(ORG)]: AT }
  const afterStep3 = { ...afterStep2, [pipelineStepTradeLabKey(ORG)]: AT }

  it.each([
    ['1/3', afterStep1, 'pipeline_advanced'],
    ['2/3', afterStep2, 'pipeline_advanced'],
    ['3/3', afterStep3, 'simulation_completed'],
  ] as const)('after Pipeline basics %s the roadmap is on %s, and a hard refresh agrees', (_label, stored, expected) => {
    expect(journey(stored).currentStepId).toBe(expected)
    const fromServer = JSON.parse(JSON.stringify(stored)) as Record<string, string>
    expect(journey(fromServer).currentStepId).toBe(expected)
  })

  it('reads the marks for this org only', () => {
    const otherOrg = pipelineBasicsFromProgress(afterStep3, 'org-2')
    expect(otherOrg).toEqual({ moved: false, inboxOpened: false, tradeLabOpened: false })
  })

  it('treats a caller that never read the marks as not done, not done-by-default', () => {
    expect(missionState(facts({ tutorialIdeaId: IDEA, ideaExists: true })).steps[1].done).toBe(false)
  })

  /** Still exported for the Pipeline's own use; no stage reads it now. */
  it('keeps the stage vocabulary helper', () => {
    expect(isPipelineAdvanced('idea')).toBe(false)
    expect(isPipelineAdvanced('investigate')).toBe(true)
  })
})

describe('the marks the mission reads are the marks the app writes', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('shares one key spelling between writer and reader', () => {
    expect(pipelineStepMovedKey('o')).toBe('pipeline_step_moved_at_o')
    expect(pipelineStepInboxKey('o')).toBe('pipeline_step_inbox_at_o')
    expect(pipelineStepTradeLabKey('o')).toBe('pipeline_step_tradelab_at_o')
    expect(tradeBookBasicsKey('o')).toBe('tradebook_basics_completed_at_o')
    const progress = src('hooks/usePilotProgress.ts')
    // Imported from the mission, not redefined beside the writer.
    const imports = progress.slice(0, progress.indexOf("} from '../lib/pilot/mission'"))
    for (const k of ['pipelineStepMovedKey', 'pipelineStepInboxKey', 'pipelineStepTradeLabKey', 'tutorialOutcomeReviewedKey', 'tradeBookBasicsKey']) {
      expect(imports.slice(imports.lastIndexOf('import {'))).toContain(k)
      expect(progress).not.toMatch(new RegExp(`const ${k}\\s*=`))
    }
    expect(progress).toContain("case 'tradebook_basics_completed': return tradeBookBasicsKey(orgId)")
  })

  it('feeds every stored mark into the mission for the current org', () => {
    const hook = src('hooks/usePilotMission.ts')
    expect(hook).toContain('pipelineBasics: pipelineBasicsFromProgress(progress, currentOrgId)')
    expect(hook).toContain('tradeBookBasicsAt: (progress[tradeBookBasicsKey(currentOrgId)]')
    expect(hook).toContain('outcomeReviewedAt: (progress[tutorialOutcomeReviewedKey(currentOrgId)]')
  })

  /** Pipeline basics step 3 has to be earnable on both shells. */
  it('marks Trade Lab from the board on both shells', () => {
    for (const f of ['pages/TradeQueuePage.tsx', 'components/mobile/MobilePipeline.tsx']) {
      const s = src(f)
      expect(s).toContain("window.addEventListener('openTradeLab'")
      expect(s).toContain("'pipeline_step_tradelab'")
    }
  })

  it('writes the stage 4 mark as Trade Book basics finishes', () => {
    const hook = src('hooks/usePilotTradeBookSteps.ts')
    expect(hook).toContain("if (!userId || !allDone || stageMarked) return")
    expect(hook).toContain("mark('tradebook_basics_completed')")
  })

  it('writes the stage 5 mark as "Finish the loop" finishes, and not when Outcomes merely loads', () => {
    const banner = src('components/pilot/PilotOutcomesGetStarted.tsx')
    expect(banner).toContain("if (!userId || !step1 || !step2 || !step3 || stageMarked) return")
    expect(banner).toContain("mark('tutorial_outcome_reviewed')")
    const page = src('pages/DecisionAccountabilityPage.tsx')
    expect(page).not.toContain('markOutcomeReviewed()')
    // The graduation writer stays mounted on Outcomes.
    expect(page).toContain('  usePilotMission()\n')
  })
})

describe('storage keys', () => {
  it('are per organisation, like every other pilot key', () => {
    expect(tutorialIdeaKey('org-1')).toBe('tutorial_idea_id_org-1')
    expect(tutorialOutcomeReviewedKey('org-1')).toBe('tutorial_outcome_reviewed_at_org-1')
    expect(tradeBookBasicsKey('org-1')).toBe('tradebook_basics_completed_at_org-1')
    expect(tutorialIdeaKey(null)).toBe('tutorial_idea_id_no-org')
  })
})

describe('where each stage’s button goes', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
  const shells = ['components/dashboard/PilotWelcomeBanner.tsx', 'components/mobile/PilotMissionStrip.tsx']

  it('Make the decision opens Trade Book, not the Idea Pipeline', () => {
    for (const f of shells) {
      const s = src(f)
      const decide = s.slice(s.indexOf("case 'decision_submitted':"), s.indexOf("case 'outcome_reviewed':"))
      expect(decide).toContain("type: 'trade-book'")
      expect(decide).not.toContain('trade-queue')
    }
  })

  it('does not mark a stage from either button', () => {
    for (const f of shells) expect(src(f)).not.toContain('markOutcomeReviewed()')
  })

  it('routes the decision to review to Outcomes, falling back to the tutorial idea', () => {
    for (const f of shells) {
      expect(src(f)).toContain("type: 'outcomes', data: { tradeQueueItemId: mission.reviewIdeaId ?? ideaId }")
    }
  })

  /*
   * The routed id has to survive into the page, or the pilot lands on the
   * right screen with their decision filtered out of it.
   */
  it('hands the routed id to Outcomes as a focus', () => {
    expect(src('pages/DashboardPage.tsx'))
      .toContain('focusDecisionId={activeTab.data?.tradeQueueItemId ?? null}')
  })

  it('widens the local filters for a focused arrival, and only then', () => {
    const page = src('pages/DecisionAccountabilityPage.tsx')
    expect(page).toContain('setSelectedId(focusDecisionId)')
    expect(page).toContain('dateRange: undefined')
    // Once per arrival, and handed back to the shell so it is not honoured
    // again on the next ordinary visit.
    expect(page).toContain('if (!focusDecisionId) return')
    expect(page).toContain('onFocusConsumed?.()')
  })

  it('does not persist a focused view over the reader s own filters', () => {
    expect(src('pages/DecisionAccountabilityPage.tsx'))
      .toContain('if (focusRef.current) return')
  })
})
