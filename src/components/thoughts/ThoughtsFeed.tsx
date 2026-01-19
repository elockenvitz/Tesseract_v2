import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, Minus, HelpCircle, AlertTriangle, Sparkles,
  Link, ExternalLink, MoreHorizontal, Trash2, Pin, PinOff, Archive,
  MessageSquare, Clock, Hash, Globe, Users, Lock, Edit2,
  Lightbulb, ArrowLeftRight, Zap, AlertCircle, CheckCircle, XCircle,
  ChevronRight, ChevronLeft, FolderKanban, Building2, Briefcase, UsersRound
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

type Sentiment = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited'
type TradeAction = 'buy' | 'sell'
type TradeUrgency = 'low' | 'medium' | 'high' | 'urgent'

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
  idea_type?: string
  assets?: {
    id: string
    symbol: string
    company_name: string
  } | null
}

type Visibility = 'private' | 'team' | 'public'

interface TradeIdea {
  id: string
  asset_id: string
  action: TradeAction
  urgency: TradeUrgency
  visibility: Visibility
  rationale: string | null
  status: string
  pair_id: string | null
  portfolio_id: string | null
  created_at: string
  created_by: string
  assets?: {
    id: string
    symbol: string
    company_name: string
  } | null
  portfolios?: {
    id: string
    name: string
  } | null
}

interface GroupedPairTrade {
  pair_id: string
  longs: TradeIdea[]
  shorts: TradeIdea[]
  urgency: TradeUrgency
  visibility: Visibility
  rationale: string | null
  created_at: string
  portfolio: { id: string; name: string } | null
}

type FeedItem =
  | { type: 'thought'; data: QuickThought }
  | { type: 'trade'; data: TradeIdea }
  | { type: 'pair'; data: GroupedPairTrade }

type FilterType = 'all' | 'thoughts' | 'trades' | 'pinned'

interface ThoughtsFeedProps {
  limit?: number
  showHeader?: boolean
  onAssetClick?: (assetId: string, symbol: string) => void
  onOpenDiscussion?: (contextType: string, contextId: string, contextTitle: string) => void
  filter?: FilterType
}

const sentimentConfig: Record<Sentiment, { icon: typeof TrendingUp; color: string; bg: string; label: string }> = {
  bullish: { icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', label: 'Bullish' },
  bearish: { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', label: 'Bearish' },
  neutral: { icon: Minus, color: 'text-slate-700', bg: 'bg-slate-100', label: 'Neutral' },
  curious: { icon: HelpCircle, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Curious' },
  concerned: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Concerned' },
  excited: { icon: Sparkles, color: 'text-purple-600', bg: 'bg-purple-50', label: 'Excited' },
}

const urgencyConfig: Record<TradeUrgency, { color: string; bg: string; border: string; label: string }> = {
  low: { color: 'text-slate-700', bg: 'bg-slate-100', border: 'border-slate-300', label: 'Low' },
  medium: { color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', label: 'Medium' },
  high: { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', label: 'High' },
  urgent: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: 'Urgent' },
}

const visibilityIcons = {
  private: Lock,
  team: Users,
  public: Globe,
}

type OrgNodeType = 'division' | 'department' | 'team' | 'portfolio'
type MenuView = 'main' | 'urgency' | 'visibility' | 'visibilityCategory' | 'visibilityItems'

const orgCategoryConfig: { value: OrgNodeType; label: string; icon: typeof Building2; color: string }[] = [
  { value: 'division', label: 'Divisions', icon: Building2, color: 'bg-blue-500' },
  { value: 'department', label: 'Departments', icon: Briefcase, color: 'bg-purple-500' },
  { value: 'team', label: 'Teams', icon: UsersRound, color: 'bg-green-500' },
  { value: 'portfolio', label: 'Portfolios', icon: FolderKanban, color: 'bg-amber-500' },
]

export function ThoughtsFeed({ limit = 10, showHeader = true, onAssetClick, onOpenDiscussion, filter = 'all' }: ThoughtsFeedProps) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [menuView, setMenuView] = useState<MenuView>('main')
  const [selectedOrgCategory, setSelectedOrgCategory] = useState<OrgNodeType | null>(null)
  const queryClient = useQueryClient()

  // Fetch thoughts
  const { data: thoughts, isLoading: thoughtsLoading } = useQuery({
    queryKey: ['quick-thoughts', filter, limit],
    queryFn: async () => {
      if (filter === 'trades') return []

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
      }

      const { data, error } = await query

      if (error) throw error
      return data as QuickThought[]
    },
  })

  // Fetch trade ideas
  const { data: tradeIdeas, isLoading: tradesLoading } = useQuery({
    queryKey: ['trade-ideas-feed', filter, limit],
    queryFn: async () => {
      if (filter === 'thoughts' || filter === 'pinned') return []

      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (
            id,
            symbol,
            company_name
          ),
          portfolios (
            id,
            name
          )
        `)
        .eq('status', 'idea')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data as TradeIdea[]
    },
  })

  // Get org chart nodes for visibility options
  const { data: orgChartNodes } = useQuery({
    queryKey: ['org-chart-nodes-visibility'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type')
        .order('name')
      if (error) throw error
      return data
    },
  })

  const orgNodesByType = {
    division: orgChartNodes?.filter(n => n.node_type === 'division') || [],
    department: orgChartNodes?.filter(n => n.node_type === 'department') || [],
    team: orgChartNodes?.filter(n => n.node_type === 'team') || [],
    portfolio: orgChartNodes?.filter(n => n.node_type === 'portfolio') || [],
  }

  const isLoading = thoughtsLoading || tradesLoading

  // Group pair trades and merge into unified feed
  const feedItems: FeedItem[] = (() => {
    const items: FeedItem[] = []

    // Add thoughts
    if (thoughts) {
      thoughts.forEach(thought => {
        items.push({ type: 'thought', data: thought })
      })
    }

    // Group trade ideas by pair_id
    if (tradeIdeas) {
      const pairGroups = new Map<string, TradeIdea[]>()
      const singleTrades: TradeIdea[] = []

      tradeIdeas.forEach(trade => {
        if (trade.pair_id) {
          const existing = pairGroups.get(trade.pair_id) || []
          existing.push(trade)
          pairGroups.set(trade.pair_id, existing)
        } else {
          singleTrades.push(trade)
        }
      })

      // Add single trades
      singleTrades.forEach(trade => {
        items.push({ type: 'trade', data: trade })
      })

      // Add grouped pair trades
      pairGroups.forEach((trades, pairId) => {
        const longs = trades.filter(t => t.action === 'buy')
        const shorts = trades.filter(t => t.action === 'sell')
        const firstTrade = trades[0]

        items.push({
          type: 'pair',
          data: {
            pair_id: pairId,
            longs,
            shorts,
            urgency: firstTrade.urgency,
            visibility: firstTrade.visibility || 'private',
            rationale: firstTrade.rationale,
            created_at: firstTrade.created_at,
            portfolio: firstTrade.portfolios || null,
          }
        })
      })
    }

    // Sort by created_at descending, with pinned thoughts first
    items.sort((a, b) => {
      // Pinned thoughts always first
      if (a.type === 'thought' && a.data.is_pinned && !(b.type === 'thought' && b.data.is_pinned)) return -1
      if (b.type === 'thought' && b.data.is_pinned && !(a.type === 'thought' && a.data.is_pinned)) return 1

      const aDate = a.type === 'pair' ? a.data.created_at : a.data.created_at
      const bDate = b.type === 'pair' ? b.data.created_at : b.data.created_at
      return new Date(bDate).getTime() - new Date(aDate).getTime()
    })

    return items.slice(0, limit)
  })()

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

  // Trade idea mutations - soft delete by setting status to 'deleted'
  const deleteTradeIdea = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ status: 'deleted' })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  const deletePairTrade = useMutation({
    mutationFn: async (pairId: string) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ status: 'deleted' })
        .eq('pair_id', pairId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  const updateTradeUrgency = useMutation({
    mutationFn: async ({ id, urgency, pairId }: { id?: string; urgency: TradeUrgency; pairId?: string }) => {
      if (pairId) {
        const { error } = await supabase
          .from('trade_queue_items')
          .update({ urgency })
          .eq('pair_id', pairId)
        if (error) throw error
      } else if (id) {
        const { error } = await supabase
          .from('trade_queue_items')
          .update({ urgency })
          .eq('id', id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  const updateTradeVisibility = useMutation({
    mutationFn: async ({ id, visibility, pairId }: { id?: string; visibility: Visibility; pairId?: string }) => {
      if (pairId) {
        const { error } = await supabase
          .from('trade_queue_items')
          .update({ visibility })
          .eq('pair_id', pairId)
        if (error) throw error
      } else if (id) {
        const { error } = await supabase
          .from('trade_queue_items')
          .update({ visibility })
          .eq('id', id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
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

  if (feedItems.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
        <p className="font-medium">No ideas yet</p>
        <p className="text-sm">Capture your first thought or trade idea above</p>
      </div>
    )
  }

  // Render a thought card
  const renderThought = (thought: QuickThought) => {
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
          <div className="flex items-center gap-2 flex-wrap">
            {thought.is_pinned && (
              <Pin className="h-3 w-3 text-amber-500 fill-amber-500" />
            )}
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-600">
              <Lightbulb className="h-3 w-3" />
              <span>Thought</span>
            </span>
            {sentimentInfo && SentimentIcon && (
              <span className={clsx(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
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
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] z-20">
                  <button
                    onClick={() => {
                      togglePin.mutate({ id: thought.id, isPinned: thought.is_pinned })
                      setMenuOpen(null)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {thought.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    <span>{thought.is_pinned ? 'Unpin' : 'Pin'}</span>
                  </button>
                  <button
                    onClick={() => {
                      archiveThought.mutate(thought.id)
                      setMenuOpen(null)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
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
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
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
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mb-2"
          >
            <Link className="h-3 w-3" />
            <span className="truncate max-w-[200px]">{thought.source_title || thought.source_url}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* Tags */}
        {thought.tags && thought.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {thought.tags.map(tag => (
              <span key={tag} className="inline-flex items-center text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                <Hash className="h-3 w-3 mr-0.5" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(thought.created_at), { addSuffix: true })}</span>
          </div>
          <div className="flex items-center gap-1">
            <VisibilityIcon className="h-3 w-3" />
            <span className="capitalize">{thought.visibility}</span>
          </div>
        </div>
      </div>
    )
  }

  // Render a single trade idea card
  const renderTradeIdea = (trade: TradeIdea) => {
    const urgencyInfo = urgencyConfig[trade.urgency]
    const menuId = `trade-${trade.id}`
    const VisibilityIcon = visibilityIcons[trade.visibility || 'private']
    const tradeTitle = `${trade.action === 'buy' ? 'Long' : 'Short'} ${trade.assets?.symbol || 'Trade'}`

    return (
      <div key={trade.id} className="p-3 rounded-lg border border-gray-100 bg-white hover:border-gray-200 transition-all">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-3 w-3" />
              <span>Trade</span>
            </span>
            <span className={clsx(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
              trade.action === 'buy' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            )}>
              {trade.action === 'buy' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span className="capitalize">{trade.action}</span>
            </span>
            {trade.assets && (
              <button
                onClick={() => onAssetClick?.(trade.assets!.id, trade.assets!.symbol)}
                className="text-sm font-semibold text-gray-900 hover:text-primary-600"
              >
                {trade.assets.symbol}
              </button>
            )}
            <span className={clsx("px-1.5 py-0.5 rounded text-xs font-medium", urgencyInfo.bg, urgencyInfo.color)}>
              {urgencyInfo.label}
            </span>
          </div>

          {/* Actions menu */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (menuOpen === menuId) {
                  setMenuOpen(null)
                  setMenuView('main')
                  setSelectedOrgCategory(null)
                } else {
                  setMenuOpen(menuId)
                  setMenuView('main')
                  setSelectedOrgCategory(null)
                }
              }}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen === menuId && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => { setMenuOpen(null); setMenuView('main'); setSelectedOrgCategory(null) }} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px] z-20">
                  {/* Main Menu */}
                  {menuView === 'main' && (
                    <>
                      {onOpenDiscussion && (
                        <button
                          onClick={() => {
                            onOpenDiscussion('trade_idea', trade.id, tradeTitle)
                            setMenuOpen(null)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <MessageSquare className="h-4 w-4" />
                          <span>Discuss</span>
                        </button>
                      )}

                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('urgency') }}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <span className="flex items-center gap-2">
                          <Zap className="h-4 w-4" />
                          <span>Urgency</span>
                        </span>
                        <ChevronRight className="h-3 w-3" />
                      </button>

                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('visibility') }}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <span className="flex items-center gap-2">
                          <VisibilityIcon className="h-4 w-4" />
                          <span>Visibility</span>
                        </span>
                        <ChevronRight className="h-3 w-3" />
                      </button>

                      <div className="border-t border-gray-100 my-1" />

                      <button
                        onClick={() => {
                          if (confirm('Delete this trade idea?')) {
                            deleteTradeIdea.mutate(trade.id)
                          }
                          setMenuOpen(null)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </button>
                    </>
                  )}

                  {/* Urgency View */}
                  {menuView === 'urgency' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('main') }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Urgency</div>
                      {(['low', 'medium', 'high', 'urgent'] as const).map(u => (
                        <button
                          key={u}
                          onClick={() => {
                            updateTradeUrgency.mutate({ id: trade.id, urgency: u })
                            setMenuOpen(null)
                            setMenuView('main')
                          }}
                          className={clsx(
                            "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50",
                            trade.urgency === u ? "bg-gray-100 font-medium" : ""
                          )}
                        >
                          <span className={clsx("w-2 h-2 rounded-full", urgencyConfig[u].bg)} />
                          <span className={urgencyConfig[u].color}>{urgencyConfig[u].label}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Visibility View */}
                  {menuView === 'visibility' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('main') }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Visibility</div>

                      <button
                        onClick={() => {
                          updateTradeVisibility.mutate({ id: trade.id, visibility: 'private' })
                          setMenuOpen(null)
                          setMenuView('main')
                        }}
                        className={clsx(
                          "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50",
                          (trade.visibility || 'private') === 'private' ? "bg-gray-100 font-medium" : ""
                        )}
                      >
                        <Lock className="h-4 w-4" />
                        <span>Private</span>
                      </button>

                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('visibilityCategory') }}
                        className={clsx(
                          "w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50",
                          trade.visibility === 'team' ? "bg-gray-100 font-medium" : ""
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          <span>Organization</span>
                        </span>
                        <ChevronRight className="h-3 w-3" />
                      </button>

                      <button
                        onClick={() => {
                          updateTradeVisibility.mutate({ id: trade.id, visibility: 'public' })
                          setMenuOpen(null)
                          setMenuView('main')
                        }}
                        className={clsx(
                          "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50",
                          trade.visibility === 'public' ? "bg-gray-100 font-medium" : ""
                        )}
                      >
                        <Globe className="h-4 w-4" />
                        <span>Public</span>
                      </button>
                    </>
                  )}

                  {/* Visibility Category Selection */}
                  {menuView === 'visibilityCategory' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('visibility') }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Select Type</div>
                      {orgCategoryConfig.map(cat => {
                        const CatIcon = cat.icon
                        const count = orgNodesByType[cat.value]?.length || 0
                        return (
                          <button
                            key={cat.value}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedOrgCategory(cat.value)
                              setMenuView('visibilityItems')
                            }}
                            disabled={count === 0}
                            className={clsx(
                              "w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50",
                              count === 0 && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <span className={clsx("w-6 h-6 rounded flex items-center justify-center text-white", cat.color)}>
                                <CatIcon className="h-3.5 w-3.5" />
                              </span>
                              <span>{cat.label}</span>
                            </span>
                            <span className="text-xs text-gray-400">{count}</span>
                          </button>
                        )
                      })}
                    </>
                  )}

                  {/* Visibility Items Selection */}
                  {menuView === 'visibilityItems' && selectedOrgCategory && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('visibilityCategory') }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">
                        {orgCategoryConfig.find(c => c.value === selectedOrgCategory)?.label}
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {orgNodesByType[selectedOrgCategory]?.map(node => (
                          <button
                            key={node.id}
                            onClick={() => {
                              updateTradeVisibility.mutate({ id: trade.id, visibility: 'team' })
                              setMenuOpen(null)
                              setMenuView('main')
                              setSelectedOrgCategory(null)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
                          >
                            <span>{node.name}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Clickable content area */}
        <div
          className={onOpenDiscussion ? "cursor-pointer" : ""}
          onClick={() => onOpenDiscussion?.('trade_idea', trade.id, tradeTitle)}
        >
          {/* Rationale */}
          {trade.rationale && (
            <p className="text-sm text-gray-600 mb-2">{trade.rationale}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}</span>
          </div>
          <div className="flex items-center gap-3">
            {trade.portfolios && (
              <div className="flex items-center gap-1">
                <FolderKanban className="h-3 w-3" />
                <span>{trade.portfolios.name}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <VisibilityIcon className="h-3 w-3" />
              <span className="capitalize">{trade.visibility || 'private'}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Render a pair/basket trade card
  const renderPairTrade = (pair: GroupedPairTrade) => {
    const urgencyInfo = urgencyConfig[pair.urgency]
    const menuId = `pair-${pair.pair_id}`
    const VisibilityIcon = visibilityIcons[pair.visibility || 'private']

    // Build title from symbols
    const longSymbols = pair.longs.map(t => t.assets?.symbol).filter(Boolean).join('/')
    const shortSymbols = pair.shorts.map(t => t.assets?.symbol).filter(Boolean).join('/')
    const pairTitle = `${longSymbols} / ${shortSymbols} Pair`

    return (
      <div key={pair.pair_id} className="p-3 rounded-lg border border-gray-100 bg-white hover:border-gray-200 transition-all">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-600">
              <ArrowLeftRight className="h-3 w-3" />
              <span>Pair Trade</span>
            </span>
            <span className={clsx("px-1.5 py-0.5 rounded text-xs font-medium", urgencyInfo.bg, urgencyInfo.color)}>
              {urgencyInfo.label}
            </span>
          </div>

          {/* Actions menu */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (menuOpen === menuId) {
                  setMenuOpen(null)
                  setMenuView('main')
                  setSelectedOrgCategory(null)
                } else {
                  setMenuOpen(menuId)
                  setMenuView('main')
                  setSelectedOrgCategory(null)
                }
              }}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen === menuId && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => { setMenuOpen(null); setMenuView('main'); setSelectedOrgCategory(null) }} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px] z-20">
                  {/* Main Menu */}
                  {menuView === 'main' && (
                    <>
                      {onOpenDiscussion && (
                        <button
                          onClick={() => {
                            onOpenDiscussion('trade_idea', pair.pair_id, pairTitle)
                            setMenuOpen(null)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <MessageSquare className="h-4 w-4" />
                          <span>Discuss</span>
                        </button>
                      )}

                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('urgency') }}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <span className="flex items-center gap-2">
                          <Zap className="h-4 w-4" />
                          <span>Urgency</span>
                        </span>
                        <ChevronRight className="h-3 w-3" />
                      </button>

                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('visibility') }}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <span className="flex items-center gap-2">
                          <VisibilityIcon className="h-4 w-4" />
                          <span>Visibility</span>
                        </span>
                        <ChevronRight className="h-3 w-3" />
                      </button>

                      <div className="border-t border-gray-100 my-1" />

                      <button
                        onClick={() => {
                          if (confirm('Delete this pair trade?')) {
                            deletePairTrade.mutate(pair.pair_id)
                          }
                          setMenuOpen(null)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </button>
                    </>
                  )}

                  {/* Urgency View */}
                  {menuView === 'urgency' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('main') }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Urgency</div>
                      {(['low', 'medium', 'high', 'urgent'] as const).map(u => (
                        <button
                          key={u}
                          onClick={() => {
                            updateTradeUrgency.mutate({ pairId: pair.pair_id, urgency: u })
                            setMenuOpen(null)
                            setMenuView('main')
                          }}
                          className={clsx(
                            "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50",
                            pair.urgency === u ? "bg-gray-100 font-medium" : ""
                          )}
                        >
                          <span className={clsx("w-2 h-2 rounded-full", urgencyConfig[u].bg)} />
                          <span className={urgencyConfig[u].color}>{urgencyConfig[u].label}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Visibility View */}
                  {menuView === 'visibility' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('main') }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Visibility</div>

                      <button
                        onClick={() => {
                          updateTradeVisibility.mutate({ pairId: pair.pair_id, visibility: 'private' })
                          setMenuOpen(null)
                          setMenuView('main')
                        }}
                        className={clsx(
                          "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50",
                          (pair.visibility || 'private') === 'private' ? "bg-gray-100 font-medium" : ""
                        )}
                      >
                        <Lock className="h-4 w-4" />
                        <span>Private</span>
                      </button>

                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('visibilityCategory') }}
                        className={clsx(
                          "w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50",
                          pair.visibility === 'team' ? "bg-gray-100 font-medium" : ""
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          <span>Organization</span>
                        </span>
                        <ChevronRight className="h-3 w-3" />
                      </button>

                      <button
                        onClick={() => {
                          updateTradeVisibility.mutate({ pairId: pair.pair_id, visibility: 'public' })
                          setMenuOpen(null)
                          setMenuView('main')
                        }}
                        className={clsx(
                          "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50",
                          pair.visibility === 'public' ? "bg-gray-100 font-medium" : ""
                        )}
                      >
                        <Globe className="h-4 w-4" />
                        <span>Public</span>
                      </button>
                    </>
                  )}

                  {/* Visibility Category Selection */}
                  {menuView === 'visibilityCategory' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('visibility') }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Select Type</div>
                      {orgCategoryConfig.map(cat => {
                        const CatIcon = cat.icon
                        const count = orgNodesByType[cat.value]?.length || 0
                        return (
                          <button
                            key={cat.value}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedOrgCategory(cat.value)
                              setMenuView('visibilityItems')
                            }}
                            disabled={count === 0}
                            className={clsx(
                              "w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50",
                              count === 0 && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <span className={clsx("w-6 h-6 rounded flex items-center justify-center text-white", cat.color)}>
                                <CatIcon className="h-3.5 w-3.5" />
                              </span>
                              <span>{cat.label}</span>
                            </span>
                            <span className="text-xs text-gray-400">{count}</span>
                          </button>
                        )
                      })}
                    </>
                  )}

                  {/* Visibility Items Selection */}
                  {menuView === 'visibilityItems' && selectedOrgCategory && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuView('visibilityCategory') }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">
                        {orgCategoryConfig.find(c => c.value === selectedOrgCategory)?.label}
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {orgNodesByType[selectedOrgCategory]?.map(node => (
                          <button
                            key={node.id}
                            onClick={() => {
                              updateTradeVisibility.mutate({ pairId: pair.pair_id, visibility: 'team' })
                              setMenuOpen(null)
                              setMenuView('main')
                              setSelectedOrgCategory(null)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
                          >
                            <span>{node.name}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Clickable content area */}
        <div
          className={onOpenDiscussion ? "cursor-pointer" : ""}
          onClick={() => onOpenDiscussion?.('trade_idea', pair.pair_id, pairTitle)}
        >
          {/* Pair legs - clean split view */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            {/* Long side */}
            <div className="bg-green-50/50 border border-green-100 rounded-md p-2">
              <div className="flex items-center gap-1 mb-1.5">
                <TrendingUp className="h-3 w-3 text-green-600" />
                <span className="text-xs font-medium text-green-700">Long</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {pair.longs.map(t => (
                  <button
                    key={t.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      t.assets && onAssetClick?.(t.assets.id, t.assets.symbol)
                    }}
                    className="text-xs font-semibold text-green-800 bg-green-100 px-1.5 py-0.5 rounded hover:bg-green-200 transition-colors"
                  >
                    {t.assets?.symbol}
                  </button>
                ))}
              </div>
            </div>

            {/* Short side */}
            <div className="bg-red-50/50 border border-red-100 rounded-md p-2">
              <div className="flex items-center gap-1 mb-1.5">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs font-medium text-red-700">Short</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {pair.shorts.map(t => (
                  <button
                    key={t.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      t.assets && onAssetClick?.(t.assets.id, t.assets.symbol)
                    }}
                    className="text-xs font-semibold text-red-800 bg-red-100 px-1.5 py-0.5 rounded hover:bg-red-200 transition-colors"
                  >
                    {t.assets?.symbol}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Rationale */}
          {pair.rationale && (
            <p className="text-sm text-gray-600 mb-2">{pair.rationale}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(pair.created_at), { addSuffix: true })}</span>
          </div>
          <div className="flex items-center gap-3">
            {pair.portfolio && (
              <div className="flex items-center gap-1">
                <FolderKanban className="h-3 w-3" />
                <span>{pair.portfolio.name}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <VisibilityIcon className="h-3 w-3" />
              <span className="capitalize">{pair.visibility || 'private'}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Recent Ideas</h3>
          <span className="text-xs text-gray-500">{feedItems.length} items</span>
        </div>
      )}

      {feedItems.map((item) => {
        if (item.type === 'thought') {
          return renderThought(item.data)
        } else if (item.type === 'trade') {
          return renderTradeIdea(item.data)
        } else if (item.type === 'pair') {
          return renderPairTrade(item.data)
        }
        return null
      })}
    </div>
  )
}
