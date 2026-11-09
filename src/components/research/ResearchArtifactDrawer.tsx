/**
 * Research artifact drawer — opens a single supporting-research artifact in a
 * right-hand contextual overlay, on top of (not replacing) the Investment Case.
 *
 * It hosts the canonical `UniversalNoteEditor` in `singleArtifact` mode, so the
 * full note capabilities (autosave, history, links, source documents, AI) are
 * reused for one artifact with no list sidebar, no note navigation, and no
 * create-on-mount. The artifact is always opened on an explicit note id.
 */
import { useCallback, useEffect } from 'react'
import { X, FlaskConical } from 'lucide-react'
import { UniversalNoteEditor } from '../notes/UniversalNoteEditor'

export interface ResearchArtifactDrawerProps {
  assetId: string
  assetName: string
  noteId: string
  onClose: () => void
  onNoteSelect: (noteId: string) => void
}

export function ResearchArtifactDrawer({ assetId, assetName, noteId, onClose, onNoteSelect }: ResearchArtifactDrawerProps) {
  // Esc closes the drawer, matching the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleNoteSelect = useCallback((id: string) => { onNoteSelect(id) }, [onNoteSelect])

  return (
    <div role="dialog" aria-label="Supporting research artifact" className="fixed inset-0 z-50 flex justify-end">
      <div data-testid="research-drawer-backdrop" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-white shadow-xl dark:bg-[#141a25]">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-white/10">
          <div className="flex items-center gap-2 text-[12px] font-medium text-gray-500">
            <FlaskConical className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            Supporting research · {assetName}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close research artifact"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <UniversalNoteEditor
            entityType="asset"
            entityId={assetId}
            entityName={assetName}
            selectedNoteId={noteId}
            onNoteSelect={handleNoteSelect}
            singleArtifact
          />
        </div>
      </div>
    </div>
  )
}
