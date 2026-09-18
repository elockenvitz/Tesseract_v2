/**
 * What the Decisions lens holds, in three ranked classes.
 *
 * The lens asks "what did we decide, and what happened?". Answering only the
 * first half -- the unfinished work -- left a desk that had done its job
 * looking at an empty page with a line saying everything was complete. A
 * decision that was taken, executed and is now playing out is the second half
 * of the question, and it belongs here.
 *
 *   NEEDS ACTION    nobody has answered it; nobody recorded why; it was
 *                   approved and the execution has not been confirmed
 *   NEEDS REVISIT   it executed and the outcome has not been reviewed, or the
 *                   outcome has moved against the decision
 *   RECENT          committed, explained and reviewed -- the record of what
 *                   was just done, which fills the lens when little is owed
 *
 * Tier is a hard partition: every piece of work outranks every recent record,
 * whatever either carries. Inside a class the order is the existing one --
 * longest waiting for work, newest first for the record.
 *
 * ── Nothing is recomputed here ────────────────────────────────────────────
 *
 * "Reviewed", "hurting", the move since the decision and the dollar impact are
 * Outcomes' own answers, read through `lib/decision-intelligence` and the
 * accountability row it judges (`move_since_decision_pct`, `impact_proxy`).
 * This file decides which class a decision is in and nothing else: a second
 * definition of "is this outcome bad" is exactly the drift that makes two
 * surfaces disagree about the same trade.
 */

import type { DecisionRecord } from './model'
import {
  RESOLVED, outcomeOf, subjectOf, workOf, hasHumanReason, OUTCOME_LABEL,
  type DecisionWork,
} from './model'

export type DecisionClass = 'action' | 'revisit' | 'recent'

/** Why this decision is in its class, in the reader's words. */
export type DecisionReason =
  | 'decide'            // nobody has answered it
  | 'explain'           // answered, no human reason recorded
  | 'confirm'           // approved, execution not confirmed
  | 'review_outcome'    // executed, outcome never reviewed
  | 'outcome_moved'     // the outcome has gone against the decision
  | 'committed'         // done, explained, reviewed: the record

export const CLASS_LABEL: Record<DecisionClass, string> = {
  action: 'Needs action',
  revisit: 'Needs revisit',
  recent: 'Recent decisions',
}

export const REASON_LABEL: Record<DecisionReason, string> = {
  decide: 'Awaiting decision',
  explain: 'No reason recorded',
  confirm: 'Execution unconfirmed',
  review_outcome: 'Outcome not reviewed',
  outcome_moved: 'Moving against us',
  committed: 'Committed',
}

/**
 * The eyebrow's labels, each said at most once.
 *
 * ── Why this is a function and not three JSX spans ───────────────────────
 *
 * Three independent vocabularies land in the same eyebrow, and they overlap
 * on their most common values:
 *
 *   - `OUTCOME_LABEL[outcomeOf(status)]` -- where the request stands
 *   - `REASON_LABEL[situation.reason]`   -- why this card is in the lens
 *   - `facts.verdictLabel`               -- Outcomes' own words
 *
 * `OUTCOME_LABEL.open` and `REASON_LABEL.decide` are both the literal string
 * "Awaiting decision", so an undecided request printed it TWICE, side by
 * side. The same collision had already shipped once for an executed,
 * unreviewed decision, where the reason and the verdict are both "Outcome not
 * reviewed" -- it was patched inline on one of the two render paths, so the
 * other path kept the bug and the next collision was free to appear.
 *
 * Two labels being equal is not a coincidence to patch per pair: these maps
 * describe the same decision from three angles, so they AGREE whenever the
 * decision is unambiguous. Agreement is the normal case, and the eyebrow's job
 * is to say each distinct thing once, in priority order. Deduplicating at the
 * source means every render path gets it, and a fourth vocabulary cannot
 * reintroduce it.
 *
 * Case- and whitespace-insensitive, because these strings are styled uppercase
 * and the reader sees no difference between "Awaiting decision" and
 * "AWAITING DECISION".
 */
export type EyebrowRole = 'outcome' | 'reason' | 'verdict'

export interface EyebrowLabel {
  role: EyebrowRole
  text: string
  /**
   * Whether this label is the unreviewed state -- the one condition on a
   * committed record that asks the reader for something, and so the only one
   * the eyebrow tints. Survives dedupe: when the reason and the verdict are
   * the same words, the surviving label still carries the tint the verdict
   * would have had.
   */
  asksForReview: boolean
}

export function eyebrowLabels(
  d: DecisionRecord,
  situation: Pick<ClassedSituation, 'reason'>,
  facts: OutcomeFacts,
): EyebrowLabel[] {
  const verdict = facts.verdictLabel && !facts.reviewed ? facts.verdictLabel : null
  const candidates: { role: EyebrowRole; text: string | null }[] = [
    { role: 'outcome', text: OUTCOME_LABEL[outcomeOf(d.status)] },
    { role: 'reason', text: REASON_LABEL[situation.reason] },
    { role: 'verdict', text: verdict },
  ]

  const norm = (s: string) => s.trim().toLowerCase()
  const verdictKey = verdict ? norm(verdict) : null

  const out: EyebrowLabel[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    if (!c.text) continue
    const key = norm(c.text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ role: c.role, text: c.text, asksForReview: key === verdictKey })
  }
  return out
}

/** How recent a committed decision has to be to fill the lens. */
export const RECENT_DAYS = 60

/** However quiet the desk, the record does not become a feed. */
export const RECENT_LIMIT = 6

/**
 * What Outcomes already knows about this decision.
 *
 * Every field is read from an accountability row or from the verdict
 * `inferDecisionIntelligence` derives from it. Null means Outcomes does not
 * know either, and the lens says nothing rather than filling the gap.
 */
export interface OutcomeFacts {
  /** `move_since_decision_pct`, falling back to `move_since_execution_pct`. */
  sincePct: number | null
  /**
   * WHICH of those two `sincePct` actually is.
   *
   * The lens was labelling both "since the decision". A decision with no
   * captured snapshot price has no move since the decision, and the fallback
   * measures from the FILL -- a different, usually smaller number against a
   * later date. Saying "since the decision" over it is not a rounding
   * difference, it is the wrong claim, and it is the kind that costs trust
   * fastest because the reader can check it.
   */
  sinceBasis: 'decision' | 'execution' | null
  /**
   * Whether the price `sincePct` was measured TO carries a date.
   *
   * `lib/outcomes/current-price` prefers the newest dated close and falls back
   * to `assets.current_price`, which has no timestamp anywhere in the schema
   * and on this project was last written a month before the closes beside it.
   * That fallback is returned undated on purpose. A percentage measured to an
   * undated price is not a small error -- it is how MSFT's +0.8% was once
   * reported as -23.1% -- so the lens declines to lead with it.
   */
  sinceDated: boolean
  /** `impact_proxy`: the dollar P&L proxy, where the row carries one. */
  pnl: number | null
  /**
   * Outcomes' own words for where this decision stands, through
   * `phoneStatusLabel` -- "Outcome not reviewed", "Needs rationale",
   * "Hurting", "Working". One vocabulary for the whole product.
   */
  verdictLabel: string | null
  /** Outcomes counts it reviewed: executed, with its quality assessed. */
  reviewed: boolean
  /** Outcomes judges the move to have gone against the decision. */
  hurting: boolean
  /** The execution matched, so the outcome is a fact rather than a guess. */
  executed: boolean
}

export const NO_OUTCOME_FACTS: OutcomeFacts = {
  sincePct: null, sinceBasis: null, sinceDated: false,
  pnl: null, verdictLabel: null,
  reviewed: false, hurting: false, executed: false,
}

/**
 * Which class this record belongs to, and why.
 *
 * Null for history that asks nothing and is not recent -- a decision declined
 * eight months ago with a reason on it is the record's business, not the
 * lens's. `workOf` still owns the first two answers so the queue and this
 * cannot disagree about what is owed.
 */
export function classifyDecision(
  d: DecisionRecord, facts: OutcomeFacts, now: number = Date.now(),
): { klass: DecisionClass; reason: DecisionReason } | null {
  const work: DecisionWork | null = workOf(d)
  if (work === 'decide') return { klass: 'action', reason: 'decide' }
  if (work === 'explain') return { klass: 'action', reason: 'explain' }

  const accepted = outcomeOf(d.status) === 'accepted'

  /*
   * Approved, and the fill never came back.
   *
   * `execution.completedAt` is the only evidence the book and the intent
   * agree. An execution raised and never completed is unconfirmed whenever it
   * happened -- somebody started it and the book has not caught up.
   *
   * An approval with NO execution at all is only work while it is recent. An
   * eight-month-old approval nobody ever executed is not a fill anyone is
   * waiting to confirm; it is history, and queuing it would fill the lens
   * with acts no one intends to complete.
   */
  if (accepted && d.execution && !d.execution.completedAt) {
    return { klass: 'action', reason: 'confirm' }
  }
  if (accepted && !d.execution && isRecent(d, now)) {
    return { klass: 'action', reason: 'confirm' }
  }

  if (accepted && facts.executed) {
    if (facts.hurting) return { klass: 'revisit', reason: 'outcome_moved' }
    if (!facts.reviewed) return { klass: 'revisit', reason: 'review_outcome' }
  }

  // The record: what was committed lately, explained and reviewed.
  if (RESOLVED.has(d.status) && hasHumanReason(d) && isRecent(d, now)) {
    return { klass: 'recent', reason: 'committed' }
  }

  return null
}

/** Decided (or asked) inside the window the lens still calls recent. */
function isRecent(d: DecisionRecord, now: number): boolean {
  const at = Date.parse(d.decidedAt ?? d.requestedAt ?? '')
  return Number.isFinite(at) && (now - at) / 86_400_000 <= RECENT_DAYS
}

/** One situation per decision act, with its class. */
export interface ClassedSituation {
  /** `trade_batch:<id>` or `decision_request:<id>`. Stable across reloads. */
  subject: string
  klass: DecisionClass
  reason: DecisionReason
  /** The record that represents the act on a card. */
  lead: DecisionRecord
  /** Every leg of the act, in the order they were given. */
  legs: DecisionRecord[]
  /** The legs with no reason recorded -- what an `explain` card is asking. */
  owed: DecisionRecord[]
  batch: DecisionRecord['batch']
}

const CLASS_RANK: Record<DecisionClass, number> = { action: 0, revisit: 1, recent: 2 }

/**
 * Group into acts, classify, and rank.
 *
 * A batch is the decision container wherever the act was committed as one --
 * the same rule `groupIntoSituations` already applies to unexplained work,
 * extended to the classes that describe committed acts, because five trades
 * approved together are one thing that happened whether the question is "why"
 * or "how is it going". A pending request keeps its own identity: nothing in
 * a batch is still awaiting an answer.
 */
export function classifySituations(
  rows: readonly DecisionRecord[],
  factsFor: (d: DecisionRecord) => OutcomeFacts,
  now: number = Date.now(),
): ClassedSituation[] {
  const legsOf = new Map<string, DecisionRecord[]>()
  for (const d of rows) {
    if (!d.batch || !RESOLVED.has(d.status)) continue
    const key = subjectOf(d)
    const list = legsOf.get(key)
    if (list) list.push(d)
    else legsOf.set(key, [d])
  }

  const out: ClassedSituation[] = []
  const seen = new Set<string>()

  for (const d of rows) {
    const verdict = classifyDecision(d, factsFor(d), now)
    if (!verdict) continue
    const subject = subjectOf(d)

    // Unbatched, or an unanswered request: its own act.
    if (!d.batch || !RESOLVED.has(d.status)) {
      out.push({ ...verdict, subject, lead: d, legs: [d], owed: owedOf([d]), batch: d.batch })
      continue
    }

    if (seen.has(subject)) continue
    seen.add(subject)
    const legs = legsOf.get(subject) ?? [d]
    /*
     * The act takes the strongest class any of its legs is in.
     *
     * A batch where one leg is unexplained and three are fine is work, not a
     * record -- and showing it as a recent commitment would hide the ask.
     */
    let best = verdict
    for (const leg of legs) {
      const v = classifyDecision(leg, factsFor(leg), now)
      if (v && CLASS_RANK[v.klass] < CLASS_RANK[best.klass]) best = v
    }
    out.push({ ...best, subject, lead: d, legs, owed: owedOf(legs), batch: d.batch })
  }

  return out.sort(compareSituations)
}

const owedOf = (legs: readonly DecisionRecord[]) => legs.filter(l => !hasHumanReason(l))

/**
 * Class first, then the class's own order.
 *
 * Work is ordered by what has waited longest, because the oldest unanswered
 * question is the most overdue. The record is ordered newest first, because
 * the most recent commitment is the one a reader came to see.
 */
export function compareSituations(a: ClassedSituation, b: ClassedSituation): number {
  if (a.klass !== b.klass) return CLASS_RANK[a.klass] - CLASS_RANK[b.klass]
  const at = when(a), bt = when(b)
  if (at !== bt) return a.klass === 'recent' ? (at < bt ? 1 : -1) : (at < bt ? -1 : 1)
  return a.subject.localeCompare(b.subject)
}

const when = (s: ClassedSituation) =>
  (s.reason === 'decide' ? s.lead.requestedAt : s.lead.decidedAt) ?? s.lead.requestedAt ?? ''

/**
 * What the lens is holding, said once, from the classes actually present.
 *
 * Never a fixed blurb: a page of work and a page of recent commitments are
 * different answers to this lens's question, and the line should say which one
 * the reader is looking at.
 */
export function lensSentence(situations: readonly ClassedSituation[]): string {
  const n = (k: DecisionClass) => situations.filter(s => s.klass === k).length
  const action = n('action'), revisit = n('revisit'), recent = n('recent')
  const parts = [
    action ? `${action} ${action === 1 ? 'needs' : 'need'} action` : null,
    revisit ? `${revisit} worth revisiting` : null,
    recent ? `${recent} recently committed` : null,
  ].filter(Boolean)
  if (!parts.length) return 'Nothing is owed, and nothing has been committed lately.'
  return `${parts.join(' · ')}. Work first, then the record.`
}

/**
 * The lens's rows: every piece of work, and enough of the record to fill out
 * the page without turning it into a feed.
 */
export function selectForLens(
  situations: readonly ClassedSituation[], limit: number = RECENT_LIMIT,
): ClassedSituation[] {
  const work = situations.filter(s => s.klass !== 'recent')
  const recent = situations.filter(s => s.klass === 'recent')
  return [...work, ...recent.slice(0, limit)]
}
