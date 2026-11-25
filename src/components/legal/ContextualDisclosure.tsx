/**
 * Short disclosures shown where the thing being disclosed actually happens.
 *
 * ── Why these exist when a disclosures page already does ────────────────
 *
 * A disclosures page is where a compliance reviewer looks. It is not where a
 * portfolio manager is when an AI answer appears on screen, and "it was in the
 * terms" is a weak answer to "I thought this number was verified".
 *
 * So two one-line disclosures, placed at the point of use:
 *
 *   ai           beside AI output. Says it can be wrong and is not a
 *                recommendation.
 *   market-data  beside a price or quote. Says it is delayed, third-party,
 *                and not for trading or valuation.
 *
 * Each links to the full disclosures, so the detail is one click away and
 * nothing here tries to be the document.
 *
 * ── Deliberately small ──────────────────────────────────────────────────
 *
 * A disclosure the size of a paragraph gets collapsed, then hidden, then
 * removed by someone tidying a layout. One line survives. These are not
 * dismissible for the same reason: a disclosure with an X on it is a
 * disclosure that is absent for every user who has clicked the X once.
 */

import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { legalPath } from '../../legal/documents'
import { isLegalPublicationEnabled } from '../../legal/publication'

export type DisclosureKind = 'ai' | 'market-data'

const TEXT: Record<DisclosureKind, string> = {
  /*
   * "Not a recommendation" rather than "may be inaccurate" alone. Inaccuracy
   * is a quality statement; the thing that matters legally is that neither
   * Tesseract nor its model provider is recommending anything. Both are said,
   * in that order.
   */
  ai: 'AI output can be incomplete or wrong, is not a recommendation, and should be checked before you rely on it.',
  /*
   * "Delayed" and "not for trading or valuation" are the two that matter. The
   * first is a fact about the feed; the second is the use the data must not be
   * put to, which is what a vendor's own terms say about it.
   */
  'market-data':
    'Market data is third-party, may be delayed or incomplete, and is not for trading or valuation purposes.',
}

interface ContextualDisclosureProps {
  kind: DisclosureKind
  /** Inline drops the icon and the link, for a tight caption slot. The TEXT is
   *  never shortened: a disclosure that changes wording by context is two
   *  disclosures to keep consistent. */
  inline?: boolean
  className?: string
}

export function ContextualDisclosure({
  kind,
  inline = false,
  className = '',
}: ContextualDisclosureProps) {
  const published = isLegalPublicationEnabled()

  if (inline) {
    return (
      <p
        data-testid={`disclosure-${kind}`}
        data-disclosure-kind={kind}
        className={`text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 ${className}`}
      >
        {TEXT[kind]}
      </p>
    )
  }

  return (
    <div
      data-testid={`disclosure-${kind}`}
      data-disclosure-kind={kind}
      className={`flex items-start gap-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 ${className}`}
    >
      <Info className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" />
      <p>
        {TEXT[kind]}
        {/*
          The link is suppressed while publication is off, because a link to a
          page reading "in preparation" is worse than no link: it draws a
          reader to a dead end at the moment they wanted detail. The disclosure
          text itself is always shown -- it is true today and needs no
          document behind it.
        */}
        {published && (
          <>
            {' '}
            <Link
              to={legalPath('financial-ai-disclosures')}
              className="underline hover:text-gray-900 dark:hover:text-gray-200"
            >
              Disclosures
            </Link>
          </>
        )}
      </p>
    </div>
  )
}

export default ContextualDisclosure
