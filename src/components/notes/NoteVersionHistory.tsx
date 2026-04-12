import React, { useState, useCallback, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { RotateCcw, Eye, Pin, X, Copy, Clock, ChevronDown, ChevronRight } from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { useNoteVersions, type NoteType, type NoteVersion } from '../../hooks/useNoteVersions'
import { useToast } from '../common/Toast'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'
import { stripHtml } from '../../utils/stripHtml'

// ── Helpers ──────────────────────────────────────────────────

const getCharCount = (content: string | null): number => {
  if (!content) return 0
  return stripHtml(content).trim().length
}

const formatCharCount = (count: number): string =>
  count >= 1000 ? `${(count / 1000).toFixed(1)}k chars` : `${count} chars`

/** Human-friendly timestamp: "Today 8:05 PM", "Yesterday 3:12 PM", "Feb 18 2:30 PM" */
const friendlyTimestamp = (dateStr: string): string => {
  const d = new Date(dateStr)
  const time = format(d, 'h:mm a')
  if (isToday(d)) return `Today ${time}`
  if (isYesterday(d)) return `Yesterday ${time}`
  return format(d, 'MMM d') + ' ' + time
}

/** Group key: "today" | "yesterday" | "Feb 18" | "Feb 10" etc. */
const groupKey = (dateStr: string): string => {
  const d = new Date(dateStr)
  if (isToday(d)) return 'today'
  if (isYesterday(d)) return 'yesterday'
  return format(d, 'MMM d')
}

const groupLabel = (key: string): string => {
  if (key === 'today') return 'Today'
  if (key === 'yesterday') return 'Yesterday'
  return key
}

const reasonLabel = (reason: string): string => {
  switch (reason) {
    case 'auto': return 'Auto-saved'
    case 'manual': return 'Saved'
    case 'restore': return 'Before restore'
    case 'checkpoint': return 'Checkpoint'
    default: return reason
  }
}

// ── Types ────────────────────────────────────────────────────

interface NoteVersionHistoryProps {
  noteId: string
  noteType: NoteType
  isOpen: boolean
  onClose: () => void
  onRestore?: (version: NoteVersion) => void
  /** Called to create a checkpoint from the parent (captures current editor state) */
  onCreateCheckpoint?: (label: string) => Promise<void>
}

// ── Component ────────────────────────────────────────────────

export function NoteVersionHistory({
  noteId,
  noteType,
  isOpen,
  onClose,
  onRestore,
  onCreateCheckpoint,
}: NoteVersionHistoryProps) {
  const {
    versions,
    isLoading,
    restoreVersion,
    isRestoring,
    getVersionAuthor,
    fetchVersionContent,
  } = useNoteVersions(noteId, noteType)

  const toast = useToast()

  const [previewVersion, setPreviewVersion] = useState<NoteVersion | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const [focusedVersionId, setFocusedVersionId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreModalRef = useRef<HTMLDivElement>(null)

  // Checkpoint creation state
  const [showCheckpointInput, setShowCheckpointInput] = useState(false)
  const [checkpointLabel, setCheckpointLabel] = useState('')
  const [isCreatingCheckpoint, setIsCreatingCheckpoint] = useState(false)

  // Load content for preview
  const handlePreview = useCallback(async (version: NoteVersion | null) => {
    if (!version) {
      setPreviewVersion(null)
      setPreviewContent(null)
      return
    }
    setPreviewVersion(version)
    setIsLoadingContent(true)
    try {
      const content = await fetchVersionContent(version.id)
      setPreviewContent(content)
    } catch {
      setPreviewContent(null)
    } finally {
      setIsLoadingContent(false)
    }
  }, [fetchVersionContent])

  // Restore handler with toast + undo
  const handleRestore = useCallback(async (version: NoteVersion) => {
    try {
      const result = await restoreVersion({
        versionId: version.id,
        noteId,
        noteType,
      })
      onRestore?.(version)
      setConfirmRestoreId(null)
      setPreviewVersion(null)
      setPreviewContent(null)

      // Toast with undo action
      toast.success('Restored', {
        description: `From ${friendlyTimestamp(version.created_at)}`,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await restoreVersion({
                versionId: result.backupVersionId,
                noteId,
                noteType,
              })
              onRestore?.(version)
              toast.info('Restore undone')
            } catch {
              toast.error('Failed to undo restore')
            }
          },
        },
      })
    } catch {
      toast.error('Failed to restore version')
    }
  }, [restoreVersion, noteId, noteType, onRestore, toast])

  // Save checkpoint
  const handleSaveCheckpoint = useCallback(async () => {
    if (!onCreateCheckpoint) return
    setIsCreatingCheckpoint(true)
    try {
      await onCreateCheckpoint(checkpointLabel.trim())
      setCheckpointLabel('')
      setShowCheckpointInput(false)
      toast.success('Checkpoint saved')
    } catch {
      toast.error('Failed to save checkpoint')
    } finally {
      setIsCreatingCheckpoint(false)
    }
  }, [onCreateCheckpoint, checkpointLabel, toast])

  // Copy preview content
  const handleCopyContent = useCallback(async () => {
    if (!previewContent) return
    const plain = stripHtml(previewContent).trim()
    await navigator.clipboard.writeText(plain)
    toast.info('Content copied')
  }, [previewContent, toast])

  // Toggle group collapse
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Scroll focused version into view
  useEffect(() => {
    if (focusedVersionId && listRef.current) {
      const el = listRef.current.querySelector(`[data-version-id="${focusedVersionId}"]`)
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [focusedVersionId])

  // Auto-focus restore modal when opened
  useEffect(() => {
    if (confirmRestoreId && restoreModalRef.current) {
      const cancel = restoreModalRef.current.querySelector<HTMLButtonElement>('button[data-action="cancel"]')
      cancel?.focus()
    }
  }, [confirmRestoreId])

  if (!isOpen) return null

  // ── Partition: pinned checkpoints vs regular versions ──
  const pinned = versions.filter(v => v.is_pinned)
  const regular = versions.filter(v => !v.is_pinned)

  // Group regular versions by day
  const grouped: { key: string; label: string; versions: NoteVersion[] }[] = []
  const seen = new Map<string, NoteVersion[]>()
  for (const v of regular) {
    const k = groupKey(v.created_at)
    if (!seen.has(k)) {
      seen.set(k, [])
    }
    seen.get(k)!.push(v)
  }
  for (const [k, vs] of seen) {
    grouped.push({ key: k, label: groupLabel(k), versions: vs })
  }

  // ── Render helpers ──

  const renderVersionRow = (version: NoteVersion, isLatest: boolean) => {
    const isSelected = previewVersion?.id === version.id
    const isFocused = focusedVersionId === version.id
    const isCheckpoint = version.version_reason === 'checkpoint'
    const author = getVersionAuthor(version)

    return (
      <div
        key={version.id}
        data-version-id={version.id}
        className={clsx(
          'px-4 py-2.5 cursor-pointer transition-colors group',
          isSelected
            ? 'bg-primary-50/80 border-l-2 border-l-primary-400'
            : isFocused
              ? 'bg-gray-50 border-l-2 border-l-gray-300'
              : 'hover:bg-gray-50/80 border-l-2 border-l-transparent',
        )}
        onClick={() => { setFocusedVersionId(version.id); handlePreview(isSelected ? null : version) }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Primary: timestamp */}
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-gray-900 leading-tight">
                {friendlyTimestamp(version.created_at)}
              </span>
              {isLatest && !isSelected && (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-1.5 py-px rounded">
                  Latest
                </span>
              )}
              {isCheckpoint && version.label && (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-px rounded flex items-center gap-0.5">
                  <Pin className="w-2.5 h-2.5" />
                  {version.label}
                </span>
              )}
            </div>

            {/* Secondary: reason + author */}
            <span className="text-[11px] text-gray-400 leading-tight block mt-0.5">
              {reasonLabel(version.version_reason)}
              {author && <> &middot; {author}</>}
            </span>
          </div>

          {/* Actions */}
          <div className={clsx(
            'flex items-center gap-0.5 transition-opacity flex-shrink-0',
            isSelected || isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}>
            <button
              onClick={(e) => { e.stopPropagation(); handlePreview(isSelected ? null : version) }}
              className={clsx(
                'p-1 rounded transition-colors',
                isSelected ? 'bg-primary-100 text-primary-600' : 'hover:bg-gray-100 text-gray-400'
              )}
              title="Preview"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmRestoreId(version.id) }}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
              title="Restore this version"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      <div className="absolute right-0 top-0 h-full w-[420px] bg-white shadow-2xl flex flex-col">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-500" />
            <h2 className="text-[14px] font-semibold text-gray-900">Saved versions</h2>
            {versions.length > 0 && (
              <span className="text-[10px] text-gray-400 tabular-nums">({versions.length})</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onCreateCheckpoint && (
              <button
                onClick={() => setShowCheckpointInput(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors"
                title="Save a named checkpoint"
              >
                <Pin className="w-3 h-3" />
                Checkpoint
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Checkpoint creation inline ── */}
        {showCheckpointInput && (
          <div className="px-4 py-2.5 border-b border-gray-100 bg-amber-50/30 flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={checkpointLabel}
                onChange={(e) => setCheckpointLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCheckpoint()
                  if (e.key === 'Escape') { setShowCheckpointInput(false); setCheckpointLabel('') }
                }}
                placeholder="e.g. Earnings call start"
                className="flex-1 px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                autoFocus
              />
              <Button
                size="sm"
                onClick={handleSaveCheckpoint}
                disabled={isCreatingCheckpoint}
              >
                {isCreatingCheckpoint ? 'Saving\u2026' : 'Save'}
              </Button>
              <button
                onClick={() => { setShowCheckpointInput(false); setCheckpointLabel('') }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Version list ── */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto focus:outline-none"
          tabIndex={0}
          onKeyDown={(e) => {
            // Build flat navigable list in render order
            const navIds: string[] = []
            pinned.forEach(v => navIds.push(v.id))
            grouped.forEach(g => {
              if (!collapsedGroups.has(g.key)) {
                g.versions.forEach(v => navIds.push(v.id))
              }
            })
            if (navIds.length === 0) return

            const currentIdx = focusedVersionId ? navIds.indexOf(focusedVersionId) : -1

            if (e.key === 'ArrowDown' || e.key === 'j') {
              e.preventDefault()
              const next = currentIdx < navIds.length - 1 ? currentIdx + 1 : 0
              setFocusedVersionId(navIds[next])
            } else if (e.key === 'ArrowUp' || e.key === 'k') {
              e.preventDefault()
              const prev = currentIdx > 0 ? currentIdx - 1 : navIds.length - 1
              setFocusedVersionId(navIds[prev])
            } else if (e.key === 'Enter') {
              if (focusedVersionId) {
                const v = versions.find(ver => ver.id === focusedVersionId)
                if (v) handlePreview(previewVersion?.id === v.id ? null : v)
              }
            } else if (e.key === 'r' && focusedVersionId) {
              e.preventDefault()
              setConfirmRestoreId(focusedVersionId)
            }
          }}
        >
          {isLoading ? (
            <div className="px-4 py-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-gray-50 rounded animate-pulse" />
              ))}
            </div>
          ) : versions.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Clock className="h-8 w-8 mx-auto mb-2 text-gray-200" />
              <p className="text-[13px] font-medium text-gray-500">No saved versions yet</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Versions are created automatically as you edit.</p>
            </div>
          ) : (
            <>
              {/* Pinned checkpoints */}
              {pinned.length > 0 && (
                <div className="border-b border-gray-100">
                  <div className="px-4 pt-2.5 pb-1">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-amber-600/70 flex items-center gap-1">
                      <Pin className="w-2.5 h-2.5" />
                      Checkpoints
                    </span>
                  </div>
                  {pinned.map((v) => renderVersionRow(v, versions[0]?.id === v.id))}
                </div>
              )}

              {/* Grouped regular versions */}
              {grouped.map((group, groupIdx) => {
                const isCollapsed = collapsedGroups.has(group.key)
                return (
                  <div key={group.key} className="border-b border-gray-100/80">
                    <button
                      onClick={() => toggleGroup(group.key)}
                      className="w-full px-4 py-2 flex items-center gap-1.5 text-left hover:bg-gray-50/50 transition-colors"
                    >
                      {isCollapsed
                        ? <ChevronRight className="w-3 h-3 text-gray-400" />
                        : <ChevronDown className="w-3 h-3 text-gray-400" />
                      }
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        {group.label}
                      </span>
                      <span className="text-[10px] text-gray-300 tabular-nums">
                        {group.versions.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div>
                        {group.versions.map((v) => renderVersionRow(v, versions[0]?.id === v.id))}
                        {/* Helper text when very few versions exist */}
                        {groupIdx === 0 && regular.length <= 2 && pinned.length === 0 && (
                          <p className="px-4 py-2 text-[11px] text-gray-400 italic">
                            Versions are saved automatically as you edit. Pin important snapshots as checkpoints.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* ── Preview panel ── */}
        {previewVersion && (
          <div className="border-t border-gray-200 bg-white flex-shrink-0" style={{ height: '40%' }}>
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50/80 border-b border-gray-100">
              <div className="min-w-0 flex-1">
                <h3 className="text-[12px] font-semibold text-gray-900 truncate">
                  <span className="text-gray-400 font-normal">Previewing:</span>{' '}
                  {friendlyTimestamp(previewVersion.created_at)}
                  {previewVersion.label && (
                    <span className="text-gray-400 font-normal"> &middot; {previewVersion.label}</span>
                  )}
                </h3>
                <p className="text-[10px] text-gray-400">
                  {reasonLabel(previewVersion.version_reason)}
                  {previewContent && ` \u00b7 ${formatCharCount(getCharCount(previewContent))}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={handleCopyContent}
                  disabled={!previewContent}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors disabled:opacity-30"
                  title="Copy as plain text"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmRestoreId(previewVersion.id)}
                  disabled={isLoadingContent}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Restore
                </Button>
                <button
                  onClick={() => handlePreview(null)}
                  className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto" style={{ height: 'calc(100% - 48px)' }}>
              {isLoadingContent ? (
                <div className="flex items-center justify-center py-6">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-400 border-t-transparent" />
                  <span className="ml-2 text-[12px] text-gray-400">Loading\u2026</span>
                </div>
              ) : previewContent ? (
                <>
                  <h4 className="text-[14px] font-semibold text-gray-900 mb-2 pb-1.5 border-b border-gray-100">
                    {previewVersion.title}
                  </h4>
                  <div
                    className="prose prose-sm max-w-none text-gray-700 text-[13px]"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewContent) }}
                  />
                </>
              ) : (
                <p className="text-[12px] text-gray-400 italic py-4">No content in this version</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Restore confirmation modal ── */}
      {confirmRestoreId && (() => {
        const targetVersion = versions.find(v => v.id === confirmRestoreId)
        if (!targetVersion) return null
        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); setConfirmRestoreId(null) }
              if (e.key === 'Tab') {
                const focusable = e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
                if (focusable.length === 0) return
                const first = focusable[0]
                const last = focusable[focusable.length - 1]
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault(); last.focus()
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault(); first.focus()
                }
              }
            }}
          >
            <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmRestoreId(null)} />
            <div ref={restoreModalRef} className="relative bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-5">
              <h3 className="text-[15px] font-semibold text-gray-900">Restore this version?</h3>
              <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed">
                Your current note will be saved as a backup before restoring. You can undo immediately after.
              </p>
              <p className="text-[11px] text-gray-400 mt-2 bg-gray-50 rounded px-2.5 py-1.5">
                Restoring from: {friendlyTimestamp(targetVersion.created_at)}
                {targetVersion.label && <> &middot; {targetVersion.label}</>}
              </p>
              <div className="flex items-center justify-end gap-2 mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRestoreId(null)}
                  data-action="cancel"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleRestore(targetVersion)}
                  disabled={isRestoring}
                >
                  {isRestoring ? 'Restoring\u2026' : 'Restore'}
                </Button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
