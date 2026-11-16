/**
 * When market data may refetch itself.
 *
 * ── The defect class this exists to make impossible ───────────────────────
 *
 * Measured in production over 24 hours on 2026-11-16: the `yahoo-chart-proxy`
 * edge function served **26,368 requests from two users across four sessions**,
 * of which 2,725 (10.3%) failed with 502. Volume held at roughly 820 requests
 * per hour from 02:00 to 09:00, when nobody was working, in bursts of about 15
 * and about 65 symbols every six minutes or so.
 *
 * Nothing was wrong with the fetching. The requests were issued by three
 * `refetchInterval: 30000` call sites that had no idea whether anyone was
 * looking:
 *
 *   src/components/charts/AdvancedChart.tsx:209
 *   src/components/charts/FinancialChart.tsx:36
 *   src/components/tabs/AssetTab.tsx:2327
 *
 * The six-minute burst spacing is the 30-second timer meeting
 * `browser-client`'s five-minute in-memory cache: the timer fires ten times,
 * nine are absorbed, the tenth goes to the network. So the cache was doing its
 * job and the cadence was still wrong by two orders of magnitude, because a
 * tab left open on a second monitor polls until the laptop sleeps.
 *
 * Two neighbouring components already got this right and gate on `isLive`
 * (`ChartView.tsx:81`, `DataValueView.tsx:64`). This module is that idea made
 * shared and explicit, so a fourth call site cannot reintroduce the storm by
 * typing a number.
 *
 * ── Why a pure function and a hook, not just a hook ───────────────────────
 *
 * `decidePolling` takes the world as arguments and returns a decision. That is
 * what the tests exercise: every validation case in the stabilization package
 * (active, hidden, inactive, idle, returning, provider failure, manual
 * refresh) is a set of arguments, with no DOM and no timers. The hook is a
 * thin adapter that reads the real world and calls it.
 *
 * ── What this module deliberately does NOT do ─────────────────────────────
 *
 * It does not fetch, cache, dedupe or retry. Those are TanStack Query's job
 * and it already does them well; this only decides the cadence and hands back
 * an options object. It is not a polling framework.
 */

import { useEffect, useMemo, useState } from 'react'

/**
 * What kind of market data a query carries.
 *
 * The distinction is the point. A daily close is a fact about a day that is
 * settled once and never moves again, so polling it on a timer is pure waste.
 * An intraday quote is a fact about right now. Conflating them is how a
 * sparkline of daily bars came to be refetched every thirty seconds.
 */
export type MarketDataKind = 'intraday_quote' | 'daily_history'

/** Why the decision came out the way it did. Carried so a surface can say so. */
export type PollingReason =
  /** The view is not on screen, collapsed, or has no symbol. */
  | 'view_inactive'
  /** Nobody has interacted for a while. The overnight case. */
  | 'session_idle'
  /** The browser tab is hidden. */
  | 'tab_hidden'
  /** US equities are closed, so an intraday quote cannot change. */
  | 'market_closed'
  /** Daily bars do not need a timer at all. */
  | 'settled_daily_data'
  /** Polling, for the stated interval. */
  | 'polling'

export interface PollingInput {
  kind: MarketDataKind
  /**
   * Whether the consuming view is actually presenting this data: mounted,
   * on screen, expanded, and holding a symbol. The caller knows; this cannot.
   */
  active: boolean
  /** `document.hidden`. */
  hidden: boolean
  /** Epoch ms of the last user interaction anywhere in the app. */
  lastInteractionAt: number
  /** Epoch ms. Injected so tests need no clock control. */
  now: number
  /**
   * Whether the US equity market is open, or `null` when unknown.
   *
   * `null` is treated as open: an unknown session must not silently freeze a
   * price a trader is reading. Failing toward one extra request is the right
   * direction for this particular unknown.
   */
  marketOpen: boolean | null
}

export interface PollingDecision {
  /** Straight into TanStack Query. `false` means no timer. */
  refetchInterval: number | false
  /**
   * Always false. A hidden tab must never poll.
   *
   * This is TanStack's default, and it is set explicitly anyway: the default
   * is the thing that was silently relied on and still produced 820 requests
   * an hour, because the tabs were visible and merely unattended.
   */
  refetchIntervalInBackground: false
  /** How long a fetched value is considered current. */
  staleTime: number
  /** Refetch when the user comes back to the tab. */
  refetchOnWindowFocus: boolean
  reason: PollingReason
}

/**
 * Cadences.
 *
 * `QUOTE_POLL_MS` is 60s, not the 30s it replaces. Thirty seconds was not
 * chosen for a trading reason — the product shows research context, not a
 * ticket blotter, and every consumer of it already renders an explicit
 * as-of label. Sixty seconds halves the request rate on its own, before any
 * gate applies.
 */
export const QUOTE_POLL_MS = 60_000

/** A quote is current for half its poll interval. */
export const QUOTE_STALE_MS = 30_000

/**
 * Daily bars are refetched on focus, never on a timer, and treated as current
 * for twelve hours. A close that has already happened does not change, and the
 * next one cannot arrive sooner than the next session.
 */
export const DAILY_HISTORY_STALE_MS = 12 * 60 * 60_000

/**
 * How long without interaction before a visible tab stops polling.
 *
 * Fifteen minutes is long enough to read a page, a chart and a thesis without
 * the data going quiet underneath, and short enough that a tab abandoned at
 * 17:00 is silent by 17:15 rather than at dawn. Returning to the tab resumes
 * immediately via `refetchOnWindowFocus` plus the next interaction.
 */
export const IDLE_AFTER_MS = 15 * 60_000

/**
 * The cadence decision.
 *
 * Order matters and is deliberate: the cheapest and most certain reasons to
 * NOT poll are checked first, so a decision never depends on a session
 * calendar when the view is not even on screen.
 */
export function decidePolling(input: PollingInput): PollingDecision {
  const { kind, active, hidden, lastInteractionAt, now, marketOpen } = input

  const base = {
    refetchIntervalInBackground: false as const,
    staleTime: kind === 'daily_history' ? DAILY_HISTORY_STALE_MS : QUOTE_STALE_MS,
    refetchOnWindowFocus: true,
  }

  if (!active) {
    return { ...base, refetchInterval: false, reason: 'view_inactive' }
  }

  if (hidden) {
    return { ...base, refetchInterval: false, reason: 'tab_hidden' }
  }

  // Daily bars never poll. They are settled facts; focus and mount are enough.
  if (kind === 'daily_history') {
    return { ...base, refetchInterval: false, reason: 'settled_daily_data' }
  }

  if (now - lastInteractionAt >= IDLE_AFTER_MS) {
    return { ...base, refetchInterval: false, reason: 'session_idle' }
  }

  // `null` means unknown, and unknown polls. Only a definite closure stops it.
  if (marketOpen === false) {
    return { ...base, refetchInterval: false, reason: 'market_closed' }
  }

  return { ...base, refetchInterval: QUOTE_POLL_MS, reason: 'polling' }
}

/**
 * Whether US equities are in the regular session, by wall clock.
 *
 * Calendar-only and deliberately so: 09:30 to 16:00 America/New_York,
 * Monday to Friday. It does NOT know holidays, half days or early closes, so
 * it will report open on Thanksgiving. That is the conservative direction for
 * this decision — the cost of being wrong is one extra poll per minute on a
 * day the price will not move, and the alternative is an exchange calendar,
 * which `freshness.ts` already names as out of scope (`FreshnessBasis`
 * `'session'` is declared and unimplemented for the same reason).
 *
 * Returns `null` when the environment cannot tell us the time zone, so the
 * caller gets "unknown" rather than a confident wrong answer.
 */
export function isUsEquitySessionOpen(at: Date = new Date()): boolean | null {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at)
  } catch {
    return null
  }

  const get = (type: string) => parts.find(p => p.type === type)?.value
  const weekday = get('weekday')
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))

  if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (weekday === 'Sat' || weekday === 'Sun') return false

  const minutes = hour * 60 + minute
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

/**
 * One shared record of when the user last did anything, and whether the tab is
 * visible.
 *
 * Module-level rather than per-hook on purpose. Ten charts on a page must not
 * install ten sets of listeners, and more importantly they must agree: a page
 * where one chart thinks the session is idle and its neighbour does not is the
 * inconsistency this whole module exists to remove.
 */
interface ActivitySnapshot {
  lastInteractionAt: number
  hidden: boolean
}

type ActivityListener = (snapshot: ActivitySnapshot) => void

const INTERACTION_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
] as const

/** Interactions are frequent and cheap to ignore; only notify at most this often. */
const ACTIVITY_NOTIFY_THROTTLE_MS = 5_000

class ActivityTracker {
  private snapshot: ActivitySnapshot
  private listeners = new Set<ActivityListener>()
  private installed = false
  private lastNotifiedAt = 0

  constructor() {
    this.snapshot = {
      lastInteractionAt: Date.now(),
      hidden: typeof document !== 'undefined' ? document.hidden : false,
    }
  }

  get current(): ActivitySnapshot {
    return this.snapshot
  }

  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener)
    this.install()
    return () => {
      this.listeners.delete(listener)
    }
  }

  private install() {
    if (this.installed) return
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    this.installed = true

    for (const event of INTERACTION_EVENTS) {
      window.addEventListener(event, this.onInteraction, { passive: true })
    }
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private onInteraction = () => {
    const now = Date.now()
    const wasIdle = now - this.snapshot.lastInteractionAt >= IDLE_AFTER_MS
    this.snapshot = { ...this.snapshot, lastInteractionAt: now }

    // Notify immediately when coming back from idle, so polling resumes on the
    // first click rather than up to five seconds later. Otherwise throttle.
    if (wasIdle || now - this.lastNotifiedAt >= ACTIVITY_NOTIFY_THROTTLE_MS) {
      this.lastNotifiedAt = now
      this.emit()
    }
  }

  private onVisibility = () => {
    const hidden = document.hidden
    // Becoming visible is an interaction: the user came back.
    this.snapshot = {
      hidden,
      lastInteractionAt: hidden ? this.snapshot.lastInteractionAt : Date.now(),
    }
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener(this.snapshot)
  }
}

const activityTracker = new ActivityTracker()

/** Exposed for tests only. */
export const __activityTrackerForTests = activityTracker

export interface UseMarketDataPollingOptions {
  kind: MarketDataKind
  /** Whether this view is presenting the data right now. */
  active?: boolean
}

/**
 * The hook form: reads the real world and returns TanStack Query options.
 *
 * Spread the result into `useQuery`. It sets `refetchInterval`,
 * `refetchIntervalInBackground`, `staleTime` and `refetchOnWindowFocus`, and
 * nothing else — `queryKey`, `queryFn` and `enabled` stay with the caller,
 * and an explicit `refetch()` is untouched, so a deliberate user refresh still
 * works while the timer is off.
 */
export function useMarketDataPolling(
  options: UseMarketDataPollingOptions,
): PollingDecision {
  const { kind, active = true } = options

  /*
   * Both pieces of state are declared before any effect that writes them.
   *
   * `setNow` is referenced inside the subscription callback below. A `const`
   * is not hoisted, and although the callback only runs after the body has
   * finished, declaring it afterwards is the shape that produced a
   * render-breaking temporal dead zone in banner code once already. Order is
   * load-bearing here, not stylistic.
   *
   * `now` is held in state rather than read as `Date.now()` inside the memo so
   * that the memo genuinely depends on it, and so the idle comparison and the
   * market-session check are answered against the same instant.
   */
  const [activity, setActivity] = useState<ActivitySnapshot>(
    () => activityTracker.current,
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(
    () =>
      activityTracker.subscribe(next => {
        setActivity(next)
        // Re-read the clock on every activity change, so a decision made just
        // after the user returns is not computed against a minute-old `now`.
        setNow(Date.now())
      }),
    [],
  )

  /*
   * A slow timer, because a session that goes idle while nothing else changes
   * must still stop polling. Without it the decision would stay 'polling'
   * until the next interaction — and no interaction is precisely the state
   * being fixed.
   */
  useEffect(() => {
    if (!active || kind === 'daily_history') return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [active, kind])

  return useMemo(
    () =>
      decidePolling({
        kind,
        active,
        hidden: activity.hidden,
        lastInteractionAt: activity.lastInteractionAt,
        now,
        marketOpen:
          kind === 'intraday_quote' ? isUsEquitySessionOpen(new Date(now)) : null,
      }),
    [kind, active, activity.hidden, activity.lastInteractionAt, now],
  )
}

/** Just the TanStack Query fields, without the explanatory `reason`. */
export type PollingQueryOptions = Omit<PollingDecision, 'reason'>

/**
 * Strip `reason` so the rest can be spread into `useQuery` verbatim.
 *
 * `reason` is deliberately part of the decision — a surface that wants to say
 * "paused, market closed" needs it — but it is not a query option, and
 * spreading an unknown key into `useQuery` is how an options object quietly
 * stops being type-checked.
 */
export function pollingQueryOptions(decision: PollingDecision): PollingQueryOptions {
  // Named explicitly rather than spread-and-omit, so a field added to
  // `PollingDecision` later cannot silently become a `useQuery` option.
  return {
    refetchInterval: decision.refetchInterval,
    refetchIntervalInBackground: decision.refetchIntervalInBackground,
    staleTime: decision.staleTime,
    refetchOnWindowFocus: decision.refetchOnWindowFocus,
  }
}

/**
 * The canonical query key for a single symbol's latest quote.
 *
 * Three call sites fetched the same quote under three different keys —
 * `['advanced-chart-quote', symbol]`, `['financial-chart-quote', symbol]` and
 * AssetTab's own — so TanStack treated one resource as three and could not
 * dedupe or share a single byte between them. An asset page showing a chart
 * and a header quote fetched the same number twice.
 *
 * One key, so the cache does what it was already capable of doing.
 */
export function quoteQueryKey(symbol: string | null | undefined) {
  return ['market-data', 'quote', symbol ?? null] as const
}
