import React from 'react'
import {
  TrendingUp,
  Tag,
  Briefcase,
  FileText,
  GitBranch,
  List
} from 'lucide-react'
import { EntitySearchResult, EntityType, getEntityLabel, getEntityColor } from '../../hooks/useEntitySearch'
import { SuggestionItem, SuggestionGroup, EmptyState, LoadingState } from './SmartInputDropdown'

interface HashtagSuggestionsProps {
  suggestions: EntitySearchResult[]
  isLoading: boolean
  selectedIndex: number
  onSelect: (entity: EntitySearchResult) => void
  onHover: (index: number) => void
}

const ENTITY_ICONS: Record<EntityType, React.ElementType> = {
  user: TrendingUp, // Won't be used here
  asset: TrendingUp,
  theme: Tag,
  portfolio: Briefcase,
  note: FileText,
  workflow: GitBranch,
  list: List
}

const ENTITY_ORDER: EntityType[] = ['asset', 'theme', 'portfolio', 'workflow', 'list', 'note']

export function HashtagSuggestions({
  suggestions,
  isLoading,
  selectedIndex,
  onSelect,
  onHover
}: HashtagSuggestionsProps) {
  if (isLoading) {
    return <LoadingState />
  }

  if (suggestions.length === 0) {
    return <EmptyState message="No items found" />
  }

  // Group by type
  const grouped = ENTITY_ORDER.reduce((acc, type) => {
    const items = suggestions.filter(s => s.type === type)
    if (items.length > 0) {
      acc[type] = items
    }
    return acc
  }, {} as Record<EntityType, EntitySearchResult[]>)

  // Calculate global index for selection
  let globalIndex = 0

  return (
    <div>
      {ENTITY_ORDER.map(type => {
        const items = grouped[type]
        if (!items) return null

        const Icon = ENTITY_ICONS[type]
        const color = getEntityColor(type)

        return (
          <SuggestionGroup key={type} label={getEntityLabel(type) + 's'}>
            {items.map((entity) => {
              const currentIndex = globalIndex++
              return (
                <div
                  key={entity.id}
                  onMouseEnter={() => onHover(currentIndex)}
                >
                  <SuggestionItem
                    icon={<Icon className="w-4 h-4" />}
                    title={entity.title}
                    subtitle={entity.subtitle}
                    badge={type}
                    badgeColor={color}
                    isSelected={currentIndex === selectedIndex}
                    onClick={() => onSelect(entity)}
                  />
                </div>
              )
            })}
          </SuggestionGroup>
        )
      })}
    </div>
  )
}
