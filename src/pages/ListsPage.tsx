import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { List, Search, Plus, Star, Users, ChevronDown, ChevronRight, X, Save, Palette, UserPlus, Trash2, Eye, EditIcon, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { EmptyState } from '../components/common/EmptyState'
import { AssetListManager } from '../components/lists/AssetListManager'
import { ListSurfaceCard } from '../components/lists/ListSurfaceCard'
import { ListSurfaceControls, type ListTypeFilter, type ViewMode, type ListGroupKey } from '../components/lists/ListSurfaceControls'
import { ListsTableView } from '../components/lists/ListsTableView'
import { useListSurfaces, type ListSortKey, type ListSurface } from '../hooks/lists/useListSurfaces'
import { useMarkListOpened } from '../hooks/lists/useMarkListOpened'

const VIEW_MODE_KEY = 'lists:viewMode'
const SORT_KEY = 'lists:sort'

function readViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'grid' || stored === 'list') return stored
  } catch { /* SSR / private mode */ }
  return 'grid'
}

function readSort(): ListSortKey {
  try {
    const stored = localStorage.getItem(SORT_KEY)
    if (['recent', 'alpha', 'assets', 'portfolio', 'owner', 'access'].includes(stored || '')) return stored as ListSortKey
  } catch { /* SSR / private mode */ }
  return 'recent'
}

import { clsx } from 'clsx'

interface ListsPageProps {
  onListSelect?: (list: any) => void
}

export function ListsPage({ onListSelect }: ListsPageProps) {
  // ── Control state ──────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<ListTypeFilter>('all')
  const [portfolioFilterIds, setPortfolioFilterIds] = useState<string[]>([])
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sortBy, setSortBy] = useState<ListSortKey>(readSort)
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode)
  const [groupBy, setGroupBy] = useState<ListGroupKey>('none')

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    try { localStorage.setItem(VIEW_MODE_KEY, mode) } catch { /* ignore */ }
  }, [])

  const handleSortChange = useCallback((key: ListSortKey) => {
    setSortBy(key)
    try { localStorage.setItem(SORT_KEY, key) } catch { /* ignore */ }
  }, [])

  // ── Modal state (unchanged) ────────────────────────────────────────────
  const [showListManager, setShowListManager] = useState(false)
  const [editingList, setEditingList] = useState<any>(null)
  const [editForm, setEditForm] = useState({ name: '', description: '', color: '#3b82f6' })
  const [activeTab, setActiveTab] = useState<'details' | 'collaborators'>('details')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePermission, setInvitePermission] = useState<'read' | 'write'>('read')
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [searchResults, setSearchResults] = useState<any[]>([])

  // ── Collapsed / expanded sections ──────────────────────────────────────
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const toggleExpand = useCallback((key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const { user } = useAuth()
  const queryClient = useQueryClient()

  // ── Data hook ──────────────────────────────────────────────────────────
  const {
    myLists,
    collaborative,
    sharedWithMe,
    allLists,
    isLoading,
    error: listsError,
    metrics,
    favoriteSet,
    portfolios,
    lastOpenedMap,
    updateCountMap,
    selfUpdateCountMap,
    lastActivityMap,
    sortLists: sortFn
  } = useListSurfaces(sortBy)

  const markListOpened = useMarkListOpened()

  // ── Client-side filtering ──────────────────────────────────────────────
  const applyFilters = (lists: ListSurface[]) => {
    return lists.filter(list => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchesSearch = list.name.toLowerCase().includes(q) ||
          (list.description && list.description.toLowerCase().includes(q))
        if (!matchesSearch) return false
      }
      if (favoritesOnly && !favoriteSet.has(list.id)) return false
      if (portfolioFilterIds.length > 0 && !portfolioFilterIds.includes(list.portfolio_id || '')) return false
      return true
    })
  }

  const filteredMy = useMemo(() => applyFilters(myLists), [myLists, searchQuery, favoritesOnly, favoriteSet, portfolioFilterIds])
  const filteredCollab = useMemo(() => applyFilters(collaborative), [collaborative, searchQuery, favoritesOnly, favoriteSet, portfolioFilterIds])
  const filteredShared = useMemo(() => applyFilters(sharedWithMe), [sharedWithMe, searchQuery, favoritesOnly, favoriteSet, portfolioFilterIds])

  // When typeFilter !== 'all', merge all into one flat list
  const flatFiltered = useMemo(() => {
    if (typeFilter === 'all') return null
    let source: ListSurface[]
    switch (typeFilter) {
      case 'mine': source = myLists; break
      case 'collaborative': source = collaborative; break
      case 'shared': source = sharedWithMe; break
      default: source = allLists
    }
    return sortFn(applyFilters(source))
  }, [typeFilter, myLists, collaborative, sharedWithMe, allLists, searchQuery, favoritesOnly, favoriteSet, portfolioFilterIds, sortFn])

  // Unified filtered list for table view (sorting handled by the table internally)
  const tableFiltered = useMemo(() => {
    let source: ListSurface[]
    switch (typeFilter) {
      case 'mine': source = myLists; break
      case 'collaborative': source = collaborative; break
      case 'shared': source = sharedWithMe; break
      default: source = allLists
    }
    return applyFilters(source)
  }, [typeFilter, myLists, collaborative, sharedWithMe, allLists, searchQuery, favoritesOnly, favoriteSet, portfolioFilterIds])

  // ── Mutations (unchanged from original) ────────────────────────────────
  const updateListMutation = useMutation({
    mutationFn: async ({ listId, updates }: { listId: string; updates: any }) => {
      const { error } = await supabase
        .from('asset_lists')
        .update(updates)
        .eq('id', listId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-surfaces'] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setEditingList(null)
      setEditForm({ name: '', description: '', color: '#3b82f6' })
    }
  })

  const addCollaboratorMutation = useMutation({
    mutationFn: async ({ email, permission }: { email: string; permission: 'read' | 'write' }) => {
      if (!editingList) throw new Error('No list selected')
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single()
      if (userError || !userData) throw new Error('User not found with that email address')
      const { data: existingCollab } = await supabase
        .from('asset_list_collaborations')
        .select('id')
        .eq('list_id', editingList.id)
        .eq('user_id', userData.id)
        .single()
      if (existingCollab) throw new Error('User is already a collaborator on this list')
      const { error } = await supabase
        .from('asset_list_collaborations')
        .insert({ list_id: editingList.id, user_id: userData.id, permission, created_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-surfaces'] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', editingList?.id] })
      setInviteEmail('')
      setInvitePermission('read')
      setUserSearchQuery('')
      setShowUserDropdown(false)
      setSearchResults([])
    }
  })

  const updateCollaboratorMutation = useMutation({
    mutationFn: async ({ collaborationId, permission }: { collaborationId: string; permission: 'read' | 'write' }) => {
      const { data, error } = await supabase
        .from('asset_list_collaborations')
        .update({ permission, updated_at: new Date().toISOString() })
        .eq('id', collaborationId)
        .select()
      if (error) throw error
      return data
    },
    onMutate: async ({ collaborationId, permission }) => {
      await queryClient.cancelQueries({ queryKey: ['list-surfaces'] })
      const previousLists = queryClient.getQueryData(['list-surfaces'])
      queryClient.setQueryData(['list-surfaces'], (old: any) => {
        if (!old) return old
        return old.map((list: any) => {
          if (list.id === editingList?.id) {
            return {
              ...list,
              collaborators: list.collaborators?.map((collab: any) =>
                collab.id === collaborationId ? { ...collab, permission } : collab
              )
            }
          }
          return list
        })
      })
      return { previousLists }
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(['list-surfaces'], context?.previousLists)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['list-surfaces'] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
    }
  })

  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase.from('asset_list_collaborations').delete().eq('id', collaborationId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-surfaces'] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', editingList?.id] })
    }
  })

  // ── Favorite toggle ────────────────────────────────────────────────────
  const toggleFavoriteMutation = useMutation({
    mutationFn: async (listId: string) => {
      if (!user?.id) throw new Error('Not authenticated')
      const isFav = favoriteSet.has(listId)
      if (isFav) {
        const { error } = await supabase
          .from('asset_list_favorites')
          .delete()
          .eq('list_id', listId)
          .eq('user_id', user.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('asset_list_favorites')
          .insert({ list_id: listId, user_id: user.id })
        if (error) throw error
      }
      return { listId, wasFav: isFav }
    },
    onMutate: async (listId: string) => {
      await queryClient.cancelQueries({ queryKey: ['user-favorite-lists', user?.id] })
      const prev = queryClient.getQueryData<string[]>(['user-favorite-lists', user?.id])
      queryClient.setQueryData<string[]>(['user-favorite-lists', user?.id], (old) => {
        if (!old) return [listId]
        return old.includes(listId) ? old.filter(id => id !== listId) : [...old, listId]
      })
      return { prev }
    },
    onError: (_err, _listId, context) => {
      queryClient.setQueryData(['user-favorite-lists', user?.id], context?.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user-favorite-lists', user?.id] })
    }
  })

  const handleToggleFavorite = useCallback((listId: string) => {
    toggleFavoriteMutation.mutate(listId)
  }, [toggleFavoriteMutation])

  // ── User search (unchanged) ────────────────────────────────────────────
  const searchUsers = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([])
      setShowUserDropdown(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`)
        .neq('id', user?.id)
        .limit(10)
      if (error) return
      const existingCollaboratorIds = editingList?.collaborators?.map((c: any) => c.user_id) || []
      const filteredResults = (data || []).filter((u: any) => !existingCollaboratorIds.includes(u.id))
      setSearchResults(filteredResults)
      setShowUserDropdown(filteredResults.length > 0)
    } catch { /* ignore */ }
  }

  const handleUserSearchChange = (value: string) => {
    setUserSearchQuery(value)
    setInviteEmail(value)
    searchUsers(value)
  }

  const handleUserSelect = (selectedUser: any) => {
    const displayName = selectedUser.first_name && selectedUser.last_name
      ? `${selectedUser.first_name} ${selectedUser.last_name}`
      : selectedUser.email
    setUserSearchQuery(displayName)
    setInviteEmail(selectedUser.email)
    setShowUserDropdown(false)
    setSearchResults([])
  }

  // ── Color palette ──────────────────────────────────────────────────────
  const colorPalette = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
    '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#64748b'
  ]

  // ── Edit handlers ──────────────────────────────────────────────────────
  const handleEditList = (list: any, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingList(list)
    setEditForm({ name: list.name, description: list.description || '', color: list.color || '#3b82f6' })
    setActiveTab('details')
    setInviteEmail('')
    setInvitePermission('read')
    setUserSearchQuery('')
    setShowUserDropdown(false)
    setSearchResults([])
  }

  const handleSaveList = () => {
    if (!editingList || !editForm.name.trim()) return
    updateListMutation.mutate({
      listId: editingList.id,
      updates: { name: editForm.name.trim(), description: editForm.description.trim() || null, color: editForm.color, updated_at: new Date().toISOString() }
    })
  }

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

  const handleInviteCollaborator = () => {
    if (!inviteEmail.trim()) return
    addCollaboratorMutation.mutate({ email: inviteEmail.trim(), permission: invitePermission })
  }

  const handleListClick = (list: ListSurface) => {
    markListOpened.mutate(list.id)
    if (onListSelect) {
      onListSelect({ id: list.id, title: list.name, type: 'list', data: list })
    }
  }

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const isListOwner = editingList && user && editingList.created_by === user.id

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-4 space-y-3">
      {/* Controls bar */}
      <div className="max-w-7xl mx-auto">
      <ListSurfaceControls
        search={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        portfolioFilterIds={portfolioFilterIds}
        onPortfolioFilterChange={setPortfolioFilterIds}
        portfolios={portfolios}
        favoritesOnly={favoritesOnly}
        onFavoritesOnlyChange={setFavoritesOnly}
        sortBy={sortBy}
        onSortByChange={handleSortChange}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onNewList={() => setShowListManager(true)}
      />
      </div>

      {/* Error state */}
      {listsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
          <List className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Failed to load lists</h3>
          <p className="text-xs text-gray-500 mb-3">
            {(listsError as Error).message || 'Unable to fetch your lists.'}
          </p>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Refresh</Button>
        </div>
      )}

      {/* Loading state */}
      {!listsError && isLoading && (
        <div className="p-4">
          <ListSkeleton count={6} />
        </div>
      )}

      {/* Main content */}
      {!listsError && !isLoading && (
        <>
          {viewMode === 'list' ? (
            // ── Table view (unified, no sections) ────────────────────
            tableFiltered.length > 0 ? (
              <ListsTableView
                lists={tableFiltered}
                metrics={metrics}
                favoriteSet={favoriteSet}
                userId={user?.id}
                sortBy={sortBy}
                onSortByChange={handleSortChange}
                onListClick={handleListClick}
                onEditList={handleEditList}
                onToggleFavorite={handleToggleFavorite}
                groupBy={groupBy}
                lastOpenedMap={lastOpenedMap}
                updateCountMap={updateCountMap}
                selfUpdateCountMap={selfUpdateCountMap}
                lastActivityMap={lastActivityMap}
              />
            ) : (
              searchQuery || favoritesOnly || portfolioFilterIds.length > 0 || typeFilter !== 'all' ? (
                <EmptyState
                  icon={Search}
                  title="No lists found"
                  description="Try clearing filters or create a new list."
                  action={user ? { label: 'New List', icon: Plus, onClick: () => setShowListManager(true) } : undefined}
                  compact
                />
              ) : allLists.length === 0 ? (
                <EmptyState
                  icon={List}
                  title="No lists yet"
                  description={user ? "Create your first list to organize and curate your assets." : "Sign in to access your asset lists."}
                  action={user ? { label: 'Create First List', icon: Plus, onClick: () => setShowListManager(true) } : undefined}
                />
              ) : null
            )
          ) : typeFilter === 'all' ? (
            // ── Grid: Sectioned view ─────────────────────────────────
            <div className="space-y-6">
              <SurfaceSection
                sectionKey="my"
                title="My Lists"
                description="Lists you created and manage."
                lists={filteredMy}
                metrics={metrics}
                favoriteSet={favoriteSet}
                userId={user?.id}
                sortBy={sortBy}
                collapsed={collapsedSections['my']}
                onToggle={() => toggleSection('my')}
                expanded={expandedSections['my'] ?? false}
                onToggleExpand={() => toggleExpand('my')}
                onListClick={handleListClick}
                onEditList={handleEditList}
                emptyMessage="You haven't created any lists yet."
                emptyAction={user ? { label: 'Create First List', onClick: () => setShowListManager(true) } : undefined}
              />
              <SurfaceSection
                sectionKey="collab"
                title="Collaborative"
                description="Shared workspaces where members can manage their own assets in the same view."
                lists={filteredCollab}
                metrics={metrics}
                favoriteSet={favoriteSet}
                userId={user?.id}
                sortBy={sortBy}
                collapsed={collapsedSections['collab']}
                onToggle={() => toggleSection('collab')}
                expanded={expandedSections['collab'] ?? false}
                onToggleExpand={() => toggleExpand('collab')}
                onListClick={handleListClick}
                onEditList={handleEditList}
                emptyMessage="No collaborative lists available."
              />
              <SurfaceSection
                sectionKey="shared"
                title="Shared With Me"
                description="Lists others shared with you (read-only or editable based on permissions)."
                lists={filteredShared}
                metrics={metrics}
                favoriteSet={favoriteSet}
                userId={user?.id}
                sortBy={sortBy}
                collapsed={collapsedSections['shared']}
                onToggle={() => toggleSection('shared')}
                expanded={expandedSections['shared'] ?? false}
                onToggleExpand={() => toggleExpand('shared')}
                onListClick={handleListClick}
                onEditList={handleEditList}
                emptyMessage="No one has shared lists with you yet."
              />
              {filteredMy.length === 0 && filteredCollab.length === 0 && filteredShared.length === 0 && (
                searchQuery || favoritesOnly || portfolioFilterIds.length > 0 ? (
                  <EmptyState
                    icon={Search}
                    title="No lists match your filters"
                    description="Try adjusting your search or filter criteria."
                    compact
                  />
                ) : allLists.length === 0 ? (
                  <EmptyState
                    icon={List}
                    title="No lists yet"
                    description={user ? "Create your first list to organize your assets and investment ideas." : "Sign in to access your asset lists."}
                    action={user ? { label: 'Create First List', icon: Plus, onClick: () => setShowListManager(true) } : undefined}
                  />
                ) : null
              )}
            </div>
          ) : (
            // ── Grid: Flat filtered view ─────────────────────────────
            flatFiltered && flatFiltered.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {flatFiltered.map(list => (
                  <ListSurfaceCard
                    key={list.id}
                    list={list}
                    metrics={metrics.get(list.id)}
                    isFavorite={favoriteSet.has(list.id)}
                    isOwner={list.created_by === user?.id}

                    onClick={() => handleListClick(list)}
                    onEdit={(e) => handleEditList(list, e)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Search}
                title="No lists match your filters"
                description="Try adjusting your search or filter criteria."
                compact
              />
            )
          )}
        </>
      )}

      {/* ── Edit List Modal (unchanged) ─────────────────────────────────── */}
      {editingList && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Edit List</h2>
              <button onClick={handleCancelEdit} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab('details')}
                className={`px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'details' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Palette className="h-4 w-4 inline mr-2" />
                Details
              </button>
              <button
                onClick={() => setActiveTab('collaborators')}
                className={`px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'collaborators' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-700'
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

            <div className="flex-1 overflow-y-auto">
              {activeTab === 'details' ? (
                <div className="p-6 space-y-4">
                  <div>
                    <label htmlFor="list-name" className="block text-sm font-medium text-gray-700 mb-2">List Name</label>
                    <input
                      id="list-name"
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Enter list name"
                    />
                  </div>
                  <div>
                    <label htmlFor="list-description" className="block text-sm font-medium text-gray-700 mb-2">Description (optional)</label>
                    <textarea
                      id="list-description"
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Enter list description"
                    />
                  </div>
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
                            editForm.color === color ? 'border-gray-900 scale-110' : 'border-gray-300 hover:border-gray-400'
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
                  {/* Owner */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                      <Shield className="h-4 w-4 mr-2" />
                      Owner
                    </h3>
                    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <div className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-medium">
                          {(() => {
                            if (user?.first_name && user?.last_name) return `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase()
                            if (user?.user_metadata?.first_name && user?.user_metadata?.last_name) return `${user.user_metadata.first_name.charAt(0)}${user.user_metadata.last_name.charAt(0)}`.toUpperCase()
                            if (user?.raw_user_meta_data?.first_name && user?.raw_user_meta_data?.last_name) return `${user.raw_user_meta_data.first_name.charAt(0)}${user.raw_user_meta_data.last_name.charAt(0)}`.toUpperCase()
                            return user?.email?.charAt(0).toUpperCase()
                          })()}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {(() => {
                            if (user?.first_name && user?.last_name) return `${user.first_name} ${user.last_name}`
                            if (user?.user_metadata?.first_name && user?.user_metadata?.last_name) return `${user.user_metadata.first_name} ${user.user_metadata.last_name}`
                            if (user?.raw_user_meta_data?.first_name && user?.raw_user_meta_data?.last_name) return `${user.raw_user_meta_data.first_name} ${user.raw_user_meta_data.last_name}`
                            return user?.email || 'Unknown User'
                          })()}
                        </p>
                        <p className="text-xs text-gray-500">Full access</p>
                      </div>
                    </div>
                  </div>

                  {/* Invite */}
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
                              onFocus={() => { if (searchResults.length > 0) setShowUserDropdown(true) }}
                              onBlur={() => setTimeout(() => setShowUserDropdown(false), 150)}
                              placeholder="Search by name or email..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                            {showUserDropdown && searchResults.length > 0 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                {searchResults.map((u) => (
                                  <button
                                    key={u.id}
                                    onClick={() => handleUserSelect(u)}
                                    className="w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
                                  >
                                    <div className="flex items-center space-x-3">
                                      <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center">
                                        <span className="text-white text-sm font-medium">
                                          {u.first_name && u.last_name
                                            ? `${u.first_name.charAt(0)}${u.last_name.charAt(0)}`.toUpperCase()
                                            : u.email.charAt(0).toUpperCase()
                                          }
                                        </span>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">
                                          {u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email}
                                        </p>
                                        {u.first_name && u.last_name && (
                                          <p className="text-xs text-gray-500 truncate">{u.email}</p>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                            {showUserDropdown && searchResults.length === 0 && userSearchQuery.length >= 2 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
                                <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                  No users found matching &quot;{userSearchQuery}&quot;
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
                          <Button onClick={handleInviteCollaborator} disabled={!inviteEmail.trim() || addCollaboratorMutation.isPending} size="sm">
                            {addCollaboratorMutation.isPending ? 'Inviting...' : 'Invite'}
                          </Button>
                        </div>
                        {addCollaboratorMutation.error && (
                          <p className="text-sm text-red-600">{addCollaboratorMutation.error.message}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Collaborators list */}
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
                                    const u = collab.user || collab.collaborator_user
                                    return u?.first_name && u?.last_name ? `${u.first_name} ${u.last_name}` : u?.email || 'Unknown User'
                                  })()}
                                </p>
                                {(() => {
                                  const u = collab.user || collab.collaborator_user
                                  return u?.first_name && u?.last_name && <p className="text-xs text-gray-500">{u?.email}</p>
                                })()}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {isListOwner ? (
                                <select
                                  value={collab.permission}
                                  onChange={(e) => updateCollaboratorMutation.mutate({ collaborationId: collab.id, permission: e.target.value as 'read' | 'write' })}
                                  className="text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                                  disabled={updateCollaboratorMutation.isPending}
                                >
                                  <option value="read">Read</option>
                                  <option value="write">Write</option>
                                </select>
                              ) : (
                                <Badge variant={collab.permission === 'write' ? 'primary' : 'default'} size="sm">
                                  {collab.permission === 'write' ? <EditIcon className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
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

                  {(!editingList.collaborators || editingList.collaborators.length === 0) && (
                    <div className="text-center py-8">
                      <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <h3 className="text-sm font-medium text-gray-900 mb-1">No collaborators yet</h3>
                      <p className="text-sm text-gray-500">
                        {isListOwner ? 'Invite people to collaborate on this list' : 'Only you have access to this list'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
              <Button variant="outline" onClick={handleCancelEdit} disabled={updateListMutation.isPending}>Cancel</Button>
              {activeTab === 'details' && (
                <Button onClick={handleSaveList} disabled={!editForm.name.trim() || updateListMutation.isPending}>
                  {updateListMutation.isPending ? 'Saving...' : (<><Save className="h-4 w-4 mr-2" />Save Changes</>)}
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

// ── SurfaceSection ─────────────────────────────────────────────────────

const DEFAULT_VISIBLE_COUNT = 6

interface SurfaceSectionProps {
  sectionKey: string
  title: string
  description: string
  lists: ListSurface[]
  metrics: Map<string, import('../hooks/lists/useListSurfaces').ListSurfaceMetrics>
  favoriteSet: Set<string>
  userId: string | undefined
  sortBy: ListSortKey
  collapsed: boolean | undefined
  onToggle: () => void
  expanded: boolean
  onToggleExpand: () => void
  onListClick: (list: ListSurface) => void
  onEditList: (list: any, e: React.MouseEvent) => void
  emptyMessage: string
  emptyAction?: { label: string; onClick: () => void }
}

function SurfaceSection({
  title,
  description,
  lists,
  metrics,
  favoriteSet,
  userId,
  sortBy,
  collapsed,
  onToggle,
  expanded,
  onToggleExpand,
  onListClick,
  onEditList,
  emptyMessage,
  emptyAction
}: SurfaceSectionProps) {
  const isCollapsed = collapsed ?? false
  const hasOverflow = lists.length > DEFAULT_VISIBLE_COUNT
  const visibleLists = expanded || !hasOverflow ? lists : lists.slice(0, DEFAULT_VISIBLE_COUNT)
  const hiddenCount = lists.length - DEFAULT_VISIBLE_COUNT

  return (
    <div>
      {/* Section header */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 mb-3 group"
      >
        {isCollapsed
          ? <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
          : <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
        }
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h2>
        <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
          {lists.length}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 font-normal">
          {description}
        </span>
      </button>

      {/* Section body */}
      {!isCollapsed && (
        lists.length > 0 ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleLists.map(list => (
                <ListSurfaceCard
                  key={list.id}
                  list={list}
                  metrics={metrics.get(list.id)}
                  isFavorite={favoriteSet.has(list.id)}
                  isOwner={list.created_by === userId}
                  onClick={() => onListClick(list)}
                  onEdit={(e) => onEditList(list, e)}
                />
              ))}
            </div>
            {hasOverflow && (
              <div className="flex justify-end">
                <button
                  onClick={onToggleExpand}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium transition-colors"
                >
                  {expanded ? 'View less' : `View more (${hiddenCount})`}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 py-6 text-center">
            <p className="text-xs text-gray-400">{emptyMessage}</p>
            {emptyAction && (
              <button
                onClick={emptyAction.onClick}
                className="mt-2 text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                {emptyAction.label}
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}
