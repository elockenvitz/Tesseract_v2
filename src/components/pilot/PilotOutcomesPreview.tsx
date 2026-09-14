/**
 * PilotOutcomesPreview — read-only teaser rendered when a pilot user opens
 * the Outcomes tab. Shows what the real surface will do once enabled.
 *
 * Self-heal: if the user lands here having already completed Trade Book
 * (an accepted trade on the tutorial idea + Trade Book unlocked — a trade
 * on any other idea does not count), they've earned Outcomes —
 * mark outcomes_unlocked so the next render swaps in the real surface.
 * Catches the case where the event-based unlock from Trade Book's
 * "Open Outcomes" button missed silently (pilot tester hit this).
 */

import { useEffect } from 'react'
import { Target, CheckCircle2, Sparkles, ArrowRight, Lock } from 'lucide-react'
import { Button } from '../ui/Button'
import { usePilotMode } from '../../hooks/usePilotMode'
import { usePilotProgress } from '../../hooks/usePilotProgress'

interface PilotOutcomesPreviewProps {
  onGoToTradeLab?: () => void
}

export function PilotOutcomesPreview({ onGoToTradeLab }: PilotOutcomesPreviewProps) {
  const pilotMode = usePilotMode()
  const { hasUnlockedTradeBook, hasUnlockedOutcomes, mark } = usePilotProgress()

  useEffect(() => {
    // If we're rendering this preview but the user has already
    // completed everything required to unlock Outcomes, mark it
    // now. The mutation is idempotent so re-firing is a no-op.
    if (
      !pilotMode.isLoading &&
      pilotMode.isPilot &&
      pilotMode.hasCommittedTutorialTrade &&
      hasUnlockedTradeBook &&
      !hasUnlockedOutcomes
    ) {
      mark('outcomes_unlocked')
    }
  }, [
    pilotMode.isLoading,
    pilotMode.isPilot,
    pilotMode.hasCommittedTutorialTrade,
    hasUnlockedTradeBook,
    hasUnlockedOutcomes,
    mark,
  ])

  // Phone first, desktop restored — same treatment as PilotTradeBookPreview.
  return (
    <div data-slot="pilot-locked-preview" className="max-md:h-full max-md:overflow-y-auto max-md:overscroll-contain px-4 pt-5 pb-8 max-w-4xl mx-auto space-y-4 md:p-8 md:space-y-6">
      <div>
        <div className="flex max-md:flex-wrap items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-600 flex items-center justify-center">
            <Target className="w-4 h-4" />
          </div>
          <h1 className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white">Outcomes</h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary-50 text-primary-700 border border-primary-200">
            <Sparkles className="w-2.5 h-2.5" /> Pilot preview
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Where decisions are evaluated against the thesis that drove them.
        </p>
      </div>

      <div className="bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-100 rounded-xl p-4 md:p-6">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0 dark:bg-gray-800">
            <Lock className="w-4 h-4 text-teal-500" />
          </div>
          <div className="max-md:min-w-0 max-md:flex-1">
            <h2 className="text-base font-semibold text-gray-900 mb-1 dark:text-white">
              Outcomes unlocks with your first committed trade
            </h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-4 dark:text-gray-300">
              For the pilot we're focused on the decision loop. Outcomes is where you'll come
              back later to see whether the thesis played out — scorecards per analyst, hit
              rate on price targets, and post-mortem reviews when a thesis is invalidated.
            </p>
            <Button size="sm" onClick={onGoToTradeLab} className="max-md:w-full max-md:h-11">
              <ArrowRight className="w-3.5 h-3.5 mr-1" />
              Go to Trade Lab
            </Button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 dark:text-white">What Outcomes tracks</h3>
        <div data-slot="pilot-preview-cards" className="grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-3">
          {[
            { title: 'Thesis preservation', body: 'The decision rationale is frozen at commit time, so later reviews are grounded in what you actually knew.' },
            { title: 'Price-target evaluation', body: 'Bull / base / bear targets are scored automatically as prices evolve.' },
            { title: 'Analyst scorecards', body: 'Hit rate, bias, accuracy — rolled up per analyst, per portfolio, per sector.' },
            { title: 'Post-mortem flow', body: 'Structured review when a thesis is invalidated — what changed, and what to learn.' },
            { title: 'Decision accountability', body: 'Every committed trade links back to the decision-request that approved it.' },
            { title: 'Historical dataset', body: 'Built up over time — the pilot starts empty and accumulates real signal.' },
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
