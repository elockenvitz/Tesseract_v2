/**
 * The request the reader came to rule on.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * A PM who clicks a ticker in the pending-recommendations inbox has one
 * question: what is being proposed, on what evidence, and is it mine to
 * answer. The Overview's "Needs a decision" block answers a different and
 * smaller question -- that something is waiting -- in one line per request:
 * a verb, a book, and a note that is usually blank.
 *
 * This is the same records, read properly: who proposed it, how long it has
 * been sitting, whose move it is, what they said, and the way through to the
 * controls that resolve it.
 *
 * ── One spine, enriched -- never two sources ─────────────────────────────
 *
 * The rows come from the page (`useAssetWorkspace.decisions`, already on
 * screen). `useAssetWorkAttention` reads the requester, the raised date and
 * the PM books, and is joined onto that spine BY ID. It is never the spine
 * itself: `splitAttention` deliberately drops requests that are neither the
 * reader's to decide nor theirs to watch, so leading with its output would
 * silently hide a waiting request on a book the reader merely covers.
 *
 * A row the enrichment has nothing for still renders, with the facts the
 * page already had. That is the whole reason for the direction of the join.
 *
 * ── Permission scope ─────────────────────────────────────────────────────
 *
 * RLS posture unchanged, and nothing here grants anything. `decision_requests`
 * and `portfolio_team` are read by the caller's own client through the hook
 * the Work surface already uses; "yours to answer" is a LABEL derived from the
 * same `portfolio_team` rows the decide buttons use, and the server still
 * refuses a decision this label gets wrong. No control in this file resolves
 * a request -- the way through is the existing decision surface.
 */
import { clsx } from 'clsx'
import { useAssetWorkAttention } from '../../hooks/useAssetWorkAttention'
import { daysSince } from '../../lib/asset-workspace/context'
import { SnapBlock, StatusChip, QuietLine } from './SnapshotBlocks'

/** A waiting request, as the page already holds it. */
export interface DecisionAtHandRow {
  id: string
  action: string | null
  portfolioId: string | null
  portfolioName: string | null
  decisionNote: string | null
  /** Set when the request was raised on an idea, whose rationale stands in. */
  ideaId?: string | null
}

export interface DecisionAtHandProps {
  assetId: string
  /** Every open request on this name, in the page's own order. */
  rows: readonly DecisionAtHandRow[]
  /**
   * The rationale recorded on each idea, by idea id.
   *
   * `decision_note` is usually blank on submission, and the idea the request
   * was raised on says why. Passed in rather than re-read: the page has it.
   */
  rationaleByIdeaId?: Map<string, string | null>
  /** The request the reader arrived on, when the sender named one. */
  highlightId?: string | null
  /** The sender's one-line reason for the hop. */
  reason?: string | null
  /** Through to the real controls. */
  onOpenDecisions: () => void
}

/** How long it has been waiting, in the fewest words that are still true. */
function waitingFor(createdAt: string | null | undefined): string | null {
  const days = daysSince(createdAt ?? null)
  if (days == null || days < 0) return null
  if (days === 0) return 'raised today'
  if (days === 1) return 'waiting a day'
  if (days < 30) return `waiting ${days} days`
  const months = Math.floor(days / 30)
  return months === 1 ? 'waiting over a month' : `waiting over ${months} months`
}

export function DecisionAtHand({
  assetId, rows, rationaleByIdeaId, highlightId, reason, onOpenDecisions,
}: DecisionAtHandProps) {
  /*
   * Enrichment only, and only on this composition.
   *
   * The hook is two asset-scoped reads keyed exactly as the Work surface
   * keys them, so when Work has been open they are served from cache. On a
   * decision entry the reader is here to rule on something, which is the one
   * situation where knowing who asked and how long ago is worth a read.
   */
  const { attention } = useAssetWorkAttention(assetId, rows.length > 0)
  const detail = new Map<string, { requesterName: string | null; createdAt: string | null; yours: boolean }>()
  for (const r of attention.needsYourAction) {
    detail.set(r.id, { requesterName: r.requesterName ?? null, createdAt: r.createdAt ?? null, yours: true })
  }
  for (const r of attention.awaitingOthers) {
    detail.set(r.id, { requesterName: r.requesterName ?? null, createdAt: r.createdAt ?? null, yours: false })
  }

  /* The one the reader clicked leads, then the page's own order. Sorting
     rather than filtering: the other requests on the name are context a PM
     ruling on this one needs, not noise. */
  const ordered = highlightId
    ? [...rows].sort((a, b) => (a.id === highlightId ? -1 : b.id === highlightId ? 1 : 0))
    : rows

  const many = ordered.length > 1

  return (
    <SnapBlock
      testId="snapshot-decision-at-hand"
      rail="action"
      title={many ? 'The decisions waiting here' : 'The decision in front of you'}
      meta={many ? `${ordered.length} open requests` : undefined}
      action={(
        <button
          type="button"
          data-testid="decision-at-hand-open"
          onClick={onOpenDecisions}
          className="text-sm text-primary-600 hover:underline dark:text-primary-400"
        >
          Open the recommendation →
        </button>
      )}
    >
      {/* Why the reader is here, in the sender's words, when it said. Not
          restated as a claim of this page's own. */}
      {reason && (
        <QuietLine className="mb-3">You were sent here: {reason}</QuietLine>
      )}
      <div className="flex flex-col gap-3">
        {ordered.map(row => {
          const d = detail.get(row.id)
          const waited = waitingFor(d?.createdAt)
          const rationale = row.decisionNote
            ?? (row.ideaId ? rationaleByIdeaId?.get(row.ideaId) ?? null : null)
          const arrived = !!highlightId && row.id === highlightId
          return (
            <div
              key={row.id}
              data-testid="decision-at-hand-row"
              data-decision={row.id}
              data-arrived={arrived ? 'yes' : undefined}
              className={clsx(
                'rounded-lg border p-3',
                arrived
                  ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/[0.06]'
                  : 'border-gray-200 dark:border-white/[0.08]',
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                  {/* The action as proposed. A raw enum would be a column
                      name; these are a small known vocabulary. */}
                  {row.action ? row.action.replace(/_/g, ' ') : 'Request'}
                  {row.portfolioName ? ` in ${row.portfolioName}` : ''}
                </span>
                <StatusChip tone={d?.yours ? 'waiting' : 'neutral'}>
                  {d?.yours ? 'Yours to answer' : 'Awaiting a decision'}
                </StatusChip>
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {/* Each fact only when it is on record. A dash for an absent
                    requester would read as an anonymous proposal. */}
                {[d?.requesterName ? `Proposed by ${d.requesterName}` : null, waited]
                  .filter(Boolean)
                  .join(' · ') || 'No requester or date on record'}
              </div>
              {rationale ? (
                <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {rationale}
                </p>
              ) : (
                <QuietLine className="mt-2">
                  No rationale was recorded with the request.
                </QuietLine>
              )}
            </div>
          )
        })}
      </div>
    </SnapBlock>
  )
}
