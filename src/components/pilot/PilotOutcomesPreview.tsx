/**
 * PilotOutcomesPreview — read-only teaser rendered when a pilot user opens
 * the Outcomes tab. Shows what the real surface will do once enabled.
 */

import { Target, CheckCircle2, Sparkles, ArrowRight, Lock } from 'lucide-react'
import { Button } from '../ui/Button'

interface PilotOutcomesPreviewProps {
  onGoToTradeLab?: () => void
}

export function PilotOutcomesPreview({ onGoToTradeLab }: PilotOutcomesPreviewProps) {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-600 flex items-center justify-center">
            <Target className="w-4 h-4" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Outcomes</h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary-50 text-primary-700 border border-primary-200">
            <Sparkles className="w-2.5 h-2.5" /> Pilot preview
          </span>
        </div>
        <p className="text-sm text-gray-500">
          Where decisions are evaluated against the thesis that drove them.
        </p>
      </div>

      <div className="bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-100 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4 text-teal-500" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              Outcomes unlocks with your first committed trade
            </h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">
              For the pilot we're focused on the decision loop. Outcomes is where you'll come
              back later to see whether the thesis played out — scorecards per analyst, hit
              rate on price targets, and post-mortem reviews when a thesis is invalidated.
            </p>
            <Button size="sm" onClick={onGoToTradeLab}>
              <ArrowRight className="w-3.5 h-3.5 mr-1" />
              Go to Trade Lab
            </Button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">What Outcomes tracks</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { title: 'Thesis preservation', body: 'The decision rationale is frozen at commit time, so later reviews are grounded in what you actually knew.' },
            { title: 'Price-target evaluation', body: 'Bull / base / bear targets are scored automatically as prices evolve.' },
            { title: 'Analyst scorecards', body: 'Hit rate, bias, accuracy — rolled up per analyst, per portfolio, per sector.' },
            { title: 'Post-mortem flow', body: 'Structured review when a thesis is invalidated — what changed, and what to learn.' },
            { title: 'Decision accountability', body: 'Every committed trade links back to the decision-request that approved it.' },
            { title: 'Historical dataset', body: 'Built up over time — the pilot starts empty and accumulates real signal.' },
          ].map(card => (
            <div key={card.title} className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <div className="text-[11px] font-semibold text-gray-900 uppercase tracking-wide">{card.title}</div>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
