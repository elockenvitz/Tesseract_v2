/**
 * useAssetGroupingMeta — sector / country / industry for a set of assets.
 *
 * SimulationRow carries `sector` and nothing else, because the baseline
 * holdings are a JSONB snapshot and the variant's asset join selects four
 * columns. Grouping the simulation by country or industry therefore needs a
 * lookup rather than a wider row, and a lookup is the cheaper answer: it is one
 * small query keyed on the assets already on screen, and it does not require
 * regenerating every stored baseline to add a field.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface AssetGroupingMeta {
  sector: string | null
  country: string | null
  industry: string | null
}

export function useAssetGroupingMeta(assetIds: string[]) {
  // Sorted so the key is stable regardless of row order, which changes with
  // every sort and would otherwise refetch on each one.
  const key = [...new Set(assetIds)].sort()

  return useQuery({
    queryKey: ['asset-grouping-meta', key],
    enabled: key.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const out: Record<string, AssetGroupingMeta> = {}
      const CHUNK = 200
      for (let i = 0; i < key.length; i += CHUNK) {
        const { data, error } = await supabase
          .from('assets')
          .select('id, sector, country, industry')
          .in('id', key.slice(i, i + CHUNK))
        if (error) throw error
        for (const row of (data ?? []) as any[]) {
          out[row.id] = {
            sector: row.sector ?? null,
            country: row.country ?? null,
            industry: row.industry ?? null,
          }
        }
      }
      return out
    },
  })
}
