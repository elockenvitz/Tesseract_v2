import React, { useMemo } from 'react'
import { clsx } from 'clsx'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { IdeaCard, type IdeaCardProps } from '../IdeaCard'
import type { ThesisUpdateItem, ScoredFeedItem } from '../../../hooks/ideas/types'

const changeTypeConfig = {
  created: { icon: Plus, color: 'text-green-600', bg: 'bg-green-50', label: 'Added' },
  updated: { icon: Pencil, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Updated' },
  deleted: { icon: Trash2, color: 'text-red-600', bg: 'bg-red-50', label: 'Removed' }
}

interface ThesisUpdateCardProps extends Omit<IdeaCardProps, 'item'> {
  item: ScoredFeedItem & ThesisUpdateItem
  showDiff?: boolean
}

export function ThesisUpdateCard({
  item,
  showDiff = true,
  ...props
}: ThesisUpdateCardProps) {
  const changeConfig = changeTypeConfig[item.change_type] || changeTypeConfig.updated
  const ChangeIcon = changeConfig.icon

  const headerWidget = (
    <div className="flex items-center gap-2">
      {/* Change type badge */}
      <span className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        changeConfig.bg, changeConfig.color
      )}>
        <ChangeIcon className="h-3 w-3" />
        {changeConfig.label}
      </span>

      {/* Section/Field name */}
      <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
        {formatFieldName(item.section || item.field_name)}
      </span>
    </div>
  )

  const rawContent = item.new_value || item.content || ''

  // Render rich content as React elements
  const richContent = useMemo(() => {
    let text = rawContent

    // If HTML, convert to markdown-ish text first
    if (/<[a-z][\s\S]*>/i.test(text)) {
      text = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => {
          const clean = inner.replace(/<[^>]*>/g, '').trim()
          return `- ${clean}\n`
        })
        .replace(/<[^>]*>/g, '')
    }

    // Decode entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")

    // Split into lines and render with formatting
    const lines = text.split('\n')
    const elements: React.ReactNode[] = []
    let key = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // Skip empty lines (add spacing)
      if (!line) {
        if (elements.length > 0) {
          elements.push(<div key={key++} className="h-1.5" />)
        }
        continue
      }

      // Bullet line
      const bulletMatch = line.match(/^[-*]\s+(.+)/)
      if (bulletMatch) {
        elements.push(
          <div key={key++} className="flex gap-1.5 pl-1">
            <span className="text-gray-400 shrink-0">&bull;</span>
            <span>{renderInlineFormatting(bulletMatch[1])}</span>
          </div>
        )
        continue
      }

      // Regular line
      elements.push(<div key={key++}>{renderInlineFormatting(line)}</div>)
    }

    return elements
  }, [rawContent])

  return (
    <IdeaCard
      item={item}
      headerWidget={headerWidget}
      contentWidget={
        <div className="text-sm text-gray-700 leading-relaxed space-y-0.5">
          {richContent}
        </div>
      }
      {...props}
    />
  )
}

/** Render inline markdown formatting (**bold**, *italic*) as React elements */
function renderInlineFormatting(text: string): React.ReactNode {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  if (parts.length === 1 && !text.includes('**')) return text

  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/)
    if (boldMatch) {
      return <strong key={i} className="font-semibold text-gray-900">{boldMatch[1]}</strong>
    }
    return part || null
  })
}

function formatFieldName(fieldName: string | undefined): string {
  // Handle undefined/null field names
  if (!fieldName) return 'Unknown Field'

  // Convert snake_case to Title Case
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export default ThesisUpdateCard
