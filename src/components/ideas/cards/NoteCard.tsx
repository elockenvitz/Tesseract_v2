import React from 'react'
import { clsx } from 'clsx'
import { FileText, FolderKanban, Palette, BookOpen } from 'lucide-react'
import { IdeaCard, type IdeaCardProps } from '../IdeaCard'
import type { NoteItem, ScoredFeedItem } from '../../../hooks/ideas/types'

// Strip HTML tags from content for clean display
function stripHtml(html: string): string {
  if (!html) return ''
  // Remove HTML tags
  const text = html.replace(/<[^>]*>/g, ' ')
  // Decode HTML entities
  const decoded = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  // Clean up whitespace
  return decoded.replace(/\s+/g, ' ').trim()
}

const noteTypeConfig = {
  asset: { icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Asset Note' },
  portfolio: { icon: FolderKanban, color: 'text-green-600', bg: 'bg-green-50', label: 'Portfolio Note' },
  theme: { icon: Palette, color: 'text-purple-600', bg: 'bg-purple-50', label: 'Theme Note' },
  custom: { icon: BookOpen, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Notebook' }
}

interface NoteCardProps extends Omit<IdeaCardProps, 'item'> {
  item: ScoredFeedItem & NoteItem
  onSourceClick?: (sourceId: string, sourceType: string, sourceName?: string) => void
}

export function NoteCard({
  item,
  onSourceClick,
  ...props
}: NoteCardProps) {
  const noteConfig = noteTypeConfig[item.note_type] || noteTypeConfig.custom
  const NoteIcon = noteConfig.icon

  const headerWidget = (
    <div className="flex items-center gap-2">
      <span className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        noteConfig.bg, noteConfig.color
      )}>
        <NoteIcon className="h-3 w-3" />
        {noteConfig.label}
      </span>
      {item.source && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSourceClick?.(item.source!.id, item.source!.type, item.source!.name)
          }}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-semibold text-primary-700 bg-primary-50 rounded-full hover:bg-primary-100 transition-colors"
        >
          ${item.source.name}
        </button>
      )}
    </div>
  )

  // Override the title display and strip HTML
  const cleanContent = stripHtml(item.preview || item.content)
  const cardItem: ScoredFeedItem = {
    ...item,
    // Use cleaned preview as content
    content: cleanContent.substring(0, 300)
  }

  return (
    <IdeaCard
      item={cardItem}
      headerWidget={headerWidget}
      {...props}
    />
  )
}

export default NoteCard
