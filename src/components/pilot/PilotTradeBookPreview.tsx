/**
 * PilotTradeBookPreview — read-only teaser rendered when a pilot user opens
 * the Trade Book tab. Shows what the real surface will do once enabled,
 * without exposing the operational workflow.
 *
 * Self-heal: if the user lands here and the tutorial idea already has an
 * accepted trade, they've earned Trade Book — mark trade_book_unlocked so
 * the next render swaps in the real surface. A trade on any other idea
 * (e.g. the seeded Inbox recommendation) does not count; see
 * `lib/pilot/pilot-unlocks`. Mirrors the same pattern used by
 * PilotOutcomesPreview.
 *
 * This replaces the older unbounded self-heal that lived in
 * usePilotMode — that one fired on every render where the conditions
 * matched, which combined with usePilotProgress's invalidateQueries to
 * create a visible flicker between locked and unlocked right after
 * execute. Living inside the preview means the heal can only fire
 * while the locked preview is mounted; the moment access flips to
 * 'full', the preview unmounts and the heal stops, so no oscillation.
 */

import { useEffect } from 'react'
import { BookOpen, CheckCircle2, Sparkles, ArrowRight, Lock } from 'lucide-react'
import { Button } from '../ui/Button'
import { usePilotMode } from '../../hooks/usePilotMode'
import { usePilotProgress } from '../../hooks/usePilotProgress'

interface PilotTradeBookPreviewProps {
  onGoToTradeLab?: () => void
}

export function PilotTradeBookPreview({ onGoToTradeLab }: PilotTradeBookPreviewProps) {
  const pilotMode = usePilotMode()
  const { hasUnlockedTradeBook, mark } = usePilotProgress()

  useEffect(() => {
    // If we're rendering this preview but the tutorial idea already has
    // an accepted trade, mark trade_book_unlocked now.
    // The mutation is idempotent so re-firing is a no-op.
    if (
      !pilotMode.isLoading &&
      pilotMode.isPilot &&
      pilotMode.hasCommittedTutorialTrade &&
      !hasUnlockedTradeBook
    ) {
      mark('trade_book_unlocked')
    }
  }, [
    pilotMode.isLoading,
    pilotMode.isPilot,
    pilotMode.hasCommittedTutorialTrade,
    hasUnlockedTradeBook,
    mark,
  ])

  /*
   * Phone first, desktop restored at `md:`.
   *
   * The shell gives this tab an `overflow-hidden` wrapper, so on a phone the
   * preview scrolls itself. Phone-only additions are `max-md:`; values that
   * differ are set for the phone and restored with `md:`, so from `md` up the
   * rendered CSS is what it was. The six cards stack in one column below
   * `md`, where three columns cut them off at 390px.
   */
  return (
    <div data-slot="pilot-locked-preview" className="max-md:h-full max-md:overflow-y-auto max-md:overscroll-contain px-4 pt-5 pb-8 max-w-4xl mx-auto space-y-4 md:p-8 md:space-y-6">
      {/* Header */}
      <div>
        <div className="flex max-md:flex-wrap items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <BookOpen className="w-4 h-4" />
          </div>
          <h1 className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white">Trade Book</h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary-50 text-primary-700 border border-primary-200">
            <Sparkles className="w-2.5 h-2.5" /> Pilot preview
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Where accepted trades land — the system of record for decisions once they've been committed.
        </p>
      </div>

      {/* What you'll see */}
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-4 md:p-6">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0 dark:bg-gray-800">
            <Lock className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="max-md:min-w-0 max-md:flex-1">
            <h2 className="text-base font-semibold text-gray-900 mb-1 dark:text-white">
              This opens after your first accepted simulation
            </h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-4 dark:text-gray-300">
              For the pilot we're starting with the decision simulation workflow in Trade Lab.
              Once you accept a simulated decision, it lands here with full provenance: the
              thesis that drove it, the sizing chosen, the portfolio context at the moment of
              commit, and every decision-request it answered.
            </p>
            <Button size="sm" onClick={onGoToTradeLab} className="max-md:w-full max-md:h-11">
              <ArrowRight className="w-3.5 h-3.5 mr-1" />
              Go to Trade Lab
            </Button>
          </div>
        </div>
      </div>

      {/* Preview: what metadata gets preserved */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 dark:text-white">What the Trade Book preserves</h3>
        <div data-slot="pilot-preview-cards" className="grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-3">
          {[
            { title: 'Decision rationale', body: 'The thesis and why-now that drove the trade, linked for future review.' },
            { title: 'Sizing derivation', body: 'Sizing input (weight / shares / active-weight), computed deltas, and final shares.' },
            { title: 'Portfolio context', body: 'Pre-trade holdings snapshot, portfolio value, benchmark weights.' },
            { title: 'Decision traceability', body: 'Which decision-requests and proposals this trade resolved.' },
            { title: 'Pro-forma lifecycle', body: 'Pending → Settled transitions with reconciliation on real holdings.' },
            { title: 'Audit trail', body: 'Every mutation, who made it, and when.' },
          ].map(card => (
            <div key={card.title} className="max-md:min-w-0 bg-white border border-gray-200 rounded-lg p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center gap-1.5 mb-1 md:mb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <div className="text-xs md:text-[11px] font-semibold text-gray-900 uppercase tracking-wide dark:text-white">{card.title}</div>
              </div>
              <p className="text-[13px] md:text-xs text-gray-600 leading-relaxed dark:text-gray-400">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
