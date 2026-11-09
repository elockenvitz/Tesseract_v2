/**
 * Editing commentary must not move a price target's horizon.
 *
 * ── The contradiction ─────────────────────────────────────────────────────
 *
 * The target editor derived its countdown from `updated_at + timeframe`, on
 * the note that "saving restarts the timer". Saving does not. There is a
 * BEFORE UPDATE trigger on `analyst_price_targets` that touches `updated_at`
 * on EVERY column, so correcting a typo in the reasoning pushed the displayed
 * expiry a whole timeframe into the future.
 *
 * AMZN's Bull target is the live case, and the numbers are from production:
 *
 *   created_at   2025-08-30     outcome.target_set_date  2025-08-30
 *   updated_at   2026-08-23     outcome.target_date      2026-08-30
 *   timeframe    12 months      outcome.status           expired
 *
 * The evaluator said expired on 2026-08-30. The editor, anchoring on
 * `updated_at`, said it expires 2027-08-23 -- still current, ten months of
 * life invented by an edit.
 *
 * ── What the database actually does, which is correct ─────────────────────
 *
 * `create_outcome_for_target` is attached as
 *
 *   AFTER UPDATE OF price, timeframe, timeframe_type, target_date, is_rolling
 *
 * so only a deliberate revision restarts the horizon; when one does, the
 * trigger rewrites `target_date`, resets `target_set_date` and returns the
 * outcome to `pending`. A commentary edit fires nothing. Confirmed against
 * production in a rollback transaction: updating `reasoning` alone left
 * status `expired`, set date 2025-08-30 and target date 2026-08-30 untouched.
 *
 * So no migration is needed, and none was made. The model already holds the
 * right answer; only the editor was not reading it.
 */
import { describe, it, expect } from 'vitest'
import {
  targetFreshness, addTimeframe, isStale,
  type FreshnessTargetInput, type FreshnessOutcomeInput,
} from '../target-freshness'

/** Today, for every case below. After the Bull target's 2026-08-30 expiry. */
const NOW = new Date('2026-10-22T00:00:00')

/**
 * The production AMZN Bull target, field for field.
 *
 * `updated_at` is carried deliberately even though `FreshnessTargetInput`
 * does not declare it. It is the field the old editor anchored on, so a
 * fixture without it cannot tell a correct anchor from the broken one — these
 * cases would pass against the defect, which is no test at all.
 */
const BULL: FreshnessTargetInput & { updated_at: string } = {
  id: 'pt-bull',
  created_at: '2025-08-30T13:14:59Z',
  updated_at: '2026-08-23T19:13:53Z',
  timeframe: '12 months',
  timeframe_type: 'preset',
  target_date: null,
  is_rolling: false,
}
const BULL_OUTCOME: FreshnessOutcomeInput = {
  price_target_id: 'pt-bull',
  status: 'expired',
  target_date: '2026-08-30',
}

/** The same target after somebody fixed a typo on 2026-08-23. */
const BULL_AFTER_TYPO_FIX: FreshnessTargetInput = { ...BULL }

describe('the reported contradiction', () => {
  it('an expired target stays expired after an incidental edit', () => {
    const f = targetFreshness(BULL_AFTER_TYPO_FIX, [BULL_OUTCOME], NOW)
    expect(f.state).toBe('expired')
    expect(f.asOf).toBe('2026-08-30')
    expect(f.basis).toBe('outcome')
  })

  it('the editor\'s old anchor would have called it current — and is not used', () => {
    /*
     * This is the defect expressed as arithmetic, so the regression is
     * unmistakable if anyone re-anchors on `updated_at`.
     */
    const wrong = addTimeframe('2026-08-23T19:13:53Z', '12 months')!
    expect(wrong.getTime()).toBeGreaterThan(NOW.getTime())   // would read "current"

    const right = addTimeframe(BULL.created_at, '12 months')!
    expect(right.getTime()).toBeLessThan(NOW.getTime())      // the real horizon
    expect(right.toISOString().slice(0, 10)).toBe('2026-08-30')
  })

  it('does not contradict the evaluated verdict with a countdown', () => {
    /* Even given a target_date that has not arrived, an evaluated `expired`
       wins. The evaluator looked at the price on the day; arithmetic did not. */
    const f = targetFreshness(
      { ...BULL, target_date: '2027-08-23' }, [BULL_OUTCOME], NOW,
    )
    expect(f.state).toBe('expired')
    expect(isStale(f.state)).toBe(true)
  })
})

describe('the horizon anchor, when no outcome has been written yet', () => {
  it('measures from creation, not from the last edit', () => {
    const f = targetFreshness(BULL, [], NOW)
    expect(f.basis).toBe('created-timeframe')
    expect(f.asOf).toBe('2026-08-30')
    expect(f.state).toBe('expired')
  })

  it('is unchanged by an edit, because the anchor does not move', () => {
    const before = targetFreshness(BULL, [], NOW)
    const after = targetFreshness(BULL_AFTER_TYPO_FIX, [], NOW)
    expect(after.asOf).toBe(before.asOf)
    expect(after.state).toBe(before.state)
  })

  it('keeps a current target current', () => {
    const fresh = { ...BULL, id: 'pt-new', created_at: '2026-09-01T00:00:00Z' }
    const f = targetFreshness(fresh, [], NOW)
    expect(f.state).toBe('current')
    expect(isStale(f.state)).toBe(false)
  })
})

describe('a deliberate revision DOES move the horizon', () => {
  it('follows the new timeframe the analyst chose', () => {
    /* Changing `timeframe` is one of the columns the trigger watches, so the
       database restarts the horizon and so must the display. */
    const revised = { ...BULL, timeframe: '24 months' }
    expect(addTimeframe(revised.created_at, revised.timeframe)!.getFullYear()).toBe(2027)
  })

  it('reads the renewed outcome the trigger writes', () => {
    /* After a revision the trigger resets the row to pending with a new date;
       the rule then reports current off that record, not off any arithmetic. */
    const renewed: FreshnessOutcomeInput = {
      price_target_id: 'pt-bull', status: 'pending', target_date: '2027-10-01',
    }
    const f = targetFreshness(BULL, [renewed], NOW)
    expect(f.state).toBe('current')
    expect(f.asOf).toBe('2027-10-01')
    expect(f.basis).toBe('outcome')
  })
})

describe('the horizon kinds stay distinct', () => {
  it('a fixed-date target uses its own date, not its timeframe', () => {
    const fixed = {
      ...BULL, id: 'pt-fixed', timeframe_type: 'date', target_date: '2027-03-01',
    }
    const f = targetFreshness(fixed, [], NOW)
    expect(f.basis).toBe('target-date')
    expect(f.asOf).toBe('2027-03-01')
    expect(f.state).toBe('current')
  })

  it('a rolling target never expires and carries no date', () => {
    /* The trigger deletes any outcome for a rolling target, so there is
       nothing to evaluate and nothing to count down. */
    const f = targetFreshness({ ...BULL, id: 'pt-roll', is_rolling: true }, [], NOW)
    expect(f.state).toBe('current')
    expect(f.basis).toBe('rolling')
    expect(f.asOf).toBeNull()
  })

  it('a target with no date information at all is not called current', () => {
    const bare = { id: 'pt-bare', is_rolling: false }
    const f = targetFreshness(bare, [], NOW)
    expect(f.state).toBe('unknown')
    expect(f.basis).toBe('none')
  })
})

describe('addTimeframe', () => {
  it.each([
    ['3 months', '2025-11-30'],
    /*
     * Aug 30 + 6 months is Feb 30, which `setMonth` rolls into March. That
     * overflow is JavaScript's and is inherited verbatim from the editor's
     * `calculateExpirationDate`: this move was a relocation, not a rewrite,
     * and silently "fixing" month-end arithmetic would change the expiry of
     * every existing preset target. Pinned so the behaviour is a decision
     * rather than a surprise.
     */
    ['6 months', '2026-03-02'],
    ['12 months', '2026-08-30'],
    ['24 months', '2027-08-30'],
    ['11 months', '2026-07-30'],
  ])('resolves %s', (tf, expected) => {
    expect(addTimeframe('2025-08-30T00:00:00', tf)!.toISOString().slice(0, 10)).toBe(expected)
  })

  it('returns null rather than guessing an unparseable timeframe', () => {
    expect(addTimeframe('2025-08-30T00:00:00', 'when it feels right')).toBeNull()
    expect(addTimeframe(null, '12 months')).toBeNull()
    expect(addTimeframe('not-a-date', '12 months')).toBeNull()
  })
})
