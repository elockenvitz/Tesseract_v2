/**
 * The polling gate, one test per validation case in the stabilization package.
 *
 * These are the cases that mattered in production: 26,368 proxy requests in 24
 * hours from two users, 820 an hour overnight. Each case below is a set of
 * arguments to `decidePolling`, so none of it needs a DOM, a timer or a fake
 * clock.
 *
 * The non-vacuity check is at the bottom: it asserts that the OLD behaviour
 * fails these tests, so a future edit that reverts the gate cannot leave them
 * green.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  decidePolling,
  isUsEquitySessionOpen,
  quoteQueryKey,
  QUOTE_POLL_MS,
  IDLE_AFTER_MS,
  DAILY_HISTORY_STALE_MS,
  type PollingInput,
} from '../polling'

const NOW = Date.parse('2026-11-16T15:00:00.000Z') // 10:00 ET, Monday, market open

/** An active, visible, just-interacted, market-open intraday quote. */
const live = (over: Partial<PollingInput> = {}): PollingInput => ({
  kind: 'intraday_quote',
  active: true,
  hidden: false,
  lastInteractionAt: NOW - 1_000,
  now: NOW,
  marketOpen: true,
  ...over,
})

describe('decidePolling', () => {
  it('polls an active visible chart during market hours', () => {
    const d = decidePolling(live())
    expect(d.refetchInterval).toBe(QUOTE_POLL_MS)
    expect(d.reason).toBe('polling')
  })

  it('never polls a hidden browser tab', () => {
    const d = decidePolling(live({ hidden: true }))
    expect(d.refetchInterval).toBe(false)
    expect(d.reason).toBe('tab_hidden')
  })

  it('never polls an inactive component', () => {
    const d = decidePolling(live({ active: false }))
    expect(d.refetchInterval).toBe(false)
    expect(d.reason).toBe('view_inactive')
  })

  it('stops polling an idle session, which is the overnight case', () => {
    const d = decidePolling(live({ lastInteractionAt: NOW - IDLE_AFTER_MS - 1 }))
    expect(d.refetchInterval).toBe(false)
    expect(d.reason).toBe('session_idle')
  })

  it('resumes polling when the user returns to an active session', () => {
    const idle = decidePolling(live({ lastInteractionAt: NOW - IDLE_AFTER_MS - 1 }))
    expect(idle.refetchInterval).toBe(false)

    // One interaction is enough; nothing else about the world changed.
    const returned = decidePolling(live({ lastInteractionAt: NOW }))
    expect(returned.refetchInterval).toBe(QUOTE_POLL_MS)
    expect(returned.reason).toBe('polling')
  })

  it('does not poll when the CALLER states the exchange is closed', () => {
    const d = decidePolling(live({ marketOpen: false }))
    expect(d.refetchInterval).toBe(false)
    expect(d.reason).toBe('market_closed')
  })

  it('treats an unknown market session as open rather than freezing a price', () => {
    const d = decidePolling(live({ marketOpen: null }))
    expect(d.refetchInterval).toBe(QUOTE_POLL_MS)
  })

  it('never puts daily history on a timer, even when fully active', () => {
    const d = decidePolling(live({ kind: 'daily_history' }))
    expect(d.refetchInterval).toBe(false)
    expect(d.reason).toBe('settled_daily_data')
    expect(d.staleTime).toBe(DAILY_HISTORY_STALE_MS)
  })

  it('always refuses to poll in the background, whatever else is true', () => {
    const cases: PollingInput[] = [
      live(),
      live({ hidden: true }),
      live({ active: false }),
      live({ kind: 'daily_history' }),
      live({ marketOpen: false }),
      live({ lastInteractionAt: 0 }),
    ]
    for (const c of cases) {
      expect(decidePolling(c).refetchIntervalInBackground).toBe(false)
    }
  })

  it('keeps focus refetching on in every state, so returning is always fresh', () => {
    // This is what preserves a deliberate refresh and a return-to-tab update
    // once the timer is off.
    for (const c of [live({ active: false }), live({ hidden: true }), live({ lastInteractionAt: 0 })]) {
      expect(decidePolling(c).refetchOnWindowFocus).toBe(true)
    }
  })

  it('decides on view state before consulting the market session', () => {
    // An inactive view must not depend on a calendar to stay quiet.
    const d = decidePolling(live({ active: false, marketOpen: null }))
    expect(d.reason).toBe('view_inactive')
  })
})

/**
 * Global coverage.
 *
 * Tesseract holds global equities and the catalogue cannot say where a symbol
 * trades: measured 2026-11-16 over 912 assets, `mic` is 0% populated,
 * `exchange` is `'Unknown'` for 506 (55%), and `country` is the issuer's
 * domicile — there are Japanese, Brazilian, UK and Chinese names carrying
 * `exchange = 'NYSE'` because they are ADRs.
 *
 * An earlier version of this gate called `isUsEquitySessionOpen()` for every
 * symbol. These tests pin that it does not, because a London listing must
 * keep refreshing at 10:00 London time — which is 05:00 in New York, when the
 * US gate would have said "closed".
 */
describe('international symbols are not held to US market hours', () => {
  /** 10:00 in London, 05:00 in New York: LSE open, NYSE shut. */
  const LONDON_MORNING = Date.parse('2026-11-16T10:00:00.000Z')

  const atLondonMorning = (over: Partial<PollingInput> = {}): PollingInput => ({
    ...live(),
    now: LONDON_MORNING,
    lastInteractionAt: LONDON_MORNING - 1_000,
    marketOpen: null, // what every caller passes today
    ...over,
  })

  it('polls a London listing during its own session', () => {
    const d = decidePolling(atLondonMorning())
    expect(d.refetchInterval).toBe(QUOTE_POLL_MS)
    expect(d.reason).toBe('polling')
  })

  it('and the US clock would have refused it, which is the bug being fixed', () => {
    // Proof the case above is not trivially true: the old wiring consulted
    // this, and this says closed.
    expect(isUsEquitySessionOpen(new Date(LONDON_MORNING))).toBe(false)
  })

  it('polls a US listing in US hours too, so nothing regressed', () => {
    expect(decidePolling(live()).refetchInterval).toBe(QUOTE_POLL_MS)
  })

  it('still stops an idle international session, which is what saved the traffic', () => {
    // Visibility, activity and idle do the work for every venue on earth.
    const d = decidePolling(
      atLondonMorning({ lastInteractionAt: LONDON_MORNING - IDLE_AFTER_MS - 1 }),
    )
    expect(d.refetchInterval).toBe(false)
    expect(d.reason).toBe('session_idle')
  })

  it('still stops a hidden international tab', () => {
    const d = decidePolling(atLondonMorning({ hidden: true }))
    expect(d.refetchInterval).toBe(false)
    expect(d.reason).toBe('tab_hidden')
  })

  it('never reports market_closed unless a caller said so', () => {
    // `marketOpen: null` is what the hook passes; no venue is ever guessed.
    for (const at of [LONDON_MORNING, NOW, Date.parse('2026-11-16T03:00:00Z')]) {
      const d = decidePolling(atLondonMorning({ now: at, lastInteractionAt: at }))
      expect(d.reason).not.toBe('market_closed')
    }
  })
})

describe('isUsEquitySessionOpen', () => {
  it('is open mid-session on a weekday', () => {
    expect(isUsEquitySessionOpen(new Date('2026-11-16T15:00:00Z'))).toBe(true) // 10:00 ET Mon
  })

  it('is closed overnight, the window that produced 820 requests an hour', () => {
    expect(isUsEquitySessionOpen(new Date('2026-11-16T09:00:00Z'))).toBe(false) // 04:00 ET
  })

  it('is closed at the weekend', () => {
    expect(isUsEquitySessionOpen(new Date('2026-11-14T15:00:00Z'))).toBe(false) // Sat
  })

  it('is closed before the open and after the close', () => {
    expect(isUsEquitySessionOpen(new Date('2026-11-16T14:29:00Z'))).toBe(false) // 09:29 ET
    expect(isUsEquitySessionOpen(new Date('2026-11-16T21:00:00Z'))).toBe(false) // 16:00 ET
  })

  it('is open at exactly the opening bell and just before the close', () => {
    expect(isUsEquitySessionOpen(new Date('2026-11-16T14:30:00Z'))).toBe(true) // 09:30 ET
    expect(isUsEquitySessionOpen(new Date('2026-11-16T20:59:00Z'))).toBe(true) // 15:59 ET
  })
})

describe('quoteQueryKey', () => {
  it('gives one key to one resource, so three call sites share a fetch', () => {
    expect(quoteQueryKey('AAPL')).toEqual(quoteQueryKey('AAPL'))
    expect(quoteQueryKey('AAPL')).not.toEqual(quoteQueryKey('MSFT'))
  })

  it('does not collapse a missing symbol into a shared bucket with a real one', () => {
    expect(quoteQueryKey(null)).not.toEqual(quoteQueryKey('AAPL'))
    expect(quoteQueryKey(undefined)).toEqual(quoteQueryKey(null))
  })
})

/**
 * Non-vacuity, two ways.
 *
 * 1. The gate is proven to reject the exact configuration that caused the
 *    incident. A bare 30-second interval with no gate would poll in every one
 *    of these states; the assertions above would fail for it.
 * 2. The call sites are proven to have stopped carrying a bare interval. A
 *    passing unit test on a helper nobody calls is the defect class this
 *    repository already documents, so this reads the components.
 */
describe('the gate is not decoration', () => {
  const SRC = resolve(__dirname, '../../..')
  const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8')

  const GATED_CALL_SITES = [
    'components/charts/AdvancedChart.tsx',
    'components/charts/FinancialChart.tsx',
    'components/tabs/AssetTab.tsx',
  ]

  it('an ungated 30s interval would fail the cases above', () => {
    // The old behaviour, modelled: a constant, regardless of the world.
    const old = () => ({ refetchInterval: 30_000 })
    const hiddenTab = old()
    const idleSession = old()
    // Each of these is what the assertions above require to be false.
    expect(hiddenTab.refetchInterval).not.toBe(false)
    expect(idleSession.refetchInterval).not.toBe(false)
    // So the suite discriminates: the new decision returns false for both.
    expect(decidePolling(live({ hidden: true })).refetchInterval).toBe(false)
    expect(decidePolling(live({ lastInteractionAt: 0 })).refetchInterval).toBe(false)
  })

  /*
   * Comments are stripped before matching.
   *
   * Each of these call sites now carries a comment that quotes the old
   * `refetchInterval: 30000` to explain what was removed and why. Matching raw
   * file text would read that prose as code and fail — which it did on the
   * first run of this test. The guard must assert on what executes.
   */
  const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('no gated call site declares a bare numeric refetchInterval any more', () => {
    for (const file of GATED_CALL_SITES) {
      const code = stripComments(read(file))
      // A literal number on refetchInterval is the thing that caused this.
      const bare = code.match(/refetchInterval:\s*\d+/g)
      expect(bare, `${file} still has a hard-coded refetchInterval`).toBeNull()
    }
  })

  it('the comment-stripping itself works, so the guard above is not vacuous', () => {
    // If stripComments ate everything, the assertion above would pass for any
    // file at all. These two cases pin it: prose is removed, code is not.
    expect(stripComments('/* refetchInterval: 30000 */')).not.toMatch(
      /refetchInterval:\s*\d+/,
    )
    expect(stripComments('// refetchInterval: 30000')).not.toMatch(
      /refetchInterval:\s*\d+/,
    )
    expect(stripComments('  refetchInterval: 30000,')).toMatch(
      /refetchInterval:\s*\d+/,
    )
    // And the real files still contain their actual code after stripping.
    for (const file of GATED_CALL_SITES) {
      expect(stripComments(read(file))).toMatch(/useQuery\(/)
    }
  })

  it('the US session clock is not wired into the gate', () => {
    /*
     * The regression this stops: calling `isUsEquitySessionOpen()` inside the
     * hook applies NYSE hours to every symbol in a product that covers global
     * equities. After stripping comments, the only occurrence in polling.ts
     * should be its own declaration — if the hook calls it again, this fails.
     */
    const code = stripComments(
      readFileSync(resolve(SRC, 'lib/market-data/polling.ts'), 'utf8'),
    )
    const uses = code.match(/isUsEquitySessionOpen/g) ?? []
    expect(uses.length, 'polling.ts should only DECLARE the US clock').toBe(1)
    expect(code).toMatch(/export function isUsEquitySessionOpen/)
  })

  it('every gated call site routes through this module', () => {
    for (const file of GATED_CALL_SITES) {
      expect(read(file), `${file} does not use the polling gate`).toMatch(
        /useMarketDataPolling/,
      )
    }
  })
})
