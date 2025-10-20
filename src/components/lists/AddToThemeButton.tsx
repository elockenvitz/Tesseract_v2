import React, { useState } from 'react'
import { Tag, X, Search } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { clsx } from 'clsx'

interface AddToThemeButtonProps {
  assetId: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

interface Theme {
  id: string
  name: string
  description: string | null
  color: string | null
  created_at: string | null
  updated_at: string | null
  created_by: string | null
  isAdded?: boolean
}

export function AddToThemeButton({
  assetId,
  variant = 'outline',
  size = 'sm',
  className
}: AddToThemeButtonProps) {
  const [showThemeDialog, setShowThemeDialog] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [addedToThemes, setAddedToThemes] = useState<Set<string>>(new Set())
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch available themes
  const { data: themes, isLoading } = useQuery({
    queryKey: ['themes', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('themes')
        .select('*')
        .eq('created_by', user?.id)
        .order('created_at', { ascending: false })

      if (error) throw error

      const themesData = data || []

      // Check which themes already have this asset
      const { data: existingThemeAssets } = await supabase
        .from('theme_assets')
        .select('theme_id')
        .eq('asset_id', assetId)

      const existingThemeIds = new Set(existingThemeAssets?.map(ta => ta.theme_id) || [])

      return themesData.map(theme => ({
        ...theme,
        isAdded: existingThemeIds.has(theme.id)
      })) as Theme[]
    },
    enabled: showThemeDialog
  })

  // Add to theme mutation
  const addToThemeMutation = useMutation({
    mutationFn: async (themeId: string) => {
      const { data, error } = await supabase
        .from('theme_assets')
        .insert({
          theme_id: themeId,
          asset_id: assetId
        })
        .select()

      if (error) {
        console.error('Error adding to theme:', error)
        throw error
      }
      console.log('Successfully added to theme:', data)
      return data
    },
    onSuccess: (_, themeId) => {
      // Add to local state for immediate feedback
      setAddedToThemes(prev => new Set([...prev, themeId]))

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['themes', assetId] })
      queryClient.invalidateQueries({ queryKey: ['asset-themes', assetId] })

      // Show success feedback
      setTimeout(() => {
        setAddedToThemes(prev => {
          const newSet = new Set(prev)
          newSet.delete(themeId)
          return newSet
        })
      }, 2000) // Remove feedback after 2 seconds
    }
  })

  const handleAddToTheme = (themeId: string) => {
    // Find the theme to check if asset is already added
    const targetTheme = themes?.find(theme => theme.id === themeId)
    if (targetTheme?.isAdded || addedToThemes.has(themeId)) {
      return
    }

    addToThemeMutation.mutate(themeId)
  }

  const filteredThemes = themes?.filter(theme =>
    !searchQuery ||
    theme.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (theme.description && theme.description.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  if (!showThemeDialog) {
    return (
      <Button
        variant={variant}
        size={size}
        onClick={() => setShowThemeDialog(true)}
        className={className}
      >
        <Tag className="h-4 w-4 mr-2" />
        Add to Theme
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={() => setShowThemeDialog(false)}
      />

      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full mx-auto transform transition-all max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Add to Theme</h3>
              <p className="text-sm text-gray-600 mt-1">Choose a theme to add this asset to</p>
            </div>
            <button
              onClick={() => setShowThemeDialog(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {/* Search */}
            <div className="flex items-center space-x-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search themes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {/* Themes Grid */}
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <Card>
                      <div className="space-y-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-4 h-4 bg-gray-200 rounded-full"></div>
                          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                        </div>
                        <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            ) : filteredThemes.length > 0 ? (
              <>
                {/* Available Themes Section */}
                {filteredThemes.filter(theme => !theme.isAdded).length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-gray-700">Available Themes</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredThemes.filter(theme => !theme.isAdded).map((theme) => (
                        <div
                          key={theme.id}
                          onClick={() => handleAddToTheme(theme.id)}
                          className="cursor-pointer transition-all duration-200 relative group hover:shadow-lg hover:scale-105"
                        >
                          <Card>
                            <div className="space-y-4">
                              {/* Header with theme name and color */}
                              <div className="flex items-start justify-between">
                                <div className="flex items-start space-x-3 flex-1 min-w-0">
                                  <div
                                    className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0 mt-1"
                                    style={{ backgroundColor: theme.color || '#3b82f6' }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center space-x-2 mb-2">
                                      <h4 className="font-semibold text-gray-900 truncate text-base">
                                        {theme.name}
                                      </h4>
                                    </div>
                                    {theme.description && (
                                      <p className="text-sm text-gray-600 truncate" title={theme.description}>
                                        {theme.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {addedToThemes.has(theme.id) && (
                              <div className={clsx(
                                "absolute inset-0 rounded-xl transition-all duration-200 flex items-center justify-center bg-success-500 bg-opacity-20"
                              )}>
                                <Badge variant="success" size="sm">
                                  Added!
                                </Badge>
                              </div>
                            )}
                          </Card>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Already Added Section */}
                {filteredThemes.filter(theme => theme.isAdded).length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-gray-700">Already in These Themes</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredThemes.filter(theme => theme.isAdded).map((theme) => (
                        <div
                          key={theme.id}
                          className="relative group opacity-60"
                        >
                          <Card>
                            <div className="space-y-4">
                              {/* Header with theme name and color */}
                              <div className="flex items-start justify-between">
                                <div className="flex items-start space-x-3 flex-1 min-w-0">
                                  <div
                                    className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0 mt-1"
                                    style={{ backgroundColor: theme.color || '#3b82f6' }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center space-x-2 mb-2">
                                      <h4 className="font-semibold text-gray-900 truncate text-base">
                                        {theme.name}
                                      </h4>
                                    </div>
                                    {theme.description && (
                                      <p className="text-sm text-gray-600 truncate" title={theme.description}>
                                        {theme.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </Card>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Tag className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {themes?.length === 0 ? 'No themes yet' : 'No themes match your search'}
                </h3>
                <p className="text-gray-500 mb-4">
                  {themes?.length === 0
                    ? 'Create a theme to get started.'
                    : 'Try adjusting your search criteria.'
                  }
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
            <Button variant="outline" onClick={() => setShowThemeDialog(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
