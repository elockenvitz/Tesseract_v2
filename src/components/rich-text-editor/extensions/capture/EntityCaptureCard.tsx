import React, { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  TrendingUp, Briefcase, Building2, FileText, ListChecks,
  GitBranch, FolderKanban, Target, CheckSquare, BarChart3,
  ExternalLink, RefreshCw, Clock, ChevronDown, ChevronUp,
  AlertCircle
} from 'lucide-react'
import { fetchEntityData } from '../../../../hooks/useCapture'
import type { CaptureEntityType } from '../../../../types/capture'

// Entity type configuration
const ENTITY_CONFIG: Record<CaptureEntityType, {
  icon: React.ComponentType<{ className?: string }>
  label: string
  bgColor: string
  textColor: string
  borderColor: string
}> = {
  asset: { icon: TrendingUp, label: 'Asset', bgColor: 'bg-blue-50', textColor: 'text-blue-700', borderColor: 'border-blue-200' },
  portfolio: { icon: Briefcase, label: 'Portfolio', bgColor: 'bg-emerald-50', textColor: 'text-emerald-700', borderColor: 'border-emerald-200' },
  theme: { icon: Building2, label: 'Theme', bgColor: 'bg-purple-50', textColor: 'text-purple-700', borderColor: 'border-purple-200' },
  note: { icon: FileText, label: 'Note', bgColor: 'bg-amber-50', textColor: 'text-amber-700', borderColor: 'border-amber-200' },
  list: { icon: ListChecks, label: 'List', bgColor: 'bg-cyan-50', textColor: 'text-cyan-700', borderColor: 'border-cyan-200' },
  workflow: { icon: GitBranch, label: 'Workflow', bgColor: 'bg-indigo-50', textColor: 'text-indigo-700', borderColor: 'border-indigo-200' },
  project: { icon: FolderKanban, label: 'Project', bgColor: 'bg-pink-50', textColor: 'text-pink-700', borderColor: 'border-pink-200' },
  price_target: { icon: Target, label: 'Price Target', bgColor: 'bg-red-50', textColor: 'text-red-700', borderColor: 'border-red-200' },
  workflow_item: { icon: CheckSquare, label: 'Checklist Item', bgColor: 'bg-slate-50', textColor: 'text-slate-700', borderColor: 'border-slate-200' },
  chart: { icon: BarChart3, label: 'Chart', bgColor: 'bg-violet-50', textColor: 'text-violet-700', borderColor: 'border-violet-200' }
}

interface EntityCaptureCardProps {
  captureType: 'entity_live' | 'entity_static'
  entityType: CaptureEntityType
  entityId: string
  entityDisplay: string
  snapshotData?: Record<string, any>
  snapshotAt?: string
  isExpanded?: boolean
  onToggleExpand?: () => void
  onNavigate?: () => void
  selected?: boolean
}

export function EntityCaptureCard({
  captureType,
  entityType,
  entityId,
  entityDisplay,
  snapshotData,
  snapshotAt,
  isExpanded = false,
  onToggleExpand,
  onNavigate,
  selected = false
}: EntityCaptureCardProps) {
  const [liveData, setLiveData] = useState<Record<string, any> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const config = ENTITY_CONFIG[entityType]
  const Icon = config.icon
  const isLive = captureType === 'entity_live'

  // Fetch live data for live captures
  useEffect(() => {
    if (isLive) {
      setIsLoading(true)
      setError(null)
      fetchEntityData(entityType, entityId)
        .then(data => {
          setLiveData(data)
          setIsLoading(false)
        })
        .catch(err => {
          setError('Failed to load data')
          setIsLoading(false)
        })
    }
  }, [isLive, entityType, entityId])

  // Render entity-specific preview content
  const renderPreviewContent = (data: Record<string, any> | null) => {
    if (!data) return null

    switch (entityType) {
      case 'asset':
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{data.symbol}</span>
              {data.company_name && (
                <span className="text-gray-500 text-sm truncate">{data.company_name}</span>
              )}
            </div>
            {data.sector && (
              <div className="text-xs text-gray-500">{data.sector} • {data.industry}</div>
            )}
            <div className="flex items-center gap-3 text-sm">
              {data.priority && (
                <span className={clsx(
                  'px-1.5 py-0.5 rounded text-xs font-medium',
                  data.priority === 'high' ? 'bg-red-100 text-red-700' :
                  data.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-700'
                )}>
                  {data.priority}
                </span>
              )}
              {data.process_stage && (
                <span className="text-gray-500 text-xs">{data.process_stage}</span>
              )}
            </div>
          </div>
        )

      case 'portfolio':
        return (
          <div className="space-y-1">
            <div className="font-semibold">{data.name}</div>
            {data.description && (
              <div className="text-sm text-gray-500 line-clamp-2">{data.description}</div>
            )}
          </div>
        )

      case 'theme':
        return (
          <div className="space-y-1">
            <div className="font-semibold">{data.name}</div>
            {data.description && (
              <div className="text-sm text-gray-500 line-clamp-2">{data.description}</div>
            )}
          </div>
        )

      case 'note':
        return (
          <div className="space-y-1">
            <div className="font-semibold">{data.title}</div>
            <div className="flex items-center gap-2 text-xs">
              {data.note_type && (
                <span className="px-1.5 py-0.5 bg-gray-100 rounded">{data.note_type}</span>
              )}
            </div>
            {data.content_preview && (
              <div className="text-sm text-gray-500 line-clamp-2">{data.content_preview}</div>
            )}
          </div>
        )

      case 'workflow':
        return (
          <div className="space-y-1">
            <div className="font-semibold">{data.name}</div>
            {data.status && (
              <span className={clsx(
                'px-1.5 py-0.5 rounded text-xs font-medium',
                data.status === 'active' ? 'bg-green-100 text-green-700' :
                data.status === 'paused' ? 'bg-amber-100 text-amber-700' :
                'bg-gray-100 text-gray-700'
              )}>
                {data.status}
              </span>
            )}
          </div>
        )

      case 'project':
        return (
          <div className="space-y-1">
            <div className="font-semibold">{data.name}</div>
            {data.status && (
              <span className={clsx(
                'px-1.5 py-0.5 rounded text-xs font-medium',
                data.status === 'active' ? 'bg-green-100 text-green-700' :
                data.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-700'
              )}>
                {data.status}
              </span>
            )}
            {data.description && (
              <div className="text-sm text-gray-500 line-clamp-2">{data.description}</div>
            )}
          </div>
        )

      case 'price_target':
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              {data.bear_target && (
                <div className="text-center">
                  <div className="text-xs text-gray-500">Bear</div>
                  <div className="font-semibold text-red-600">${data.bear_target}</div>
                </div>
              )}
              {data.base_target && (
                <div className="text-center">
                  <div className="text-xs text-gray-500">Base</div>
                  <div className="font-semibold text-gray-700">${data.base_target}</div>
                </div>
              )}
              {data.bull_target && (
                <div className="text-center">
                  <div className="text-xs text-gray-500">Bull</div>
                  <div className="font-semibold text-green-600">${data.bull_target}</div>
                </div>
              )}
            </div>
            {data.timeframe && (
              <div className="text-xs text-gray-500">{data.timeframe}</div>
            )}
          </div>
        )

      case 'workflow_item':
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckSquare className={clsx(
                'h-4 w-4',
                data.is_completed ? 'text-green-600' : 'text-gray-400'
              )} />
              <span className={clsx(
                'font-medium',
                data.is_completed && 'line-through text-gray-500'
              )}>
                {data.title}
              </span>
            </div>
            {data.description && (
              <div className="text-sm text-gray-500 line-clamp-2">{data.description}</div>
            )}
          </div>
        )

      default:
        return (
          <div className="font-semibold">{entityDisplay}</div>
        )
    }
  }

  // Calculate diff between snapshot and live data
  const renderDiff = () => {
    if (!snapshotData || !liveData) return null

    const changes: Array<{ field: string; old: any; new: any }> = []

    Object.keys(snapshotData).forEach(key => {
      if (snapshotData[key] !== liveData[key]) {
        changes.push({
          field: key,
          old: snapshotData[key],
          new: liveData[key]
        })
      }
    })

    if (changes.length === 0) {
      return (
        <div className="text-xs text-green-600 mt-2 flex items-center gap-1">
          <CheckSquare className="h-3 w-3" />
          No changes since snapshot
        </div>
      )
    }

    return (
      <div className="mt-2 space-y-1">
        <div className="text-xs text-amber-600 font-medium">
          {changes.length} change{changes.length > 1 ? 's' : ''} since snapshot
        </div>
        {isExpanded && (
          <div className="text-xs space-y-1 bg-amber-50 rounded p-2">
            {changes.map(({ field, old, new: newVal }) => (
              <div key={field} className="flex items-center gap-2">
                <span className="text-gray-500">{field}:</span>
                <span className="line-through text-red-500">{String(old)}</span>
                <span className="text-gray-400">→</span>
                <span className="text-green-600">{String(newVal)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'rounded-lg border transition-all',
        config.borderColor,
        config.bgColor,
        selected && 'ring-2 ring-primary-500',
        'group'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-inherit">
        <div className="flex items-center gap-2">
          <div className={clsx('p-1 rounded', config.textColor)}>
            <Icon className="h-4 w-4" />
          </div>
          <span className={clsx('text-xs font-medium', config.textColor)}>
            {config.label}
          </span>
          {isLive ? (
            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
              <RefreshCw className="h-3 w-3" />
              Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
              <Clock className="h-3 w-3" />
              Snapshot
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onNavigate && (
            <button
              onClick={onNavigate}
              className="p-1 hover:bg-white/50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Open"
            >
              <ExternalLink className="h-3.5 w-3.5 text-gray-500" />
            </button>
          )}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="p-1 hover:bg-white/50 rounded"
            >
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-gray-500" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        ) : (
          <>
            {renderPreviewContent(isLive ? liveData : snapshotData)}
            {!isLive && snapshotAt && (
              <div className="mt-2 text-xs text-gray-500">
                Captured {new Date(snapshotAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit'
                })}
              </div>
            )}
            {!isLive && renderDiff()}
          </>
        )}
      </div>
    </div>
  )
}

export default EntityCaptureCard
