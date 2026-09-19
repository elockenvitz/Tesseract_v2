/**
 * The size behind a weight, for a surface that does not hold the book.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Portfolio's tiles put the weight in the corner as a control: click it and
 * the market value, the share count, the price and the active weight are
 * there. Research shows the same figure and could answer none of it -- its
 * coverage rows carry a weight, a book name and nothing else -- so the same
 * fact behaved differently one tab apart, which is the drift this desktop
 * work keeps closing.
 *
 * ── Why it is a separate hook and not a wider subject ─────────────────────
 *
 * The alternative was widening `ResearchSubject` so the coverage query
 * returns position detail for every name in the scan. That loads the whole
 * book's worth of figures to answer a question the reader asks about one name
 * at a time, on a lens whose own rule is that it does not pay per-card costs
 * for decoration.
 *
 * This asks only when there is a book to ask about, shares `useBook`'s cache
 * key with the Portfolio lens (so opening both pays once), and returns null
 * rather than guessing when the name is not in the book it was told about.
 *
 * RLS posture: unchanged. `useBook` and `useActiveWeights` are the existing
 * reads, under their existing policies; nothing new is queried here.
 */
import { useMemo } from 'react'
import { useBook, useActiveWeights } from './useDesktopPortfolio'
import { bigMoney } from '../components/portfolio-v2/PortfolioVisual'

export interface WeightDetailRow {
  label: string
  value: string
  sign?: number
}

export interface SubjectWeightDetail {
  details: WeightDetailRow[]
}

export function useSubjectWeightDetail(
  portfolioId: string | null | undefined,
  assetId: string | null | undefined,
): SubjectWeightDetail | null {
  const { book } = useBook(portfolioId ?? null)
  const benchmark = useActiveWeights(book ?? null)

  return useMemo(() => {
    if (!book || !assetId) return null
    const position = book.positions.find(p => p.assetId === assetId)
    if (!position) return null

    /*
     * Active weight only where a benchmark file actually loaded. An index
     * weight of zero for a name the file does not hold is not the same as a
     * name the index holds at zero -- the same distinction Portfolio makes,
     * made the same way, because a reader comparing the two panels is
     * entitled to that.
     */
    const active = benchmark.state === 'ready'
      ? benchmark.rows.find(r => r.assetId === assetId) ?? null
      : null

    return {
      details: [
        { label: 'Market value', value: bigMoney(position.marketValue) },
        {
          label: 'Shares',
          value: position.shares.toLocaleString(undefined, { maximumFractionDigits: 0 }),
        },
        { label: 'Price', value: `$${position.price.toFixed(2)}` },
        active == null
          ? { label: 'Active weight', value: 'no benchmark' }
          : {
              label: 'Active weight',
              value: `${active.activePct >= 0 ? '+' : ''}${active.activePct.toFixed(2)} pp`,
              sign: active.activePct,
            },
        ...(active != null
          ? [{ label: 'Index weight', value: `${active.benchPct.toFixed(2)}%` }]
          : []),
      ],
    }
  }, [book, assetId, benchmark])
}
