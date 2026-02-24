import React, { useState, useEffect } from 'react'
import { List, X, Search, Plus, Check, ChevronRight, Star, UserPlus } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { formatDistanceToNow } from 'date-fns'

interface AddToListButtonProps {
  assetId: string
  assetSymbol?: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

interface ListRow {
  id: string
  name: string
  description: string | null
  color: string | null
  is_default: boolean | null
  list_type: 'mutual' | 'collaborative'
  updated_at: string | null
  created_at: string | null
  item_count: number
  isAdded: boolean
}

export function AddToListButton({
  assetId,
  assetSymbol,
  variant = 'outline',
  size = 'sm',
  className
}: AddToListButtonProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // Fetch lists the user owns or collaborates on, with isAdded status
  const { data: lists, isLoading } = useQuery({
    queryKey: ['asset-lists-for-link', assetId],
    queryFn: async () => {
      if (!user?.id) return []

      // Owned lists
      const { data: ownedLists, error: ownedError } = await supabase
        .from('asset_lists')
        .select('id, name, description, color, is_default, list_type, updated_at, created_at, asset_list_items(id)')
        .eq('created_by', user.id)
        .order('updated_at', { ascending: false })

      if (ownedError) throw ownedError

      // Shared lists via collaborations
      const { data: collaborations, error: collabError } = await supabase
        .from('asset_list_collaborations')
        .select('list_id, asset_lists(id, name, description, color, is_default, list_type, updated_at, created_at, asset_list_items(id))')
        .eq('user_id', user.id)

      if (collabError) throw collabError

      const sharedLists = (collaborations || []).map((c: any) => c.asset_lists).filter(Boolean)
      const allLists = [...(ownedLists || []), ...sharedLists]

      // Deduplicate by id
      const unique = Array.from(new Map(allLists.map(l => [l.id, l])).values())

      // Check which lists already contain this asset
      const { data: existingItems } = await supabase
        .from('asset_list_items')
        .select('list_id')
        .eq('asset_id', assetId)

      const existingIds = new Set(existingItems?.map(i => i.list_id) || [])

      return unique.map(list => ({
        id: list.id,
        name: list.name,
        description: list.description,
        color: list.color,
        is_default: list.is_default,
        list_type: list.list_type,
        updated_at: list.updated_at,
        created_at: list.created_at,
        item_count: list.asset_list_items?.length || 0,
        isAdded: existingIds.has(list.id),
      })) as ListRow[]
    },
    enabled: showDialog,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-lists-for-link', assetId] })
    queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
    queryClient.invalidateQueries({ queryKey: ['asset-list-items'] })
  }

  // Add asset to list
  const linkMutation = useMutation({
    mutationFn: async (list: ListRow) => {
      if (list.isAdded) {
        return { alreadyLinked: true, name: list.name }
      }
      const { error } = await supabase
        .from('asset_list_items')
        .insert({ list_id: list.id, asset_id: assetId, added_by: user?.id })
      if (error) throw error
      return { alreadyLinked: false, name: list.name }
    },
    onSuccess: (result) => {
      if (result.alreadyLinked) {
        setToast(`Already in ${result.name}`)
      } else {
        setToast(`Added to ${result.name}`)
        invalidateAll()
      }
      setShowDialog(false)
      setSearchQuery('')
    },
  })

  // Create new list pre-linked to this asset
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from('asset_lists')
        .insert({
          name,
          created_by: user?.id,
          list_type: 'mutual',
        })
        .select('id')
        .single()
      if (error) throw error

      // Link the asset to the new list
      await supabase
        .from('asset_list_items')
        .insert({ list_id: data.id, asset_id: assetId, added_by: user?.id })

      return { id: data.id, name }
    },
    onSuccess: (result) => {
      setToast(`Added to ${result.name}`)
      setNewName('')
      setShowCreateForm(false)
      setShowDialog(false)
      setSearchQuery('')
      invalidateAll()
    },
  })

  const handleLink = (list: ListRow) => {
    if (linkMutation.isPending) return
    linkMutation.mutate(list)
  }

  const handleCreate = () => {
    if (!newName.trim() || createMutation.isPending) return
    createMutation.mutate(newName.trim())
  }

  const filtered = lists?.filter(
    (l) =>
      !searchQuery ||
      l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (l.description && l.description.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  const available = filtered.filter((l) => !l.isAdded)
  const linked = filtered.filter((l) => l.isAdded)

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          setShowDialog(true)
        }}
        className={className}
      >
        <List className="h-4 w-4 mr-2" />
        Add to List
      </Button>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast}
        </div>
      )}

      {/* Modal */}
      {showDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto text-left">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => { setShowDialog(false); setSearchQuery('') }}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-auto transform transition-all max-h-[70vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
                <div>
                  <h3 className="text-[15px] font-semibold text-gray-900">Add to List</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">Select a list to add this asset to</p>
                </div>
                <button
                  onClick={() => { setShowDialog(false); setSearchQuery('') }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 pt-3 pb-1.5 flex-shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search lists..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    autoFocus
                  />
                </div>
              </div>

              {/* List rows */}
              <div className="flex-1 overflow-y-auto px-3 py-1">
                {isLoading ? (
                  <div className="space-y-1 px-2 py-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* Available */}
                    {available.length > 0 && (
                      <div>
                        {linked.length > 0 && (
                          <p className="text-[9px] font-medium text-gray-400/70 uppercase tracking-widest mb-1 mt-2 px-2">Available</p>
                        )}
                        {available.map((list) => (
                          <button
                            key={list.id}
                            onClick={() => handleLink(list)}
                            disabled={linkMutation.isPending}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer hover:bg-blue-50/70 active:bg-blue-100/60 transition-colors text-left group"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] font-semibold text-gray-900 truncate block leading-tight">
                                {list.name}
                                {list.is_default && <Star className="inline w-3 h-3 text-yellow-500 ml-1 -mt-0.5" />}
                                {list.list_type === 'collaborative' && <UserPlus className="inline w-3 h-3 text-gray-400 ml-1 -mt-0.5" />}
                              </span>
                              {list.description && (
                                <span className="text-[11px] text-gray-500/70 block mt-0.5 leading-tight truncate">{list.description}</span>
                              )}
                              <span className="text-[10px] text-gray-400/60 block mt-0.5 leading-tight">
                                {list.item_count} {list.item_count === 1 ? 'asset' : 'assets'}
                                {list.updated_at && (
                                  <> &middot; Updated {formatDistanceToNow(new Date(list.updated_at), { addSuffix: false })}</>
                                )}
                              </span>
                            </div>
                            <Plus className="w-3.5 h-3.5 text-gray-300 group-hover:text-primary-500 flex-shrink-0 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Already added */}
                    {linked.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-1 px-2">Already added</p>
                        {linked.map((list) => (
                          <div
                            key={list.id}
                            className="flex items-center justify-between px-3 py-2 rounded-lg cursor-default border-l-2 border-green-300/60 ml-0.5"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] font-medium text-gray-400 truncate block leading-tight">
                                {list.name}
                                {list.is_default && <Star className="inline w-3 h-3 text-yellow-400/50 ml-1 -mt-0.5" />}
                              </span>
                              {list.description && (
                                <span className="text-[11px] text-gray-400/40 block mt-0.5 leading-tight truncate">{list.description}</span>
                              )}
                              <span className="text-[10px] text-gray-400/40 block mt-0.5 leading-tight">
                                {list.item_count} {list.item_count === 1 ? 'asset' : 'assets'}
                                {list.updated_at && (
                                  <> &middot; Updated {formatDistanceToNow(new Date(list.updated_at), { addSuffix: false })}</>
                                )}
                              </span>
                            </div>
                            <Check className="w-3.5 h-3.5 text-green-500/70 flex-shrink-0" />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* No results */}
                    {filtered.length === 0 && !isLoading && (
                      <div className="py-6 text-center">
                        <p className="text-[13px] text-gray-400">
                          {lists?.length === 0 ? 'No lists yet.' : 'No lists match your search.'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Create new — visually secondary footer */}
              <div className="border-t border-gray-200 px-5 py-2.5 flex-shrink-0 bg-gray-50/50">
                {showCreateForm ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="List name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreate()
                        if (e.key === 'Escape') {
                          setShowCreateForm(false)
                          setNewName('')
                        }
                      }}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={handleCreate}
                      disabled={!newName.trim() || createMutation.isPending}
                    >
                      {createMutation.isPending ? 'Creating\u2026' : 'Create'}
                    </Button>
                    <button
                      onClick={() => { setShowCreateForm(false); setNewName('') }}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="flex items-center gap-1.5 text-[11px] font-normal text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Create new list
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
