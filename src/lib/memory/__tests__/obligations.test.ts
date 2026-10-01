/**
 * Parked work: suppression, clearing, and the promise we are allowed to make.
 *
 * The product lied in a specific, measurable way, and the first describe
 * block reproduces the lie before anything else runs. "Snooze Idea — hides
 * this idea until the date you choose" wrote `revisit_at`, and the column was
 * read by exactly three places: the writer's own audit read-back, a dead
 * hook, and a cosmetic pill. No query filtered on it. The idea never moved.
 *
 * Worse, `snoozeTradeIdea` also bumped `updated_at`, which
 * `collectStaleTradeIdeas` compares against a seven-day threshold — so the
 * one action a user took to be reminded later removed the idea from the only
 * query that might have resurfaced it. Parking work made it LESS likely to
 * come back.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  isParked,
  parkedSuppressionFilter,
  dueState,
  elapsedDays,
  ideaClearReason,
  decisionClearReason,
  CLEAR_REASONS,
  OBLIGATION_KINDS,
} from '../obligations'
import { classifyDeferral, describeDeferralCondition } from '../deferral-semantics'

const NOW = new Date('2026-10-01T12:00:00Z')
const FUTURE = '2026-10-15T00:00:00Z'
const PAST = '2026-09-20T00:00:00Z'

/* ── Part 13: the old behaviour, reproduced and shown to be broken ────── */

describe('NON-VACUITY: the pre-fix behaviour does not suppress anything', () => {
  /**
   * The old pipeline filter, verbatim in shape. `archivedStatuses` and the
   * deferred/deleted checks were the whole of it — there was no clause
   * mentioning `revisit_at` anywhere in the product.
   */
  function oldPipelineFilter(item: { status: string; revisit_at: string | null }) {
    if (['executed', 'rejected', 'approved', 'archived'].includes(item.status)) return false
    if (item.status === 'deleted') return false
    return true
  }

  function newPipelineFilter(item: { status: string; revisit_at: string | null }) {
    if (!oldPipelineFilter(item)) return false
    if (isParked(item.revisit_at, NOW)) return false
    return true
  }

  const snoozedIdea = { status: 'idea', revisit_at: FUTURE }

  it('an idea snoozed for two weeks still showed in the pipeline', () => {
    expect(oldPipelineFilter(snoozedIdea)).toBe(true)
  })

  it('and is suppressed now', () => {
    expect(newPipelineFilter(snoozedIdea)).toBe(false)
  })

  it('the two implementations disagree — the fix is load bearing', () => {
    expect(oldPipelineFilter(snoozedIdea)).not.toBe(newPipelineFilter(snoozedIdea))
  })

  /**
   * The subtractive half: snoozing bumped `updated_at`, and the stale-ideas
   * collector selects `.lt('updated_at', sevenDaysAgo)`. An idea that was
   * about to qualify as stale stopped qualifying the moment someone snoozed
   * it.
   */
  it('the old write reset the staleness clock that might have resurfaced it', () => {
    const sevenDaysAgo = new Date(NOW.getTime() - 7 * 86_400_000).toISOString()
    const lastWorked = '2026-09-01T00:00:00Z' // comfortably stale

    const wasStale = lastWorked < sevenDaysAgo
    expect(wasStale).toBe(true)

    // Old snoozeTradeIdea: `.update({ revisit_at, updated_at: now })`
    const afterOldSnooze = NOW.toISOString()
    expect(afterOldSnooze < sevenDaysAgo).toBe(false)

    // New: `.update({ revisit_at })` — updated_at untouched.
    const afterNewSnooze = lastWorked
    expect(afterNewSnooze < sevenDaysAgo).toBe(true)
  })

  it('and the deferred recommendation had no way back at all', () => {
    // `collectDecisionRequests` and every inbox count filter on the ACTIVE
    // statuses. 'deferred' is classified RESOLVED, so a deferred request
    // appears in no pending list, no count, no attention feed — and nothing
    // read `deferred_until` or `deferred_trigger` to bring it back.
    const ACTIVE = ['pending', 'under_review', 'needs_discussion']
    const deferred = { status: 'deferred', deferred_until: PAST }
    expect(ACTIVE.includes(deferred.status)).toBe(false)

    // Even once its date had passed. That is the dead end.
    expect(Date.parse(deferred.deferred_until) < NOW.getTime()).toBe(true)
    expect(ACTIVE.includes(deferred.status)).toBe(false)
  })
})

/* ── Part 3 / 12: snooze suppression ──────────────────────────────────── */

describe('isParked', () => {
  it('is false for an idea nobody snoozed', () => {
    // The predicate that matters most. A filter that treated null as parked
    // would hide every idea in the product.
    expect(isParked(null, NOW)).toBe(false)
    expect(isParked(undefined, NOW)).toBe(false)
  })

  it('is true before the date', () => {
    expect(isParked(FUTURE, NOW)).toBe(true)
  })

  it('is false at and after the date — eligible again', () => {
    expect(isParked(NOW.toISOString(), NOW)).toBe(false)
    expect(isParked(PAST, NOW)).toBe(false)
  })

  it('is false for an unparseable date rather than hiding the work', () => {
    // Failing open is the right direction: a bad value should show an idea
    // you did not expect, never swallow one you are waiting for.
    expect(isParked('not a date', NOW)).toBe(false)
  })
})

describe('parkedSuppressionFilter', () => {
  it('admits null revisit_at as well as elapsed dates', () => {
    const f = parkedSuppressionFilter(NOW)
    expect(f).toContain('revisit_at.is.null')
    expect(f).toContain(`revisit_at.lte.${NOW.toISOString()}`)
  })

  it('is a single comma-joined or-clause, as PostgREST .or() expects', () => {
    expect(parkedSuppressionFilter(NOW).split(',')).toHaveLength(2)
  })
})

/* ── Part 5: clear rules ──────────────────────────────────────────────── */

describe('an obligation clears on a real action, never on the clock', () => {
  it('the due date arriving does NOT clear it', () => {
    // "Due" means eligible for attention again, not satisfied. An
    // obligation that evaporates when its date passes is a reminder that
    // deletes itself the moment it becomes relevant.
    expect(dueState(PAST, NOW)).toBe('due')
    expect(ideaClearReason({})).toBeNull()
  })

  it('merely viewing the idea does NOT clear it', () => {
    // There is deliberately no `wasViewed` signal. Opening a page is not
    // doing the work.
    expect(ideaClearReason({} as never)).toBeNull()
  })

  it('a stage advance clears it as work resumed', () => {
    expect(ideaClearReason({ stageAdvanced: true })).toBe(CLEAR_REASONS.workResumed)
  })

  it('submitting a recommendation clears it as work resumed', () => {
    expect(ideaClearReason({ recommendationSubmitted: true })).toBe(CLEAR_REASONS.workResumed)
  })

  it('a terminal outcome clears it', () => {
    expect(ideaClearReason({ isTerminal: true })).toBe(CLEAR_REASONS.terminal)
  })

  it('archive or delete clears it — there is nothing to come back to', () => {
    expect(ideaClearReason({ isRemoved: true })).toBe(CLEAR_REASONS.removed)
  })

  it('cancelling the snooze clears it', () => {
    expect(ideaClearReason({ snoozeCancelled: true })).toBe(CLEAR_REASONS.cancelled)
  })

  it('removal wins over every other reason', () => {
    expect(ideaClearReason({ isRemoved: true, stageAdvanced: true, isTerminal: true }))
      .toBe(CLEAR_REASONS.removed)
  })

  it('resolving a deferred decision clears its obligation', () => {
    expect(decisionClearReason({ isResolved: true })).toBe(CLEAR_REASONS.terminal)
    expect(decisionClearReason({ deferralCancelled: true })).toBe(CLEAR_REASONS.cancelled)
    expect(decisionClearReason({})).toBeNull()
  })
})

/* ── Due state ────────────────────────────────────────────────────────── */

describe('dueState', () => {
  it('distinguishes scheduled, due, and open-ended', () => {
    expect(dueState(FUTURE, NOW)).toBe('scheduled')
    expect(dueState(PAST, NOW)).toBe('due')
    expect(dueState(null, NOW)).toBe('open_ended')
  })

  it('treats a missing date as open-ended, NOT as due now', () => {
    // Every `trade_review` obligation has a null due_at, because
    // `execution_expected_by` is set on 0 of 53 production trades. Reading
    // null as "due" would flood a feed with work nobody scheduled.
    expect(dueState(undefined, NOW)).toBe('open_ended')
    expect(dueState('', NOW)).toBe('open_ended')
  })

  it('is due exactly at the boundary', () => {
    expect(dueState(NOW.toISOString(), NOW)).toBe('due')
  })
})

describe('elapsedDays', () => {
  it('counts whole days and floors', () => {
    expect(elapsedDays('2026-09-28T12:00:00Z', NOW)).toBe(3)
    expect(elapsedDays('2026-10-01T00:00:00Z', NOW)).toBe(0)
  })

  it('is negative before the instant, so "overdue" can be gated on > 0', () => {
    expect(elapsedDays(FUTURE, NOW)).toBeLessThan(0)
  })
})

/* ── Part 7 / 8: what a deferral may promise ──────────────────────────── */

describe('deferral classification is honest about what we can evaluate', () => {
  it('a date auto-resurfaces', () => {
    const s = classifyDeferral({ deferredUntil: FUTURE, deferredTrigger: null })
    expect(s.evaluability).toBe('date')
    expect(s.dueAt).toBe(FUTURE)
    expect(s.autoResurfaces).toBe(true)
  })

  it('a price trigger does NOT auto-resurface and does not claim to', () => {
    // Structured and genuinely computable against price_history_cache, but
    // no evaluator runs. Raising it with a due_at would make the feed
    // announce it on a date the PM never chose.
    const s = classifyDeferral({
      deferredUntil: null,
      deferredTrigger: { type: 'price_level', symbol: 'NVDA', condition: 'above', price: 200 },
    })
    expect(s.autoResurfaces).toBe(false)
    expect(s.dueAt).toBeNull()
    expect(s.promise).toMatch(/does not yet watch prices|will not resurface on its own/i)
  })

  it('an earnings trigger does not claim a calendar we do not have', () => {
    // `asset_earnings_dates` holds zero rows in production.
    const s = classifyDeferral({
      deferredUntil: null,
      deferredTrigger: { type: 'earnings', symbol: 'NVDA' },
    })
    expect(s.autoResurfaces).toBe(false)
    expect(s.reason).toBe('earnings:no-calendar')
    expect(s.promise).toMatch(/no earnings calendar/i)
  })

  it('a free-text condition is never claimed to be detectable', () => {
    const s = classifyDeferral({
      deferredUntil: null,
      deferredTrigger: { type: 'custom', description: 'After the Fed meeting' },
    })
    expect(s.evaluability).toBe('manual')
    expect(s.autoResurfaces).toBe(false)
    expect(s.promise).toMatch(/cannot tell when this condition is met/i)
  })

  it('no promise anywhere says we will watch, alert or notify', () => {
    const all = [
      classifyDeferral({ deferredUntil: FUTURE, deferredTrigger: null }),
      classifyDeferral({ deferredUntil: null, deferredTrigger: { type: 'price_level', symbol: 'A', condition: 'below', price: 1 } }),
      classifyDeferral({ deferredUntil: null, deferredTrigger: { type: 'earnings', symbol: 'A' } }),
      classifyDeferral({ deferredUntil: null, deferredTrigger: { type: 'custom', description: 'x' } }),
      classifyDeferral({ deferredUntil: null, deferredTrigger: null }),
    ]
    for (const s of all) {
      if (!s.autoResurfaces) {
        expect(s.promise).not.toMatch(/\bwe'll (watch|alert|notify|tell you)\b/i)
        expect(s.promise).not.toMatch(/\bremind you when\b/i)
      }
    }
  })

  it('every deferral is kept, so none becomes undiscoverable', () => {
    // The dead end was a deferred request appearing in no list at all. Each
    // classification still yields a promise that names where it lives.
    const all = [
      classifyDeferral({ deferredUntil: null, deferredTrigger: { type: 'custom', description: 'x' } }),
      classifyDeferral({ deferredUntil: null, deferredTrigger: { type: 'earnings', symbol: 'A' } }),
      classifyDeferral({ deferredUntil: null, deferredTrigger: null }),
    ]
    for (const s of all) expect(s.promise).toMatch(/open follow-up|deferred list/i)
  })

  it('a date wins when a PM gave both', () => {
    const s = classifyDeferral({
      deferredUntil: FUTURE,
      deferredTrigger: { type: 'custom', description: 'or when vol subsides' },
    })
    expect(s.autoResurfaces).toBe(true)
  })

  it('an unparseable date falls back rather than producing a bad due_at', () => {
    const s = classifyDeferral({ deferredUntil: 'soon', deferredTrigger: null })
    expect(s.dueAt).toBeNull()
    expect(s.autoResurfaces).toBe(false)
  })

  it('describes a condition from its fields alone', () => {
    expect(describeDeferralCondition({ type: 'price_level', symbol: 'NVDA', condition: 'above', price: 200 }))
      .toBe('NVDA above 200')
    expect(describeDeferralCondition({ type: 'earnings', symbol: 'NVDA' })).toBe('NVDA earnings')
    expect(describeDeferralCondition({ type: 'custom', description: 'Fed' })).toBe('Fed')
    expect(describeDeferralCondition(null)).toBeNull()
  })
})

describe('the kind vocabulary matches the database CHECK', () => {
  it('lists exactly the three allowed kinds', () => {
    // A kind not in `memory_obligations_kind_ck` is rejected at insert; a
    // kind in the CHECK but not here is one no reader will ask for.
    expect(Object.values(OBLIGATION_KINDS).sort()).toEqual([
      'decision_revisit', 'idea_revisit', 'trade_review',
    ])
  })
})

describe('clock injection', () => {
  it('nothing here depends on the wall clock', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      // Explicit `now` must win over the system clock, or every test above
      // becomes time-dependent and these suites rot on a date boundary.
      expect(isParked(FUTURE, NOW)).toBe(true)
      expect(dueState(FUTURE, NOW)).toBe('scheduled')
    } finally {
      vi.useRealTimers()
    }
  })
})
