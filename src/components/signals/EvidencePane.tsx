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

interface EvidencePaneProps {
  items: EvidenceArrival[]
  /** ISO of the review anchor, for the "arrived after" line. */
  reviewAnchor: string | null
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

export function EvidencePane({ items, reviewAnchor }: EvidencePaneProps) {
  if (!items.length) return null

  const written = reviewAnchor ? arrivalDate(reviewAnchor) : null

  return (
    <div className="flex h-full flex-col overflow-hidden" data-slot="evidence-pane">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {items.length === 1 ? 'Arrived after the case was written' : `${items.length} arrived after the case was written`}
        {written ? ` · ${written}` : ''}
      </p>

      <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {items.map(e => (
          <li
            key={e.id}
            // A quiet left rule, not a status colour. Nothing here is graded,
            // so nothing here is tinted — see the header.
            className="border-l-2 border-gray-200 pl-2.5 dark:border-gray-700"
          >
            <p className="text-[13px] font-semibold leading-snug text-gray-800 dark:text-gray-100">
              {itemLabel(e)}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              {e.authorName ?? 'Unknown author'} · {arrivalDate(e.at)}
            </p>
            {e.preview ? (
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-gray-600 dark:text-gray-300">
                {e.preview}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Stated, not implied. The reader should not have to wonder whether the
          product has already decided what this evidence means. */}
      <p className="mt-2 shrink-0 text-[11px] leading-snug text-gray-400 dark:text-gray-500">
        Nothing records whether {items.length === 1 ? 'this' : 'this evidence'} supports or challenges the
        thesis. That is the review.
      </p>
    </div>
  )
}
