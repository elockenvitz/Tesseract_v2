import { useMemo } from 'react'
import { clsx } from 'clsx'
import { useAuth } from '../../../hooks/useAuth'
import { useAnalystRatings, type ConvictionLevel } from '../../../hooks/useAnalystRatings'

interface MobileRatingFieldProps {
  assetId: string
  title: string
  /** 'aggregated' shows the firm; a user id narrows to that analyst. */
  viewFilter?: 'aggregated' | string
}

const CONVICTIONS: ConvictionLevel[] = ['low', 'medium', 'high']

/**
 * The analyst rating, readable and settable on a phone.
 *
 * Ratings are a closed set defined by the organisation's rating scale, so the
 * whole control is a row of buttons — no editor, no keyboard, one tap to
 * change. That makes it one of the few parts of a case genuinely better suited
 * to a phone than a desktop form.
 *
 * The scale comes from whatever rating is already on the asset. There is no
 * fallback list: inventing Buy/Hold/Sell when an organisation uses a 1-5 scale
 * would write a value its own rating scale does not contain.
 */
export function MobileRatingField({
  assetId,
  title,
  viewFilter = 'aggregated',
}: MobileRatingFieldProps) {
  const { user } = useAuth()
  const { ratings, myRating, consensus, isLoading, saveRating } = useAnalystRatings({ assetId })

  const isOwnView = viewFilter === 'aggregated' || viewFilter === user?.id

  const scale = useMemo(() => {
    const withScale = ratings.find(r => r.rating_scale?.values?.length)
    const values = withScale?.rating_scale?.values ?? []
    return {
      id: withScale?.rating_scale_id ?? null,
      values: [...values].sort((a, b) => a.sort - b.sort),
    }
  }, [ratings])

  const shown = viewFilter === 'aggregated' ? null : ratings.find(r => r.user_id === viewFilter)

  if (isLoading) {
    return <div className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <h3 className="flex-1 min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {title}
        </h3>
        {ratings.length > 0 && (
          <span className="shrink-0 text-[11px] text-gray-400">
            {ratings.length} {ratings.length === 1 ? 'analyst' : 'analysts'}
          </span>
        )}
      </div>

      <div className="px-3 py-2.5">
        {!scale.id ? (
          // No rating scale is reachable until someone has rated on it, so
          // offering buttons would mean guessing the organisation's vocabulary.
          <p className="text-sm text-gray-400">
            No rating scale set for this asset yet — set the first rating on desktop.
          </p>
        ) : isOwnView ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {scale.values.map(v => {
                const active = myRating?.rating_value === v.value
                return (
                  <button
                    key={v.value}
                    type="button"
                    disabled={saveRating.isPending}
                    onClick={() =>
                      saveRating.mutate({
                        ratingValue: v.value,
                        ratingScaleId: scale.id!,
                        conviction: myRating?.conviction ?? null,
                      })
                    }
                    className={clsx(
                      'px-3 h-9 rounded-lg text-sm font-semibold border transition-colors no-touch-target disabled:opacity-50',
                      active
                        ? 'border-transparent text-white'
                        : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-800'
                    )}
                    style={active && v.color ? { backgroundColor: v.color } : undefined}
                  >
                    {v.label}
                  </button>
                )
              })}
            </div>

            {myRating && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400 mr-0.5">Conviction</span>
                {CONVICTIONS.map(level => (
                  <button
                    key={level}
                    type="button"
                    disabled={saveRating.isPending}
                    onClick={() =>
                      saveRating.mutate({
                        ratingValue: myRating.rating_value,
                        ratingScaleId: myRating.rating_scale_id,
                        // Tapping the current level clears it — conviction is
                        // optional, and there must be a way back to unset.
                        conviction: myRating.conviction === level ? null : level,
                      })
                    }
                    className={clsx(
                      'px-2 h-7 rounded-md text-[11px] font-semibold capitalize border no-touch-target disabled:opacity-50',
                      myRating.conviction === level
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : shown ? (
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-gray-900 dark:text-white">
              {labelFor(shown.rating_value, scale.values)}
            </span>
            {shown.conviction && (
              <span className="text-xs text-gray-500 capitalize">{shown.conviction} conviction</span>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No rating from this analyst.</p>
        )}

        {viewFilter === 'aggregated' && consensus.length > 0 && (
          <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800 space-y-1">
            {consensus.map(c => (
              <div key={c.value} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs font-medium text-gray-600 dark:text-gray-300 truncate">
                  {labelFor(c.value, scale.values)}
                </span>
                <span className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-primary-500"
                    style={{ width: `${c.percentage}%` }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-gray-400">
                  {c.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function labelFor(value: string, values: { value: string; label: string }[]): string {
  return values.find(v => v.value === value)?.label ?? value
}
