/**
 * AssetsListPage - All Assets view
 *
 * Simple page that displays all assets in the platform using AssetTableView.
 * This is the default "All Assets" list available to all users.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { AssetTableView } from '../components/table/AssetTableView'
import { ListSkeleton } from '../components/common/LoadingSkeleton'

interface AssetsListPageProps {
  onAssetSelect?: (asset: any) => void
}

export function AssetsListPage({ onAssetSelect }: AssetsListPageProps) {
  // Fetch all assets
  const { data: assets, isLoading } = useQuery({
    queryKey: ['all-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    staleTime: 30 * 1000, // 30 seconds
  })

  if (isLoading && !assets) {
    return (
      <div className="p-6">
        <ListSkeleton />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <AssetTableView
          assets={assets || []}
          isLoading={isLoading}
          onAssetSelect={onAssetSelect}
          storageKey="allAssetsTableColumns"
          fillHeight
        />
      </div>
    </div>
  )
}

export default AssetsListPage
