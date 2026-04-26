import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { List, Plus, Search, X, Users, Share2, MoreVertical, Edit3, Trash2, Star, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ListTypeSelector, ListType } from './ListTypeSelector'
import { Filter as FilterIcon, List as ListIconForMode } from 'lucide-react'

type ContentMode = 'manual' | 'screen'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface AssetListManagerProps {
  isOpen: boolean
  onClose: () => void
  onListSelect?: (list: any) => void
  selectedAssetId?: string // If provided, show "Add to List" functionality
  filterType?: 'list' | 'theme' | 'portfolio'
}

interface AssetList {
  id: string
  name: string
  description: string | null
  color: string | null
  is_default: boolean | null
  list_type: 'mutual' | 'collaborative'
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

export function AssetListManager({ isOpen, onClose, onListSelect, selectedAssetId, filterType }: AssetListManagerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // When the modal opens for the "Add to List" flow (selectedAssetId
  // is provided), show the existing-lists picker. Otherwise the user
  // came from a "New List" button, so jump straight into the create
  // form rather than making them click through the list management view.
  useEffect(() => {
    if (isOpen) {
      setShowCreateForm(!selectedAssetId)
    }
  }, [isOpen, selectedAssetId])
  const [newListName, setNewListName] = useState('')
  const [newListDescription, setNewListDescription] = useState('')
  const [newListColor, setNewListColor] = useState('#3b82f6')
  const [newListType, setNewListType] = useState<ListType>('mutual')
  const [newContentMode, setNewContentMode] = useState<ContentMode>('manual')
  // Pending collaborator invites entered during create-list flow.
  // Resolved server-side when the list is actually inserted.
  const [pendingInvites, setPendingInvites] = useState<
    Array<{ email: string; permission: 'read' | 'write' }>
  >([])
  const [inviteEmailDraft, setInviteEmailDraft] = useState('')
  const [invitePermissionDraft, setInvitePermissionDraft] = useState<'read' | 'write'>('read')
  const [inviteFailures, setInviteFailures] = useState<string[]>([])
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
    queryKey: ['asset-lists', filterType],
    queryFn: async () => {
      if (!user?.id) return []

      // Fetch lists created by user
      let ownedQuery = supabase
        .from('asset_lists')
        .select(`
          *,
          asset_list_items(id)
        `)
        .eq('created_by', user.id)

      const { data: ownedLists, error: ownedError } = await ownedQuery.order('created_at', { ascending: false })

      if (ownedError) throw ownedError

      // Fetch lists shared with user via collaborations
      const { data: collaborations, error: collabError } = await supabase
        .from('asset_list_collaborations')
        .select(`
          list_id,
          permission,
          asset_lists (
            *,
            asset_list_items(id)
          )
        `)
        .eq('user_id', user.id)

      if (collabError) throw collabError

      // Combine owned and shared lists
      const sharedLists = (collaborations || [])
        .map(collab => collab.asset_lists)
        .filter(Boolean)

      const allLists = [...(ownedLists || []), ...sharedLists]

      const listsWithCounts = allLists.map(list => ({
        ...list,
        item_count: list.asset_list_items?.length || 0
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

  // Create list mutation. Returns the new list + any failed invite
  // messages so the form can surface them inline.
  const createListMutation = useMutation({
    mutationFn: async ({
      name, description, color, list_type, content_mode, invites,
    }: {
      name: string
      description: string
      color: string
      list_type: ListType
      content_mode: ContentMode
      invites: Array<{ email: string; permission: 'read' | 'write' }>
    }) => {
      const { data: created, error } = await supabase
        .from('asset_lists')
        .insert([{
          name,
          description,
          color,
          list_type,
          content_mode,
          // Screens start with an empty AND group — user fills rules via the criteria panel
          screen_criteria: content_mode === 'screen'
            ? { id: crypto.randomUUID(), combinator: 'AND', rules: [] }
            : null,
          created_by: user?.id,
        }])
        .select('*')
        .single()

      if (error) throw error
      if (!created) throw new Error('List creation returned no row')

      // Resolve invites → user lookups → collaboration rows.
      // Failed lookups are returned (not thrown) so the list itself
      // still creates and the user sees per-invite errors inline.
      const failures: string[] = []
      for (const invite of invites) {
        const email = invite.email.trim().toLowerCase()
        if (!email) continue
        const { data: u, error: lookupErr } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .maybeSingle()
        if (lookupErr || !u) {
          failures.push(`${invite.email} — not found in your org`)
          continue
        }
        const { error: collabErr } = await supabase
          .from('asset_list_collaborations')
          .insert({
            list_id: created.id,
            user_id: u.id,
            permission: invite.permission,
            created_at: new Date().toISOString(),
          })
        if (collabErr) {
          failures.push(`${invite.email} — ${collabErr.message}`)
        }
      }

      return { list: created, failures }
    },
    onSuccess: ({ failures }) => {
      // Refresh BOTH the underlying lists query AND the surface query
      // that the Lists page reads from. Without invalidating
      // 'list-surfaces' the new list wouldn't appear until a hard
      // refresh.
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['list-surfaces'] })

      if (failures.length > 0) {
        // Keep the form open so the user can see / fix the failures.
        setInviteFailures(failures)
        // Clear only the parts that succeeded — the failed invites
        // stay so the user can retry/edit them.
        setPendingInvites(prev => prev.filter(p =>
          failures.some(f => f.startsWith(`${p.email} —`))
        ))
        return
      }

      setInviteFailures([])
      setShowCreateForm(false)
      setNewListName('')
      setNewListDescription('')
      setNewListColor('#3b82f6')
      setNewListType('mutual')
      setNewContentMode('manual')
      setPendingInvites([])
      setInviteEmailDraft('')
      setInvitePermissionDraft('read')
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

      return data
    },
    onSuccess: (_, { listId }) => {
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

  // Map list type/content_mode → swatch color. Lists no longer let
  // the user pick a color; the type drives the look so similar lists
  // are visually grouped at a glance.
  const colorForList = (
    listType: ListType,
    contentMode: ContentMode,
  ): string => {
    if (contentMode === 'screen') return '#f59e0b' // amber — auto-screened
    if (listType === 'collaborative') return '#10b981' // emerald — team list
    return '#3b82f6' // blue — solo manual list (default)
  }

  const handleCreateList = () => {
    if (!newListName.trim()) return

    const resolvedListType = newContentMode === 'screen' ? 'mutual' : newListType
    // Capture any draft email the user typed but hasn't pressed "Add" on.
    const trailing = inviteEmailDraft.trim()
    const allInvites = trailing
      ? [...pendingInvites, { email: trailing, permission: invitePermissionDraft }]
      : pendingInvites

    createListMutation.mutate({
      name: newListName.trim(),
      description: newListDescription.trim(),
      // Color derived from type + mode, not user-picked.
      color: colorForList(resolvedListType, newContentMode),
      // Screens ignore the mutual/collaborative distinction (no per-row ownership).
      list_type: resolvedListType,
      content_mode: newContentMode,
      invites: allInvites,
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
    // Find the list to check if asset is already added
    const targetList = assetLists?.find(list => list.id === listId)
    if (targetList?.isAdded || addedToLists.has(listId)) {
      return
    }
    
    if (selectedAssetId) {
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
                {selectedAssetId
                  ? filterType === 'theme'
                    ? 'Add to Theme'
                    : filterType === 'portfolio'
                    ? 'Add to Portfolio'
                    : 'Add to List'
                  : 'Asset Lists'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {selectedAssetId
                  ? filterType === 'theme'
                    ? 'Choose a theme to add this asset to'
                    : filterType === 'portfolio'
                    ? 'Choose a portfolio to add this asset to'
                    : 'Choose a list to add this asset to'
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
                    <div>
                      <Input
                        label="List Name"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="Enter list name..."
                        // Disable the browser's local-history autofill — the
                        // in-app duplicate detection below is the only
                        // suggestion surface we want.
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        name="list-name-no-autofill"
                      />
                      {/* Similar lists found — surfaced to prevent
                          duplication. Filters the user's already-loaded
                          asset lists by name/description substring match. */}
                      {(() => {
                        const q = newListName.trim().toLowerCase()
                        if (q.length < 2) return null
                        const matches = (assetLists || []).filter((l: any) => {
                          const n = (l.name || '').toLowerCase()
                          const d = (l.description || '').toLowerCase()
                          return n.includes(q) || d.includes(q)
                        }).slice(0, 5)
                        if (matches.length === 0) return null
                        return (
                          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <p className="text-sm font-medium text-amber-900 mb-2">
                              You already have similar lists:
                            </p>
                            <div className="space-y-1">
                              {matches.map((l: any) => (
                                <button
                                  key={l.id}
                                  type="button"
                                  onClick={() => {
                                    setShowCreateForm(false)
                                    onListSelect?.(l)
                                    onClose()
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left bg-white border border-amber-200 rounded hover:bg-amber-50 transition-colors"
                                >
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: l.color || '#3b82f6' }}
                                  />
                                  <span className="font-medium text-gray-900 truncate">{l.name}</span>
                                  {l.description && (
                                    <span className="text-xs text-gray-500 truncate">— {l.description}</span>
                                  )}
                                  <span className="ml-auto text-xs text-amber-700 shrink-0">Open →</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </div>

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

                    {/* Color is derived from list type + content mode —
                        no user picker. */}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Content mode
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setNewContentMode('manual')}
                          className={clsx(
                            'text-left p-3 rounded-lg border-2 transition-colors',
                            newContentMode === 'manual'
                              ? 'border-primary-500 bg-primary-50'
                              : 'border-gray-200 hover:border-gray-300'
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <ListIconForMode className="h-4 w-4 text-gray-700" />
                            <span className="text-sm font-semibold text-gray-900">Manual</span>
                          </div>
                          <p className="text-xs text-gray-600">
                            Add assets one by one. Assign status, tags, owner per row.
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewContentMode('screen')}
                          className={clsx(
                            'text-left p-3 rounded-lg border-2 transition-colors',
                            newContentMode === 'screen'
                              ? 'border-primary-500 bg-primary-50'
                              : 'border-gray-200 hover:border-gray-300'
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <FilterIcon className="h-4 w-4 text-gray-700" />
                            <span className="text-sm font-semibold text-gray-900">Screen</span>
                          </div>
                          <p className="text-xs text-gray-600">
                            Auto-populated by criteria across the asset universe.
                          </p>
                        </button>
                      </div>
                    </div>

                    {newContentMode === 'manual' && (
                      <ListTypeSelector
                        value={newListType}
                        onChange={setNewListType}
                      />
                    )}

                    {/* Invite collaborators */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Invite collaborators (optional)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={inviteEmailDraft}
                          onChange={(e) => setInviteEmailDraft(e.target.value)}
                          placeholder="email@yourorg.com"
                          autoComplete="off"
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              const v = inviteEmailDraft.trim()
                              if (!v) return
                              setPendingInvites(prev => [...prev, { email: v, permission: invitePermissionDraft }])
                              setInviteEmailDraft('')
                            }
                          }}
                        />
                        <select
                          value={invitePermissionDraft}
                          onChange={(e) => setInvitePermissionDraft(e.target.value as 'read' | 'write')}
                          className="px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          <option value="read">Read</option>
                          <option value="write">Write</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const v = inviteEmailDraft.trim()
                            if (!v) return
                            setPendingInvites(prev => [...prev, { email: v, permission: invitePermissionDraft }])
                            setInviteEmailDraft('')
                          }}
                          disabled={!inviteEmailDraft.trim()}
                          className="px-3 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Add
                        </button>
                      </div>
                      {pendingInvites.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {pendingInvites.map((inv, idx) => (
                            <span
                              key={`${inv.email}-${idx}`}
                              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-primary-50 text-primary-700 border border-primary-200 rounded-md"
                            >
                              {inv.email}
                              <span className="px-1 py-0.5 text-[10px] font-medium bg-white text-primary-700 border border-primary-200 rounded">
                                {inv.permission}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPendingInvites(prev => prev.filter((_, i) => i !== idx))}
                                className="text-primary-500 hover:text-primary-700"
                                title="Remove"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {inviteFailures.length > 0 && (
                        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-xs font-medium text-red-800 mb-1">Some invites couldn't be sent:</p>
                          <ul className="text-xs text-red-700 space-y-0.5 list-disc list-inside">
                            {inviteFailures.map((f, i) => <li key={i}>{f}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="flex space-x-3">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowCreateForm(false)
                          setNewListName('')
                          setNewListDescription('')
                          setNewListColor('#3b82f6')
                          setNewListType('mutual')
                          setNewContentMode('manual')
                          setPendingInvites([])
                          setInviteEmailDraft('')
                          setInvitePermissionDraft('read')
                          setInviteFailures([])
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
                            if (selectedAssetId) {
                              handleAddToList(list.id)
                            } else if (onListSelect) {
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
                                      {list.list_type === 'collaborative' && (
                                        <Badge variant="secondary" size="sm" className="flex-shrink-0">
                                          <UserPlus className="h-3 w-3 mr-1" />
                                          Collab
                                        </Badge>
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
                                      {list.list_type === 'collaborative' && (
                                        <Badge variant="secondary" size="sm" className="flex-shrink-0">
                                          <UserPlus className="h-3 w-3 mr-1" />
                                          Collab
                                        </Badge>
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
                      if (selectedAssetId) {
                        handleAddToList(list.id)
                      } else if (onListSelect) {
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
                              {list.list_type === 'collaborative' && (
                                <Badge variant="secondary" size="sm" className="flex-shrink-0">
                                  <UserPlus className="h-3 w-3 mr-1" />
                                  Collab
                                </Badge>
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