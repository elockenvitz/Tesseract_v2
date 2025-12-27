import React from 'react'
import { User } from 'lucide-react'
import { EntitySearchResult } from '../../hooks/useEntitySearch'
import { SuggestionItem, EmptyState, LoadingState } from './SmartInputDropdown'

interface MentionSuggestionsProps {
  suggestions: EntitySearchResult[]
  isLoading: boolean
  selectedIndex: number
  onSelect: (user: EntitySearchResult) => void
  onHover: (index: number) => void
}

export function MentionSuggestions({
  suggestions,
  isLoading,
  selectedIndex,
  onSelect,
  onHover
}: MentionSuggestionsProps) {
  if (isLoading) {
    return <LoadingState />
  }

  if (suggestions.length === 0) {
    return <EmptyState message="No users found" />
  }

  return (
    <div>
      {suggestions.map((user, index) => (
        <div
          key={user.id}
          onMouseEnter={() => onHover(index)}
        >
          <SuggestionItem
            icon={<User className="w-4 h-4" />}
            title={user.title}
            subtitle={user.subtitle}
            isSelected={index === selectedIndex}
            onClick={() => onSelect(user)}
          />
        </div>
      ))}
    </div>
  )
}
