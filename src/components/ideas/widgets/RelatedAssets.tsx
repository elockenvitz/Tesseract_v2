import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Link2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

interface RelatedAssetsProps {
  assetId: string
  limit?: number
  onAssetClick?: (assetId: string, symbol: string) => void
  className?: string
}

interface RelatedAsset {
  id: string
  symbol: string
  company_name: string
  current_price?: number
  change_percent?: number
  relation_type: 'theme' | 'sector' | 'correlation'
}

export function RelatedAssets({
  assetId,
  limit = 4,
  onAssetClick,
  className
}: RelatedAssetsProps) {
  const { data: relatedAssets = [], isLoading } = useQuery({
    queryKey: ['related-assets', assetId, limit],
    queryFn: async (): Promise<RelatedAsset[]> => {
      // First, get the current asset's themes
      const { data: themeLinks } = await supabase
        .from('theme_asset_links')
        .select('theme_id')
        .eq('asset_id', assetId)

      if (!themeLinks || themeLinks.length === 0) {
        return []
      }

      const themeIds = themeLinks.map(t => t.theme_id)

      // Find assets in the same themes
      const { data: relatedLinks } = await supabase
        .from('theme_asset_links')
        .select(`
          asset_id,
          assets (
            id,
            symbol,
            company_name,
            current_price
          )
        `)
        .in('theme_id', themeIds)
        .neq('asset_id', assetId)
        .limit(limit * 2) // Get more to dedupe

      if (!relatedLinks) {
        return []
      }

      // Dedupe and format
      const seen = new Set<string>()
      const assets: RelatedAsset[] = []

      for (const link of relatedLinks) {
        if (!link.assets || seen.has(link.assets.id)) continue
        seen.add(link.assets.id)

        assets.push({
          id: link.assets.id,
          symbol: link.assets.symbol,
          company_name: link.assets.company_name,
          current_price: link.assets.current_price,
          relation_type: 'theme'
        })

        if (assets.length >= limit) break
      }

      return assets
    },
    enabled: !!assetId,
    staleTime: 300000 // 5 minutes
  })

  if (isLoading) {
    return (
      <div className={clsx('flex gap-2', className)}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="h-8 w-16 bg-gray-100 rounded-lg" />
          </div>
        ))}
      </div>
    )
  }

  if (relatedAssets.length === 0) {
    return null
  }

  return (
    <div className={clsx('space-y-2', className)}>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link2 className="h-3 w-3" />
        <span>Related</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {relatedAssets.map(asset => (
          <button
            key={asset.id}
            onClick={() => onAssetClick?.(asset.id, asset.symbol)}
            className="flex items-center gap-1 px-2 py-1 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm transition-colors"
          >
            <span className="font-semibold text-gray-900">${asset.symbol}</span>
            {asset.current_price && (
              <span className="text-gray-500 text-xs">
                ${asset.current_price.toFixed(2)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export default RelatedAssets
