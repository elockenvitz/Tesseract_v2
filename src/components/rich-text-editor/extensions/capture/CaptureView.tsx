import React, { useState, useCallback, useEffect } from 'react'
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { supabase } from '../../../../lib/supabase'
import {
  Link2, Image, Camera, ExternalLink, ChevronDown, ChevronRight,
  X, MoreHorizontal, RefreshCw, Clock, TrendingUp, Building2,
  Briefcase, FileText, ListChecks, GitBranch, FolderKanban, Target,
  CheckSquare, Globe
} from 'lucide-react'
import { clsx } from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import type { CaptureType, CaptureEntityType } from '../../../../types/capture'
import { EntityCaptureCard } from './EntityCaptureCard'

// Entity type icons and colors
const ENTITY_CONFIG: Record<CaptureEntityType, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  asset: { icon: TrendingUp, color: 'text-blue-600 bg-blue-50', label: 'Asset' },
  portfolio: { icon: Briefcase, color: 'text-emerald-600 bg-emerald-50', label: 'Portfolio' },
  theme: { icon: Building2, color: 'text-purple-600 bg-purple-50', label: 'Theme' },
  note: { icon: FileText, color: 'text-amber-600 bg-amber-50', label: 'Note' },
  list: { icon: ListChecks, color: 'text-cyan-600 bg-cyan-50', label: 'List' },
  workflow: { icon: GitBranch, color: 'text-indigo-600 bg-indigo-50', label: 'Workflow' },
  project: { icon: FolderKanban, color: 'text-pink-600 bg-pink-50', label: 'Project' },
  chart: { icon: TrendingUp, color: 'text-violet-600 bg-violet-50', label: 'Chart' },
  price_target: { icon: Target, color: 'text-red-600 bg-red-50', label: 'Price Target' },
  workflow_item: { icon: CheckSquare, color: 'text-teal-600 bg-teal-50', label: 'Task' }
}

// Capture type icons
const CAPTURE_TYPE_CONFIG: Record<CaptureType, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  entity_live: { icon: RefreshCw, label: 'Live' },
  entity_static: { icon: Clock, label: 'Snapshot' },
  screenshot: { icon: Camera, label: 'Screenshot' },
  embed: { icon: Globe, label: 'Embed' }
}

interface CaptureViewProps extends NodeViewProps {
  // Node attributes are accessed via node.attrs
}

export function CaptureView({ node, updateAttributes, deleteNode, selected }: CaptureViewProps) {
  const [localExpanded, setLocalExpanded] = useState(node.attrs.isExpanded)
  const [showMenu, setShowMenu] = useState(false)

  const {
    captureType,
    entityType,
    entityId,
    entityDisplay,
    snapshotData,
    snapshotAt,
    externalUrl,
    externalTitle,
    externalDescription,
    externalImageUrl,
    externalFaviconUrl,
    screenshotPath,
    screenshotSourceUrl,
    screenshotNotes,
    screenshotTags,
    displayTitle,
    previewWidth,
    previewHeight
  } = node.attrs

  const handleToggleExpand = useCallback(() => {
    const newExpanded = !localExpanded
    setLocalExpanded(newExpanded)
    updateAttributes({ isExpanded: newExpanded })
  }, [localExpanded, updateAttributes])

  const handleDelete = useCallback(() => {
    deleteNode()
  }, [deleteNode])

  // Screenshot URL. The node stores the storage path, never a URL: a public
  // URL would outlive the note it was embedded in and stay fetchable by
  // anyone who had ever seen it. Signed URLs expire, so we mint one per
  // mount and refresh it well before the hour is up.
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [screenshotError, setScreenshotError] = useState(false)

  useEffect(() => {
    if (!screenshotPath) {
      setScreenshotUrl(null)
      return
    }

    let cancelled = false
    let refreshTimer: ReturnType<typeof setTimeout>

    const sign = async () => {
      const { data, error } = await supabase.storage
        .from('captures')
        .createSignedUrl(screenshotPath, 3600)

      if (cancelled) return

      if (error || !data?.signedUrl) {
        setScreenshotError(true)
        setScreenshotUrl(null)
        return
      }

      setScreenshotError(false)
      setScreenshotUrl(data.signedUrl)
      // Re-sign at 50 minutes so a note left open all afternoon doesn't
      // silently turn into a broken image.
      refreshTimer = setTimeout(sign, 50 * 60 * 1000)
    }

    sign()

    return () => {
      cancelled = true
      clearTimeout(refreshTimer)
    }
  }, [screenshotPath])

  // Get entity config if this is an entity capture
  const entityConfig = entityType ? ENTITY_CONFIG[entityType as CaptureEntityType] : null
  const captureConfig = CAPTURE_TYPE_CONFIG[captureType as CaptureType]

  // Render based on capture type
  const renderContent = () => {
    switch (captureType) {
      case 'entity_live':
      case 'entity_static':
        return renderEntityCapture()
      case 'screenshot':
        return renderScreenshotCapture()
      case 'embed':
        return renderEmbedCapture()
      default:
        return <div className="text-gray-500 italic dark:text-gray-400">Unknown capture type</div>
    }
  }

  const renderEntityCapture = () => {
    if (!entityConfig || !entityType) {
      return <div className="text-gray-500 italic dark:text-gray-400">Invalid entity type</div>
    }

    return (
      <div className="relative">
        <EntityCaptureCard
          captureType={captureType as 'entity_live' | 'entity_static'}
          entityType={entityType as CaptureEntityType}
          entityId={entityId}
          entityDisplay={displayTitle || entityDisplay}
          snapshotData={snapshotData}
          snapshotAt={snapshotAt}
          isExpanded={localExpanded}
          onToggleExpand={handleToggleExpand}
          selected={selected}
        />
        {/* Delete button overlay */}
        <button
          onClick={handleDelete}
          className="absolute top-2 right-2 p-1 rounded-md hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  const renderScreenshotCapture = () => {
    const imageUrl = screenshotUrl

    return (
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-t-lg border-b border-gray-100 dark:border-gray-800 dark:bg-gray-900">
          <div className="p-1.5 rounded-md bg-violet-50 text-violet-600">
            <Camera className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 truncate dark:text-white">
                {displayTitle || 'Screenshot'}
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-100 text-violet-700">
                Screenshot
              </span>
            </div>
            {screenshotSourceUrl && (
              <a
                href={screenshotSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-0.5"
              >
                <ExternalLink className="h-3 w-3" />
                <span className="truncate">{screenshotSourceUrl}</span>
              </a>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggleExpand}
              className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition-colors dark:text-gray-400"
            >
              {localExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-md hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Expanded content */}
        {localExpanded && (
          <div className="p-4 bg-white rounded-b-lg dark:bg-gray-800">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={displayTitle || 'Screenshot'}
                className="max-w-full rounded-lg border border-gray-200 dark:border-gray-700"
                style={{ maxWidth: previewWidth, maxHeight: previewHeight }}
              />
            ) : (
              <div className="flex items-center gap-2 px-3 py-6 justify-center rounded-lg border border-dashed border-gray-200 text-xs text-gray-400 dark:border-gray-700">
                {screenshotError ? (
                  <>
                    <X className="h-3.5 w-3.5" />
                    Screenshot unavailable
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Loading screenshot…
                  </>
                )}
              </div>
            )}
            {screenshotNotes && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{screenshotNotes}</p>
            )}
            {screenshotTags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {screenshotTags.map((tag: string, i: number) => (
                  <span key={i} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded dark:text-gray-400 dark:bg-gray-800">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderEmbedCapture = () => {
    return (
      <div className="flex flex-col">
        {/* Link preview card */}
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all overflow-hidden dark:border-gray-700 dark:bg-gray-800"
        >
          {/* Image */}
          {externalImageUrl && (
            <div className="w-32 h-24 flex-shrink-0 bg-gray-100 dark:bg-gray-800">
              <img
                src={externalImageUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 p-3 min-w-0">
            <div className="flex items-start gap-2">
              {externalFaviconUrl && (
                <img src={externalFaviconUrl} alt="" className="w-4 h-4 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-gray-900 truncate dark:text-white">
                  {externalTitle || displayTitle || externalUrl}
                </h4>
                {externalDescription && (
                  <p className="text-sm text-gray-500 line-clamp-2 mt-0.5 dark:text-gray-400">
                    {externalDescription}
                  </p>
                )}
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                  <Globe className="h-3 w-3" />
                  <span className="truncate">{new URL(externalUrl).hostname}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleDelete()
            }}
            className="p-2 self-start hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </a>
      </div>
    )
  }

  return (
    <NodeViewWrapper
      className={clsx(
        'capture-wrapper my-2 rounded-lg border transition-all',
        selected ? 'border-primary-300 ring-2 ring-primary-100' : 'border-gray-200 dark:border-gray-700',
        'hover:border-gray-300'
      )}
      data-drag-handle
    >
      {renderContent()}
    </NodeViewWrapper>
  )
}

export default CaptureView
