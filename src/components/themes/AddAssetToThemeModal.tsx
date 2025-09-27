import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Plus, TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { PriorityBadge } from '../ui/PriorityBadge'
import { clsx } from 'clsx'

interface AddAssetToThemeModalProps {
  isOpen: boolean
  onClose: () => void
  themeId: string
  themeName: string
}

export function AddAssetToThemeModal({ isOpen, onClose, themeId, themeName }: AddAssetToThemeModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch available assets (excluding those already in the theme)
  const { data: availableAssets, isLoading } = useQuery({
    queryKey: ['available-assets-for-theme', themeId, searchQuery],
    queryFn: async () => {
      // First get assets already in this theme
      const { data: existingThemeAssets } = await supabase
        .from('theme_assets')
        .select('asset_id')
        .eq('theme_id', themeId)

      const existingAssetIds = existingThemeAssets?.map(ta => ta.asset_id) || []

      // Then get all assets not in this theme
      let query = supabase
        .from('assets')
        .select('*')
        .order('symbol', { ascending: true })

      if (existingAssetIds.length > 0) {
        query = query.not('id', 'in', `(${existingAssetIds.join(',')})`)
      }

      if (searchQuery.trim()) {
        query = query.or(`symbol.ilike.%${searchQuery}%,company_name.ilike.%${searchQuery}%`)
      }

      const { data, error } = await query.limit(20)
      
      if (error) throw error
      return data || []
    },
    enabled: isOpen
  })

  // Add assets to theme mutation
  const addAssetsToThemeMutation = useMutation({
    mutationFn: async ({ assetIds, notes }: { assetIds: string[]; notes: string }) => {
      const themeAssets = assetIds.map(assetId => ({
        theme_id: themeId,
        asset_id: assetId,
        added_by: user?.id,
        notes: notes.trim() || null
      }))

      const { error } = await supabase
        .from('theme_assets')
        .insert(themeAssets)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-related-assets', themeId] })
      queryClient.invalidateQueries({ queryKey: ['available-assets-for-theme', themeId] })
      setSelectedAssets([])
      setNotes('')
      onClose()
    }
  })

  const handleAddAssets = () => {
    if (selectedAssets.length === 0) return
    
    addAssetsToThemeMutation.mutate({
      assetIds: selectedAssets,
      notes
    })
  }

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssets(prev => 
      prev.includes(assetId) 
        ? prev.filter(id => id !== assetId)
        : [...prev, assetId]
    )
  }


  const getStageColor = (stage: string | null) => {
    switch (stage) {
      case 'research': return 'primary'
      case 'analysis': return 'warning'
      case 'monitoring': return 'success'
      case 'review': return 'default'
      case 'archived': return 'default'
      default: return 'default'
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full mx-auto transform transition-all max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Add Assets to Theme</h3>
              <p className="text-sm text-gray-600 mt-1">
                Add related assets to "{themeName}"
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-200px)]">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search assets by symbol or company name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Selected Assets Summary */}
            {selectedAssets.length > 0 && (
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    {selectedAssets.length} asset{selectedAssets.length !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={() => setSelectedAssets([])}
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Clear selection
                  </button>
                </div>
              </Card>
            )}

            {/* Notes for the relationship */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about why these assets relate to this theme..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                rows={3}
              />
            </div>

            {/* Assets List */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Available Assets</h4>
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <Card>
                        <div className="flex items-center space-x-3">
                          <div className="w-4 h-4 bg-gray-200 rounded"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                          </div>
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              ) : availableAssets && availableAssets.length > 0 ? (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {availableAssets.map((asset) => (
                    <Card
                      key={asset.id}
                      className={clsx(
                        'cursor-pointer transition-all duration-200',
                        selectedAssets.includes(asset.id)
                          ? 'ring-2 ring-primary-500 bg-primary-50'
                          : 'hover:shadow-md'
                      )}
                      onClick={() => toggleAssetSelection(asset.id)}
                    >
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={selectedAssets.includes(asset.id)}
                          onChange={() => toggleAssetSelection(asset.id)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <h4 className="font-semibold text-gray-900">{asset.symbol}</h4>
                            {asset.priority && (
                              <PriorityBadge priority={asset.priority} />
                            )}
                            {asset.process_stage && (
                              <Badge variant={getStageColor(asset.process_stage)} size="sm">
                                {asset.process_stage}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 truncate">{asset.company_name}</p>
                          {asset.sector && (
                            <p className="text-xs text-gray-500">{asset.sector}</p>
                          )}
                        </div>
                        <div className="text-right">
                          {asset.current_price && (
                            <p className="text-sm font-semibold text-gray-900">
                              ${asset.current_price}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <TrendingUp className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm">
                    {searchQuery ? 'No assets found matching your search' : 'All assets are already added to this theme'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleAddAssets}
              disabled={selectedAssets.length === 0 || addAssetsToThemeMutation.isPending}
              loading={addAssetsToThemeMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add {selectedAssets.length} Asset{selectedAssets.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}