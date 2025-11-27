import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, Minus, HelpCircle, AlertTriangle, Sparkles,
  Link, ExternalLink, MoreHorizontal, Trash2, Pin, PinOff, Archive,
  MessageSquare, Share2, Clock, Hash, Globe, Users, Lock, Edit2
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

type Sentiment = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited'

interface QuickThought {
  id: string
  content: string
  sentiment: Sentiment | null
  source_type: string
  source_url: string | null
  source_title: string | null
  ticker_mentions: string[] | null
  tags: string[] | null
  visibility: 'private' | 'team' | 'public'
  is_pinned: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
  assets?: {
    id: string
    symbol: string
    company_name: string
  } | null
}

interface ThoughtsFeedProps {
  limit?: number
  showHeader?: boolean
  onAssetClick?: (assetId: string, symbol: string) => void
  filter?: 'all' | 'pinned' | 'bullish' | 'bearish'
}

const sentimentConfig: Record<Sentiment, { icon: typeof TrendingUp; color: string; bg: string; label: string }> = {
  bullish: { icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', label: 'Bullish' },
  bearish: { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', label: 'Bearish' },
  neutral: { icon: Minus, color: 'text-gray-600', bg: 'bg-gray-50', label: 'Neutral' },
  curious: { icon: HelpCircle, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Curious' },
  concerned: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Concerned' },
  excited: { icon: Sparkles, color: 'text-purple-600', bg: 'bg-purple-50', label: 'Excited' },
}

const visibilityIcons = {
  private: Lock,
  team: Users,
  public: Globe,
}

export function ThoughtsFeed({ limit = 10, showHeader = true, onAssetClick, filter = 'all' }: ThoughtsFeedProps) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: thoughts, isLoading } = useQuery({
    queryKey: ['quick-thoughts', filter, limit],
    queryFn: async () => {
      let query = supabase
        .from('quick_thoughts')
        .select(`
          *,
          assets (
            id,
            symbol,
            company_name
          )
        `)
        .eq('is_archived', false)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit)

      if (filter === 'pinned') {
        query = query.eq('is_pinned', true)
      } else if (filter === 'bullish') {
        query = query.eq('sentiment', 'bullish')
      } else if (filter === 'bearish') {
        query = query.eq('sentiment', 'bearish')
      }

      const { data, error } = await query

      if (error) throw error
      return data as QuickThought[]
    },
  })

  const togglePin = useMutation({
    mutationFn: async ({ id, isPinned }: { id: string; isPinned: boolean }) => {
      const { error } = await supabase
        .from('quick_thoughts')
        .update({ is_pinned: !isPinned })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts'] })
    },
  })

  const archiveThought = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('quick_thoughts')
        .update({ is_archived: true })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts'] })
    },
  })

  const deleteThought = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('quick_thoughts')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts'] })
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse p-3 bg-gray-50 rounded-lg">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (!thoughts || thoughts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
        <p className="font-medium">No thoughts yet</p>
        <p className="text-sm">Capture your first quick thought above</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Recent Thoughts</h3>
          <span className="text-xs text-gray-500">{thoughts.length} thoughts</span>
        </div>
      )}

      {thoughts.map((thought) => {
        const sentimentInfo = thought.sentiment ? sentimentConfig[thought.sentiment] : null
        const SentimentIcon = sentimentInfo?.icon
        const VisibilityIcon = visibilityIcons[thought.visibility]

        return (
          <div
            key={thought.id}
            className={clsx(
              "p-3 rounded-lg border transition-all",
              thought.is_pinned
                ? "bg-amber-50/50 border-amber-200"
                : "bg-white border-gray-100 hover:border-gray-200"
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center space-x-2">
                {thought.is_pinned && (
                  <Pin className="h-3 w-3 text-amber-500 fill-amber-500" />
                )}
                {sentimentInfo && SentimentIcon && (
                  <span className={clsx(
                    "inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-xs font-medium",
                    sentimentInfo.bg, sentimentInfo.color
                  )}>
                    <SentimentIcon className="h-3 w-3" />
                    <span>{sentimentInfo.label}</span>
                  </span>
                )}
                {thought.assets && (
                  <button
                    onClick={() => onAssetClick?.(thought.assets!.id, thought.assets!.symbol)}
                    className="text-xs font-semibold text-primary-600 hover:text-primary-700"
                  >
                    ${thought.assets.symbol}
                  </button>
                )}
              </div>

              {/* Actions menu */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(menuOpen === thought.id ? null : thought.id)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>

                {menuOpen === thought.id && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setMenuOpen(null)}
                    />
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] z-20">
                      <button
                        onClick={() => {
                          togglePin.mutate({ id: thought.id, isPinned: thought.is_pinned })
                          setMenuOpen(null)
                        }}
                        className="w-full flex items-center space-x-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        {thought.is_pinned ? (
                          <>
                            <PinOff className="h-4 w-4" />
                            <span>Unpin</span>
                          </>
                        ) : (
                          <>
                            <Pin className="h-4 w-4" />
                            <span>Pin</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          archiveThought.mutate(thought.id)
                          setMenuOpen(null)
                        }}
                        className="w-full flex items-center space-x-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Archive className="h-4 w-4" />
                        <span>Archive</span>
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this thought?')) {
                            deleteThought.mutate(thought.id)
                          }
                          setMenuOpen(null)
                        }}
                        className="w-full flex items-center space-x-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Content */}
            <p className="text-sm text-gray-900 whitespace-pre-wrap mb-2">
              {thought.content}
            </p>

            {/* Source link */}
            {thought.source_url && (
              <a
                href={thought.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-700 mb-2"
              >
                <Link className="h-3 w-3" />
                <span className="truncate max-w-[200px]">
                  {thought.source_title || thought.source_url}
                </span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}

            {/* Ticker mentions */}
            {thought.ticker_mentions && thought.ticker_mentions.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {thought.ticker_mentions.map(ticker => (
                  <span
                    key={ticker}
                    className="text-xs font-medium text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded"
                  >
                    ${ticker}
                  </span>
                ))}
              </div>
            )}

            {/* Tags */}
            {thought.tags && thought.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {thought.tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded"
                  >
                    <Hash className="h-3 w-3 mr-0.5" />
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-gray-400">
              <div className="flex items-center space-x-1">
                <Clock className="h-3 w-3" />
                <span>{formatDistanceToNow(new Date(thought.created_at), { addSuffix: true })}</span>
              </div>
              <div className="flex items-center space-x-1">
                <VisibilityIcon className="h-3 w-3" />
                <span className="capitalize">{thought.visibility}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
