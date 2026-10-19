/**
 * Supporting Research — a compact, secondary surface on the Asset Page.
 *
 * This is NOT the Investment Case and NOT a second Notes application. The
 * Investment Case (ContributionSection: Business Model, Thesis, Risks …) remains
 * the canonical, primary editing experience. This surface holds *supporting*
 * material that informs the case:
 *
 *   - a compact list of research artifacts (asset_notes, note_type 'research'),
 *     each opened in a contextual drawer (ResearchArtifactDrawer) rather than an
 *     embedded full editor; and
 *   - governed source documents linked to the ASSET (files / file_links),
 *     never to an individual note.
 *
 * Research here needs no investment idea — it hangs off the asset. Opening or
 * creating an artifact connects it to the asset via object_links (ensureAssetLink).
 * Nothing is created merely by viewing this surface; artifacts are created only
 * on an explicit "New".
 */
import { useCallback, useRef, useState } from 'react'
import { FlaskConical, Plus, FileText, Paperclip, Loader2, ExternalLink, AlertCircle, ArrowLeft } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useAssetResearchNotes, useAssetResearchDocuments } from '../../hooks/useAssetResearchNotes'
import { ResearchArtifactDrawer } from './ResearchArtifactDrawer'

export interface ResearchLibraryProps {
  assetId: string
  assetName: string
  /** Obvious route back to the canonical Investment Case (optional). */
  onBackToInvestmentCase?: () => void
}

export function ResearchLibrary({ assetId, assetName, onBackToInvestmentCase }: ResearchLibraryProps) {
  const notesApi = useAssetResearchNotes(assetId)
  const docsApi = useAssetResearchDocuments(assetId)
  const [openNoteId, setOpenNoteId] = useState<string | null>(null)

  // An artifact is connected to this asset whenever it is opened or created;
  // the link upsert is idempotent.
  const onNoteSelect = useCallback((noteId: string) => {
    void notesApi.ensureAssetLink(noteId)
  }, [notesApi])

  const handleNew = useCallback(async () => {
    const id = await notesApi.createArtifact()
    if (id) setOpenNoteId(id)
  }, [notesApi])

  // Closing the drawer refreshes the list so new titles / artifacts show without
  // a remount (the editor owns persistence and invalidates only its own query).
  const handleCloseDrawer = useCallback(() => {
    setOpenNoteId(null)
    notesApi.refetch()
  }, [notesApi])

  if (!notesApi.ready) {
    return (
      <section data-testid="research-library" className="rounded-lg border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-[#141a25]">
        <Header count={null} onBackToInvestmentCase={onBackToInvestmentCase} onNew={handleNew} isCreating={false} canCreate={false} />
        <p data-testid="research-library-no-org" className="mt-3 text-[12px] text-gray-500">
          Select an organization to work on research for this asset.
        </p>
      </section>
    )
  }

  return (
    <section data-testid="research-library" className="rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[#141a25]">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-white/10">
        <Header
          count={notesApi.isLoading ? null : notesApi.notes.length}
          onBackToInvestmentCase={onBackToInvestmentCase}
          onNew={handleNew}
          isCreating={notesApi.isCreating}
          canCreate
        />
        <p className="mt-1 max-w-[70ch] text-[12px] text-gray-600 dark:text-gray-400">
          Supporting material that informs the Investment Case — not the case itself. Capture as many
          research artifacts as you need (no investment idea required); each is saved to this asset and
          opens in a side panel.
        </p>
      </div>

      <ArtifactList
        notes={notesApi.notes}
        isLoading={notesApi.isLoading}
        error={notesApi.error}
        onOpen={setOpenNoteId}
      />

      <ResearchDocuments docsApi={docsApi} />

      {openNoteId && (
        <ResearchArtifactDrawer
          assetId={assetId}
          assetName={assetName}
          noteId={openNoteId}
          onClose={handleCloseDrawer}
          onNoteSelect={onNoteSelect}
        />
      )}
    </section>
  )
}

function Header({
  count, onBackToInvestmentCase, onNew, isCreating, canCreate,
}: {
  count: number | null
  onBackToInvestmentCase?: () => void
  onNew: () => void
  isCreating: boolean
  canCreate: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <h3 className="text-[14px] font-semibold text-gray-900 dark:text-gray-100">Supporting research</h3>
        {count != null && (
          <span className="rounded-full bg-gray-100 px-2 py-[1px] text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-400">
            {count} artifact{count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {onBackToInvestmentCase && (
          <button
            type="button"
            data-testid="back-to-investment-case"
            onClick={onBackToInvestmentCase}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            <ArrowLeft className="h-3 w-3" />
            Investment Case
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            data-testid="supporting-research-new"
            onClick={onNew}
            disabled={isCreating}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            New
          </button>
        )}
      </div>
    </div>
  )
}

function ArtifactList({
  notes, isLoading, error, onOpen,
}: {
  notes: ReturnType<typeof useAssetResearchNotes>['notes']
  isLoading: boolean
  error: Error | null
  onOpen: (id: string) => void
}) {
  return (
    <div data-testid="research-artifacts" className="px-5 py-4">
      {isLoading ? (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Loading research…</p>
      ) : error ? (
        <p data-testid="research-artifacts-error" className="text-[11px] text-rose-600 dark:text-rose-400">Could not load research: {error.message}</p>
      ) : notes.length === 0 ? (
        <p data-testid="research-artifacts-empty" className="text-[12px] text-gray-500">
          No supporting research yet. Create a research artifact to capture analysis, questions, or
          source notes for this asset.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {notes.map(note => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => onOpen(note.id)}
                className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-white/[0.06]"
              >
                <FileText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-gray-100">{note.title}</span>
                  {note.contentPreview && (
                    <span className="block truncate text-[11px] text-gray-500">{note.contentPreview}</span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-gray-400">{relativeTime(note.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

/**
 * Governed source documents, linked to the ASSET.
 *
 * Reuses the files repository (org-first storage, signed URLs). The heading is
 * explicit that these are asset-level, so the connection is never implied to be
 * per-note.
 */
function ResearchDocuments({
  docsApi,
}: {
  docsApi: ReturnType<typeof useAssetResearchDocuments>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const onPick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setActionError(null)
    try {
      await docsApi.uploadAndAttach(file)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not attach that document.')
    }
  }, [docsApi])

  const open = useCallback(async (doc: (typeof docsApi.documents)[number]) => {
    setOpening(doc.linkId)
    setActionError(null)
    try {
      const url = await docsApi.getUrl(doc.file)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that document.')
    } finally {
      setOpening(null)
    }
  }, [docsApi])

  return (
    <div data-testid="research-documents" className="border-t border-gray-200 px-5 py-4 dark:border-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip className="h-3.5 w-3.5 text-gray-500" />
          <h4 className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">Source documents</h4>
          <span className="text-[11px] text-gray-500">· linked to this asset</span>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-gray-300 dark:hover:bg-white/[0.06]">
          {docsApi.isAttaching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
          {docsApi.isAttaching ? 'Attaching…' : 'Attach document'}
          <input ref={fileInputRef} type="file" className="hidden" onChange={onPick} disabled={docsApi.isAttaching} />
        </label>
      </div>

      {actionError && (
        <p data-testid="research-documents-error" className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-3 w-3" />{actionError}
        </p>
      )}

      {docsApi.isLoading ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Loading documents…</p>
      ) : docsApi.error ? (
        <p className="mt-3 text-[11px] text-rose-600 dark:text-rose-400">Could not load documents: {docsApi.error.message}</p>
      ) : docsApi.documents.length === 0 ? (
        <p data-testid="research-documents-empty" className="mt-3 text-[11px] text-gray-500">
          No source documents linked to this asset yet. Attach a file to keep it in the governed
          document store, available to the whole asset.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {docsApi.documents.map(doc => (
            <li key={doc.linkId}>
              <button
                type="button"
                onClick={() => open(doc)}
                className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-gray-100 dark:hover:bg-white/[0.06]"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{doc.file.original_name || doc.file.name}</span>
                {opening === doc.linkId
                  ? <Loader2 className="h-3 w-3 animate-spin text-gray-500" />
                  : <ExternalLink className="h-3 w-3 shrink-0 text-blue-600 opacity-0 group-hover:opacity-100" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
