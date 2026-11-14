/**
 * What the answer rests on. One section, per message.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 *
 * A research trail of every lookup, plus a separate citations list of quoted
 * documents. The same record could appear in both, under two headings, and a
 * reader had no way to tell whether that was one record or two, or whether
 * "consulted" and "quoted" meant the same thing.
 *
 * ── The shape of the fix ────────────────────────────────────────────────
 *
 * Records are the list. Each one says whether it was quoted or merely
 * consulted, so the distinction that justified two sections survives without
 * two sections. The lookups become one quiet provenance line underneath:
 * still there, because a failed lookup changes what a reader should believe,
 * but no longer the headline. "What is this based on" is a question about
 * records; a list of function calls answers a different one.
 *
 * ── Why it stopped looking like diagnostics ─────────────────────────────
 *
 * The old trail led with the machine's actions in tiny uppercase, counted
 * lookups rather than sources, and bordered every row by status. This leads
 * with the record's title, gives the type a single quiet chip, and keeps
 * colour for the one thing colour should mean here: something failed.
 */
import { useState } from 'react'
import { ChevronRight, FileText, Quote, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { SourceRef } from './ResearchTrail'
import {
  consolidateEvidence,
  evidenceHeading,
  lookupSummary,
  type EvidenceRecord,
} from '../../lib/ai/evidence'
import type {
  AiSourceRef,
  MessageCitation,
  MessageToolCall,
} from '../../lib/ai/presentation'

export interface AiEvidenceProps {
  toolCalls?: readonly MessageToolCall[] | null
  citations?: readonly MessageCitation[] | null
  /** Open on first render. A briefing does; a chat reply folds it away. */
  defaultOpen?: boolean
  onOpenSource?: (source: AiSourceRef) => void
  className?: string
}

export function AiEvidence({
  toolCalls, citations, defaultOpen = false, onOpenSource, className,
}: AiEvidenceProps) {
  const [open, setOpen] = useState(defaultOpen)
  const evidence = consolidateEvidence({ toolCalls, citations })

  if (evidence.isEmpty) return null

  const summary = lookupSummary(evidence)

  return (
    <div
      data-testid="ai-evidence"
      className={clsx('mt-3 border-t border-gray-200 pt-2 dark:border-gray-700/60', className)}
    >
      {/*
        The warning sits BESIDE the toggle rather than inside it.
        Inside, its own label joined the button's name, which came out as
        "1 sourceA lookup failed, so the answer may be incomplete" -- the
        same two things welded together that this pass is here to fix. It is
        still on the same line and still visible without opening the section,
        which is the behaviour it exists for.
      */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600
                     hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          aria-expanded={open}
          title={open ? 'Hide sources' : 'Show sources'}
        >
          {/* Decorative, and hidden for the reason given in `AiMessage`: with
              both icons part of the name, this control read as "svg3 sources
              svg" to anything that flattens it to text. */}
          <FileText className="h-3 w-3" aria-hidden="true" />
          <span data-testid="ai-evidence-heading">{evidenceHeading(evidence)}</span>
          <ChevronRight
            className={clsx('h-3 w-3 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
        </button>
        {/*
          The only thing that gets colour at this level. A failed lookup means
          the answer may be missing something, which is the reader's call to
          make and so has to be visible without opening the section.
        */}
        {evidence.failedCount > 0 && (
          <span
            data-testid="ai-evidence-failed"
            className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400"
            title="A lookup failed, so the answer may be incomplete"
            /* This one carries meaning, so it is named rather than hidden:
               the colour is the whole signal and a `title` alone is a
               tooltip, not a name. The glyph inside it is then decoration. */
            role="img"
            aria-label="A lookup failed, so the answer may be incomplete"
          >
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {evidence.records.length > 0 && (
            <ul className="space-y-2">
              {evidence.records.map(record => (
                <li key={record.key}>
                  <EvidenceRow record={record} onOpenSource={onOpenSource} />
                </li>
              ))}
            </ul>
          )}

          {/*
            Provenance, kept and demoted. Each lookup's own sentence is only
            worth the reader's attention when it says something a record list
            does not -- that a lookup failed, or that it found nothing within
            their permissions -- so that is when it is shown.
          */}
          {summary && (
            <div data-testid="ai-evidence-lookups" className="space-y-0.5 pt-0.5">
              <div className="text-[10.5px] text-gray-500 dark:text-gray-500">{summary}</div>
              {evidence.lookups
                .filter(l => l.failed || (l.outcome && evidence.records.length === 0))
                .map((l, i) => (
                  <div key={i} className="text-[10.5px]">
                    <span className="text-gray-600 dark:text-gray-400">{l.label}</span>
                    {l.outcome && <span className={clsx('ml-1', l.tone)}>{l.outcome}</span>}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One record, led by its own title.
 *
 * `SourceRef` already renders the kind chip, the record's lifecycle state,
 * the date, the excerpt and the navigation, and it is the thing that knows
 * where each kind of record opens. Reusing it is what keeps a source in a
 * briefing and a source in the chat pane the same object.
 */
function EvidenceRow({
  record, onOpenSource,
}: {
  record: EvidenceRecord
  onOpenSource?: (source: AiSourceRef) => void
}) {
  /*
   * The excerpt is carried on the ref for `SourceRef` to render, but the
   * consolidated record may hold a better quotation -- an actual citation
   * rather than a generated excerpt. The first quote wins, because citations
   * are folded in after lookups and sorted ahead of them.
   */
  const ref: AiSourceRef = record.quotes.length > 0
    ? { ...record.ref, excerpt: record.quotes[0] }
    : record.ref

  return (
    <div className="text-[11px] text-gray-700 dark:text-gray-300">
      <SourceRef source={ref} onOpen={onOpenSource} />
      <div className="mt-0.5 flex items-center gap-1">
        {/*
          Quoted versus consulted, in words. This is the whole reason the two
          old sections existed: a citation says "this sentence rests on these
          words", a lookup says "I looked here". A reader who cannot tell the
          difference may take the second for the first.
        */}
        <span
          data-testid="ai-evidence-relation"
          data-relation={record.relation}
          className={clsx(
            'inline-flex items-center gap-0.5 text-[10px]',
            record.relation === 'quoted'
              ? 'text-gray-600 dark:text-gray-400'
              : 'text-gray-400 dark:text-gray-500',
          )}
        >
          {record.relation === 'quoted' && <Quote className="h-2.5 w-2.5" />}
          {record.relation === 'quoted' ? 'Quoted' : 'Consulted'}
        </span>
        {record.quotes.length > 1 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {`+${record.quotes.length - 1} more`}
          </span>
        )}
      </div>
    </div>
  )
}
