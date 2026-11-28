/**
 * One legal document, rendered from its single markdown source.
 *
 * ── Three states, and why the middle one exists ──────────────────────────
 *
 *   PUBLICATION OFF   a short "in preparation" notice. The route still works
 *                     and the page still looks finished, because a 404 behind
 *                     a footer link reads as a broken site, and a broken site
 *                     is its own kind of claim about who you are dealing with.
 *                     Nothing false is served: the notice says the documents
 *                     are being prepared, which is true.
 *
 *   PUBLICATION ON,   the text, behind an unmissable draft banner, with every
 *   DOCUMENT DRAFT    unresolved `[PLACEHOLDER]` highlighted rather than
 *                     hidden. This is the local review state.
 *
 *   PUBLICATION ON,   the text, with an effective date and a version.
 *   APPROVED
 *
 * ── Light only, deliberately ─────────────────────────────────────────────
 *
 * `tailwind.config.js` sets `darkMode: 'class'`, and a signed-out visitor has
 * no theme class on the document, so every `dark:` variant on a public page is
 * dead code that reads as support for something that does not work. This page
 * commits to one palette and states it, which is the same conclusion the
 * public landing page reached.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, ArrowLeft, FileText } from 'lucide-react'
import {
  getLegalDocument,
  legalAssetPath,
  legalPath,
  LEGAL_DOCUMENTS,
  type LegalDocument,
} from '../../legal/documents'
import { isLegalPublicationEnabled } from '../../legal/publication'
import { findUnresolvedPlaceholders, resolvePlaceholders } from '../../legal/entity'
import { LegalPageShell } from './LegalPageShell'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; text: string }
  /** The gate is on but the file is absent: `npm run legal:publish` has not
   *  been run. An operator error, shown as one rather than as a blank page. */
  | { kind: 'not_published' }
  | { kind: 'error'; detail: string }

/** Strip the front matter the publish script prepends. */
function splitFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { meta, body: raw.slice(match[0].length) }
}

/* The shell also fades the boot loader, which otherwise covers this page
   entirely -- see LegalPageShell. */
const DocumentShell = LegalPageShell

function BackToIndex() {
  return (
    <Link
      to="/legal"
      className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      All legal documents
    </Link>
  )
}

/**
 * The draft banner.
 *
 * `role="alert"` rather than a styled div: a reader using a screen reader has
 * to learn this is a draft before they read the terms, not after.
 */
function DraftBanner({ doc, placeholders }: { doc: LegalDocument; placeholders: string[] }) {
  return (
    <div
      role="alert"
      data-testid="legal-draft-banner"
      className="mb-8 rounded-lg border-2 border-amber-400 bg-amber-50 p-5"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-600" aria-hidden="true" />
        <div className="text-sm leading-relaxed text-amber-900">
          <p className="font-semibold">
            Draft. Not in effect, and not binding on anyone.
          </p>
          <p className="mt-1.5">
            This document has not been reviewed by a lawyer and has not been
            adopted. It is published here for review only. Version{' '}
            <span className="font-mono">{doc.version}</span>.
          </p>
          {/* Agreement, not decoration: the first version of this read
              "1 detail are still unresolved", on the page, in a banner whose
              whole job is to be read carefully.

              The comment sits ABOVE the guard, not inside it. A JSX comment as
              the first child of `{cond && (` is a parse error -- Babel reads
              the `{` as an object literal and fails with
              `Unexpected token, expected ","`. Written the other way first,
              and the whole lazy chunk failed to load. */}
          {placeholders.length > 0 && (
            <p className="mt-1.5">
              {placeholders.length === 1
                ? '1 detail is still unresolved and appears'
                : `${placeholders.length} details are still unresolved and appear`}{' '}
              in the text in brackets, for example{' '}
              <span className="font-mono">{placeholders[0]}</span>.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Markdown element overrides.
 *
 * ── Tables scroll instead of breaking the page ──────────────────────────
 *
 * These documents are table-heavy on purpose: the security schedule is twelve
 * status tables, the MSA's order form is one, the risk register is one. A
 * four-column table does not fit 390px, and an overflowing table does not
 * clip -- it widens the whole document, so every paragraph on the page gets a
 * horizontal scrollbar and the text runs off the side.
 *
 * Wrapping each table in its own scroll container confines the overflow to the
 * table. `-mx-4 px-4` lets the scrolled table use the page's side gutters, so
 * a wide table on a phone is readable rather than squeezed into the prose
 * column.
 *
 * NOT VERIFIED AT PHONE WIDTH. `resize_window` reports success while
 * `window.innerWidth` stays at 1920 in this environment, which is a recorded
 * limitation rather than a guess -- so this is a defensive fix based on the
 * measured table widths at desktop, and it still needs a real phone check.
 */
const MARKDOWN_COMPONENTS = {
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table {...props}>{children}</table>
    </div>
  ),
}

/** Shown when publication is off. Says nothing untrue and nothing internal. */
function InPreparation() {
  return (
    <DocumentShell>
      <div data-testid="legal-in-preparation">
        <FileText className="h-8 w-8 text-slate-300" aria-hidden="true" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          Legal documents in preparation
        </h1>
        <p className="mt-4 max-w-prose text-slate-600">
          Tesseract is pre-release and is not yet offered as a commercial
          service. Our terms, privacy policy and disclosures are being prepared
          and will be published here before the product is generally available.
        </p>
        <p className="mt-4 max-w-prose text-slate-600">
          If you are evaluating Tesseract and need these documents now, contact
          us and we will send them to you directly.
        </p>
        <div className="mt-8">
          {/* 108x19 before this, under the 24px touch minimum, and the
              only way back from a legal page. Found by running the
              touch-target check across /legal too, after fixing the
              landing and auth screens — the sweep is the reason it was
              not left behind. */}
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center text-sm font-medium text-slate-900 underline"
          >
            Back to Tesseract
          </Link>
        </div>
      </div>
    </DocumentShell>
  )
}

export function LegalDocumentPage() {
  const { documentId } = useParams<{ documentId: string }>()
  const doc = documentId ? getLegalDocument(documentId) : undefined
  const published = isLegalPublicationEnabled()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!doc || !published) return
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(legalAssetPath(doc.id), {
          headers: { Accept: 'text/markdown, text/plain' },
        })
        /*
         * A 404 here is caught by the status check, but the SPA catch-all in
         * public/_redirects answers an unknown path with index.html and a 200,
         * so a missing document would arrive as HTML rather than as an error.
         * Checking the first bytes is the only reliable signal.
         */
        if (!res.ok) {
          if (!cancelled) setState({ kind: 'not_published' })
          return
        }
        const text = await res.text()
        if (/^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
          if (!cancelled) setState({ kind: 'not_published' })
          return
        }
        if (!cancelled) setState({ kind: 'ready', text })
      } catch (err) {
        if (!cancelled) {
          setState({ kind: 'error', detail: err instanceof Error ? err.message : 'unknown' })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [doc, published])

  if (!doc) {
    return (
      <DocumentShell>
        <h1 className="text-2xl font-semibold tracking-tight">Document not found</h1>
        <p className="mt-4 text-slate-600">
          There is no legal document at this address.
        </p>
        <ul className="mt-6 space-y-2">
          {LEGAL_DOCUMENTS.map(d => (
            <li key={d.id}>
              <Link to={legalPath(d.id)} className="text-slate-900 underline">
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      </DocumentShell>
    )
  }

  if (!published) return <InPreparation />

  const { body } = state.kind === 'ready' ? splitFrontMatter(state.text) : { body: '' }
  const resolved = resolvePlaceholders(body)
  const placeholders = findUnresolvedPlaceholders(resolved).map(p => p.token)

  return (
    <DocumentShell>
      <BackToIndex />

      {state.kind === 'ready' && doc.status === 'draft' && (
        <DraftBanner doc={doc} placeholders={placeholders} />
      )}

      {state.kind === 'loading' && (
        <p className="mt-8 text-slate-500">Loading…</p>
      )}

      {state.kind === 'not_published' && (
        <div className="mt-8" data-testid="legal-not-published">
          <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          <p className="mt-4 text-slate-600">
            This document is not available right now. Please contact us and we
            will send it to you directly.
          </p>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="mt-8" data-testid="legal-load-error">
          <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          <p className="mt-4 text-slate-600">
            This document could not be loaded. Please try again, or contact us
            and we will send it to you directly.
          </p>
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          <article
            data-testid="legal-document-body"
            data-document-id={doc.id}
            data-document-version={doc.version}
            data-document-status={doc.status}
            className="prose prose-slate mt-8 max-w-none prose-headings:font-semibold prose-a:text-slate-900 prose-table:text-sm"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {resolved}
            </ReactMarkdown>
          </article>

          <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
            <p>
              Version <span className="font-mono">{doc.version}</span>
              {doc.effectiveDate
                ? ` · effective ${doc.effectiveDate}`
                : ' · not yet in effect'}
            </p>
          </footer>
        </>
      )}
    </DocumentShell>
  )
}

export default LegalDocumentPage
