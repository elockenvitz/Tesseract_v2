/**
 * What Tesseract is entitled to say about an execution.
 *
 * The product distinguishes four things: a recommendation, a PM decision, a
 * simulated/model execution, and a real externally confirmed one. The first
 * three are records. The fourth does not exist — there is no OMS, EMS or
 * broker integration — and the whole hazard is that the third looks exactly
 * like it from `accepted_trades` alone: `execution_status='complete'`,
 * `executed_by` set, `execution_completed_at` stamped, for a fill nobody
 * observed.
 *
 * These tests hold the line between them, at the grade and at the vocabulary.
 */
import { describe, it, expect } from 'vitest'
import { gradeExecutionProof, gradeTradeExecution } from '../../asset-decisions/timeline'
import {
  ALL_EXECUTION_PROOFS,
  OBSERVED_PROOFS,
  EXTERNALLY_CONFIRMED_PROOFS,
  EXECUTION_PROOF_LABELS,
  EXECUTION_PROOF_PLAIN,
} from '../../../types/decision-timeline'
import { EXECUTION_ORIGIN } from '../accepted-trade-service'
import {
  gradeExecutionProof as edgeGrade,
  gradeTradesFromEvidence,
  PROOF_PHRASE,
  PROOF_STRENGTH,
} from '../../../../supabase/functions/_shared/execution-proof'

/** A row as `portfolio_trade_events` stores one. */
const row = (origin: string | null, stamps?: { detected?: boolean; source?: string }) => ({
  detected_by_system: stamps?.detected ?? false,
  source_type: stamps?.source ?? 'manual',
  metadata: origin ? { origin } : null,
})

describe('an assumed execution stays assumed', () => {
  it('grades as assumed, and is neither observed nor confirmed', () => {
    const grade = gradeExecutionProof(row(EXECUTION_ORIGIN.pmAssumed))
    expect(grade).toBe('assumed')
    expect(OBSERVED_PROOFS).not.toContain(grade)
    expect(EXTERNALLY_CONFIRMED_PROOFS).not.toContain(grade)
  })

  it('is the one grade whose plain wording says outright that it is unconfirmed', () => {
    // The badge a PM actually reads. "Executed" with nothing after it is the
    // claim this exists to qualify.
    expect(EXECUTION_PROOF_PLAIN.assumed).toBe('not confirmed')
  })

  it('stays assumed even if the stamps say the system detected it', () => {
    // A declared origin outranks the stamp conjunction. Were it the other way
    // round, one wrong boolean on the writer would promote every assumed fill
    // to an observed one, permanently, in an append-only table.
    const grade = gradeExecutionProof(
      row(EXECUTION_ORIGIN.pmAssumed, { detected: true, source: 'holdings_diff' }),
    )
    expect(grade).toBe('assumed')
  })
})

describe('observed paper execution is identified as OUR observation, not the market\'s', () => {
  it('grades as verified from the two stamps together', () => {
    expect(gradeExecutionProof(row(null, { detected: true, source: 'holdings_diff' })))
      .toBe('verified')
    expect(gradeExecutionProof(row(EXECUTION_ORIGIN.observed, { detected: true, source: 'holdings_diff' })))
      .toBe('verified')
  })

  it('is NOT externally confirmed', () => {
    /*
     * The narrow claim that matters. `paper_execute` means the app applied the
     * trade to the model book and watched its own numbers change. Nobody
     * outside Tesseract checked them, and in production every single execution
     * is this grade or weaker.
     */
    expect(OBSERVED_PROOFS).toContain('verified')
    expect(EXTERNALLY_CONFIRMED_PROOFS).not.toContain('verified')
  })

  it('is not named "Verified" any more, because that reads as confirmed', () => {
    expect(EXECUTION_PROOF_LABELS.verified).toBe('Observed')
    expect(EXECUTION_PROOF_LABELS.broker_confirmed).toBe('Confirmed')
  })
})

describe('a human attestation is not a broker confirmation', () => {
  it('grades as attested', () => {
    expect(gradeExecutionProof(row(EXECUTION_ORIGIN.attested))).toBe('attested')
  })

  it('is not observed and not externally confirmed', () => {
    // A person's word is evidence. It is not a counterparty record, and the
    // two have different reversal semantics as well as different credibility.
    expect(OBSERVED_PROOFS).not.toContain('attested')
    expect(EXTERNALLY_CONFIRMED_PROOFS).not.toContain('attested')
  })

  it('reads as trader-reported to a user and says "not observed" to a model', () => {
    expect(EXECUTION_PROOF_PLAIN.attested).toBe('trader-reported')
    expect(PROOF_PHRASE.attested).toContain('not observed')
  })
})

describe('broker confirmation exists as a grade and nothing can produce it', () => {
  it('grades a broker row as broker_confirmed', () => {
    expect(gradeExecutionProof(row(EXECUTION_ORIGIN.brokerConfirmed))).toBe('broker_confirmed')
  })

  it('wins over the stamp conjunction, so a real confirmation is not downgraded', () => {
    /*
     * A confirmation ingestion would plausibly set both stamps too. If the
     * conjunction were checked first, the strongest grade the system can hold
     * would silently come back as `verified` — the exact collapse this grade
     * was added to prevent.
     */
    expect(gradeExecutionProof(
      row(EXECUTION_ORIGIN.brokerConfirmed, { detected: true, source: 'holdings_diff' }),
    )).toBe('broker_confirmed')
  })

  it('is the ONLY externally confirmed grade', () => {
    expect(ALL_EXECUTION_PROOFS.filter(p => EXTERNALLY_CONFIRMED_PROOFS.includes(p)))
      .toEqual(['broker_confirmed'])
  })

  it('is written by nothing in the application', () => {
    /*
     * The grade is only honest while no code path can mint it. `EXECUTION_ORIGIN`
     * declares the value so the vocabulary has one home; the writers choose
     * between `observed`, `attested` and `pmAssumed`. If a confirmation path is
     * ever built this assertion is what forces the decision to be deliberate.
     */
    const writers = [
      EXECUTION_ORIGIN.observed,
      EXECUTION_ORIGIN.attested,
      EXECUTION_ORIGIN.pmAssumed,
    ]
    expect(writers).not.toContain(EXECUTION_ORIGIN.brokerConfirmed)
  })
})

describe('grading a TRADE from every row it carries', () => {
  it('has no grade at all when there is no evidence', () => {
    // Not `unattributed`. One production trade is `complete` with no evidence
    // row, and "no record that this executed" is a different fact from "a
    // record that does not say how".
    expect(gradeTradeExecution([])).toBeNull()
  })

  it('takes the strongest row, so a later attestation is not lost under the assumption', () => {
    /*
     * `emitAttestedExecutionEvent` deliberately lets an attestation through on
     * top of a `pm_assumed_execution` row — the assumption must not crowd out
     * the fact it stood in for. Reporting the weakest or the newest row would
     * undo that.
     */
    expect(gradeTradeExecution([
      row(EXECUTION_ORIGIN.pmAssumed),
      row(EXECUTION_ORIGIN.attested),
    ])).toBe('attested')
  })

  it('does not let a weak row drag a confirmed one down', () => {
    expect(gradeTradeExecution([
      row(EXECUTION_ORIGIN.pmAssumed),
      row(EXECUTION_ORIGIN.brokerConfirmed),
    ])).toBe('broker_confirmed')
  })

  it('reports assumed when that is all there is', () => {
    expect(gradeTradeExecution([row(EXECUTION_ORIGIN.pmAssumed)])).toBe('assumed')
  })
})

describe('the Edge mirror cannot drift from the frontend grader', () => {
  /*
   * `supabase/functions/_shared/execution-proof.ts` is a copy: Deno cannot
   * resolve `src/`. A copy with no guard is a copy that goes stale, and the
   * staleness would show up as ACT AI reporting a different grade from the UI
   * for the same trade.
   */
  const CASES = [
    EXECUTION_ORIGIN.brokerConfirmed,
    EXECUTION_ORIGIN.observed,
    EXECUTION_ORIGIN.attested,
    EXECUTION_ORIGIN.pmAssumed,
    'paper_execute_backfill',
    null,
  ]

  it('grades every origin identically', () => {
    for (const origin of CASES) {
      expect(edgeGrade(row(origin))).toBe(gradeExecutionProof(row(origin)))
      expect(edgeGrade(row(origin, { detected: true, source: 'holdings_diff' })))
        .toBe(gradeExecutionProof(row(origin, { detected: true, source: 'holdings_diff' })))
    }
  })

  it('holds the same set of grades, in the same strength order', () => {
    expect(PROOF_STRENGTH).toEqual(ALL_EXECUTION_PROOFS)
  })

  it('has a phrase for every grade, so the model is never handed a bare code', () => {
    for (const grade of ALL_EXECUTION_PROOFS) {
      expect(PROOF_PHRASE[grade]).toBeTruthy()
    }
  })

  it('tells the model in words that an assumed fill was not observed', () => {
    // The field the assistant reads. "assumed" alone is a word it will round
    // off to "executed"; the sentence is what stops that.
    expect(PROOF_PHRASE.assumed).toContain('ASSUMED')
    expect(PROOF_PHRASE.assumed).toContain('nobody observed or confirmed')
    expect(PROOF_PHRASE.verified).toContain('no external confirmation')
  })
})

describe('grouping evidence by trade, as the Edge reader does', () => {
  const ev = (tradeId: string, origin: string) => ({
    detected_by_system: false,
    source_type: 'manual',
    metadata: { origin, accepted_trade_id: tradeId },
  })

  it('grades each trade from its own rows', () => {
    const graded = gradeTradesFromEvidence([
      ev('at-1', EXECUTION_ORIGIN.pmAssumed),
      ev('at-2', EXECUTION_ORIGIN.attested),
      ev('at-1', EXECUTION_ORIGIN.pmAssumed),
    ])
    expect(graded.get('at-1')).toBe('assumed')
    expect(graded.get('at-2')).toBe('attested')
  })

  it('omits a trade entirely rather than inventing a grade for it', () => {
    const graded = gradeTradesFromEvidence([ev('at-1', EXECUTION_ORIGIN.pmAssumed)])
    expect(graded.has('at-2')).toBe(false)
    // The caller must render an absence as "not known", never as a fill. A
    // default here would make that impossible to get right downstream.
    expect(graded.get('at-2')).toBeUndefined()
  })

  it('ignores a row that names no trade', () => {
    const orphan = { detected_by_system: false, source_type: 'manual', metadata: { origin: 'pm_assumed_execution' } }
    expect(gradeTradesFromEvidence([orphan]).size).toBe(0)
  })
})
