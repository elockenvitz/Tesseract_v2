import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Lightbulb, TrendingUp, Target, FileText, Briefcase, Tag, Shuffle, RefreshCw,
  Calendar, ArrowUpRight, AlertTriangle, Star, Clock, Activity,
  ChevronRight, Users, Eye, Heart, MessageSquare, Share2, Bookmark,
  Play, Pause, Volume2, VolumeX, MoreHorizontal, ThumbsUp, ThumbsDown,
  ArrowLeft, ArrowRight, BarChart3, Brain,
  Zap, TrendingDown, Award, Bell, Search, Plus
} from 'lucide-react'
import { priorityConfig } from '../utils/priorityBadge'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { TabStateManager } from '../lib/tabStateManager'

interface IdeaGeneratorPageProps {
  onItemSelect?: (item: any) => void
}

interface IdeaTile {
  id: string
  type: 'asset' | 'note' | 'price_target' | 'theme' | 'portfolio' | 'insight'
  title: string
  subtitle?: string
  content: string
  priority?: 'high' | 'medium' | 'low'
  urgency?: 'urgent' | 'normal' | 'low'
  data: any
  color: string
  iconType: string
  actionText: string
  reason?: string
}

interface FeedContent {
  id: string
  type: 'market_insight' | 'research_tip' | 'portfolio_alert' | 'trend_analysis' | 'educational' | 'earnings_preview' | 'sector_rotation' | 'risk_alert' | 'technical_analysis' | 'international' | 'crypto_insight' | 'dividend_focus' | 'small_cap'
  title: string
  content: string
  visual?: string
  author: string
  timestamp: string
  likes: number
  comments: number
  shares: number
  tags: string[]
  reason: string
}

interface WorkflowAsset {
  id: string
  symbol: string
  company_name: string
  stage: string
  priority: 'high' | 'medium' | 'low'
  last_updated: string
  assigned_to?: string
  due_date?: string
  progress_percentage: number
  is_started: boolean
  completeness: number
}

type ViewType = 'discovery' | 'feed'

export function IdeaGeneratorPage({ onItemSelect }: IdeaGeneratorPageProps) {
  // Priority configuration now imported from standardized utility

  // Load initial state from TabStateManager
  const loadedState = TabStateManager.loadTabState('idea-generator')

  const [activeView, setActiveView] = useState<ViewType>(loadedState?.activeView || 'discovery')
  const [tiles, setTiles] = useState<IdeaTile[]>(loadedState?.tiles || [])
  const [allTiles, setAllTiles] = useState<IdeaTile[]>([]) // Store all generated tiles
  const [searchQuery, setSearchQuery] = useState<string>('') // Search query for discovery
  const [isShuffling, setIsShuffling] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [currentFeedIndex, setCurrentFeedIndex] = useState(loadedState?.currentFeedIndex || 0)


  // Extended feed content for discovery with reasons
  const allFeedContent: FeedContent[] = [
    {
      id: '1',
      type: 'market_insight',
      title: 'Tech Stocks Rally Continues',
      content: 'The technology sector is showing strong momentum with FAANG stocks leading the charge. Key drivers include strong Q3 earnings, AI adoption, and cloud growth. Watch for potential resistance at key technical levels.',
      author: 'AI Market Analyst',
      timestamp: '2 hours ago',
      likes: 1247,
      comments: 89,
      shares: 156,
      tags: ['Technology', 'FAANG', 'Earnings', 'AI'],
      reason: 'Based on your active tech holdings'
    },
    {
      id: '2',
      type: 'research_tip',
      title: 'How to Analyze P/E Ratios',
      content: 'When evaluating P/E ratios, consider: 1) Industry averages 2) Growth rates (PEG ratio) 3) Economic cycles 4) Company lifecycle stage. A high P/E isn\'t always bad if justified by growth prospects.',
      author: 'Research Expert',
      timestamp: '4 hours ago',
      likes: 892,
      comments: 45,
      shares: 203,
      tags: ['Education', 'Valuation', 'P/E Ratio', 'Research'],
      reason: 'Recommended for your research workflow'
    },
    {
      id: '3',
      type: 'portfolio_alert',
      title: 'Rebalancing Opportunity',
      content: 'Your tech allocation has grown to 35% of your portfolio, above your 30% target. Consider taking some profits and rebalancing into undervalued sectors like healthcare or utilities.',
      author: 'Portfolio Manager AI',
      timestamp: '1 day ago',
      likes: 234,
      comments: 12,
      shares: 67,
      tags: ['Portfolio', 'Rebalancing', 'Risk Management'],
      reason: 'Portfolio optimization alert'
    },
    {
      id: '4',
      type: 'trend_analysis',
      title: 'ESG Investing Momentum',
      content: 'ESG-focused funds have seen 23% increased inflows this quarter. Companies with strong ESG ratings are trading at premium valuations. This trend is driven by millennial investors and regulatory pressure.',
      author: 'Trend Analyst',
      timestamp: '2 days ago',
      likes: 567,
      comments: 78,
      shares: 134,
      tags: ['ESG', 'Sustainability', 'Trends', 'Millennials'],
      reason: 'Trending in your network'
    },
    {
      id: '5',
      type: 'educational',
      title: 'Understanding Options Greeks',
      content: 'Delta measures price sensitivity, Gamma shows delta\'s rate of change, Theta represents time decay, and Vega indicates volatility sensitivity. Master these to improve your options trading strategy.',
      author: 'Options Educator',
      timestamp: '3 days ago',
      likes: 1156,
      comments: 167,
      shares: 289,
      tags: ['Options', 'Greeks', 'Education', 'Trading'],
      reason: 'Educational content you might like'
    },
    {
      id: '6',
      type: 'market_insight',
      title: 'Semiconductor Shortage Update',
      content: 'Global chip shortage continues to impact auto and tech sectors. Intel and TSMC are expanding fab capacity, but relief won\'t come until 2025. Consider semiconductor ETFs for exposure to the recovery.',
      author: 'Semiconductor Analyst',
      timestamp: '5 hours ago',
      likes: 834,
      comments: 92,
      shares: 178,
      tags: ['Semiconductors', 'Supply Chain', 'Technology', 'ETFs'],
      reason: 'Related to your watchlist items'
    },
    {
      id: '7',
      type: 'earnings_preview',
      title: 'Upcoming Earnings Calendar',
      content: 'This week: AAPL (Tue), MSFT (Wed), GOOGL (Thu). Key metrics to watch: iPhone sales, cloud growth, and advertising spend. Options activity suggests volatility expectations around 5-7%.',
      author: 'Earnings Tracker',
      timestamp: '3 hours ago',
      likes: 1689,
      comments: 234,
      shares: 456,
      tags: ['Earnings', 'AAPL', 'MSFT', 'GOOGL', 'Options'],
      reason: 'Assets in your earnings preview workflow'
    },
    {
      id: '8',
      type: 'research_tip',
      title: 'Reading Cash Flow Statements',
      content: 'Operating cash flow > net income is a good sign. Watch for: 1) Consistent positive OCF 2) Capex vs depreciation 3) Working capital changes 4) Free cash flow conversion. Quality matters more than growth.',
      author: 'Financial Analysis Pro',
      timestamp: '6 hours ago',
      likes: 723,
      comments: 67,
      shares: 145,
      tags: ['Cash Flow', 'Financial Analysis', 'Education', 'Quality'],
      reason: 'Popular among research analysts'
    },
    {
      id: '9',
      type: 'sector_rotation',
      title: 'Healthcare Sector Gaining Momentum',
      content: 'Healthcare stocks are showing relative strength as investors seek defensive plays. Biotech M&A activity increasing, and aging demographics provide long-term tailwinds. Consider XLV or individual names.',
      author: 'Sector Strategist',
      timestamp: '8 hours ago',
      likes: 456,
      comments: 43,
      shares: 89,
      tags: ['Healthcare', 'Sector Rotation', 'Demographics', 'Biotech'],
      reason: 'Sector allocation opportunity'
    },
    {
      id: '10',
      type: 'risk_alert',
      title: 'Inflation Data This Week',
      content: 'CPI report Thursday could impact Fed policy expectations. Current consensus: 3.2% YoY. Higher than expected could trigger rate hike fears. Consider hedging with TIPS or commodity exposure.',
      author: 'Macro Economist',
      timestamp: '1 day ago',
      likes: 892,
      comments: 123,
      shares: 267,
      tags: ['Inflation', 'Federal Reserve', 'Macro', 'Hedging'],
      reason: 'Important for portfolio risk management'
    },
    {
      id: '11',
      type: 'technical_analysis',
      title: 'S&P 500 Testing Key Resistance',
      content: 'SPY approaching 200-day moving average at 4,200. Volume declining on recent rallies suggests weak conviction. Watch for break above 4,220 or rejection back to 4,100 support.',
      author: 'Technical Analyst',
      timestamp: '4 hours ago',
      likes: 1034,
      comments: 78,
      shares: 234,
      tags: ['Technical Analysis', 'SPY', 'Moving Averages', 'Support'],
      reason: 'Market timing insight'
    },
    {
      id: '12',
      type: 'international',
      title: 'European Markets Outperforming',
      content: 'European stocks up 12% this quarter vs 8% for US markets. ECB policy divergence and relative valuations creating opportunity. Consider VGK or individual European ADRs.',
      author: 'Global Strategist',
      timestamp: '12 hours ago',
      likes: 567,
      comments: 45,
      shares: 123,
      tags: ['Europe', 'International', 'Outperformance', 'ECB'],
      reason: 'Geographic diversification opportunity'
    },
    {
      id: '13',
      type: 'crypto_insight',
      title: 'Bitcoin Correlation with Nasdaq',
      content: 'BTC-NASDAQ correlation hits 0.8, highest in 2 years. Crypto increasingly moving with tech stocks rather than as alternative asset. Consider this for portfolio construction.',
      author: 'Crypto Analyst',
      timestamp: '18 hours ago',
      likes: 789,
      comments: 156,
      shares: 298,
      tags: ['Bitcoin', 'Correlation', 'Nasdaq', 'Portfolio'],
      reason: 'Alternative asset analysis'
    },
    {
      id: '14',
      type: 'dividend_focus',
      title: 'High-Quality Dividend Growth',
      content: 'Focus on companies with 10+ year dividend growth streaks and payout ratios <60%. Favorites: JNJ, PG, KO. Avoid yield traps in telecom and utilities with declining fundamentals.',
      author: 'Income Investor',
      timestamp: '1 day ago',
      likes: 634,
      comments: 89,
      shares: 167,
      tags: ['Dividends', 'Income', 'Quality', 'Growth'],
      reason: 'Income strategy insight'
    },
    {
      id: '15',
      type: 'small_cap',
      title: 'Small Cap Value Opportunity',
      content: 'Russell 2000 Value trading at 15x earnings vs 25x for growth. Historical mean reversion suggests 20-30% outperformance potential over 2-3 years. IWM vs IWN spread at extremes.',
      author: 'Value Investor',
      timestamp: '2 days ago',
      likes: 445,
      comments: 67,
      shares: 134,
      tags: ['Small Cap', 'Value', 'Mean Reversion', 'Russell 2000'],
      reason: 'Value investing opportunity'
    }
  ]

  // Shuffle function for feed content
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  // Get shuffled feed content
  const [feedContent, setFeedContent] = useState<FeedContent[]>(() =>
    shuffleArray(allFeedContent).slice(0, 9)
  )

  // Generate AI insights based on user's actual data
  const generateAIInsights = () => {
    if (!ideaData) return []

    const insights = []

    // Insight based on high priority assets
    const highPriorityAssets = ideaData.assets.filter(a => a.priority === 'high')
    if (highPriorityAssets.length > 0) {
      const asset = highPriorityAssets[0]
      insights.push({
        id: `ai_insight_${asset.id}`,
        type: 'market_insight',
        title: `📈 Your ${asset.symbol} Analysis Alert`,
        content: `Based on your portfolio data, ${asset.company_name} requires immediate attention. Recent market movements suggest this high-priority position may need rebalancing. Consider reviewing your thesis and position sizing.`,
        author: 'Tesseract AI',
        timestamp: 'Just now',
        likes: Math.floor(Math.random() * 50) + 20,
        comments: Math.floor(Math.random() * 15) + 5,
        shares: Math.floor(Math.random() * 10) + 2,
        tags: [asset.symbol, 'Portfolio', 'High Priority', 'Alert'],
        reason: `Generated based on your high-priority ${asset.symbol} position`,
        data: asset
      })
    }

    // Insight based on recent notes
    if (ideaData.notes.length > 0) {
      const recentNote = ideaData.notes[0]
      const symbol = recentNote.source_name || 'your portfolio'
      insights.push({
        id: `ai_insight_note_${recentNote.id}`,
        type: 'research_tip',
        title: `🧠 Research Synthesis: ${symbol}`,
        content: `AI analysis of your recent research on ${symbol}: "${recentNote.title}". Key themes suggest focusing on fundamental catalysts. Your research depth indicates strong conviction - consider position sizing accordingly.`,
        author: 'Tesseract AI',
        timestamp: '2m ago',
        likes: Math.floor(Math.random() * 40) + 15,
        comments: Math.floor(Math.random() * 12) + 3,
        shares: Math.floor(Math.random() * 8) + 1,
        tags: ['Research', 'AI Analysis', symbol, 'Deep Dive'],
        reason: `Based on your recent research note: "${recentNote.title}"`,
        data: recentNote
      })
    }

    // Insight based on price targets
    const overduePriceTargets = ideaData.priceTargets.filter(pt => {
      if (!pt.target_date) return false
      return new Date(pt.target_date) < new Date()
    })
    if (overduePriceTargets.length > 0) {
      const target = overduePriceTargets[0]
      insights.push({
        id: `ai_insight_target_${target.id}`,
        type: 'portfolio_alert',
        title: `🎯 Price Target Update: ${target.assets?.symbol}`,
        content: `Your ${target.assets?.symbol} price target of $${target.target_price} has expired. Current price: $${target.assets?.current_price}. AI suggests reassessing target based on recent earnings, market conditions, and your updated investment thesis.`,
        author: 'Tesseract AI',
        timestamp: '5m ago',
        likes: Math.floor(Math.random() * 35) + 10,
        comments: Math.floor(Math.random() * 10) + 2,
        shares: Math.floor(Math.random() * 6) + 1,
        tags: [target.assets?.symbol, 'Price Target', 'Review', 'Update'],
        reason: `Your price target for ${target.assets?.symbol} needs updating`,
        data: target
      })
    }

    // Insight based on themes
    if (ideaData.themes.length > 0) {
      const theme = ideaData.themes[0]
      insights.push({
        id: `ai_insight_theme_${theme.id}`,
        type: 'trend_analysis',
        title: `🌊 Theme Deep Dive: ${theme.name}`,
        content: `Your investment theme "${theme.name}" is gaining momentum. AI analysis suggests this trend aligns with current market rotation. Consider increasing allocation or identifying new opportunities within this theme.`,
        author: 'Tesseract AI',
        timestamp: '8m ago',
        likes: Math.floor(Math.random() * 45) + 25,
        comments: Math.floor(Math.random() * 18) + 7,
        shares: Math.floor(Math.random() * 12) + 4,
        tags: [theme.name, 'Theme', 'Trend', 'Opportunity'],
        reason: `Analysis of your investment theme: "${theme.name}"`,
        data: theme
      })
    }

    // Insight based on portfolio composition
    const portfoliosWithFewHoldings = ideaData.portfolios.filter(p =>
      !p.portfolio_holdings || p.portfolio_holdings.length <= 2
    )
    if (portfoliosWithFewHoldings.length > 0) {
      const portfolio = portfoliosWithFewHoldings[0]
      insights.push({
        id: `ai_insight_portfolio_${portfolio.id}`,
        type: 'educational',
        title: `🎓 Portfolio Optimization: ${portfolio.name}`,
        content: `Your "${portfolio.name}" portfolio shows concentration risk with only ${portfolio.portfolio_holdings?.length || 0} holdings. AI recommends diversification across 8-12 positions for optimal risk-adjusted returns while maintaining your investment style.`,
        author: 'Tesseract AI',
        timestamp: '12m ago',
        likes: Math.floor(Math.random() * 30) + 12,
        comments: Math.floor(Math.random() * 8) + 2,
        shares: Math.floor(Math.random() * 5) + 1,
        tags: [portfolio.name, 'Diversification', 'Risk', 'Education'],
        reason: `Portfolio diversification analysis for "${portfolio.name}"`,
        data: portfolio
      })
    }

    // Fallback insight if no user data
    if (insights.length === 0) {
      insights.push({
        id: 'ai_insight_welcome',
        type: 'educational',
        title: '🚀 Welcome to AI-Powered Investing',
        content: 'Start building your portfolio, adding research notes, and setting price targets. Tesseract AI will analyze your data to provide personalized insights, alerts, and investment recommendations tailored to your strategy.',
        author: 'Tesseract AI',
        timestamp: 'Now',
        likes: 42,
        comments: 8,
        shares: 3,
        tags: ['Welcome', 'Getting Started', 'AI', 'Personalized'],
        reason: 'Getting started guide for new users',
        data: null
      })
    }

    return insights
  }

  // Fetch data for discovery view (existing functionality)
  const { data: ideaData, isLoading, refetch } = useQuery({
    queryKey: ['idea-generator-data'],
    queryFn: async () => {

      const [
        assetsResult,
        notesResult,
        priceTargetsResult,
        themesResult,
        portfoliosResult
      ] = await Promise.all([
        supabase
          .from('assets')
          .select('*')
          .order('updated_at', { ascending: false }),

        Promise.all([
          supabase.from('asset_notes').select('*, assets(symbol, company_name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('portfolio_notes').select('*, portfolios(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('theme_notes').select('*, themes(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('custom_notebook_notes').select('*, custom_notebooks(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10)
        ]),

        supabase
          .from('price_targets')
          .select('*, assets(symbol, company_name, current_price)')
          .order('updated_at', { ascending: false }),

        supabase
          .from('themes')
          .select('*')
          .order('created_at', { ascending: false }),

        supabase
          .from('portfolios')
          .select('*, portfolio_holdings(id)')
          .order('updated_at', { ascending: false })
      ])

      const allNotes = [
        ...(notesResult[0].data || []).map(note => ({ ...note, source_type: 'asset', source_name: note.assets?.symbol })),
        ...(notesResult[1].data || []).map(note => ({ ...note, source_type: 'portfolio', source_name: note.portfolios?.name })),
        ...(notesResult[2].data || []).map(note => ({ ...note, source_type: 'theme', source_name: note.themes?.name })),
        ...(notesResult[3].data || []).map(note => ({ ...note, source_type: 'custom', source_name: note.custom_notebooks?.name }))
      ]

      return {
        assets: assetsResult.data || [],
        notes: allNotes,
        priceTargets: priceTargetsResult.data || [],
        themes: themesResult.data || [],
        portfolios: portfoliosResult.data || []
      }
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
  })

  // Generate AI insights after ideaData is available
  const aiInsights = ideaData ? generateAIInsights() : []


  // Shuffle function - regenerate tiles with different random selection
  const handleShuffle = () => {
    setIsShuffling(true)
    setTimeout(() => {
      generateIdeaTiles() // This will create a new random selection of 9 tiles
      setLastRefresh(new Date()) // Update the last refresh timestamp
      setIsShuffling(false)
    }, 500) // Brief animation delay
  }

  // Save state to TabStateManager whenever key state changes
  useEffect(() => {
    const stateToSave = {
      activeView,
      currentFeedIndex,
      tiles,
    }

    TabStateManager.saveTabState('idea-generator', stateToSave)
  }, [activeView, currentFeedIndex, tiles])

  // Generate idea tiles only on initial load if no saved tiles exist
  useEffect(() => {
    if (ideaData && tiles.length === 0) {
      generateIdeaTiles()
    }
  }, [ideaData])

  // Reset feed index when switching to feed view
  useEffect(() => {
    if (activeView === 'feed') {
      setCurrentFeedIndex(0)
    }
  }, [activeView])

  // Filter tiles based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      // No search query - show first 9 tiles
      setTiles(allTiles.slice(0, 9))
      return
    }

    // Filter tiles using natural language search
    const query = searchQuery.toLowerCase()
    const filtered = allTiles.filter(tile => {
      // Search in title, subtitle, content, reason, and type
      const searchableText = [
        tile.title,
        tile.subtitle || '',
        tile.content,
        tile.reason || '',
        tile.type,
        tile.priority || '',
        tile.urgency || ''
      ].join(' ').toLowerCase()

      return searchableText.includes(query)
    })

    // Show up to 9 matching tiles
    setTiles(filtered.slice(0, 9))
  }, [searchQuery, allTiles])

  const generateIdeaTiles = () => {
    if (!ideaData) {
      return
    }

    const allPossibleTiles: IdeaTile[] = []

    // Add high-priority assets with urgent attention needed
    const highPriorityAssets = ideaData.assets.filter(a => a.priority === 'high')
    highPriorityAssets.forEach(asset => {
      allPossibleTiles.push({
        id: asset.id,
        type: 'asset',
        title: asset.symbol,
        subtitle: asset.company_name,
        content: `High priority asset requiring immediate attention. Last updated ${formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}.`,
        priority: 'high',
        urgency: 'urgent',
        data: asset,
        color: 'bg-red-50 border-red-200',
        iconType: 'alert-triangle',
        actionText: 'Review Now',
        reason: 'High priority asset that needs your immediate attention'
      })
    })

    // Add recently updated assets that need review
    const recentlyUpdatedAssets = ideaData.assets
      .filter(a => a.priority !== 'high' && new Date(a.updated_at) > new Date(Date.now() - 24 * 60 * 60 * 1000))
      .slice(0, 3)
    recentlyUpdatedAssets.forEach(asset => {
      allPossibleTiles.push({
        id: `recent_${asset.id}`,
        type: 'asset',
        title: asset.symbol,
        subtitle: asset.company_name,
        content: `Recently updated asset. Check for new developments and analysis opportunities.`,
        priority: 'medium',
        urgency: 'normal',
        data: asset,
        color: 'bg-blue-50 border-blue-200',
        iconType: 'trending-up',
        actionText: 'Check Updates',
        reason: 'Asset was recently updated and may need your review'
      })
    })

    // Add recent notes that need attention
    const recentNotes = ideaData.notes.slice(0, 4)
    recentNotes.forEach(note => {
      allPossibleTiles.push({
        id: note.id,
        type: 'note',
        title: note.title,
        subtitle: note.source_name ? `${note.source_type}: ${note.source_name}` : note.source_type,
        content: note.content.substring(0, 120) + '...',
        priority: 'medium',
        urgency: 'normal',
        data: note,
        color: 'bg-blue-50 border-blue-200',
        iconType: 'file-text',
        actionText: 'Read More',
        reason: 'Recent research note that might contain valuable insights'
      })
    })

    // Add overdue price targets
    const overduePriceTargets = ideaData.priceTargets.filter(pt => {
      if (!pt.target_date) return false
      return new Date(pt.target_date) < new Date()
    })
    overduePriceTargets.forEach(target => {
      allPossibleTiles.push({
        id: target.id,
        type: 'price_target',
        title: `${target.assets?.symbol} Price Target`,
        subtitle: target.assets?.company_name,
        content: `Target of $${target.target_price} was set for ${formatDistanceToNow(new Date(target.target_date), { addSuffix: true })}. Current price: $${target.assets?.current_price || 'N/A'}`,
        priority: 'high',
        urgency: 'urgent',
        data: target,
        color: 'bg-yellow-50 border-yellow-200',
        iconType: 'target',
        actionText: 'Update Target',
        reason: 'Price target deadline has passed and needs your review'
      })
    })

    // Add approaching price targets
    const approachingTargets = ideaData.priceTargets.filter(pt => {
      if (!pt.target_date) return false
      const targetDate = new Date(pt.target_date)
      const now = new Date()
      const daysUntil = (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      return daysUntil > 0 && daysUntil <= 7
    })
    approachingTargets.forEach(target => {
      allPossibleTiles.push({
        id: `approaching_${target.id}`,
        type: 'price_target',
        title: `${target.assets?.symbol} Target Due Soon`,
        subtitle: target.assets?.company_name,
        content: `Price target of $${target.target_price} is due ${formatDistanceToNow(new Date(target.target_date), { addSuffix: true })}. Current: $${target.assets?.current_price || 'N/A'}`,
        priority: 'medium',
        urgency: 'normal',
        data: target,
        color: 'bg-orange-50 border-orange-200',
        iconType: 'clock',
        actionText: 'Review Progress',
        reason: 'Price target deadline is approaching within a week'
      })
    })

    // Add themes that need exploration
    ideaData.themes.slice(0, 3).forEach(theme => {
      allPossibleTiles.push({
        id: theme.id,
        type: 'theme',
        title: theme.name,
        subtitle: 'Investment Theme',
        content: theme.description || 'Explore this investment theme and identify related opportunities.',
        priority: 'medium',
        urgency: 'normal',
        data: theme,
        color: 'bg-purple-50 border-purple-200',
        iconType: 'tag',
        actionText: 'Explore Theme',
        reason: 'Investment theme that may have new opportunities'
      })
    })

    // Add portfolios that need rebalancing (empty or few holdings)
    const portfoliosNeedingAttention = ideaData.portfolios.filter(p =>
      !p.portfolio_holdings || p.portfolio_holdings.length <= 2
    )
    portfoliosNeedingAttention.forEach(portfolio => {
      allPossibleTiles.push({
        id: portfolio.id,
        type: 'portfolio',
        title: portfolio.name,
        subtitle: 'Portfolio',
        content: `Portfolio has ${portfolio.portfolio_holdings?.length || 0} holdings and may need diversification or rebalancing.`,
        priority: 'medium',
        urgency: 'normal',
        data: portfolio,
        color: 'bg-green-50 border-green-200',
        iconType: 'briefcase',
        actionText: 'Add Holdings',
        reason: 'Portfolio needs more holdings for better diversification'
      })
    })

    // Shuffle all tiles
    const shuffledTiles = shuffleArray([...allPossibleTiles])

    // Store all tiles for filtering
    setAllTiles(shuffledTiles)

    // Show first 9 tiles by default
    const finalTiles = shuffledTiles.slice(0, 9)
    setTiles(finalTiles)
  }


  const getIconForType = (iconType: string, className: string = 'w-5 h-5') => {
    switch (iconType) {
      case 'alert-triangle': return <AlertTriangle className={className} />
      case 'trending-up': return <TrendingUp className={className} />
      case 'file-text': return <FileText className={className} />
      case 'target': return <Target className={className} />
      case 'clock': return <Clock className={className} />
      case 'tag': return <Tag className={className} />
      case 'briefcase': return <Briefcase className={className} />
      default: return <Lightbulb className={className} />
    }
  }

  const renderTabButton = (view: ViewType, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setActiveView(view)}
      className={clsx(
        'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
        activeView === view
          ? 'bg-primary-100 text-primary-700 border border-primary-200'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )

  const renderDiscoveryView = () => {
    try {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Discovery</h2>
              <p className="text-sm text-gray-600">
                Personalized insights and collaborative content that needs your attention
              </p>
            </div>
          <div className="flex items-center space-x-3">
          <div className="text-xs text-gray-500">
            Last updated: {formatDistanceToNow(lastRefresh, { addSuffix: true })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShuffle}
            disabled={isShuffling || isLoading}
            className="flex items-center space-x-2"
          >
            <RefreshCw className={clsx('w-4 h-4', isShuffling && 'animate-spin')} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search discoveries... (e.g., 'high priority', 'portfolio', 'urgent')"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <Plus className="w-5 h-5 rotate-45" />
          </button>
        )}
      </div>

      {/* Results count */}
      {searchQuery && (
        <div className="text-sm text-gray-600">
          Found {tiles.length} {tiles.length === 1 ? 'result' : 'results'} for "{searchQuery}"
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-48 bg-gray-200 rounded-xl"></div>
            </div>
          ))}
        </div>
      ) : tiles.length === 0 && searchQuery ? (
        <div className="text-center py-12">
          <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No results found</h3>
          <p className="text-gray-600 mb-4">
            No discoveries match your search for "{searchQuery}"
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSearchQuery('')}
          >
            Clear search
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tiles.map((tile) => (
            <Card
              key={tile.id}
              className={clsx(
                'p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-105',
                tile.color,
                isShuffling && 'animate-pulse'
              )}
              onClick={() => {
                // Navigate to the relevant page based on tile type
                let navigationData

                if (tile.type === 'asset') {
                  // For assets, navigate to the asset page
                  navigationData = {
                    id: tile.data.id,
                    title: tile.data.symbol,
                    type: 'asset',
                    data: tile.data
                  }
                } else if (tile.type === 'note') {
                  // For notes, navigate to the note page
                  navigationData = {
                    id: tile.data.id,
                    title: tile.data.title,
                    type: 'note',
                    data: tile.data
                  }
                } else if (tile.type === 'price_target') {
                  // For price targets, navigate to the asset page
                  navigationData = {
                    id: tile.data.assets.id,
                    title: tile.data.assets.symbol,
                    type: 'asset',
                    data: tile.data.assets
                  }
                } else if (tile.type === 'theme') {
                  // For themes, navigate to the theme page
                  navigationData = {
                    id: tile.data.id,
                    title: tile.data.name,
                    type: 'theme',
                    data: tile.data
                  }
                } else if (tile.type === 'portfolio') {
                  // For portfolios, navigate to the portfolio page
                  navigationData = {
                    id: tile.data.id,
                    title: tile.data.name,
                    type: 'portfolio',
                    data: tile.data
                  }
                } else {
                  // Default fallback
                  navigationData = {
                    id: tile.data?.id || tile.id,
                    title: tile.title,
                    type: tile.type,
                    data: tile.data
                  }
                }

                onItemSelect?.(navigationData)
              }}
            >
              <div className="flex items-start space-x-3 mb-4">
                {getIconForType(tile.iconType, tile.color.includes('red') ? 'w-5 h-5 text-red-600' :
                  tile.color.includes('blue') ? 'w-5 h-5 text-blue-600' :
                  tile.color.includes('yellow') ? 'w-5 h-5 text-yellow-600' :
                  tile.color.includes('orange') ? 'w-5 h-5 text-orange-600' :
                  tile.color.includes('purple') ? 'w-5 h-5 text-purple-600' :
                  tile.color.includes('green') ? 'w-5 h-5 text-green-600' :
                  'w-5 h-5 text-gray-600')}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{tile.title}</h3>
                  {tile.subtitle && (
                    <p className="text-sm text-gray-600 truncate">{tile.subtitle}</p>
                  )}
                </div>
                <div className="flex items-center space-x-1">
                  {tile.urgency === 'urgent' && (
                    <Badge variant="error" size="sm">Urgent</Badge>
                  )}
                  {tile.priority && (
                    <Badge
                      variant={tile.priority === 'high' ? 'error' : tile.priority === 'medium' ? 'warning' : 'default'}
                      size="sm"
                    >
                      {tile.priority}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-700 mb-3 line-clamp-3">{tile.content}</p>
              {tile.reason && (
                <div className="mb-4 px-3 py-2 bg-gray-50 rounded-lg border-l-2 border-blue-200">
                  <p className="text-xs text-gray-600 font-medium">Why we're showing this:</p>
                  <p className="text-xs text-gray-700">{tile.reason}</p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Badge variant="outline" size="sm">{tile.type}</Badge>
                <span className="text-sm font-medium text-gray-900">{tile.actionText}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
      </div>
    )
    } catch (error) {
      return (
        <div className="space-y-6">
          <div className="text-center py-12">
            <h2 className="text-lg font-semibold text-red-600 mb-2">Discovery View Error</h2>
            <p className="text-gray-600">Something went wrong. Please try refreshing.</p>
          </div>
        </div>
      )
    }
  }

  const renderFeedView = () => {
    if (isLoading) {
      return (
        <div className="w-full h-full bg-black overflow-hidden flex items-center justify-center">
          <div className="text-center">
            <Brain className="w-16 h-16 text-blue-400 mx-auto mb-4 animate-pulse" />
            <h3 className="text-xl font-semibold text-white mb-2">Generating AI Insights...</h3>
            <p className="text-gray-300">Analyzing your portfolio data</p>
          </div>
        </div>
      )
    }

    return (
      <div className="w-full h-full bg-black overflow-hidden">
        {/* Feed Header */}
        <div className="flex items-center justify-between p-4 bg-black text-white border-b border-gray-800">
          <div className="flex items-center space-x-3">
            <Brain className="w-6 h-6 text-blue-400" />
            <span className="font-semibold">AI Insights</span>
            <div className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
              Powered by your data
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className="text-xs text-gray-400">
              {aiInsights.length > 0 ? `${currentFeedIndex + 1} / ${aiInsights.length}` : 'No insights'}
            </div>
            <Button variant="ghost" size="sm" className="text-white hover:bg-gray-800">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Current Content - Full Screen */}
        <div className="relative w-full bg-gradient-to-br from-blue-900 to-purple-900 text-white overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
          {(() => {
            // Always ensure we have some content to display
            let content = aiInsights[currentFeedIndex] || aiInsights[0]

            // Fallback content if no AI insights
            if (!content) {
              content = {
                id: 'fallback',
                type: 'educational',
                title: '🚀 Welcome to Tesseract AI',
                content: 'Start building your portfolio by adding assets, research notes, and price targets. Tesseract AI will analyze your data to provide personalized insights and recommendations.',
                author: 'Tesseract AI',
                timestamp: 'Now',
                likes: 42,
                comments: 8,
                shares: 3,
                tags: ['Welcome', 'Getting Started', 'AI'],
                reason: 'Getting started guide'
              }
            }

            const getTypeIcon = (type: string) => {
              switch (type) {
                case 'market_insight': return <BarChart3 className="w-5 h-5" />
                case 'research_tip': return <Lightbulb className="w-5 h-5" />
                case 'portfolio_alert': return <Bell className="w-5 h-5" />
                case 'trend_analysis': return <TrendingUp className="w-5 h-5" />
                case 'educational': return <Award className="w-5 h-5" />
                default: return <Zap className="w-5 h-5" />
              }
            }

            const getTypeColor = (type: string) => {
              switch (type) {
                case 'market_insight': return 'text-green-400'
                case 'research_tip': return 'text-yellow-400'
                case 'portfolio_alert': return 'text-red-400'
                case 'trend_analysis': return 'text-blue-400'
                case 'educational': return 'text-purple-400'
                default: return 'text-white'
              }
            }

            const handleFeedContentClick = () => {
              // Navigate to the relevant page based on insight data
              if (content.data) {
                let navigationData

                // Check the type of data attached to the insight
                if (content.data.symbol) {
                  // It's an asset
                  navigationData = {
                    id: content.data.id,
                    title: content.data.symbol,
                    type: 'asset',
                    data: content.data
                  }
                } else if (content.data.title && content.data.content) {
                  // It's a note
                  navigationData = {
                    id: content.data.id,
                    title: content.data.title,
                    type: 'note',
                    data: content.data
                  }
                } else if (content.data.target_price) {
                  // It's a price target - navigate to the asset
                  navigationData = {
                    id: content.data.assets.id,
                    title: content.data.assets.symbol,
                    type: 'asset',
                    data: content.data.assets
                  }
                } else if (content.data.name && content.data.description) {
                  // It's a theme
                  navigationData = {
                    id: content.data.id,
                    title: content.data.name,
                    type: 'theme',
                    data: content.data
                  }
                } else if (content.data.portfolio_holdings !== undefined) {
                  // It's a portfolio
                  navigationData = {
                    id: content.data.id,
                    title: content.data.name,
                    type: 'portfolio',
                    data: content.data
                  }
                }

                if (navigationData) {
                  onItemSelect?.(navigationData)
                }
              }
            }

            return (
              <div className="p-8 h-full flex flex-col justify-between">
                {/* Content - Clickable Area */}
                <div
                  className="space-y-8 flex-1 flex flex-col justify-center cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={handleFeedContentClick}
                >
                  <div className="flex items-center space-x-3">
                    <div className={getTypeColor(content.type)}>
                      {getTypeIcon(content.type)}
                    </div>
                    <span className="text-base font-medium capitalize text-gray-300">
                      {content.type.replace('_', ' ')}
                    </span>
                    {content.reason && (
                      <div className="text-xs text-gray-400 bg-gray-800 bg-opacity-50 px-3 py-1 rounded-full">
                        {content.reason}
                      </div>
                    )}
                  </div>

                  <div className="text-center max-w-4xl mx-auto">
                    <h2 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">{content.title}</h2>
                    <p className="text-xl md:text-2xl leading-relaxed opacity-90 max-w-3xl mx-auto">{content.content}</p>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-3 justify-center">
                    {content.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="px-4 py-2 bg-white bg-opacity-20 rounded-full text-sm font-medium hover:bg-opacity-30 transition-all cursor-pointer"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Interaction Bar */}
                <div className="space-y-4 mt-8">
                  <div className="flex items-center justify-between text-sm text-gray-300">
                    <span className="flex items-center space-x-2">
                      <Brain className="w-4 h-4 text-blue-400" />
                      <span>By {content.author}</span>
                    </span>
                    <span>{content.timestamp}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-8">
                      <button className="flex items-center space-x-2 text-white hover:text-red-400 transition-colors">
                        <Heart className="w-6 h-6" />
                        <span className="text-lg">{content.likes}</span>
                      </button>
                      <button className="flex items-center space-x-2 text-white hover:text-blue-400 transition-colors">
                        <MessageSquare className="w-6 h-6" />
                        <span className="text-lg">{content.comments}</span>
                      </button>
                      <button className="flex items-center space-x-2 text-white hover:text-green-400 transition-colors">
                        <Share2 className="w-6 h-6" />
                        <span className="text-lg">{content.shares}</span>
                      </button>
                    </div>
                    <button className="text-white hover:text-yellow-400 transition-colors">
                      <Bookmark className="w-6 h-6" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Navigation */}
          <div className="absolute inset-y-0 left-0 w-1/3 cursor-pointer" onClick={() => {
            if (aiInsights.length > 0) {
              setCurrentFeedIndex(prev => prev > 0 ? prev - 1 : aiInsights.length - 1)
            }
          }}>
            <div className="h-full flex items-center justify-start pl-4">
              <div className="text-white opacity-0 hover:opacity-60 transition-opacity">
                <ArrowLeft className="w-8 h-8" />
              </div>
            </div>
          </div>
          <div className="absolute inset-y-0 right-0 w-1/3 cursor-pointer" onClick={() => {
            if (aiInsights.length > 0) {
              setCurrentFeedIndex(prev => prev < aiInsights.length - 1 ? prev + 1 : 0)
            }
          }}>
            <div className="h-full flex items-center justify-end pr-4">
              <div className="text-white opacity-0 hover:opacity-60 transition-opacity">
                <ArrowRight className="w-8 h-8" />
              </div>
            </div>
          </div>

          {/* Progress indicators */}
          <div className="absolute top-4 left-4 right-4 flex space-x-1">
            {aiInsights.map((_, index) => (
              <div
                key={index}
                className={clsx(
                  'h-0.5 flex-1 rounded-full transition-all',
                  index === currentFeedIndex ? 'bg-white' : 'bg-white bg-opacity-30'
                )}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center space-x-3">
          <Lightbulb className="w-7 h-7 text-primary-600" />
          <span>Ideas</span>
        </h1>
        <p className="text-gray-600 mt-1">
          Discover insights, prioritize tasks, and stay informed with AI-powered content
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-2 border-b border-gray-200 pb-4">
        {renderTabButton('discovery', <Shuffle className="w-4 h-4" />, 'Discovery')}
        {renderTabButton('feed', <Activity className="w-4 h-4" />, 'Feed')}
      </div>

      {/* View Content */}
      {activeView === 'discovery' && renderDiscoveryView()}
      {activeView === 'feed' && renderFeedView()}
    </div>
  )
}