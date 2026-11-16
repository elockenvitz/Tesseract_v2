/**
 * Trade Book — the execution claim is qualified, and the phase is not moved.
 *
 * Two things are being pinned here, and they pull in opposite directions:
 *
 *   1. A `settled` pill no longer stands alone. Whatever the evidence says,
 *      including that there is none or that it could not be read, is rendered
 *      beside it, and nothing but a real external confirmation is allowed to
 *      say "Confirmed".
 *
 *   2. The phase derivation itself is UNCHANGED. The filters, the rollup
 *      counts and the section headers all read `tradeLifecyclePhase`, so the
 *      matrix below is a characterization test: if qualifying the claim had
 *      been done by moving a trade out of `settled`, these fail.
 */
import { describe, it, expect } from 'vitest'
import {
  EVIDENCE_BADGE,
  evidenceStateFor,
  type EvidenceState,
} from '../evidence-badge'
import { tradeLifecyclePhase, type LifecyclePhase } from '../lifecycle'
import {
  ALL_EXECUTION_PROOFS,
  EXTERNALLY_CONFIRMED_PROOFS,
} from '../../../types/decision-timeline'

/** A settled trade, the phase every execution claim arrives in today. */
const SETTLED = { execution_status: 'complete', reconciliation_status: 'matched' } as const

function badgeFor(proof: Parameters<typeof evidenceStateFor>[0]['proof'], phase: LifecyclePhase = 'settled') {
  const state = evidenceStateFor({ phase, proof })
  return state ? EVIDENCE_BADGE[state] : null
}

describe('an assumed execution is shown as assumed', () => {
  it('reads "Assumed" on the row, not "Settled" alone', () => {
    expect(badgeFor('assumed')?.label).toBe('Assumed')
  })

  it('says in full that nobody observed or confirmed a fill', () => {
    const title = badgeFor('assumed')!.title
    expect(title).toMatch(/approved/i)
    expect(title).toMatch(/nobody observed or confirmed/i)
  })

  it('is badged even though its phase is the terminal, green one', () => {
    // The whole point: `complete` + `matched` is reached by a PM clicking
    // approve, and the phase alone cannot say so.
    expect(tradeLifecyclePhase(SETTLED).phase).toBe('settled')
    expect(evidenceStateFor({ phase: 'settled', proof: 'assumed' })).toBe('assumed')
  })

  it('never claims confirmation anywhere in its copy', () => {
    const b = badgeFor('assumed')!
    expect(b.label).not.toMatch(/confirm/i)
    expect(b.title).not.toMatch(/\bis confirmed|was confirmed|broker confirmed this/i)
  })
})

describe('an observed paper execution is identified as the model, not the market', () => {
  it('reads "Model"', () => {
    expect(badgeFor('verified')?.label).toBe('Model')
  })

  it('says no broker confirmed it', () => {
    expect(badgeFor('verified')!.title).toMatch(/no broker confirmed/i)
  })

  it('is not the same badge as a real confirmation', () => {
    expect(badgeFor('verified')!.label).not.toBe(badgeFor('broker_confirmed')!.label)
  })
})

describe('a trader attestation is reported, not confirmed', () => {
  it('reads "Reported"', () => {
    expect(badgeFor('attested')?.label).toBe('Reported')
  })

  it('attributes it to a person and says nothing observed it', () => {
    const title = badgeFor('attested')!.title
    expect(title).toMatch(/a person states/i)
    expect(title).toMatch(/no system observed/i)
  })

  it('does not borrow the confirmed badge', () => {
    expect(badgeFor('attested')!.label).not.toMatch(/confirmed/i)
  })
})

describe('broker confirmation is shown when, and only when, it is recorded', () => {
  it('reads "Confirmed" and credits an authority outside Tesseract', () => {
    expect(badgeFor('broker_confirmed')?.label).toBe('Confirmed')
    expect(badgeFor('broker_confirmed')!.title).toMatch(/outside Tesseract/i)
  })

  it('is the ONLY state whose label claims confirmation', () => {
    const claiming = (Object.keys(EVIDENCE_BADGE) as EvidenceState[])
      .filter(s => /confirmed/i.test(EVIDENCE_BADGE[s].label))
    expect(claiming).toEqual(['broker_confirmed'])
  })

  it('is the only grade the rest of the app treats as external confirmation', () => {
    expect([...EXTERNALLY_CONFIRMED_PROOFS]).toEqual(['broker_confirmed'])
  })
})

describe('missing evidence and unreadable evidence are different states', () => {
  it('says "No evidence" when the read succeeded and found none', () => {
    // True of one production trade: `complete`, with no event row at all.
    expect(evidenceStateFor({ phase: 'settled', proof: null })).toBe('none')
    expect(badgeFor(null)?.label).toBe('No evidence')
  })

  it('says "Unavailable" when the read could not be completed', () => {
    const state = evidenceStateFor({ phase: 'settled', proof: null, unavailable: true })
    expect(state).toBe('unavailable')
    expect(EVIDENCE_BADGE[state!].title).toMatch(/could not be loaded/i)
  })

  it('does not let an unreadable evidence state imply the trade did not execute', () => {
    const title = EVIDENCE_BADGE.unavailable.title
    expect(title).toMatch(/says nothing about whether the trade executed/i)
  })

  it('prefers "Unavailable" over a grade it may only partly have', () => {
    // A failed chunk means the map is incomplete, so a grade present in it
    // cannot be trusted to be the strongest row for that trade.
    expect(evidenceStateFor({ phase: 'settled', proof: 'verified', unavailable: true }))
      .toBe('unavailable')
  })

  it('invents no grade for either case', () => {
    for (const state of ['none', 'unavailable'] as const) {
      expect(ALL_EXECUTION_PROOFS).not.toContain(state as never)
    }
  })
})

describe('the badge only qualifies phases that claim an execution', () => {
  it('renders nothing on a trade nobody has executed yet', () => {
    for (const phase of ['queued', 'working', 'cancelled'] as LifecyclePhase[]) {
      expect(evidenceStateFor({ phase, proof: 'assumed' })).toBeNull()
      expect(evidenceStateFor({ phase, proof: null, unavailable: true })).toBeNull()
    }
  })

  it('renders on every phase that does claim one', () => {
    for (const phase of ['settled', 'awaiting_recon', 'needs_review'] as LifecyclePhase[]) {
      expect(evidenceStateFor({ phase, proof: 'assumed' })).toBe('assumed')
    }
  })
})

describe('every grade has a badge, so a new one cannot arrive unlabelled', () => {
  it('covers the whole ExecutionProof union plus the two absences', () => {
    const states = Object.keys(EVIDENCE_BADGE).sort()
    expect(states).toEqual([...ALL_EXECUTION_PROOFS, 'none', 'unavailable'].sort())
  })

  it('gives each one a label and a full sentence', () => {
    for (const state of Object.keys(EVIDENCE_BADGE) as EvidenceState[]) {
      expect(EVIDENCE_BADGE[state].label.length).toBeGreaterThan(0)
      expect(EVIDENCE_BADGE[state].title).toMatch(/\.$/)
      // No em dashes in user-visible copy.
      expect(EVIDENCE_BADGE[state].title).not.toContain('—')
      expect(EVIDENCE_BADGE[state].label).not.toContain('—')
    }
  })
})

describe('the existing Trade Book status transitions are unchanged', () => {
  /*
   * The phase matrix, pinned. Evidence is rendered BESIDE the phase, never
   * by re-deriving it, so every one of these must still hold.
   */
  const CASES: Array<[string, Parameters<typeof tradeLifecyclePhase>[0], LifecyclePhase]> = [
    ['complete + matched is still settled', SETTLED, 'settled'],
    ['complete + pending is still awaiting recon',
      { execution_status: 'complete', reconciliation_status: 'pending' }, 'awaiting_recon'],
    ['in_progress is still working',
      { execution_status: 'in_progress', reconciliation_status: 'pending' }, 'working'],
    ['not_started is still queued',
      { execution_status: 'not_started', reconciliation_status: 'pending' }, 'queued'],
    ['cancelled still wins over everything',
      { execution_status: 'cancelled', reconciliation_status: 'matched' }, 'cancelled'],
    ['deviated is still needs_review',
      { execution_status: 'complete', reconciliation_status: 'deviated' }, 'needs_review'],
    ['partial is still needs_review',
      { execution_status: 'complete', reconciliation_status: 'partial' }, 'needs_review'],
    ['unmatched is still needs_review',
      { execution_status: 'complete', reconciliation_status: 'unmatched' }, 'needs_review'],
    ['a stale flag is still needs_review',
      { execution_status: 'not_started', reconciliation_status: 'pending',
        staleness_flagged_at: '2026-11-01T00:00:00Z' }, 'needs_review'],
  ]

  for (const [name, trade, expected] of CASES) {
    it(name, () => {
      expect(tradeLifecyclePhase(trade).phase).toBe(expected)
    })
  }

  it('keeps the needs_review sub-severities', () => {
    expect(tradeLifecyclePhase({
      execution_status: 'complete', reconciliation_status: 'deviated',
    }).severity).toBe('mismatch')
    expect(tradeLifecyclePhase({
      execution_status: 'complete', reconciliation_status: 'unmatched',
    }).severity).toBe('unmatched')
  })

  it('does not consult evidence to decide a phase', () => {
    // `tradeLifecyclePhase` takes the trade row and the holdings source.
    // If a grade had been threaded in, the same row would stop producing
    // the same phase, and every count and filter would shift under the
    // Trade Book's feet.
    expect(tradeLifecyclePhase(SETTLED)).toEqual(tradeLifecyclePhase(SETTLED, 'paper'))
    expect(tradeLifecyclePhase(SETTLED)).toEqual(tradeLifecyclePhase(SETTLED, 'manual_eod'))
  })
})
