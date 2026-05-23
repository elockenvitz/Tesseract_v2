import React, { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { AtSign, Hash, X } from 'lucide-react'

interface User {
  id: string
  email: string
  first_name?: string
  last_name?: string
}

interface Asset {
  id: string
  symbol: string
  company_name: string
}

interface MentionInputProps {
  value: string
  onChange: (value: string, mentions: string[], references: Array<{ type: string; id: string; text: string }>) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  rows?: number
  hideHelper?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void
}

interface Suggestion {
  id: string
  display: string
  type: 'user' | 'asset' | 'workflow' | 'list' | 'theme'
}

export function MentionInput({ value, onChange, placeholder, className, disabled, rows = 3, hideHelper = false, onKeyDown, onBlur }: MentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionType, setSuggestionType] = useState<'mention' | 'hashtag' | null>(null)
  const [suggestionQuery, setSuggestionQuery] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [mentions, setMentions] = useState<string[]>([])
  const [references, setReferences] = useState<Array<{ type: string; id: string; text: string }>>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Optional context: this component is also rendered in places that
  // sit outside the OrganizationProvider tree (portal-rendered modals,
  // overlays). Falling back to null currentOrgId disables the user
  // suggestion query — that's the correct behavior when we don't know
  // which org's members to surface.
  const orgCtx = useOrganizationOptional()
  const currentOrgId = orgCtx?.currentOrgId ?? null

  // Fetch users for @mentions, scoped to the current org's active members
  // only. We don't rely on RLS alone here — platform admins legitimately
  // *can* read all users (for ops dashboards) but the mention dropdown
  // should never show anyone outside the current org regardless of role.
  // Defense in depth: explicit org scope at the query level.
  const { data: users } = useQuery({
    queryKey: ['mention-users', currentOrgId],
    queryFn: async () => {
      if (!currentOrgId) return []
      const { data: members, error: memErr } = await supabase
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', currentOrgId)
        .eq('status', 'active')
      if (memErr) throw memErr
      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean)
      if (userIds.length === 0) return []
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
        .order('email')
      if (error) throw error
      return data as User[]
    },
    enabled: suggestionType === 'mention' && !!currentOrgId,
  })

  // Fetch assets for #hashtags
  const { data: assets } = useQuery({
    queryKey: ['assets-for-mentions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .order('symbol')
        .limit(100)
      if (error) throw error
      return data as Asset[]
    },
    enabled: suggestionType === 'hashtag'
  })

  // Get filtered suggestions based on query
  const suggestions: Suggestion[] = React.useMemo(() => {
    if (suggestionType === 'mention' && users) {
      return users
        .filter(user => {
          const name = user.first_name && user.last_name
            ? `${user.first_name} ${user.last_name}`
            : user.email
          return name.toLowerCase().includes(suggestionQuery.toLowerCase())
        })
        .map(user => ({
          id: user.id,
          display: user.first_name && user.last_name
            ? `${user.first_name} ${user.last_name} (${user.email})`
            : user.email,
          type: 'user' as const
        }))
        .slice(0, 5)
    }

    if (suggestionType === 'hashtag' && assets) {
      return assets
        .filter(asset =>
          asset.symbol.toLowerCase().includes(suggestionQuery.toLowerCase()) ||
          asset.company_name.toLowerCase().includes(suggestionQuery.toLowerCase())
        )
        .map(asset => ({
          id: asset.id,
          display: `${asset.symbol} - ${asset.company_name}`,
          type: 'asset' as const
        }))
        .slice(0, 5)
    }

    return []
  }, [suggestionType, suggestionQuery, users, assets])

  // Handle text change
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const cursorPos = e.target.selectionStart

    // Check if user is typing @ or #
    const textBeforeCursor = newValue.substring(0, cursorPos)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')
    const lastHashIndex = textBeforeCursor.lastIndexOf('#')
    const lastSpaceIndex = Math.max(textBeforeCursor.lastIndexOf(' '), textBeforeCursor.lastIndexOf('\n'))

    if (lastAtIndex > lastSpaceIndex) {
      setSuggestionType('mention')
      setSuggestionQuery(textBeforeCursor.substring(lastAtIndex + 1))
      setShowSuggestions(true)
      setCursorPosition(lastAtIndex)
    } else if (lastHashIndex > lastSpaceIndex) {
      setSuggestionType('hashtag')
      setSuggestionQuery(textBeforeCursor.substring(lastHashIndex + 1))
      setShowSuggestions(true)
      setCursorPosition(lastHashIndex)
    } else {
      setShowSuggestions(false)
      setSuggestionType(null)
    }

    onChange(newValue, mentions, references)
  }

  // Handle suggestion selection
  const handleSelectSuggestion = (suggestion: Suggestion) => {
    if (!textareaRef.current) return

    const textBefore = value.substring(0, cursorPosition)
    const textAfter = value.substring(textareaRef.current.selectionStart)

    let newText = ''
    let prefix = ''

    if (suggestionType === 'mention') {
      prefix = '@'
      const userName = suggestion.display.split(' (')[0] // Get just the name part
      newText = `${textBefore}${prefix}${userName} ${textAfter}`

      // Track mention
      const newMentions = [...mentions, suggestion.id]
      setMentions(newMentions)
      onChange(newText, newMentions, references)
    } else if (suggestionType === 'hashtag') {
      prefix = '#'
      const displayText = suggestion.display.split(' - ')[0] // Get just the symbol
      newText = `${textBefore}${prefix}${displayText} ${textAfter}`

      // Track reference
      const newReferences = [...references, { type: suggestion.type, id: suggestion.id, text: displayText }]
      setReferences(newReferences)
      onChange(newText, mentions, newReferences)
    }

    setShowSuggestions(false)
    setSuggestionType(null)

    // Focus back on textarea
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = cursorPosition + prefix.length + suggestion.display.split(' -')[0].split(' (')[0].length + 1
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  // Handle keyboard navigation in suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle suggestions first
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'Escape') {
        setShowSuggestions(false)
        e.preventDefault()
        return
      }
    }

    // Call parent onKeyDown if provided
    if (onKeyDown) {
      onKeyDown(e)
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none ${className}`}
        rows={rows}
      />

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              onClick={() => handleSelectSuggestion(suggestion)}
              className="w-full px-3 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center space-x-2"
            >
              {suggestionType === 'mention' ? (
                <AtSign className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : (
                <Hash className="w-4 h-4 text-green-500 flex-shrink-0" />
              )}
              <span className="text-sm text-gray-900 truncate">{suggestion.display}</span>
            </button>
          ))}
        </div>
      )}

      {/* Helper text */}
      {!hideHelper && (
        <div className="mt-1 text-xs text-gray-500 flex items-center space-x-4">
          <span className="flex items-center">
            <AtSign className="w-3 h-3 mr-1" />
            Type @ to mention someone
          </span>
          <span className="flex items-center">
            <Hash className="w-3 h-3 mr-1" />
            Type # to reference an asset
          </span>
        </div>
      )}
    </div>
  )
}
