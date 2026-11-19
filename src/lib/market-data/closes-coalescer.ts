/**
 * One request for a symbol, however many callers ask for it.
 *
 * ── The defect this removes ───────────────────────────────────────────────
 *
 * Measured on the production Dashboard (main `ad173b9a`, Chrome, cold load):
 * 163 API requests, of which **46 were `price_history_cache`** across 37
 * distinct symbol groups, 31.0s of cumulative request time spread over 6.9s.
 * `AAPL` was fetched in at least four separate requests. Three of the groups
 * observed:
 *
 *     in.(AAPL,CROX,DASH,GOOGL,LLY)
 *     in.(MCD,MSFT,TGT,UPS)
 *     in.(AAPL,CROX,DASH,GOOGL,LLY,MCD,TGT,UPS)   <- a strict superset
 *
 * It is tempting to read that as a chunking bug. It is not.
 * `fetchDailyCloses` sizes each request at `floor(ROW_CAP / days)` precisely
 * so a response cannot be silently truncated at the PostgREST 1000-row cap --
 * that invariant is load-bearing and is NOT what this module touches. The
 * groups of five and of eight are two callers asking for different WINDOWS
 * (180 days -> chunk 5, ~125 days -> chunk 8), each correctly chunked.
 *
 * The waste is one level up: roughly a dozen hooks -- `useDayPerformance`,
 * `useTileCloses`, `useTodayEnrichment`, `useDesktopIdeas`,
 * `useDecisionAccountability`, the lists and signals surfaces -- each call
 * `fetchDailyCloses` with their OWN symbol list and their OWN window. Each
 * sits behind its own React Query key, so React Query dedupes none of it:
 * every hook is asking a different question, and the answers overlap almost
 * completely.
 *
 * ── Why the fix is here and not in the call sites ─────────────────────────
 *
 * Changing a dozen hooks to share one key would mean inventing a coordinator
 * that knows every surface's symbol set before any of them has mounted, and
 * would couple surfaces that are deliberately independent. Coalescing at the
 * fetch boundary fixes all of them at once, changes no call site, and cannot
 * alter what any caller receives.
 *
 * ── The two mechanisms, and why both are needed ───────────────────────────
 *
 * The 46 requests arrive over 6.9 SECONDS, not in one tick, because each hook
 * fetches once its own dependencies resolve. So:
 *
 *   a batch window   collapses callers that land in the same turn of the
 *                    event loop into one request per window.
 *   a held window    collapses callers that land seconds apart. A symbol
 *                    already fetched for >= the requested number of days is
 *                    served from what is held, sliced to the asked-for floor.
 *
 * ── What this deliberately does NOT change ────────────────────────────────
 *
 * Freshness. `HOLD_MS` is 15 seconds -- long enough to cover a mount storm,
 * short enough that it never substitutes for a caller's own `staleTime`,
 * which continues to govern every refetch after the storm. A caller that
 * revalidates a minute later still goes to the network. This is a burst
 * coalescer, not a cache.
 *
 * Nor does it change tenant isolation: `price_history_cache` is global
 * reference data keyed by symbol with no organization column, so two readers
 * in different organizations asking for `AAPL` are asking the identical
 * question. Nothing org-scoped passes through here. Provider entitlement is
 * decided upstream, before a symbol ever reaches this module.
 */
import type { DailyClose } from './daily-closes'

/** How long a fetched window stays eligible to answer a later caller. */
export const HOLD_MS = 15_000

/**
 * How long to gather callers before issuing a request.
 *
 * Zero would still coalesce every caller in the same microtask queue drain.
 * A small macrotask also catches the next effect flush, which is where a
 * sibling hook's `queryFn` usually lands.
 */
export const BATCH_MS = 20

/** What was fetched for a symbol, and how deep it goes. */
interface Held {
  days: number
  rows: DailyClose[]
  at: number
}

/** The raw fetch this module coalesces, injected so tests can count it. */
export type ClosesFetcher = (
  symbols: readonly string[],
  opts: { days: number; chunk?: number },
) => Promise<DailyClose[]>

const held = new Map<string, Held>()

interface Waiter {
  symbols: string[]
  days: number
  resolve: (rows: DailyClose[]) => void
  reject: (err: unknown) => void
}

interface Pending {
  days: number
  chunk?: number
  symbols: Set<string>
  waiters: Waiter[]
  timer: ReturnType<typeof setTimeout> | null
}

/*
 * Keyed by window depth. Two callers wanting different depths cannot share a
 * request -- the shallower one would be served rows it did not ask for and
 * the deeper one rows it needs and would not get -- but they CAN both be
 * served later from whichever window turns out to be the wider.
 */
const pending = new Map<number, Pending>()

const floorFrom = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

/** What is held for `symbol`, if it is deep enough and recent enough. */
function heldFor(symbol: string, days: number, now: number): DailyClose[] | null {
  const entry = held.get(symbol)
  if (!entry) return null
  if (now - entry.at > HOLD_MS) return null
  /* A 180-day window answers a 12-day question. The reverse is not true. */
  if (entry.days < days) return null
  const floor = floorFrom(days)
  return entry.rows.filter(r => r.date >= floor)
}

function remember(rows: readonly DailyClose[], symbols: Iterable<string>, days: number) {
  const now = Date.now()
  const grouped = new Map<string, DailyClose[]>()
  for (const row of rows) {
    const list = grouped.get(row.symbol)
    if (list) list.push(row)
    else grouped.set(row.symbol, [row])
  }
  /*
   * Every symbol ASKED for is recorded, including those that came back with
   * no rows. A symbol absent from the cache is a real answer -- "this one has
   * no closes" -- and not recording it would send the next caller back to the
   * database for the same empty result.
   */
  for (const symbol of symbols) {
    const existing = held.get(symbol)
    /* Never narrow a deeper window that is still live. */
    if (existing && existing.days > days && now - existing.at <= HOLD_MS) continue
    held.set(symbol, { days, rows: grouped.get(symbol) ?? [], at: now })
  }
}

async function flush(days: number, fetcher: ClosesFetcher) {
  const batch = pending.get(days)
  if (!batch) return
  pending.delete(days)
  if (batch.timer) clearTimeout(batch.timer)

  const wanted = [...batch.symbols]
  try {
    const rows = wanted.length
      ? await fetcher(wanted, { days, chunk: batch.chunk })
      : []
    remember(rows, wanted, days)
    const now = Date.now()
    for (const waiter of batch.waiters) {
      const out: DailyClose[] = []
      for (const symbol of waiter.symbols) {
        out.push(...(heldFor(symbol, waiter.days, now) ?? []))
      }
      waiter.resolve(out)
    }
  } catch (err) {
    /*
     * A failed batch fails every caller in it, which is the same outcome each
     * would have had on its own. Nothing is held, so the next caller retries
     * rather than inheriting the failure.
     */
    for (const symbol of wanted) held.delete(symbol)
    for (const waiter of batch.waiters) waiter.reject(err)
  }
}

/**
 * Fetch daily closes, sharing a request with any caller asking concurrently
 * or recently for the same window.
 *
 * Returns rows for exactly the symbols asked for, in no guaranteed order --
 * the same contract `fetchDailyCloses` already had, whose callers all funnel
 * through `bySymbol()`.
 */
export function coalescedCloses(
  symbols: readonly string[],
  { days, chunk }: { days: number; chunk?: number },
  fetcher: ClosesFetcher,
): Promise<DailyClose[]> {
  const unique = [...new Set(symbols)].filter(Boolean)
  if (unique.length === 0) return Promise.resolve([])

  const now = Date.now()
  const settled: DailyClose[] = []
  const missing: string[] = []
  for (const symbol of unique) {
    const rows = heldFor(symbol, days, now)
    if (rows) settled.push(...rows)
    else missing.push(symbol)
  }

  /* Everything was already held: no request at all. */
  if (missing.length === 0) return Promise.resolve(settled)

  let batch = pending.get(days)
  if (!batch) {
    batch = { days, chunk, symbols: new Set(), waiters: [], timer: null }
    pending.set(days, batch)
    batch.timer = setTimeout(() => { void flush(days, fetcher) }, BATCH_MS)
  }
  /* The smallest chunk any caller asked for wins: it is the conservative one
     against the row cap, and a smaller chunk is never incorrect. */
  if (chunk !== undefined) {
    batch.chunk = batch.chunk === undefined ? chunk : Math.min(batch.chunk, chunk)
  }
  for (const symbol of missing) batch.symbols.add(symbol)

  return new Promise<DailyClose[]>((resolve, reject) => {
    batch!.waiters.push({
      symbols: unique,
      days,
      resolve: rows => resolve(rows),
      reject,
    })
  })
}

/** Test seam: drop everything held and pending. */
export function __resetCoalescer() {
  for (const batch of pending.values()) if (batch.timer) clearTimeout(batch.timer)
  pending.clear()
  held.clear()
}
