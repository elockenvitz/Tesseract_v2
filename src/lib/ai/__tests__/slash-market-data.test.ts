/**
 * How a retrieved figure is said.
 *
 * The read itself has its own suite (`hooks/ai/__tests__/useSlashReading`).
 * This is the wording: the figure, the source, the date, and the staleness
 * note -- the four things that have to appear together, because a number
 * arriving without them is the failure the market-data layer exists to
 * prevent and the one a reader cannot detect.
 *
 * Two rules are load-bearing here and each has its own case:
 *
 *   * nothing in this module may invent provenance. A row with no `source`
 *     says `unknown`, never a plausible vendor.
 *   * the figure and its provenance are ONE string. Separate returns are
 *     how a value ends up pasted into a message on its own.
 */

import { describe, it, expect } from 'vitest'
import {
  slashDataKind, isRetrievableData, formatReading, provenanceLine,
  stalenessNote, readingAsText, fallbackQuestion,
  SLASH_DATA_KIND, SLASH_DATA_BLOCKER, type SlashReading,
} from '../slash-market-data'
import type { FreshnessVerdict } from '../../market-data'

const verdict = (over: Partial<FreshnessVerdict> = {}): FreshnessVerdict => ({
  state: 'fresh',
  dataClass: 'daily_close',
  basis: 'calendar',
  ageMs: 0,
  ageDays: 0,
  observationAgeMs: 0,
  reason: null,
  ...over,
})

const ok = (over: Partial<SlashReading> = {}): SlashReading => ({
  state: 'ok',
  id: 'price',
  symbol: 'LRCX',
  observed: {
    value: 712.34,
    source: { provider: 'yahoo', feed: 'chart_v8', via: 'cache' },
    observedAt: '2026-11-12T22:03:00.000Z',
    effectiveAt: '2026-11-12',
    adjustment: 'unknown',
    currency: 'USD',
  },
  verdict: verdict(),
  label: 'Last close',
  ...over,
})

describe('which commands the store can answer', () => {
  it('splits the six by what price_history_cache holds', () => {
    expect(slashDataKind('price')).toBe('close')
    expect(slashDataKind('volume')).toBe('volume')
    expect(slashDataKind('change')).toBe('change')
    for (const id of ['marketcap', 'pe', 'dividend']) {
      expect(slashDataKind(id)).toBe('unsupported')
      expect(isRetrievableData(id)).toBe(false)
    }
  })

  it('treats an unknown id as unsupported rather than guessing', () => {
    expect(slashDataKind('ebitda')).toBe('unsupported')
    expect(isRetrievableData('')).toBe(false)
  })

  it('names the exact missing input for every unsupported command', () => {
    /*
     * "Not available" is the useless version. Each of these three names the
     * input it needs, because that is the difference between a gap the
     * reader can report and a feature that looks broken.
     */
    for (const [id, kind] of Object.entries(SLASH_DATA_KIND)) {
      if (kind !== 'unsupported') continue
      const blocker = SLASH_DATA_BLOCKER[id]
      expect(blocker, id).toBeTruthy()
      expect(blocker, id).toMatch(/shares outstanding|earnings|dividend history/i)
      /* And a route the reader can choose, with the symbol in it. */
      expect(fallbackQuestion(id, 'AAPL'), id).toContain('AAPL')
    }
  })

  it('offers no fallback question for a command the store CAN answer', () => {
    /* A fallback on `/price` would be the old behaviour wearing a label. */
    expect(fallbackQuestion('price', 'AAPL')).toBeNull()
    expect(fallbackQuestion('volume', 'AAPL')).toBeNull()
    expect(fallbackQuestion('change', 'AAPL')).toBeNull()
  })
})

describe('the figure', () => {
  it('shows a close as money, to the cent', () => {
    expect(formatReading(ok())).toBe('$712.34')
    expect(formatReading(ok({ observed: { ...ok().observed!, value: 7 } }))).toBe('$7.00')
  })

  it('shows volume as a whole grouped number', () => {
    const r = ok({ id: 'volume', observed: { ...ok().observed!, value: 4821900 } })
    expect(formatReading(r)).toBe('4,821,900')
  })

  it('differences two closes for a change, and signs the gain', () => {
    const up = ok({ id: 'change', previous: { close: 700, date: '2026-11-11' } })
    expect(formatReading(up)).toBe('+1.76%')
    const down = ok({
      id: 'change',
      observed: { ...ok().observed!, value: 690 },
      previous: { close: 700, date: '2026-11-11' },
    })
    expect(formatReading(down)).toBe('-1.43%')
  })

  it('refuses a change with no earlier close to compare', () => {
    /* A one-bar symbol would otherwise read as a 0% move, which is a claim. */
    expect(formatReading(ok({ id: 'change', previous: null }))).toBeNull()
    expect(formatReading(ok({ id: 'change', previous: { close: 0, date: 'x' } }))).toBeNull()
  })

  it('shows nothing for any state but ok', () => {
    for (const state of ['loading', 'empty', 'error'] as const) {
      expect(formatReading({ state, id: 'price', symbol: 'LRCX' })).toBeNull()
    }
    expect(formatReading(ok({ observed: null }))).toBeNull()
  })
})

describe('the provenance line', () => {
  it('says the provider, the feed, how it arrived and the date it was true', () => {
    expect(provenanceLine(ok())).toBe('yahoo (chart_v8), stored, as of 2026-11-12')
  })

  it('says the CLOSE date, not now', () => {
    /*
     * `effectiveAt` and `observedAt` are different facts: when the price was
     * true, and when we fetched it. A line built from the fetch time would
     * claim a Thursday close was today's.
     */
    const r = ok({
      observed: { ...ok().observed!, observedAt: '2026-11-13T09:00:00.000Z' },
    })
    expect(provenanceLine(r)).toContain('2026-11-12')
    expect(provenanceLine(r)).not.toContain('2026-11-13')
  })

  it('says unknown rather than naming a vendor it does not know', () => {
    /* Some rows predate the nightly job and were seeded by hand. Claiming
       Yahoo for those would be inventing provenance. */
    const r = ok({
      observed: { ...ok().observed!, source: { provider: 'unknown', via: 'cache' } },
    })
    expect(provenanceLine(r)).toBe('unknown, stored, as of 2026-11-12')
  })

  it('exists for every ok reading, with no exceptions', () => {
    /* A figure that can render without a source is a figure that will. */
    for (const id of ['price', 'volume', 'change']) {
      expect(provenanceLine(ok({ id })), id).toBeTruthy()
    }
  })
})

describe('the staleness note', () => {
  it('stays quiet when the figure is fresh', () => {
    expect(stalenessNote(ok())).toBeNull()
  })

  it('counts the days without claiming a newer close exists', () => {
    /*
     * A calendar-basis `stale` means "older than the conservative window",
     * NOT "the exchange has published something newer" -- only the first is
     * provable from here, so only the first may be said.
     */
    const note = stalenessNote(ok({ verdict: verdict({ state: 'stale', ageDays: 41 }) }))
    expect(note).toBe('This is 41 days old.')
    expect(note).not.toMatch(/newer|latest|outdated/i)
  })

  it('says one day in the singular', () => {
    expect(stalenessNote(ok({ verdict: verdict({ state: 'stale', ageDays: 1 }) })))
      .toBe('This is one day old.')
  })

  it('hedges only when the age is genuinely unknown', () => {
    expect(stalenessNote(ok({ verdict: verdict({ state: 'stale', ageDays: null }) })))
      .toBe('This figure may be out of date.')
  })
})

describe('what goes into the composer', () => {
  it('carries the figure and its provenance as one string', () => {
    const text = readingAsText(ok())!
    expect(text).toContain('$712.34')
    expect(text).toContain('yahoo')
    expect(text).toContain('2026-11-12')
    expect(text).toContain('LRCX')
  })

  it('never returns the bare figure', () => {
    /* THE case. A number inserted alone gets quoted into a message, then a
       note, with nothing saying where it came from. */
    for (const id of ['price', 'volume', 'change']) {
      const r = ok({ id, previous: { close: 700, date: '2026-11-11' } })
      const text = readingAsText(r)!
      const figure = formatReading(r)!
      expect(text, id).not.toBe(figure)
      expect(text, id).toContain(provenanceLine(r)!)
    }
  })

  it('returns nothing when there is no figure, including for no reading at all', () => {
    expect(readingAsText(null)).toBeNull()
    expect(readingAsText(undefined)).toBeNull()
    expect(readingAsText({ state: 'loading', id: 'price', symbol: 'LRCX' })).toBeNull()
    expect(readingAsText({ state: 'error', id: 'price', symbol: 'LRCX', detail: 'x' })).toBeNull()
    /* `ok` with an unformattable figure must also produce nothing rather
       than a sentence with a gap in it. */
    expect(readingAsText(ok({ id: 'change', previous: null }))).toBeNull()
  })

  it('uses the readers own label, never one of its own', () => {
    /*
     * `latestClose` returns "Last close" and never "Current price", because
     * a holdings mark carrying the second label is a defect this codebase
     * has already had. Nothing here may relabel it.
     */
    expect(readingAsText(ok())).toContain('last close')
    expect(readingAsText(ok())).not.toMatch(/current price/i)
  })
})
