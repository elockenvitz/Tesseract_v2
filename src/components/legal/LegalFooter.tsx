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
import { LEGAL_DOCUMENTS, legalPath, FOOTER_LABELS } from '../../legal/documents'

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
        {/*
          ── TOUCH TARGETS, measured rather than assumed ──────────────────

          These five links rendered 21px tall at every viewport from
          1920 down to 390, including on all six authentication screens,
          which is under the 24px minimum and well under the 44px a
          thumb actually wants. They are the links a regulator and a
          cautious buyer both go looking for, so they were the worst
          five on the site to have as hairline targets.

          `inline-flex` with `min-h-[44px]` and horizontal padding gives
          the anchor a real box without changing the type size or the
          visual rhythm of the row: the gap shrinks to compensate, so
          the footer reads the same and can be hit.
        */}
        <ul className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0">
          {LEGAL_DOCUMENTS.map(doc => (
            <li key={doc.id}>
              <Link
                to={legalPath(doc.id)}
                title={doc.summary}
                className="inline-flex min-h-[44px] items-center rounded px-3 hover:text-gray-900 hover:underline dark:hover:text-gray-200"
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

export default LegalFooter
