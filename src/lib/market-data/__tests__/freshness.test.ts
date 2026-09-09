import { describe, it, expect } from 'vitest'

import {
  DAILY_CLOSE_POLICY,
  ESTIMATE_POLICY,
  FUNDAMENTAL_POLICY,
  INTRADAY_QUOTE_POLICY,
  REFERENCE_POLICY,
  areComparable,
  assessFreshness,
  describeSource,
  freshValue,
  isCalendarFallback,
  policyFor,
  type Observed,
} from '../freshness'

const NOW = Date.parse('2026-09-08T21:00:00Z')

const close = (over: Partial<Observed<number>> = {}): Observed<number> => ({
  value: 187.4,
  source: { provider: 'yahoo', feed: 'daily-bars', via: 'cache' },
  observedAt: '2026-09-08T22:00:00Z',
  effectiveAt: '2026-09-05',
  adjustment: 'split_adjusted',
  currency: 'USD',
  ...over,
})

describe('freshness is measured from when the value was true', () => {
  it('calls a Friday close fresh across a weekend and a Monday holiday', () => {
    /**
     * The worst legitimate gap, and the case that sets the window. 2026-09-04
     * is a Friday; with Monday closed, that close is still the latest one at
     * 21:00 UTC on Tuesday, an age of 4 days and 21 hours. A four-day window
     * would report the whole universe as stale every long weekend.
     */
    const v = assessFreshness(close({ effectiveAt: '2026-09-04' }), DAILY_CLOSE_POLICY, NOW)
    expect(v.state).toBe('fresh')
    expect(v.ageDays).toBe(4)
  })

  it('calls a week-old close stale, so the wider window still catches an outage', () => {
    const v = assessFreshness(close({ effectiveAt: '2026-09-01' }), DAILY_CLOSE_POLICY, NOW)
    expect(v.state).toBe('stale')
    expect(v.ageDays).toBe(7)
  })

  it('calls a month-old close stale even when fetched seconds ago', () => {
    /**
     * The whole point of the module. A fresh REQUEST carrying a stale FACT is
     * the GOOGL case: a card priced off a mark from months earlier and labelled
     * "Current price". Judging by the fetch time would have called it fresh.
     */
    const v = assessFreshness(
      close({ effectiveAt: '2026-08-01', observedAt: '2026-09-08T20:59:30Z' }),
      DAILY_CLOSE_POLICY,
      NOW,
    )
    expect(v.state).toBe('stale')
    expect(v.reason).toMatch(/38 days old/)
  })

  it('reports a silent pipeline separately from a stale fact', () => {
    // The close is current, but nothing has refreshed it on schedule. Different
    // problem, different fix, so it must not read as the value being old.
    const v = assessFreshness(
      close({ effectiveAt: '2026-09-08', observedAt: '2026-08-20T22:00:00Z' }),
      DAILY_CLOSE_POLICY,
      NOW,
    )
    expect(v.state).toBe('stale')
    expect(v.reason).toBe('not refreshed on schedule')
    expect(v.ageDays).toBe(0)
  })

  it('does not apply a schedule check to a policy that has no schedule', () => {
    const v = assessFreshness(
      close({ effectiveAt: '2026-09-08', observedAt: '2020-01-01T00:00:00Z' }),
      { ...DAILY_CLOSE_POLICY, maxObservationAgeMs: undefined },
      NOW,
    )
    expect(v.state).toBe('fresh')
  })
})

describe('freshness is per data class, not one number', () => {
  it('gives each class its own window', () => {
    const classes = ['intraday_quote', 'daily_close', 'estimate', 'fundamental', 'reference'] as const
    const windows = classes.map(c => policyFor(c).maxAgeMs)
    // Five distinct windows. The point is that no two classes share a number,
    // so none of them can quietly become the definition of "fresh".
    expect(new Set(windows).size).toBe(classes.length)
  })

  it('orders the market-data classes by how fast each actually decays', () => {
    /**
     * Only the market-data classes form a scale: a quote decays in minutes, a
     * close in days, an estimate between revisions.
     *
     * `reference` and `fundamental` are deliberately NOT on that scale and are
     * not compared here. They are bounded by different things — a corporate
     * action for one, a reporting cycle for the other — and asserting an order
     * between them would be inventing a relationship to make a test tidy.
     */
    expect(policyFor('intraday_quote').maxAgeMs).toBeLessThan(policyFor('daily_close').maxAgeMs)
    expect(policyFor('daily_close').maxAgeMs).toBeLessThan(policyFor('estimate').maxAgeMs)
  })

  it('judges one value differently depending on what it is', () => {
    /**
     * The concrete reason the five-day constant must not become universal. A
     * value from eight days ago is a dead quote, a stale close, a perfectly
     * current estimate and an unremarkable sector label — all at once.
     */
    const eightDaysOld = close({ effectiveAt: '2026-08-31', observedAt: '2026-08-31T22:00:00Z' })
    expect(assessFreshness(eightDaysOld, INTRADAY_QUOTE_POLICY, NOW).state).toBe('stale')
    expect(assessFreshness(eightDaysOld, DAILY_CLOSE_POLICY, NOW).state).toBe('stale')
    expect(assessFreshness(eightDaysOld, ESTIMATE_POLICY, NOW).state).toBe('fresh')
    expect(assessFreshness(eightDaysOld, FUNDAMENTAL_POLICY, NOW).state).toBe('fresh')
    expect(assessFreshness(eightDaysOld, REFERENCE_POLICY, NOW).state).toBe('fresh')
  })

  it('carries the class and the basis on the verdict', () => {
    // So a surface can say "older than our conservative window" rather than
    // "the exchange has published something newer" — different claims, and
    // only the first is provable without a session calendar.
    const v = assessFreshness(close(), DAILY_CLOSE_POLICY, NOW)
    expect(v.dataClass).toBe('daily_close')
    expect(v.basis).toBe('calendar')
  })

  it('reports the basis on a missing verdict too, so absence is still labelled', () => {
    const v = assessFreshness(null, ESTIMATE_POLICY, NOW)
    expect(v).toMatchObject({ state: 'missing', dataClass: 'estimate', basis: 'calendar' })
  })

  it('marks every shipped policy as a calendar fallback', () => {
    // No exchange calendar exists yet. If one lands and this still passes for
    // daily_close, the session policy was not wired up.
    for (const c of ['intraday_quote', 'daily_close', 'estimate', 'fundamental', 'reference'] as const) {
      expect(isCalendarFallback(policyFor(c))).toBe(true)
    }
  })
})

describe('absence', () => {
  it('reports missing rather than a value', () => {
    const v = assessFreshness(null, DAILY_CLOSE_POLICY, NOW)
    expect(v).toMatchObject({ state: 'missing', ageMs: null, ageDays: null, reason: 'no value' })
  })

  it('treats an unparseable effective date as missing, never as fresh', () => {
    // The most dangerous guess available: it would make every value from a
    // broken adapter look current.
    const v = assessFreshness(close({ effectiveAt: 'not-a-date' }), DAILY_CLOSE_POLICY, NOW)
    expect(v.state).toBe('missing')
    expect(v.reason).toMatch(/no usable effective date/)
  })

  it('hands back null rather than a default when a value is not fresh', () => {
    expect(freshValue(close({ effectiveAt: '2026-01-01' }), DAILY_CLOSE_POLICY, NOW)).toBeNull()
    expect(freshValue(null, DAILY_CLOSE_POLICY, NOW)).toBeNull()
    expect(freshValue(close(), DAILY_CLOSE_POLICY, NOW)).toBe(187.4)
  })

  it('never reports a negative age when a clock runs slightly ahead', () => {
    const v = assessFreshness(close({ effectiveAt: '2026-09-08T21:05:00Z' }), INTRADAY_QUOTE_POLICY, NOW)
    expect(v.ageMs).toBe(0)
    expect(v.state).toBe('fresh')
  })
})

describe('comparability', () => {
  it('refuses two prices in different currencies', () => {
    expect(areComparable(close(), close({ currency: 'EUR' }))).toBe(false)
  })

  it('refuses a raw close against an adjusted one', () => {
    // Spans a corporate action. A 4-for-1 split makes this a 4x error that
    // renders as a price move.
    expect(areComparable(close({ adjustment: 'raw' }), close())).toBe(false)
  })

  it('refuses two values whose adjustment basis is unknown', () => {
    // Two things we cannot describe are not thereby the same thing.
    expect(areComparable(close({ adjustment: 'unknown' }), close({ adjustment: 'unknown' }))).toBe(false)
  })

  it('refuses a mark from a different month against a close', () => {
    const mark = close({
      effectiveAt: '2026-06-30',
      source: { provider: 'tesseract', feed: 'holdings', via: 'derived' },
    })
    expect(areComparable(mark, close())).toBe(false)
  })

  it('accepts two same-day, same-currency, same-basis values', () => {
    expect(areComparable(close(), close({ value: 188.1 }))).toBe(true)
  })

  it('refuses when either side is absent', () => {
    expect(areComparable(close(), null)).toBe(false)
    expect(areComparable(null, close())).toBe(false)
  })
})

describe('source description', () => {
  it('names the provider rather than inventing a label', () => {
    expect(describeSource(close())).toBe('yahoo (daily-bars)')
  })

  it('never calls anything "current"', () => {
    // The exact word that carried the GOOGL defect. No branch may produce it.
    for (const via of ['live', 'cache', 'derived', 'manual'] as const) {
      const text = describeSource(close({ source: { provider: 'p', via } }))
      expect(text.toLowerCase()).not.toContain('current')
    }
  })

  it('says so when there is nothing', () => {
    expect(describeSource(null)).toBe('No value')
  })
})
