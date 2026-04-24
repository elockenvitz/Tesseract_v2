/**
 * PilotTradeLabBanner — top-of-Trade-Lab banner for pilot users, showing
 * the staged scenario and subtle system-continuation CTAs.
 */

import { useState } from 'react'
import { Sparkles, ChevronDown, ChevronUp, BookOpen, Target, FileText, Beaker } from 'lucide-react'
import { clsx } from 'clsx'
import type { PilotScenario } from '../../hooks/usePilotScenario'

interface PilotTradeLabBannerProps {
  scenario: PilotScenario | null
  isLoading: boolean
}

function displaySymbol(s: PilotScenario): string {
  return s.asset?.symbol || s.symbol || '—'
}

export function PilotTradeLabBanner({ scenario, isLoading }: PilotTradeLabBannerProps) {
  const [expanded, setExpanded] = useState(true)

  if (isLoading) {
    return (
      <div className="mx-4 mt-3 rounded-xl border border-primary-200 bg-gradient-to-br from-primary-50 to-purple-50 dark:from-primary-900/20 dark:to-purple-900/20 p-4 animate-pulse">
        <div className="h-5 w-48 bg-white/70 rounded mb-2" />
        <div className="h-3 w-full bg-white/50 rounded" />
      </div>
    )
  }

  if (!scenario) {
    return (
      <div className="mx-4 mt-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 dark:bg-gray-900/50 p-6 text-center">
        <Beaker className="w-6 h-6 text-gray-300 mx-auto mb-2" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
          Your pilot scenario is being prepared
        </h3>
        <p className="text-xs text-gray-500">
          Hang tight — we'll stage an idea here for you to review shortly.
        </p>
      </div>
    )
  }

  const symbol = displaySymbol(scenario)

  return (
    <div className="mx-4 mt-3 rounded-xl border border-primary-200 bg-gradient-to-br from-primary-50/70 to-purple-50/70 dark:from-primary-900/20 dark:to-purple-900/20 overflow-hidden">
      {/* Top row — always visible */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-white shadow-sm flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-primary-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-400">
                Pilot scenario
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/80 text-gray-700 border border-gray-200">
                {symbol}
              </span>
              {scenario.direction && (
                <span className={clsx(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium capitalize',
                  scenario.direction === 'buy' || scenario.direction === 'add'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : scenario.direction === 'sell' || scenario.direction === 'trim' || scenario.direction === 'reduce' || scenario.direction === 'close'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-sky-50 text-sky-700 border border-sky-200'
                )}>
                  {scenario.direction}
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate mt-0.5">
              {scenario.title}
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              Review the staged idea, adjust sizing, and evaluate the decision impact.
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-white/60 rounded-lg transition-colors shrink-0"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Context + sizing proposal */}
          <div className="grid grid-cols-2 gap-3">
            {scenario.thesis && (
              <DetailCard title="Thesis" body={scenario.thesis} />
            )}
            {scenario.why_now && (
              <DetailCard title="Why now" body={scenario.why_now} />
            )}
            {scenario.proposed_action && (
              <DetailCard title="Proposed action" body={scenario.proposed_action} />
            )}
            {scenario.proposed_sizing_input && (
              <DetailCard
                title="Proposed sizing"
                body={`${scenario.proposed_sizing_input}${scenario.target_weight_pct != null ? ` · target ${scenario.target_weight_pct}%` : ''}${scenario.delta_weight_pct != null ? ` · Δ ${scenario.delta_weight_pct > 0 ? '+' : ''}${scenario.delta_weight_pct}%` : ''}`}
              />
            )}
          </div>

          {/* System-continuation CTAs — subtle, educational */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/60">
            <ContinuationCard
              icon={BookOpen}
              title="Trade Book"
              body="If accepted, this becomes a tracked trade with full provenance."
              colorClass="text-indigo-500"
            />
            <ContinuationCard
              icon={FileText}
              title="Decision rationale"
              body="Your thesis and sizing logic are preserved for future review."
              colorClass="text-gray-500"
            />
            <ContinuationCard
              icon={Target}
              title="Outcomes"
              body="Later tracks whether this thesis actually played out."
              colorClass="text-teal-500"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function DetailCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white/70 dark:bg-gray-800/50 rounded-lg p-2.5 border border-white/60 dark:border-gray-700/60">
      <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
        {title}
      </div>
      <p className="text-xs text-gray-800 dark:text-gray-200 leading-snug whitespace-pre-wrap">
        {body}
      </p>
    </div>
  )
}

function ContinuationCard({
  icon: Icon, title, body, colorClass,
}: {
  icon: typeof BookOpen
  title: string
  body: string
  colorClass: string
}) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-md bg-white/50 dark:bg-gray-800/30">
      <Icon className={clsx('w-3.5 h-3.5 mt-0.5 shrink-0', colorClass)} />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 mb-0.5">{title}</div>
        <p className="text-[10px] text-gray-600 dark:text-gray-400 leading-snug">{body}</p>
      </div>
    </div>
  )
}
