import React from 'react'
import { clsx } from 'clsx'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { IdeaCard, type IdeaCardProps } from '../IdeaCard'
import type { ThesisUpdateItem, ScoredFeedItem } from '../../../hooks/ideas/types'

function stripHtml(html: string | undefined): string {
  if (!html) return ''
  const text = html.replace(/<[^>]*>/g, ' ')
  const decoded = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return decoded.replace(/\s+/g, ' ').trim()
}

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

  // Get the content to display
  const displayContent = stripHtml(item.new_value || item.content)

  // Override content to show the stripped content
  const cardItem: ScoredFeedItem = {
    ...item,
    content: displayContent
  }

  return (
    <IdeaCard
      item={cardItem}
      headerWidget={headerWidget}
      {...props}
    />
  )
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
