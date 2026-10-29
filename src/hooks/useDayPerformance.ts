/**
 * What the book did on its last trading day, and what drove it.
 *
 * ── What this can say honestly ───────────────────────────────────────────
 *
 * `price_history_cache` holds daily closes. The last two for a name give its
 * one-day return; that return against the weight the book carries gives the
 * position's contribution; the sum of the contributions is the book's day.
 * Every step is arithmetic on numbers already in the database.
 *
 * The same sum against BENCHMARK weights gives the index's day -- but only
 * over the names we can actually price. An index file of 483 constituents
 * against a price cache that covers the names this desk follows is not full
 * coverage, and a benchmark return computed over 60% of the index and printed
 * as "the benchmark" is a fabrication with a decimal point on it.
 *
 * So `coverage` comes back with the number and the panel refuses to print a
 * comparison below the floor. "We cannot price enough of the index to say" is
 * a worse headline and a true one, and this is a tool people size positions
 * with.
 *
 * ── And what it is NOT ───────────────────────────────────────────────────
 *
 * Not intraday. There is no intraday series anywhere in this schema. This is
 * the last close against the one before it, and every label says so.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDailyCloses, bySymbol } from '../lib/market-data/daily-closes'
import type { Book } from '../lib/portfolio/holdings'
import type { ActiveWeight } from './useDesktopPortfolio'

export interface DayMove {
  assetId: string
  symbol: string | null
  companyName: string | null
  /** The name's one-day return, in percent. */
  retPct: number
  /** Weight times return: what it added to the book's day, in percent. */
  contribPct: number
  weightPct: number
}

export interface DayPerformance {
  /** The most recent close date the cache holds for this book. */
  asOf: string | null
  portfolioPct: number
  /** Null when too little of the index can be priced to say. */
  benchmarkPct: number | null
  /** Share of index weight that could be priced, 0-1. */
  coverage: number
  /** Every held name that moved, best first. */
  movers: DayMove[]
  /**
   * Calendar days between `asOf` and now, or null when nothing was priced.
   *
   * The cache trails, and by how much is a fact about the figures above it.
   * The panel reads this rather than guessing from `asOf`, so "four weeks
   * behind" is stated in one place.
   */
  lagDays: number | null
  /** True when the last close is too old to narrate as the latest day. */
  stale: boolean
}

/** Below this share of the index, a benchmark return is a guess. */
const BENCH_COVERAGE_FLOOR = 0.8

/**
 * How far back to look for the last two closes.
 *
 * ── Why this is 45 and was 10, and why 10 made the panel disappear ────────
 *
 * The window was ten calendar days from `Date.now()` -- "a long weekend
 * against a holiday is four calendar days with no row in them", which is a
 * true reason for ten rather than two and the wrong anchor entirely.
 *
 * `price_history_cache` is a CACHE and it trails. Measured against
 * production on 2026-10-28: the newest close in the whole table was
 * 2026-10-01, four weeks back, while the ten-day floor was 2026-10-19. The
 * query therefore matched ZERO rows for every symbol the book holds, every
 * `px` lookup came back undefined, `movers` came out empty -- and `DayPanel`
 * returns null on an empty movers list, so the entire left half of the
 * Portfolio header rendered nothing at all. Measured in the live app: the
 * first column of `book-header-panels` was 909px wide and 0px tall.
 *
 * Nothing failed. No error, no empty state, no console warning. The panel
 * was simply absent, and had been for as long as the cache was more than ten
 * days stale.
 *
 * 45 days is the lag this codebase already decided it is willing to tolerate
 * on a cached close -- `fitsTheLabel` in `daily-closes.ts` uses the same
 * number for the same reason ("the cache may trail, but not by a quarter").
 * Using it here means the panel survives a stale cache instead of vanishing,
 * and `asOf` still reports the date that was actually read, so a reader is
 * never told a four-week-old close is today's.
 *
 * It is NOT unbounded. A window that reaches back far enough to always find
 * something would pair closes from either side of an arbitrary gap and call
 * the difference a day's return. Past 45 days the honest output is to say so,
 * which is what `stale` and the empty state now do.
 */
export const DAY_WINDOW_DAYS = 45

/** Beyond this, the last close is too old to narrate as "the day". */
const STALE_AFTER_DAYS = 5

export function useDayPerformance(book: Book | null, active: ActiveWeight[]) {
  /*
   * Priced off the BOOK, not off the active rows.
   *
   * ── The waterfall this removes ───────────────────────────────────────────
   *
   * `active` needs the benchmark file, and the unheld half of it then needs a
   * second query to resolve symbols. Keying the price query on `active` put
   * this third in a chain -- book, then benchmark, then names, then prices --
   * so the day figures and the contributor list arrived last, after three
   * round trips, and every one of them landed as new height in the header.
   * That is the hitch a reader sees.
   *
   * Every symbol the book holds is already in `book.positions`, and those are
   * the only names that can contribute to the book's day. The unheld index
   * names are still folded in for the benchmark leg when they arrive, which
   * is a refinement of one number rather than a gate on the whole panel.
   */
  const symbols = useMemo(() => {
    const held = (book?.positions ?? [])
      .filter(p => !p.isCash && p.symbol)
      .map(p => p.symbol as string)
    const indexOnly = active.map(a => a.symbol).filter((s): s is string => !!s)
    return [...new Set([...held, ...indexOnly])].sort()
  }, [book, active])

  const { data } = useQuery<Record<string, { date: string; ret: number }>>({
    // The symbols themselves, not their count: two different sets of the
    // same size would otherwise share one cache entry and one of them would
    // be served the other's prices.
    queryKey: ['desktop-portfolio', 'day', book?.portfolioId ?? null, symbols.join('|')],
    enabled: symbols.length > 0,
    staleTime: 5 * 60_000,
    /*
     * Hold the last prices while the key changes.
     *
     * The key is the symbol list, and that list GROWS: the book's own names
     * arrive first, then the benchmark file adds the index-only ones. Each
     * growth is a new key, and without this `data` goes undefined for the
     * length of the refetch -- so the whole day panel blinks out and comes
     * back, taking the benchmark strip on a trip across the row with it.
     * Reported as "added most / cost most disappears".
     *
     * The stale figures are the same book priced from a smaller symbol set,
     * which is exactly what was on screen a moment earlier -- not a guess.
     */
    placeholderData: prev => prev,
    queryFn: async () => {
      /*
       * Through `fetchDailyCloses`, not a hand-rolled `.in()`.
       *
       * This query was its own `.in('symbol', symbols).gte('date', floor)`
       * with no ordering, no chunking and no cap check -- which is exactly
       * the shape that silently truncated Today's price series. At 137
       * symbols over a ten-day window it was asking for roughly 960 rows
       * against PostgREST's 1000-row ceiling: inside the cap by luck, not by
       * construction, and one wider window or one bigger book away from
       * dropping closes with no error. Widening the window to 45 days here
       * would have taken it straight over.
       *
       * `fetchDailyCloses` sizes each request so the cap cannot be reached
       * (`floor(1000 / days)` symbols apiece) and THROWS if a response comes
       * back full. The safety is not this hook's to re-derive.
       */
      const rows = await fetchDailyCloses(symbols, { days: DAY_WINDOW_DAYS })

      const out: Record<string, { date: string; ret: number }> = {}
      for (const [symbol, list] of bySymbol(rows)) {
        // `bySymbol` returns each list oldest-first, so the last two entries
        // are the most recent close and the one before it.
        const clean = list.filter(r => Number.isFinite(Number(r.close)) && Number(r.close) > 0)
        if (clean.length < 2) continue
        const last = clean[clean.length - 1]
        const prev = clean[clean.length - 2]
        out[symbol] = {
          date: last.date,
          ret: ((Number(last.close) - Number(prev.close)) / Number(prev.close)) * 100,
        }
      }
      return out
    },
  })

  return useMemo<DayPerformance | null>(() => {
    if (!book || !data) return null

    let portfolioPct = 0
    let benchPct = 0
    let priced = 0
    let benchTotal = 0
    let asOf: string | null = null
    const movers: DayMove[] = []

    /*
     * The book's own day does not wait for the index.
     *
     * This required `active`, so the whole panel -- including what the FUND
     * did and which of its names drove it, neither of which involves a
     * benchmark -- was gated on the benchmark file arriving. Where the index
     * has not landed yet, or a book has no index file at all, the positions
     * still stand in for it: weight, return and contribution are all present,
     * `benchPct` stays zero and coverage stays zero, so the benchmark slot
     * reports itself unpriced rather than the panel reporting nothing.
     */
    const basis: ActiveWeight[] = active.length
      ? active
      : book.positions.filter(p => !p.isCash).map(p => ({
          assetId: p.assetId, symbol: p.symbol, companyName: p.companyName,
          weightPct: p.weightPct, benchPct: 0, activePct: p.weightPct,
        }))

    for (const a of basis) {
      benchTotal += a.benchPct
      const px = a.symbol ? data[a.symbol] : undefined
      if (!px) continue
      priced += a.benchPct
      if (!asOf || px.date > asOf) asOf = px.date

      portfolioPct += (a.weightPct / 100) * px.ret
      benchPct += (a.benchPct / 100) * px.ret

      /*
       * A name the book does not hold contributed nothing to the book's day,
       * however far it moved. It stays out of the movers list for that
       * reason: this answers "what moved US", and an index name we refused is
       * a decision to be read on the active-weight strip, not a contributor
       * to a return we did not earn.
       */
      if (a.weightPct > 0) {
        movers.push({
          assetId: a.assetId,
          symbol: a.symbol,
          companyName: a.companyName,
          retPct: px.ret,
          contribPct: (a.weightPct / 100) * px.ret,
          weightPct: a.weightPct,
        })
      }
    }

    const coverage = benchTotal > 0 ? priced / benchTotal : 0
    const lagDays = asOf
      ? Math.max(0, Math.floor((Date.now() - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000))
      : null
    return {
      asOf,
      portfolioPct,
      benchmarkPct: coverage >= BENCH_COVERAGE_FLOOR ? benchPct : null,
      coverage,
      movers: movers.sort((a, b) => b.contribPct - a.contribPct),
      lagDays,
      stale: lagDays != null && lagDays > STALE_AFTER_DAYS,
    }
  }, [book, data, active])
}
