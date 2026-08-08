import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Check, X } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useAnalystRatings, useRatingScales, type ConvictionLevel } from '../../../hooks/useAnalystRatings'

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
 * The scale is read from the organisation's configured rating scales, so the
 * buttons appear on an asset nobody has rated yet. There is no hard-coded
 * fallback: inventing Buy/Hold/Sell for an organisation that uses a 1-5 scale
 * would write a value its own scale does not contain.
 */
export function MobileRatingField({
  assetId,
  title,
  viewFilter = 'aggregated',
}: MobileRatingFieldProps) {
  const { user } = useAuth()
  const { ratings, myRating, consensus, isLoading, saveRating } = useAnalystRatings({ assetId })
  const { scales } = useRatingScales()

  // Firm view is the aggregate of everyone's ratings and is read-only; a rating
  // set from it would have no author. Editing lives in "My view".
  const isFirmView = viewFilter === 'aggregated'
  const canEdit = !!user && viewFilter === user.id

  // A rating is the most consequential single tap in the case — it is the
  // firm's published stance on the name — and it was previously committed the
  // instant a button was pressed, with no way back. Selecting now stages the
  // change and a second, explicit tap commits it.
  const [pending, setPending] = useState<string | null>(null)

  // The scale comes from the organisation's configuration, not from whatever
  // rating happens to exist. Deriving it from existing ratings meant an asset
  // nobody had rated offered no buttons at all — the field was unusable
  // exactly when it was most needed.
  const scale = useMemo(() => {
    const fromExisting = ratings.find(r => r.rating_scale?.values?.length)?.rating_scale
    const configured = (scales ?? []).find(s => s.is_default) ?? (scales ?? [])[0]
    const chosen = fromExisting ?? configured
    return {
      id: chosen?.id ?? null,
      values: [...(chosen?.values ?? [])].sort((a, b) => a.sort - b.sort),
    }
  }, [ratings, scales])

  const shown = isFirmView ? null : ratings.find(r => r.user_id === viewFilter)

  /** The most-held rating, which is what the firm view leads with. */
  const topConsensus = useMemo(
    () => [...consensus].sort((a, b) => b.count - a.count)[0] ?? null,
    [consensus]
  )

  if (isLoading) {
    return <div className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      {/* Title wraps rather than truncating: template field names run long and
          the count badge was clipping them. */}
      <div className="flex items-start gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <h3 className="flex-1 min-w-0 text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        {ratings.length > 0 && (
          <span className="mt-0.5 shrink-0 text-[11px] text-gray-400">
            {ratings.length} {ratings.length === 1 ? 'analyst' : 'analysts'}
          </span>
        )}
      </div>

      <div className="px-3 py-2.5">
        {!scale.id ? (
          // Without a configured scale there is no vocabulary to offer, and
          // guessing one would write values the organisation does not use.
          <p className="text-sm text-gray-400">
            No rating scale is configured for your organisation yet.
          </p>
        ) : canEdit ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {scale.values.map(v => {
                const active = myRating?.rating_value === v.value
                const staged = pending === v.value
                return (
                  <button
                    key={v.value}
                    type="button"
                    disabled={saveRating.isPending}
                    onClick={() => setPending(active ? null : v.value)}
                    className={clsx(
                      'px-3 h-9 rounded-lg text-sm font-semibold border transition-colors no-touch-target disabled:opacity-50',
                      staged
                        ? 'border-primary-500 border-dashed text-primary-700 bg-primary-50 dark:text-primary-300 dark:bg-primary-900/30'
                        : active
                          ? 'border-transparent text-white'
                          : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-800'
                    )}
                    style={active && !staged && v.color ? { backgroundColor: v.color } : undefined}
                  >
                    {v.label}
                  </button>
                )
              })}
            </div>

            {pending && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary-200 dark:border-primary-900/50 bg-primary-50 dark:bg-primary-900/20 px-2.5 py-2">
                <span className="flex-1 min-w-0 text-[12px] text-primary-900 dark:text-primary-200">
                  {myRating
                    ? `Change rating to ${labelFor(pending, scale.values)}?`
                    : `Set rating to ${labelFor(pending, scale.values)}?`}
                </span>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-gray-500 no-touch-target"
                  aria-label="Cancel rating change"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={saveRating.isPending}
                  onClick={() => {
                    saveRating.mutate({
                      ratingValue: pending,
                      ratingScaleId: scale.id!,
                      conviction: myRating?.conviction ?? null,
                    })
                    setPending(null)
                  }}
                  className="h-8 px-3 shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary-600 text-white text-[12px] font-semibold disabled:opacity-50 no-touch-target"
                >
                  <Check className="h-3.5 w-3.5" />
                  Confirm
                </button>
              </div>
            )}

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
        ) : isFirmView ? (
          // The firm's stance is the most-held rating, not a blank. Routing the
          // firm view down the single-analyst branch printed "No rating from
          // this analyst" over a name the whole desk had rated.
          consensus.length > 0 ? (
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-gray-900 dark:text-white">
                {labelFor(topConsensus!.value, scale.values)}
              </span>
              <span className="text-xs text-gray-500">
                {topConsensus!.count} of {ratings.length}
              </span>
              <span className="ml-auto text-[11px] text-gray-400">Firm view · read-only</span>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Nobody has rated this name yet.</p>
          )
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

        {isFirmView && consensus.length > 0 && (
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
