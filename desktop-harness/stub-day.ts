/**
 * A day's moves for the harness book.
 *
 * Deterministic, and deliberately not uniform: a real day has two or three
 * names doing most of the work, a long middle that barely registers, and at
 * least one large position moving the wrong way. A fixture where every name
 * moves about the same amount would let a broken contribution calculation --
 * weight ignored, sign dropped, scale shared per column instead of per book --
 * look perfectly correct.
 */
import type { Book } from '../src/lib/portfolio/holdings'
import type { ActiveWeight } from '../src/hooks/useDesktopPortfolio'
import { useEffect, useState } from 'react'
import type { DayPerformance, DayMove } from '../src/hooks/useDayPerformance'

/* Prices land last, as they do in the real lens. */
const slow = new URLSearchParams(location.search).get('slow') === '1'
function useReady(ms: number) {
  const [r, setR] = useState(!slow)
  useEffect(() => {
    if (!slow) return
    const t = setTimeout(() => setR(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return r
}

/** One-day returns, in percent, by asset. */
const RET: Record<string, number> = {
  'a-nvda': 3.42, 'a-msft': 0.61, 'a-lly': 2.18, 'a-aapl': -1.44, 'a-tsm': 1.97,
  'a-pfe': -2.86, 'a-xom': 0.34, 'a-jpm': -0.12, 'a-baba': -3.51, 'a-dash': 4.05,
  'a-ko': 0.08, 'a-unh': -1.72, 'a-cat': 0.55, 'a-nee': -0.41, 'a-lin': 0.22,
  'a-amt': -0.88, 'a-vz': 0.14, 'a-cost': 1.06, 'a-adbe': -2.24, 'a-nke': 0.77,
  'a-mrk': -0.35, 'a-tel': 0.91,
  // Index names the book does not hold. They move the benchmark and not us,
  // which is the whole point of keeping them out of the movers list.
  'a-goog': 1.28, 'a-amzn': -0.94, 'a-meta': 2.61, 'a-brk': 0.19, 'a-avgo': 3.12,
  'a-tsla': -4.18, 'a-jnj': 0.42, 'a-wmt': 0.66,
}

const asOf = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

export function useDayPerformance(
  book: Book | null, active: ActiveWeight[],
): DayPerformance | null {
  const ready = useReady(1800)
  if (!book || !active.length || !ready) return null

  let portfolioPct = 0
  let benchmarkPct = 0
  let priced = 0
  let benchTotal = 0
  const movers: DayMove[] = []

  for (const a of active) {
    benchTotal += a.benchPct
    const ret = RET[a.assetId]
    if (ret == null) continue
    priced += a.benchPct
    portfolioPct += (a.weightPct / 100) * ret
    benchmarkPct += (a.benchPct / 100) * ret
    if (a.weightPct > 0) {
      movers.push({
        assetId: a.assetId, symbol: a.symbol, companyName: a.companyName,
        retPct: ret, contribPct: (a.weightPct / 100) * ret, weightPct: a.weightPct,
      })
    }
  }

  const coverage = benchTotal > 0 ? priced / benchTotal : 0
  return {
    asOf,
    portfolioPct,
    benchmarkPct: coverage >= 0.8 ? benchmarkPct : null,
    coverage,
    movers: movers.sort((a, b) => b.contribPct - a.contribPct),
  }
}
