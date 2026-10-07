import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { List, Search, Plus, Users, X, Save, Palette, UserPlus, Trash2, Eye, EditIcon, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrgMembers } from '../hooks/useOrgMembers'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { EmptyState } from '../components/common/EmptyState'
import { AssetListManager } from '../components/lists/AssetListManager'
import { ListSurfaceCard } from '../components/lists/ListSurfaceCard'
import { ListSurfaceControls, type ListTypeFilter, type ViewMode, type ListGroupKey } from '../components/lists/ListSurfaceControls'
import { ListsTableView } from '../components/lists/ListsTableView'
import { useListSurfaces, type ListSortKey, type ListSurface } from '../hooks/lists/useListSurfaces'
import { useListAttention, type ListAttention, type ListAttentionItem } from '../hooks/lists/useListAttention'
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

/**
 * Attention is the default order, and `attention` was missing from this list.
 *
 * The page's question is "which universe needs me", so the answer has to be at
 * the top before the reader does anything. Two bugs kept that from happening:
 * the default was `recent` — which answers "what did I touch", a different
 * question — and `attention` was absent from the accepted values, so a reader
 * who chose it had the choice silently discarded on their next visit and fell
 * back to `recent`.
 */
function readSort(): ListSortKey {
  try {
    const stored = localStorage.getItem(SORT_KEY)
    if (['attention', 'recent', 'alpha', 'assets', 'portfolio', 'owner', 'access'].includes(stored || '')) {
      return stored as ListSortKey
    }
  } catch { /* SSR / private mode */ }
  return 'attention'
}

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

  /*
   * No collapsed/expanded section state any more.
   *
   * It existed for the three ownership sections (My Lists / Collaborative /
   * Shared With Me) and their "View more" overflow. The board is one
   * activity-ordered grid now, so there is nothing to collapse and nothing to
   * page through — see `UniverseBoard`.
   */

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
    symbolMap,
    sortLists: sortFn
  } = useListSurfaces(sortBy)

  /*
   * Per-list attention. No new reads: `allLists` already carries `assetIds`
   * from the lists query, and this folds it against the org-wide research and
   * ideas scans both of which are already cached for other surfaces. See
   * `useListAttention`.
   */
  const { attentionFor } = useListAttention(allLists)

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

  /**
   * Order by what needs a person.
   *
   * Applied here rather than inside `useListSurfaces` because attention is
   * folded FROM that hook's output — asking the hook to sort by it would be
   * circular. The hook has already ordered by `sortBy`, so this is a stable
   * re-sort: lists with equal attention keep whatever order the chosen sort
   * gave them, which means "Attention" reads as the normal list with the loud
   * ones lifted rather than as a different list.
   */
  const byAttention = useCallback((lists: ListSurface[]) => {
    /*
     * Empty lists sink under EVERY sort, not only this one.
     *
     * An empty list is a container somebody made and has not filled. Interleaved
     * alphabetically or by recency it breaks the column of attention figures the
     * page is meant to be scanned down, and it is never the answer to "where do
     * I need to go".
     */
    const sink = (ls: ListSurface[]) => [...ls]
      .map((list, i) => ({ list, i, empty: (list.assetIds?.length ?? 0) === 0 }))
      .sort((a, b) => (a.empty === b.empty ? a.i - b.i : a.empty ? 1 : -1))
      .map(x => x.list)

    if (sortBy !== 'attention') return sink(lists)
    return sink([...lists]
      .map((list, i) => ({ list, i, at: attentionFor(list.id) }))
      .sort((a, b) => {
        // A decision owed outranks everything: it is the only state where the
        // list is blocking a person rather than merely holding open work.
        if (b.at.awaitingDecision !== a.at.awaitingDecision) {
          return b.at.awaitingDecision - a.at.awaitingDecision
        }
        if (b.at.needsAttention !== a.at.needsAttention) {
          return b.at.needsAttention - a.at.needsAttention
        }
        // Then work in hand, then a gap worth knowing about.
        if (b.at.activeIdeas !== a.at.activeIdeas) return b.at.activeIdeas - a.at.activeIdeas
        if (b.at.noCase !== a.at.noCase) return b.at.noCase - a.at.noCase
        return a.i - b.i
      })
      .map(x => x.list))
  }, [sortBy, attentionFor])

  const filteredMy = useMemo(() => byAttention(applyFilters(myLists)), [myLists, searchQuery, favoritesOnly, favoriteSet, portfolioFilterIds, byAttention])
  const filteredCollab = useMemo(() => byAttention(applyFilters(collaborative)), [collaborative, searchQuery, favoritesOnly, favoriteSet, portfolioFilterIds, byAttention])
  const filteredShared = useMemo(() => byAttention(applyFilters(sharedWithMe)), [sharedWithMe, searchQuery, favoritesOnly, favoriteSet, portfolioFilterIds, byAttention])

  /**
   * One board, split by whether a universe holds anything.
   *
   * The ownership arrays stay exactly as they were — same search, same
   * favourites, same portfolio filter, same sort, same permissions — and the
   * segmented Mine / Collaborative / Shared filter still chooses which of them
   * feed the board. What changed is that ownership no longer decides the
   * LAYOUT: all three merge into one activity-ordered grid.
   *
   * An empty list is a container somebody made and has not filled. It is never
   * the answer to "where do I need to go", so it leaves the grid entirely rather
   * than taking a panel's worth of vertical space saying nothing.
   */
  const { activeUniverses, emptyUniverses } = useMemo(() => {
    const sources =
      typeFilter === 'mine' ? [filteredMy]
        : typeFilter === 'collaborative' ? [filteredCollab]
          : typeFilter === 'shared' ? [filteredShared]
            : [filteredMy, filteredCollab, filteredShared]

    const seen = new Set<string>()
    const merged: ListSurface[] = []
    for (const group of sources) {
      for (const l of group) {
        if (seen.has(l.id)) continue
        seen.add(l.id)
        merged.push(l)
      }
    }
    const ordered = byAttention(merged)
    const held = (l: ListSurface) => metrics.get(l.id)?.assetCount ?? 0
    return {
      activeUniverses: ordered.filter(l => held(l) > 0),
      emptyUniverses: ordered.filter(l => held(l) === 0),
    }
  }, [typeFilter, filteredMy, filteredCollab, filteredShared, byAttention, metrics])

  /**
   * The page-level rollup, from the same fold the panels use.
   *
   * Counted over the universes actually on screen, so it always describes what
   * the reader is looking at rather than the whole account.
   */
  const rollup = useMemo(() => {
    let awaiting = 0
    let needs = 0
    for (const l of activeUniverses) {
      const a = attentionFor(l.id)
      awaiting += a.awaitingDecision
      needs += a.needsAttention
    }
    return { universes: activeUniverses.length, awaiting, needs }
  }, [activeUniverses, attentionFor])

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

  // ── User search ────────────────────────────────────────────────────────
  // Pool of invitable users is now restricted to current-org members —
  // previously a global ilike against the users table that surfaced
  // anyone in the database whose name or email matched. Defense in
  // depth: matches the org-scoped pattern applied elsewhere in
  // commit 868ee2f.
  const { data: orgMembers = [] } = useOrgMembers({ excludeUserId: user?.id })
  const searchUsers = (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([])
      setShowUserDropdown(false)
      return
    }
    const q = query.toLowerCase()
    const existingCollaboratorIds = editingList?.collaborators?.map((c: any) => c.user_id) || []
    const filteredResults = orgMembers
      .filter(m => !existingCollaboratorIds.includes(m.id))
      .filter(m => {
        const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.toLowerCase()
        return name.includes(q) || (m.email ?? '').toLowerCase().includes(q)
      })
      .slice(0, 10)
    setSearchResults(filteredResults)
    setShowUserDropdown(filteredResults.length > 0)
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

  /**
   * Open a universe ON the security that wanted attention.
   *
   * The same tab the list always opens in, carrying a focus: `ListTab` reads
   * `_focus` and hands it to the table, which expands that row in the inspector
   * mode the entry column names — a decision opens Work, research and an overdue
   * review open Case. Deliberately NOT a different navigation path or a new
   * route: the table stays mounted and the reader lands where they were going.
   */
  const handleOpenSecurity = (list: ListSurface, item: ListAttentionItem) => {
    markListOpened.mutate(list.id)
    if (onListSelect) {
      onListSelect({
        id: list.id,
        title: list.name,
        type: 'list',
        data: { ...list, _focus: { assetId: item.assetId, columnId: item.entryColumnId } },
      })
    }
  }

  const isListOwner = editingList && user && editingList.created_by === user.id

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-auto px-3 sm:px-6 py-4 space-y-3">
      {/*
        * ── Page header ────────────────────────────────────────────────
        *
        * The page had no title at all: it opened on a filter bar, so nothing
        * said what the surface was for or what question it answers. The command
        * bar keeps every control it had and now sits beside the title rather
        * than being the first thing on the screen.
        */}
      <div className="max-w-7xl mx-auto flex items-start gap-6 pt-1">
        <div className="min-w-0">
          <h1 className="text-[25px] font-bold tracking-[-0.03em] leading-none text-gray-900 dark:text-gray-50">
            Lists
          </h1>
          <p className="mt-1.5 text-[12.5px] text-gray-500 dark:text-gray-400">
            Universes you follow, research and make decisions from.
          </p>
        </div>
      </div>

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

      {/*
        * ── Rollup ─────────────────────────────────────────────────────
        *
        * The page's answer in one line, before any panel is read. Folded from
        * the same `attentionFor` the panels use and counted over the universes
        * actually on screen, so it always describes what the reader is looking
        * at rather than the whole account. Only the two attention figures carry
        * colour — a row where every number is coloured has no emphasis in it.
        */}
      {!listsError && !isLoading && viewMode === 'grid' && rollup.universes > 0 && (
        <div className="max-w-7xl mx-auto flex items-baseline gap-5 pb-3 border-b border-gray-900/[0.06] dark:border-white/[0.07]">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[17px] font-semibold tracking-[-0.03em] tabular-nums leading-none text-gray-900 dark:text-gray-50">
              {rollup.universes}
            </span>
            <span className="text-[12.5px] text-gray-500 dark:text-gray-400">
              active universe{rollup.universes === 1 ? '' : 's'}
            </span>
          </span>
          {rollup.awaiting > 0 && (
            <>
              <span className="text-[12px] text-gray-300 dark:text-gray-600">·</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[17px] font-semibold tracking-[-0.03em] tabular-nums leading-none text-primary-800 dark:text-primary-300">
                  {rollup.awaiting}
                </span>
                <span className="text-[12.5px] text-gray-500 dark:text-gray-400">awaiting decision</span>
              </span>
            </>
          )}
          {rollup.needs > 0 && (
            <>
              <span className="text-[12px] text-gray-300 dark:text-gray-600">·</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[17px] font-semibold tracking-[-0.03em] tabular-nums leading-none text-amber-700 dark:text-amber-400">
                  {rollup.needs}
                </span>
                <span className="text-[12.5px] text-gray-500 dark:text-gray-400">need attention</span>
              </span>
            </>
          )}
        </div>
      )}

      {/* Error state */}
      {listsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 sm:p-6 text-center dark:border-red-900 dark:bg-red-950/30">
          <List className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Failed to load lists</h3>
          <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">
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

      {/* Main content — same measure as the header and the command bar, so the
          universes line up with the title above them rather than bleeding to
          the window edge. */}
      {!listsError && !isLoading && (
        <div className="max-w-7xl mx-auto">
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
                attentionFor={attentionFor}
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
          ) : (
            /*
             * ── Grid: universes, ordered by what needs a person ───────
             *
             * NOT three ownership sections any more. My Lists / Collaborative /
             * Shared With Me organised the page by WHO a list belongs to, which
             * is never the question a reader arrives with — and it forced three
             * headers, three empty states and a dashed box for "Shared With Me
             * 0" before the first useful fact. Ownership survives in two places
             * that cost no hierarchy: the segmented filter above, and one quiet
             * word inside each panel.
             *
             * `activeUniverses` / `emptyUniverses` come from the SAME filtered
             * and sorted arrays as before, so search, favourites, the portfolio
             * filter, the type filter and every sort key still apply.
             */
            <UniverseBoard
              active={activeUniverses}
              empty={emptyUniverses}
              metrics={metrics}
              favoriteSet={favoriteSet}
              userId={user?.id}
              onListClick={handleListClick}
              onEditList={handleEditList}
              onOpenSecurity={handleOpenSecurity}
              symbolMap={symbolMap}
              lastActivityMap={lastActivityMap}
              attentionFor={attentionFor}
              onNewList={user ? () => setShowListManager(true) : undefined}
              isFiltered={!!searchQuery || favoritesOnly || portfolioFilterIds.length > 0 || typeFilter !== 'all'}
              hasAnyList={allLists.length > 0}
              sharedCount={filteredShared.length}
            />
          )}
        </div>
      )}

      {/* ── Edit List Modal (unchanged) ─────────────────────────────────── */}
      {editingList && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-viewport-90 flex flex-col dark:bg-gray-800">
            <div className="flex items-center justify-between p-3 sm:p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Edit List</h2>
              <button onClick={handleCancelEdit} className="text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab('details')}
                className={`px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'details' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400'
                }`}
              >
                <Palette className="h-4 w-4 inline mr-2" />
                Details
              </button>
              <button
                onClick={() => setActiveTab('collaborators')}
                className={`px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'collaborators' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400'
                }`}
              >
                <Users className="h-4 w-4 inline mr-2" />
                Collaborators
                {editingList.collaborators && editingList.collaborators.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs dark:text-gray-400 dark:bg-gray-800">
                    {editingList.collaborators.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeTab === 'details' ? (
                <div className="p-3 sm:p-6 space-y-4">
                  <div>
                    <label htmlFor="list-name" className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">List Name</label>
                    <input
                      id="list-name"
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:border-gray-600"
                      placeholder="Enter list name"
                    />
                  </div>
                  <div>
                    <label htmlFor="list-description" className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">Description (optional)</label>
                    <textarea
                      id="list-description"
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:border-gray-600"
                      placeholder="Enter list description"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">
                      <Palette className="h-4 w-4 inline mr-1" />
                      Color
                    </label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {colorPalette.map((color) => (
                        <button
                          key={color}
                          onClick={() => setEditForm({ ...editForm, color })}
                          className={`w-8 h-8 rounded-lg border-2 transition-all ${
                            editForm.color === color ? 'border-gray-900 scale-110' : 'border-gray-300 hover:border-gray-400 dark:border-gray-600'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 sm:p-6 space-y-6">
                  {/* Owner */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center dark:text-white">
                      <Shield className="h-4 w-4 mr-2" />
                      Owner
                    </h3>
                    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg dark:bg-gray-900">
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
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {(() => {
                            if (user?.first_name && user?.last_name) return `${user.first_name} ${user.last_name}`
                            if (user?.user_metadata?.first_name && user?.user_metadata?.last_name) return `${user.user_metadata.first_name} ${user.user_metadata.last_name}`
                            if (user?.raw_user_meta_data?.first_name && user?.raw_user_meta_data?.last_name) return `${user.raw_user_meta_data.first_name} ${user.raw_user_meta_data.last_name}`
                            return user?.email || 'Unknown User'
                          })()}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Full access</p>
                      </div>
                    </div>
                  </div>

                  {/* Invite */}
                  {isListOwner && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center dark:text-white">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Invite New Collaborator
                      </h3>
                      <div className="space-y-3 p-4 border border-gray-200 rounded-lg dark:border-gray-700">
                        <div className="flex space-x-3">
                          <div className="flex-1 relative">
                            <input
                              type="text"
                              value={userSearchQuery}
                              onChange={(e) => handleUserSearchChange(e.target.value)}
                              onFocus={() => { if (searchResults.length > 0) setShowUserDropdown(true) }}
                              onBlur={() => setTimeout(() => setShowUserDropdown(false), 150)}
                              placeholder="Search by name or email..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:border-gray-600"
                            />
                            {showUserDropdown && searchResults.length > 0 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto dark:border-gray-600 dark:bg-gray-800">
                                {searchResults.map((u) => (
                                  <button
                                    key={u.id}
                                    onClick={() => handleUserSelect(u)}
                                    className="w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0 dark:hover:bg-gray-800 dark:border-gray-800"
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
                                        <p className="text-sm font-medium text-gray-900 truncate dark:text-white">
                                          {u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email}
                                        </p>
                                        {u.first_name && u.last_name && (
                                          <p className="text-xs text-gray-500 truncate dark:text-gray-400">{u.email}</p>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                            {showUserDropdown && searchResults.length === 0 && userSearchQuery.length >= 2 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg dark:border-gray-600 dark:bg-gray-800">
                                <div className="px-4 py-3 text-sm text-gray-500 text-center dark:text-gray-400">
                                  No users found matching &quot;{userSearchQuery}&quot;
                                </div>
                              </div>
                            )}
                          </div>
                          <select
                            value={invitePermission}
                            onChange={(e) => setInvitePermission(e.target.value as 'read' | 'write')}
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:border-gray-600"
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
                      <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center dark:text-white">
                        <Users className="h-4 w-4 mr-2" />
                        Collaborators ({editingList.collaborators.length})
                      </h3>
                      <div className="space-y-2">
                        {editingList.collaborators.map((collab: any) => (
                          <div key={collab.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg dark:border-gray-700">
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
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                  {(() => {
                                    const u = collab.user || collab.collaborator_user
                                    return u?.first_name && u?.last_name ? `${u.first_name} ${u.last_name}` : u?.email || 'Unknown User'
                                  })()}
                                </p>
                                {(() => {
                                  const u = collab.user || collab.collaborator_user
                                  return u?.first_name && u?.last_name && <p className="text-xs text-gray-500 dark:text-gray-400">{u?.email}</p>
                                })()}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {isListOwner ? (
                                <select
                                  value={collab.permission}
                                  onChange={(e) => updateCollaboratorMutation.mutate({ collaborationId: collab.id, permission: e.target.value as 'read' | 'write' })}
                                  className="text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600"
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
                      <h3 className="text-sm font-medium text-gray-900 mb-1 dark:text-white">No collaborators yet</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {isListOwner ? 'Invite people to collaborate on this list' : 'Only you have access to this list'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-3 p-3 sm:p-6 border-t border-gray-200 dark:border-gray-700">
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

// ── UniverseBoard ──────────────────────────────────────────────────────

/**
 * The board: active universes, then empty ones as inventory.
 *
 * Replaces three ownership sections (My Lists / Collaborative / Shared With Me)
 * with a single activity-ordered grid. Ownership was never the question a reader
 * arrives with, and as structure it cost three headers, three empty states and a
 * dashed "Shared With Me 0" box before the first useful fact. It survives in the
 * segmented filter above and in one quiet word inside each panel.
 */
interface UniverseBoardProps {
  active: ListSurface[]
  empty: ListSurface[]
  metrics: Map<string, import('../hooks/lists/useListSurfaces').ListSurfaceMetrics>
  favoriteSet: Set<string>
  userId?: string
  onListClick: (list: ListSurface) => void
  onEditList: (list: any, e: React.MouseEvent) => void
  onOpenSecurity: (list: ListSurface, item: ListAttentionItem) => void
  symbolMap?: Map<string, string>
  lastActivityMap?: Map<string, import('../hooks/lists/useListSurfaces').LastListActivity>
  attentionFor: (listId?: string | null) => ListAttention
  onNewList?: () => void
  isFiltered: boolean
  hasAnyList: boolean
  /** Only decides whether the quiet shared note is worth a line. */
  sharedCount: number
}

function UniverseBoard({
  active, empty, metrics, favoriteSet, userId,
  onListClick, onEditList, onOpenSecurity,
  symbolMap, lastActivityMap, attentionFor,
  onNewList, isFiltered, hasAnyList, sharedCount,
}: UniverseBoardProps) {
  if (active.length === 0 && empty.length === 0) {
    if (isFiltered) {
      return (
        <EmptyState
          icon={Search}
          title="No universes match your filters"
          description="Try adjusting your search or filter criteria."
          compact
        />
      )
    }
    if (hasAnyList) return null
    return (
      <EmptyState
        icon={List}
        title="No lists yet"
        description={onNewList
          ? 'Create your first universe to organize the securities you follow.'
          : 'Sign in to access your asset lists.'}
        action={onNewList ? { label: 'Create First List', icon: Plus, onClick: onNewList } : undefined}
      />
    )
  }

  return (
    <div>
      {active.length > 0 && (
        <>
          <div className="text-[9px] font-bold uppercase tracking-[0.13em] text-gray-400 dark:text-gray-600 mb-2.5">
            Active universes
          </div>
          {/*
            * Two columns, each a substantial panel.
            *
            * One full-width column made every universe a skinny directory row —
            * the shape that can only ever hold a name and a count. Two gives each
            * one room for its securities, what needs a person inside it, and what
            * moved, without the page becoming a tile gallery.
            */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-7 gap-y-6">
            {active.map(list => (
              <ListSurfaceCard
                key={list.id}
                list={list}
                metrics={metrics.get(list.id)}
                isFavorite={favoriteSet.has(list.id)}
                isOwner={list.created_by === userId}
                symbolMap={symbolMap}
                lastActivity={lastActivityMap?.get(list.id)}
                attention={attentionFor(list.id)}
                onClick={() => onListClick(list)}
                onEdit={e => onEditList(list, e)}
                onOpenSecurity={item => onOpenSecurity(list, item)}
              />
            ))}
          </div>
        </>
      )}

      {/*
        * Empty lists are inventory, not work.
        *
        * One line of names under a hairline. As full-width rows they competed
        * with universes that had decisions pending, which is the clearest way to
        * make a command center read as a filesystem.
        */}
      {empty.length > 0 && (
        <div className="mt-7 pt-3 border-t border-gray-900/[0.06] dark:border-white/[0.07] flex items-baseline gap-2.5 flex-wrap">
          <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-gray-400 dark:text-gray-600 flex-shrink-0">
            Empty lists
          </span>
          <span className="text-[12.5px] text-gray-400 dark:text-gray-500 min-w-0">
            {empty.map((l, i) => (
              <span key={l.id}>
                {i > 0 && <span className="text-gray-300 dark:text-gray-600 px-1.5">·</span>}
                <button
                  onClick={() => onListClick(l)}
                  className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                >
                  {l.name}
                </button>
              </span>
            ))}
          </span>
          {onNewList && (
            <button
              onClick={onNewList}
              className="ml-auto text-[12px] text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex-shrink-0"
            >
              + New list
            </button>
          )}
        </div>
      )}

      {/* A sentence, never a dashed box: nothing shared is not a thing to fix. */}
      {sharedCount === 0 && (
        <div className="mt-2 text-[11.5px] text-gray-300 dark:text-gray-600">
          No one has shared a universe with you yet.
        </div>
      )}
    </div>
  )
}

