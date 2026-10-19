/**
 * `useAnalystRatings` for the harness.
 *
 * The Snapshot reads only `consensus` (sorted by count, dominant first) and
 * `ratings` (for the denominator). The real hook also returns mutations and
 * per-user slices, which nothing on this surface touches.
 *
 * The fixture is DELIBERATELY SPLIT — three Buy, one Hold, one Sell across
 * five analysts. A unanimous fixture would let the Snapshot render "Buy" with
 * no qualification and look right, which is the failure the headline figure is
 * supposed to make impossible: the count beside a rating exists so that one
 * person's opinion cannot read as the firm's.
 */

/**
 * The module exports two hooks and the stub must carry both.
 *
 * `MobileRatingField` imports `useRatingScales` from here as well, and a
 * resolver that redirects the module redirects every import of it — so a stub
 * with one export failed the whole harness build, not just the surface that
 * uses it. The build said so plainly; it is noted here because the next hook
 * added to the real module will do the same thing.
 */
const SCALE = {
  id: 'scale-standard',
  name: 'Standard',
  description: 'Buy / Hold / Sell',
  is_default: true,
  is_system: true,
  organization_id: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  values: [
    { value: 'Buy', label: 'Buy', color: '#15803d', sort: 1 },
    { value: 'Hold', label: 'Hold', color: '#a16207', sort: 2 },
    { value: 'Sell', label: 'Sell', color: '#b91c1c', sort: 3 },
  ],
}

export function useRatingScales() {
  const scales = [SCALE]
  const getScaleById = (id: string) => scales.find(s => s.id === id)
  return {
    scales,
    defaultScale: SCALE,
    systemScales: scales,
    customScales: [],
    isLoading: false,
    error: null,
    getScaleById,
    getRatingLabel: (_id: string, value: string) =>
      SCALE.values.find(v => v.value === value)?.label || value,
    getRatingColor: (_id: string, value: string) =>
      SCALE.values.find(v => v.value === value)?.color || '#6b7280',
  }
}

export type ConvictionLevel = 'low' | 'medium' | 'high'

export interface HarnessRating {
  id: string
  rating_value: string
  user_id: string
}

const RATINGS: HarnessRating[] = [
  { id: 'r1', rating_value: 'Buy', user_id: 'u-rivera' },
  { id: 'r2', rating_value: 'Buy', user_id: 'u-okafor' },
  { id: 'r3', rating_value: 'Buy', user_id: 'u-mehta' },
  { id: 'r4', rating_value: 'Hold', user_id: 'u-lindqvist' },
  { id: 'r5', rating_value: 'Sell', user_id: 'u-chen' },
]

export function useAnalystRatings({ assetId }: { assetId: string; userId?: string }) {
  const ratings = assetId === 'empty' ? [] : RATINGS

  const byValue: Record<string, HarnessRating[]> = {}
  for (const r of ratings) (byValue[r.rating_value] ||= []).push(r)

  const consensus = Object.entries(byValue)
    .map(([value, list]) => ({
      value,
      count: list.length,
      percentage: (list.length / ratings.length) * 100,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    ratings,
    myRating: null,
    otherRatings: ratings,
    ratingsByValue: byValue,
    consensus,
    isLoading: false,
    error: null,
    refetch: () => {},
    saveRating: { mutate: () => {}, mutateAsync: async () => {}, isPending: false },
    deleteRating: { mutate: () => {}, mutateAsync: async () => {}, isPending: false },
  }
}
