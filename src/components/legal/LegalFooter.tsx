/**
 * The legal footer: links to the documents, plus the one disclosure that has
 * to be visible without a click.
 *
 * ── Why this is a component and not markup in six places ────────────────
 *
 * Six auth pages share `AuthLayout`. Pasting links into each would be six
 * places for the next document to be forgotten, and the links are generated
 * from `LEGAL_DOCUMENTS` so a document added to the registry appears here
 * without anyone remembering to add it.
 *
 * ── What is in the footer text itself ───────────────────────────────────
 *
 * One line: Tesseract is software, not an investment adviser. It is in the
 * footer rather than only inside a document because the footer is the only
 * part a visitor reliably sees, and because "software, not advice" is the
 * statement whose absence would be most costly if a user later said they
 * relied on the product as advice.
 *
 * Everything else stays behind a link. A footer that tries to be a disclosure
 * page is a footer nobody reads, which defeats the point of having one.
 */

import { Link } from 'react-router-dom'
import { LEGAL_DOCUMENTS, legalPath } from '../../legal/documents'

interface LegalFooterProps {
  /** Compact drops the disclosure line, for a tight surface such as a modal
   *  footer, and keeps the links. Used nowhere yet; the prop exists so the
   *  next caller does not inline its own copy. */
  compact?: boolean
  className?: string
}

export function LegalFooter({ compact = false, className = '' }: LegalFooterProps) {
  return (
    <footer
      data-testid="legal-footer"
      className={`text-center text-xs leading-relaxed text-gray-500 dark:text-gray-400 ${className}`}
    >
      {!compact && (
        <p className="mx-auto max-w-sm" data-testid="legal-footer-disclosure">
          Tesseract is research and workflow software. It is not an investment
          adviser or a broker-dealer, it gives no investment advice, and it
          places no orders.
        </p>
      )}

      <nav aria-label="Legal" className={compact ? '' : 'mt-3'}>
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {LEGAL_DOCUMENTS.map(doc => (
            <li key={doc.id}>
              <Link
                to={legalPath(doc.id)}
                title={doc.summary}
                className="hover:text-gray-900 hover:underline dark:hover:text-gray-200"
              >
                {FOOTER_LABELS[doc.id] ?? doc.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  )
}

/**
 * Shorter labels for the footer.
 *
 * A footer with "Cookie and Local Storage Notice" in it wraps onto three lines
 * on a phone. The full titles stay on the document and in the `title`
 * attribute, so nothing is hidden; this is a layout decision, which is what
 * "look and feel" means in this repository.
 *
 * Keyed by id and falling back to the title, so a new document gets a working
 * link rather than nothing.
 */
const FOOTER_LABELS: Record<string, string> = {
  'terms-of-use': 'Terms of Use',
  'privacy-policy': 'Privacy',
  'cookie-notice': 'Cookies',
  'financial-ai-disclosures': 'Disclosures',
  'application-terms': 'Application Terms',
}

export default LegalFooter
