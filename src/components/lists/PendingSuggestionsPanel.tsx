import React, { useState } from 'react'
import {
  X, Check, MessageSquare, Plus, Minus, User, ChevronDown, ChevronUp, Loader2
} from 'lucide-react'
import { useListSuggestions, ListSuggestion } from '../../hooks/lists'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface PendingSuggestionsPanelProps {
  listId: string
  isOpen: boolean
  onClose: () => void
}

export function PendingSuggestionsPanel({
  listId,
  isOpen,
  onClose
}: PendingSuggestionsPanelProps) {
  const {
    incomingSuggestions,
    outgoingSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    cancelSuggestion,
    isAccepting,
    isRejecting,
    isCanceling,
    isLoading
  } = useListSuggestions({ listId, enabled: isOpen })

  const [expandedSection, setExpandedSection] = useState<'incoming' | 'outgoing' | null>('incoming')
  const [responseNotes, setResponseNotes] = useState<Record<string, string>>({})
  const [showResponseInput, setShowResponseInput] = useState<string | null>(null)

  if (!isOpen) return null

  const getUserDisplayName = (user: ListSuggestion['suggester'] | ListSuggestion['target_user']) => {
    if (!user) return 'Unknown User'
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email?.split('@')[0] || 'Unknown User'
  }

  const handleAccept = (suggestionId: string) => {
    acceptSuggestion({
      suggestionId,
      responseNotes: responseNotes[suggestionId]
    })
    setShowResponseInput(null)
    setResponseNotes(prev => {
      const next = { ...prev }
      delete next[suggestionId]
      return next
    })
  }

  const handleReject = (suggestionId: string) => {
    rejectSuggestion({
      suggestionId,
      responseNotes: responseNotes[suggestionId]
    })
    setShowResponseInput(null)
    setResponseNotes(prev => {
      const next = { ...prev }
      delete next[suggestionId]
      return next
    })
  }

  const renderSuggestionCard = (suggestion: ListSuggestion, type: 'incoming' | 'outgoing') => {
    const isIncoming = type === 'incoming'
    const isPending = isAccepting || isRejecting || isCanceling

    return (
      <div
        key={suggestion.id}
        className="border border-gray-200 rounded-lg p-4 bg-white"
      >
        {/* Header with suggestion type and user */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className={clsx(
                'p-1.5 rounded-lg',
                suggestion.suggestion_type === 'add'
                  ? 'bg-green-100 text-green-600'
                  : 'bg-red-100 text-red-600'
              )}
            >
              {suggestion.suggestion_type === 'add' ? (
                <Plus className="h-4 w-4" />
              ) : (
                <Minus className="h-4 w-4" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {suggestion.suggestion_type === 'add' ? 'Add' : 'Remove'} suggestion
              </p>
              <p className="text-xs text-gray-500">
                {isIncoming ? (
                  <>From {getUserDisplayName(suggestion.suggester)}</>
                ) : (
                  <>To {getUserDisplayName(suggestion.target_user)}</>
                )}
              </p>
            </div>
          </div>
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(suggestion.created_at), { addSuffix: true })}
          </span>
        </div>

        {/* Asset info */}
        <div className="bg-gray-50 rounded-lg p-3 mb-3">
          <p className="font-semibold text-gray-900">{suggestion.asset?.symbol}</p>
          <p className="text-sm text-gray-600">{suggestion.asset?.company_name}</p>
        </div>

        {/* Notes */}
        {suggestion.notes && (
          <div className="mb-3 flex items-start gap-2">
            <MessageSquare className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-gray-600 italic">"{suggestion.notes}"</p>
          </div>
        )}

        {/* Response input (for incoming) */}
        {isIncoming && showResponseInput === suggestion.id && (
          <div className="mb-3">
            <textarea
              value={responseNotes[suggestion.id] || ''}
              onChange={(e) =>
                setResponseNotes(prev => ({
                  ...prev,
                  [suggestion.id]: e.target.value
                }))
              }
              placeholder="Add a response (optional)..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {isIncoming ? (
            <>
              {showResponseInput !== suggestion.id ? (
                <button
                  onClick={() => setShowResponseInput(suggestion.id)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Add response...
                </button>
              ) : (
                <button
                  onClick={() => setShowResponseInput(null)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Hide
                </button>
              )}
              <div className="flex-1" />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleReject(suggestion.id)}
                disabled={isPending}
              >
                {isRejecting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <X className="h-3 w-3 mr-1" />
                    Decline
                  </>
                )}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleAccept(suggestion.id)}
                disabled={isPending}
              >
                {isAccepting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <Check className="h-3 w-3 mr-1" />
                    Accept
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <div className="flex-1">
                <Badge variant="warning" size="sm">Pending</Badge>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => cancelSuggestion(suggestion.id)}
                disabled={isPending}
              >
                {isCanceling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-20">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[70vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">
            Pending Suggestions
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(70vh-64px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : incomingSuggestions.length === 0 && outgoingSuggestions.length === 0 ? (
            <div className="text-center py-12 px-4">
              <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No pending suggestions</p>
              <p className="text-sm text-gray-400 mt-1">
                Suggestions you send or receive will appear here
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Incoming suggestions section */}
              {incomingSuggestions.length > 0 && (
                <div>
                  <button
                    onClick={() =>
                      setExpandedSection(expandedSection === 'incoming' ? null : 'incoming')
                    }
                    className="flex items-center justify-between w-full px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-700">For You</span>
                      <Badge variant="primary" size="sm">
                        {incomingSuggestions.length}
                      </Badge>
                    </div>
                    {expandedSection === 'incoming' ? (
                      <ChevronUp className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                  {expandedSection === 'incoming' && (
                    <div className="mt-3 space-y-3">
                      {incomingSuggestions.map(s => renderSuggestionCard(s, 'incoming'))}
                    </div>
                  )}
                </div>
              )}

              {/* Outgoing suggestions section */}
              {outgoingSuggestions.length > 0 && (
                <div>
                  <button
                    onClick={() =>
                      setExpandedSection(expandedSection === 'outgoing' ? null : 'outgoing')
                    }
                    className="flex items-center justify-between w-full px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-700">From You</span>
                      <Badge variant="secondary" size="sm">
                        {outgoingSuggestions.length}
                      </Badge>
                    </div>
                    {expandedSection === 'outgoing' ? (
                      <ChevronUp className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                  {expandedSection === 'outgoing' && (
                    <div className="mt-3 space-y-3">
                      {outgoingSuggestions.map(s => renderSuggestionCard(s, 'outgoing'))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default PendingSuggestionsPanel
