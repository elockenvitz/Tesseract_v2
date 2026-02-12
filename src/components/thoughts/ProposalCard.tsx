/**
 * ProposalCard
 *
 * Presentational component for a single proposal in the review pane list.
 * Collapsed: author, sizing summary, notes preview, timestamp.
 * Expanded: full notes, sizing mode detail, portfolio name.
 */

import { ChevronDown, ChevronRight, User } from 'lucide-react'
import { clsx } from 'clsx'
import type { TradeProposalWithUser } from '../../types/trading'

interface ProposalCardProps {
  proposal: TradeProposalWithUser
  isCurrentUser: boolean
  isExpanded: boolean
  onToggleExpand: () => void
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function getSizingSummary(proposal: TradeProposalWithUser): string {
  const ctx = proposal.sizing_context as Record<string, unknown> | null
  if (ctx?.input_value) return ctx.input_value as string
  if (proposal.weight != null) return `${proposal.weight}%`
  if (proposal.shares != null) return `#${proposal.shares.toLocaleString()}`
  return 'No sizing'
}

function getAuthorName(proposal: TradeProposalWithUser): string {
  const u = proposal.users
  if (!u) return 'Unknown'
  if (u.first_name) return u.last_name ? `${u.first_name} ${u.last_name}` : u.first_name
  return u.email?.split('@')[0] || 'Unknown'
}

export function ProposalCard({ proposal, isCurrentUser, isExpanded, onToggleExpand }: ProposalCardProps) {
  const notesPreview = proposal.notes
    ? proposal.notes.length > 80
      ? proposal.notes.slice(0, 80) + '...'
      : proposal.notes
    : null

  return (
    <div
      className={clsx(
        'rounded-lg border transition-colors',
        isCurrentUser
          ? 'border-primary-200 dark:border-primary-800 bg-primary-50/40 dark:bg-primary-900/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
      )}
    >
      {/* Collapsed row — always visible */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {isExpanded
          ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        }

        <div className="flex-1 min-w-0 flex items-center gap-2">
          {/* Author */}
          <span className="text-sm font-medium text-gray-900 dark:text-white shrink-0">
            {isCurrentUser ? 'You' : getAuthorName(proposal)}
          </span>

          {/* Sizing pill */}
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 shrink-0">
            {getSizingSummary(proposal)}
          </span>

          {/* Notes preview */}
          {!isExpanded && notesPreview && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {notesPreview}
            </span>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
          {formatRelativeTime(proposal.updated_at || proposal.created_at)}
        </span>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-gray-100 dark:border-gray-700">
          {proposal.notes && (
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-2">
              {proposal.notes}
            </p>
          )}

          <div className="flex items-center gap-3 text-[11px] text-gray-400 dark:text-gray-500">
            {proposal.sizing_mode && (
              <span>Mode: {proposal.sizing_mode.replace('_', ' ')}</span>
            )}
            {proposal.portfolio && (
              <span>Portfolio: {proposal.portfolio.name}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
