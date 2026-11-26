/**
 * The legal document index at /legal.
 *
 * One page listing every document, because a footer with five links in it
 * crowds out everything else, and because an institutional reviewer asking
 * "where are your terms" wants one address to be sent rather than five.
 *
 * When publication is off this page still renders and still lists the
 * documents by name and purpose. Naming a document that exists and is being
 * prepared is true; it is the TEXT that must not be served early, and the
 * distinction is the whole reason the two gates in `publication.ts` are
 * separate.
 */

import { Link } from 'react-router-dom'
import { FileText, Scale } from 'lucide-react'
import { LEGAL_DOCUMENTS, legalPath } from '../../legal/documents'
import { isLegalPublicationEnabled } from '../../legal/publication'
import { LegalPageShell } from './LegalPageShell'

export function LegalIndexPage() {
  const published = isLegalPublicationEnabled()

  return (
    <LegalPageShell>
      <>
        <Scale className="h-8 w-8 text-slate-300" aria-hidden="true" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Legal</h1>

        {published ? (
          <p className="mt-4 max-w-prose text-slate-600">
            The documents that govern use of this website and of the Tesseract
            application.
          </p>
        ) : (
          <p className="mt-4 max-w-prose text-slate-600" data-testid="legal-index-unpublished">
            Tesseract is pre-release and is not yet offered as a commercial
            service. The documents below are being prepared and will be
            published here before the product is generally available. If you are
            evaluating Tesseract and need them now, contact us and we will send
            them to you directly.
          </p>
        )}

        <ul className="mt-10 divide-y divide-slate-200 border-y border-slate-200">
          {LEGAL_DOCUMENTS.map(doc => (
            <li key={doc.id} data-legal-document={doc.id}>
              <Link
                to={legalPath(doc.id)}
                className="group flex items-start gap-4 py-5 hover:bg-white"
              >
                <FileText
                  className="mt-0.5 h-5 w-5 flex-none text-slate-300 group-hover:text-slate-500"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 group-hover:underline">
                    {doc.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {doc.summary}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {doc.status === 'approved' && doc.effectiveDate
                      ? `Effective ${doc.effectiveDate}`
                      : 'Draft, not in effect'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {/*
          Not a legal document, and said so plainly rather than listed above as
          though it were one. An investment firm's compliance reviewer needs to
          find this; mixing it into the list of governing documents would
          overstate what it is.
        */}
        <div className="mt-10 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Security and diligence</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            If you are reviewing Tesseract for institutional use and need a
            security questionnaire completed, a data processing agreement or a
            subprocessor list, contact us. These are provided on request rather
            than published, because they are specific to what you are
            evaluating.
          </p>
        </div>

        <div className="mt-10">
          <Link to="/" className="text-sm font-medium text-slate-900 underline">
            Back to Tesseract
          </Link>
        </div>
      </>
    </LegalPageShell>
  )
}

export default LegalIndexPage
