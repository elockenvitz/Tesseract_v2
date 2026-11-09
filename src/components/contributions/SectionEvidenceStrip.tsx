/**
 * The research behind ONE Investment Case section.
 *
 * ── What it claims, and what it refuses to claim ─────────────────────────
 *
 * An attached note means "I considered this while writing this section". It is
 * never a claim that the section is correct, and nothing here infers a
 * relationship from a matching ticker or similar wording — a link exists only
 * because its author made it.
 *
 * Evidence is kept visually distinct from the analyst's own prose: the writing
 * is the section's content, this is a quiet strip beneath it.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *
 * Reading: nothing at all when there is no evidence, a compact row of chips
 * when there is. It must not turn a section into a dashboard.
 * Editing: the same chips, each removable, plus a picker over the research
 * notes this asset already has. It creates no notes and stores no new copy of
 * one — it records a reference and links back to the original.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { FileText, Plus, X, ExternalLink } from 'lucide-react'
import { useSectionEvidence, type SectionEvidence } from '../../hooks/useSectionEvidence'
import { useAssetResearchNotes } from '../../hooks/useAssetResearchNotes'

interface Props {
  assetId: string
  /** The section key exactly as the contribution uses it — never normalised,
   *  or the evidence would hang off a different row than the section writes. */
  section: string
  /** The viewer owns this section (it is their own case). Attach/remove is
   *  offered only then; the author-only write policy enforces it regardless. */
  isOwn: boolean
  /** Editing shows the picker; reading shows chips only. */
  editing?: boolean
  /** Open the original note, through the caller's existing navigation. */
  onOpenNote?: (noteId: string) => void
  /** The section's own last-written time, so "arrived after you wrote this"
   *  can be stated as a fact rather than inferred. */
  sectionUpdatedAt?: string | null
  /**
   * Render THESE references instead of reading the viewer's own row.
   *
   * Required in read mode. The hook deliberately reads the VIEWER's
   * contribution, so without this another analyst's section would be shown
   * under the reader's own evidence — their prose, somebody else's sources.
   */
  items?: SectionEvidence[]
  className?: string
}

const chip = 'inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300'

export function SectionEvidenceStrip({
  assetId, section, isOwn, editing = false, onOpenNote, sectionUpdatedAt, items, className,
}: Props) {
  /* The hook only runs when this strip is the EDITOR's own — read mode is fed
     the displayed contribution's own references through `items`. */
  const own = useSectionEvidence(assetId, section, isOwn && editing)
  const evidence = items ?? own.evidence
  const { attach, detach, isSaving } = own
  const [picking, setPicking] = useState(false)
  // Only read the asset's notes when the picker is actually open.
  const { notes } = useAssetResearchNotes(picking ? assetId : '')

  const attachedIds = new Set(evidence.map(e => e.id).filter(Boolean))
  const available = (notes ?? []).filter(a => !attachedIds.has(a.id))

  if (!editing && evidence.length === 0) return null

  return (
    <div className={clsx('flex flex-col gap-1.5', className)} data-testid="section-evidence">
      <div className="flex flex-wrap items-center gap-1.5">
        {evidence.length > 0 && (
          <span className="text-xs text-gray-500">
            Evidence <span className="tabular-nums">{evidence.length}</span>
          </span>
        )}

        {evidence.map(e => (
          <span key={`${e.type}-${e.id ?? e.title}`} className={chip}>
            <FileText className="h-3 w-3 shrink-0 text-gray-400" />
            {e.id && onOpenNote ? (
              <button
                type="button"
                onClick={() => onOpenNote(e.id!)}
                className="min-w-0 truncate hover:underline"
                title={`Open ${e.title}`}
              >
                {e.title}
              </button>
            ) : e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">
                {e.title}
                <ExternalLink className="ml-1 inline h-3 w-3 opacity-60" />
              </a>
            ) : (
              <span className="min-w-0 truncate">{e.title}</span>
            )}
            {editing && isOwn && (
              <button
                type="button"
                onClick={() => detach({ type: e.type, id: e.id })}
                disabled={isSaving}
                aria-label={`Remove ${e.title}`}
                className="shrink-0 rounded text-gray-400 hover:text-gray-700 disabled:opacity-50 dark:hover:text-gray-200"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}

        {editing && isOwn && (
          <button
            type="button"
            onClick={() => setPicking(v => !v)}
            aria-expanded={picking}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 dark:border-white/15 dark:text-gray-400 dark:hover:bg-white/[0.04]"
          >
            <Plus className="h-3 w-3" />
            Attach research
          </button>
        )}
      </div>

      {editing && isOwn && picking && (
        <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 dark:border-white/10 dark:bg-[#141a25]">
          {available.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-gray-500">
              {(notes ?? []).length === 0
                ? 'No research notes on this asset yet.'
                : 'Every research note on this asset is already attached.'}
            </p>
          ) : (
            available.map(a => {
              /* A plain timestamp comparison — not a judgement that the note
                 challenges or supports what is written. */
              const isNewer = !!sectionUpdatedAt && a.updatedAt > sectionUpdatedAt
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={isSaving}
                  onClick={() => attach({
                    type: 'note', id: a.id, title: a.title || 'Untitled note',
                    addedAt: new Date().toISOString(),
                  })}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-white/[0.04]"
                >
                  <FileText className="h-3 w-3 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                    {a.title || 'Untitled note'}
                  </span>
                  {isNewer && (
                    <span className="shrink-0 rounded bg-amber-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      new
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums text-gray-400">
                    {new Date(a.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
