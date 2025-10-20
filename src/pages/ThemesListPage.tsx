import { useState, useMemo } from 'react'
import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag, Search, Filter, Plus, Calendar, FileText, ArrowUpDown, ChevronDown, X, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Select } from '../components/ui/Select'
import { Input } from '../components/ui/Input'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface ThemesListPageProps {
  onThemeSelect?: (theme: any) => void
}

export function ThemesListPage({ onThemeSelect }: ThemesListPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  
  // Theme creation form state
  const [newThemeName, setNewThemeName] = useState('')
  const [newThemeDescription, setNewThemeDescription] = useState('')
  const [newThemeType, setNewThemeType] = useState('general')
  const [newThemeColor, setNewThemeColor] = useState('#3b82f6')
  const [newThemeIsPublic, setNewThemeIsPublic] = useState(false)
  const [similarThemes, setSimilarThemes] = useState<any[]>([])
  const [searchingSimilar, setSearchingSimilar] = useState(false)
  
  const queryClient = useQueryClient()
  const { user } = useAuth()
  
  // Color options for theme creation
  const colorOptions = [
    { value: '#3b82f6', label: 'Blue' },
    { value: '#10b981', label: 'Green' },
    { value: '#f59e0b', label: 'Yellow' },
    { value: '#ef4444', label: 'Red' },
    { value: '#8b5cf6', label: 'Purple' },
    { value: '#06b6d4', label: 'Cyan' },
    { value: '#f97316', label: 'Orange' },
    { value: '#6b7280', label: 'Gray' }
  ]

  // Fetch themes user has access to (owned, collaborated, or has assets in)
  const { data: themes, isLoading } = useQuery({
    queryKey: ['all-themes', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      console.log('🔍 Fetching accessible themes from database for user:', user.id)
      try {
        // Get all themes - we'll show all themes the user has any connection to
        const { data: allThemes, error: themesError } = await supabase
          .from('themes')
          .select(`
            *,
            theme_notes(id, title, updated_at),
            theme_assets(asset_id)
          `)
          .order('created_at', { ascending: false })

        if (themesError) {
          console.error('❌ Error fetching themes:', themesError)
          throw themesError
        }

        console.log('📊 All themes:', allThemes?.length || 0, allThemes)
        console.log('✅ Themes summary:')
        console.log('  - Total themes:', allThemes?.length || 0)
        console.log('  - Final themes:', allThemes)

        return allThemes || []
      } catch (fetchError) {
        console.error('❌ Network or fetch error:', fetchError)

        // Check if it's a network connectivity issue
        if (fetchError instanceof TypeError && fetchError.message === 'Failed to fetch') {
          throw new Error('Network error: Unable to connect to the database. Please check your internet connection and try again.')
        }

        throw fetchError
      }
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true, // Refetch when window regains focus
    retry: (failureCount, error) => {
      // Don't retry on RLS policy errors
      if (error?.message?.includes('Access denied') || error?.message?.includes('policy')) {
        return false
      }
      // Retry network errors up to 2 times
      return failureCount < 2
    },
  })

  // Filter and sort themes
  const filteredThemes = useMemo(() => {
    if (!themes) return []

    let filtered = themes.filter(theme => {
      // Search filter
      const matchesSearch = !searchQuery || 
        theme.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (theme.description && theme.description.toLowerCase().includes(searchQuery.toLowerCase()))

      // Type filter
      const matchesType = typeFilter === 'all' || theme.theme_type === typeFilter

      return matchesSearch && matchesType
    })

    // Sort themes
    filtered.sort((a, b) => {
      let aValue, bValue

      switch (sortBy) {
        case 'name':
          aValue = a.name
          bValue = b.name
          break
        case 'theme_type':
          aValue = a.theme_type || 'general'
          bValue = b.theme_type || 'general'
          break
        case 'notes_count':
          aValue = a.theme_notes?.length || 0
          bValue = b.theme_notes?.length || 0
          break
        case 'created_at':
        default:
          aValue = new Date(a.created_at || 0).getTime()
          bValue = new Date(b.created_at || 0).getTime()
          break
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    })

    return filtered
  }, [themes, searchQuery, typeFilter, sortBy, sortOrder])

  const getThemeTypeColor = (type: string | null) => {
    switch (type) {
      case 'sector': return 'primary'
      case 'geography': return 'success'
      case 'strategy': return 'warning'
      case 'macro': return 'error'
      case 'general': return 'default'
      default: return 'default'
    }
  }

  // Search for similar themes when typing
  const searchSimilarThemes = async (name: string) => {
    if (!name.trim() || name.length < 2) {
      setSimilarThemes([])
      return
    }

    setSearchingSimilar(true)
    try {
      const { data, error } = await supabase
        .from('themes')
        .select('id, name, description, theme_type, color')
        .or(`name.ilike.%${name}%,description.ilike.%${name}%`)
        .limit(5)

      if (error) throw error
      setSimilarThemes(data || [])
    } catch (error) {
      console.error('Error searching similar themes:', error)
      setSimilarThemes([])
    } finally {
      setSearchingSimilar(false)
    }
  }

  // Debounced search for similar themes
  React.useEffect(() => {
    const timer = setTimeout(() => {
      searchSimilarThemes(newThemeName)
    }, 300)

    return () => clearTimeout(timer)
  }, [newThemeName])

  // Create theme mutation
  const createThemeMutation = useMutation({
    mutationFn: async (themeData: {
      name: string
      description: string
      theme_type: string
      color: string
      is_public: boolean
    }) => {
      const { data, error } = await supabase
        .from('themes')
        .insert([{
          name: themeData.name,
          description: themeData.description,
          theme_type: themeData.theme_type,
          color: themeData.color,
          is_public: themeData.is_public,
          created_by: user?.id
        }])
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (newTheme) => {
      queryClient.invalidateQueries({ queryKey: ['all-themes'] })
      setShowCreateForm(false)
      setNewThemeName('')
      setNewThemeDescription('')
      setNewThemeType('general')
      setNewThemeColor('#3b82f6')
      setNewThemeIsPublic(false)
      setSimilarThemes([])
      
      // Navigate to the new theme if onThemeSelect is provided
      if (onThemeSelect) {
        onThemeSelect({
          id: newTheme.id,
          title: newTheme.name,
          type: 'theme',
          data: newTheme
        })
      }
    },
    onError: (error) => {
      console.error('Failed to create theme:', error)
    }
  })

  const handleCreateTheme = () => {
    if (!newThemeName.trim()) return

    createThemeMutation.mutate({
      name: newThemeName.trim(),
      description: newThemeDescription.trim(),
      theme_type: newThemeType,
      color: newThemeColor,
      is_public: newThemeIsPublic
    })
  }

  const handleSimilarThemeClick = (theme: any) => {
    setShowCreateForm(false)
    setNewThemeName('')
    setNewThemeDescription('')
    setNewThemeType('general')
    setNewThemeColor('#3b82f6')
    setNewThemeIsPublic(false)
    setSimilarThemes([])
    
    if (onThemeSelect) {
      onThemeSelect({
        id: theme.id,
        title: theme.name,
        type: 'theme',
        data: theme
      })
    }
  }
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const handleThemeClick = (theme: any) => {
    if (onThemeSelect) {
      onThemeSelect({
        id: theme.id,
        title: theme.name,
        type: 'theme',
        data: theme
      })
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setTypeFilter('all')
    setSortBy('created_at')
    setSortOrder('desc')
  }

  const activeFiltersCount = [
    searchQuery,
    typeFilter !== 'all' ? typeFilter : null
  ].filter(Boolean).length

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Themes</h1>
          <p className="text-gray-600">
            {filteredThemes.length} of {themes?.length || 0} themes
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Theme
        </Button>
      </div>

      {/* Search and Filters */}
      <Card>
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by theme name or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Filter Toggle */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <Badge variant="primary" size="sm">
                  {activeFiltersCount}
                </Badge>
              )}
              <ChevronDown className={clsx(
                'h-4 w-4 transition-transform',
                showFilters && 'rotate-180'
              )} />
            </button>

            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-primary-600 hover:text-primary-700 transition-colors"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Filter Controls */}
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
              <Select
                label="Theme Type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'sector', label: 'Sector' },
                  { value: 'geography', label: 'Geography' },
                  { value: 'strategy', label: 'Strategy' },
                  { value: 'macro', label: 'Macro' },
                  { value: 'general', label: 'General' }
                ]}
              />

              <Select
                label="Sort by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                options={[
                  { value: 'created_at', label: 'Date Created' },
                  { value: 'name', label: 'Theme Name' },
                  { value: 'theme_type', label: 'Theme Type' }
                ]}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Themes List */}
      <Card padding="none">
        {isLoading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center space-x-4">
                    <div className="w-4 h-4 bg-gray-200 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-16"></div>
                      <div className="h-3 bg-gray-200 rounded w-12"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : filteredThemes.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {/* Table Header */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-5">
                  <button
                    onClick={() => handleSort('name')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Theme</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('theme_type')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Type</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-5">
                  <button
                    onClick={() => handleSort('created_at')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Created</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Themes Rows */}
            {filteredThemes.map((theme) => (
              <div
                key={theme.id}
                onClick={() => handleThemeClick(theme)}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="grid grid-cols-12 gap-4 items-center">
                  {/* Theme Info */}
                  <div className="col-span-5">
                    <div className="flex items-center space-x-3">
                      <div 
                        className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                        style={{ backgroundColor: theme.color || '#3b82f6' }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {theme.name}
                          </p>
                        </div>
                        {theme.description && (
                          <p className="text-sm text-gray-600 truncate">
                            {theme.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Theme Type */}
                  <div className="col-span-2">
                    <Badge variant={getThemeTypeColor(theme.theme_type)} size="sm">
                      {theme.theme_type || 'general'}
                    </Badge>
                  </div>

                  {/* Created Date */}
                  <div className="col-span-5">
                    <div className="flex items-center text-sm text-gray-500">
                      <Calendar className="h-3 w-3 mr-1" />
                      {formatDistanceToNow(new Date(theme.created_at || 0), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Tag className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {themes?.length === 0 ? 'No themes yet' : 'No themes match your filters'}
            </h3>
            <p className="text-gray-500 mb-4">
              {themes?.length === 0 
                ? 'Start by creating your first theme to organize your research.'
                : 'Try adjusting your search criteria or clearing filters.'
              }
            </p>
            {themes?.length === 0 && (
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add First Theme
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* Create Theme Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setShowCreateForm(false)}
          />
          
          {/* Dialog */}
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all h-[600px] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Create New Theme</h3>
                  <p className="text-sm text-gray-600 mt-1">Organize your investment ideas by theme</p>
                </div>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 flex-1 overflow-y-auto">
                {/* Theme Name with Type-ahead */}
                <div>
                  <Input
                    label="Theme Name"
                    value={newThemeName}
                    onChange={(e) => setNewThemeName(e.target.value)}
                    placeholder="Enter theme name..."
                  />
                  
                  {/* Similar Themes Warning */}
                  {similarThemes.length > 0 && (
                    <div className="mt-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-start space-x-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-amber-900 mb-2">
                            Similar themes found
                          </h4>
                          <p className="text-sm text-amber-800 mb-3">
                            Consider using an existing theme instead of creating a duplicate:
                          </p>
                          <div className="space-y-2">
                            {similarThemes.map((theme) => (
                              <div
                                key={theme.id}
                                onClick={() => handleSimilarThemeClick(theme)}
                                className="flex items-center justify-between p-3 bg-white border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-50 transition-colors"
                              >
                                <div className="flex items-center space-x-3">
                                  <div 
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: theme.color || '#3b82f6' }}
                                  />
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">{theme.name}</p>
                                    {theme.description && (
                                      <p className="text-xs text-gray-600 line-clamp-1">
                                        {theme.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Badge variant={getThemeTypeColor(theme.theme_type)} size="sm">
                                    {theme.theme_type || 'general'}
                                  </Badge>
                                  <span className="text-xs text-amber-700">Click to open →</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {searchingSimilar && (
                    <div className="mt-2 flex items-center text-sm text-gray-500">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-500 mr-2" />
                      Checking for similar themes...
                    </div>
                  )}
                </div>
                
                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description (optional)
                  </label>
                  <textarea
                    value={newThemeDescription}
                    onChange={(e) => setNewThemeDescription(e.target.value)}
                    placeholder="Describe this investment theme..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    rows={3}
                  />
                </div>
                
                {/* Theme Type */}
                <Select
                  label="Theme Type"
                  value={newThemeType}
                  onChange={(e) => setNewThemeType(e.target.value)}
                  options={[
                    { value: 'general', label: 'General' },
                    { value: 'sector', label: 'Sector' },
                    { value: 'geography', label: 'Geography' },
                    { value: 'strategy', label: 'Strategy' },
                    { value: 'macro', label: 'Macro' }
                  ]}
                />
                
                {/* Color Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Color
                  </label>
                  <div className="flex space-x-2">
                    {colorOptions.map((color) => (
                      <button
                        key={color.value}
                        onClick={() => setNewThemeColor(color.value)}
                        className={clsx(
                          'w-8 h-8 rounded-full border-2 transition-all',
                          newThemeColor === color.value
                            ? 'border-gray-900 scale-110'
                            : 'border-gray-300 hover:scale-105'
                        )}
                        style={{ backgroundColor: color.value }}
                        title={color.label}
                      />
                    ))}
                  </div>
                </div>

                {/* Public/Private Settings */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Visibility
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={newThemeIsPublic}
                      onChange={(e) => setNewThemeIsPublic(e.target.checked)}
                      className="mr-2 rounded"
                    />
                    <span className="text-sm text-gray-700">
                      Make public (visible to all users)
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    {newThemeIsPublic
                      ? 'This theme will be visible to everyone. You can share write access with specific users after creation.'
                      : 'This theme will be private. You can share it with specific users after creation.'
                    }
                  </p>
                </div>
              </div>
              {/* Footer */}
              <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCreateForm(false)
                    setNewThemeName('')
                    setNewThemeDescription('')
                    setNewThemeType('general')
                    setNewThemeColor('#3b82f6')
                    setNewThemeIsPublic(false)
                    setSimilarThemes([])
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateTheme}
                  disabled={!newThemeName.trim() || createThemeMutation.isPending}
                  loading={createThemeMutation.isPending}
                >
                  Create Theme
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}