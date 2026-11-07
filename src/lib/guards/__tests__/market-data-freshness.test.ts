/**
 * Whether the watchdog would have seen the outage it was written for.
 *
 * ── What it is watching ──────────────────────────────────────────────────
 *
 * From 2026-10-06 to 2026-11-07 the nightly ingestion failed every weekday
 * and the product served prices the whole time. The governing number is not
 * "did the job run" -- it is `LATEST_CLOSE_WINDOW_DAYS = 10` in
 * `src/lib/market-data/latest-closes.ts`: a symbol with nothing inside ten
 * days is ABSENT from the map the app builds, and every price for it falls
 * through to the undated `assets.current_price`, which was last written
 * 2026-08-18. Of 136 held symbols, 0 had a usable close, 66 showed a wrong
 * undated price and 70 had none at all.
 *
 * So the cases below are the real state of the tables on three dates: during
 * the outage, after the recovery, and at the edge of a long weekend where a
 * narrower window would report a working pipeline as broken.
 *
 * `assess` is imported rather than reimplemented. A test that restates the
 * arithmetic proves the test agrees with itself.
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { assess } from '../../../../scripts/check-market-data-freshness.mjs'

type Assessment = {
  failures: string[]
  unpriced: Array<{ pricing: string; book: string; age: number | null }>
  appliedExceptions: Array<{ pricing: string }>
  spentExceptions: Array<{ pricing: string }>
}

/** The thresholds the application actually acts on. */
const THRESHOLDS = { closeWindowDays: 10, newestCloseMaxAgeDays: 5, weightsMaxAgeDays: 10 }

/** A held universe, `pricing symbol -> book symbol`. */
const heldOf = (...symbols: string[]) => new Map(symbols.map((s) => [s, s]))

const run = (
  state: Record<string, unknown>,
  now: Date,
  thresholds = THRESHOLDS,
): Assessment => assess(state, thresholds, now) as Assessment

describe('during the October outage', () => {
  // The real table state on 2026-11-07: nothing newer than 2026-10-01.
  const NOW = new Date('2026-11-07T14:00:00Z')
  const held = heldOf('AAPL', 'GOOGL', 'AMD')
  const newest = new Map([['AAPL', '2026-10-01'], ['GOOGL', '2026-10-01'], ['AMD', '2026-10-01']])
  const state = { held, newest, newestOverall: '2026-10-01', weightDate: '2026-10-01' }

  it('fails, and reports all three dimensions', () => {
    const r = run(state, NOW)
    expect(r.failures).toHaveLength(3)
    expect(r.failures.join('\n')).toMatch(/newest close in price_history_cache is 37 days old/)
    expect(r.failures.join('\n')).toMatch(/3 of 3 held symbols have no close within 10 days/)
    expect(r.failures.join('\n')).toMatch(/benchmark weight file is 37 days old/)
  })

  it('says what it means for the product, not just that a number is large', () => {
    expect(run(state, NOW).failures.join('\n'))
      .toMatch(/falls through to the undated\s+assets\.current_price/)
  })

  it('names every unpriced symbol, so the alert is actionable', () => {
    expect(run(state, NOW).unpriced.map((u) => u.pricing).sort()).toEqual(['AAPL', 'AMD', 'GOOGL'])
  })
})

describe('after the recovery', () => {
  // The real table state on 2026-11-07 after the rotation and one run.
  const NOW = new Date('2026-11-07T14:00:00Z')
  const state = {
    held: heldOf('AAPL', 'GOOGL', 'AMD'),
    newest: new Map([['AAPL', '2026-11-06'], ['GOOGL', '2026-11-06'], ['AMD', '2026-11-06']]),
    newestOverall: '2026-11-06',
    weightDate: '2026-11-05',
  }

  it('passes', () => {
    expect(run(state, NOW).failures).toEqual([])
  })
})

describe('the long weekend the five-day window exists for', () => {
  /*
   * Friday's close is the latest available until the nightly job runs at
   * 22:00 UTC. With Monday a public holiday that is Tuesday 22:00, and a
   * reader at 21:59 that day is looking at a close four days and 22 hours
   * old. A narrower window reports that working pipeline as an outage, which
   * is how an alert gets muted.
   */
  it('does not report a Friday close read late on the following Tuesday', () => {
    const r = run(
      {
        held: heldOf('AAPL'),
        newest: new Map([['AAPL', '2026-11-02']]),
        newestOverall: '2026-11-02',
        weightDate: '2026-11-02',
      },
      new Date('2026-11-06T21:59:00Z'),
    )
    expect(r.failures).toEqual([])
  })
})

describe('partial failures, which a count alone would hide', () => {
  const NOW = new Date('2026-11-07T14:00:00Z')

  it('fails when the table is current overall but one held name is not', () => {
    // The shape a renamed or newly added ticker produces: everything else is
    // fine, so `max(date)` looks healthy and one book is unpriceable.
    const r = run({
      held: heldOf('AAPL', 'XYZ'),
      newest: new Map([['AAPL', '2026-11-06']]),
      newestOverall: '2026-11-06',
      weightDate: '2026-11-05',
    }, NOW)
    expect(r.failures.join('\n')).toMatch(/1 of 2 held symbols have no close/)
    expect(r.unpriced[0]).toMatchObject({ pricing: 'XYZ', age: null })
  })

  it('fails when prices are current but the index file has stopped', () => {
    // SSGA serves only the current file, so a run of missed days is
    // unrecoverable -- 2026-10-02 to 2026-11-04 is permanently lost. Catching
    // this early is the whole value.
    const r = run({
      held: heldOf('AAPL'),
      newest: new Map([['AAPL', '2026-11-06']]),
      newestOverall: '2026-11-06',
      weightDate: '2026-10-01',
    }, NOW)
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]).toMatch(/benchmark weight file is 37 days old/)
  })

  it('reports an empty table rather than dividing by it', () => {
    const r = run({
      held: heldOf('AAPL'), newest: new Map(), newestOverall: null, weightDate: null,
    }, NOW)
    expect(r.failures.join('\n')).toMatch(/price_history_cache is empty/)
    expect(r.failures.join('\n')).toMatch(/portfolio_benchmark_weights is empty/)
  })
})

describe('the known-unpriceable list', () => {
  const NOW = new Date('2026-11-07T14:00:00Z')

  it('sets AVB aside instead of going permanently red', () => {
    // AvalonBay was delisted around 2026-08-14 and no feed will price it
    // again. An alert that is red on the day it ships gets muted.
    const r = run({
      held: heldOf('AAPL', 'AVB'),
      newest: new Map([['AAPL', '2026-11-06'], ['AVB', '2026-08-24']]),
      newestOverall: '2026-11-06',
      weightDate: '2026-11-05',
    }, NOW)
    expect(r.failures).toEqual([])
    expect(r.appliedExceptions.map((e) => e.pricing)).toEqual(['AVB'])
  })

  it('still fails for a DIFFERENT symbol that is stale', () => {
    // The exception must not become a hole. This is the case that proves the
    // list suppresses one name rather than the assertion.
    const r = run({
      held: heldOf('AAPL', 'AVB'),
      newest: new Map([['AAPL', '2026-10-01'], ['AVB', '2026-08-24']]),
      newestOverall: '2026-10-01',
      weightDate: '2026-11-05',
    }, NOW)
    expect(r.failures.join('\n')).toMatch(/1 of 2 held symbols have no close/)
    expect(r.unpriced.map((u) => u.pricing)).toEqual(['AAPL'])
  })

  it('fails when an exception is no longer needed, so the list cannot rot', () => {
    const r = run({
      held: heldOf('AVB'),
      newest: new Map([['AVB', '2026-11-06']]),
      newestOverall: '2026-11-06',
      weightDate: '2026-11-05',
    }, NOW)
    expect(r.failures.join('\n')).toMatch(/AVB is listed in market-data-exceptions\.mjs but now prices fine/)
  })
})
