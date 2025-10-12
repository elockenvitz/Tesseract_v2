import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { List, Plus, Search, X, Users, Share2, MoreVertical, Edit3, Trash2, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface AssetListManagerProps {
  isOpen: boolean
  onClose: () => void
  onListSelect?: (list: any) => void
  selectedAssetId?: string // If provided, show "Add to List" functionality
}

interface AssetList {
  id: string
  name: string
  description: string | null
  color: string | null
  is_default: boolean | null
  created_at: string | null
  updated_at: string | null
  created_by: string | null
  item_count?: number
  isAdded?: boolean
  collaborators?: Array<{
    user_id: string
    permission: string
    user: {
      email: string
      first_name?: string
      last_name?: string
    }
  }>
}

export function AssetListManager({ isOpen, onClose, onListSelect, selectedAssetId }: AssetListManagerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Reset to list view when opening modal
  useEffect(() => {
    if (isOpen) {
      setShowCreateForm(false)
    }
  }, [isOpen])
  const [newListName, setNewListName] = useState('')
  const [newListDescription, setNewListDescription] = useState('')
  const [newListColor, setNewListColor] = useState('#3b82f6')
  const [showListMenu, setShowListMenu] = useState<string | null>(null)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [addedToLists, setAddedToLists] = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    listId: string | null
    listName: string
  }>({
    isOpen: false,
    listId: null,
    listName: ''
  })
  const menuRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const colorOptions = [
    { value: '#3b82f6', label: 'Blue' },
    { value: '#10b981', label: 'Green' },
    { value: '#f59e0b', label: 'Orange' },
    { value: '#ef4444', label: 'Red' },
    { value: '#8b5cf6', label: 'Purple' },
    { value: '#06b6d4', label: 'Cyan' },
    { value: '#84cc16', label: 'Lime' },
    { value: '#f97316', label: 'Amber' }
  ]

  // Fetch user's asset lists
  const { data: assetLists, isLoading } = useQuery({
    queryKey: ['asset-lists'],
    queryFn: async () => {
      if (!user?.id) return []

      let query = supabase
        .from('asset_lists')
        .select(`
          *,
          asset_list_items(id),
          asset_list_collaborations(
            user_id,
            permission,
            collaborator_user:users!asset_list_collaborations_user_id_fkey(email, first_name, last_name)
          )
        `)
        .eq('created_by', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
      
      const { data, error } = await query
      
      if (error) throw error
      
      const listsWithCounts = (data || []).map(list => ({
        ...list,
        item_count: list.asset_list_items?.length || 0,
        collaborators: (list.asset_list_collaborations || []).map(collab => ({
          ...collab,
          user: collab.collaborator_user
        }))
      })) as AssetList[]
      
      // If we have a selected asset, check which lists already contain it
      if (selectedAssetId) {
        const { data: existingItems } = await supabase
          .from('asset_list_items')
          .select('list_id')
          .eq('asset_id', selectedAssetId)
        
        const existingListIds = new Set(existingItems?.map(item => item.list_id) || [])
        
        return listsWithCounts.map(list => ({
          ...list,
          isAdded: existingListIds.has(list.id)
        }))
      }
      
      return listsWithCounts
    },
    enabled: isOpen
  })

  // Create list mutation
  const createListMutation = useMutation({
    mutationFn: async ({ name, description, color }: { name: string; description: string; color: string }) => {
      const { error } = await supabase
        .from('asset_lists')
        .insert([{
          name,
          description,
          color,
          created_by: user?.id
        }])
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setShowCreateForm(false)
      setNewListName('')
      setNewListDescription('')
      setNewListColor('#3b82f6')
    }
  })

  // Update list mutation
  const updateListMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase
        .from('asset_lists')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setEditingListId(null)
    }
  })

  // Delete list mutation
  const deleteListMutation = useMutation({
    mutationFn: async (listId: string) => {
      const { error } = await supabase
        .from('asset_lists')
        .delete()
        .eq('id', listId)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setDeleteConfirm({ isOpen: false, listId: null, listName: '' })
    }
  })

  // Add asset to list mutation
  const addToListMutation = useMutation({
    mutationFn: async ({ listId, assetId }: { listId: string; assetId: string }) => {
      console.log('🚀 Adding asset to list:', { listId, assetId })
      
      const { data, error } = await supabase
        .from('asset_list_items')
        .insert([{
          list_id: listId,
          asset_id: assetId,
          added_by: user?.id
        }])
        .select()
      
      if (error) {
        console.error('❌ Failed to add asset to list:', error)
        throw error
      }
      
      console.log('✅ Asset added to list successfully:', data)
      return data
    },
    onSuccess: (_, { listId }) => {
      console.log('🎉 Add to list mutation succeeded for listId:', listId)
      // Add to local state for immediate feedback
      setAddedToLists(prev => new Set([...prev, listId]))
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-items'] })
      
      // Show success feedback
      setTimeout(() => {
        setAddedToLists(prev => {
          const newSet = new Set(prev)
          newSet.delete(listId)
          return newSet
        })
      }, 2000) // Remove feedback after 2 seconds
    },
    onError: (error, { listId }) => {
      console.error('💥 Add to list mutation failed:', error)
    }
  })

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowListMenu(null)
      }
    }

    if (showListMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showListMenu])

  const handleCreateList = () => {
    if (!newListName.trim()) return
    
    createListMutation.mutate({
      name: newListName.trim(),
      description: newListDescription.trim(),
      color: newListColor
    })
  }

  const handleDeleteList = (listId: string, listName: string) => {
    setDeleteConfirm({
      isOpen: true,
      listId,
      listName
    })
  }

  const confirmDeleteList = () => {
    if (deleteConfirm.listId) {
      deleteListMutation.mutate(deleteConfirm.listId)
    }
  }

  const handleAddToList = (listId: string) => {
    console.log('🖱️ handleAddToList called:', { listId, selectedAssetId })
    
    // Find the list to check if asset is already added
    const targetList = assetLists?.find(list => list.id === listId)
    if (targetList?.isAdded || addedToLists.has(listId)) {
      console.log('⚠️ Asset already in list, skipping mutation')
      return
    }
    
    if (selectedAssetId) {
      console.log('✅ Triggering addToListMutation...')
      addToListMutation.mutate({ listId, assetId: selectedAssetId })
    } else {
      console.warn('⚠️ No selectedAssetId provided')
    }
  }

  const filteredLists = assetLists?.filter(list =>
    !searchQuery ||
    list.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (list.description && list.description.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  const getUserDisplayName = (collaborator: any) => {
    const user = collaborator.user
    if (!user) return 'Unknown User'
    
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    
    return user.email?.split('@')[0] || 'Unknown User'
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
              <h3 className="text-lg font-semibold text-gray-900">
                {selectedAssetId ? 'Add to List' : 'Asset Lists'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {selectedAssetId 
                  ? 'Choose a list to add this asset to'
                  : 'Manage your custom asset lists'
                }
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {/* Create List Form */}
            {showCreateForm ? (
              <div>
                <Card>
                  <h4 className="text-sm font-semibold text-gray-900 mb-4">Create New List</h4>
                  <div className="space-y-4">
                    <Input
                      label="List Name"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="Enter list name..."
                    />

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Description (optional)
                      </label>
                      <textarea
                        value={newListDescription}
                        onChange={(e) => setNewListDescription(e.target.value)}
                        placeholder="Describe the purpose of this list..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        rows={3}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Color
                      </label>
                      <div className="flex space-x-2">
                        {colorOptions.map((color) => (
                          <button
                            key={color.value}
                            onClick={() => setNewListColor(color.value)}
                            className={clsx(
                              'w-8 h-8 rounded-full border-2 transition-all',
                              newListColor === color.value
                                ? 'border-gray-900 scale-110'
                                : 'border-gray-300 hover:scale-105'
                            )}
                            style={{ backgroundColor: color.value }}
                            title={color.label}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex space-x-3">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowCreateForm(false)
                          setNewListName('')
                          setNewListDescription('')
                          setNewListColor('#3b82f6')
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleCreateList}
                        disabled={!newListName.trim() || createListMutation.isPending}
                        className="flex-1"
                      >
                        Create List
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            ) : (
              <>
                {/* Search and Create */}
                <div className="flex items-center space-x-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search lists..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <Button onClick={() => setShowCreateForm(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    New List
                  </Button>
                </div>

            {/* Lists Grid */}
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
            ) : filteredLists.length > 0 ? (
              <>
                {/* Available Lists Section */}
                {selectedAssetId && filteredLists.filter(list => !list.isAdded).length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-gray-700">Available Lists</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredLists.filter(list => !list.isAdded).map((list) => (
                        <div
                          key={list.id}
                          onClick={() => {
                            console.log('🖱️ CLICK DETECTED on list:', list.id, list.name)
                            if (selectedAssetId) {
                              console.log('🖱️ List card clicked for adding asset:', list.id)
                              handleAddToList(list.id)
                            } else if (onListSelect) {
                              console.log('🖱️ List card clicked for navigation:', list.id)
                              onListSelect({
                                id: list.id,
                                title: list.name,
                                type: 'list',
                                data: list
                              })
                            }
                          }}
                          className="cursor-pointer transition-all duration-200 relative group hover:shadow-lg hover:scale-105"
                        >
                          <Card>
                            <div className="space-y-4">
                              {/* Header with list name and color */}
                              <div className="flex items-start justify-between">
                                <div className="flex items-start space-x-3 flex-1 min-w-0">
                                  <div
                                    className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0 mt-1"
                                    style={{ backgroundColor: list.color || '#3b82f6' }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center space-x-2 mb-2">
                                      <h4 className="font-semibold text-gray-900 truncate text-base">
                                        {list.name}
                                      </h4>
                                      {list.is_default && (
                                        <Star className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                                      )}
                                    </div>
                                    {list.description && (
                                      <p className="text-sm text-gray-600 truncate" title={list.description}>
                                        {list.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Metadata section */}
                              <div className="pt-3 border-t border-gray-100">
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                  <div className="flex items-center space-x-3">
                                    <span className="font-medium">{list.item_count} {list.item_count === 1 ? 'asset' : 'assets'}</span>
                                    {list.collaborators && list.collaborators.length > 0 && (
                                      <div className="flex items-center space-x-1">
                                        <Users className="h-3 w-3" />
                                        <span>{list.collaborators.length}</span>
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-gray-400">
                                    {formatDistanceToNow(new Date(list.updated_at || list.created_at || ''), { addSuffix: true })}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {addedToLists.has(list.id) && (
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
                {selectedAssetId && filteredLists.filter(list => list.isAdded).length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-gray-700">Already in These Lists</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredLists.filter(list => list.isAdded).map((list) => (
                        <div
                          key={list.id}
                          className="relative group opacity-60"
                        >
                          <Card>
                            <div className="space-y-4">
                              {/* Header with list name and color */}
                              <div className="flex items-start justify-between">
                                <div className="flex items-start space-x-3 flex-1 min-w-0">
                                  <div
                                    className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0 mt-1"
                                    style={{ backgroundColor: list.color || '#3b82f6' }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center space-x-2 mb-2">
                                      <h4 className="font-semibold text-gray-900 truncate text-base">
                                        {list.name}
                                      </h4>
                                      {list.is_default && (
                                        <Star className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                                      )}
                                    </div>
                                    {list.description && (
                                      <p className="text-sm text-gray-600 truncate" title={list.description}>
                                        {list.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Metadata section */}
                              <div className="pt-3 border-t border-gray-100">
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                  <div className="flex items-center space-x-3">
                                    <span className="font-medium">{list.item_count} {list.item_count === 1 ? 'asset' : 'assets'}</span>
                                    {list.collaborators && list.collaborators.length > 0 && (
                                      <div className="flex items-center space-x-1">
                                        <Users className="h-3 w-3" />
                                        <span>{list.collaborators.length}</span>
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-gray-400">
                                    {formatDistanceToNow(new Date(list.updated_at || list.created_at || ''), { addSuffix: true })}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </Card>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* All Lists (when not adding asset) */}
                {!selectedAssetId && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredLists.map((list) => (
                  <div
                    key={list.id}
                    onClick={() => {
                      console.log('🖱️ CLICK DETECTED on list:', list.id, list.name)
                      if (selectedAssetId) {
                        console.log('🖱️ List card clicked for adding asset:', list.id)
                        handleAddToList(list.id)
                      } else if (onListSelect) {
                        console.log('🖱️ List card clicked for navigation:', list.id)
                        onListSelect({
                          id: list.id,
                          title: list.name,
                          type: 'list',
                          data: list
                        })
                      }
                    }}
                    className={clsx(
                      'cursor-pointer transition-all duration-200 relative group',
                      selectedAssetId 
                        ? 'hover:shadow-lg hover:scale-105' 
                        : 'hover:shadow-md'
                    )}
                  >
                    <Card>
                    <div className="space-y-4">
                      {/* Header with list name and color */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3 flex-1 min-w-0">
                          <div
                            className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0 mt-1"
                            style={{ backgroundColor: list.color || '#3b82f6' }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <h4 className="font-semibold text-gray-900 truncate text-base">
                                {list.name}
                              </h4>
                              {list.is_default && (
                                <Star className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                              )}
                            </div>
                            {list.description && (
                              <p className="text-sm text-gray-600 line-clamp-2">
                                {list.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {!selectedAssetId && (
                          <div className="relative" ref={menuRef}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setShowListMenu(showListMenu === list.id ? null : list.id)
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-all"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>

                            {showListMenu === list.id && (
                              <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 min-w-[140px]">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingListId(list.id)
                                    setShowListMenu(null)
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50 flex items-center"
                                >
                                  <Edit3 className="h-4 w-4 mr-2" />
                                  Edit List
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // Share functionality would go here
                                    setShowListMenu(null)
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50 flex items-center"
                                >
                                  <Share2 className="h-4 w-4 mr-2" />
                                  Share List
                                </button>
                                {!list.is_default && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteList(list.id, list.name)
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-error-600 hover:bg-error-50 flex items-center border-t border-gray-100"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete List
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Metadata section */}
                      <div className="pt-3 border-t border-gray-100">
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <div className="flex items-center space-x-3">
                            <span className="font-medium">{list.item_count} {list.item_count === 1 ? 'asset' : 'assets'}</span>
                            {list.collaborators && list.collaborators.length > 0 && (
                              <div className="flex items-center space-x-1">
                                <Users className="h-3 w-3" />
                                <span>{list.collaborators.length}</span>
                              </div>
                            )}
                          </div>
                          <span className="text-gray-400">
                            {formatDistanceToNow(new Date(list.updated_at || list.created_at || ''), { addSuffix: true })}
                          </span>
                        </div>
                      </div>

                    </div>
                    </Card>
                  </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <List className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {assetLists?.length === 0 ? 'No lists yet' : 'No lists match your search'}
                </h3>
                <p className="text-gray-500 mb-4">
                  {assetLists?.length === 0 
                    ? 'Your default lists will be created automatically.'
                    : 'Try adjusting your search criteria.'
                  }
                </p>
              </div>
            )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
            <Button variant="outline" onClick={onClose}>
              {selectedAssetId ? 'Cancel' : 'Close'}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, listId: null, listName: '' })}
        onConfirm={confirmDeleteList}
        title="Delete List"
        message={`Are you sure you want to delete "${deleteConfirm.listName}"? This will remove all assets from the list and cannot be undone.`}
        confirmText="Delete List"
        cancelText="Cancel"
        variant="danger"
        isLoading={deleteListMutation.isPending}
      />
    </div>
  )
}