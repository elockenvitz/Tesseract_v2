/**
 * The Idea Pipeline: one vocabulary, one order, one gate.
 *
 * ── What this file is for ─────────────────────────────────────────────────
 *
 * Before this module the pipeline had eleven stage values in two vocabularies,
 * nine independently-written copies of the stage order, two stage-to-maturity
 * maps that disagreed with each other, and the advance gate implemented three
 * times. Nothing was wrong with any single copy; the problem was that they
 * drifted, and a stage that two screens disagree about is not data.
 *
 * Everything about idea maturity now lives here. If you need to know the
 * stages, their order, their labels, or whether a move is allowed, import it
 * from this file rather than writing the list again.
 *
 * ── The one distinction this module exists to protect ─────────────────────
 *
 * The Idea Pipeline measures MATURITY — how well understood an idea is.
 * It ends at `ready_to_recommend`, and it ends there deliberately.
 *
 * What happens after that is DECISION WORKFLOW — a separate axis, owned by
 * `decision_requests` and surfaced in the Decision Inbox. Submitting a
 * recommendation, a PM reviewing it, accepting or rejecting it: none of those
 * are stages of an idea. They are things that happen TO a mature idea.
 *
 * The old `deciding` stage broke that line, and the breakage was visible in
 * production: an idea executed months ago still read `deciding`, because the
 * column records where the process GOT TO and nothing moves it back. Fifty-six
 * rows sat in `ready_for_decision` while their real decision state lived in a
 * `decision_requests` row nobody consulted.
 *
 * So: no `deciding`, no `pending_decision`, no `in_review` here. If you are
 * about to add a fifth stage, check first whether the thing you are modelling
 * is a fact about the idea or a fact about the decision. If it is the latter,
 * it belongs in `decision_requests.status`.
 */

/**
 * The four canonical stages, in order.
 *
 * Order matters: index position defines "forward", which defines which moves
 * are gated. Derive positions with `stageIndex` rather than re-stating the
 * list.
 */
export const IDEA_STAGES = [
  'exploring',
  'researching',
  'developing',
  'ready_to_recommend',
] as const

export type IdeaStage = (typeof IDEA_STAGES)[number]

const STAGE_SET: ReadonlySet<string> = new Set(IDEA_STAGES)

/** Narrowing guard. Accepts only the four canonical values. */
export function isIdeaStage(value: unknown): value is IdeaStage {
  return typeof value === 'string' && STAGE_SET.has(value)
}

export interface IdeaStageConfig {
  /** User-facing name. The only string a person should ever see for a stage. */
  label: string
  /** The question this stage answers. Shown as the stage's purpose. */
  question: string
  /** What an analyst actually does here. */
  description: string
  color: string
  iconColor: string
}

/**
 * Display configuration.
 *
 * `question` is not decoration. Each stage is defined by the question it
 * answers, and that is what makes two analysts place the same idea in the same
 * stage — the test the previous five-stage model failed. Keep it in the UI.
 */
export const IDEA_STAGE_CONFIG: Record<IdeaStage, IdeaStageConfig> = {
  exploring: {
    label: 'Exploring',
    question: 'Is this worth spending meaningful time on?',
    description:
      'Capture the idea, screen it, gather initial context, and decide whether it earns real research effort.',
    color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
    iconColor: 'text-sky-500',
  },
  researching: {
    label: 'Researching',
    question: 'What is actually true here?',
    description:
      'Read research, work through filings and data, run channel checks, and surface the evidence — including what conflicts.',
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    iconColor: 'text-yellow-500',
  },
  developing: {
    label: 'Developing',
    question: 'What do we think, and what should we do?',
    description:
      'Form the thesis and the variant perception, test assumptions, run scenarios, size it, and name the risks.',
    color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    iconColor: 'text-indigo-500',
  },
  ready_to_recommend: {
    label: 'Ready to Recommend',
    question: 'Am I prepared to formally advocate for an action?',
    description:
      'The work is done and the case is ready to put in front of a decision-maker. Submit the recommendation from here.',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    iconColor: 'text-amber-500',
  },
}

/** The user-facing label. Never render a raw stage value. */
export function stageLabel(stage: string): string {
  return isIdeaStage(stage) ? IDEA_STAGE_CONFIG[stage].label : stage
}

/**
 * Position in the pipeline, or -1 for anything unrecognised.
 *
 * Returning -1 rather than throwing is deliberate: callers compare positions
 * to decide whether a move is forward, and an unknown value must not be
 * treated as "further along than exploring".
 */
export function stageIndex(stage: string): number {
  return (IDEA_STAGES as readonly string[]).indexOf(stage)
}

/**
 * Is this move a promotion?
 *
 * Only forward moves are gated — an analyst who has over-promoted an idea must
 * always be able to move it back, and demanding a thesis in order to admit you
 * do not have one would be absurd.
 */
export function isForwardMove(from: string, to: string): boolean {
  const a = stageIndex(from)
  const b = stageIndex(to)
  return a >= 0 && b >= 0 && b > a
}

/** The stage before this one, or null at the start of the pipeline. */
export function previousStage(stage: IdeaStage): IdeaStage | null {
  const i = stageIndex(stage)
  return i > 0 ? IDEA_STAGES[i - 1] : null
}

/** The stage after this one, or null at `ready_to_recommend`. */
export function nextStage(stage: IdeaStage): IdeaStage | null {
  const i = stageIndex(stage)
  return i >= 0 && i < IDEA_STAGES.length - 1 ? IDEA_STAGES[i + 1] : null
}

/**
 * Where a newly created idea starts.
 *
 * Every creation path — quick capture, promote-from-thought, pair trades,
 * onboarding samples, Trade Lab ad-hoc inserts — writes this rather than a
 * literal. They each used to spell it `'idea'` or `'aware'`, which is how a
 * dozen creation paths were still emitting retired enum values after the
 * pipeline had four stages: nothing type-checks a string in an insert payload.
 */
export const INITIAL_STAGE: IdeaStage = 'exploring'

/** The end of the pipeline — where Submit Recommendation becomes available. */
export const FINAL_STAGE: IdeaStage = 'ready_to_recommend'

export function isFinalStage(stage: string): boolean {
  return stage === FINAL_STAGE
}

// ============================================================
// The gate
// ============================================================

/**
 * The shape the gate reads. Deliberately not the whole row — a gate that takes
 * an entire idea invites new conditions to be bolted on without anyone
 * noticing the requirements changed.
 */
export interface GateInput {
  rationale?: string | null
  thesis_text?: string | null
}

/**
 * What is missing before this idea can move to `targetStage`.
 * Empty array means the move is allowed.
 *
 * ── Only one boundary is gated, on purpose ────────────────────────────────
 *
 * `exploring → researching` and `researching → developing` are free. Those
 * moves say "I have decided this deserves more of my time" and "I understand
 * the situation well enough to start forming a view" — judgements only the
 * analyst can make. Gating them on document counts or completeness scores
 * would measure activity rather than understanding, and would train people to
 * generate artifacts to satisfy the gate.
 *
 * `developing → ready_to_recommend` is different. It asserts the work is ready
 * to be put in front of a decision-maker, and that claim is checkable: there
 * must be a thesis and there must be a reason to act now. This is the gate the
 * previous model already had at `ready_for_decision`, preserved rather than
 * re-invented.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────
 *
 * The old model had a second gate requiring an active recommendation before
 * entering `deciding`. That gate is gone with the stage: submitting a
 * recommendation is now an explicit action, not a stage transition, and
 * `submitRecommendation` validates its own package.
 */
export function missingForStage(idea: GateInput, targetStage: string): string[] {
  if (targetStage !== FINAL_STAGE) return []

  const missing: string[] = []
  if (!idea.rationale?.toString().trim()) missing.push('Why now (rationale)')
  if (!idea.thesis_text?.toString().trim()) missing.push('Trade thesis')
  return missing
}

/** Convenience wrapper. Same rules, boolean answer. */
export function canMoveToStage(idea: GateInput, targetStage: string): boolean {
  return missingForStage(idea, targetStage).length === 0
}

/** The error a blocked promotion raises. One message, one place. */
export function gateErrorMessage(targetStage: string, missing: string[]): string {
  return `Cannot move to ${stageLabel(targetStage)} — missing: ${missing.join(', ')}`
}

// ============================================================
// Legacy compatibility — TRANSITIONAL
// ============================================================

/**
 * TRANSITIONAL — the read half of the expand/contract rollout.
 *
 * ── Why this exists and when it can go ────────────────────────────────────
 *
 * The rollout is expand → deploy → contract. Between the expand migration and
 * the contract migration the database legitimately holds BOTH vocabularies at
 * once: rows written by the still-running old build carry legacy labels, rows
 * written by this build carry canonical ones. This map is what lets one
 * application read both without the rest of the codebase knowing.
 *
 * It outlives the contract migration by a while, for a reason that is not
 * about rollout at all: `previous_state` (jsonb, written when an idea is
 * deferred or trashed) stores the stage as free text and is NOT rewritten by
 * any migration. Restoring such a row can hand back a legacy label years
 * later. Removing this map is a separate cleanup, gated on that jsonb being
 * drained or normalised — not on the contract migration landing.
 *
 * The mapping is identical to `pg_temp.canonical_stage` in the contract
 * migration. If you change one, change both — `stage-model.test.ts` asserts
 * they agree, value for value.
 */
export const LEGACY_STAGE_MAP: Readonly<Record<string, IdeaStage>> = {
  // v2 five-stage vocabulary
  aware: 'exploring',
  investigate: 'researching',
  deep_research: 'developing',
  thesis_forming: 'developing',
  ready_for_decision: 'ready_to_recommend',

  // v1 vocabulary, never migrated off
  idea: 'exploring',
  discussing: 'developing',
  working_on: 'developing',
  modeling: 'developing',
  simulating: 'developing',

  // The stage that should never have been a stage. See the header.
  deciding: 'ready_to_recommend',
}

// ============================================================
// Maturity projection
// ============================================================

/**
 * The coarse maturity buckets two separate read models already used.
 *
 * `lib/desktop-ideas/model` and `lib/signals/idea-shape` each carried their own
 * stage-to-maturity table, and they disagreed: `working_on` was
 * `thesis_forming` in one and `researching` in the other, so the same idea got
 * a different pill on two screens. Both now project through this.
 *
 * Note `'deciding'` is no longer reachable from a stage, and that is the
 * point — whether a decision is underway is a fact about a `decision_requests`
 * row, not about the idea. The member is retained because removing it would
 * ripple through label maps and comparisons for no behavioural gain; it is
 * listed as follow-up work.
 */
export type IdeaMaturityBucket = 'researching' | 'thesis_forming' | 'decision_ready' | 'deciding'

export const STAGE_MATURITY: Readonly<Record<IdeaStage, IdeaMaturityBucket>> = {
  exploring: 'researching',
  researching: 'researching',
  developing: 'thesis_forming',
  ready_to_recommend: 'decision_ready',
}

/** Maturity for any stored stage value, legacy included. */
export function maturityForStage(raw: string | null | undefined): IdeaMaturityBucket {
  return STAGE_MATURITY[toIdeaStage(raw)]
}

/**
 * Is this idea waiting on somebody else?
 *
 * True only at the end of the pipeline. Note what this does NOT claim: that a
 * recommendation has actually been submitted. Maturity cannot answer that —
 * only a `decision_requests` row can.
 */
export function isAwaitingDesk(raw: string | null | undefined): boolean {
  return toIdeaStage(raw) === FINAL_STAGE
}

/**
 * THE normalization boundary. Every stage value read out of the database
 * passes through here, and nothing downstream of it sees a legacy label.
 *
 * Call it at the point a row enters the application — in the hook, mapper or
 * service that reads the column — never deep inside a component. The rule
 * this protects is that `IdeaStage` stays four values: the previous model had
 * eleven, in two vocabularies, with nine independently-written copies of the
 * order, and that is what made two screens disagree about the same idea.
 *
 * Unknown values fall back to `exploring` rather than throwing. A stage nobody
 * recognises means the idea's maturity is unknown, and the honest
 * representation of unknown maturity is the start of the pipeline — not a
 * blank card, and certainly not a crash on a screen full of other people's
 * ideas.
 *
 * Note what this is NOT: a cast. `as IdeaStage` on a legacy value would
 * silence the type error and leave `'deciding'` flowing through code that has
 * no branch for it.
 */
export function toIdeaStage(raw: string | null | undefined): IdeaStage {
  if (!raw) return 'exploring'
  if (isIdeaStage(raw)) return raw
  return LEGACY_STAGE_MAP[raw] ?? 'exploring'
}
