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
import { supabase } from '../lib/supabase'
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
}

/** Below this share of the index, a benchmark return is a guess. */
const BENCH_COVERAGE_FLOOR = 0.8

export function useDayPerformance(book: Book | null, active: ActiveWeight[]) {
  const symbols = useMemo(
    () => [...new Set(active.map(a => a.symbol).filter((s): s is string => !!s))].sort(),
    [active],
  )

  const { data } = useQuery<Record<string, { date: string; ret: number }>>({
    queryKey: ['desktop-portfolio', 'day', book?.portfolioId ?? null, symbols.length],
    enabled: symbols.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // Ten days back, not two: closes exist per trading day, and a long
      // weekend against a holiday is four calendar days with no row in them.
      const floor = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('price_history_cache')
        .select('symbol, date, close')
        .in('symbol', symbols)
        .gte('date', floor)
      if (error) throw new Error(error.message)

      const bySymbol = new Map<string, { date: string; close: number }[]>()
      for (const r of (data ?? []) as { symbol: string; date: string; close: number }[]) {
        const close = Number(r.close)
        if (!Number.isFinite(close) || close <= 0) continue
        const list = bySymbol.get(r.symbol)
        if (list) list.push({ date: r.date, close })
        else bySymbol.set(r.symbol, [{ date: r.date, close }])
      }

      const out: Record<string, { date: string; ret: number }> = {}
      for (const [symbol, rows] of bySymbol) {
        if (rows.length < 2) continue
        rows.sort((a, b) => a.date.localeCompare(b.date))
        const last = rows[rows.length - 1]
        const prev = rows[rows.length - 2]
        out[symbol] = { date: last.date, ret: ((last.close - prev.close) / prev.close) * 100 }
      }
      return out
    },
  })

  return useMemo<DayPerformance | null>(() => {
    if (!book || !data || !active.length) return null

    let portfolioPct = 0
    let benchPct = 0
    let priced = 0
    let benchTotal = 0
    let asOf: string | null = null
    const movers: DayMove[] = []

    for (const a of active) {
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
    return {
      asOf,
      portfolioPct,
      benchmarkPct: coverage >= BENCH_COVERAGE_FLOOR ? benchPct : null,
      coverage,
      movers: movers.sort((a, b) => b.contribPct - a.contribPct),
    }
  }, [book, data, active])
}
