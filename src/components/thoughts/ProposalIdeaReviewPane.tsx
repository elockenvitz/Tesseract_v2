/**
 * ProposalIdeaReviewPane
 *
 * Inline review surface rendered inside the right pane when a trade idea
 * is selected from the proposal list. Shows idea summary, existing proposals,
 * and an inline form to create/update the current user's proposal.
 */

import { useState, useMemo } from 'react'
import { ArrowLeft, FileText, Plus, Pencil } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { getProposalsForTradeIdea } from '../../lib/services/trade-lab-service'
import { ProposalCard } from './ProposalCard'
import { InlineProposalForm } from './InlineProposalForm'
import type { TradeQueueItemWithDetails, TradeProposalWithUser } from '../../types/trading'

interface ProposalIdeaReviewPaneProps {
  tradeIdea: TradeQueueItemWithDetails
  onBack: () => void
  onClose: () => void
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  idea: { label: 'Idea', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  simulating: { label: 'Modeling', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  deciding: { label: 'Deciding', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  approved: { label: 'Committed', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
}

const ACTION_COLORS: Record<string, string> = {
  buy: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  add: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  sell: 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  trim: 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
}

function getAsset(idea: TradeQueueItemWithDetails): { symbol: string; company_name: string; sector: string | null } {
  // ProposalQuickModal aliases assets→asset in its query, but the type says `assets`
  const a = (idea as any).asset || idea.assets
  return a || { symbol: 'Unknown', company_name: '', sector: null }
}

export function ProposalIdeaReviewPane({ tradeIdea, onBack, onClose }: ProposalIdeaReviewPaneProps) {
  const { user } = useAuth()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const asset = getAsset(tradeIdea)
  const portfolioId = tradeIdea.portfolio_id || ''
  const status = tradeIdea.status || 'idea'
  const chip = STATUS_CHIP[status] || STATUS_CHIP.idea

  // Fetch proposals for this trade idea
  const { data: proposals = [], isLoading } = useQuery({
    queryKey: ['proposals-for-idea', tradeIdea.id],
    queryFn: () => getProposalsForTradeIdea(tradeIdea.id),
  })

  // Find current user's proposal (if any)
  const myProposal = useMemo(
    () => proposals.find(p => p.user_id === user?.id) ?? null,
    [proposals, user?.id]
  )

  const handleFormSaved = () => {
    setShowForm(false)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-gray-700">
        <button
          onClick={onBack}
          className="p-1 -ml-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Back to ideas"
        >
          <ArrowLeft className="h-4 w-4 text-gray-500" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={clsx('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded', ACTION_COLORS[tradeIdea.action] || 'text-gray-500 bg-gray-100')}>
              {tradeIdea.action}
            </span>
            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {asset.symbol}
            </span>
            <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded', chip.cls)}>
              {chip.label}
            </span>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Idea summary */}
        <section>
          <h4 className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
            Trade Idea
          </h4>
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-2.5 space-y-1.5">
            <div className="text-sm text-gray-900 dark:text-white font-medium">
              {asset.symbol} — {asset.company_name}
            </div>
            {asset.sector && (
              <div className="text-[11px] text-gray-400 dark:text-gray-500">
                Sector: {asset.sector}
              </div>
            )}
            {tradeIdea.rationale && (
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                {tradeIdea.rationale}
              </p>
            )}
            {tradeIdea.proposed_weight != null && (
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                Proposed: {tradeIdea.proposed_weight}%
                {tradeIdea.proposed_shares != null && ` / #${tradeIdea.proposed_shares.toLocaleString()}`}
              </div>
            )}
          </div>
        </section>

        {/* Proposals list */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              Proposals
              {proposals.length > 0 && (
                <span className="ml-1 text-gray-300 dark:text-gray-600">
                  ({proposals.length})
                </span>
              )}
            </h4>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1].map(i => (
                <div key={i} className="animate-pulse h-10 bg-gray-100 dark:bg-gray-700 rounded-lg" />
              ))}
            </div>
          ) : proposals.length === 0 ? (
            <div className="py-4 text-center">
              <FileText className="h-6 w-6 text-gray-300 dark:text-gray-600 mx-auto mb-1.5" />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                No proposals yet. Be the first to weigh in.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {proposals.map(p => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  isCurrentUser={p.user_id === user?.id}
                  isExpanded={expandedId === p.id}
                  onToggleExpand={() => setExpandedId(prev => prev === p.id ? null : p.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Create / Update CTA or inline form */}
        <section>
          {showForm ? (
            <InlineProposalForm
              tradeIdea={tradeIdea}
              existingProposal={myProposal}
              portfolioId={portfolioId}
              onSaved={handleFormSaved}
              onCancel={() => setShowForm(false)}
            />
          ) : portfolioId ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-1.5 h-9 text-sm font-medium rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              {myProposal ? (
                <>
                  <Pencil className="h-3.5 w-3.5" />
                  Update Your Proposal
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add Your Proposal
                </>
              )}
            </button>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
              No portfolio linked — proposals require a portfolio context.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
