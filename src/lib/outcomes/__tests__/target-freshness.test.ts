/**
 * The one freshness rule, asked about every state the data model supports.
 *
 * The defect behind this suite: Research rendered AMZN's Bull $180 / Base $120
 * / Bear $90 as the firm's current valuation. All three had been evaluated
 * `expired` with a target date of 2026-08-30 — which History and Overview both
 * reported correctly. Research simply never asked.
 *
 * Two failure directions are pinned, not one. Showing an expired target as
 * current is the reported bug; marking a live target expired would be the
 * obvious over-correction, and it is worse, because it retires work nobody
 * retired.
 */
import { describe, it, expect } from 'vitest'
import {
  targetFreshness, scenarioFreshness, isStale, FRESHNESS_LABEL,
  type FreshnessOutcomeInput, type FreshnessTargetInput,
} from '../target-freshness'

const NOW = new Date('2026-10-22T00:00:00Z')

const target = (over: Partial<FreshnessTargetInput> = {}): FreshnessTargetInput => ({
  id: 't-1', target_date: null, is_rolling: false, ...over,
})

const outcome = (over: Partial<FreshnessOutcomeInput> = {}): FreshnessOutcomeInput => ({
  price_target_id: 't-1', status: 'expired', target_date: '2026-08-30', ...over,
})

describe('an evaluated outcome is authoritative', () => {
  it('reports expired, which is the AMZN case Research was getting wrong', () => {
    const f = targetFreshness(target(), [outcome()], NOW)
    expect(f.state).toBe('expired')
    expect(f.asOf).toBe('2026-08-30')
    expect(f.basis).toBe('outcome')
  })

  it('reports pending as current — a tracked target that has not run out', () => {
    const f = targetFreshness(target(), [outcome({ status: 'pending', target_date: '2027-06-01' })], NOW)
    expect(f.state).toBe('current')
    expect(isStale(f.state)).toBe(false)
  })

  /**
   * The divergence that survived inside the one rule.
   *
   * `pending` was read as "still standing". It means "nothing evaluated this
   * yet", and nothing flips the row when its horizon passes. Measured in
   * production on 2026-11-14: five of the twenty-six `pending` outcome rows
   * had a `target_date` in the past, the earliest 2026-04-12 — seven months
   * before. The status column and the horizon column on the SAME ROW
   * disagreed, and this function believed the status.
   */
  describe('a pending row whose horizon has already passed', () => {
    it('is expired, not current', () => {
      const f = targetFreshness(target(), [outcome({ status: 'pending', target_date: '2026-04-12' })], NOW)
      expect(f.state).toBe('expired')
      expect(isStale(f.state)).toBe(true)
    })

    it('still reports the outcome row as the basis, because the date is its own', () => {
      /* Not a fallback to inference. The horizon came off the evaluated
         record; only the status was stale. */
      const f = targetFreshness(target(), [outcome({ status: 'pending', target_date: '2026-04-12' })], NOW)
      expect(f.basis).toBe('outcome')
      expect(f.asOf).toBe('2026-04-12')
    })

    it('does not reconsider a terminal verdict somebody reached', () => {
      /* A target HIT in month three is still hit long after its horizon
         passes. Overriding that would retire real history — the
         over-correction this suite's header warns about. */
      for (const status of ['hit', 'missed', 'cancelled'] as const) {
        const f = targetFreshness(target(), [outcome({ status, target_date: '2026-04-12' })], NOW)
        expect(f.state, status).toBe(status)
      }
    })

    it('leaves a pending row with no horizon alone rather than guessing', () => {
      const f = targetFreshness(target(), [outcome({ status: 'pending', target_date: null })], NOW)
      expect(f.state).toBe('current')
      expect(f.basis).toBe('outcome')
    })

    it('treats the horizon day itself as still standing', () => {
      /* The boundary matches the `target-date` branch below, which is
         `due >= now`. A target does not lapse on the morning it is due. */
      const sameDay = targetFreshness(
        target(), [outcome({ status: 'pending', target_date: '2026-10-22' })], NOW,
      )
      expect(sameDay.state).toBe('current')
    })

    it('agrees with what the raw outcome date would say on its own', () => {
      /* The two definitions the release brief named must now give one answer
         for the same row: the stored status path and the stored date path. */
      const lapsed = '2026-04-12'
      const viaStatus = targetFreshness(target(), [outcome({ status: 'pending', target_date: lapsed })], NOW)
      const viaDate = targetFreshness(target({ target_date: lapsed }), [], NOW)
      expect(viaStatus.state).toBe(viaDate.state)
      expect(viaStatus.asOf).toBe(viaDate.asOf)
    })
  })

  it.each([
    ['hit', 'hit'],
    ['missed', 'missed'],
    ['cancelled', 'cancelled'],
  ] as const)('carries %s through', (status, expected) => {
    expect(targetFreshness(target(), [outcome({ status })], NOW).state).toBe(expected)
  })

  it('does not absorb an unrecognised status into one of the five', () => {
    const f = targetFreshness(target(), [outcome({ status: 'superseded' })], NOW)
    expect(f.state).toBe('unknown')
  })

  it('beats the target\'s own date when both are present', () => {
    /* The outcome evaluated it expired; the target's own date has not arrived.
       Evaluation wins, or the editor's updated_at-based countdown would keep
       resurrecting lapsed targets. */
    const f = targetFreshness(
      target({ target_date: '2027-08-23' }), [outcome({ status: 'expired' })], NOW,
    )
    expect(f.state).toBe('expired')
    expect(f.basis).toBe('outcome')
  })
})

describe('the association is the foreign key, never a resemblance', () => {
  it('ignores an outcome belonging to a different target', () => {
    const f = targetFreshness(target({ id: 'mine' }), [outcome({ price_target_id: 'someone-else' })], NOW)
    expect(f.state).toBe('unknown')
    expect(f.basis).toBe('none')
  })

  it('does not match two analysts who happen to agree on a price', () => {
    const mine = target({ id: 'mine' })
    const theirOutcome = outcome({ price_target_id: 'theirs', status: 'missed' })
    expect(targetFreshness(mine, [theirOutcome], NOW).state).not.toBe('missed')
  })
})

describe('an un-evaluated target falls back to its own date, never to expiry', () => {
  it('is current when its fixed date has not arrived', () => {
    const f = targetFreshness(target({ target_date: '2027-01-01' }), [], NOW)
    expect(f.state).toBe('current')
    expect(f.basis).toBe('target-date')
  })

  it('is expired when its fixed date has passed', () => {
    const f = targetFreshness(target({ target_date: '2026-01-01' }), [], NOW)
    expect(f.state).toBe('expired')
    expect(f.basis).toBe('target-date')
  })

  it('treats a rolling target as current — it has no horizon to run out of', () => {
    const f = targetFreshness(target({ is_rolling: true }), [], NOW)
    expect(f.state).toBe('current')
    expect(f.basis).toBe('rolling')
  })

  it('is unknown with no outcome and no date — the real AMZN target shape', () => {
    /* analyst_price_targets.target_date is null on all three AMZN rows; the
       effective date only exists on the outcome. Without that outcome there is
       genuinely nothing to say, and saying "current" is the original bug. */
    const f = targetFreshness(target({ target_date: null, is_rolling: false }), [], NOW)
    expect(f.state).toBe('unknown')
    expect(f.asOf).toBeNull()
  })

  it('never reports an un-evaluated target as expired merely for lacking an outcome', () => {
    expect(targetFreshness(target(), [], NOW).state).not.toBe('expired')
  })

  it('is unknown when the stored date cannot be parsed', () => {
    expect(targetFreshness(target({ target_date: 'not-a-date' }), [], NOW).state).toBe('unknown')
  })
})

describe('a scenario card aggregates several analysts honestly', () => {
  const a = target({ id: 'a' })
  const b = target({ id: 'b' })

  it('reports the shared state when every target agrees', () => {
    const f = scenarioFreshness([a, b], [
      outcome({ price_target_id: 'a', status: 'expired', target_date: '2026-08-30' }),
      outcome({ price_target_id: 'b', status: 'expired', target_date: '2026-09-15' }),
    ], NOW)
    expect(f.state).toBe('expired')
    expect(f.asOf).toBe('2026-09-15')
  })

  it('refuses to call a half-lapsed aggregate current', () => {
    const f = scenarioFreshness([a, b], [
      outcome({ price_target_id: 'a', status: 'pending', target_date: '2027-06-01' }),
      outcome({ price_target_id: 'b', status: 'expired', target_date: '2026-08-30' }),
    ], NOW)
    expect(f.state).toBe('mixed')
    expect(isStale(f.state)).toBe(true)
  })

  it('does not let an un-evaluated target outvote an evaluated one', () => {
    const f = scenarioFreshness([a, b], [
      outcome({ price_target_id: 'a', status: 'expired' }),
    ], NOW)
    expect(f.state).toBe('expired')
  })

  it('is unknown when nothing in the scenario is on record', () => {
    expect(scenarioFreshness([a, b], [], NOW).state).toBe('unknown')
  })

  it('is unknown for an empty scenario rather than throwing', () => {
    expect(scenarioFreshness([], [], NOW).state).toBe('unknown')
  })
})

describe('what counts as stale', () => {
  it('marks the states that mean the number no longer stands', () => {
    expect(['expired', 'missed', 'cancelled', 'mixed'].every(s => isStale(s as never))).toBe(true)
  })

  it('does not mark current, hit or unknown as stale', () => {
    /* `hit` is a success, not staleness; `unknown` is an absence of evidence
       and must not be rendered as a warning. */
    expect(['current', 'hit', 'unknown'].some(s => isStale(s as never))).toBe(false)
  })

  it('gives every state a label, so no surface has to invent wording', () => {
    const states = ['current', 'expired', 'hit', 'missed', 'cancelled', 'unknown', 'mixed'] as const
    states.forEach(s => expect(FRESHNESS_LABEL[s]).toBeTruthy())
  })
})
