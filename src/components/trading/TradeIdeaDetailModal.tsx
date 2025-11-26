import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  X,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  Send,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  RotateCcw
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import { Badge } from '../ui/Badge'
import type {
  TradeQueueItemWithDetails,
  TradeQueueCommentWithUser,
  TradeQueueVoteWithUser,
  TradeQueueStatus,
  TradeVote
} from '../../types/trading'
import { clsx } from 'clsx'

interface TradeIdeaDetailModalProps {
  isOpen: boolean
  tradeId: string
  onClose: () => void
}

const STATUS_CONFIG: Record<TradeQueueStatus, { label: string; color: string }> = {
  idea: { label: 'Idea', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  discussing: { label: 'Discussing', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  executed: { label: 'Executed', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' },
}

export function TradeIdeaDetailModal({ isOpen, tradeId, onClose }: TradeIdeaDetailModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [newComment, setNewComment] = useState('')
  const [suggestedWeight, setSuggestedWeight] = useState('')
  const [suggestedShares, setSuggestedShares] = useState('')

  // Fetch trade details
  const { data: trade, isLoading } = useQuery({
    queryKey: ['trade-queue-item', tradeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name)
        `)
        .eq('id', tradeId)
        .single()

      if (error) throw error
      return data as TradeQueueItemWithDetails
    },
    enabled: isOpen,
  })

  // Fetch comments
  const { data: comments } = useQuery({
    queryKey: ['trade-queue-comments', tradeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_comments')
        .select(`
          *,
          users:user_id (id, email, first_name, last_name)
        `)
        .eq('trade_queue_item_id', tradeId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data as TradeQueueCommentWithUser[]
    },
    enabled: isOpen,
  })

  // Fetch votes
  const { data: votes } = useQuery({
    queryKey: ['trade-queue-votes', tradeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_votes')
        .select(`
          *,
          users:user_id (id, email, first_name, last_name)
        `)
        .eq('trade_queue_item_id', tradeId)

      if (error) throw error
      return data as TradeQueueVoteWithUser[]
    },
    enabled: isOpen,
  })

  // Calculate vote summary
  const voteSummary = useMemo(() => {
    if (!votes) return { approve: 0, reject: 0, needs_discussion: 0 }
    return {
      approve: votes.filter(v => v.vote === 'approve').length,
      reject: votes.filter(v => v.vote === 'reject').length,
      needs_discussion: votes.filter(v => v.vote === 'needs_discussion').length,
    }
  }, [votes])

  // Get user's current vote
  const userVote = useMemo(() => {
    if (!votes || !user) return null
    return votes.find(v => v.user_id === user.id)
  }, [votes, user])

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('trade_queue_comments')
        .insert({
          trade_queue_item_id: tradeId,
          user_id: user?.id,
          content: newComment,
          suggested_weight: suggestedWeight ? parseFloat(suggestedWeight) : null,
          suggested_shares: suggestedShares ? parseFloat(suggestedShares) : null,
        })

      if (error) throw error

      // Update status to discussing if it was just an idea
      if (trade?.status === 'idea') {
        await supabase
          .from('trade_queue_items')
          .update({ status: 'discussing' })
          .eq('id', tradeId)
      }
    },
    onSuccess: () => {
      setNewComment('')
      setSuggestedWeight('')
      setSuggestedShares('')
      queryClient.invalidateQueries({ queryKey: ['trade-queue-comments', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-item', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  // Vote mutation
  const voteMutation = useMutation({
    mutationFn: async (vote: TradeVote) => {
      // Upsert vote
      const { error } = await supabase
        .from('trade_queue_votes')
        .upsert({
          trade_queue_item_id: tradeId,
          user_id: user?.id,
          vote,
        }, {
          onConflict: 'trade_queue_item_id,user_id'
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-votes', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (status: TradeQueueStatus) => {
      const updates: any = { status }
      if (status === 'approved') {
        updates.approved_by = user?.id
        updates.approved_at = new Date().toISOString()
      } else if (status === 'executed') {
        updates.executed_at = new Date().toISOString()
      }

      const { error } = await supabase
        .from('trade_queue_items')
        .update(updates)
        .eq('id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-item', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  const getUserDisplayName = (userData: { first_name?: string | null; last_name?: string | null; email?: string }) => {
    if (userData.first_name || userData.last_name) {
      return `${userData.first_name || ''} ${userData.last_name || ''}`.trim()
    }
    return userData.email?.split('@')[0] || 'Unknown'
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          {trade && (
            <div className="flex items-center gap-3">
              <div className={clsx(
                "flex items-center gap-1 px-2 py-1 rounded font-medium",
                trade.action === 'buy' || trade.action === 'add'
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              )}>
                {trade.action === 'buy' || trade.action === 'add' ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                <span className="uppercase text-sm">{trade.action}</span>
              </div>
              <div>
                <span className="font-bold text-lg text-gray-900 dark:text-white">
                  {trade.assets?.symbol}
                </span>
                <span className="text-gray-500 dark:text-gray-400 ml-2">
                  {trade.assets?.company_name}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 space-y-4">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          ) : trade ? (
            <div className="p-4 space-y-6">
              {/* Status and Urgency */}
              <div className="flex items-center gap-3">
                <span className={clsx("px-3 py-1 rounded-full text-sm font-medium", STATUS_CONFIG[trade.status].color)}>
                  {STATUS_CONFIG[trade.status].label}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Urgency: <span className="font-medium capitalize">{trade.urgency}</span>
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Portfolio: <span className="font-medium">{trade.portfolios?.name}</span>
                </span>
              </div>

              {/* Sizing Info */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Proposed Sizing
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      {trade.proposed_weight ? `${trade.proposed_weight.toFixed(2)}%` : '—'}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Target Weight</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      {trade.proposed_shares ? trade.proposed_shares.toLocaleString() : '—'}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Shares</div>
                  </div>
                </div>
                {trade.target_price && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Target Price: </span>
                    <span className="font-semibold text-gray-900 dark:text-white">${trade.target_price.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Thesis & Rationale */}
              {(trade.thesis_summary || trade.rationale) && (
                <div>
                  {trade.thesis_summary && (
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        Thesis Summary
                      </h3>
                      <p className="text-gray-900 dark:text-white">{trade.thesis_summary}</p>
                    </div>
                  )}
                  {trade.rationale && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        Rationale
                      </h3>
                      <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{trade.rationale}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Voting Section */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Team Votes
                </h3>
                <div className="flex items-center gap-4 mb-4">
                  <button
                    onClick={() => voteMutation.mutate('approve')}
                    disabled={voteMutation.isPending}
                    className={clsx(
                      "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                      userVote?.vote === 'approve'
                        ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                        : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    )}
                  >
                    <ThumbsUp className="h-4 w-4" />
                    Approve ({voteSummary.approve})
                  </button>
                  <button
                    onClick={() => voteMutation.mutate('reject')}
                    disabled={voteMutation.isPending}
                    className={clsx(
                      "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                      userVote?.vote === 'reject'
                        ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                        : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    )}
                  >
                    <ThumbsDown className="h-4 w-4" />
                    Reject ({voteSummary.reject})
                  </button>
                  <button
                    onClick={() => voteMutation.mutate('needs_discussion')}
                    disabled={voteMutation.isPending}
                    className={clsx(
                      "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                      userVote?.vote === 'needs_discussion'
                        ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400"
                        : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    )}
                  >
                    <HelpCircle className="h-4 w-4" />
                    Discuss ({voteSummary.needs_discussion})
                  </button>
                </div>

                {/* Voter list */}
                {votes && votes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {votes.map(vote => (
                      <div
                        key={vote.id}
                        className={clsx(
                          "flex items-center gap-1 text-xs px-2 py-1 rounded-full",
                          vote.vote === 'approve' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                          vote.vote === 'reject' && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                          vote.vote === 'needs_discussion' && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                        )}
                      >
                        <User className="h-3 w-3" />
                        {getUserDisplayName(vote.users)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Discussion Section */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Discussion ({comments?.length || 0})
                </h3>

                {/* Comments list */}
                <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
                  {comments?.map(comment => (
                    <div key={comment.id} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-900 dark:text-white text-sm">
                          {getUserDisplayName(comment.users)}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-gray-700 dark:text-gray-300 text-sm">{comment.content}</p>
                      {(comment.suggested_weight || comment.suggested_shares) && (
                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600 flex items-center gap-4 text-xs">
                          {comment.suggested_weight && (
                            <span className="text-primary-600 dark:text-primary-400">
                              Suggested: {comment.suggested_weight}% weight
                            </span>
                          )}
                          {comment.suggested_shares && (
                            <span className="text-primary-600 dark:text-primary-400">
                              Suggested: {comment.suggested_shares.toLocaleString()} shares
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add comment form */}
                <div className="space-y-3">
                  <TextArea
                    placeholder="Add your thoughts on sizing, timing, or the trade idea..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    rows={2}
                  />
                  <div className="flex items-end gap-3">
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400">
                          Suggest Weight (%)
                        </label>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="e.g., 3.0"
                          value={suggestedWeight}
                          onChange={(e) => setSuggestedWeight(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400">
                          Suggest Shares
                        </label>
                        <Input
                          type="number"
                          step="1"
                          placeholder="e.g., 500"
                          value={suggestedShares}
                          onChange={(e) => setSuggestedShares(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                    </div>
                    <Button
                      onClick={() => addCommentMutation.mutate()}
                      disabled={!newComment.trim() || addCommentMutation.isPending}
                      loading={addCommentMutation.isPending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Status Actions */}
              {trade.status !== 'executed' && trade.status !== 'cancelled' && trade.status !== 'rejected' && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Actions
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {trade.status !== 'approved' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => updateStatusMutation.mutate('approved')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                    )}
                    {trade.status === 'approved' && (
                      <Button
                        size="sm"
                        onClick={() => updateStatusMutation.mutate('executed')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <TrendingUp className="h-4 w-4 mr-1" />
                        Mark Executed
                      </Button>
                    )}
                    {trade.status !== 'rejected' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => updateStatusMutation.mutate('rejected')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateStatusMutation.mutate('cancelled')}
                      disabled={updateStatusMutation.isPending}
                    >
                      Archive
                    </Button>
                  </div>
                </div>
              )}

              {/* Restore Actions for Archived Items */}
              {(trade.status === 'executed' || trade.status === 'cancelled' || trade.status === 'rejected') && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Restore Trade Idea
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    This trade idea is archived. You can restore it to an active status.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => updateStatusMutation.mutate('idea')}
                      disabled={updateStatusMutation.isPending}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Restore as Idea
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => updateStatusMutation.mutate('discussing')}
                      disabled={updateStatusMutation.isPending}
                    >
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Restore as Discussing
                    </Button>
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Created by {trade.users ? getUserDisplayName(trade.users) : 'Unknown'}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
