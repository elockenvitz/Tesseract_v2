import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { List, Search, Plus, Star, Users, Calendar, Share2, Edit3, X, Save, Palette, UserPlus, Trash2, Eye, EditIcon, Shield, Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { AssetListManager } from '../components/lists/AssetListManager'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface ListsPageProps {
  onListSelect?: (list: any) => void
}

export function ListsPage({ onListSelect }: ListsPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showListManager, setShowListManager] = useState(false)
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false)
  const [editingList, setEditingList] = useState<any>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    color: '#3b82f6'
  })
  const [activeTab, setActiveTab] = useState<'details' | 'collaborators'>('details')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePermission, setInvitePermission] = useState<'read' | 'write'>('read')
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [searchResults, setSearchResults] = useState<any[]>([])
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all user's lists
  const { data: assetLists, isLoading, error: listsError } = useQuery({
    queryKey: ['asset-lists'],
    queryFn: async () => {
      if (!user?.id) {
        return []
      }

      // Get lists the user owns with asset counts
      const { data, error } = await supabase
        .from('asset_lists')
        .select(`
          *,
          asset_list_items(id),
          asset_list_collaborations(
            id,
            user_id,
            permission,
            collaborator_user:users!asset_list_collaborations_user_id_fkey(email, first_name, last_name)
          )
        `)
        .eq('created_by', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to fetch asset lists:', error)
        throw error
      }

      return (data || []).map(list => ({
        ...list,
        item_count: list.asset_list_items?.length || 0,
        collaborators: (list.asset_list_collaborations || []).map(collab => ({
          ...collab,
          user: collab.collaborator_user
        }))
      }))
    },
    enabled: !!user, // Only run when user is authenticated
    retry: false // Don't retry on auth failures
  })

  // Fetch user's favorite lists
  const { data: favoriteLists } = useQuery({
    queryKey: ['user-favorite-lists', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('asset_list_favorites')
        .select('list_id')
        .eq('user_id', user.id)

      if (error) throw error
      return (data || []).map(f => f.list_id)
    },
    enabled: !!user
  })

  // Update list mutation
  const updateListMutation = useMutation({
    mutationFn: async ({ listId, updates }: { listId: string; updates: any }) => {
      const { error } = await supabase
        .from('asset_lists')
        .update(updates)
        .eq('id', listId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setEditingList(null)
      setEditForm({ name: '', description: '', color: '#3b82f6' })
    }
  })

  // Add collaborator mutation
  const addCollaboratorMutation = useMutation({
    mutationFn: async ({ email, permission }: { email: string; permission: 'read' | 'write' }) => {
      if (!editingList) throw new Error('No list selected')

      // First, try to find the user by email
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single()

      if (userError || !userData) {
        throw new Error('User not found with that email address')
      }

      // Check if collaboration already exists
      const { data: existingCollab } = await supabase
        .from('asset_list_collaborations')
        .select('id')
        .eq('list_id', editingList.id)
        .eq('user_id', userData.id)
        .single()

      if (existingCollab) {
        throw new Error('User is already a collaborator on this list')
      }

      // Add the collaboration
      const { error } = await supabase
        .from('asset_list_collaborations')
        .insert({
          list_id: editingList.id,
          user_id: userData.id,
          permission,
          created_at: new Date().toISOString()
        })

      if (error) {
        console.error('Collaboration insert error:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', editingList?.id] })
      setInviteEmail('')
      setInvitePermission('read')
      setUserSearchQuery('')
      setShowUserDropdown(false)
      setSearchResults([])
    }
  })

  // Update collaborator permission mutation
  const updateCollaboratorMutation = useMutation({
    mutationFn: async ({ collaborationId, permission }: { collaborationId: string; permission: 'read' | 'write' }) => {
      console.log('Updating permission:', { collaborationId, permission })

      const { data, error } = await supabase
        .from('asset_list_collaborations')
        .update({ permission, updated_at: new Date().toISOString() })
        .eq('id', collaborationId)
        .select()

      if (error) {
        console.error('Permission update error:', error)
        throw error
      }

      console.log('Permission update result:', data)
      return data
    },
    onMutate: async ({ collaborationId, permission }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['asset-lists'] })

      // Snapshot the previous value
      const previousLists = queryClient.getQueryData(['asset-lists'])

      // Optimistically update the cache
      queryClient.setQueryData(['asset-lists'], (old: any) => {
        if (!old) return old

        return old.map((list: any) => {
          if (list.id === editingList?.id) {
            return {
              ...list,
              collaborators: list.collaborators?.map((collab: any) =>
                collab.id === collaborationId
                  ? { ...collab, permission }
                  : collab
              )
            }
          }
          return list
        })
      })

      // Return a context object with the snapshotted value
      return { previousLists }
    },
    onError: (error, variables, context) => {
      console.error('Permission update failed:', error)
      // If the mutation fails, use the context returned from onMutate to roll back
      queryClient.setQueryData(['asset-lists'], context?.previousLists)
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we have the latest data
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
    }
  })

  // Remove collaborator mutation
  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase
        .from('asset_list_collaborations')
        .delete()
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', editingList?.id] })
    }
  })

  // User search functionality
  const searchUsers = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([])
      setShowUserDropdown(false)
      return
    }

    try {
      // Search for users by first_name, last_name, or email
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`)
        .neq('id', user?.id) // Exclude current user
        .limit(10)

      if (error) {
        console.error('User search error:', error)
        return
      }

      // Filter out users who are already collaborators
      const existingCollaboratorIds = editingList?.collaborators?.map((c: any) => c.user_id) || []
      const filteredResults = (data || []).filter(u => !existingCollaboratorIds.includes(u.id))

      setSearchResults(filteredResults)
      setShowUserDropdown(filteredResults.length > 0)
    } catch (error) {
      console.error('Error searching users:', error)
    }
  }

  // Handle user search input change
  const handleUserSearchChange = (value: string) => {
    setUserSearchQuery(value)
    setInviteEmail(value)
    searchUsers(value)
  }

  // Handle user selection from dropdown
  const handleUserSelect = (selectedUser: any) => {
    const displayName = selectedUser.first_name && selectedUser.last_name
      ? `${selectedUser.first_name} ${selectedUser.last_name}`
      : selectedUser.email

    setUserSearchQuery(displayName)
    setInviteEmail(selectedUser.email)
    setShowUserDropdown(false)
    setSearchResults([])
  }

  // Color palette for lists
  const colorPalette = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // emerald
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#6366f1', // indigo
    '#14b8a6', // teal
    '#64748b'  // slate
  ]

  // Handle edit list
  const handleEditList = (list: any) => {
    setEditingList(list)
    setEditForm({
      name: list.name,
      description: list.description || '',
      color: list.color || '#3b82f6'
    })
    setActiveTab('details')
    setInviteEmail('')
    setInvitePermission('read')
    setUserSearchQuery('')
    setShowUserDropdown(false)
    setSearchResults([])
  }

  // Handle save list changes
  const handleSaveList = () => {
    if (!editingList || !editForm.name.trim()) return

    updateListMutation.mutate({
      listId: editingList.id,
      updates: {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        color: editForm.color,
        updated_at: new Date().toISOString()
      }
    })
  }

  // Handle cancel edit
  const handleCancelEdit = () => {
    setEditingList(null)
    setEditForm({ name: '', description: '', color: '#3b82f6' })
    setActiveTab('details')
    setInviteEmail('')
    setInvitePermission('read')
    setUserSearchQuery('')
    setShowUserDropdown(false)
    setSearchResults([])
  }

  // Handle invite collaborator
  const handleInviteCollaborator = () => {
    if (!inviteEmail.trim()) return
    addCollaboratorMutation.mutate({
      email: inviteEmail.trim(),
      permission: invitePermission
    })
  }

  // Check if current user is the owner of the list
  const isListOwner = editingList && user && editingList.created_by === user.id

  const filteredLists = assetLists?.filter(list => {
    // Search filter
    const matchesSearch = !searchQuery ||
      list.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (list.description && list.description.toLowerCase().includes(searchQuery.toLowerCase()))

    // Favorites filter
    const matchesFavorites = !showOnlyFavorites || favoriteLists?.includes(list.id)

    return matchesSearch && matchesFavorites
  }) || []

  const handleListClick = (list: any) => {
    if (onListSelect) {
      onListSelect({
        id: list.id,
        title: list.name,
        type: 'list',
        data: list
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asset Lists</h1>
          <p className="text-gray-600">
            Organize your assets into custom lists for better tracking
          </p>
        </div>
        {user && (
          <Button onClick={() => setShowListManager(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New List
          </Button>
        )}
      </div>

      {/* Search and Filters */}
      <Card>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search lists by name or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
              className={clsx(
                'flex items-center space-x-2 px-3 py-1 rounded-lg transition-colors',
                showOnlyFavorites
                  ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              <Star className={clsx(
                'h-4 w-4',
                showOnlyFavorites && 'fill-yellow-500'
              )} />
              <span className="text-sm font-medium">Favorites only</span>
            </button>
          </div>
        </div>
      </Card>

      {/* Error State */}
      {listsError && (
        <Card>
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <List className="h-8 w-8 text-red-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load lists</h3>
            <p className="text-gray-500 mb-4">
              {listsError.message || 'Unable to fetch your asset lists. Please check your connection and try again.'}
            </p>
            <div className="space-y-2">
              <Button onClick={() => window.location.reload()} variant="outline">
                Refresh Page
              </Button>
              {!user && (
                <p className="text-sm text-amber-600">
                  ⚠️ You may need to sign in to access your lists
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Lists Grid */}
      {!listsError && isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredLists.map((list) => (
            <div
              key={list.id}
              onClick={() => handleListClick(list)}
              className="cursor-pointer"
            >
              <Card className="hover:shadow-md transition-shadow duration-200 group">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div
                    className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                    style={{ backgroundColor: list.color || '#3b82f6' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {list.name}
                      </h3>
                      {favoriteLists?.includes(list.id) && (
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                      )}
                    </div>
                    {list.description && (
                      <p className="text-sm text-gray-600 line-clamp-2 mt-1">
                        {list.description}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEditList(list)
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded-md"
                  title="Edit list characteristics"
                >
                  <Edit3 className="h-4 w-4 text-gray-500 hover:text-gray-700" />
                </button>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center text-gray-600">
                      <List className="h-4 w-4 mr-1" />
                      <span>{list.item_count} assets</span>
                    </div>
                    {list.collaborators && list.collaborators.length > 0 && (
                      <div className="flex items-center text-gray-600">
                        <Users className="h-4 w-4 mr-1" />
                        <span>{list.collaborators.length}</span>
                      </div>
                    )}
                  </div>
                  {list.collaborators && list.collaborators.length > 0 && (
                    <Badge variant="primary" size="sm">
                      <Share2 className="h-3 w-3 mr-1" />
                      Shared
                    </Badge>
                  )}
                </div>
                
                <div className="flex items-center text-xs text-gray-500">
                  <Calendar className="h-3 w-3 mr-1" />
                  Updated {formatDistanceToNow(new Date(list.updated_at || list.created_at || ''), { addSuffix: true })}
                </div>
              </div>
              </Card>
            </div>
          ))}
        </div>
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
              ? user
                ? 'Create your first list to organize your assets and investment ideas.'
                : 'Sign in to access your asset lists and create new ones.'
              : 'Try adjusting your search criteria.'
            }
          </p>
          {assetLists?.length === 0 && user && (
            <Button onClick={() => setShowListManager(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First List
            </Button>
          )}
        </div>
      )}

      {/* Edit List Modal */}
      {editingList && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Edit List</h2>
              <button
                onClick={handleCancelEdit}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab('details')}
                className={`px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'details'
                    ? 'text-primary-600 border-b-2 border-primary-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Palette className="h-4 w-4 inline mr-2" />
                Details
              </button>
              <button
                onClick={() => setActiveTab('collaborators')}
                className={`px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'collaborators'
                    ? 'text-primary-600 border-b-2 border-primary-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Users className="h-4 w-4 inline mr-2" />
                Collaborators
                {editingList.collaborators && editingList.collaborators.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                    {editingList.collaborators.length}
                  </span>
                )}
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'details' ? (
                <div className="p-6 space-y-4">
                  {/* List Name */}
                  <div>
                    <label htmlFor="list-name" className="block text-sm font-medium text-gray-700 mb-2">
                      List Name
                    </label>
                    <input
                      id="list-name"
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Enter list name"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label htmlFor="list-description" className="block text-sm font-medium text-gray-700 mb-2">
                      Description (optional)
                    </label>
                    <textarea
                      id="list-description"
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Enter list description"
                    />
                  </div>

                  {/* Color */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Palette className="h-4 w-4 inline mr-1" />
                      Color
                    </label>
                    <div className="grid grid-cols-6 gap-2">
                      {colorPalette.map((color) => (
                        <button
                          key={color}
                          onClick={() => setEditForm({ ...editForm, color })}
                          className={`w-8 h-8 rounded-lg border-2 transition-all ${
                            editForm.color === color
                              ? 'border-gray-900 scale-110'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 space-y-6">
                  {/* List Owner */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                      <Shield className="h-4 w-4 mr-2" />
                      Owner
                    </h3>
                    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <div className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-medium">
                          {(() => {
                            if (user?.first_name && user?.last_name) {
                              return `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase()
                            }
                            if (user?.user_metadata?.first_name && user?.user_metadata?.last_name) {
                              return `${user.user_metadata.first_name.charAt(0)}${user.user_metadata.last_name.charAt(0)}`.toUpperCase()
                            }
                            if (user?.raw_user_meta_data?.first_name && user?.raw_user_meta_data?.last_name) {
                              return `${user.raw_user_meta_data.first_name.charAt(0)}${user.raw_user_meta_data.last_name.charAt(0)}`.toUpperCase()
                            }
                            return user?.email?.charAt(0).toUpperCase()
                          })()}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {(() => {
                            console.log('Current user object:', user)
                            // Check different possible field names
                            if (user?.first_name && user?.last_name) {
                              return `${user.first_name} ${user.last_name}`
                            }
                            if (user?.user_metadata?.first_name && user?.user_metadata?.last_name) {
                              return `${user.user_metadata.first_name} ${user.user_metadata.last_name}`
                            }
                            if (user?.raw_user_meta_data?.first_name && user?.raw_user_meta_data?.last_name) {
                              return `${user.raw_user_meta_data.first_name} ${user.raw_user_meta_data.last_name}`
                            }
                            return user?.email || 'Unknown User'
                          })()}
                        </p>
                        <p className="text-xs text-gray-500">Full access</p>
                        {(() => {
                          const hasName = (user?.first_name && user?.last_name) ||
                                         (user?.user_metadata?.first_name && user?.user_metadata?.last_name) ||
                                         (user?.raw_user_meta_data?.first_name && user?.raw_user_meta_data?.last_name)
                          return hasName && (
                            <p className="text-xs text-gray-400">{user?.email}</p>
                          )
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Invite Collaborator */}
                  {isListOwner && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Invite New Collaborator
                      </h3>
                      <div className="space-y-3 p-4 border border-gray-200 rounded-lg">
                        <div className="flex space-x-3">
                          <div className="flex-1 relative">
                            <input
                              type="text"
                              value={userSearchQuery}
                              onChange={(e) => handleUserSearchChange(e.target.value)}
                              onFocus={() => {
                                if (searchResults.length > 0) {
                                  setShowUserDropdown(true)
                                }
                              }}
                              onBlur={() => {
                                // Delay hiding dropdown to allow for clicks
                                setTimeout(() => setShowUserDropdown(false), 150)
                              }}
                              placeholder="Search by name or email..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />

                            {/* Search Results Dropdown */}
                            {showUserDropdown && searchResults.length > 0 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                {searchResults.map((user) => (
                                  <button
                                    key={user.id}
                                    onClick={() => handleUserSelect(user)}
                                    className="w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
                                  >
                                    <div className="flex items-center space-x-3">
                                      <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center">
                                        <span className="text-white text-sm font-medium">
                                          {user.first_name && user.last_name
                                            ? `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase()
                                            : user.email.charAt(0).toUpperCase()
                                          }
                                        </span>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">
                                          {user.first_name && user.last_name
                                            ? `${user.first_name} ${user.last_name}`
                                            : user.email
                                          }
                                        </p>
                                        {user.first_name && user.last_name && (
                                          <p className="text-xs text-gray-500 truncate">{user.email}</p>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* No Results Message */}
                            {showUserDropdown && searchResults.length === 0 && userSearchQuery.length >= 2 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
                                <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                  No users found matching "{userSearchQuery}"
                                </div>
                              </div>
                            )}
                          </div>
                          <select
                            value={invitePermission}
                            onChange={(e) => setInvitePermission(e.target.value as 'read' | 'write')}
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          >
                            <option value="read">Read</option>
                            <option value="write">Write</option>
                          </select>
                          <Button
                            onClick={handleInviteCollaborator}
                            disabled={!inviteEmail.trim() || addCollaboratorMutation.isPending}
                            size="sm"
                          >
                            {addCollaboratorMutation.isPending ? 'Inviting...' : 'Invite'}
                          </Button>
                        </div>
                        {addCollaboratorMutation.error && (
                          <p className="text-sm text-red-600">
                            {addCollaboratorMutation.error.message}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Current Collaborators */}
                  {editingList.collaborators && editingList.collaborators.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                        <Users className="h-4 w-4 mr-2" />
                        Collaborators ({editingList.collaborators.length})
                      </h3>
                      <div className="space-y-2">
                        {editingList.collaborators.map((collab: any) => (
                          <div key={collab.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center">
                                <span className="text-white text-sm font-medium">
                                  {collab.user?.first_name && collab.user?.last_name
                                    ? `${collab.user.first_name.charAt(0)}${collab.user.last_name.charAt(0)}`.toUpperCase()
                                    : collab.user?.email?.charAt(0).toUpperCase() || '?'
                                  }
                                </span>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {(() => {
                                    const user = collab.user || collab.collaborator_user
                                    if (user?.first_name && user?.last_name) {
                                      return `${user.first_name} ${user.last_name}`
                                    }
                                    return user?.email || 'Unknown User'
                                  })()}
                                </p>
                                {(() => {
                                  const user = collab.user || collab.collaborator_user
                                  return user?.first_name && user?.last_name && (
                                    <p className="text-xs text-gray-500">{user?.email}</p>
                                  )
                                })()}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {isListOwner ? (
                                <select
                                  value={collab.permission}
                                  onChange={(e) => {
                                    console.log('Permission dropdown changed:', {
                                      collaborationId: collab.id,
                                      oldPermission: collab.permission,
                                      newPermission: e.target.value
                                    })
                                    updateCollaboratorMutation.mutate({
                                      collaborationId: collab.id,
                                      permission: e.target.value as 'read' | 'write'
                                    })
                                  }}
                                  className="text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                                  disabled={updateCollaboratorMutation.isPending}
                                >
                                  <option value="read">Read</option>
                                  <option value="write">Write</option>
                                </select>
                              ) : (
                                <Badge variant={collab.permission === 'write' ? 'primary' : 'default'} size="sm">
                                  {collab.permission === 'write' ? (
                                    <EditIcon className="h-3 w-3 mr-1" />
                                  ) : (
                                    <Eye className="h-3 w-3 mr-1" />
                                  )}
                                  {collab.permission}
                                </Badge>
                              )}
                              {isListOwner && (
                                <button
                                  onClick={() => removeCollaboratorMutation.mutate(collab.id)}
                                  className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                  disabled={removeCollaboratorMutation.isPending}
                                  title="Remove collaborator"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* No Collaborators Message */}
                  {(!editingList.collaborators || editingList.collaborators.length === 0) && (
                    <div className="text-center py-8">
                      <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <h3 className="text-sm font-medium text-gray-900 mb-1">No collaborators yet</h3>
                      <p className="text-sm text-gray-500">
                        {isListOwner
                          ? 'Invite people to collaborate on this list'
                          : 'Only you have access to this list'
                        }
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={handleCancelEdit}
                disabled={updateListMutation.isPending}
              >
                Cancel
              </Button>
              {activeTab === 'details' && (
                <Button
                  onClick={handleSaveList}
                  disabled={!editForm.name.trim() || updateListMutation.isPending}
                >
                  {updateListMutation.isPending ? (
                    'Saving...'
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* List Manager Modal */}
      <AssetListManager
        isOpen={showListManager}
        onClose={() => setShowListManager(false)}
        onListSelect={onListSelect}
      />
    </div>
  )
}