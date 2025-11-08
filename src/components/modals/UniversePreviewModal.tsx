import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, TrendingUp, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'

interface UniverseRule {
  id: string
  type: 'analyst' | 'list' | 'theme' | 'sector' | 'priority'
  operator: 'includes' | 'excludes'
  values: string[]
  combineWith?: 'AND' | 'OR'
}

interface UniversePreviewModalProps {
  workflowId: string
  rules: UniverseRule[]
  onClose: () => void
}

export function UniversePreviewModal({ workflowId, rules, onClose }: UniversePreviewModalProps) {
  const [searchTerm, setSearchTerm] = useState('')

  // Helper function to get asset IDs matching a single rule
  const getAssetIdsForRule = async (rule: UniverseRule): Promise<string[]> => {
    switch (rule.type) {
      case 'analyst':
        const { data: coverageAssets } = await supabase
          .from('coverage')
          .select('asset_id')
          .in('user_id', rule.values)
        return coverageAssets?.map(c => c.asset_id) || []

      case 'list':
        const { data: listAssets } = await supabase
          .from('asset_list_items')
          .select('asset_id')
          .in('list_id', rule.values)
        return listAssets?.map(l => l.asset_id) || []

      case 'theme':
        const { data: themeAssets } = await supabase
          .from('theme_assets')
          .select('asset_id')
          .in('theme_id', rule.values)
        return themeAssets?.map(t => t.asset_id) || []

      case 'sector':
        const { data: sectorAssets } = await supabase
          .from('assets')
          .select('id')
          .in('sector', rule.values)
        return sectorAssets?.map(a => a.id) || []

      case 'priority':
        const { data: priorityAssets } = await supabase
          .from('assets')
          .select('id')
          .in('priority', rule.values)
        return priorityAssets?.map(a => a.id) || []

      default:
        return []
    }
  }

  // Fetch matching assets based on rules with AND/OR logic
  const { data: previewData, isLoading } = useQuery({
    queryKey: ['universe-preview-full', workflowId, rules],
    queryFn: async () => {
      if (rules.length === 0) return { assets: [], totalCount: 0 }

      // Process each rule and combine with AND/OR logic
      let resultAssetIds: Set<string> | null = null

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]
        const ruleAssetIds = await getAssetIdsForRule(rule)
        const ruleSet = new Set(ruleAssetIds)

        // Apply include/exclude operator
        let processedSet: Set<string>
        if (rule.operator === 'excludes') {
          // For exclude, we'll need to get all assets first, then remove these
          // For now, we'll handle this differently - mark these to exclude later
          processedSet = ruleSet
        } else {
          processedSet = ruleSet
        }

        if (i === 0) {
          // First rule initializes the result
          if (rule.operator === 'includes') {
            resultAssetIds = processedSet
          } else {
            // If first rule is exclude, start with all assets and remove
            const { data: allAssets } = await supabase
              .from('assets')
              .select('id')
            const allIds = new Set(allAssets?.map(a => a.id) || [])
            processedSet.forEach(id => allIds.delete(id))
            resultAssetIds = allIds
          }
        } else {
          // Combine with previous results using AND/OR
          const combinator = rule.combineWith || 'OR'

          if (rule.operator === 'includes') {
            if (combinator === 'AND') {
              // Keep only assets that are in both sets
              resultAssetIds = new Set([...resultAssetIds!].filter(id => processedSet.has(id)))
            } else {
              // Add all assets from this rule
              processedSet.forEach(id => resultAssetIds!.add(id))
            }
          } else {
            // Exclude operator
            if (combinator === 'AND') {
              // Remove these assets from results (only if they're in results)
              processedSet.forEach(id => resultAssetIds!.delete(id))
            } else {
              // OR with exclude: remove from results
              processedSet.forEach(id => resultAssetIds!.delete(id))
            }
          }
        }
      }

      if (!resultAssetIds || resultAssetIds.size === 0) {
        console.log('No assets matched the rules')
        return { assets: [], totalCount: 0 }
      }

      const totalCount = resultAssetIds.size
      console.log(`Total assets matching rules: ${totalCount}`)

      // Fetch full asset details for the resulting IDs
      const finalIds = Array.from(resultAssetIds).slice(0, 100)
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, priority')
        .in('id', finalIds)

      if (error) {
        console.error('Error fetching preview assets:', error)
        return { assets: [], totalCount: 0 }
      }

      console.log(`Fetched ${data?.length || 0} asset details`)
      return { assets: data || [], totalCount }
    }
  })

  const matchingAssets = previewData?.assets || []
  const totalCount = previewData?.totalCount || 0

  // Filter assets based on search term
  const filteredAssets = matchingAssets.filter((asset: any) => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      asset.symbol?.toLowerCase().includes(search) ||
      asset.company_name?.toLowerCase().includes(search) ||
      asset.sector?.toLowerCase().includes(search)
    )
  })

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 pt-20">
      <Card className="w-full max-w-4xl h-[75vh] overflow-hidden flex flex-col bg-white">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Universe Preview</h3>
              <p className="text-sm text-gray-500 mt-1">Assets that match your universe rules</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="p-6">
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-200 rounded"></div>
                    <div className="flex-1">
                      <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-32"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : matchingAssets && matchingAssets.length > 0 ? (
            <div>
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg mb-4">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-green-900">
                    {totalCount === matchingAssets.length
                      ? `${totalCount} asset${totalCount === 1 ? '' : 's'} match your universe rules`
                      : `Showing ${matchingAssets.length} of ${totalCount} matching assets`
                    }
                  </span>
                </div>
              </div>

              {/* Search Bar */}
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by symbol, company name, or sector..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {searchTerm && (
                  <p className="text-xs text-gray-500 mt-2">
                    Showing {filteredAssets.length} of {matchingAssets.length} assets
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredAssets.map((asset: any) => (
                  <div key={asset.id} className="p-4 border border-gray-200 rounded-lg hover:bg-blue-50 transition-colors">
                    <div className="flex items-start space-x-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded bg-blue-100 text-blue-700 font-bold text-sm flex-shrink-0">
                        {asset.symbol.substring(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-900">{asset.symbol}</div>
                        <div className="text-xs text-gray-600 truncate">{asset.company_name}</div>
                        <div className="flex items-center space-x-2 mt-1">
                          {asset.sector && (
                            <Badge variant="outline" size="xs" className="text-xs">
                              {asset.sector}
                            </Badge>
                          )}
                          {asset.priority && (
                            <Badge variant="secondary" size="xs" className="text-xs">
                              {asset.priority}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
                <Search className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">No matching assets found</p>
              <p className="text-xs text-gray-400 mt-1">Try different criteria or add more rules</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
