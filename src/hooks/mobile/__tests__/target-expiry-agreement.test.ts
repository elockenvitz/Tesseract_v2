/**
 * The Dashboard and the Asset Page now answer "has this target expired?" the
 * same way.
 *
 * ── The divergence this reproduces ───────────────────────────────────────
 *
 * Two definitions were live at once:
 *
 *   the Asset Page / Workspace  ask `targetFreshness`, which reads
 *                               `price_target_outcomes` -- the record the
 *                               database writes when a target is set or
 *                               renewed.
 *   this lens                   derived its own: `created_at` plus the
 *                               `timeframe` text as 30.44-day months, with a
 *                               two-month grace.
 *
 * Measured against production on 2026-11-14, across all 33 targets:
 *
 *   - 32 of 33 stored horizons are exactly `target_set_date + N CALENDAR
 *     months`. The derived rule used 30.44-day months, so it drifted.
 *   - `target_set_date` differs from `created_at` on 5 rows, by up to 502
 *     days, because `create_outcome_for_target` RESTARTS a fixed target's
 *     horizon from `NOW()` on UPDATE -- an analyst renewing their view.
 *   - 18 of the 26 `pending` rows had a stored horizon different from the
 *     derived one.
 *   - 5 of those 26 `pending` rows had a stored horizon ALREADY IN THE PAST,
 *     the earliest 2026-04-12. Nothing flips `pending` when the date passes.
 *
 * The consequence for a reader was specific and bad: renew a lapsed target
 * and the Dashboard tells you again that it has lapsed, because the only
 * input that moved was the clock. The card asks for a decision, receives
 * one, and shows no sign of having heard it.
 *
 * ── Why this file exists at all ──────────────────────────────────────────
 *
 * `expiredAt` and `overdueMonths` appeared in no test in the repository. The
 * branch that decides whether to tell somebody their thesis has run out was
 * unverified, which is why a second definition could live in it unnoticed.
 */
import { describe, it, expect } from 'vitest'
import { overdueTarget } from '../usePortfolioLenses'
import { targetFreshness, type FreshnessOutcomeInput } from '../../../lib/outcomes/target-freshness'

const NOW = new Date('2026-11-14T00:00:00Z')
const nowMs = NOW.getTime()

/** A fixed, non-rolling target, as the lens holds one. */
const target = (over: Partial<Parameters<typeof overdueTarget>[0]> = {}) => ({
  id: 'pt-1',
  timeframe: '12 months',
  rolling: false,
  createdAt: '2025-01-10T00:00:00Z',
  ...over,
})

const outcome = (over: Partial<FreshnessOutcomeInput> = {}): FreshnessOutcomeInput => ({
  price_target_id: 'pt-1',
  status: 'pending',
  target_date: '2026-01-12',
  ...over,
})

describe('the row shapes that made the two definitions disagree', () => {
  it('flags a pending target whose stored horizon has long passed', () => {
    /* The production shape: `pending`, horizon 2026-04-12, seven months
       before now. The stored status says nothing has evaluated it; the
       stored date says it ran out. */
    const v = overdueTarget(target(), [outcome({ target_date: '2026-04-12' })], nowMs)
    expect(v).not.toBeNull()
    expect(v!.expiredAt.slice(0, 10)).toBe('2026-04-12')
    expect(v!.overdueMonths).toBe(7)
  })

  it('does NOT flag a target the analyst has renewed', () => {
    /* THE regression. `created_at` is January 2025, so the old derived rule
       put the horizon at January 2026 and called it ten months overdue. The
       database restarted the horizon from NOW() when the analyst republished,
       and stored 2027-06-01. Nothing has run out. */
    const renewed = overdueTarget(
      target({ createdAt: '2025-01-10T00:00:00Z' }),
      [outcome({ target_date: '2027-06-01' })],
      nowMs,
    )
    expect(renewed).toBeNull()
  })

  it('reports the stored horizon, not one recomputed from the timeframe', () => {
    /* 30.44-day months from `created_at` would land on 2026-01-10. The
       database recorded 2026-01-12 -- calendar months from `target_set_date`.
       The lens must surface the database's date. */
    const v = overdueTarget(target(), [outcome({ target_date: '2026-01-12' })], nowMs)
    expect(v!.expiredAt.slice(0, 10)).toBe('2026-01-12')
    expect(v!.expiredAt.slice(0, 10)).not.toBe('2026-01-10')
  })

  it('agrees with the Asset Page on every one of those rows', () => {
    /* The property the release brief asks for, stated directly: whenever the
       lens flags a target as overdue, the rule the Asset Page asks must also
       call it expired -- and whenever the lens stays quiet, the Asset Page
       must not be calling it expired-and-past-the-grace. */
    const rows: FreshnessOutcomeInput[][] = [
      [outcome({ target_date: '2026-04-12' })],
      [outcome({ target_date: '2027-06-01' })],
      [outcome({ status: 'expired', target_date: '2026-01-12' })],
      [outcome({ status: 'hit', target_date: '2026-01-12' })],
      [outcome({ status: 'missed', target_date: '2026-01-12' })],
      [outcome({ status: 'cancelled', target_date: '2026-01-12' })],
      [],
    ]
    for (const outcomes of rows) {
      const lens = overdueTarget(target(), outcomes, nowMs)
      const page = targetFreshness(
        { id: 'pt-1', target_date: null, is_rolling: false,
          created_at: target().createdAt, timeframe: target().timeframe },
        outcomes, NOW,
      )
      if (lens) {
        expect(page.state, JSON.stringify(outcomes)).toBe('expired')
        expect(lens.expiredAt.slice(0, 10)).toBe(page.asOf)
      } else if (page.state === 'expired' && page.asOf) {
        /* The lens may still stay quiet, but ONLY because of the grace --
           never because it disagrees about expiry. */
        const monthsPast = (nowMs - new Date(page.asOf).getTime()) / (30.44 * 86_400_000)
        expect(monthsPast, JSON.stringify(outcomes)).toBeLessThan(2)
      }
    }
  })
})

describe('what must not be interrupted about', () => {
  it('stays quiet for a resolved verdict', () => {
    /* Somebody reached a conclusion. Asking again is asking for a decision
       already made. */
    for (const status of ['hit', 'missed', 'cancelled'] as const) {
      expect(overdueTarget(target(), [outcome({ status, target_date: '2026-01-12' })], nowMs), status)
        .toBeNull()
    }
  })

  it('stays quiet for a rolling target', () => {
    /* It re-bases continuously and has no horizon to run out of. The
       database agrees by deleting its outcome row outright, which is why
       this passes no outcome at all. */
    expect(overdueTarget(target({ rolling: true }), [], nowMs)).toBeNull()
  })

  it('stays quiet when nothing on record can date the target', () => {
    /* No outcome row and an unparseable timeframe. Retiring work on a guess
       is worse than saying nothing. */
    expect(overdueTarget(target({ timeframe: 'when it works' }), [], nowMs)).toBeNull()
    expect(overdueTarget(target({ timeframe: null }), [], nowMs)).toBeNull()
  })

  it('respects the grace period rather than firing the day it lapses', () => {
    /* One day past is expiry but not an interruption. `targetFreshness`
       already says `expired`; the lens waits two months. */
    const justLapsed = overdueTarget(target(), [outcome({ target_date: '2026-11-13' })], nowMs)
    expect(justLapsed).toBeNull()

    const wellPast = overdueTarget(target(), [outcome({ target_date: '2026-08-01' })], nowMs)
    expect(wellPast).not.toBeNull()
  })

  it('ignores an outcome belonging to a different target', () => {
    /* The FK is the only association. A lapsed horizon on somebody else's
       row must not retire this one -- it falls back to the derived horizon,
       which for a January 2025 target with a 12-month timeframe is itself
       long past, so the assertion is on WHICH date is used. */
    const v = overdueTarget(target(), [outcome({ price_target_id: 'pt-OTHER', target_date: '2026-04-12' })], nowMs)
    expect(v).not.toBeNull()
    expect(v!.expiredAt.slice(0, 10)).not.toBe('2026-04-12')
    /*
     * Calendar months from `created_at`, which is the documented fallback:
     * January 2025 plus twelve months.
     *
     * Asserted as a range of two days rather than one date on purpose.
     * `targetFreshness`'s `toIsoDate` formats with LOCAL date parts, so the
     * fallback horizon for a UTC-midnight anchor renders as the 9th west of
     * Greenwich and the 10th east of it. That is a real wart in the fallback
     * path -- recorded here rather than pinned to whichever timezone this
     * suite happens to run in, and left unfixed because it is not this
     * change's subject.
     */
    expect(['2026-01-09', '2026-01-10']).toContain(v!.expiredAt.slice(0, 10))
  })
})
