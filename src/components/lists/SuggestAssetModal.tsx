import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, Plus, Minus, User, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useListSuggestions } from '../../hooks/lists'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'

interface UserOption {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
}

interface SuggestAssetModalProps {
  listId: string
  listName: string
  suggestionType: 'add' | 'remove'
  // For 'remove' suggestions, the asset is pre-selected
  preselectedAsset?: {
    id: string
    symbol: string
    company_name: string
  }
  // For 'remove' suggestions, the target user is pre-selected (the owner of the item)
  preselectedTargetUser?: UserOption
  // All users who have items in this list (for showing dropdown)
  listUsers: UserOption[]
  onClose: () => void
}

export function SuggestAssetModal({
  listId,
  listName,
  suggestionType,
  preselectedAsset,
  preselectedTargetUser,
  listUsers,
  onClose
}: SuggestAssetModalProps) {
  const { user } = useAuth()
  const { createSuggestion, isCreating, hasPendingSuggestion } = useListSuggestions({ listId })

  // State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<{
    id: string
    symbol: string
    company_name: string
  } | null>(preselectedAsset || null)
  const [selectedTargetUser, setSelectedTargetUser] = useState<UserOption | null>(
    preselectedTargetUser || null
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Available users to suggest to (excluding self)
  const availableUsers = listUsers.filter(u => u.id !== user?.id)

  // Search for assets (for 'add' suggestions)
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['asset-search-for-suggestion', searchQuery, listId],
    queryFn: async () => {
      if (!searchQuery.trim()) return []

      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${searchQuery}%,company_name.ilike.%${searchQuery}%`)
        .limit(10)

      if (error) throw error
      return data || []
    },
    enabled: suggestionType === 'add' && searchQuery.length >= 2
  })

  const getUserDisplayName = (targetUser: UserOption) => {
    if (targetUser.first_name && targetUser.last_name) {
      return `${targetUser.first_name} ${targetUser.last_name}`
    }
    return targetUser.email?.split('@')[0] || 'Unknown User'
  }

  const handleSubmit = () => {
    if (!selectedAsset) {
      setError('Please select an asset')
      return
    }
    if (!selectedTargetUser) {
      setError('Please select a user to suggest to')
      return
    }

    // Check for duplicate pending suggestion
    if (hasPendingSuggestion(selectedAsset.id, suggestionType, selectedTargetUser.id)) {
      setError('A similar suggestion is already pending for this user')
      return
    }

    createSuggestion(
      {
        assetId: selectedAsset.id,
        suggestionType,
        targetUserId: selectedTargetUser.id,
        notes: notes.trim() || undefined
      },
      {
        onSuccess: () => {
          onClose()
        },
        onError: (err: any) => {
          setError(err.message || 'Failed to create suggestion')
        }
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {suggestionType === 'add' ? (
              <Plus className="h-5 w-5 text-green-600" />
            ) : (
              <Minus className="h-5 w-5 text-red-600" />
            )}
            <h3 className="text-lg font-semibold text-gray-900">
              Suggest {suggestionType === 'add' ? 'Adding' : 'Removing'} Asset
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Asset selection (for 'add' type) */}
          {suggestionType === 'add' && !preselectedAsset && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Search Asset
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by symbol or name..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  autoFocus
                />
              </div>

              {searchQuery.length >= 2 && (
                <div className="mt-2 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                  ) : searchResults && searchResults.length > 0 ? (
                    <div className="divide-y divide-gray-100">
                      {searchResults.map((asset) => (
                        <button
                          key={asset.id}
                          onClick={() => setSelectedAsset(asset)}
                          className={clsx(
                            'w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors',
                            selectedAsset?.id === asset.id && 'bg-blue-50'
                          )}
                        >
                          <p className="font-medium text-gray-900">{asset.symbol}</p>
                          <p className="text-sm text-gray-500">{asset.company_name}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-gray-500 py-4">No assets found</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Selected asset display (for 'remove' or after selection) */}
          {selectedAsset && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">
                {suggestionType === 'add' ? 'Suggesting to add' : 'Suggesting to remove'}
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{selectedAsset.symbol}</p>
                  <p className="text-sm text-gray-600">{selectedAsset.company_name}</p>
                </div>
                {suggestionType === 'add' && !preselectedAsset && (
                  <button
                    onClick={() => setSelectedAsset(null)}
                    className="p-1 rounded hover:bg-gray-200 text-gray-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Target user selection */}
          {!preselectedTargetUser && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Suggest to
              </label>
              {availableUsers.length > 0 ? (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {availableUsers.map((targetUser) => (
                    <button
                      key={targetUser.id}
                      onClick={() => setSelectedTargetUser(targetUser)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 transition-colors',
                        selectedTargetUser?.id === targetUser.id && 'bg-blue-50'
                      )}
                    >
                      <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                        <User className="h-4 w-4 text-gray-500" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {getUserDisplayName(targetUser)}
                        </p>
                        <p className="text-xs text-gray-500">{targetUser.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 italic">
                  No other users to suggest to
                </p>
              )}
            </div>
          )}

          {/* Target user display (when preselected) */}
          {preselectedTargetUser && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Suggesting to</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-gray-500" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {getUserDisplayName(preselectedTargetUser)}
                  </p>
                  <p className="text-xs text-gray-500">{preselectedTargetUser.email}</p>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Add a note (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                suggestionType === 'add'
                  ? "Why do you think they should add this?"
                  : "Why do you think they should remove this?"
              }
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
            />
          </div>

          {/* Error display */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={
              !selectedAsset ||
              !selectedTargetUser ||
              isCreating ||
              availableUsers.length === 0
            }
          >
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                {suggestionType === 'add' ? (
                  <Plus className="h-4 w-4 mr-1" />
                ) : (
                  <Minus className="h-4 w-4 mr-1" />
                )}
                Send Suggestion
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default SuggestAssetModal
