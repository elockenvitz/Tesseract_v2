import type { SignalType } from './contract'
import { DAY_MS } from './thresholds'

/**
 * What an answer MEANS for whether the issue is still open.
 *
 * ── Acknowledgment is not resolution ──────────────────────────────────────
 *
 * This is the whole reason the module exists. A reader who taps "Cases
 * outdated" has looked at the card, understood it, and told us the framework
 * is stale. Nothing about the investment changed. Treating that as resolution
 * would delete the only record that the gap is real, and the surface would
 * congratulate itself for raising something and then remove the reminder.
 *
 * Equally, a reader who taps "Needs review" must not be punished for engaging
 * by having the card pinned to the top of tomorrow's feed. Answering has to
 * buy some quiet, or the rational move is to stop answering.
 *
 * So every judgment produces two separate outputs, and they are genuinely
 * different questions:
 *
 *   - `resolves`  — is the underlying issue closed?
 *   - `quietFor`  — how long has the reader bought before it may return?
 *
 * "Cases outdated" is `resolves: false` with a week of quiet. "Thesis intact"
 * is a real answer to the question asked, and gets a long one.
 *
 * ── Why this is not derived from the legacy disposition ───────────────────
 *
 * Phase 3 deliberately separated the semantic key from `settled`/`flagged`/
 * `rejected`, and this must not quietly undo that. Those three cannot express
 * the distinction above: `scenario_thesis_intact` and `target_revise` are both
 * ordinary answers that land on opposite sides of it, and `flagged` covers
 * "cases outdated", "needs review", "revise target" and "needs update" alike.
 *
 * The legacy kind remains the fallback for pre-Phase-3 records, which carry no
 * semantic key at all. Classifying those is guessing, so they get the neutral
 * treatment rather than an invented category.
 *
 * ── Pure, and deliberately so ─────────────────────────────────────────────
 *
 * No storage, no clock of its own, no Supabase. `now` is a parameter so the
 * tests and the gallery can put a judgment at a known age, and so the same
 * module can run in the gallery entry, which has no Supabase env.
 */

export type JudgmentCategory =
  /**
   * The reader reviewed the issue and says the recorded view stands.
   * A real answer to the question asked, and the strongest thing they can say.
   */
  | 'confirmed'
  /**
   * Seen, understood, and explicitly still open. The reader agrees something
   * needs doing and has not done it yet.
   */
  | 'action_needed'
  /**
   * Seen, and explicitly undecided. Weaker than `action_needed`: the reader has
   * not even concluded that action is required, so it comes back sooner.
   */
  | 'needs_review'
  /**
   * The card asked the wrong question, or asked the wrong person. Not a
   * judgment about the investment at all.
   */
  | 'not_applicable'
  /**
   * A pre-Phase-3 record, or a key this module has never been taught. Neutral
   * by construction — see `POLICY`'s note on why guessing is worse.
   */
  | 'unknown'

export interface JudgmentPolicy {
  category: JudgmentCategory
  /**
   * Whether the underlying investment issue is closed by this answer.
   *
   * Almost always false. Only `not_applicable` answers that genuinely settle
   * the question the card asked set this — and even then the issue is closed
   * for THIS signal, not for the position. See `not_price_driven`.
   */
  resolves: boolean
  /** Days of quiet the answer buys before the card may return. */
  quietDays: number
  /**
   * How much to de-prioritise the card once it does return, 0–1.
   *
   * Not the same as quiet. After the cooldown the issue is genuinely unresolved
   * and belongs back in the feed, but a reader who has already seen and
   * answered it should not be shown it ahead of something they have never seen.
   * A standing penalty says "still open, already acknowledged".
   */
  penalty: number
}

/**
 * The vocabulary, classified rather than translated.
 *
 * Every key the mobile surface can currently write is listed. A key that is
 * absent falls to `unknown` and is treated neutrally, which is the honest
 * outcome: inferring a category from the shape of a key name would produce a
 * confident wrong answer that looks exactly like a real one, and the failure
 * would be silent. `judgment-policy.test.ts` asserts that every key the app
 * writes appears here, so adding an option to a card without deciding what it
 * means fails a test rather than degrading quietly.
 *
 * Quiet periods are deliberately coarse — 3, 7, 30, 180 days. They are product
 * hypotheses about how long an answer stays true, not tuned parameters, and
 * pretending to more precision than that would be false.
 */
const POLICY: Record<string, JudgmentPolicy> = {
  // ── A. Confirmed / current ───────────────────────────────────────────────
  // The reader answered the question and the answer was "it still holds". They
  // should not be asked again for a good while; that is what makes answering
  // worth doing.
  scenario_thesis_intact:  { category: 'confirmed', resolves: false, quietDays: 30, penalty: 0.6 },
  target_still_valid:      { category: 'confirmed', resolves: false, quietDays: 30, penalty: 0.6 },
  change_accounted_for:    { category: 'confirmed', resolves: false, quietDays: 30, penalty: 0.6 },
  hold_as_is:              { category: 'confirmed', resolves: false, quietDays: 30, penalty: 0.6 },
  sized_right:             { category: 'confirmed', resolves: false, quietDays: 30, penalty: 0.6 },
  active_thesis:           { category: 'confirmed', resolves: false, quietDays: 30, penalty: 0.6 },
  priced_in:               { category: 'confirmed', resolves: false, quietDays: 14, penalty: 0.5 },
  agree:                   { category: 'confirmed', resolves: false, quietDays: 14, penalty: 0.5 },
  answered:                { category: 'confirmed', resolves: true,  quietDays: 30, penalty: 0.6 },
  done:                    { category: 'confirmed', resolves: true,  quietDays: 30, penalty: 0.6 },

  // ── B. Acknowledged, action needed ───────────────────────────────────────
  // Seen and agreed, nothing fixed. A week of quiet, then back — because the
  // condition that produced the card is still exactly as it was.
  scenario_cases_outdated:   { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  scenario_thesis_weaker:    { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  target_revise:             { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  revise_target:             { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  target_replace_with_cases: { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  view_needs_update:         { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  view_stale:                { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  needs_work:                { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  reunderwrite:              { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  size_wrong:                { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  reduce_exit:               { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  trim:                      { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  add:                       { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  price_target:              { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  case_framework:            { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  thesis_relevant:           { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  in_progress:               { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },

  // Idea and pair responses. Classified when the Mobile Ideas V2 vocabulary was
  // introduced — before this, `back_pair` and its siblings fell to `unknown`,
  // which meant answering a pair bought no quiet at all and the card returned
  // to the same position on the next load.
  idea_back:      { category: 'confirmed', resolves: false, quietDays: 14, penalty: 0.5 },
  pair_back:      { category: 'confirmed', resolves: false, quietDays: 14, penalty: 0.5 },
  idea_needs_work:{ category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  // "Right idea, wrong size" and "only one leg" are both agreement with the
  // relationship and disagreement with the expression — real work is needed,
  // and the reader has said what kind.
  pair_sizing:    { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },
  pair_one_leg:   { category: 'action_needed', resolves: false, quietDays: 7, penalty: 0.35 },

  // ── C. Needs review / uncertain ──────────────────────────────────────────
  // Weaker than B — the reader has not concluded anything yet — so it comes
  // back sooner and is penalised less once it does.
  scenario_needs_review: { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },
  target_needs_review:   { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },
  needs_review:          { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },
  discussion_warranted:  { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },
  // "Not now" is an explicit deferral rather than an opinion about the
  // investment: the reader has decided the question is fair and does not want
  // it today. Longer quiet than the other three, because coming back in three
  // days is exactly what they declined.
  not_now:               { category: 'needs_review', resolves: false, quietDays: 14, penalty: 0.3 },
  questions:             { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },
  disagree:              { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },
  defer:                 { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },
  idea_discuss:          { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },
  // Disagreeing with the relationship is a view about the investment, not a
  // deferral — but it is not a settled question either, so it comes back.
  pair_no:               { category: 'needs_review', resolves: false, quietDays: 3, penalty: 0.2 },

  // ── D. Not applicable / process explanation ──────────────────────────────
  // These do not share a behaviour and must not be given one. Each says
  // something different about why the card was the wrong thing to show.
  //
  // The reader has stated that a price target is not their framework for this
  // name. The no-target card asked "how is this being valued" and got a real
  // answer, so it resolves — for that signal. It says nothing about whether the
  // position has a complete recorded framework, and the product has no field to
  // put an alternative in yet. Long quiet, because re-asking a question the
  // reader has already answered is the definition of nagging.
  not_price_driven:  { category: 'not_applicable', resolves: true, quietDays: 180, penalty: 1 },
  legacy_position:   { category: 'not_applicable', resolves: true, quietDays: 180, penalty: 1 },
  // Not resolved, relocated. The gap is real and somebody else owns it; this
  // reader should not keep seeing it, but the issue is not closed.
  no_longer_covered: { category: 'not_applicable', resolves: false, quietDays: 180, penalty: 1 },
  not_mine:          { category: 'not_applicable', resolves: false, quietDays: 180, penalty: 1 },
  // "Not for me" says nothing about whether the desk should do it, so it stops
  // asking THIS reader without closing the idea.
  idea_pass:         { category: 'not_applicable', resolves: false, quietDays: 30, penalty: 0.8 },
  owned_elsewhere:   { category: 'not_applicable', resolves: false, quietDays: 180, penalty: 1 },
  // ── E. Triage ────────────────────────────────────────────────────────────
  //
  // Not answers to the card's question at all — answers to "do I want this on
  // my screen". They live here rather than in a store of their own because the
  // feed already HAS one mechanism for "stop showing me this for a while", and
  // a second one would mean two rules over one surface disagreeing about how
  // long an answer lasts. That divergence is exactly what this phase removed:
  // `renderCard` used to apply `isDisposedOf`'s 90-day window on top of the
  // policy window below, so a card could be admitted by the ranking and then
  // render nothing, leaving a blank screen in a snap feed.
  //
  // Neither resolves anything. The reader has said nothing about the
  // investment, so the finding is still open and comes back when the quiet
  // runs out — which is what makes Snooze honest rather than a soft delete.
  //
  // The quiet periods ARE the button labels. "Snooze for a week" is seven days
  // because the button says a week; changing one without the other would make
  // the control lie.
  feed_snoozed:   { category: 'needs_review', resolves: false, quietDays: 7, penalty: 0.25 },
  // Longer, because dismissing is a stronger statement than deferring — and
  // still not permanent, because `Dismiss` says nothing about whether the
  // finding was worth raising. That claim has its own vocabulary in the
  // overflow menu's feedback section; see lib/signals/feed-feedback.
  feed_dismissed: { category: 'needs_review', resolves: false, quietDays: 30, penalty: 0.5 },

  // A judgment about the FEED wearing investment clothes: the reader is saying
  // the card was not worth the screen. Phase 6B moved that vocabulary to the
  // overflow menu, but this key predates it and is still writable.
  attention_misplaced: { category: 'not_applicable', resolves: false, quietDays: 30, penalty: 0.8 },
}

/** Neutral treatment. Applied to old records and to keys nobody has classified. */
const UNKNOWN: JudgmentPolicy = {
  category: 'unknown', resolves: false, quietDays: 0, penalty: 0,
}

/** Every key this module knows. Exported so a test can compare it to the app. */
export const CLASSIFIED_JUDGMENT_KEYS = Object.keys(POLICY)

export function policyForJudgment(key: string | null | undefined): JudgmentPolicy {
  if (!key) return UNKNOWN
  return POLICY[key] ?? UNKNOWN
}

/** The stored judgment, reduced to what ranking actually needs. */
export interface JudgmentRecord {
  /** The semantic key. Absent on pre-Phase-3 records. */
  key?: string | null
  /** Legacy kind. Fallback only. */
  kind?: 'settled' | 'flagged' | 'rejected' | null
  /** Epoch ms the judgment was recorded. */
  at: number
}

export interface AcknowledgmentState {
  /** Hide the card entirely: the reader has bought quiet and it has not run out. */
  suppressed: boolean
  /** Standing de-prioritisation once it returns, 0–1. Zero when never answered. */
  penalty: number
  category: JudgmentCategory
  /** Whether the answer closed the issue, as opposed to merely acknowledging it. */
  resolved: boolean
  /** When the quiet runs out, for debugging and for the gallery. */
  quietUntil: number | null
}

const NEVER_ANSWERED: AcknowledgmentState = {
  suppressed: false, penalty: 0, category: 'unknown', resolved: false, quietUntil: null,
}

/**
 * What a stored judgment means for this card, right now.
 *
 * The resurfacing policy in one function, and deliberately no more than that:
 * the feed is evaluated when it loads, so "resurface after N days" is a
 * comparison against `at` and needs no scheduler, no job and no extra state.
 *
 * Note what is NOT here. Nothing checks whether the reader actually fixed the
 * underlying problem, because nothing needs to: eligibility is recomputed from
 * live data every time the feed is built, so a name whose cases were updated
 * stops producing a card on its own. Judgment state can only ever suppress a
 * card that the data still says is real — it can never keep one alive.
 */
export function acknowledgmentFor(
  record: JudgmentRecord | null | undefined,
  now: number,
): AcknowledgmentState {
  if (!record) return NEVER_ANSWERED

  const policy = policyForJudgment(record.key)

  // Pre-Phase-3 records carry no semantic key. The legacy kind is all there is,
  // and it is the fallback rather than the rule — see the header. `flagged` is
  // deliberately not suppressed, matching `isDisposedOf`: the reader said the
  // finding is real and needs work.
  if (policy.category === 'unknown' && record.kind) {
    const legacyQuiet = record.kind === 'flagged' ? 0 : 30
    const until = record.at + legacyQuiet * DAY_MS
    return {
      suppressed: legacyQuiet > 0 && now < until,
      penalty: record.kind === 'flagged' ? 0.2 : 0.5,
      category: 'unknown',
      resolved: false,
      quietUntil: legacyQuiet > 0 ? until : null,
    }
  }

  if (policy.category === 'unknown') return NEVER_ANSWERED

  const quietUntil = record.at + policy.quietDays * DAY_MS
  const stillQuiet = now < quietUntil

  return {
    suppressed: stillQuiet,
    // Once the quiet has run out the issue is genuinely open again, but the
    // reader has still seen it. The penalty persists; the suppression does not.
    penalty: policy.penalty,
    category: policy.category,
    resolved: policy.resolves,
    quietUntil,
  }
}

/**
 * Signals a `not_applicable` answer should be read as covering.
 *
 * `not_price_driven` answers the no-target card's actual question, so it
 * resolves that signal. It does not say the name has a complete framework, so
 * it must not silence a scenario gap or a target breach on the same position —
 * those ask entirely different questions and the reader has not answered them.
 *
 * Kept as data rather than as a condition inside the ranking code so the scope
 * of a resolution is visible in one place.
 */
export const RESOLUTION_SCOPE: Partial<Record<string, SignalType[]>> = {
  not_price_driven: ['no_target'],
  legacy_position: ['no_target', 'no_research'],
}

/**
 * Whether a judgment has anything to say about the signal being ranked.
 *
 * Returns true for keys with no declared scope: a judgment is stored against
 * `{type}:{entityId}`, so it is already about this signal type unless the scope
 * table narrows it.
 *
 * Gating the WHOLE judgment on this, rather than only its `resolves` flag, is
 * the fix for a leak a test caught: `not_price_driven` buys 180 days of quiet,
 * and applying that quiet to a scenario gap would let one answer about
 * valuation method silence a price that has left the ladder. Production keys
 * cannot currently collide this way — the store is keyed by type — but a
 * function that only behaves when its caller looks things up a particular way
 * is a trap for whoever wires the next surface.
 */
export function judgmentApplies(key: string | null | undefined, type: SignalType): boolean {
  if (!key) return false
  const scope = RESOLUTION_SCOPE[key]
  if (!scope) return true
  return scope.includes(type)
}

// ─────────────────────────────────────────────────────────────────────────────
// Which durable judgments count as engagement with an asset's CASE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The card types whose judgment is an answer about the investment case.
 *
 * Exactly the two the Research family emits. Everything else that can be
 * answered on an asset — a target, a scenario ladder, a proposed trade, a news
 * story — is a different question, and answering it says nothing about whether
 * the written case still holds.
 */
export const RESEARCH_CASE_SIGNAL_TYPES: readonly SignalType[] = ['research_stale', 'no_research']

/**
 * Whether a durable `record_judgment` row is engagement with the CASE.
 *
 * ── The leak this closes ──────────────────────────────────────────────────
 *
 * `audit_events` rows are selected by `action_type='record_judgment'` and
 * `entity_type='asset'`. That pair does not identify a family: `applyVerdict`
 * is the single writer for the whole mobile feed, and `isDurableEntity` admits
 * ANY card whose entity is an asset — 22 of the registered types. So a judgment
 * on a target, a scenario gap, a recommendation, a colleague's trade idea or a
 * news story all land in the same query as a judgment on a case.
 *
 * Left unfiltered, answering "Is this target still your view?" would advance
 * the review anchor of the CASE — and the Research card saying the case has not
 * accounted for a 25% move would disappear, silenced by an answer to a question
 * about a price target. Two different questions, and the wrong one wins.
 *
 * Not hypothetical: the only `record_judgment` row in production today is a
 * `target_expired` judgment on GOOGL, by the same user, in the same
 * organisation, with `judgment_intent: 'judgment'`.
 *
 * ── Why `card_surface` is NOT the discriminator ───────────────────────────
 *
 * It is the obvious candidate and it is wrong. `card_surface` is the contract's
 * `Surface` — the accent rail — and `research` there means "a machine
 * observation about the written record" broadly. That production `target_expired`
 * row carries `card_surface: 'research'`, as do `scenario_gap` and
 * `recommendation`. Filtering on it would admit exactly the rows this exists to
 * exclude, while looking correct.
 *
 * `signal_type` is `card.type`, the discriminated member itself, and is the
 * only field in the metadata that names the family without ambiguity.
 *
 * ── Fails closed ──────────────────────────────────────────────────────────
 *
 * A row with no `signal_type` is rejected rather than admitted. We cannot show
 * it was a case judgment, and the cost of a false positive — a Research card
 * silently suppressed for 90 days by an unrelated answer — is worse than the
 * cost of a false negative, which is one repeated card.
 */
export function isResearchCaseJudgment(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const m = metadata as Record<string, unknown>

  /**
   * A feed-quality tap is not a claim about the investment.
   *
   * `feed_not_useful` and `feed_wrong_person` say something about the CARD.
   * Letting them advance the anchor would mean telling the product its card was
   * bad silently marked the case as looked at. Rows written before the field
   * existed carry no intent and are read as judgments, which is what they were.
   */
  if (m.judgment_intent === 'feed_quality') return false

  return RESEARCH_CASE_SIGNAL_TYPES.includes(m.signal_type as SignalType)
}

/**
 * Whether a Research judgment is a COMPLETED review of the case.
 *
 * ── Why family scope was not enough ───────────────────────────────────────
 *
 * `isResearchCaseJudgment` answers "was this about the case". It does not
 * answer "did the reader finish looking". Those are different questions, and
 * conflating them is what let an explicit *"Need to review properly"* advance
 * the review clock — a response whose entire content is that the review has
 * NOT happened. The card would then have been silenced by the reader saying
 * they still needed to look at it.
 *
 * ── `confirmed`, and nothing else ─────────────────────────────────────────
 *
 * The categories this module already declares answer the question exactly, and
 * are reused rather than restated:
 *
 *   `confirmed`      the reader evaluated the condition and says the recorded
 *                    view stands. This IS "reviewed, unchanged" — the one thing
 *                    the product could never record, and the reason the durable
 *                    read exists at all. ADVANCES.
 *
 *   `action_needed`  seen, agreed something needs doing, not done. The review
 *                    reached a conclusion and the WORK is outstanding — see the
 *                    note on `view_needs_update` below. DOES NOT ADVANCE.
 *
 *   `needs_review`   seen, explicitly undecided. DOES NOT ADVANCE.
 *
 *   `not_applicable` "the card asked the wrong question, or the wrong person".
 *                    Not a judgment about the investment at all, so it cannot
 *                    be a review of one. These already buy 180 days of quiet
 *                    through `acknowledgmentFor`, so nothing regresses by
 *                    excluding them here — and including them would reset the
 *                    STALE clock on a case whose owner just said they do not
 *                    cover it. DOES NOT ADVANCE.
 *
 *   `unknown`        a key this module has never been taught. Fails closed.
 *
 * ── Why `view_needs_update` is excluded, deliberately ─────────────────────
 *
 * It is the closest call, and the argument settles it: its own `nextAction` is
 * `update_thesis`. Advancing the clock would hide a card whose stated next step
 * is "update the case" — and it would come back after its seven quiet days
 * stripped of its reason, because the evidence would now count as answered and
 * the move would be measured from the judgment. A card that returns saying less
 * than it did is worse than one that returns saying the same thing. It stays
 * outstanding until somebody actually edits the case, which moves
 * `caseWrittenAt` on its own.
 */
export function completesResearchReview(
  signalType: string | null | undefined,
  judgmentKey: string | null | undefined,
): boolean {
  if (!signalType || !RESEARCH_CASE_SIGNAL_TYPES.includes(signalType as SignalType)) return false
  if (!judgmentKey) return false
  return policyForJudgment(judgmentKey).category === 'confirmed'
}

/**
 * The durable form: both scopes, read off one `audit_events` metadata blob.
 *
 * Family AND outcome. `isResearchCaseJudgment` still carries the family test
 * and the `feed_quality` exclusion, so the two predicates cannot drift apart
 * about what counts as Research.
 */
export function isCompletedResearchReview(metadata: unknown): boolean {
  if (!isResearchCaseJudgment(metadata)) return false
  const m = metadata as Record<string, unknown>
  return completesResearchReview(m.signal_type as string, m.judgment_key as string)
}
