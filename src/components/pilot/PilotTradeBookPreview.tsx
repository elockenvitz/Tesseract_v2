/**
 * PilotTradeBookPreview — read-only teaser rendered when a pilot user opens
 * the Trade Book tab. Shows what the real surface will do once enabled,
 * without exposing the operational workflow.
 */

import { BookOpen, CheckCircle2, Sparkles, ArrowRight, Lock } from 'lucide-react'
import { Button } from '../ui/Button'

interface PilotTradeBookPreviewProps {
  onGoToTradeLab?: () => void
}

export function PilotTradeBookPreview({ onGoToTradeLab }: PilotTradeBookPreviewProps) {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <BookOpen className="w-4 h-4" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Trade Book</h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary-50 text-primary-700 border border-primary-200">
            <Sparkles className="w-2.5 h-2.5" /> Pilot preview
          </span>
        </div>
        <p className="text-sm text-gray-500">
          Where accepted trades land — the system of record for decisions once they've been committed.
        </p>
      </div>

      {/* What you'll see */}
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4 text-indigo-500" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              This opens after your first accepted simulation
            </h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">
              For the pilot we're starting with the decision simulation workflow in Trade Lab.
              Once you accept a simulated decision, it lands here with full provenance: the
              thesis that drove it, the sizing chosen, the portfolio context at the moment of
              commit, and every decision-request it answered.
            </p>
            <Button size="sm" onClick={onGoToTradeLab}>
              <ArrowRight className="w-3.5 h-3.5 mr-1" />
              Go to Trade Lab
            </Button>
          </div>
        </div>
      </div>

      {/* Preview: what metadata gets preserved */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">What the Trade Book preserves</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { title: 'Decision rationale', body: 'The thesis and why-now that drove the trade, linked for future review.' },
            { title: 'Sizing derivation', body: 'Sizing input (weight / shares / active-weight), computed deltas, and final shares.' },
            { title: 'Portfolio context', body: 'Pre-trade holdings snapshot, portfolio value, benchmark weights.' },
            { title: 'Decision traceability', body: 'Which decision-requests and proposals this trade resolved.' },
            { title: 'Pro-forma lifecycle', body: 'Pending → Settled transitions with reconciliation on real holdings.' },
            { title: 'Audit trail', body: 'Every mutation, who made it, and when.' },
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
