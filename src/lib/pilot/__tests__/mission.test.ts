/**
 * The five-step mission, and the identity that holds it together.
 *
 * The claims worth pinning: each step is about the SAME idea, a step that
 * leaves an artifact is never a click, and an idea that disappears sends the
 * pilot back to the start rather than leaving them stuck.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  MISSION_STEP_IDS, isPipelineAdvanced, missionState, tutorialIdeaKey,
  tutorialOutcomeReviewedKey, type MissionFacts,
  pipelineBasicsFromProgress, pipelineStepMovedKey, pipelineStepInboxKey, pipelineStepTradeLabKey,
} from '../mission'

const ALL_BASICS = { moved: true, inboxOpened: true, tradeLabOpened: true }

const facts = (over: Partial<MissionFacts> = {}): MissionFacts => ({
  tutorialIdeaId: null,
  ideaExists: false,
  ideaStage: null,
  hasSimulationTrade: false,
  hasDecision: false,
  outcomeReviewedAt: null,
  ...over,
})

/** An idea that exists, at whatever stage. */
const withIdea = (over: Partial<MissionFacts> = {}) =>
  facts({ tutorialIdeaId: 'tq-1', ideaExists: true, ideaStage: 'idea', ...over })

const doneIds = (f: MissionFacts) => missionState(f).steps.filter(s => s.done).map(s => s.id)

describe('the mission', () => {
  it('is five steps in the order of one decision', () => {
    expect(MISSION_STEP_IDS).toEqual([
      'idea_created', 'pipeline_advanced', 'simulation_completed',
      'decision_submitted', 'outcome_reviewed',
    ])
  })

  it('starts a new pilot at nothing, pointing at step one', () => {
    const m = missionState(facts())
    expect(m.completedCount).toBe(0)
    expect(m.total).toBe(5)
    expect(m.currentStepId).toBe('idea_created')
    expect(m.steps[0].available).toBe(true)
  })

  it('shows later steps as a journey, not as errors', () => {
    const m = missionState(facts())
    expect(m.steps[2].available).toBe(false)
    expect(m.steps[2].blockedBy).toBe('Develop the thesis first.')
    // Every step is still listed, so the shape of the journey is legible.
    expect(m.steps).toHaveLength(5)
  })
})

describe('step 1 — the tutorial idea', () => {
  it('completes when the stored id points at a row that exists', () => {
    expect(doneIds(withIdea())).toEqual(['idea_created'])
    expect(missionState(withIdea()).tutorialIdeaId).toBe('tq-1')
  })

  /**
   * The recovery rule. Every later step reads against this idea, so a stored
   * id with no row behind it must return the pilot to step one rather than
   * leave four steps that cannot be evaluated.
   */
  it('returns to step one when the stored idea is gone', () => {
    const m = missionState(facts({
      tutorialIdeaId: 'tq-gone', ideaExists: false,
      ideaStage: 'deep_research', hasSimulationTrade: true, hasDecision: true,
      outcomeReviewedAt: '2026-09-01T00:00:00Z',
    }))
    expect(m.completedCount).toBe(0)
    expect(m.currentStepId).toBe('idea_created')
    expect(m.tutorialIdeaId).toBeNull()
  })

  it('credits nothing at all without an id', () => {
    expect(doneIds(facts({ ideaStage: 'thesis_forming', hasDecision: true }))).toEqual([])
  })
})

describe('step 2 — pipeline', () => {
  /** Every idea is BORN at `idea`, which resolves to `aware`. Moving is the lesson. */
  it('does not count the stage every idea starts at', () => {
    expect(isPipelineAdvanced('idea')).toBe(false)
    expect(isPipelineAdvanced('aware')).toBe(false)
    expect(doneIds(withIdea({ ideaStage: 'idea' }))).toEqual(['idea_created'])
  })

  it.each(['investigate', 'deep_research', 'thesis_forming', 'ready_for_decision'])(
    'counts %s',
    stage => expect(isPipelineAdvanced(stage)).toBe(true),
  )

  /** The legacy vocabulary is what creation writes, so it has to resolve too. */
  it.each([
    ['working_on', true], ['discussing', true], ['modeling', true],
    ['simulating', true], ['deciding', true],
  ] as const)('resolves the legacy stage %s to %s', (stage, expected) => {
    expect(isPipelineAdvanced(stage)).toBe(expected)
  })

  it('is false for an unknown stage rather than guessing', () => {
    expect(isPipelineAdvanced('something_else')).toBe(false)
    expect(isPipelineAdvanced(null)).toBe(false)
  })
})

describe('steps 3 to 5', () => {
  it('takes simulation from a persisted simulated trade, not a link', () => {
    const m = missionState(withIdea({ ideaStage: 'deep_research', hasSimulationTrade: true }))
    expect(m.steps[2].done).toBe(true)
    expect(m.completedCount).toBe(3)
  })

  it('takes the decision from a real decision artifact', () => {
    const m = missionState(withIdea({ ideaStage: 'ready_for_decision', hasDecision: true }))
    expect(m.steps[3].done).toBe(true)
  })

  /** The only step that is a mark, because reading writes nothing. */
  it('takes the review from the server-backed mark', () => {
    const m = missionState(withIdea({ outcomeReviewedAt: '2026-09-01T00:00:00Z' }))
    expect(m.steps[4].done).toBe(true)
  })

  it('completes the mission only when all five are done', () => {
    const m = missionState(withIdea({
      ideaStage: 'ready_for_decision', hasSimulationTrade: true,
      hasDecision: true, outcomeReviewedAt: '2026-09-01T00:00:00Z',
    }))
    expect(m.complete).toBe(true)
    expect(m.currentStepId).toBeNull()
  })

  /** Steps are independent facts: a gap does not block a later truth. */
  it('reports a later truth even when an earlier step is outstanding', () => {
    const m = missionState(withIdea({ ideaStage: 'idea', hasDecision: true }))
    expect(m.steps[1].done).toBe(false)
    expect(m.steps[3].done).toBe(true)
    expect(m.currentStepId).toBe('pipeline_advanced')
  })

  /*
   * Executing the trade DELETES its simulation_trades row — the execute
   * service bulk-deletes the rows it committed, because the trade has left
   * the simulation and become a committed one. Reading only that artifact
   * made step 3 un-complete itself at the moment it was most thoroughly
   * done, and `currentStepId` is the first step that is not done: a pilot
   * who had just executed was sent back to "Test the trade — Open Trade Lab".
   */
  it('keeps the simulation step done after the simulated trade is executed', () => {
    const afterExecute = withIdea({
      ideaStage: 'ready_for_decision',
      // Gone: execute deleted it.
      hasSimulationTrade: false,
      // Left behind: the accepted_trade it became.
      hasDecision: true,
    })
    const m = missionState(afterExecute)
    expect(m.steps[2].done).toBe(true)
    expect(m.steps[3].done).toBe(true)
    expect(m.currentStepId).toBe('outcome_reviewed')
    expect(m.completedCount).toBe(4)
  })

  /** The mission never walks backwards across an execute. */
  it('does not regress when the artifact is traded away', () => {
    const before = missionState(withIdea({ ideaStage: 'ready_for_decision', hasSimulationTrade: true }))
    const after = missionState(withIdea({ ideaStage: 'ready_for_decision', hasSimulationTrade: false, hasDecision: true }))
    expect(after.completedCount).toBeGreaterThanOrEqual(before.completedCount)
    expect(after.steps[2].done).toBe(true)
  })

  /** Absent a decision, the step still needs the simulated trade. */
  it('still requires something to have happened', () => {
    const m = missionState(withIdea({ ideaStage: 'deep_research', pipelineBasics: ALL_BASICS }))
    expect(m.steps[2].done).toBe(false)
    expect(m.currentStepId).toBe('simulation_completed')
  })
})

/*
 * ── Stage 2 waits for Pipeline basics ──────────────────────────────────────
 *
 * The defect: stage 2 read only "the tutorial idea has left `aware`", which is
 * the same act that completes Pipeline basics step 1. One move completed 1 of 3
 * and the whole stage, and the home screen jumped to "Test the trade".
 *
 * These walk the journey as the pilot does it, against the same idea, with the
 * marks read out of a `pilot_progress` object exactly as the server returns it.
 */
describe('stage 2 — develop the thesis — completes with Pipeline basics, not before', () => {
  const ORG = 'org-1'
  const IDEA = 'tq-tutorial'

  /** Facts as `usePilotMission` builds them: the idea's row plus the stored marks. */
  const journey = (progress: Record<string, string>, idea: Partial<MissionFacts> = {}) =>
    missionState(facts({
      tutorialIdeaId: IDEA,
      ideaExists: true,
      ideaStage: 'investigate',
      pipelineBasics: pipelineBasicsFromProgress(progress, ORG),
      ...idea,
    }))

  const at = '2026-09-14T12:00:00.000Z'
  const afterStep1 = { [tutorialIdeaKey(ORG)]: IDEA, [pipelineStepMovedKey(ORG)]: at }
  const afterStep2 = { ...afterStep1, [pipelineStepInboxKey(ORG)]: at }
  const afterStep3 = { ...afterStep2, [pipelineStepTradeLabKey(ORG)]: at }

  it('starts on stage 2 once the idea exists and has not moved', () => {
    const m = journey({ [tutorialIdeaKey(ORG)]: IDEA }, { ideaStage: 'idea' })
    expect(m.currentStepId).toBe('pipeline_advanced')
  })

  it('stays on stage 2 after Pipeline basics 1/3 — the idea moved', () => {
    const m = journey(afterStep1)
    expect(m.steps[1].done).toBe(false)
    expect(m.currentStepId).toBe('pipeline_advanced')
    expect(m.completedCount).toBe(1)
  })

  it('stays on stage 2 after Pipeline basics 2/3 — the Decision Inbox opened', () => {
    const m = journey(afterStep2)
    expect(m.steps[1].done).toBe(false)
    expect(m.currentStepId).toBe('pipeline_advanced')
    expect(m.completedCount).toBe(1)
  })

  it('advances to stage 3 after Pipeline basics 3/3 — Trade Lab opened', () => {
    const m = journey(afterStep3)
    expect(m.steps[1].done).toBe(true)
    expect(m.currentStepId).toBe('simulation_completed')
    expect(m.completedCount).toBe(2)
  })

  it('does not credit the stage for the marks alone while the idea has not moved', () => {
    const m = journey(afterStep3, { ideaStage: 'idea' })
    expect(m.steps[1].done).toBe(false)
    expect(m.currentStepId).toBe('pipeline_advanced')
  })

  it('reads the marks for this org only', () => {
    const otherOrg = pipelineBasicsFromProgress(afterStep3, 'org-2')
    expect(otherOrg).toEqual({ moved: false, inboxOpened: false, tradeLabOpened: false })
    expect(journey(afterStep3, { pipelineBasics: otherOrg }).currentStepId).toBe('pipeline_advanced')
  })

  it('treats a caller that never read the marks as not done, not done-by-default', () => {
    const m = missionState(facts({ tutorialIdeaId: IDEA, ideaExists: true, ideaStage: 'investigate' }))
    expect(m.steps[1].done).toBe(false)
  })

  /*
   * A hard refresh drops every in-memory flag. What survives is the
   * `pilot_progress` JSON on the users row, which arrives as a plain object
   * after a JSON round trip. The state has to come back the same from that
   * alone.
   */
  it.each([
    ['1/3', afterStep1, 'pipeline_advanced'],
    ['2/3', afterStep2, 'pipeline_advanced'],
    ['3/3', afterStep3, 'simulation_completed'],
  ] as const)('comes back at the same stage after a hard refresh at %s', (_label, stored, expected) => {
    const fromServer = JSON.parse(JSON.stringify(stored)) as Record<string, string>
    expect(journey(fromServer).currentStepId).toBe(expected)
    expect(journey(fromServer).tutorialIdeaId).toBe(IDEA)
  })

  /*
   * Pilots already past this stage when the rule changed — idea moved, trade
   * simulated or executed, inbox never opened — must not be sent back.
   */
  it('keeps the stage done for a pilot who has already simulated the trade', () => {
    const m = journey(afterStep1, { hasSimulationTrade: true })
    expect(m.steps[1].done).toBe(true)
    expect(m.currentStepId).toBe('decision_submitted')
  })

  it('keeps the stage done for a pilot who has already decided', () => {
    const m = journey(afterStep1, { hasDecision: true })
    expect(m.steps[1].done).toBe(true)
  })
})

describe('the marks the mission reads are the marks the app writes', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('shares one key spelling between writer and reader', () => {
    expect(pipelineStepMovedKey('o')).toBe('pipeline_step_moved_at_o')
    expect(pipelineStepInboxKey('o')).toBe('pipeline_step_inbox_at_o')
    expect(pipelineStepTradeLabKey('o')).toBe('pipeline_step_tradelab_at_o')
    const progress = src('hooks/usePilotProgress.ts')
    // Imported, not redefined beside the writer.
    expect(progress).toMatch(/pipelineStepMovedKey,\s*pipelineStepInboxKey,\s*pipelineStepTradeLabKey,\s*\} from '\.\.\/lib\/pilot\/mission'/)
    expect(progress).not.toMatch(/const pipelineStep(Moved|Inbox|TradeLab)Key\s*=/)
  })

  it('feeds the stored marks into the mission for the current org', () => {
    expect(src('hooks/usePilotMission.ts')).toContain('pipelineBasics: pipelineBasicsFromProgress(progress, currentOrgId)')
  })

  /** Step 3 has to be earnable on both shells, or a phone pilot can never finish stage 2. */
  it('marks Trade Lab from the board on both shells', () => {
    for (const f of ['pages/TradeQueuePage.tsx', 'components/mobile/MobilePipeline.tsx']) {
      const s = src(f)
      expect(s).toContain("window.addEventListener('openTradeLab'")
      expect(s).toContain("'pipeline_step_tradelab'")
    }
  })
})

describe('storage keys', () => {
  it('are per organisation, like every other pilot key', () => {
    expect(tutorialIdeaKey('org-1')).toBe('tutorial_idea_id_org-1')
    expect(tutorialOutcomeReviewedKey('org-1')).toBe('tutorial_outcome_reviewed_at_org-1')
    expect(tutorialIdeaKey(null)).toBe('tutorial_idea_id_no-org')
  })
})

/**
 * Where step 5 is marked.
 *
 * Asserted against the sources because the claim is about WHICH surface owns
 * the write, and that is not observable from the pure model — it decided
 * completion correctly in both the old arrangement and the new one.
 */
describe('reviewing an outcome is not pressing a button', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('does not mark from either CTA', () => {
    for (const f of [
      'components/dashboard/PilotWelcomeBanner.tsx',
      'components/mobile/PilotMissionStrip.tsx',
    ]) {
      expect(src(f)).not.toContain('markOutcomeReviewed()')
    }
  })

  it('marks from Outcomes, and only once it has resolved one of the pilot’s decisions', () => {
    const page = src('pages/DecisionAccountabilityPage.tsx')
    expect(page).toContain('markOutcomeReviewed()')
    // The tutorial decision or any trade the pilot executed.
    expect(page).toContain('const reviewable = mission.decisionIdeaIds')
    expect(page).toContain('rows.some(r => reviewable.includes(r.decision_id))')
    // Nothing to resolve means nothing to mark: a failed or empty load leaves
    // the step open rather than graduating somebody who saw an error.
    expect(page).toContain('if (isLoading || isError) return')
  })

  it('routes the decision to review to Outcomes, falling back to the tutorial idea', () => {
    for (const f of ['components/dashboard/PilotWelcomeBanner.tsx', 'components/mobile/PilotMissionStrip.tsx']) {
      expect(src(f)).toContain("type: 'outcomes', data: { tradeQueueItemId: mission.reviewIdeaId ?? ideaId }")
    }
  })

  /*
   * The routed id has to survive into the page, or the pilot lands on the
   * right screen with their decision filtered out of it — correct page,
   * invisible row, step stuck.
   */
  it('hands the routed id to Outcomes as a focus', () => {
    expect(src('pages/DashboardPage.tsx'))
      .toContain('focusDecisionId={activeTab.data?.tradeQueueItemId ?? null}')
  })

  it('widens the local filters for a focused arrival, and only then', () => {
    const page = src('pages/DecisionAccountabilityPage.tsx')
    // Reuses the page's own focus semantics rather than adding a second one.
    expect(page).toContain('setSelectedId(focusDecisionId)')
    // The filter that silently hides an old decision.
    expect(page).toContain('dateRange: undefined')
    // Once per focused id, and never for an ordinary visit.
    expect(page).toContain('if (!focusDecisionId || focusRef.current === focusDecisionId) return')
  })

  /** The reader's own portfolio, dates and searches must survive the visit. */
  it('does not persist a focused view over the reader s own filters', () => {
    expect(src('pages/DecisionAccountabilityPage.tsx'))
      .toContain('if (focusRef.current) return')
  })
})
