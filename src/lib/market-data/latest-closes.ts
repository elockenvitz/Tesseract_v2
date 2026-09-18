/**
 * The newest stored close for each of a set of symbols.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Trade Lab priced trades with `baseline?.price || 100`: the live quote where
 * a provider answered, the book's own last price where one existed, and
 * otherwise the literal 100. A NEW position has no baseline holding, so it
 * took the literal -- and a circuit breaker then disables the provider chain
 * for the rest of the session after one all-fail pass, so every trade booked
 * afterwards took it too.
 *
 * That number is not a display detail. It flows through `normalize-sizing`
 * into `delta_shares`, `target_shares`, `delta_weight` and `notional_value`,
 * is persisted as `accepted_trades.price_at_acceptance`, and is then applied
 * by `apply_trade_to_holdings` to `portfolio_holdings.price`, `.cost` and the
 * portfolio's CASH balance. Live rows carry it today: META at 100 against a
 * real close of 682.31, V at 100 against 369.93, PLTR at 100 against 176.24,
 * LLY at 100 against 1152.44. META's share count is inflated 6.82x.
 *
 * `price_history_cache` is the product's canonical stored market price --
 * dated daily closes, backfilled nightly, already what Research, Today, Ideas,
 * the decision tiles and `lib/outcomes/current-price` measure against. So
 * when the live provider cannot be reached, the honest fallback is the last
 * real close, not a number chosen for being round.
 *
 * ── The window ───────────────────────────────────────────────────────────
 *
 * Ten calendar days, which spans a long weekend plus holidays and still
 * bounds the read. A symbol with nothing that recent falls through to the
 * caller's next source rather than widening this query: a price staler than
 * ten days is not a current price, and `currentPriceFor` already owns the
 * decision about what to do with one.
 *
 * RLS posture: unchanged. `price_history_cache` carries no `organization_id`
 * and is not org-scoped -- a close is a fact about a security, not about a
 * tenant -- and this reads it under its existing policy.
 */
import { supabase } from '../supabase'
import type { CachedClose } from '../outcomes/current-price'

/** How far back a close may sit and still count as "the latest". */
export const LATEST_CLOSE_WINDOW_DAYS = 10

/**
 * Latest close per symbol, keyed by symbol.
 *
 * Symbols with nothing stored in the window are simply absent from the map --
 * never present with a fabricated value. An absent key means "we do not know
 * this price", which is a thing the caller must handle, not paper over.
 */
export async function fetchLatestCloses(
  symbols: readonly string[],
): Promise<Map<string, CachedClose>> {
  const wanted = Array.from(new Set(symbols.filter(Boolean)))
  const out = new Map<string, CachedClose>()
  if (wanted.length === 0) return out

  const since = new Date(Date.now() - LATEST_CLOSE_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supabase
    .from('price_history_cache')
    .select('symbol, date, close')
    .in('symbol', wanted)
    .gte('date', since)
    .order('date', { ascending: false })

  if (error) {
    // A failed read is not a price. The caller falls through to its next
    // real source; nothing here invents one.
    console.warn('[latest-closes] could not read stored closes:', error.message)
    return out
  }

  for (const row of data ?? []) {
    const symbol = (row as { symbol?: string }).symbol
    if (!symbol || out.has(symbol)) continue // rows arrive newest-first
    const close = Number((row as { close: number | string | null }).close)
    if (!Number.isFinite(close) || close <= 0) continue
    out.set(symbol, { close, date: (row as { date: string }).date })
  }

  return out
}
