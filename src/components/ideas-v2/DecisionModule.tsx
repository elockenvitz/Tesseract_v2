/**
 * Desktop Ideas — making the decision, in place.
 *
 * Today identifies the work; this is where it gets done. A user arriving from
 * Today's "Decide" completes the decision here, with the thesis, framework,
 * exposure and research still on screen — rather than being handed to another
 * surface and asked to reconstruct why they came.
 *
 * ── One row per portfolio, because that is what a decision is ─────────────
 *
 * Decisions live in `trade_idea_portfolios`, one per (idea, portfolio). The
 * same idea can be accepted for one book and deferred for another, so a single
 * Accept button would silently decide for every other portfolio. Each track
 * gets its own row and its own answer.
 *
 * ── Rules stay in the service ─────────────────────────────────────────────
 *
 * Every button calls `updatePortfolioTrackDecision` through `useIdeaDecision`.
 * No rule is reimplemented, so the old modal and this surface cannot drift.
 */

import { useState } from 'react'
import { dispatchDecisionAction } from '../../engine/decisionEngine/dispatchDecisionAction'
import { clsx } from 'clsx'
import { Check, Clock, X } from 'lucide-react'
import { useIdeaDecision } from '../../hooks/useIdeaDecision'
import type { DecisionOutcome } from '../../types/trading'

const OUTCOME_STYLE: Record<string, string> = {
  accepted: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900/50',
  deferred: 'text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900/50',
  rejected: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/40 dark:border-rose-900/50',
}

export function DecisionModule({
  ideaId, assetId,
}: {
  ideaId: string
  /** The asset, so an unsized idea can be routed to where sizing happens. */
  assetId?: string | null
}) {
  const { tracks, pending, isLoading, decide, isDeciding, error } = useIdeaDecision(ideaId)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<DecisionOutcome>('accepted')
  const [reason, setReason] = useState('')
  const [deferUntil, setDeferUntil] = useState('')

  if (isLoading) {
    return <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.05]" />
  }

  if (!tracks.length) {
    /*
     * A blocker with a way through it.
     *
     * This said the idea had no portfolio tracks and stopped there, which is
     * true and useless: a decision lives in `trade_idea_portfolios`, one row
     * per (idea, portfolio), so with no track there is genuinely nothing to
     * accept — and the reader was left to work out on their own where tracks
     * come from.
     *
     * Sizing the idea against a book is what creates one, and Trade Lab is
     * where that happens. The route is the product's own
     * `OPEN_TRADE_LAB_SIMULATION`, carrying the asset, so this adds no
     * workflow and invents no mutation. It names the blocker and then offers
     * the real thing that resolves it.
     */
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[12px] text-gray-500">
          Nothing to decide yet — this idea has not been sized against a book.
        </p>
        {assetId && (
          <button
            type="button"
            data-testid="decision-unblock"
            onClick={() => dispatchDecisionAction('OPEN_TRADE_LAB_SIMULATION', { assetId })}
            className="rounded-md border border-gray-300 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5"
          >
            Size it in Trade Lab
          </button>
        )}
      </div>
    )
  }

  const submit = (portfolioId: string) => {
    decide({
      portfolioId,
      outcome,
      reason: reason.trim() || undefined,
      deferredUntil: outcome === 'deferred' && deferUntil ? new Date(deferUntil).toISOString() : null,
    })
    setOpenFor(null); setReason(''); setDeferUntil(''); setOutcome('accepted')
  }

  return (
    <div className="flex flex-col gap-2">
      {pending.length > 0 && (
        <p className="text-[11px] text-gray-600 dark:text-gray-400">
          {pending.length} of {tracks.length} portfolio{tracks.length === 1 ? '' : 's'} awaiting your answer.
          Each is decided separately.
        </p>
      )}

      {tracks.map(track => (
        <div
          key={track.id}
          data-testid="decision-track"
          className="rounded-lg border border-gray-200 px-3 py-2.5 dark:border-white/10"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-semibold">{track.portfolioName}</span>
            {track.decisionOutcome ? (
              <span className={clsx(
                'rounded-full border px-2 py-[2px] text-[10px] font-bold uppercase tracking-wider',
                OUTCOME_STYLE[track.decisionOutcome],
              )}>
                {track.decisionOutcome}
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:bg-white/[0.07]">
                undecided
              </span>
            )}

            {!track.decisionOutcome && openFor !== track.id && (
              <button
                type="button"
                onClick={() => setOpenFor(track.id)}
                className="ml-auto rounded-lg border border-blue-700 bg-blue-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
              >
                Decide
              </button>
            )}
          </div>

          {track.decisionOutcome && (
            <div className="mt-1 text-[11px] text-gray-500">
              {track.decisionReason || 'No reason recorded.'}
              {track.decidedAt && ` · ${new Date(track.decidedAt).toLocaleDateString()}`}
            </div>
          )}

          {openFor === track.id && (
            <div className="mt-2.5 border-t border-gray-200 pt-2.5 dark:border-white/10">
              <div className="flex flex-wrap gap-1.5">
                {(['accepted', 'deferred', 'rejected'] as DecisionOutcome[]).map(o => (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={outcome === o}
                    onClick={() => setOutcome(o)}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium capitalize',
                      outcome === o
                        ? OUTCOME_STYLE[o]
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:text-gray-400',
                    )}
                  >
                    {o === 'accepted' ? <Check className="h-3 w-3" />
                      : o === 'deferred' ? <Clock className="h-3 w-3" />
                      : <X className="h-3 w-3" />}
                    {o}
                  </button>
                ))}
              </div>

              {outcome === 'deferred' && (
                <input
                  type="date"
                  value={deferUntil}
                  onChange={e => setDeferUntil(e.target.value)}
                  aria-label="Defer until"
                  className="mt-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] dark:border-white/10 dark:bg-transparent"
                />
              )}

              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Why? Recorded with the decision."
                aria-label="Decision reason"
                className="mt-2 w-full resize-none rounded-lg border border-gray-200 px-2.5 py-2 text-[12px] dark:border-white/10 dark:bg-transparent"
                rows={2}
              />

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={isDeciding}
                  onClick={() => submit(track.portfolioId)}
                  className="rounded-lg border border-blue-700 bg-blue-700 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800 disabled:opacity-50"
                >
                  {isDeciding ? 'Recording…' : `Record ${outcome}`}
                </button>
                <button
                  type="button"
                  onClick={() => setOpenFor(null)}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
                >
                  Cancel
                </button>
                <span className="ml-auto text-[10px] text-gray-500">
                  Recorded under your name, for {track.portfolioName} only.
                </span>
              </div>
            </div>
          )}
        </div>
      ))}

      {error && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">
          The decision was not recorded: {error.message}
        </p>
      )}
    </div>
  )
}
