import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, TrendingUp, Search, UserPlus, UserMinus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'

interface UniverseRule {
  id: string
  type: string
  operator: any
  values: any
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
    console.log('🔍 Processing rule:', rule)

    // Handle array values (multi-select filters)
    if (Array.isArray(rule.values)) {
      console.log('📋 Rule has array values:', rule.values)

      switch (rule.type) {
        case 'analyst':
          const { data: coverageAssets } = await supabase
            .from('coverage')
            .select('asset_id')
            .in('user_id', rule.values)
          console.log(`✅ Analyst filter found ${coverageAssets?.length || 0} assets`)
          return coverageAssets?.map(c => c.asset_id) || []

        case 'list':
          const { data: listAssets } = await supabase
            .from('asset_list_items')
            .select('asset_id')
            .in('list_id', rule.values)
          console.log(`✅ List filter found ${listAssets?.length || 0} assets`)
          return listAssets?.map(l => l.asset_id) || []

        case 'theme':
          const { data: themeAssets } = await supabase
            .from('theme_assets')
            .select('asset_id')
            .in('theme_id', rule.values)
          console.log(`✅ Theme filter found ${themeAssets?.length || 0} assets`)
          return themeAssets?.map(t => t.asset_id) || []

        case 'sector':
          const { data: sectorAssets, error: sectorError } = await supabase
            .from('assets')
            .select('id')
            .in('sector', rule.values)
          if (sectorError) {
            console.error('❌ Sector query error:', sectorError)
          }
          console.log(`✅ Sector filter found ${sectorAssets?.length || 0} assets for sectors:`, rule.values)
          return sectorAssets?.map(a => a.id) || []

        case 'priority':
          const { data: priorityAssets } = await supabase
            .from('assets')
            .select('id')
            .in('priority', rule.values)
          console.log(`✅ Priority filter found ${priorityAssets?.length || 0} assets`)
          return priorityAssets?.map(a => a.id) || []

        case 'symbol':
          const { data: symbolAssets, error: symbolError } = await supabase
            .from('assets')
            .select('id')
            .in('symbol', rule.values)
          if (symbolError) {
            console.error('❌ Symbol query error:', symbolError)
          }
          console.log(`✅ Symbol filter found ${symbolAssets?.length || 0} assets for symbols:`, rule.values)
          return symbolAssets?.map(a => a.id) || []

        default:
          console.warn(`⚠️ Unknown filter type for array values: ${rule.type}`)
          return []
      }
    }

    // For now, return empty array for non-array filters (market_cap, price, etc.)
    // These would need server-side filtering or full asset scan
    console.warn(`⚠️ Filter type ${rule.type} with non-array values not yet supported in preview`)
    return []
  }

  // Fetch matching assets based on rules with AND/OR logic
  const { data: previewData, isLoading } = useQuery({
    queryKey: ['universe-preview-full', workflowId, rules],
    queryFn: async () => {
      console.log('🚀 Universe Preview Query Starting')
      console.log('📊 Workflow ID:', workflowId)
      console.log('📋 Rules received:', rules)
      console.log('📏 Number of rules:', rules.length)

      if (rules.length === 0) {
        console.log('⚠️ No rules provided, returning empty results')
        return { assets: [], totalCount: 0 }
      }

      // Process each rule and combine with AND/OR logic
      let resultAssetIds: Set<string> | null = null

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]
        console.log(`\n🔄 Processing rule ${i + 1}/${rules.length}:`, rule)
        const ruleAssetIds = await getAssetIdsForRule(rule)
        console.log(`📊 Rule ${i + 1} returned ${ruleAssetIds.length} asset IDs`)
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
        console.log('❌ No assets matched the rules')

        // Provide diagnostic info about why no matches
        const diagnostics = {
          totalRules: rules.length,
          rulesWithAnd: rules.filter(r => r.combineWith === 'AND').length,
          rulesWithOr: rules.filter(r => r.combineWith === 'OR').length
        }

        console.log('📊 Diagnostics:', diagnostics)
        return { assets: [], totalCount: 0, diagnostics }
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

  // Fetch universe overrides
  const { data: overrides = [] } = useQuery({
    queryKey: ['workflow-universe-overrides', workflowId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_universe_overrides')
        .select(`
          *,
          assets (
            id,
            symbol,
            company_name,
            sector,
            priority
          )
        `)
        .eq('workflow_id', workflowId)

      if (error) throw error
      return data || []
    }
  })

  // Apply overrides to the preview results
  let matchingAssets = [...(previewData?.assets || [])]
  const addedOverrides = overrides.filter((o: any) => o.override_type === 'add')
  const removedOverrides = overrides.filter((o: any) => o.override_type === 'remove')

  // Add manually added assets
  addedOverrides.forEach((override: any) => {
    if (!matchingAssets.find((a: any) => a.id === override.asset_id)) {
      matchingAssets.push({
        ...override.assets,
        _manuallyAdded: true
      })
    }
  })

  // Remove manually removed assets
  const removedAssetIds = new Set(removedOverrides.map((o: any) => o.asset_id))
  matchingAssets = matchingAssets.filter((asset: any) => {
    if (removedAssetIds.has(asset.id)) {
      return false
    }
    return true
  })

  const totalCount = matchingAssets.length
  const diagnostics = previewData?.diagnostics || null

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
              <div className="space-y-2 mb-4">
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-semibold text-green-900">
                      {totalCount === matchingAssets.length
                        ? `${totalCount} asset${totalCount === 1 ? '' : 's'} in this workflow's universe`
                        : `Showing ${matchingAssets.length} of ${totalCount} assets`
                      }
                    </span>
                  </div>
                </div>
                {(addedOverrides.length > 0 || removedOverrides.length > 0) && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center space-x-3 text-sm text-blue-900">
                      {addedOverrides.length > 0 && (
                        <div className="flex items-center space-x-1">
                          <UserPlus className="w-4 h-4 text-blue-600" />
                          <span className="font-medium">{addedOverrides.length} manually added</span>
                        </div>
                      )}
                      {removedOverrides.length > 0 && (
                        <div className="flex items-center space-x-1">
                          <UserMinus className="w-4 h-4 text-red-600" />
                          <span className="font-medium">{removedOverrides.length} manually removed</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
                  <div
                    key={asset.id}
                    className={`p-4 border rounded-lg transition-colors ${
                      asset._manuallyAdded
                        ? 'border-green-300 bg-green-50 hover:bg-green-100'
                        : 'border-gray-200 hover:bg-blue-50'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className={`flex items-center justify-center w-10 h-10 rounded font-bold text-sm flex-shrink-0 ${
                        asset._manuallyAdded
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {asset.symbol.substring(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <div className="font-semibold text-sm text-gray-900">{asset.symbol}</div>
                          {asset._manuallyAdded && (
                            <div className="flex items-center space-x-1" title="Manually added override">
                              <UserPlus className="w-3 h-3 text-green-600" />
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 truncate">{asset.company_name}</div>
                        <div className="flex items-center space-x-2 mt-1 flex-wrap gap-1">
                          {asset._manuallyAdded && (
                            <Badge variant="success" size="xs" className="text-xs">
                              Manual Override
                            </Badge>
                          )}
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
              <p className="text-sm font-medium text-gray-700 mb-2">No matching assets found</p>

              {/* Provide helpful context based on rule configuration */}
              {diagnostics && diagnostics.rulesWithAnd > 0 ? (
                <div className="max-w-md mx-auto">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-3">
                    <p className="text-sm text-amber-800 mb-2">
                      <strong>Your filters are using AND logic</strong>, which means assets must match <strong>all</strong> conditions simultaneously.
                    </p>
                    <p className="text-xs text-amber-700">
                      It appears no assets exist that match all {diagnostics.totalRules} filters at the same time.
                    </p>
                  </div>
                  <div className="space-y-2 text-left">
                    <p className="text-xs font-medium text-gray-700">Try these solutions:</p>
                    <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                      <li>Change some AND combinators to OR to broaden your criteria</li>
                      <li>Remove or modify filters that may be too restrictive</li>
                      <li>Choose filters with overlapping asset pools</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="max-w-md mx-auto">
                  <p className="text-xs text-gray-500 mb-3">
                    No assets match your current filter criteria.
                  </p>
                  <div className="space-y-2 text-left">
                    <p className="text-xs font-medium text-gray-700">Suggestions:</p>
                    <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                      <li>Try different filter values</li>
                      <li>Add more rules with OR logic to expand coverage</li>
                      <li>Verify that assets exist matching these criteria</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
