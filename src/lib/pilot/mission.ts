import { toResearchStage } from '../trade-status-semantics'

/**
 * The pilot mission: one trade idea, carried the whole way.
 *
 * ── Why one object and not a feature list ─────────────────────────────────
 *
 * The checklist this replaces had twelve peers — launcher, feed, asset, rating,
 * note, theme, thought, prompt, list, feedback, referral — and taught the
 * product as an inventory of screens. Nothing in it said what Tesseract is
 * FOR, because no two rows were about the same thing.
 *
 * These five are one decision. Capture an idea, develop the reasoning, test
 * it, record the decision, then look at what happened. That is the loop the
 * product exists to hold, and walking it once teaches more than eleven
 * unrelated visits.
 *
 * ── Why the steps are derived, not ticked ─────────────────────────────────
 *
 * Four of the five leave durable product truth behind: a row, a stage, a
 * simulated trade, a decision. None of them needs a flag, and a flag beside
 * them could only ever disagree — which is the failure `pilot_progress`
 * already documents at length. Only "reviewed the outcome" leaves nothing,
 * because reading is not writing, so that one alone is a mark.
 *
 * ── Why identity matters here ─────────────────────────────────────────────
 *
 * Every step is about the SAME `trade_queue_items.id`. "You have some idea at
 * some stage and some simulation somewhere" is not the lesson; carrying one
 * decision through is. The id is held in `pilot_progress` per org, and the
 * facts below are all read against it.
 *
 * Pure: no React, no Supabase, no clock.
 */

export type MissionStepId =
  | 'idea_created'
  | 'pipeline_advanced'
  | 'simulation_completed'
  | 'decision_submitted'
  | 'outcome_reviewed'

export const MISSION_STEP_IDS: MissionStepId[] = [
  'idea_created',
  'pipeline_advanced',
  'simulation_completed',
  'decision_submitted',
  'outcome_reviewed',
]

/** What the caller read. Each field answers exactly one step. */
export interface MissionFacts {
  /** `tutorial_idea_id_<orgId>` from `pilot_progress`. */
  tutorialIdeaId: string | null
  /**
   * Whether that row is still there.
   *
   * False with an id present is the recoverable case: the idea was deleted or
   * is no longer visible, so the mission returns to step one rather than
   * pointing at an object that is not there. Nothing is stuck.
   */
  ideaExists: boolean
  /** The tutorial idea's stage, in whichever vocabulary it was written. */
  ideaStage: string | null
  /** A `simulation_trades` row naming the tutorial idea. */
  hasSimulationTrade: boolean
  /** An `accepted_trades` row naming it, or a decided outcome on the idea. */
  hasDecision: boolean
  /** `tutorial_outcome_reviewed_at_<orgId>`. */
  outcomeReviewedAt: string | null
}

export interface MissionStep {
  id: MissionStepId
  /** The visible label. One short imperative. */
  label: string
  /** One line saying what it is for, shown under the label. */
  hint: string
  /** The control's words when this is the step to do next. */
  cta: string
  done: boolean
  /**
   * Whether the reader can act on it yet.
   *
   * A future step is SHOWN so the journey is legible, and is not a control,
   * because pressing it could not do anything useful. `blockedBy` is the
   * sentence that says so — a reason, not an error.
   */
  available: boolean
  blockedBy: string | null
}

export interface MissionState {
  steps: MissionStep[]
  completedCount: number
  total: number
  complete: boolean
  /** The one step to emphasise. Null once everything is done. */
  currentStepId: MissionStepId | null
  /** Carried through so a CTA does not have to look it up again. */
  tutorialIdeaId: string | null
}

/**
 * Stages that count as developing the idea.
 *
 * Read through `toResearchStage` rather than compared literally, because an
 * idea is BORN in the v1 vocabulary — every creation path writes `stage:
 * 'idea'` — and is moved in the v2 one by the Pipeline. The coercion is the
 * single place that knows both, so a literal comparison here would be the
 * second definition and would miss whichever half it did not list.
 *
 * `idea` resolves to `aware`, which is where every idea starts, so it does not
 * count. Moving is the lesson.
 *
 * Deliberately NOT `maturityOf`: its buckets collapse `aware`, `investigate`
 * and `deep_research` into one, so a genuine advance would not register.
 */
const ADVANCED_STAGES = new Set(['investigate', 'deep_research', 'thesis_forming', 'ready_for_decision'])

export function isPipelineAdvanced(stage: string | null | undefined): boolean {
  if (!stage) return false
  const resolved = toResearchStage(stage)
  return !!resolved && ADVANCED_STAGES.has(resolved)
}

/*
 * The steps say what each one is FOR, not which screen it happens on.
 *
 * "Develop it in Pipeline" and "Simulate the trade" named the surface and left
 * the reason implicit, which taught the app rather than the argument for it.
 * The CTAs still name the destination, because a button should say where it
 * goes; the step says why you would want to.
 */
const COPY: Record<MissionStepId, { label: string; hint: string; cta: string; blocked: string }> = {
  idea_created: {
    label: 'Capture an investment idea',
    hint: 'Put a real view into Tesseract so the reasoning has a starting point.',
    cta: 'Capture idea',
    blocked: '',
  },
  pipeline_advanced: {
    label: 'Develop the thesis',
    hint: 'Build the research and thinking that moves the idea toward a decision.',
    cta: 'Open Pipeline',
    blocked: 'Capture an investment idea first.',
  },
  simulation_completed: {
    label: 'Test the trade',
    hint: 'See how the proposed trade changes the portfolio before you act.',
    cta: 'Open Trade Lab',
    blocked: 'Develop the thesis first.',
  },
  decision_submitted: {
    label: 'Make the decision',
    hint: 'Record what you decided and why.',
    cta: 'Decide',
    blocked: 'Test the trade first.',
  },
  outcome_reviewed: {
    label: 'Close the loop',
    hint: 'Review what happened afterward, and what Tesseract remembers about the decision.',
    cta: 'Review outcome',
    blocked: 'Make the decision first.',
  },
}

export function missionState(facts: MissionFacts): MissionState {
  /*
   * An id pointing at nothing is not progress.
   *
   * Every later step reads against this idea, so if it has gone the mission
   * has to start again rather than sit on four steps it cannot evaluate. That
   * is the whole recovery rule: one condition, and it falls out of the data.
   */
  const hasIdea = !!facts.tutorialIdeaId && facts.ideaExists

  const done: Record<MissionStepId, boolean> = {
    idea_created: hasIdea,
    pipeline_advanced: hasIdea && isPipelineAdvanced(facts.ideaStage),
    /*
     * A simulation_trades row, OR anything downstream of one.
     *
     * Executing a trade DELETES its simulation_trades row — the trade has
     * left the simulation and become a committed trade, and the execute
     * service bulk-deletes the rows it committed. So the artifact this step
     * was reading disappears at the exact moment the step's purpose is most
     * thoroughly fulfilled, and the mission regressed: a pilot who had just
     * executed was sent back to "Test the trade — Open Trade Lab", because
     * `currentStepId` is the first step that is not done.
     *
     * A decision on the idea is proof the trade was tested, not evidence
     * against it. The step is monotonic now: the transient artifact still
     * completes it, and the durable one keeps it complete.
     */
    simulation_completed: hasIdea && (facts.hasSimulationTrade || facts.hasDecision),
    decision_submitted: hasIdea && facts.hasDecision,
    outcome_reviewed: hasIdea && !!facts.outcomeReviewedAt,
  }

  const steps: MissionStep[] = MISSION_STEP_IDS.map((id, i) => {
    const prev = i === 0 ? null : MISSION_STEP_IDS[i - 1]
    // Available once its prerequisite is met, and a completed step stays
    // available so it can be revisited.
    const available = i === 0 || done[prev!] || done[id]
    return {
      id,
      label: COPY[id].label,
      hint: COPY[id].hint,
      cta: COPY[id].cta,
      done: done[id],
      available,
      blockedBy: available ? null : COPY[id].blocked,
    }
  })

  const completedCount = steps.filter(s => s.done).length
  return {
    steps,
    completedCount,
    total: MISSION_STEP_IDS.length,
    complete: completedCount === MISSION_STEP_IDS.length,
    currentStepId: steps.find(s => !s.done)?.id ?? null,
    tutorialIdeaId: hasIdea ? facts.tutorialIdeaId : null,
  }
}

/** Per-org key for the tutorial idea id. Same shape as every other pilot key. */
export const tutorialIdeaKey = (orgId: string | null) => `tutorial_idea_id_${orgId || 'no-org'}`

/** Per-org key for the one step that cannot be derived. */
export const tutorialOutcomeReviewedKey = (orgId: string | null) =>
  `tutorial_outcome_reviewed_at_${orgId || 'no-org'}`
