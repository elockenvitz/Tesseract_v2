import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Calendar-shaped market data — earnings, dividends, macro prints.
 *
 * Companion to `useMarketNews`. Cached hard: these are dated events, so the
 * answer does not change minute to minute, and re-requesting while the reader
 * scrolls would burn provider quota for identical data.
 */

export interface UpcomingEarnings {
  symbol: string
  date: string
  hour?: string
  epsEstimate?: number
  revenueEstimate?: number
}

export interface RecentEarnings {
  symbol: string
  date: string
  epsActual?: number
  epsEstimate?: number
  surprisePercent?: number
}

export interface CorporateAction {
  symbol: string
  type: 'dividend'
  amount?: number
  exDate?: string
  payDate?: string
  frequency?: number
}

export interface EconomicRelease {
  event: string
  country: string
  time: string
  actual?: number | null
  estimate?: number | null
  prior?: number | null
  impact?: string
  unit?: string
}

export interface MarketEventsResponse {
  upcomingEarnings: UpcomingEarnings[]
  recentEarnings: RecentEarnings[]
  corporateActions: CorporateAction[]
  economicReleases: EconomicRelease[]
  /** False when no provider key is configured — the caller can stay quiet. */
  configured: boolean
}

const EMPTY: MarketEventsResponse = {
  upcomingEarnings: [], recentEarnings: [], corporateActions: [], economicReleases: [],
  configured: false,
}

const MAX_SYMBOLS = 12

export function useMarketEvents(symbols: string[], options?: { enabled?: boolean }) {
  const key = Array.from(new Set(symbols.filter(Boolean).map(s => s.toUpperCase())))
    .sort()
    .slice(0, MAX_SYMBOLS)

  return useQuery<MarketEventsResponse>({
    queryKey: ['market-events', key],
    // Runs even with no symbols: the economic calendar is symbol-independent
    // and a macro print matters regardless of what is on screen.
    enabled: options?.enabled ?? true,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('market-events', {
        body: { symbols: key, lookaheadDays: 21, lookbackDays: 14 },
      })
      if (error) throw error
      return (data ?? EMPTY) as MarketEventsResponse
    },
  })
}
