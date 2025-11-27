import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Lightbulb, FileText, TrendingUp, MessageSquare, ChevronRight,
  Clock, TrendingDown, Minus, HelpCircle, AlertTriangle, Sparkles,
  Pin, Hash, Globe, Users, Lock, Target, Briefcase, Tag
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'

type ContentFilter = 'all' | 'thoughts' | 'trade-ideas' | 'notes'

interface ContentSectionProps {
  onAssetClick?: (assetId: string, symbol: string) => void
  onNoteClick?: (noteId: string, noteType: string, noteData: any) => void
  onTradeIdeaClick?: (tradeId: string) => void
}

type Sentiment = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited'

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

export function ContentSection({ onAssetClick, onNoteClick, onTradeIdeaClick }: ContentSectionProps) {
  const [filter, setFilter] = useState<ContentFilter>('all')

  // Fetch quick thoughts
  const { data: thoughts, isLoading: thoughtsLoading } = useQuery({
    queryKey: ['content-thoughts'],
    queryFn: async () => {
      const { data, error } = await supabase
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
        .limit(10)

      if (error) throw error
      return data
    },
  })

  // Fetch trade ideas (from trade_queue_items)
  const { data: tradeIdeas, isLoading: tradeIdeasLoading } = useQuery({
    queryKey: ['content-trade-ideas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name)
        `)
        .in('status', ['draft', 'proposed', 'discussing'])
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) throw error
      return data
    },
  })

  // Fetch recent notes
  const { data: notes, isLoading: notesLoading } = useQuery({
    queryKey: ['content-notes'],
    queryFn: async () => {
      // Get notes from all types using junction tables
      const [assetNotes, portfolioNotes, themeNotes] = await Promise.all([
        supabase
          .from('asset_notes')
          .select(`
            *,
            assets (
              id,
              symbol,
              company_name
            )
          `)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(5),
        supabase
          .from('portfolio_notes')
          .select(`
            *,
            portfolios (
              id,
              name
            )
          `)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(5),
        supabase
          .from('theme_notes')
          .select(`
            *,
            themes (
              id,
              name
            )
          `)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(5),
      ])

      // Combine and sort all notes
      const allNotes = [
        ...(assetNotes.data || []).map(note => ({
          ...note,
          noteType: 'asset',
          parentName: note.assets?.symbol,
          parentId: note.assets?.id
        })),
        ...(portfolioNotes.data || []).map(note => ({
          ...note,
          noteType: 'portfolio',
          parentName: note.portfolios?.name,
          parentId: note.portfolios?.id
        })),
        ...(themeNotes.data || []).map(note => ({
          ...note,
          noteType: 'theme',
          parentName: note.themes?.name,
          parentId: note.themes?.id
        })),
      ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 10)

      return allNotes
    },
  })

  const isLoading = thoughtsLoading || tradeIdeasLoading || notesLoading

  // Tab configuration
  const contentTabs = [
    { id: 'all' as const, label: 'All', icon: MessageSquare, color: 'gray' },
    { id: 'thoughts' as const, label: 'Thoughts', icon: Lightbulb, color: 'amber' },
    { id: 'trade-ideas' as const, label: 'Trade Ideas', icon: TrendingUp, color: 'emerald' },
    { id: 'notes' as const, label: 'Notes', icon: FileText, color: 'indigo' },
  ]

  // Combine all content for "all" filter
  const getAllContent = () => {
    const allContent: Array<{
      type: 'thought' | 'trade-idea' | 'note'
      data: any
      timestamp: Date
    }> = []

    if (thoughts) {
      thoughts.forEach(t => allContent.push({
        type: 'thought',
        data: t,
        timestamp: new Date(t.created_at)
      }))
    }

    if (tradeIdeas) {
      tradeIdeas.forEach(t => allContent.push({
        type: 'trade-idea',
        data: t,
        timestamp: new Date(t.created_at)
      }))
    }

    if (notes) {
      notes.forEach(n => allContent.push({
        type: 'note',
        data: n,
        timestamp: new Date(n.updated_at)
      }))
    }

    return allContent.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10)
  }

  const renderThoughtItem = (thought: any) => {
    const sentimentInfo = thought.sentiment ? sentimentConfig[thought.sentiment as Sentiment] : null
    const SentimentIcon = sentimentInfo?.icon
    const VisibilityIcon = visibilityIcons[thought.visibility as keyof typeof visibilityIcons]

    return (
      <div
        key={`thought-${thought.id}`}
        className={clsx(
          "p-3 rounded-lg border transition-all hover:shadow-sm cursor-pointer",
          thought.is_pinned
            ? "bg-amber-50/50 border-amber-200"
            : "bg-white border-gray-100 hover:border-gray-200"
        )}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded bg-amber-100">
              <Lightbulb className="h-3.5 w-3.5 text-amber-600" />
            </div>
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
                onClick={(e) => {
                  e.stopPropagation()
                  onAssetClick?.(thought.assets.id, thought.assets.symbol)
                }}
                className="text-xs font-semibold text-primary-600 hover:text-primary-700"
              >
                ${thought.assets.symbol}
              </button>
            )}
          </div>
          <span className="text-xs text-gray-400">Thought</span>
        </div>

        <p className="text-sm text-gray-900 line-clamp-2 mb-2">
          {thought.content}
        </p>

        {/* Tags */}
        {thought.tags && thought.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {thought.tags.slice(0, 3).map((tag: string) => (
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

        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center space-x-1">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(thought.created_at), { addSuffix: true })}</span>
          </div>
          {VisibilityIcon && (
            <div className="flex items-center space-x-1">
              <VisibilityIcon className="h-3 w-3" />
              <span className="capitalize">{thought.visibility}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderTradeIdeaItem = (trade: any) => {
    const actionColors: Record<string, { bg: string; text: string }> = {
      buy: { bg: 'bg-green-100', text: 'text-green-700' },
      sell: { bg: 'bg-red-100', text: 'text-red-700' },
      hold: { bg: 'bg-gray-100', text: 'text-gray-700' },
      trim: { bg: 'bg-amber-100', text: 'text-amber-700' },
      add: { bg: 'bg-blue-100', text: 'text-blue-700' },
    }
    const colors = actionColors[trade.action] || actionColors.hold

    return (
      <div
        key={`trade-${trade.id}`}
        onClick={() => onTradeIdeaClick?.(trade.id)}
        className="p-3 rounded-lg border border-gray-100 bg-white hover:border-gray-200 transition-all hover:shadow-sm cursor-pointer"
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded bg-emerald-100">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            {trade.assets && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onAssetClick?.(trade.assets.id, trade.assets.symbol)
                }}
                className="text-sm font-semibold text-gray-900 hover:text-primary-600"
              >
                {trade.assets.symbol}
              </button>
            )}
            <span className={clsx(
              "px-1.5 py-0.5 rounded text-xs font-medium uppercase",
              colors.bg, colors.text
            )}>
              {trade.action}
            </span>
          </div>
          <span className="text-xs text-gray-400">Trade Idea</span>
        </div>

        {trade.rationale && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-2">
            {trade.rationale}
          </p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {trade.portfolios && (
              <Badge variant="outline" size="sm">
                <Briefcase className="h-3 w-3 mr-1" />
                {trade.portfolios.name}
              </Badge>
            )}
            {trade.proposed_weight && (
              <span className="text-xs text-gray-500">
                {trade.proposed_weight}% target
              </span>
            )}
          </div>
          <div className="flex items-center space-x-1 text-xs text-gray-400">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}</span>
          </div>
        </div>
      </div>
    )
  }

  const renderNoteItem = (note: any) => {
    const typeIcons: Record<string, { icon: typeof FileText; color: string; bg: string }> = {
      asset: { icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-100' },
      portfolio: { icon: Briefcase, color: 'text-green-600', bg: 'bg-green-100' },
      theme: { icon: Tag, color: 'text-purple-600', bg: 'bg-purple-100' },
    }
    const typeConfig = typeIcons[note.noteType] || { icon: FileText, color: 'text-indigo-600', bg: 'bg-indigo-100' }
    const TypeIcon = typeConfig.icon

    return (
      <div
        key={`note-${note.id}`}
        onClick={() => onNoteClick?.(note.id, note.noteType, note)}
        className="p-3 rounded-lg border border-gray-100 bg-white hover:border-gray-200 transition-all hover:shadow-sm cursor-pointer"
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center space-x-2">
            <div className={clsx("p-1.5 rounded", typeConfig.bg)}>
              <TypeIcon className={clsx("h-3.5 w-3.5", typeConfig.color)} />
            </div>
            <span className="text-sm font-medium text-gray-900">
              {note.title || 'Untitled Note'}
            </span>
            {note.parentName && (
              <span className="text-xs text-gray-500">
                on {note.noteType === 'asset' ? '$' : ''}{note.parentName}
              </span>
            )}
          </div>
          <span className="text-xs text-gray-400">Note</span>
        </div>

        {note.content && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-2">
            {note.content.replace(/<[^>]*>/g, '').slice(0, 150)}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-gray-400">
          <Badge variant="outline" size="sm" className="capitalize">
            {note.noteType}
          </Badge>
          <div className="flex items-center space-x-1">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}</span>
          </div>
        </div>
      </div>
    )
  }

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse p-3 bg-gray-50 rounded-lg">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      )
    }

    let items: JSX.Element[] = []

    switch (filter) {
      case 'thoughts':
        items = (thoughts || []).map(renderThoughtItem)
        break
      case 'trade-ideas':
        items = (tradeIdeas || []).map(renderTradeIdeaItem)
        break
      case 'notes':
        items = (notes || []).map(renderNoteItem)
        break
      case 'all':
      default:
        const allContent = getAllContent()
        items = allContent.map(item => {
          switch (item.type) {
            case 'thought':
              return renderThoughtItem(item.data)
            case 'trade-idea':
              return renderTradeIdeaItem(item.data)
            case 'note':
              return renderNoteItem(item.data)
          }
        })
        break
    }

    if (items.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No content yet</p>
          <p className="text-sm">
            {filter === 'thoughts' && 'Capture your first quick thought'}
            {filter === 'trade-ideas' && 'Create your first trade idea'}
            {filter === 'notes' && 'Write your first note'}
            {filter === 'all' && 'Start adding thoughts, trade ideas, and notes'}
          </p>
        </div>
      )
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items}
      </div>
    )
  }

  // Get view all type based on current filter
  const getViewAllConfig = () => {
    switch (filter) {
      case 'thoughts':
        return { type: 'thoughts', title: 'Thoughts' }
      case 'trade-ideas':
        return { type: 'trade-queue', title: 'Trade Queue' }
      case 'notes':
        return { type: 'notes-list', title: 'Notes' }
      default:
        return null
    }
  }

  const viewAllConfig = getViewAllConfig()

  return (
    <Card className="border-l-4 border-l-indigo-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
            <FileText className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Content</h2>
            <p className="text-sm text-gray-500">Your thoughts, ideas, and notes</p>
          </div>
        </div>
        {viewAllConfig && (
          <button
            onClick={() => {
              // This would need to be handled by the parent component
              console.log('View all:', viewAllConfig)
            }}
            className="flex items-center space-x-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            <span>View all {viewAllConfig.title}</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center space-x-1 mb-4 bg-gray-100 rounded-lg p-1">
        {contentTabs.map(tab => {
          const Icon = tab.icon
          const isActive = filter === tab.id
          const count = tab.id === 'all'
            ? (thoughts?.length || 0) + (tradeIdeas?.length || 0) + (notes?.length || 0)
            : tab.id === 'thoughts'
              ? thoughts?.length || 0
              : tab.id === 'trade-ideas'
                ? tradeIdeas?.length || 0
                : notes?.length || 0

          return (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={clsx(
                "flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center",
                isActive
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              <Icon className={clsx("h-4 w-4", isActive && `text-${tab.color}-500`)} />
              <span className="hidden md:inline">{tab.label}</span>
              {count > 0 && (
                <span className={clsx(
                  "px-1.5 py-0.5 rounded-full text-xs font-semibold",
                  isActive ? `bg-${tab.color}-100 text-${tab.color}-700` : "bg-gray-200 text-gray-600"
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="min-h-[200px]">
        {renderContent()}
      </div>
    </Card>
  )
}
