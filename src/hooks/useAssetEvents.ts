import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface AssetEvent {
  id: string
  kind: 'earnings' | 'calendar'
  title: string
  start_date: string | null
  is_estimated?: boolean
  event_type?: string | null
  color?: string | null
}

/**
 * Upcoming + recent events for an asset: earnings dates and any calendar
 * events scoped to the asset (context_type='asset'). Sorted chronologically,
 * limited to a reasonable window.
 */
export function useAssetEvents(assetId: string | null | undefined, limit = 10) {
  return useQuery<AssetEvent[]>({
    queryKey: ['asset-events', assetId, limit],
    queryFn: async () => {
      if (!assetId) return []

      const [earningsRes, calendarRes] = await Promise.all([
        supabase
          .from('asset_earnings_dates')
          .select('id, earnings_date, earnings_quarter, earnings_year, is_estimated')
          .eq('asset_id', assetId)
          .order('earnings_date', { ascending: true }),
        supabase
          .from('calendar_events')
          .select('id, title, event_type, start_date, color')
          .eq('context_type', 'asset')
          .eq('context_id', assetId)
          .order('start_date', { ascending: true })
      ])

      if (earningsRes.error) throw earningsRes.error
      if (calendarRes.error) throw calendarRes.error

      const earnings: AssetEvent[] = (earningsRes.data ?? []).map((e: any) => ({
        id: `e-${e.id}`,
        kind: 'earnings',
        title: e.earnings_quarter && e.earnings_year
          ? `${e.earnings_quarter} ${e.earnings_year} earnings`
          : 'Earnings',
        start_date: e.earnings_date,
        is_estimated: !!e.is_estimated
      }))

      const calendar: AssetEvent[] = (calendarRes.data ?? []).map((c: any) => ({
        id: `c-${c.id}`,
        kind: 'calendar',
        title: c.title ?? 'Event',
        start_date: c.start_date,
        event_type: c.event_type ?? null,
        color: c.color ?? null
      }))

      // Merge, sort by start_date ascending, upcoming first
      const now = Date.now()
      const merged = [...earnings, ...calendar]
        .filter(e => !!e.start_date)
        .sort((a, b) => new Date(a.start_date!).getTime() - new Date(b.start_date!).getTime())

      // Separate upcoming from past and prioritize upcoming
      const upcoming = merged.filter(e => new Date(e.start_date!).getTime() >= now)
      const past = merged.filter(e => new Date(e.start_date!).getTime() < now).reverse()

      return [...upcoming, ...past].slice(0, limit)
    },
    enabled: !!assetId
  })
}
