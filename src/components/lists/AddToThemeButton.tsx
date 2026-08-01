import React, { useState, useEffect } from 'react'
import { Tag, X, Search, Plus, Check, ChevronRight } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { formatDistanceToNow } from 'date-fns'

interface AddToThemeButtonProps {
  assetId: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

interface ThemeRow {
  id: string
  name: string
  description: string | null
  color: string | null
  updated_at: string | null
  created_by: string | null
  isAdded: boolean
}

export function AddToThemeButton({
  assetId,
  variant = 'outline',
  size = 'sm',
  className
}: AddToThemeButtonProps) {
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

  // Fetch available themes
  const { data: themes, isLoading } = useQuery({
    queryKey: ['themes', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('themes')
        .select('id, name, description, color, updated_at, created_by')
        .eq('created_by', user?.id)
        .order('updated_at', { ascending: false })

      if (error) throw error

      // Check which themes already have this asset
      const { data: existingThemeAssets } = await supabase
        .from('theme_assets')
        .select('theme_id')
        .eq('asset_id', assetId)

      const existingThemeIds = new Set(existingThemeAssets?.map(ta => ta.theme_id) || [])

      return (data || []).map(theme => ({
        ...theme,
        isAdded: existingThemeIds.has(theme.id)
      })) as ThemeRow[]
    },
    enabled: showDialog
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['themes', assetId] })
    queryClient.invalidateQueries({ queryKey: ['asset-themes', assetId] })
  }

  // Add to theme mutation
  const linkMutation = useMutation({
    mutationFn: async (theme: ThemeRow) => {
      if (theme.isAdded) {
        return { alreadyLinked: true, name: theme.name }
      }
      const { error } = await supabase
        .from('theme_assets')
        .insert({ theme_id: theme.id, asset_id: assetId })
      if (error) throw error
      return { alreadyLinked: false, name: theme.name }
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

  // Create new theme pre-linked to this asset
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from('themes')
        .insert({
          name,
          created_by: user?.id,
        })
        .select('id')
        .single()
      if (error) throw error

      // Link the asset to the new theme
      await supabase
        .from('theme_assets')
        .insert({ theme_id: data.id, asset_id: assetId })

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

  const handleLink = (theme: ThemeRow) => {
    if (linkMutation.isPending) return
    linkMutation.mutate(theme)
  }

  const handleCreate = () => {
    if (!newName.trim() || createMutation.isPending) return
    createMutation.mutate(newName.trim())
  }

  const filtered = themes?.filter(
    (t) =>
      !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  const available = filtered.filter((t) => !t.isAdded)
  const linked = filtered.filter((t) => t.isAdded)

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
        <Tag className="h-4 w-4 mr-2" />
        Add to Theme
      </Button>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast}
        </div>
      )}

      {/* Modal */}
      {showDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => { setShowDialog(false); setSearchQuery('') }}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-auto transform transition-all max-h-[70vh] overflow-hidden flex flex-col dark:bg-gray-800">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0 dark:border-gray-700">
                <div>
                  <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">Add to Theme</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5 dark:text-gray-400">Select a theme to add this asset to</p>
                </div>
                <button
                  onClick={() => { setShowDialog(false); setSearchQuery('') }}
                  className="text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
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
                    placeholder="Search themes\u2026"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:border-gray-600"
                    autoFocus
                  />
                </div>
              </div>

              {/* Theme list */}
              <div className="flex-1 overflow-y-auto px-3 py-1">
                {isLoading ? (
                  <div className="space-y-1 px-2 py-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-11 bg-gray-50 rounded-lg animate-pulse dark:bg-gray-900" />
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
                        {available.map((theme) => (
                          <button
                            key={theme.id}
                            onClick={() => handleLink(theme)}
                            disabled={linkMutation.isPending}
                            className="w-full flex items-center justify-between px-3 py-[7px] rounded-lg cursor-pointer hover:bg-blue-50/70 active:bg-blue-100/60 transition-colors text-left group"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] font-semibold text-gray-900 truncate block leading-tight dark:text-white">
                                {theme.name}
                              </span>
                              {theme.updated_at && (
                                <span className="text-[11px] text-gray-400/80 block mt-0.5 leading-tight">
                                  Updated {formatDistanceToNow(new Date(theme.updated_at), { addSuffix: true })}
                                </span>
                              )}
                              {theme.description && (
                                <span className="text-[11px] text-gray-400/60 block mt-px leading-tight truncate">{theme.description}</span>
                              )}
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-gray-200 group-hover:text-primary-500 flex-shrink-0 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Already added */}
                    {linked.length > 0 && (
                      <div>
                        <p className="text-[9px] font-medium text-gray-400/70 uppercase tracking-widest mb-1 mt-3 px-2">Already added</p>
                        {linked.map((theme) => (
                          <div
                            key={theme.id}
                            className="flex items-center justify-between px-3 py-[7px] rounded-lg cursor-default"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] font-medium text-gray-500 truncate block leading-tight dark:text-gray-400">{theme.name}</span>
                              {theme.description && (
                                <span className="text-[11px] text-gray-400/60 block mt-0.5 leading-tight truncate">{theme.description}</span>
                              )}
                            </div>
                            <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* No results */}
                    {filtered.length === 0 && !isLoading && (
                      <div className="py-6 text-center">
                        <p className="text-[13px] text-gray-400">
                          {themes?.length === 0 ? 'No themes yet.' : 'No themes match your search.'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Create new — visually secondary footer */}
              <div className="border-t border-gray-200 px-5 py-2.5 flex-shrink-0 bg-gray-50/50 dark:border-gray-700">
                {showCreateForm ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Theme name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreate()
                        if (e.key === 'Escape') {
                          setShowCreateForm(false)
                          setNewName('')
                        }
                      }}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:border-gray-600"
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
                      className="text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="flex items-center gap-1.5 text-[11px] font-normal text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
                  >
                    <Plus className="w-3 h-3" />
                    Create new theme
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
