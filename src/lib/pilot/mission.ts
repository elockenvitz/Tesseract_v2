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
 * ── One stage per app ─────────────────────────────────────────────────────
 *
 *   1  Capture an investment idea   the idea is created
 *   2  Develop the thesis           Idea Pipeline — Pipeline basics finished
 *   3  Test the trade               Trade Lab — its last step, executing a trade
 *   4  Make the decision            Trade Book — Trade Book basics finished
 *   5  Close the loop               Outcomes — "Finish the loop" finished
 *
 * Each stage completes when that app's Getting Started is finished, so the
 * roadmap and the banner in front of the reader always agree about where they
 * are. (Stage 4 used to complete the moment a trade executed, which put the
 * roadmap on stage 5 while the reader was still doing Trade Book.)
 *
 * ── What each stage reads ─────────────────────────────────────────────────
 *
 * Durable records only, so a refresh or a second device agrees. Stage 1 is the
 * idea row; stage 3 the executed trade. Stages 2, 4 and 5 are server-backed
 * marks in `pilot_progress`, written as their app's Getting Started finishes —
 * reading and opening things writes nothing else that could stand in.
 *
 * The tutorial idea still anchors the journey: if it is gone, the mission
 * returns to step one.
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
  /** The tutorial idea's stage. Informational; no stage reads it. */
  ideaStage?: string | null
  /**
   * Stage 3 — Trade Lab's last step: the pilot executed a trade in this org
   * (an `accepted_trades` row they committed, on any idea).
   */
  hasExecutedTrade: boolean
  /** Stage 4 — `tradebook_basics_completed_at_<orgId>`: Trade Book basics finished. */
  tradeBookBasicsAt?: string | null
  /** Stage 5 — `tutorial_outcome_reviewed_at_<orgId>`: Outcomes' "Finish the loop" finished. */
  outcomeReviewedAt: string | null
  /**
   * The three Pipeline basics steps, from `pilot_progress`.
   *
   * Optional so a caller that has not read them is treated as not having done
   * them, never as having done them.
   */
  pipelineBasics?: PipelineBasics
}

/** Pipeline basics — move an idea, open the Decision Inbox, open Trade Lab. */
export interface PipelineBasics {
  moved: boolean
  inboxOpened: boolean
  tradeLabOpened: boolean
}

/*
 * Per-org keys for the Pipeline basics marks.
 *
 * Defined here, beside the rule that reads them, and imported by the writer in
 * `usePilotProgress`, so the step that is marked and the step the mission
 * checks cannot be spelled two ways.
 */
export const pipelineStepMovedKey = (orgId: string | null) => `pipeline_step_moved_at_${orgId || 'no-org'}`
export const pipelineStepInboxKey = (orgId: string | null) => `pipeline_step_inbox_at_${orgId || 'no-org'}`
export const pipelineStepTradeLabKey = (orgId: string | null) => `pipeline_step_tradelab_at_${orgId || 'no-org'}`

/** Read the three marks out of a `users.pilot_progress` object for one org. */
export function pipelineBasicsFromProgress(
  progress: Record<string, unknown> | null | undefined,
  orgId: string | null,
): PipelineBasics {
  const p = progress ?? {}
  return {
    moved: !!p[pipelineStepMovedKey(orgId)],
    inboxOpened: !!p[pipelineStepInboxKey(orgId)],
    tradeLabOpened: !!p[pipelineStepTradeLabKey(orgId)],
  }
}

export function pipelineBasicsComplete(b: PipelineBasics | undefined): boolean {
  return !!b && b.moved && b.inboxOpened && b.tradeLabOpened
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
 * The label says what each stage is FOR; the hint says which app it happens in
 * and what finishes it, in that app's own words; the CTA opens that app.
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
    hint: 'In Idea Pipeline: move an idea, open the Decision Inbox, then open Trade Lab.',
    cta: 'Open Pipeline',
    blocked: 'Capture an investment idea first.',
  },
  simulation_completed: {
    label: 'Test the trade',
    hint: 'In Trade Lab: add an idea, size it, and execute it.',
    cta: 'Open Trade Lab',
    blocked: 'Develop the thesis first.',
  },
  decision_submitted: {
    label: 'Make the decision',
    hint: 'In Trade Book: review the trade, add your rationale, then open Outcomes.',
    cta: 'Open Trade Book',
    blocked: 'Test the trade first.',
  },
  outcome_reviewed: {
    label: 'Close the loop',
    hint: 'In Outcomes: inspect the result, review why you made it, and check how it’s performing.',
    cta: 'Open Outcomes',
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

  // One stage per app, each done when that app's Getting Started is finished.
  const done: Record<MissionStepId, boolean> = {
    idea_created: hasIdea,
    // Idea Pipeline: move an idea, open the Decision Inbox, open Trade Lab.
    pipeline_advanced: hasIdea && pipelineBasicsComplete(facts.pipelineBasics),
    // Trade Lab: add, size, execute — executing is the last step, and it cannot
    // happen without the other two.
    simulation_completed: hasIdea && facts.hasExecutedTrade,
    // Trade Book: review the trade, add rationale, open Outcomes.
    decision_submitted: hasIdea && !!facts.tradeBookBasicsAt,
    // Outcomes: inspect the result, review why, check how it's performing.
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

/** Per-org key for stage 5: Outcomes' "Finish the loop" finished. */
export const tutorialOutcomeReviewedKey = (orgId: string | null) =>
  `tutorial_outcome_reviewed_at_${orgId || 'no-org'}`

/** Per-org key for stage 4: Trade Book basics finished. */
export const tradeBookBasicsKey = (orgId: string | null) =>
  `tradebook_basics_completed_at_${orgId || 'no-org'}`
