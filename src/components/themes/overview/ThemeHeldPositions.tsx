import { useMemo } from 'react'
import { Briefcase, ChevronRight } from 'lucide-react'
import { useHoldingsForAssets } from '../../../hooks/useHoldingsForAssets'
import { heldNames } from '../../../lib/theme-workspace/held-positions'

/**
 * What the firm actually owns of this theme.
 *
 * ── Why this band exists ─────────────────────────────────────────────────
 *
 * A theme is a thesis about a group of names. The first question about one is
 * not what is in it, it is what the firm has at risk in it. That answer lived
 * nowhere: the roster showed membership, and a held/watchlist split told you
 * held-or-not without saying where or how much.
 *
 * ── Why the numbers come from a pure function ────────────────────────────
 *
 * `heldNames` does all of the arithmetic, over rows reduced to the newest
 * upload per (portfolio, asset). `portfolio_holdings` is a dated table, and
 * double-counting a re-uploaded book is a documented recurring defect here:
 * the wrong number has the right shape. The derivation is unit-tested
 * numerically; this file only renders.
 *
 * ── Provenance ───────────────────────────────────────────────────────────
 *
 * Every percentage shown is a weight DERIVED from shares and price in
 * `portfolio_holdings`, per book, as `lib/portfolio/holdings` derives it
 * everywhere else. None is read from a column, and none is a sum across
 * books: the largest single-book stake is labelled as such, because 25% of
 * one fund plus 4% of another is not 29% of anything.
 *
 * RLS posture: unchanged. `useHoldingsForAssets` makes the same
 * `portfolio_holdings` read Ideas and Research already make, through the same
 * policies. SELECT on that table is `TO authenticated` with
 * `portfolio_in_current_org(portfolio_id)` and no platform-admin bypass
 * (verified live), so a reader who cannot see a book gets none of its rows
 * and the name simply shows as not held. No policy added or widened.
 */

interface ThemeHeldPositionsProps {
  /** Every asset in the theme, held or not. */
  assetIds: string[]
  /** For labelling rows; the roster already has these. */
  symbolOf: (assetId: string) => string | null
  /** Opens the Assets mode, where the full roster lives. */
  onViewAll: () => void
}

/** Rows shown before the band defers to the Assets mode. */
const SHOWN = 5

export function ThemeHeldPositions({ assetIds, symbolOf, onViewAll }: ThemeHeldPositionsProps) {
  const { rows, settled } = useHoldingsForAssets(assetIds)
  const summary = useMemo(() => heldNames(rows, assetIds), [rows, assetIds])

  if (assetIds.length === 0) return null

  if (!settled) {
    return <div className="h-24 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-800" />
  }

  const { names, unheldAssetIds, bookCount } = summary
  const shown = names.slice(0, SHOWN)

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Held in portfolios</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {names.length === 0
              ? 'None of this theme\'s names are currently held.'
              : `${names.length} of ${assetIds.length} names, across ${bookCount} ${bookCount === 1 ? 'portfolio' : 'portfolios'}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="shrink-0 flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          All assets
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {names.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center dark:border-gray-600">
          <Briefcase className="h-6 w-6 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing here is in a book yet. The theme is a watchlist.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden dark:divide-gray-700 dark:border-gray-700">
          {shown.map(name => (
            <div key={name.assetId} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {symbolOf(name.assetId) ?? 'Unknown'}
                </span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {/* The heaviest book is named, because a weight with no book
                      is not an exposure anyone can act on. */}
                  {name.books[0].name ?? 'a portfolio'}
                  {name.books.length > 1 && ` +${name.books.length - 1} more`}
                </span>
              </div>
              <span className="shrink-0 text-sm tabular-nums font-medium text-gray-900 dark:text-white">
                {name.topWeightPct.toFixed(1)}%
              </span>
            </div>
          ))}
          {names.length > SHOWN && (
            <button
              type="button"
              onClick={onViewAll}
              className="w-full px-3 py-2 text-left text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-400"
            >
              {names.length - SHOWN} more held, and {unheldAssetIds.length} not held
            </button>
          )}
        </div>
      )}

      {/* The number's meaning, said once rather than on every row. Largest
          single-book stake, not a total, and only as current as the upload. */}
      {names.length > 0 && (
        <p className="px-1 text-[11px] text-gray-400 dark:text-gray-500">
          Largest weight in any single portfolio, derived from the latest holdings upload.
        </p>
      )}
    </section>
  )
}
