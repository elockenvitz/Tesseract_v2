/**
 * Old path against new path, on the axes that are allowed to be identical.
 *
 * ── What parity means here, and what it deliberately does not ─────────────
 *
 * The stage names four things that must agree for equivalent source data, and
 * one that may differ. Encoding that distinction in a type is the point: a
 * comparison that checked everything would fail on the copy, which is SUPPOSED
 * to change, and a comparison that checked nothing would pass while a card
 * quietly changed tier.
 *
 *   must agree   the situation is detected at all
 *                the essential metric value
 *                the user action intent
 *                the ranking input semantics
 *
 *   may differ   presentation — headline, body, context budget, evidence
 *                kind, action placement, the prompt
 *
 * ── Why this is a module and not a test ───────────────────────────────────
 *
 * Because it has to be runnable against real data. The tests below it use
 * fixtures, and fixtures prove the comparison works rather than proving the
 * production feed agrees. A pure comparator can be called from a dev-only
 * surface with the actual cards the phone just built, which is the only way to
 * find the case nobody thought to write a fixture for.
 *
 * Development only. Nothing on a reader's path calls this, and the flag that
 * exposes it is documented as temporary in `lib/flags`.
 *
 * Pure. No React, no clock — `now` is passed so two runs of the same data
 * compare identically.
 */

import type { SignalCard } from '../../signals/contract'
import {
  priorityFor, type Priority, type PriorityInput,
} from '../../signals/feed-priority'
import { situationPriorityInput } from '../importance'
import type { MobileAdoptionResult } from './mobile'

/** One axis of the comparison. */
export interface ParityCheck {
  axis: 'detection' | 'metric_value' | 'action_intent' | 'ranking_input'
  ok: boolean
  /** Old and new, as short strings a report can print side by side. */
  old: string
  next: string
  note?: string
}

export interface ParityReport {
  cardId: string
  /** True when every `must agree` axis agrees. */
  ok: boolean
  checks: ParityCheck[]
  /** Presentation differences, recorded and never failed on. */
  intended: { field: string; old: string; next: string }[]
}

/**
 * The number a card's decision turns on, stripped to digits.
 *
 * The same reduction `rankInputFor` performs on the scenario metric, applied
 * to both sides so the comparison is about the VALUE rather than about the
 * units, the sign or the surrounding words. "23%" and "23% below your lowest
 * case" are the same essential metric; "23%" and "8mo" are not.
 */
const essential = (v: string | null | undefined): string =>
  String(v ?? '').replace(/[^0-9.]/g, '')

/**
 * Which of the card's actions expresses the reader's intent.
 *
 * The PRIMARY, and only the primary. Placement is presentation and is expected
 * to move; what must not change is what the card is fundamentally asking the
 * reader to go and do. Comparing the whole action bar would fail on a button
 * moving from quick to menu, which is a decision the resolver is entitled to
 * make.
 */
const primaryIntent = (card: SignalCard): string => card.actions.primary.id

/**
 * Everything `rankFeed` reads, as one comparable string.
 *
 * `id` is excluded deliberately and is the one field allowed to differ: it is
 * the final tie-break in `compareRanked`, it is only ever compared against
 * other ids, and the projection preserves the card's own id anyway — so the
 * check would either be trivially true or, if it ever were not, would be
 * flagging a change this comparison has a better field for.
 */
const epochOrNull = (v: string | number | null | undefined): string => {
  if (v == null) return 'null'
  const t = typeof v === 'number' ? v : new Date(v).getTime()
  return Number.isFinite(t) ? String(t) : 'null'
}

function rankingShape(i: PriorityInput): string {
  return [
    `type=${i.type}`,
    `severity=${i.severity}`,
    /**
     * The instant, not the string that expressed it.
     *
     * The scorer converts `occurredAt` through `toEpoch` and treats null and an
     * unparseable value identically — both contribute no recency. Production
     * passes `null` for a case that was never written and the engine passes an
     * empty string, which is the same ranking input written two ways. Comparing
     * the raw field would fail on a difference the scorer cannot see.
     */
    `occurredAt=${epochOrNull(i.occurredAt)}`,
    `weightPct=${i.weightPct ?? 'null'}`,
    `held=${i.held ?? 'undefined'}`,
    `deviationPct=${i.deviationPct ?? 'null'}`,
    `overdueDays=${i.overdueDays ?? 'null'}`,
    `coverage=${i.coverage ?? 'undefined'}`,
    /**
     * Included since adoption B, because production supplies one.
     *
     * `rankInputFor` passes `base: researchBaseFor(i.issue)` for every Research
     * insight — the framing strength that orders unanswered evidence above a
     * long silence within a single signal type. It is worth 0.40 of the score,
     * the largest single weight in the model, so a comparison that ignored it
     * would pass while every Research card moved.
     */
    `base=${i.base ?? 'null'}`,
  ].join(' ')
}

/** The scorer's own verdict, for a report that wants to show the consequence. */
export function priorityOf(input: PriorityInput, now: number): Priority {
  return priorityFor(input, now)
}

export interface ParityInput {
  /** The card production built and would have rendered. */
  original: SignalCard
  /** What `rankInputFor` handed `rankFeed` for that card. */
  productionRankInput: PriorityInput
  /** The engine's answer for the same source data. */
  adoption: MobileAdoptionResult
}

export function compareParity(input: ParityInput): ParityReport {
  const { original, productionRankInput, adoption } = input
  const checks: ParityCheck[] = []
  const intended: ParityReport['intended'] = []

  // ── Detection ────────────────────────────────────────────────────────────
  if (!adoption.ok) {
    checks.push({
      axis: 'detection',
      /**
       * A declared decline is not a parity failure by itself.
       *
       * `not_an_attention_state` is the engine saying, in as many words, that
       * this card states nothing needs doing — `at_expected` is the live
       * example, and adoption B settled that it should not become a situation.
       * That is a semantic decision to report, not two implementations
       * disagreeing, and conflating the two would hide the real failures behind
       * a known one.
       */
      ok: adoption.reason === 'not_an_attention_state',
      old: `card ${original.type}`,
      next: `declined: ${adoption.reason}`,
      note: adoption.detail,
    })
    return { cardId: original.id, ok: adoption.reason === 'not_an_attention_state', checks, intended }
  }

  const { situation, card: next } = adoption.adoption

  checks.push({
    axis: 'detection',
    ok: situation.lead.signalType === original.type,
    old: original.type,
    next: situation.lead.signalType,
  })

  // ── Essential metric value ───────────────────────────────────────────────
  const oldMetric = essential(original.metric?.value)
  const newMetric = essential(next.metric?.value)
  checks.push({
    axis: 'metric_value',
    ok: oldMetric === newMetric,
    old: original.metric?.value ?? '(none)',
    next: next.metric?.value ?? '(none)',
    note: oldMetric === newMetric ? 'labels may differ; the number does not' : undefined,
  })

  // ── Action intent ────────────────────────────────────────────────────────
  checks.push({
    axis: 'action_intent',
    ok: primaryIntent(original) === primaryIntent(next),
    old: primaryIntent(original),
    next: primaryIntent(next),
  })

  // ── Ranking input semantics ──────────────────────────────────────────────
  const newRankInput = situationPriorityInput(situation)
  const oldShape = rankingShape(productionRankInput)
  const newShape = rankingShape(newRankInput)
  checks.push({
    axis: 'ranking_input',
    ok: oldShape === newShape,
    old: oldShape,
    next: newShape,
  })

  // ── Intended presentation differences ────────────────────────────────────
  const record = (field: string, a: string, b: string) => {
    if (a !== b) intended.push({ field, old: a, next: b })
  }
  record('headline', original.headline, next.headline)
  record('body', original.body, next.body)
  record('metricLabel', original.metric?.label ?? '(none)', next.metric?.label ?? '(none)')
  record('prompt', original.prompt ?? '(none)', next.prompt ?? '(none)')
  record('evidenceKind', original.evidence?.kind ?? 'none', next.evidence?.kind ?? 'none')
  record('contextRows', String(original.context.length), String(next.context.length))
  record('surface', original.surface, next.surface)

  return {
    cardId: original.id,
    ok: checks.every(c => c.ok),
    checks,
    intended,
  }
}

/** A one-line summary per card, for a dev overlay or a test failure message. */
export function explainParity(r: ParityReport): string {
  const failed = r.checks.filter(c => !c.ok)
  const head = `${r.cardId} ${r.ok ? 'PARITY' : 'DIVERGED'}`
  if (!failed.length) return `${head} · ${r.intended.length} intended presentation change(s)`
  return `${head} · ${failed.map(c => `${c.axis}: ${c.old} → ${c.next}`).join(' · ')}`
}
