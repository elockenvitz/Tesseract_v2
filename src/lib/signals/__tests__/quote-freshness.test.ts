import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { buildScenarioGapCard } from '../builders/scenarioGap'

/**
 * The stale-quote boundary, pinned so it cannot rot with the calendar.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `buildScenarioGapCard` refuses a quote older than four days, and reads
 * `Date.now()` to decide. Two suites carried fixtures whose `priceAsOf` was a
 * wall-clock instant, so they passed until the real date walked past it: on
 * 2026-09-03, fifteen assertions began failing with `suppressed: quote_stale`
 * three days after the date they were written against.
 *
 * The fix there was to freeze the clock to the fixture's own instant. This
 * file is the other half — it asserts the RULE directly, at both sides of the
 * boundary, so a future change to the limit is caught here as a deliberate
 * decision rather than discovered as a mass failure somewhere else.
 *
 * Nothing about the production policy moved. Four days is still four days.
 */

const NOW = new Date('2026-08-31T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
/** The limit `scenarioGap` enforces: beyond a long weekend, a price is a fault. */
const LIMIT_DAYS = 4

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })

const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString()

/** The ladder shape the builder needs to produce a card at all. */
const LADDER = [
  { id: 'c1', name: 'Bear', price: 200, probability: 20, timeframe: '12m' },
  { id: 'c2', name: 'Base', price: 300, probability: 55, timeframe: '12m' },
  { id: 'c3', name: 'Bull', price: 400, probability: 25, timeframe: '12m' },
]

const build = (priceAsOf: string) => buildScenarioGapCard({
  assetId: 'aapl', symbol: 'AAPL', companyName: 'Apple',
  price: 150, priceAsOf, cases: LADDER,
  statedAt: '2026-02-01T00:00:00.000Z',
  heldIn: [],
} as never)

describe('a quote is fresh enough, or it is a data fault', () => {
  it('accepts a quote from moments ago', () => {
    const r = build(at(60_000))
    expect(r.ok, r.ok ? '' : `suppressed: ${(r as any).reason}`).toBe(true)
  })

  it('accepts a close from over a long weekend', () => {
    /**
     * The case the limit exists for. A scenario ladder is a months-long view,
     * so comparing it to Friday's close is legitimate — the rule only refuses
     * a price old enough to be a fault.
     */
    expect(build(at(3 * DAY)).ok).toBe(true)
  })

  it('accepts a quote just inside the limit', () => {
    expect(build(at(LIMIT_DAYS * DAY - 60_000)).ok).toBe(true)
  })

  it('refuses a quote just outside it', () => {
    const r = build(at(LIMIT_DAYS * DAY + 60_000))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('quote_stale')
  })

  it('refuses a quote from the future', () => {
    // A negative age is a clock or data error, not a fresher price.
    const r = build(new Date(NOW.getTime() + DAY).toISOString())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('quote_stale')
  })

  it('refuses an unusable timestamp', () => {
    const r = build('not-a-date')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('quote_stale')
  })
})

describe('the clock is the test\'s, not the calendar\'s', () => {
  it('reads the frozen instant, so this suite cannot age', () => {
    /**
     * The guard against the bug returning. If `setSystemTime` ever stops
     * applying, `Date.now()` becomes the real clock and a fixture pinned to
     * 2026-08-31 starts failing again — this fails first, and says why.
     */
    expect(Date.now()).toBe(NOW.getTime())
  })
})
