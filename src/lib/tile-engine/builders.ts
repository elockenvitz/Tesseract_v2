/**
 * Facts and events in, semantic findings out — the REFERENCE producers.
 *
 * ── Reference, and what that means once a real producer exists ────────────
 *
 * These build a finding from first principles, thresholds included, which is
 * what the six canonical situations needed in order to be exercised at all
 * before anything in the product spoke this language.
 *
 * `adopt/producers` is different and must stay different: it adapts the
 * shipping Mobile producers, and it takes every threshold and every severity
 * from THEM. Where a real producer exists it is the authority, and a builder
 * here is a fixture. Two answers to "is this name a problem" is precisely the
 * failure the engine was written to avoid, so the rule is one line long: a
 * situation adopted against real data is built by the adapter, never by this
 * file.
 *
 * ── Why the builders are here and not in the resolver ─────────────────────
 *
 * "A target expired 40 days ago" is domain knowledge. "40 days is worth
 * interrupting somebody about" is also domain knowledge. Neither is a
 * presentation decision, and the moment either leaks downstream the resolver
 * starts branching on what a finding MEANS rather than on what shape it is —
 * which is how a finding kind becomes a template again.
 *
 * So the valve runs one way, exactly as `lib/mobile/tile-requirement` runs its
 * own:
 *
 *     builders   know domain state, return SEMANTIC FINDINGS
 *     resolver   knows findings, returns a PLAN
 *
 * A builder may branch on anything it likes. It may never return a primitive,
 * a region, a density or a height. If a future reader finds `'timeline'` in
 * this file, the boundary has been broken.
 *
 * ── Thresholds are borrowed, not invented ─────────────────────────────────
 *
 * `lib/signals/thresholds` already carries the desk's numbers and they have
 * been argued over. A second set here would be a second product opinion about
 * what counts as material, visible to the reader as two surfaces disagreeing
 * about whether a name is a problem.
 */

import {
  MATERIAL_DEVIATION_PCT, SEVERE_DEVIATION_PCT,
} from '../signals/thresholds'
import type { Severity } from '../signals/contract'
import { daysBetween, type Fact } from './facts'
import type {
  FindingKind, FindingStakes, FindingSubject, SemanticFinding,
} from './finding'
import { SITUATION_DEFINITIONS } from './situations'

/**
 * Assemble a finding from its definition plus the parts only the caller knows.
 *
 * Every producer goes through here, so the invariants — the question, the
 * signal type, the predicate and the intent list all come from the declared
 * definition — cannot be sidestepped by a producer in a hurry. A producer that
 * wanted a different question would have to change the definition, which is a
 * visible decision rather than a quiet one.
 *
 * ── Why this is exported ──────────────────────────────────────────────────
 *
 * `adopt/producers` needs it. The reference builders below own their own
 * thresholds because they exist to exercise the architecture from fixtures;
 * the real producers must not own any, because production already decided
 * them and a second opinion would be visible to the reader as two surfaces
 * disagreeing about whether a name is a problem.
 *
 * Sharing the assembly and NOT the thresholds is what keeps that from becoming
 * two architectures: one place decides what a finding of a given kind IS, and
 * the caller supplies the numbers it is entitled to supply.
 */
export function assembleFinding(
  kind: FindingKind,
  parts: {
    id: string
    subject: FindingSubject
    claim: SemanticFinding['claim']
    facts: Fact[]
    stakes: FindingStakes
    occurredAt: string
    severity: Severity
  },
): SemanticFinding {
  const def = SITUATION_DEFINITIONS[kind]
  return {
    id: parts.id,
    kind,
    subject: parts.subject,
    question: def.question,
    claim: { ...parts.claim, predicate: def.predicate },
    facts: parts.facts,
    stakes: parts.stakes,
    occurredAt: parts.occurredAt,
    severity: parts.severity,
    signalType: def.signalType,
    intents: def.intents,
  }
}

/**
 * How loud a claim about elapsed time is.
 *
 * A quarter past the horizon is a different statement from a fortnight past
 * it, and the difference is in the CLAIM rather than in the ranking — a target
 * six months dead is severely wrong whether it sits on a 12% position or a 1%
 * one. Consequence is applied later, by the scorer, against the position.
 */
function severityFromAge(days: number): Severity {
  if (days >= 90) return 'critical'
  if (days >= 30) return 'attention'
  return 'informational'
}

/** How loud a claim about a deviation is. Borrowed thresholds, no new ones. */
function severityFromDeviation(pct: number): Severity {
  const abs = Math.abs(pct)
  if (abs >= SEVERE_DEVIATION_PCT) return 'critical'
  if (abs >= MATERIAL_DEVIATION_PCT) return 'attention'
  return 'informational'
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Target Expired
// ─────────────────────────────────────────────────────────────────────────────

export interface TargetExpiredInput {
  subject: FindingSubject
  /** The target row: what was stated, and the horizon its author gave it. */
  target: Fact<number>
  statedAt: string
  horizonAt: string
  stakes: FindingStakes
}

export function targetExpiredFinding(
  input: TargetExpiredInput, now: number,
): SemanticFinding | null {
  const overdue = daysBetween(input.horizonAt, now)
  if (overdue == null || overdue <= 0) return null

  return assembleFinding('target_expired', {
    id: `target_expired:${input.subject.id}`,
    subject: input.subject,
    claim: {
      predicate: 'expired',
      quantity: { value: overdue, unit: 'days', direction: 'bad' },
      interval: { from: input.statedAt, to: input.horizonAt },
    },
    facts: [input.target],
    stakes: { ...input.stakes, overdueDays: overdue },
    occurredAt: input.horizonAt,
    severity: severityFromAge(overdue),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Case vs Price / Scenario Dislocation
// ─────────────────────────────────────────────────────────────────────────────

export interface DislocationInput {
  subject: FindingSubject
  price: Fact<number>
  /** The modelled band, lowest and highest case. */
  low: number
  high: number
  /** The case the price is beyond, where the producer can name one. */
  breachedLabel?: string
  caseAsOf: string
  stakes: FindingStakes
}

export function dislocationFinding(
  input: DislocationInput, _now: number,
): SemanticFinding | null {
  const current = input.price.value
  const inside = current >= input.low && current <= input.high
  if (inside) return null

  /**
   * How far outside, as a percentage of the boundary it passed.
   *
   * Normalised by the caller's own band rather than by a price level, because
   * the scorer's `deviationPct` must mean the same thing across signal types —
   * its header says so, and a raw dollar gap would make a $900 stock look
   * permanently more urgent than a $9 one.
   */
  const bound = current > input.high ? input.high : input.low
  const deviationPct = bound === 0 ? 0 : ((current - bound) / Math.abs(bound)) * 100

  return assembleFinding('case_price_dislocation', {
    id: `dislocation:${input.subject.id}`,
    subject: input.subject,
    claim: {
      predicate: 'outside_band',
      quantity: { value: deviationPct, unit: 'pct', direction: 'bad' },
      band: {
        low: input.low, high: input.high, current,
        breachedLabel: input.breachedLabel,
      },
    },
    facts: [input.price],
    stakes: { ...input.stakes, deviationPct },
    occurredAt: input.price.asOf,
    severity: severityFromDeviation(deviationPct),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Unreviewed Move
// ─────────────────────────────────────────────────────────────────────────────

export interface UnreviewedMoveInput {
  subject: FindingSubject
  /** The move measured FROM the last review, in percent. */
  movePct: Fact<number>
  lastReviewedAt: string
  observedAt: string
  stakes: FindingStakes
}

export function unreviewedMoveFinding(
  input: UnreviewedMoveInput, _now: number,
): SemanticFinding | null {
  const move = input.movePct.value
  if (Math.abs(move) < MATERIAL_DEVIATION_PCT) return null

  return assembleFinding('unreviewed_move', {
    id: `unreviewed_move:${input.subject.id}`,
    subject: input.subject,
    claim: {
      predicate: 'unreviewed',
      quantity: { value: move, unit: 'pct', direction: move >= 0 ? 'good' : 'bad' },
      interval: { from: input.lastReviewedAt, to: input.observedAt },
    },
    facts: [input.movePct],
    stakes: { ...input.stakes, deviationPct: move },
    occurredAt: input.observedAt,
    severity: severityFromDeviation(move),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. No Core Thesis
// ─────────────────────────────────────────────────────────────────────────────

export interface NoCoreThesisInput {
  subject: FindingSubject
  /** The absence itself, as a fact with a vintage. See `AbsentFact`. */
  thesis: Fact<null>
  /** Sections a complete case carries, and how many exist. */
  sectionsWritten: number
  sectionsExpected: number
  stakes: FindingStakes
  observedAt: string
}

export function noCoreThesisFinding(
  input: NoCoreThesisInput, _now: number,
): SemanticFinding | null {
  if (input.sectionsWritten >= input.sectionsExpected) return null

  const missing = input.sectionsExpected - input.sectionsWritten
  /**
   * Capital without an argument is critical; an unheld name is a backlog item.
   *
   * The severity turns on `held` rather than on how many sections are missing,
   * because the reader's exposure is what makes the gap urgent. A watchlist
   * name with no thesis is simply a watchlist name.
   */
  const severity: Severity = input.stakes.held ? 'critical' : 'informational'

  return assembleFinding('no_core_thesis', {
    id: `no_core_thesis:${input.subject.id}`,
    subject: input.subject,
    claim: {
      predicate: 'absent',
      quantity: { value: missing, unit: 'count', direction: 'bad' },
    },
    facts: [input.thesis],
    stakes: input.stakes,
    occurredAt: input.observedAt,
    severity,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Portfolio / Coverage Gap
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverageGapInput {
  subject: FindingSubject
  /** Explicitly null: nobody is assigned. Not a missing lookup. */
  analyst: Fact<null>
  weightPct: number
  portfolioName?: string
  stakes: FindingStakes
  observedAt: string
}

/**
 * The weight below which "nobody has got to it yet" is a reasonable answer.
 *
 * Matches the bar the portfolio lenses already use for `no_target` and
 * `material_no_thesis`. Restating their number would be fine right up until
 * one of the three moved.
 */
export const COVERAGE_GAP_MIN_PCT = 2

export function coverageGapFinding(
  input: CoverageGapInput, _now: number,
): SemanticFinding | null {
  if (input.weightPct < COVERAGE_GAP_MIN_PCT) return null

  return assembleFinding('coverage_gap', {
    id: `coverage_gap:${input.subject.id}`,
    subject: input.subject,
    claim: {
      predicate: 'unowned',
      quantity: { value: input.weightPct, unit: 'pct', direction: 'neutral' },
    },
    facts: [input.analyst],
    stakes: { ...input.stakes, weightPct: input.weightPct, held: true },
    occurredAt: input.observedAt,
    severity: input.weightPct >= 5 ? 'attention' : 'informational',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Trade / Decision Follow-up
// ─────────────────────────────────────────────────────────────────────────────

export interface DecisionFollowupInput {
  subject: FindingSubject
  /** The decision that opened the loop. */
  decision: Fact<string>
  decidedAt: string
  /** The stages this kind of decision passes through, and where it stopped. */
  stages: string[]
  stageIndex: number
  stakes: FindingStakes
}

export function decisionFollowupFinding(
  input: DecisionFollowupInput, now: number,
): SemanticFinding | null {
  if (input.stageIndex >= input.stages.length - 1) return null

  const open = daysBetween(input.decidedAt, now) ?? 0

  return assembleFinding('decision_followup', {
    id: `decision_followup:${input.subject.id}:${input.decision.value}`,
    subject: input.subject,
    claim: {
      predicate: 'awaiting',
      quantity: { value: open, unit: 'days', direction: 'bad' },
    },
    facts: [input.decision],
    stakes: { ...input.stakes, overdueDays: open },
    occurredAt: input.decidedAt,
    severity: open >= 5 ? 'attention' : 'informational',
  })
}
