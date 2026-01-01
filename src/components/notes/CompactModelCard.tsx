import React from 'react'
import { FileSpreadsheet, Link2, Lock, Share2, Download } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '../ui/Badge'
import clsx from 'clsx'
import type { AssetModel, ExternalProvider, ModelSourceType } from '../../hooks/useAssetModels'

interface CompactModelCardProps {
  model: AssetModel
  currentUserId: string | undefined
  showAuthor?: boolean
  onClick?: () => void
  onDownload?: () => void
}

const providerLabels: Record<ExternalProvider, string> = {
  google_sheets: 'Sheets',
  airtable: 'Airtable',
  excel_online: 'Excel',
  smartsheet: 'Smartsheet',
  other: 'Link'
}

export function CompactModelCard({ model, currentUserId, showAuthor = true, onClick, onDownload }: CompactModelCardProps) {
  const isOwn = model.created_by === currentUserId
  const authorName = model.user?.first_name && model.user?.last_name
    ? `${model.user.first_name} ${model.user.last_name}`
    : model.user?.first_name || 'Unknown'
  const isExternal = model.source_type === 'external_link'

  const handleClick = () => {
    if (isExternal && model.external_url) {
      window.open(model.external_url, '_blank', 'noopener,noreferrer')
    } else if (onClick) {
      onClick()
    }
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDownload) {
      onDownload()
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
      {/* First line: Icon + Name + Version + Time + Share indicator */}
      <div className="flex items-center gap-2 min-w-0">
        {isExternal ? (
          <Link2 className="h-4 w-4 flex-shrink-0 text-blue-500" />
        ) : (
          <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-green-600" />
        )}

        <span className="flex-1 font-medium text-sm text-gray-900 truncate" title={model.name}>
          {model.name}
        </span>

        {model.version > 1 && (
          <Badge variant="default" size="sm" className="text-[10px] px-1 py-0 flex-shrink-0">
            v{model.version}
          </Badge>
        )}

        <span className="text-xs text-gray-400 flex-shrink-0">
          {formatDistanceToNow(new Date(model.updated_at), { addSuffix: false })}
        </span>

        {isOwn && (
          model.is_shared ? (
            <Share2 className="h-3 w-3 text-green-500 flex-shrink-0" title="Shared" />
          ) : (
            <Lock className="h-3 w-3 text-gray-400 flex-shrink-0" title="Private" />
          )
        )}

        {/* Download button for uploaded files */}
        {!isExternal && model.file_path && (
          <button
            onClick={handleDownload}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 rounded transition-opacity"
            title="Download"
          >
            <Download className="h-3.5 w-3.5 text-gray-500" />
          </button>
        )}
      </div>

      {/* Second line: Author + Provider/File info */}
      <div className="flex items-center gap-2 mt-1.5">
        {showAuthor && (
          <span className={clsx(
            'text-xs',
            isOwn ? 'text-primary-600 font-medium' : 'text-gray-500'
          )}>
            {isOwn ? 'You' : authorName}
          </span>
        )}

        {isExternal && model.external_provider && (
          <Badge variant="info" size="sm" className="text-[10px] px-1.5 py-0">
            {providerLabels[model.external_provider] || model.external_provider}
          </Badge>
        )}

        {!isExternal && model.file_name && (
          <span className="text-[10px] text-gray-400 truncate" title={model.file_name}>
            {model.file_name}
          </span>
        )}

        {model.description && (
          <span className="text-[10px] text-gray-400 truncate" title={model.description}>
            {model.description}
          </span>
        )}
      </div>
    </div>
  )
}
