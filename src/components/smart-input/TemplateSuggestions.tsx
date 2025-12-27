import React from 'react'
import { FileText, Plus } from 'lucide-react'
import { Template } from '../../hooks/useTemplates'
import { SuggestionItem, SuggestionGroup, EmptyState } from './SmartInputDropdown'

interface TemplateSuggestionsProps {
  suggestions: Template[]
  selectedIndex: number
  onSelect: (template: Template) => void
  onHover: (index: number) => void
  onCreateNew?: () => void
}

export function TemplateSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
  onHover,
  onCreateNew
}: TemplateSuggestionsProps) {
  // Group by category
  const grouped = suggestions.reduce((acc, template) => {
    const category = template.category || 'general'
    if (!acc[category]) {
      acc[category] = []
    }
    acc[category].push(template)
    return acc
  }, {} as Record<string, Template[]>)

  const categories = Object.keys(grouped).sort()

  // Calculate global index
  let globalIndex = 0

  return (
    <div>
      {/* Create new option */}
      {onCreateNew && (
        <button
          type="button"
          onClick={onCreateNew}
          className="w-full flex items-center px-3 py-2 text-left text-primary-600 hover:bg-primary-50 border-b border-gray-100"
        >
          <Plus className="w-4 h-4 mr-2" />
          <span className="font-medium">Create new template</span>
        </button>
      )}

      {suggestions.length === 0 ? (
        <EmptyState message="No templates found. Create one to get started!" />
      ) : (
        categories.map(category => (
          <SuggestionGroup key={category} label={category}>
            {grouped[category].map((template) => {
              const currentIndex = globalIndex++
              const preview = template.content.length > 50
                ? template.content.substring(0, 50) + '...'
                : template.content

              return (
                <div
                  key={template.id}
                  onMouseEnter={() => onHover(currentIndex)}
                >
                  <SuggestionItem
                    icon={<FileText className="w-4 h-4" />}
                    title={template.name}
                    subtitle={preview}
                    badge={template.is_shared ? 'Shared' : undefined}
                    badgeColor="purple"
                    isSelected={currentIndex === selectedIndex}
                    onClick={() => onSelect(template)}
                  />
                </div>
              )
            })}
          </SuggestionGroup>
        ))
      )}
    </div>
  )
}
