import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import {
  X, TrendingUp, TrendingDown, Search, Send, Loader2, ChevronDown,
  Lock, Users, FolderKanban, Lightbulb, ExternalLink, ArrowLeftRight
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { usePromoteToTradeIdea, type PromoteAction } from '../../hooks/usePromoteToTradeIdea'
import { useToast } from '../common/Toast'
import { ContextTagsInput, type ContextTag } from '../ui/ContextTagsInput'
import type { TradeUrgency } from '../../types/trading'

interface PromoteToTradeIdeaModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (tradeIdeaId: string) => void
  // Quick thought data
  quickThoughtId: string
  quickThoughtContent: string
  assetId?: string | null
  assetSymbol?: string | null
  assetName?: string | null
  portfolioId?: string | null
  portfolioName?: string | null
  visibility?: 'private' | 'team' | 'public'
}

const urgencyOptions: { value: TradeUrgency; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-slate-700 bg-slate-100 border-slate-300' },
  { value: 'medium', label: 'Medium', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { value: 'high', label: 'High', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-600 bg-red-50 border-red-200' },
]

export function PromoteToTradeIdeaModal({
  isOpen,
  onClose,
  onSuccess,
  quickThoughtId,
  quickThoughtContent,
  assetId: propAssetId,
  assetSymbol: propAssetSymbol,
  assetName: propAssetName,
  portfolioId: propPortfolioId,
  portfolioName: propPortfolioName,
  visibility: propVisibility = 'private',
}: PromoteToTradeIdeaModalProps) {
  const { user } = useAuth()
  const { success } = useToast()
  const { promote, isPromoting } = usePromoteToTradeIdea()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Trade type: single or pair
  const [tradeType, setTradeType] = useState<'single' | 'pair'>('single')

  // Asset state - single trade
  const [assetSearch, setAssetSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<{ id: string; symbol: string; company_name: string } | null>(null)
  const [showAssetDropdown, setShowAssetDropdown] = useState(false)

  // Multiple assets for pairs - long side
  const [longAssets, setLongAssets] = useState<{ id: string; symbol: string; company_name: string }[]>([])
  const [longSearch, setLongSearch] = useState('')
  const [showLongDropdown, setShowLongDropdown] = useState(false)

  // Multiple assets for pairs - short side
  const [shortAssets, setShortAssets] = useState<{ id: string; symbol: string; company_name: string }[]>([])
  const [shortSearch, setShortSearch] = useState('')
  const [showShortDropdown, setShowShortDropdown] = useState(false)

  // Trade details
  const [action, setAction] = useState<PromoteAction>('buy')
  const [urgency, setUrgency] = useState<TradeUrgency>('medium')
  const [rationale, setRationale] = useState('')

  // Context tags - will include source quick thought
  const [contextTags, setContextTags] = useState<ContextTag[]>([])

  // Portfolio selection
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>([])
  const [showPortfolioMenu, setShowPortfolioMenu] = useState(false)

  // Visibility
  const [visibility, setVisibility] = useState<'private' | 'portfolio'>('private')
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false)

  // Error state
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Result state
  const [promotedTradeIdeaId, setPromotedTradeIdeaId] = useState<string | null>(null)

  // Search assets - single trade
  const { data: assets } = useQuery({
    queryKey: ['assets-search-promote', assetSearch],
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
    enabled: assetSearch.length >= 1 && isOpen,
  })

  // Search assets - long side for pairs
  const { data: longSearchResults } = useQuery({
    queryKey: ['assets-search-long-promote', longSearch],
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
    enabled: longSearch.length >= 1 && isOpen,
  })

  // Search assets - short side for pairs
  const { data: shortSearchResults } = useQuery({
    queryKey: ['assets-search-short-promote', shortSearch],
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
    enabled: shortSearch.length >= 1 && isOpen,
  })

  // Fetch portfolios
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-list-promote'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: isOpen,
  })

  // Fetch which portfolios hold the selected asset
  const { data: portfoliosHoldingAsset } = useQuery({
    queryKey: ['portfolios-holding-asset-promote', selectedAsset?.id],
    queryFn: async () => {
      if (!selectedAsset?.id) return []
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id')
        .eq('asset_id', selectedAsset.id)
        .gt('shares', 0)
      if (error) throw error
      return data?.map(h => h.portfolio_id) || []
    },
    enabled: !!selectedAsset?.id && isOpen,
  })

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      // Set asset from props if available
      if (propAssetId && propAssetSymbol) {
        setSelectedAsset({
          id: propAssetId,
          symbol: propAssetSymbol,
          company_name: propAssetName || '',
        })
      } else {
        setSelectedAsset(null)
      }

      // Set portfolio from props if available
      if (propPortfolioId) {
        setSelectedPortfolioIds([propPortfolioId])
      } else {
        setSelectedPortfolioIds([])
      }

      // Start with no context tags
      setContextTags([])

      setTradeType('single')
      setAction('buy')
      setUrgency('medium')
      setRationale(quickThoughtContent)
      setVisibility(propVisibility === 'team' || propVisibility === 'public' ? 'portfolio' : 'private')
      setAssetSearch('')
      setShowAssetDropdown(false)
      setLongAssets([])
      setLongSearch('')
      setShowLongDropdown(false)
      setShortAssets([])
      setShortSearch('')
      setShowShortDropdown(false)
      setShowPortfolioMenu(false)
      setShowVisibilityMenu(false)
      setSubmitError(null)
      setPromotedTradeIdeaId(null)
    }
  }, [isOpen, propAssetId, propAssetSymbol, propAssetName, propPortfolioId, quickThoughtId, quickThoughtContent, propVisibility])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [rationale])

  const handleSubmit = async () => {
    if (!user?.id) return
    setSubmitError(null)

    try {
      if (tradeType === 'single') {
        // Single trade - use the promote hook
        const result = await promote({
          quickThoughtId,
          quickThoughtContent,
          action,
          assignedTo: user.id,
          assetId: selectedAsset?.id,
          portfolioId: selectedPortfolioIds.length > 0 ? selectedPortfolioIds[0] : undefined,
          urgency,
          notes: rationale.trim() || quickThoughtContent,
          visibility: visibility === 'portfolio' ? 'team' : 'private',
        })

        setPromotedTradeIdeaId(result.tradeIdeaId)
        success('Trade Idea created')
        onSuccess?.(result.tradeIdeaId)
      } else {
        // Pair trade - create multiple trade_queue_items directly
        if (longAssets.length === 0 || shortAssets.length === 0) {
          setSubmitError('Need at least one long and one short asset for pair trade')
          return
        }

        const pairId = crypto.randomUUID()
        const dbVisibility = visibility === 'portfolio' ? 'team' : 'private'
        const primaryPortfolioId = selectedPortfolioIds.length > 0 ? selectedPortfolioIds[0] : null

        const inserts: any[] = []

        // Long side
        longAssets.forEach(asset => {
          inserts.push({
            created_by: user.id,
            assigned_to: user.id,
            portfolio_id: primaryPortfolioId,
            asset_id: asset.id,
            action: 'buy',
            urgency,
            rationale: rationale.trim() || quickThoughtContent,
            stage: 'idea',
            status: 'idea',
            pair_id: pairId,
            sharing_visibility: dbVisibility,
            origin_type: 'quick_thought',
            origin_id: quickThoughtId,
            context_tags: contextTags,
          })
        })

        // Short side
        shortAssets.forEach(asset => {
          inserts.push({
            created_by: user.id,
            assigned_to: user.id,
            portfolio_id: primaryPortfolioId,
            asset_id: asset.id,
            action: 'sell',
            urgency,
            rationale: rationale.trim() || quickThoughtContent,
            stage: 'idea',
            status: 'idea',
            pair_id: pairId,
            sharing_visibility: dbVisibility,
            origin_type: 'quick_thought',
            origin_id: quickThoughtId,
            context_tags: contextTags,
          })
        })

        const { data, error } = await supabase
          .from('trade_queue_items')
          .insert(inserts)
          .select('id')

        if (error) throw error

        // Update quick thought with promotion link (use first trade idea id)
        if (data && data.length > 0) {
          await supabase
            .from('quick_thoughts')
            .update({ promoted_to_trade_idea_id: data[0].id })
            .eq('id', quickThoughtId)

          setPromotedTradeIdeaId(data[0].id)
        }

        success('Pair Trade created')
        onSuccess?.(data?.[0]?.id || '')
      }
    } catch (err) {
      setSubmitError('Failed to create trade idea. Please try again.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  const selectAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    setSelectedAsset(asset)
    setAssetSearch('')
    setShowAssetDropdown(false)
  }

  const addLongAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    if (!longAssets.find(a => a.id === asset.id)) {
      setLongAssets([...longAssets, asset])
    }
    setLongSearch('')
    setShowLongDropdown(false)
  }

  const removeLongAsset = (assetId: string) => {
    setLongAssets(longAssets.filter(a => a.id !== assetId))
  }

  const addShortAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    if (!shortAssets.find(a => a.id === asset.id)) {
      setShortAssets([...shortAssets, asset])
    }
    setShortSearch('')
    setShowShortDropdown(false)
  }

  const removeShortAsset = (assetId: string) => {
    setShortAssets(shortAssets.filter(a => a.id !== assetId))
  }

  const handleViewInTradeQueue = () => {
    if (promotedTradeIdeaId) {
      window.dispatchEvent(new CustomEvent('navigateToTradeIdea', {
        detail: { tradeIdeaId: promotedTradeIdeaId }
      }))
      onClose()
    }
  }

  const getVisibilityLabel = () => {
    if (visibility === 'private') return 'Private'
    if (visibility === 'portfolio') return 'Portfolio'
    return 'Select'
  }

  const getVisibilityIcon = () => {
    if (visibility === 'private') return <Lock className="h-3.5 w-3.5" />
    if (visibility === 'portfolio') return <Users className="h-3.5 w-3.5 text-blue-500" />
    return <Lock className="h-3.5 w-3.5" />
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-[480px] max-h-[90vh] bg-white rounded-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />
            <span className="text-sm font-semibold text-gray-900">Promote to Trade Idea</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Success State */}
        {promotedTradeIdeaId ? (
          <div className="p-5">
            <div className="flex flex-col items-center text-center py-6">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <TrendingUp className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">Trade Idea Created</h3>
              <p className="text-sm text-gray-500 mb-6">
                Your thought has been promoted to the Trade Queue.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Done
                </button>
                <button
                  onClick={handleViewInTradeQueue}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                >
                  View in Trade Queue
                  <ExternalLink className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Form */
          <div className="overflow-y-auto max-h-[calc(90vh-60px)]">
            <div className="p-4">
              {/* Source thought indicator */}
              <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-amber-600 font-medium uppercase tracking-wide mb-0.5">
                      Promoting from Quick Thought
                    </div>
                    <p className="text-xs text-amber-800 line-clamp-2">
                      {quickThoughtContent}
                    </p>
                  </div>
                </div>
              </div>

              {/* Context Tags */}
              <div className="mb-3">
                <ContextTagsInput
                  value={contextTags}
                  onChange={setContextTags}
                  placeholder="Link to assets, themes, portfolios..."
                  compact
                />
              </div>

              {/* Trade type toggle */}
              <div className="flex items-center justify-end mb-3">
                <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setTradeType('single')
                      if (longAssets.length > 0 && !selectedAsset) {
                        setSelectedAsset(longAssets[0])
                      }
                      setLongAssets([])
                      setShortAssets([])
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
                      if (selectedAsset && longAssets.length === 0) {
                        setLongAssets([selectedAsset])
                      }
                      setSelectedAsset(null)
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

              {/* Single Trade: Asset Search + Action buttons */}
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
                        type="button"
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

              {/* Pair Trade: Long + Short asset selection */}
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
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {urgencyOptions.map((option) => {
                    const isSelected = urgency === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
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
                placeholder="Why now? What's the catalyst or risk?"
                className="w-full resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-400 min-h-[60px] mb-3"
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
                          const holdsAsset = portfoliosHoldingAsset?.includes(p.id)
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
                                "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                                isSelected ? "bg-primary-500 border-primary-500" : "border-gray-300"
                              )}>
                                {isSelected && <span className="text-white text-xs">✓</span>}
                              </div>
                              <span className="text-gray-700 flex-1">{p.name}</span>
                              {holdsAsset && (
                                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  Held
                                </span>
                              )}
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
                      type="button"
                      onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
                      className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 px-2.5 py-1.5 rounded-md border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                    >
                      {getVisibilityIcon()}
                      <span>{getVisibilityLabel()}</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>

                    {showVisibilityMenu && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowVisibilityMenu(false)} />
                        <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[220px] z-20">
                          <button
                            type="button"
                            onClick={() => {
                              setVisibility('private')
                              setShowVisibilityMenu(false)
                            }}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                              visibility === 'private' && "bg-gray-50"
                            )}
                          >
                            <Lock className="h-4 w-4 text-gray-500" />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">Private</div>
                              <div className="text-xs text-gray-500">Only visible to you</div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setVisibility('portfolio')
                              setShowVisibilityMenu(false)
                            }}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                              visibility === 'portfolio' && "bg-gray-50"
                            )}
                          >
                            <Users className="h-4 w-4 text-blue-500" />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">Portfolio</div>
                              <div className="text-xs text-gray-500">Members can see</div>
                            </div>
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 rounded-md border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isPromoting || (tradeType === 'pair' && (longAssets.length === 0 || shortAssets.length === 0))}
                      className={clsx(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
                        "bg-green-600 text-white hover:bg-green-700 shadow-sm disabled:opacity-50"
                      )}
                    >
                      {isPromoting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span>Create Trade Idea</span>
                    </button>
                  </div>
                </div>

                {/* Error message */}
                {submitError && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-xs text-red-600">{submitError}</p>
                  </div>
                )}

                {/* Info note */}
                <div className="flex items-center justify-between mt-2 text-[10px] text-gray-400">
                  <span>
                    {visibility === 'private'
                      ? 'This will not notify others.'
                      : 'Relevant teammates will see this.'}
                  </span>
                  <span>
                    Adds to Trade Queue as "Idea" stage
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
