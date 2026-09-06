import type React from 'react'

import type { EvidenceArrival } from '../../lib/research/case-state'

/**
 * What arrived after the case was written, as a dated list.
 *
 * ── Why this is typographic and not a chart ───────────────────────────────
 *
 * The obvious visual is an arrival histogram. It would be a lie at this scale:
 * the largest number of evidence items sitting after a review anchor anywhere
 * in production is two, and a bar chart of two bars is decoration pretending to
 * be analysis. The useful facts about an arrival are who filed it, when, and
 * what it was called — which is a list.
 *
 * ── The claim this pane refuses to make ───────────────────────────────────
 *
 * Nothing in the product records whether a note supports or challenges a
 * thesis. `asset_notes.note_type` is a document class (research / decision /
 * idea / analysis) and `quick_thoughts.sentiment` is sentiment about the ASSET,
 * neither of which is a relation to the case. So no item here is tinted,
 * ranked, or labelled by stance, and the pane says outright that establishing
 * the relation is the reader's job. Inferring it — from the type, the
 * sentiment, or a model — would put a fabricated judgment beside recorded
 * facts, which is the one thing a research surface cannot do.
 *
 * ── Dates ─────────────────────────────────────────────────────────────────
 *
 * `created_at` only. 18 of 22 live notes in production share a single
 * `updated_at` from the organization_id backfill, so an "edited since" line
 * would be reporting a data migration as human activity.
 */

/**
 * How many arrivals the pane will draw before it counts the rest.
 *
 * The pane is one screen. Four bounded rows fit and stay readable; a fifth
 * turns the list into a scroller inside a carousel inside a feed, which is the
 * third nested scroll owner this surface has spent phases removing. Anything
 * beyond is stated as a truthful count rather than hidden.
 */
const MAX_LISTED = 4

interface EvidencePaneProps {
  items: EvidenceArrival[]
  /** ISO of the review anchor, for the "arrived after" line. */
  reviewAnchor: string | null
  /**
   * Open one arrival. Present only where the item has somewhere to go.
   *
   * Every row is individually actionable, which is what makes this a review
   * surface rather than a summary: with several arrivals the card must not
   * choose one of them on the reader's behalf, and this is how they choose.
   */
  onOpen?: (item: EvidenceArrival) => void
}

function arrivalDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** How the item names itself when it has no title of its own. */
function itemLabel(e: EvidenceArrival): string {
  if (e.title) return e.title
  return e.kind === 'thought' ? 'Quick thought' : 'Untitled note'
}

export function EvidencePane({ items, reviewAnchor, onOpen }: EvidencePaneProps) {
  if (!items.length) return null

  // Newest first: the most recent arrival is the one that put the card on
  // screen today. The rule hands them oldest-first because that is the order
  // they happened in; the reader wants the other end.
  const ordered = [...items].sort((a, b) => b.at.localeCompare(a.at))
  const listed = ordered.slice(0, MAX_LISTED)
  const hidden = ordered.length - listed.length

  const written = reviewAnchor ? arrivalDate(reviewAnchor) : null
  /**
   * The count earns a line only when it is telling the reader something.
   *
   * At two or more, "how much has piled up" is genuinely part of the finding.
   * At one, a big "1" is the least informative thing on the card and was
   * outweighing the title of the thing that actually arrived — which is the
   * object the pane exists to show.
   */
  const many = items.length > 1

  return (
    <div className="flex h-full flex-col overflow-hidden" data-slot="evidence-pane">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {many ? `${items.length} arrived since the case` : 'Arrived since the case'}
        {written ? ` · written ${written}` : ''}
      </p>

      <ul className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto">
        {listed.map(e => (
          <li
            key={e.id}
            data-slot="evidence-item"
            {...(onOpen
              ? {
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => onOpen(e),
                  onKeyDown: (ev: React.KeyboardEvent) => {
                    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e) }
                  },
                }
              : {})}
            // A quiet left rule, not a status colour. Nothing here is graded,
            // so nothing here is tinted — see the header.
            className={`border-l-2 border-gray-200 pl-2.5 dark:border-gray-700${
              onOpen ? ' cursor-pointer active:opacity-70' : ''
            }`}
          >
            {/* The arrival IS the content. At a single item it carries the
                pane, so it is set at reading size rather than as a list row. */}
            <p
              className={
                many
                  ? 'text-[13px] font-semibold leading-snug text-gray-800 dark:text-gray-100'
                  : 'text-[15px] font-semibold leading-snug text-gray-900 dark:text-gray-50'
              }
            >
              {itemLabel(e)}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              {e.authorName ?? 'Unknown author'} · {arrivalDate(e.at)}
            </p>
            {e.preview ? (
              <p
                className={
                  many
                    ? 'mt-1 line-clamp-2 text-[12px] leading-snug text-gray-600 dark:text-gray-300'
                    : 'mt-1.5 line-clamp-6 text-[13px] leading-relaxed text-gray-600 dark:text-gray-300'
                }
              >
                {e.preview}
              </p>
            ) : null}
          </li>
        ))}
        {hidden > 0 && (
          // Truthful, and not a link: the rest are reachable on the asset, and
          // a control here would promise a surface this pane does not have.
          <li className="pl-2.5 text-[12px] text-gray-400 dark:text-gray-500">
            +{hidden} more since the thesis was written
          </li>
        )}
      </ul>

      {/* Stated, not implied — and stated ONCE.
          This sentence used to appear in the card body as well, so a reader
          paging Evidence → Price → Case met the same paragraph under each. The
          headline establishes the issue; this is the one place the product says
          it has not judged the evidence, and it belongs where the evidence is. */}
      <p className="mt-2 shrink-0 text-[11px] leading-snug text-gray-400 dark:text-gray-500">
        Nothing records whether {many ? 'this evidence' : 'this'} supports or challenges the
        thesis. That is the review.
      </p>
    </div>
  )
}
