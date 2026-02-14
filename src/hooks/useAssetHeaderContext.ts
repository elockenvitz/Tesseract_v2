import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface AssetHeaderContext {
  portfolios: Array<{ id: string; name: string }>
  listsShared: Array<{ id: string; name: string }>
  listsMine: Array<{ id: string; name: string }>
  themes: Array<{ id: string; name: string }>
  projectsCount: number
  isLoading: boolean
  isError: boolean
}

export function useAssetHeaderContext(assetId: string | undefined): AssetHeaderContext {
  const { user } = useAuth()

  const { data: portfolios = [], isLoading: pLoading, isError: pError } = useQuery({
    queryKey: ['asset-context-portfolios', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, portfolios(id, name)')
        .eq('asset_id', assetId!)
      if (error) throw error
      // Deduplicate by portfolio_id
      const seen = new Set<string>()
      return (data || [])
        .map((h: any) => h.portfolios)
        .filter((p: any): p is { id: string; name: string } => {
          if (!p || seen.has(p.id)) return false
          seen.add(p.id)
          return true
        })
    },
    enabled: !!assetId,
    staleTime: 60_000,
  })

  const { data: lists, isLoading: lLoading, isError: lError } = useQuery({
    queryKey: ['asset-context-lists', assetId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_items')
        .select('asset_lists(id, name, created_by)')
        .eq('asset_id', assetId!)
      if (error) throw error
      const all = (data || [])
        .map((d: any) => d.asset_lists)
        .filter(Boolean) as Array<{ id: string; name: string; created_by: string }>
      const mine: Array<{ id: string; name: string }> = []
      const shared: Array<{ id: string; name: string }> = []
      for (const l of all) {
        if (l.created_by === user?.id) {
          mine.push({ id: l.id, name: l.name })
        } else {
          shared.push({ id: l.id, name: l.name })
        }
      }
      return { mine, shared }
    },
    enabled: !!assetId && !!user?.id,
    staleTime: 60_000,
  })

  const { data: themes = [], isLoading: tLoading, isError: tError } = useQuery({
    queryKey: ['asset-context-themes', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('theme_assets')
        .select('themes(id, name)')
        .eq('asset_id', assetId!)
      if (error) throw error
      return (data || [])
        .map((d: any) => d.themes)
        .filter(Boolean) as Array<{ id: string; name: string }>
    },
    enabled: !!assetId,
    staleTime: 60_000,
  })

  const { data: projectsCount = 0, isLoading: prLoading, isError: prError } = useQuery({
    queryKey: ['asset-context-projects', assetId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('context_type', 'asset')
        .eq('context_id', assetId!)
        .is('deleted_at', null)
      if (error) throw error
      return count || 0
    },
    enabled: !!assetId,
    staleTime: 60_000,
  })

  return {
    portfolios,
    listsShared: lists?.shared ?? [],
    listsMine: lists?.mine ?? [],
    themes,
    projectsCount,
    isLoading: pLoading || lLoading || tLoading || prLoading,
    isError: pError || lError || tError || prError,
  }
}
