import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, Search, Send, Loader2, ChevronDown,
  Globe, Lock, Users, Building2, ChevronRight, ChevronLeft, Briefcase, FolderKanban,
  ArrowLeftRight, X
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useInvalidateAttention } from '../../hooks/useAttention'
import { clsx } from 'clsx'
import type { TradeAction, TradeUrgency } from '../../types/trading'
import { ContextSelector, type CapturedContext } from './ContextSelector'

type OrgNodeType = 'division' | 'department' | 'team' | 'portfolio'

interface OrgChartNode {
  id: string
  name: string
  node_type: OrgNodeType
  parent_id: string | null
}

const categoryOptions: { value: OrgNodeType; label: string; icon: typeof Building2; color: string }[] = [
  { value: 'division', label: 'Divisions', icon: Building2, color: 'bg-purple-500' },
  { value: 'department', label: 'Departments', icon: Briefcase, color: 'bg-blue-500' },
  { value: 'team', label: 'Teams', icon: Users, color: 'bg-green-500' },
  { value: 'portfolio', label: 'Portfolios', icon: FolderKanban, color: 'bg-amber-500' },
]

interface QuickTradeIdeaCaptureProps {
  onSuccess?: () => void
  onCancel?: () => void
  compact?: boolean
  autoFocus?: boolean
  // Context from current location
  capturedContext?: CapturedContext | null
  onContextChange?: (context: CapturedContext | null) => void
}

const urgencyOptions: { value: TradeUrgency; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-slate-700 bg-slate-100 border-slate-300' },
  { value: 'medium', label: 'Medium', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { value: 'high', label: 'High', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-600 bg-red-50 border-red-200' },
]

// Source tracking for soft sync behavior
type SourceType = 'auto' | 'user' | null

export function QuickTradeIdeaCapture({
  onSuccess,
  onCancel,
  compact = false,
  autoFocus = false,
  capturedContext,
  onContextChange
}: QuickTradeIdeaCaptureProps) {
  // Trade type: single or pair
  const [tradeType, setTradeType] = useState<'single' | 'pair'>('single')

  // Asset search - single trade or long leg for pairs
  const [assetSearch, setAssetSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<{ id: string; symbol: string; company_name: string } | null>(null)
  const [showAssetDropdown, setShowAssetDropdown] = useState(false)

  // Source tracking for context and trade asset (for soft sync)
  const [contextSource, setContextSource] = useState<SourceType>(null)
  const [tradeAssetSource, setTradeAssetSource] = useState<SourceType>(null)
  // Track initial auto-set asset ID to detect alignment
  const [initialAutoAssetId, setInitialAutoAssetId] = useState<string | null>(null)

  // Multiple assets for pairs - long side
  const [longAssets, setLongAssets] = useState<{ id: string; symbol: string; company_name: string }[]>([])
  const [longSearch, setLongSearch] = useState('')
  const [showLongDropdown, setShowLongDropdown] = useState(false)

  // Multiple assets for pairs - short side
  const [shortAssets, setShortAssets] = useState<{ id: string; symbol: string; company_name: string }[]>([])
  const [shortSearch, setShortSearch] = useState('')
  const [showShortDropdown, setShowShortDropdown] = useState(false)

  // Trade details
  const [action, setAction] = useState<TradeAction>('buy')
  const [urgency, setUrgency] = useState<TradeUrgency>('medium')
  const [rationale, setRationale] = useState('')

  // Portfolio - multiple selection or none
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>([])
  const [showPortfolioMenu, setShowPortfolioMenu] = useState(false)

  // Visibility
  const [visibility, setVisibility] = useState<'private' | 'public' | 'organization' | 'team' | 'portfolio'>('private')
  const [selectedOrgNodeId, setSelectedOrgNodeId] = useState<string | null>(null)
  const [selectedOrgNodeType, setSelectedOrgNodeType] = useState<string | null>(null)
  const [selectedOrgNodeName, setSelectedOrgNodeName] = useState<string | null>(null)
  const [visibilityStep, setVisibilityStep] = useState<'main' | 'category' | 'items'>('main')
  const [selectedCategory, setSelectedCategory] = useState<OrgNodeType | null>(null)
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false)

  // Error state for inline feedback
  const [submitError, setSubmitError] = useState<string | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const invalidateAttention = useInvalidateAttention()

  // Search assets - primary
  const { data: assets } = useQuery({
    queryKey: ['assets-search-quick', assetSearch],
    queryFn: async () => {
      if (!assetSearch || assetSearch.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${assetSearch}%,company_name.ilike.%${assetSearch}%`)
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: assetSearch.length >= 1,
  })

  // Search assets - long side for pairs
  const { data: longSearchResults } = useQuery({
    queryKey: ['assets-search-long', longSearch],
    queryFn: async () => {
      if (!longSearch || longSearch.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${longSearch}%,company_name.ilike.%${longSearch}%`)
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: longSearch.length >= 1,
  })

  // Search assets - short side for pairs
  const { data: shortSearchResults } = useQuery({
    queryKey: ['assets-search-short', shortSearch],
    queryFn: async () => {
      if (!shortSearch || shortSearch.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${shortSearch}%,company_name.ilike.%${shortSearch}%`)
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: shortSearch.length >= 1,
  })

  // Fetch portfolios
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-list-quick'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
  })

  // Get org chart nodes for visibility
  const { data: orgChartNodes } = useQuery({
    queryKey: ['org-chart-nodes-visibility'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .order('name')
      if (error) return []
      return (data || []) as OrgChartNode[]
    }
  })

  const nodesByType = {
    division: orgChartNodes?.filter(n => n.node_type === 'division') || [],
    department: orgChartNodes?.filter(n => n.node_type === 'department') || [],
    team: orgChartNodes?.filter(n => n.node_type === 'team') || [],
    portfolio: orgChartNodes?.filter(n => n.node_type === 'portfolio') || [],
  }

  useEffect(() => {
    if (autoFocus && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [autoFocus])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [rationale])

  // Initialize from captured context (auto-populate trade asset from asset context)
  // This runs once on mount or when capturedContext changes externally
  useEffect(() => {
    if (capturedContext?.type === 'asset' && capturedContext.id) {
      // Mark context as auto-set
      setContextSource('auto')
      setInitialAutoAssetId(capturedContext.id)

      // Only auto-populate trade asset if not already set by user
      if (!selectedAsset && tradeAssetSource !== 'user') {
        supabase
          .from('assets')
          .select('id, symbol, company_name')
          .eq('id', capturedContext.id)
          .single()
          .then(({ data, error }) => {
            if (!error && data) {
              setSelectedAsset(data)
              setTradeAssetSource('auto')
              // Also prefill first long asset in pair mode if empty
              if (tradeType === 'pair' && longAssets.length === 0) {
                setLongAssets([data])
              }
            }
          })
      }
    } else if (capturedContext?.type && capturedContext.type !== 'asset') {
      // Non-asset context (project, portfolio, etc.) - just track it
      setContextSource('auto')
    }
    // Only run when capturedContext changes externally, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturedContext?.type, capturedContext?.id])

  const createTradeIdea = useMutation({
    mutationFn: async () => {
      // Clear any previous error
      setSubmitError(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      if (tradeType === 'single' && !selectedAsset) {
        throw new Error('Missing required fields')
      }
      if (tradeType === 'pair' && (longAssets.length === 0 || shortAssets.length === 0)) {
        throw new Error('Need at least one long and one short asset for pairs trade')
      }

      // If no portfolios selected, create a single idea without portfolio
      // If multiple portfolios, create one idea per portfolio
      const portfolioIds = selectedPortfolioIds.length > 0 ? selectedPortfolioIds : [null]

      // Generate a pair_id if this is a pairs trade
      const pairId = tradeType === 'pair' ? crypto.randomUUID() : null

      // Map visibility to database-compatible value
      const dbVisibility = visibility === 'organization' || visibility === 'portfolio' ? 'team' : visibility

      const inserts: any[] = []

      portfolioIds.forEach(pId => {
        if (tradeType === 'single' && selectedAsset) {
          // Single trade
          inserts.push({
            created_by: user.id,
            portfolio_id: pId,
            asset_id: selectedAsset.id,
            action,
            urgency,
            rationale: rationale.trim() || null,
            status: 'idea',
            pair_id: null,
            visibility: dbVisibility,
          })
        } else if (tradeType === 'pair') {
          // Pairs/basket trade - all longs
          longAssets.forEach(asset => {
            inserts.push({
              created_by: user.id,
              portfolio_id: pId,
              asset_id: asset.id,
              action: 'buy',
              urgency,
              rationale: rationale.trim() || null,
              status: 'idea',
              pair_id: pairId,
              visibility: dbVisibility,
            })
          })
          // Pairs/basket trade - all shorts
          shortAssets.forEach(asset => {
            inserts.push({
              created_by: user.id,
              portfolio_id: pId,
              asset_id: asset.id,
              action: 'sell',
              urgency,
              rationale: rationale.trim() || null,
              status: 'idea',
              pair_id: pairId,
              visibility: dbVisibility,
            })
          })
        }
      })

      const { data, error } = await supabase
        .from('trade_queue_items')
        .insert(inserts)
        .select()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts'] })
      // Also invalidate attention queries so the Attention Dashboard updates immediately
      invalidateAttention()
      // Reset form
      setTradeType('single')
      setAssetSearch('')
      setSelectedAsset(null)
      setLongAssets([])
      setLongSearch('')
      setShortAssets([])
      setShortSearch('')
      setAction('buy')
      setUrgency('medium')
      setRationale('')
      setSelectedPortfolioIds([])
      setVisibility('private')
      setSelectedOrgNodeId(null)
      setSelectedOrgNodeType(null)
      setSelectedOrgNodeName(null)
      setSubmitError(null)
      onSuccess?.()
    },
    onError: (error: Error) => {
      // Log error for debugging (dev only)
      if (import.meta.env.DEV) {
        console.error('Trade idea submission failed:', error)
      }

      // Show user-friendly error message
      if (error.message.includes('permission') || error.message.includes('RLS') || error.message.includes('policy')) {
        setSubmitError("Couldn't save trade idea due to permissions. Please try again or contact admin.")
      } else if (error.message.includes('Not authenticated')) {
        setSubmitError("You must be logged in to save a trade idea.")
      } else {
        setSubmitError("Failed to save trade idea. Please try again.")
      }
    },
  })

  const handleSubmit = () => {
    if (tradeType === 'single' && !selectedAsset) return
    if (tradeType === 'pair' && (longAssets.length === 0 || shortAssets.length === 0)) return
    createTradeIdea.mutate()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel?.()
    }
  }

  const selectAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    const previousAssetId = selectedAsset?.id
    setSelectedAsset(asset)
    setAssetSearch('')
    setShowAssetDropdown(false)

    // Mark as user-set since user explicitly selected
    setTradeAssetSource('user')

    // Soft sync: If context was auto-set AND still aligned with the old trade asset,
    // update context to match the new trade asset
    if (
      contextSource === 'auto' &&
      capturedContext?.type === 'asset' &&
      capturedContext.id === previousAssetId &&
      previousAssetId === initialAutoAssetId
    ) {
      // Update context to the new asset
      onContextChange?.({
        type: 'asset',
        id: asset.id,
        title: `${asset.symbol} - ${asset.company_name}`
      })
    }
  }

  const addLongAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    if (!longAssets.find(a => a.id === asset.id)) {
      setLongAssets([...longAssets, asset])
      // Mark as user-set since user explicitly added
      setTradeAssetSource('user')
    }
    setLongSearch('')
    setShowLongDropdown(false)
  }

  const removeLongAsset = (assetId: string) => {
    setLongAssets(longAssets.filter(a => a.id !== assetId))
    // Mark as user-set since user explicitly removed
    setTradeAssetSource('user')
  }

  const addShortAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    if (!shortAssets.find(a => a.id === asset.id)) {
      setShortAssets([...shortAssets, asset])
      // Mark as user-set since user explicitly added
      setTradeAssetSource('user')
    }
    setShortSearch('')
    setShowShortDropdown(false)
  }

  const removeShortAsset = (assetId: string) => {
    setShortAssets(shortAssets.filter(a => a.id !== assetId))
    // Mark as user-set since user explicitly removed
    setTradeAssetSource('user')
  }

  const getVisibilityLabel = () => {
    if (visibility === 'organization' && selectedOrgNodeName) return selectedOrgNodeName
    if (visibility === 'private') return 'Only me'
    if (visibility === 'public') return 'Public'
    return 'Select'
  }

  const getVisibilityIcon = () => {
    if (visibility === 'organization' && selectedOrgNodeType) {
      const category = categoryOptions.find(c => c.value === selectedOrgNodeType)
      if (category) {
        const Icon = category.icon
        return <Icon className="h-3.5 w-3.5" />
      }
    }
    if (visibility === 'private') return <Lock className="h-3.5 w-3.5" />
    if (visibility === 'public') return <Globe className="h-3.5 w-3.5" />
    return <Lock className="h-3.5 w-3.5" />
  }

  const handleVisibilitySelect = (type: 'private' | 'public' | 'organization') => {
    if (type === 'organization') {
      setVisibility('organization')
      setVisibilityStep('category')
    } else {
      setVisibility(type)
      setSelectedOrgNodeId(null)
      setSelectedOrgNodeType(null)
      setSelectedOrgNodeName(null)
      setVisibilityStep('main')
      setSelectedCategory(null)
      setShowVisibilityMenu(false)
    }
  }

  const handleCategorySelect = (category: OrgNodeType) => {
    setSelectedCategory(category)
    setVisibilityStep('items')
  }

  const handleNodeSelect = (node: OrgChartNode) => {
    setSelectedOrgNodeId(node.id)
    setSelectedOrgNodeType(node.node_type)
    setSelectedOrgNodeName(node.name)
    setShowVisibilityMenu(false)
    setVisibilityStep('main')
  }

  const handleVisibilityBack = () => {
    if (visibilityStep === 'items') {
      setVisibilityStep('category')
      setSelectedCategory(null)
    } else if (visibilityStep === 'category') {
      setVisibilityStep('main')
    }
  }

  return (
    <div className={clsx(
      "bg-white rounded-lg border border-gray-200 shadow-sm",
      compact ? "p-3" : "p-4"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-gray-700">Trade Idea</span>
        </div>

        {/* Trade type toggle */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => {
              setTradeType('single')
              // When switching to single mode, prefill from first long asset
              if (longAssets.length > 0 && !selectedAsset) {
                setSelectedAsset(longAssets[0])
              }
              setLongAssets([])
              setShortAssets([])
              setLongSearch('')
              setShortSearch('')
            }}
            className={clsx(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
              tradeType === 'single'
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            Single
          </button>
          <button
            type="button"
            onClick={() => {
              setTradeType('pair')
              // When switching to pair mode, prefill long leg from current single asset
              if (selectedAsset && longAssets.length === 0) {
                setLongAssets([selectedAsset])
              }
              setSelectedAsset(null)
              setAssetSearch('')
            }}
            className={clsx(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1",
              tradeType === 'pair'
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <ArrowLeftRight className="h-3 w-3" />
            Pair
          </button>
        </div>
      </div>

      {/* Context selector - attach to asset, project, portfolio, etc. */}
      <div className="mb-3">
        <ContextSelector
          value={capturedContext || null}
          onChange={(ctx) => {
            // Mark context as user-set when user explicitly changes it
            setContextSource('user')
            onContextChange?.(ctx)
          }}
          compact={compact}
        />
      </div>

      {/* Asset Search - Single Trade */}
      {tradeType === 'single' && (
        <>
          <div className="relative mb-3">
            {selectedAsset ? (
              <div className="flex items-center justify-between p-2 border border-gray-200 rounded-lg bg-gray-50">
                <div>
                  <span className="font-semibold text-gray-900">{selectedAsset.symbol}</span>
                  <span className="text-sm text-gray-500 ml-2">{selectedAsset.company_name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAsset(null)
                    setShowAssetDropdown(true)
                  }}
                  className="text-xs text-primary-600 hover:text-primary-700"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search asset..."
                  value={assetSearch}
                  onChange={(e) => {
                    setAssetSearch(e.target.value)
                    setShowAssetDropdown(true)
                  }}
                  onFocus={() => setShowAssetDropdown(true)}
                  onKeyDown={handleKeyDown}
                  className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                {showAssetDropdown && assets && assets.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {assets.map(asset => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => selectAsset(asset)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{asset.symbol}</span>
                        <span className="text-sm text-gray-500 ml-2">{asset.company_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Action buttons - only for single trades */}
          <div className="flex gap-2 mb-3">
            {(['buy', 'sell'] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all capitalize",
                  action === a
                    ? a === 'buy'
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-red-500 bg-red-50 text-red-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                {a === 'buy' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {a}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Asset Search - Pairs/Basket Trade */}
      {tradeType === 'pair' && (
        <div className="space-y-3 mb-3">
          {/* Long side */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded">Long</span>
              {longAssets.length > 0 && (
                <span className="text-xs text-gray-400">{longAssets.length} selected</span>
              )}
            </div>
            {/* Selected long assets */}
            {longAssets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {longAssets.map(asset => (
                  <span
                    key={asset.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 border border-green-200 rounded-md text-xs"
                  >
                    <span className="font-medium text-green-700">{asset.symbol}</span>
                    <button
                      type="button"
                      onClick={() => removeLongAsset(asset.id)}
                      className="text-green-400 hover:text-green-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Long search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Add long position..."
                value={longSearch}
                onChange={(e) => {
                  setLongSearch(e.target.value)
                  setShowLongDropdown(true)
                }}
                onFocus={() => setShowLongDropdown(true)}
                onKeyDown={handleKeyDown}
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              {showLongDropdown && longSearchResults && longSearchResults.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {longSearchResults
                    .filter(asset => !longAssets.find(a => a.id === asset.id))
                    .map(asset => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => addLongAsset(asset)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{asset.symbol}</span>
                        <span className="text-sm text-gray-500 ml-2">{asset.company_name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Short side */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded">Short</span>
              {shortAssets.length > 0 && (
                <span className="text-xs text-gray-400">{shortAssets.length} selected</span>
              )}
            </div>
            {/* Selected short assets */}
            {shortAssets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {shortAssets.map(asset => (
                  <span
                    key={asset.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 border border-red-200 rounded-md text-xs"
                  >
                    <span className="font-medium text-red-700">{asset.symbol}</span>
                    <button
                      type="button"
                      onClick={() => removeShortAsset(asset.id)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Short search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Add short position..."
                value={shortSearch}
                onChange={(e) => {
                  setShortSearch(e.target.value)
                  setShowShortDropdown(true)
                }}
                onFocus={() => setShowShortDropdown(true)}
                onKeyDown={handleKeyDown}
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              {showShortDropdown && shortSearchResults && shortSearchResults.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {shortSearchResults
                    .filter(asset => !shortAssets.find(a => a.id === asset.id))
                    .map(asset => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => addShortAsset(asset)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{asset.symbol}</span>
                        <span className="text-sm text-gray-500 ml-2">{asset.company_name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Urgency */}
      <div className="mb-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Urgency</span>
          <span className="text-[10px] text-gray-400">· affects priority ranking</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {urgencyOptions.map((option) => {
            const isSelected = urgency === option.value
            return (
              <button
                key={option.value}
                onClick={() => setUrgency(option.value)}
                className={clsx(
                  "px-2 py-1 rounded-full text-xs font-medium border transition-all capitalize",
                  isSelected ? option.color + ' border-current' : "text-gray-500 bg-white border-gray-200 hover:bg-gray-50"
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Rationale */}
      <textarea
        ref={textareaRef}
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Why now? What's the catalyst or risk? (optional)"
        className="w-full resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-400 caret-gray-900 min-h-[60px] mb-3"
        rows={2}
      />

      {/* Portfolio selector */}
      {portfolios && portfolios.length > 0 && (
        <div className="relative mb-3">
          <button
            type="button"
            onClick={() => setShowPortfolioMenu(!showPortfolioMenu)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FolderKanban className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-gray-700">
                {selectedPortfolioIds.length === 0
                  ? 'No specific portfolio'
                  : selectedPortfolioIds.length === 1
                    ? portfolios.find(p => p.id === selectedPortfolioIds[0])?.name
                    : `${selectedPortfolioIds.length} portfolios`}
              </span>
            </div>
            <ChevronDown className={clsx("h-4 w-4 text-gray-400 transition-transform", showPortfolioMenu && "rotate-180")} />
          </button>

          {showPortfolioMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPortfolioMenu(false)} />
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto">
                {/* No portfolio option */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPortfolioIds([])
                    setShowPortfolioMenu(false)
                  }}
                  className={clsx(
                    "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 text-sm",
                    selectedPortfolioIds.length === 0 && "bg-primary-50"
                  )}
                >
                  <div className={clsx(
                    "h-4 w-4 rounded border flex items-center justify-center",
                    selectedPortfolioIds.length === 0 ? "bg-primary-500 border-primary-500" : "border-gray-300"
                  )}>
                    {selectedPortfolioIds.length === 0 && <span className="text-white text-xs">✓</span>}
                  </div>
                  <span className="text-gray-600">No specific portfolio</span>
                </button>

                <div className="border-t border-gray-100 my-1" />

                {/* Portfolio options */}
                {portfolios.map(p => {
                  const isSelected = selectedPortfolioIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedPortfolioIds(selectedPortfolioIds.filter(id => id !== p.id))
                        } else {
                          setSelectedPortfolioIds([...selectedPortfolioIds, p.id])
                        }
                      }}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 text-sm",
                        isSelected && "bg-primary-50"
                      )}
                    >
                      <div className={clsx(
                        "h-4 w-4 rounded border flex items-center justify-center",
                        isSelected ? "bg-primary-500 border-primary-500" : "border-gray-300"
                      )}>
                        {isSelected && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span className="text-gray-700">{p.name}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Footer with visibility and submit */}
      <div className="pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between">
          {/* Visibility selector */}
          <div className="relative">
          <button
            onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 px-2.5 py-1.5 rounded-md border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            {getVisibilityIcon()}
            <span>{getVisibilityLabel()}</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {showVisibilityMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => {
                setShowVisibilityMenu(false)
                setVisibilityStep('main')
              }} />
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[220px] z-20 max-h-64 overflow-y-auto">
                {visibilityStep === 'main' && (
                  <>
                    <button
                      onClick={() => handleVisibilitySelect('private')}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                        visibility === 'private' && "bg-gray-50"
                      )}
                    >
                      <Lock className="h-4 w-4 text-gray-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">Only me</div>
                        <div className="text-xs text-gray-500">Private to you</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleVisibilitySelect('organization')}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                        visibility === 'organization' && "bg-gray-50"
                      )}
                    >
                      <Building2 className="h-4 w-4 text-indigo-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">Organization</div>
                        <div className="text-xs text-gray-500">
                          {selectedOrgNodeName || 'Select division, department, team...'}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </button>
                    <button
                      onClick={() => handleVisibilitySelect('public')}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                        visibility === 'public' && "bg-gray-50"
                      )}
                    >
                      <Globe className="h-4 w-4 text-green-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">Public</div>
                        <div className="text-xs text-gray-500">Visible to everyone</div>
                      </div>
                    </button>
                  </>
                )}

                {visibilityStep === 'category' && (
                  <>
                    <button
                      onClick={handleVisibilityBack}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100"
                    >
                      <ChevronLeft className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">Back</span>
                    </button>
                    {categoryOptions.map((category) => {
                      const Icon = category.icon
                      const count = nodesByType[category.value]?.length || 0
                      return (
                        <button
                          key={category.value}
                          onClick={() => handleCategorySelect(category.value)}
                          disabled={count === 0}
                          className={clsx(
                            "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                            count === 0 && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <div className={clsx("h-4 w-4 rounded flex items-center justify-center", category.color)}>
                            <Icon className="h-2.5 w-2.5 text-white" />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{category.label}</div>
                            <div className="text-xs text-gray-500">{count} available</div>
                          </div>
                          {count > 0 && <ChevronRight className="h-4 w-4 text-gray-400" />}
                        </button>
                      )
                    })}
                  </>
                )}

                {visibilityStep === 'items' && selectedCategory && (
                  <>
                    <button
                      onClick={handleVisibilityBack}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100"
                    >
                      <ChevronLeft className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">Back</span>
                    </button>
                    {nodesByType[selectedCategory]?.map((node) => {
                      const category = categoryOptions.find(c => c.value === selectedCategory)
                      const Icon = category?.icon || Users
                      return (
                        <button
                          key={node.id}
                          onClick={() => handleNodeSelect(node)}
                          className={clsx(
                            "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                            selectedOrgNodeId === node.id && "bg-primary-50"
                          )}
                        >
                          <div className={clsx("h-4 w-4 rounded flex items-center justify-center", category?.color || 'bg-gray-500')}>
                            <Icon className="h-2.5 w-2.5 text-white" />
                          </div>
                          <div className="text-sm font-medium text-gray-900">{node.name}</div>
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 rounded-md border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={
                (tradeType === 'single' && !selectedAsset) ||
                (tradeType === 'pair' && (longAssets.length === 0 || shortAssets.length === 0)) ||
                createTradeIdea.isPending
              }
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
                (tradeType === 'single' && selectedAsset) || (tradeType === 'pair' && longAssets.length > 0 && shortAssets.length > 0)
                  ? "bg-green-600 text-white hover:bg-green-700 shadow-sm"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              )}
            >
              {createTradeIdea.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Error message */}
        {submitError && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
            <p className="text-xs text-red-600">{submitError}</p>
          </div>
        )}

        {/* Visibility consequence + submission outcome */}
        <div className="flex items-center justify-between mt-2 text-[10px] text-gray-400">
          <span>
            {visibility === 'private'
              ? 'This will not notify others.'
              : 'Relevant teammates will see this in What\'s New.'}
          </span>
          <span>
            Creates a decision in Priorities
          </span>
        </div>
      </div>
    </div>
  )
}
