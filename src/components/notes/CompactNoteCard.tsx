import React from 'react'
import { FileText, Link2, Upload, Lock, Share2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '../ui/Badge'
import clsx from 'clsx'

export type NoteSourceType = 'platform' | 'uploaded' | 'external_link'
export type ExternalNoteProvider = 'google_docs' | 'notion' | 'evernote' | 'onenote' | 'confluence' | 'other'

export interface CompactNote {
  id: string
  title: string
  note_type?: string | null
  source_type?: NoteSourceType
  external_url?: string | null
  external_provider?: ExternalNoteProvider | null
  file_name?: string | null
  is_shared: boolean
  created_by: string
  updated_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

interface CompactNoteCardProps {
  note: CompactNote
  currentUserId: string | undefined
  showAuthor?: boolean
  onClick?: () => void
}

const sourceTypeIcons: Record<NoteSourceType, typeof FileText> = {
  platform: FileText,
  uploaded: Upload,
  external_link: Link2
}

const providerLabels: Record<ExternalNoteProvider, string> = {
  google_docs: 'GDocs',
  notion: 'Notion',
  evernote: 'Evernote',
  onenote: 'OneNote',
  confluence: 'Confluence',
  other: 'Link'
}

export function CompactNoteCard({ note, currentUserId, showAuthor = true, onClick }: CompactNoteCardProps) {
  const isOwn = note.created_by === currentUserId
  const authorName = note.user?.first_name && note.user?.last_name
    ? `${note.user.first_name} ${note.user.last_name}`
    : note.user?.first_name || 'Unknown'
  const sourceType = note.source_type || 'platform'
  const Icon = sourceTypeIcons[sourceType]

  const handleClick = () => {
    if (sourceType === 'external_link' && note.external_url) {
      window.open(note.external_url, '_blank', 'noopener,noreferrer')
    } else if (onClick) {
      onClick()
    }
  }

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'group p-2.5 rounded-lg border border-gray-200 bg-white',
        'hover:border-primary-300 hover:bg-primary-50/30 transition-all cursor-pointer',
        'shadow-sm hover:shadow'
      )}
    >
      {/* First line: Icon + Title + Time + Share indicator */}
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={clsx(
          'h-4 w-4 flex-shrink-0',
          sourceType === 'external_link' ? 'text-blue-500' : 'text-gray-500'
        )} />

        <span className="flex-1 font-medium text-sm text-gray-900 truncate" title={note.title}>
          {note.title}
        </span>

        <span className="text-xs text-gray-400 flex-shrink-0">
          {formatDistanceToNow(new Date(note.updated_at), { addSuffix: false })}
        </span>

        {isOwn && (
          note.is_shared ? (
            <Share2 className="h-3 w-3 text-green-500 flex-shrink-0" title="Shared" />
          ) : (
            <Lock className="h-3 w-3 text-gray-400 flex-shrink-0" title="Private" />
          )
        )}
      </div>

      {/* Second line: Author + Type badge */}
      <div className="flex items-center gap-2 mt-1.5">
        {showAuthor && (
          <span className={clsx(
            'text-xs',
            isOwn ? 'text-primary-600 font-medium' : 'text-gray-500'
          )}>
            {isOwn ? 'You' : authorName}
          </span>
        )}

        {note.note_type && (
          <Badge variant="default" size="sm" className="text-[10px] px-1.5 py-0">
            {note.note_type}
          </Badge>
        )}

        {sourceType === 'external_link' && note.external_provider && (
          <Badge variant="info" size="sm" className="text-[10px] px-1.5 py-0">
            {providerLabels[note.external_provider] || note.external_provider}
          </Badge>
        )}

        {sourceType === 'uploaded' && note.file_name && (
          <span className="text-[10px] text-gray-400 truncate" title={note.file_name}>
            {note.file_name}
          </span>
        )}
      </div>
    </div>
  )
}
