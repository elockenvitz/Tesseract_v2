import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, Edit2, Trash2, Plus, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { supabase } from '../../lib/supabase'
import type { ProjectCollection } from '../../types/project'
import type { ProjectFilters } from './ProjectFilterPanel'

interface SavedFiltersPanelProps {
  currentFilters: ProjectFilters
  onApplyCollection: (filters: ProjectFilters) => void
}

export function SavedFiltersPanel({
  currentFilters,
  onApplyCollection
}: SavedFiltersPanelProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const queryClient = useQueryClient()

  // Fetch saved collections
  const { data: collections } = useQuery({
    queryKey: ['project-collections'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      if (!user.data.user) return []

      const { data, error } = await supabase
        .from('project_collections')
        .select('*')
        .eq('created_by', user.data.user.id)
        .order('is_pinned', { ascending: false })
        .order('sort_order')

      if (error) throw error
      return data as ProjectCollection[]
    }
  })

  // Create collection mutation
  const createCollectionMutation = useMutation({
    mutationFn: async (name: string) => {
      const user = await supabase.auth.getUser()
      if (!user.data.user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('project_collections')
        .insert({
          name,
          created_by: user.data.user.id,
          filter_criteria: currentFilters,
          icon: 'folder',
          color: '#6366f1'
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
      setIsCreating(false)
      setNewCollectionName('')
    }
  })

  // Delete collection mutation
  const deleteCollectionMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('project_collections')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
    }
  })

  // Toggle pin mutation
  const togglePinMutation = useMutation({
    mutationFn: async ({ id, isPinned }: { id: string, isPinned: boolean }) => {
      const { error } = await supabase
        .from('project_collections')
        .update({ is_pinned: !isPinned })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
    }
  })

  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      createCollectionMutation.mutate(newCollectionName.trim())
    }
  }

  const hasActiveFilters = () => {
    return currentFilters.status !== 'all' ||
      currentFilters.priority !== 'all' ||
      currentFilters.assignment !== 'all' ||
      currentFilters.contextType !== 'all' ||
      currentFilters.dueDateRange !== 'all' ||
      currentFilters.hasDeliverables !== undefined
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Saved Filters
        </h3>
        {hasActiveFilters() && !isCreating && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Save Current
          </Button>
        )}
      </div>

      {/* Create New Collection Form */}
      {isCreating && (
        <div className="mb-3 p-3 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
          <div className="flex items-center space-x-2">
            <Input
              type="text"
              placeholder="Collection name..."
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateCollection()
                if (e.key === 'Escape') {
                  setIsCreating(false)
                  setNewCollectionName('')
                }
              }}
              autoFocus
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleCreateCollection}
              disabled={!newCollectionName.trim() || createCollectionMutation.isPending}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsCreating(false)
                setNewCollectionName('')
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Collections List */}
      <div className="space-y-1">
        {collections && collections.length > 0 ? (
          collections.map(collection => (
            <div
              key={collection.id}
              className="group flex items-center justify-between p-2 rounded hover:bg-white dark:hover:bg-gray-700 transition-colors"
            >
              <button
                onClick={() => onApplyCollection(collection.filter_criteria as ProjectFilters)}
                className="flex-1 flex items-center space-x-2 text-left"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: collection.color }}
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                  {collection.name}
                </span>
              </button>

              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => togglePinMutation.mutate({
                    id: collection.id,
                    isPinned: collection.is_pinned
                  })}
                  className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                    collection.is_pinned ? 'text-warning-500' : 'text-gray-400'
                  }`}
                  title={collection.is_pinned ? 'Unpin' : 'Pin'}
                >
                  <Star className={`w-3.5 h-3.5 ${collection.is_pinned ? 'fill-current' : ''}`} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${collection.name}"?`)) {
                      deleteCollectionMutation.mutate(collection.id)
                    }
                  }}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-error-500"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
            No saved filters yet. Apply filters and click "Save Current" to create one.
          </p>
        )}
      </div>
    </div>
  )
}
