import { clsx } from 'clsx'
import { ArrowLeft, Download, FileText, Paperclip } from 'lucide-react'

/**
 * The Process's documents, as a list of documents.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 *
 * Two full-width cards, each with an 18px heading, a subtitle, and — in the
 * common case — a 2px dashed box 8rem tall containing a 48px icon and the
 * words "No templates available". Roughly 500px of surface to say that a
 * Process has no files, with the templates section, which a reader almost
 * never wants, placed ABOVE the attachments, which is what they came for.
 *
 * Attachments lead. Templates follow, as a short list, because a blank
 * template is not a document about this asset. An empty section is one
 * line, not a framed announcement.
 */

export interface ProcessDocument {
  id: string
  name: string
  /** Where it hangs: a stage id, a requirement, or null for the Process. */
  context?: string | null
  sizeBytes?: number | null
  onOpen: () => void
}

interface Props {
  attachments: readonly ProcessDocument[] | null
  templates: readonly ProcessDocument[] | null
  attachmentsLoading?: boolean
  templatesLoading?: boolean
  onBack: () => void
  backLabel: string
}

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

const size = (bytes?: number | null): string | null =>
  bytes == null ? null : bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

function DocRow({ doc, tone }: { doc: ProcessDocument; tone: 'attachment' | 'template' }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        {tone === 'attachment'
          ? <Paperclip className="h-3.5 w-3.5 flex-none text-gray-400" aria-hidden />
          : <FileText className="h-3.5 w-3.5 flex-none text-gray-400" aria-hidden />}
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-gray-900 dark:text-gray-100">{doc.name}</span>
          {(doc.context || size(doc.sizeBytes)) && (
            <span className="block truncate text-[11px] text-gray-400">
              {[doc.context, size(doc.sizeBytes)].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={doc.onOpen}
        title={`Open ${doc.name}`}
        aria-label={`Open ${doc.name}`}
        className="flex-none rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-100"
      >
        <Download className="h-4 w-4" />
      </button>
    </li>
  )
}

function Section({
  title, note, loading, docs, tone, empty,
}: {
  title: string
  note?: string
  loading?: boolean
  docs: readonly ProcessDocument[] | null
  tone: 'attachment' | 'template'
  empty: string
}) {
  return (
    <div className="border-b border-gray-200 py-3 last:border-b-0 dark:border-gray-700">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className={EYEBROW}>{title}</span>
        {docs && docs.length > 0 && (
          <span className="text-[11px] text-gray-400">{docs.length}</span>
        )}
        {note && <span className="text-[11px] text-gray-400">{note}</span>}
      </div>
      {loading ? (
        <div className="h-8 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      ) : !docs || docs.length === 0 ? (
        /* One line. The dashed 8rem box said the same thing with an icon. */
        <p className="text-[12px] text-gray-500 dark:text-gray-400">{empty}</p>
      ) : (
        <ul className={clsx('divide-y divide-gray-100 dark:divide-gray-800')}>
          {docs.map(d => <DocRow key={d.id} doc={d} tone={tone} />)}
        </ul>
      )}
    </div>
  )
}

export function ProcessDocuments({
  attachments, templates, attachmentsLoading, templatesLoading, onBack, backLabel,
}: Props) {
  return (
    <section className="min-w-0" data-testid="process-documents">
      <header className="border-b border-gray-200 pb-3 dark:border-gray-700">
        <button
          type="button"
          onClick={onBack}
          data-testid="documents-back"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </button>
        <h3 className="mt-1 text-[17px] font-semibold leading-snug text-gray-900 dark:text-gray-100">
          Documents
        </h3>
      </header>

      <Section
        title="Attached to this process"
        loading={attachmentsLoading}
        docs={attachments}
        tone="attachment"
        empty="No files are attached yet. Files are attached to a requirement, from the requirement itself."
      />

      <Section
        title="Templates"
        note="blank forms this Process offers"
        loading={templatesLoading}
        docs={templates}
        tone="template"
        empty="This Process offers no templates."
      />
    </section>
  )
}
