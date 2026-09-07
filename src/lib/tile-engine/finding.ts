/**
 * A semantic finding: something true, worth someone's attention, and not a UI.
 *
 * ── The rule this file exists to enforce ──────────────────────────────────
 *
 *     A finding kind is NOT a tile component, and NOT a template.
 *
 * That sentence is the whole architecture. The product arrived at seven card
 * components because "target expired" was implemented as a thing that renders,
 * so the only way to say something new was to add another thing that renders.
 * Two families that ask the reader the same question drew different furniture,
 * and one family in two states could not draw differently at all.
 *
 * Here a finding says WHAT IS TRUE and WHAT IS AT STAKE. It does not name a
 * component, a pane, a height, a colour or a button. Presentation is resolved
 * downstream from the situation, the surface, the reader and the space — and
 * because the finding carries no presentation, the same finding can be a
 * one-line row on a workbench and a full attention tile on a phone without
 * either being a special case.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It does not rank. `stakes` carries the raw consequence inputs and hands them
 * to `lib/signals/feed-priority`, which stays the only thing in the product
 * allowed to decide what the reader meets first. See `importance.ts` — the
 * engine adapts to that scorer rather than replacing it.
 */

import type { Severity, SignalType } from '../signals/contract'
import type { ReaderQuestion } from '../signals/reader-question'
import type { CoverageRelevance } from '../signals/coverage-relevance'
import type { Fact } from './facts'

/**
 * What the engine can hold a finding about.
 *
 * A subset of `EntityKind`, and smaller on purpose: the engine composes by
 * subject identity, so every kind here must be something a reader would agree
 * is "one thing to think about". `market` is excluded because a CPI print is
 * not a subject anybody covers, and grouping two findings under it would
 * compose a situation nobody has.
 */
export type SubjectKind = 'asset' | 'portfolio' | 'project' | 'person'

export interface FindingSubject {
  kind: SubjectKind
  id: string
  name: string
  ticker?: string
}

/** A subject's composition key. Two findings agree iff this string agrees. */
export const subjectKey = (s: FindingSubject): string => s.kind + ':' + s.id

/**
 * The shape of the claim, independent of the words used to say it.
 *
 * Six predicates cover every canonical situation, and that is not a
 * coincidence — a finding is always one of: a thing ran out, a thing left its
 * band, a thing moved without being looked at, a thing was never written, a
 * thing has no owner, or a thing is waiting on somebody. The predicate is what
 * lets the resolver pick a visual primitive without ever seeing a finding
 * kind: `expired` and `unowned` want a clock and a name respectively no matter
 * which domain produced them.
 */
export type FindingPredicate =
  /** A stated horizon has passed. */
  | 'expired'
  /** An observed value sits outside a band somebody wrote down. */
  | 'outside_band'
  /** Something changed and nobody has looked since. */
  | 'unreviewed'
  /** A required artefact was never created. */
  | 'absent'
  /** A real object has no responsible person. */
  | 'unowned'
  /** A decision is open and somebody is waiting on the reader. */
  | 'awaiting'

/** A number the claim turns on, with the units the reader thinks in. */
export interface Quantity {
  value: number
  unit: 'pct' | 'price' | 'days' | 'count'
  /** `good`/`bad` is the reader's frame, not the sign of the number. */
  direction?: 'good' | 'bad' | 'neutral'
}

/** A span the claim turns on. Both ends ISO; `to` may be in the past. */
export interface Interval {
  from: string
  to: string
}

export interface FindingClaim {
  predicate: FindingPredicate
  /** Present when the claim is numeric. Null when it is structural. */
  quantity?: Quantity | null
  /** Present when the claim is about elapsed time or a deadline. */
  interval?: Interval | null
  /**
   * The band the value left, where `predicate` is `outside_band`.
   *
   * Carried as numbers rather than as a rendered string so the resolver can
   * hand it to a range primitive. A card that prints "below the bear case"
   * has already thrown away the geometry the picture needs.
   */
  band?: { low: number; high: number; current: number; breachedLabel?: string } | null
  /**
   * How much of a required whole exists, where `predicate` is `absent`.
   *
   * ── Why an absence needs a shape ──────────────────────────────────────────
   *
   * "Nothing is written" and "two of three sections are written" are both
   * absences and they are not the same claim. The product already knows this
   * and says so twice: `researchIssueFor` separates `no_case` from
   * `incomplete_case`, and `buildInsightCard` refuses the capital reframe on
   * the second because "a partial view is still a view, and telling somebody
   * their capital has no thesis when two thirds of one is written would be
   * false".
   *
   * Generic on purpose. Any `absent` claim about a thing made of required
   * parts can fill it in, and the copy layer reads the ratio rather than
   * knowing which producer supplied it.
   */
  completeness?: { present: number; expected: number } | null
}

/**
 * The consequence inputs, in the scorer's own vocabulary.
 *
 * Named to match `PriorityInput` on purpose. The engine's job is to fill this
 * in honestly and hand it over; any field the engine invented would be a
 * second ranking model, and the stage brief forbids one.
 */
export interface FindingStakes {
  /** Position weight, where the subject carries one. */
  weightPct?: number | null
  held?: boolean
  /** Normalised deviation from the recorded framework, in percent. */
  deviationPct?: number | null
  overdueDays?: number | null
  /** What this subject is to this reader. */
  coverage?: CoverageRelevance
  /**
   * The producer's own strength for this finding within its type — carried,
   * never invented.
   *
   * ── Why the engine is allowed to pass a base at all ───────────────────────
   *
   * `importance.ts` refuses to supply one, on the grounds that the engine must
   * not describe its way up the feed. Adopting the Research producer showed the
   * rule was one word too broad: `rankInputFor` already passes
   * `base: researchBaseFor(i.issue)` for every insight, because one signal type
   * carries five framings and unanswered evidence genuinely outranks a long
   * silence. Withholding it would have moved every Research card in the feed.
   *
   * So the distinction is authorship, not the field. An adapter may carry a
   * base that production computed; nothing in the engine may compute one. A
   * test holds the line by asserting the reference builders never set it.
   */
  base?: number | null
}

/**
 * What the reader could do about it, as an intent rather than a button.
 *
 * The distinction matters because the same intent is a different control on
 * every surface: `revise_price_objective` is a sheet on a phone, an inline
 * editor on the workbench, and nothing at all in Explore, where the reader is
 * browsing rather than deciding. A finding that named a button would have to
 * be wrong on two of the three.
 */
export type ActionIntent =
  | 'revise_price_objective'
  | 'reaffirm_case'
  | 'record_judgment'
  | 'write_thesis'
  | 'review_evidence'
  | 'resize_position'
  | 'assign_coverage'
  | 'close_loop'
  | 'inspect_subject'

/**
 * The canonical situations this foundation proves.
 *
 * Six kinds, chosen because between them they exercise every predicate, every
 * subject kind that matters, both numeric and structural claims, and all three
 * surfaces. They are NOT the product's card taxonomy and are not meant to
 * become it — porting every existing family is the adoption step, deliberately
 * after the architecture is proven rather than as the proof.
 */
export type FindingKind =
  | 'target_expired'
  | 'case_price_dislocation'
  | 'unreviewed_move'
  | 'no_core_thesis'
  | 'coverage_gap'
  | 'decision_followup'

export interface SemanticFinding {
  id: string
  kind: FindingKind
  subject: FindingSubject
  /**
   * The question this finding contributes to, from the composer's vocabulary.
   *
   * Reused from `lib/signals/reader-question` rather than redeclared, because
   * the drift it was written to prevent — three card types, two categories,
   * one question — is exactly the drift a second vocabulary would reintroduce.
   */
  question: ReaderQuestion
  claim: FindingClaim
  /** The facts that constitute the claim, with their provenance. */
  facts: Fact[]
  stakes: FindingStakes
  /** ISO. When the underlying thing happened. */
  occurredAt: string
  /**
   * How loud the CLAIM is, not how high it ranks.
   *
   * Severity is a property of the finding — a target six months expired is
   * more severe than one expired last week regardless of position size.
   * Ranking multiplies it by consequence, and that happens elsewhere.
   */
  severity: Severity
  /**
   * The existing signal type this finding ranks as.
   *
   * The seam that preserves rankFeed sovereignty. The engine does not get to
   * invent a tier: it declares which of the product's existing types this
   * finding IS, and the existing `TIER` table decides the partition.
   */
  signalType: SignalType
  /** Ordered. The first is the one the reader is most likely to want. */
  intents: ActionIntent[]
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0, attention: 1, informational: 2,
}

/**
 * Which finding speaks for the subject when several are true at once.
 *
 * Precedence is by consequence-of-being-wrong, not by how recent or how loud:
 * a price outside the written band is a decision already overdue, while a
 * missing thesis is a gap that has been there for months and will still be
 * there tomorrow. Severity alone let an `informational` dislocation lose to an
 * `attention` documentation gap, which puts the wrong sentence at the top of a
 * briefing — so severity partitions and this orders within it.
 */
const KIND_PRECEDENCE: Record<FindingKind, number> = {
  case_price_dislocation: 0,
  target_expired: 1,
  decision_followup: 2,
  unreviewed_move: 3,
  no_core_thesis: 4,
  coverage_gap: 5,
}

/**
 * A stable, total order over findings within one subject.
 *
 * Used by the composer to pick which finding leads a situation. Deterministic
 * to the last tie-break for the same reason ranking is: two findings that swap
 * places between renders move the card under the reader's thumb, and no test
 * of composition could be trusted.
 */
export function compareFindings(a: SemanticFinding, b: SemanticFinding): number {
  const sa = SEVERITY_RANK[a.severity]
  const sb = SEVERITY_RANK[b.severity]
  if (sa !== sb) return sa - sb
  const ka = KIND_PRECEDENCE[a.kind]
  const kb = KIND_PRECEDENCE[b.kind]
  if (ka !== kb) return ka - kb
  const ta = new Date(a.occurredAt).getTime() || 0
  const tb = new Date(b.occurredAt).getTime() || 0
  if (ta !== tb) return tb - ta
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
