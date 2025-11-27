import { useState, useMemo, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Search, TrendingUp, TrendingDown, Info, CheckCircle, XCircle, Link2, Plus, Trash2, ArrowRightLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import type { TradeAction, TradeUrgency, CreateTradeQueueItemInput, PairLegType } from '../../types/trading'
import { clsx } from 'clsx'

// Pair trade leg form state
interface LegFormState {
  id: string
  assetId: string
  assetSearch: string
  showAssetSearch: boolean
  selectedAsset: { id: string; symbol: string; company_name: string; sector: string | null } | null
  action: TradeAction
  proposedWeight: string
  proposedShares: string
  targetPrice: string
  legType: PairLegType
}

const createEmptyLeg = (legType: PairLegType): LegFormState => ({
  id: crypto.randomUUID(),
  assetId: '',
  assetSearch: '',
  showAssetSearch: false,
  selectedAsset: null,
  action: legType === 'long' ? 'buy' : 'sell',
  proposedWeight: '',
  proposedShares: '',
  targetPrice: '',
  legType,
})

interface AddTradeIdeaModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  preselectedAssetId?: string
  preselectedPortfolioId?: string
}

export function AddTradeIdeaModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedAssetId,
  preselectedPortfolioId
}: AddTradeIdeaModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Mode toggle - single trade vs pair trade
  const [isPairTrade, setIsPairTrade] = useState(false)

  // Form state (shared)
  const [portfolioId, setPortfolioId] = useState(preselectedPortfolioId || '')
  const [urgency, setUrgency] = useState<TradeUrgency>('medium')
  const [rationale, setRationale] = useState('')
  const [thesisSummary, setThesisSummary] = useState('')

  // Single trade state
  const [assetId, setAssetId] = useState(preselectedAssetId || '')
  const [assetSearch, setAssetSearch] = useState('')
  const [action, setAction] = useState<TradeAction>('buy')
  const [proposedWeight, setProposedWeight] = useState<string>('')
  const [proposedShares, setProposedShares] = useState<string>('')
  const [targetPrice, setTargetPrice] = useState<string>('')
  const [showAssetSearch, setShowAssetSearch] = useState(false)

  // Pair trade state
  const [pairTradeName, setPairTradeName] = useState('')
  const [pairTradeDescription, setPairTradeDescription] = useState('')
  const [legs, setLegs] = useState<LegFormState[]>([
    createEmptyLeg('long'),
    createEmptyLeg('short'),
  ])
  const [activeSearchLegId, setActiveSearchLegId] = useState<string | null>(null)
  const [globalAssetSearch, setGlobalAssetSearch] = useState('')

  // Fetch portfolios
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, portfolio_id')
        .order('name')

      if (error) throw error
      return data
    },
    enabled: isOpen,
  })

  // Search assets
  const { data: assets } = useQuery({
    queryKey: ['assets-search', assetSearch],
    queryFn: async () => {
      if (!assetSearch || assetSearch.length < 1) return []

      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${assetSearch}%,company_name.ilike.%${assetSearch}%`)
        .limit(10)

      if (error) throw error
      return data
    },
    enabled: isOpen && assetSearch.length >= 1 && !isPairTrade,
  })

  // Search assets for pair trade legs
  const { data: pairTradeSearchResults } = useQuery({
    queryKey: ['assets-search', globalAssetSearch],
    queryFn: async () => {
      if (!globalAssetSearch || globalAssetSearch.length < 1) return []

      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${globalAssetSearch}%,company_name.ilike.%${globalAssetSearch}%`)
        .limit(10)

      if (error) throw error
      return data
    },
    enabled: isOpen && globalAssetSearch.length >= 1 && isPairTrade,
  })

  // Get selected asset details
  const { data: selectedAsset } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .eq('id', assetId)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!assetId,
  })

  // Fetch portfolio holdings to check if asset is owned
  const { data: portfolioHoldings } = useQuery({
    queryKey: ['portfolio-holdings', portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('asset_id, shares, price')
        .eq('portfolio_id', portfolioId)

      if (error) throw error
      return data
    },
    enabled: !!portfolioId,
  })

  // Calculate position info for selected asset
  const positionInfo = useMemo(() => {
    if (!portfolioHoldings || !assetId) return null

    const holding = portfolioHoldings.find(h => h.asset_id === assetId)
    const totalPortfolioValue = portfolioHoldings.reduce(
      (sum, h) => sum + (h.shares * h.price), 0
    )

    if (!holding) {
      return {
        isOwned: false,
        shares: 0,
        marketValue: 0,
        currentWeight: 0,
        totalPortfolioValue,
      }
    }

    const marketValue = holding.shares * holding.price
    const currentWeight = totalPortfolioValue > 0
      ? (marketValue / totalPortfolioValue) * 100
      : 0

    return {
      isOwned: true,
      shares: holding.shares,
      marketValue,
      currentWeight,
      totalPortfolioValue,
    }
  }, [portfolioHoldings, assetId])

  // Auto-adjust action when ownership status changes
  useEffect(() => {
    if (positionInfo === null) return

    const isOwned = positionInfo.isOwned
    // If owned and current action is 'buy', switch to 'add'
    if (isOwned && action === 'buy') {
      setAction('add')
    }
    // If not owned and current action is not 'buy', switch to 'buy'
    if (!isOwned && ['sell', 'add', 'trim'].includes(action)) {
      setAction('buy')
    }
  }, [positionInfo?.isOwned])

  // Create single trade mutation
  const createMutation = useMutation({
    mutationFn: async (input: CreateTradeQueueItemInput) => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .insert({
          ...input,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      resetForm()
      onSuccess()
    },
  })

  // Create pair trade mutation
  const createPairTradeMutation = useMutation({
    mutationFn: async () => {
      // First create the pair trade
      const { data: pairTrade, error: pairError } = await supabase
        .from('pair_trades')
        .insert({
          portfolio_id: portfolioId,
          name: pairTradeName || autoGeneratePairTradeName,
          description: pairTradeDescription,
          rationale,
          thesis_summary: thesisSummary,
          urgency,
          status: 'idea',
          created_by: user?.id,
        })
        .select()
        .single()

      if (pairError) throw pairError

      // Then create the trade queue items for each leg
      const legsToInsert = legs
        .filter(leg => leg.assetId) // Only include legs with selected assets
        .map(leg => ({
          portfolio_id: portfolioId,
          asset_id: leg.assetId,
          action: leg.action,
          proposed_shares: leg.proposedShares ? parseFloat(leg.proposedShares) : null,
          proposed_weight: leg.proposedWeight ? parseFloat(leg.proposedWeight) : null,
          target_price: leg.targetPrice ? parseFloat(leg.targetPrice) : null,
          urgency,
          status: 'idea',
          rationale: '',
          thesis_summary: '',
          created_by: user?.id,
          pair_trade_id: pairTrade.id,
          pair_leg_type: leg.legType,
        }))

      if (legsToInsert.length > 0) {
        const { error: legsError } = await supabase
          .from('trade_queue_items')
          .insert(legsToInsert)

        if (legsError) throw legsError
      }

      return pairTrade
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['pair-trades'] })
      resetForm()
      onSuccess()
    },
  })

  // Auto-generate pair trade name from selected assets
  const autoGeneratePairTradeName = useMemo(() => {
    const longLegs = legs.filter(l => l.legType === 'long' && l.selectedAsset)
    const shortLegs = legs.filter(l => l.legType === 'short' && l.selectedAsset)

    if (longLegs.length === 0 && shortLegs.length === 0) return ''

    const longSymbols = longLegs.map(l => l.selectedAsset!.symbol).join('/')
    const shortSymbols = shortLegs.map(l => l.selectedAsset!.symbol).join('/')

    if (longSymbols && shortSymbols) {
      return `Long ${longSymbols} / Short ${shortSymbols}`
    } else if (longSymbols) {
      return `Long ${longSymbols}`
    } else {
      return `Short ${shortSymbols}`
    }
  }, [legs])

  const resetForm = () => {
    // Shared
    setPortfolioId(preselectedPortfolioId || '')
    setUrgency('medium')
    setRationale('')
    setThesisSummary('')
    setIsPairTrade(false)

    // Single trade
    setAssetId(preselectedAssetId || '')
    setAssetSearch('')
    setAction('buy')
    setProposedWeight('')
    setProposedShares('')
    setTargetPrice('')

    // Pair trade
    setPairTradeName('')
    setPairTradeDescription('')
    setLegs([createEmptyLeg('long'), createEmptyLeg('short')])
    setActiveSearchLegId(null)
    setGlobalAssetSearch('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!portfolioId) return

    if (isPairTrade) {
      // Validate at least 2 legs with assets selected
      const validLegs = legs.filter(leg => leg.assetId)
      if (validLegs.length < 2) {
        alert('Please select at least 2 assets for the pairs trade')
        return
      }
      createPairTradeMutation.mutate()
    } else {
      if (!assetId) return
      createMutation.mutate({
        portfolio_id: portfolioId,
        asset_id: assetId,
        action,
        proposed_weight: proposedWeight ? parseFloat(proposedWeight) : null,
        proposed_shares: proposedShares ? parseFloat(proposedShares) : null,
        target_price: targetPrice ? parseFloat(targetPrice) : null,
        urgency,
        rationale,
        thesis_summary: thesisSummary,
      })
    }
  }

  // Pair trade helper functions
  const updateLeg = (legId: string, updates: Partial<LegFormState>) => {
    setLegs(prev => prev.map(leg =>
      leg.id === legId ? { ...leg, ...updates } : leg
    ))
  }

  const selectAssetForLeg = (legId: string, asset: { id: string; symbol: string; company_name: string; sector: string | null }) => {
    updateLeg(legId, {
      assetId: asset.id,
      selectedAsset: asset,
      assetSearch: '',
      showAssetSearch: false,
    })
    setActiveSearchLegId(null)
    setGlobalAssetSearch('')
  }

  const removeLeg = (legId: string) => {
    if (legs.length <= 2) return // Keep at least 2 legs
    setLegs(prev => prev.filter(leg => leg.id !== legId))
  }

  const addLeg = (legType: PairLegType) => {
    setLegs(prev => [...prev, createEmptyLeg(legType)])
  }

  const selectAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    setAssetId(asset.id)
    setAssetSearch('')
    setShowAssetSearch(false)
  }

  if (!isOpen) return null

  const longLegs = legs.filter(l => l.legType === 'long')
  const shortLegs = legs.filter(l => l.legType === 'short')
  const suggestedPairTradeName = pairTradeName || autoGeneratePairTradeName
  const isMutating = createMutation.isPending || createPairTradeMutation.isPending

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-h-[90vh] overflow-y-auto max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            {isPairTrade && <Link2 className="h-5 w-5 text-purple-600" />}
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isPairTrade ? 'Add Pairs Trade' : 'Add Trade Idea'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Pair Trade Toggle */}
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isPairTrade}
                onChange={(e) => setIsPairTrade(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 dark:peer-focus:ring-purple-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-purple-600"></div>
            </label>
            <div className="flex items-center gap-2">
              <Link2 className={clsx("h-4 w-4", isPairTrade ? "text-purple-600" : "text-gray-400")} />
              <span className={clsx(
                "text-sm font-medium",
                isPairTrade ? "text-purple-700 dark:text-purple-300" : "text-gray-600 dark:text-gray-400"
              )}>
                Pairs Trade
              </span>
            </div>
          </div>

          {/* Portfolio Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Portfolio *
            </label>
            <select
              value={portfolioId}
              onChange={(e) => setPortfolioId(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="">Select portfolio...</option>
              {portfolios?.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* ========== SINGLE TRADE FORM ========== */}
          {!isPairTrade && (
            <>
              {/* Asset Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Asset *
                </label>
                {selectedAsset ? (
                  <div className="flex items-center justify-between p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700">
                    <div>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {selectedAsset.symbol}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                        {selectedAsset.company_name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAssetId('')
                        setShowAssetSearch(true)
                      }}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search by symbol or company name..."
                      value={assetSearch}
                      onChange={(e) => {
                        setAssetSearch(e.target.value)
                        setShowAssetSearch(true)
                      }}
                      onFocus={() => setShowAssetSearch(true)}
                      className="pl-10"
                    />
                    {showAssetSearch && assets && assets.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {assets.map(asset => (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => selectAsset(asset)}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <span className="font-medium text-gray-900 dark:text-white">
                              {asset.symbol}
                            </span>
                            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                              {asset.company_name}
                            </span>
                            {asset.sector && (
                              <span className="text-xs text-gray-400 ml-2">
                                ({asset.sector})
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Position Info Card */}
              {portfolioId && assetId && positionInfo && (
                <div className={clsx(
                  "p-3 rounded-lg border",
                  positionInfo.isOwned
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                    : "bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600"
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    {positionInfo.isOwned ? (
                      <CheckCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                    <span className={clsx(
                      "text-sm font-medium",
                      positionInfo.isOwned
                        ? "text-blue-700 dark:text-blue-300"
                        : "text-gray-600 dark:text-gray-400"
                    )}>
                      {positionInfo.isOwned ? 'Currently Owned' : 'Not Currently Owned'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 text-xs">Shares</div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {positionInfo.isOwned ? positionInfo.shares.toLocaleString() : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 text-xs">Current Weight</div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {positionInfo.isOwned ? `${positionInfo.currentWeight.toFixed(2)}%` : '0%'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 text-xs">Market Value</div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {positionInfo.isOwned
                          ? `$${positionInfo.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {positionInfo.isOwned && (
                    <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <Info className="h-3 w-3" />
                      <span>Benchmark weight data not yet available</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Action *
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['buy', 'sell', 'add', 'trim'] as TradeAction[]).map(a => {
                    // Determine if action should be disabled based on ownership
                    const isOwned = positionInfo?.isOwned ?? false
                    const isDisabled = isOwned
                      ? a === 'buy' // If owned, disable buy
                      : ['sell', 'add', 'trim'].includes(a) // If not owned, disable sell/add/trim

                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() => {
                          if (isDisabled) return
                          setAction(a)
                          // Auto-fill shares with all owned shares when selecting "sell"
                          if (a === 'sell' && positionInfo?.isOwned) {
                            setProposedShares(positionInfo.shares.toString())
                          }
                        }}
                        disabled={isDisabled}
                        className={clsx(
                          "flex items-center justify-center gap-1 px-3 py-2 rounded-lg border transition-colors capitalize",
                          isDisabled
                            ? "border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed bg-gray-50 dark:bg-gray-800"
                            : action === a
                              ? a === 'buy' || a === 'add'
                                ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                : "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                              : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        )}
                      >
                        {a === 'buy' || a === 'add' ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : (
                          <TrendingDown className="h-4 w-4" />
                        )}
                        {a}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Sizing */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Target Weight (%)
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="e.g., 2.5"
                    value={proposedWeight}
                    onChange={(e) => setProposedWeight(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Shares
                  </label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="e.g., 1000"
                    value={proposedShares}
                    onChange={(e) => setProposedShares(e.target.value)}
                  />
                </div>
              </div>

              {/* Target Price */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Target Entry Price (optional)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g., 150.00"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                />
              </div>
            </>
          )}

          {/* ========== PAIRS TRADE FORM ========== */}
          {isPairTrade && (
            <>
              {/* Pairs Trade Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Pairs Trade Name *
                </label>
                <Input
                  placeholder={autoGeneratePairTradeName || "Enter pairs trade name..."}
                  value={pairTradeName}
                  onChange={(e) => setPairTradeName(e.target.value)}
                />
                {autoGeneratePairTradeName && !pairTradeName && (
                  <p className="text-xs text-gray-500 mt-1">
                    Suggested: {autoGeneratePairTradeName}
                  </p>
                )}
              </div>

              {/* Legs Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Trade Legs *
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => addLeg('long')}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Long
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => addLeg('short')}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Short
                    </Button>
                  </div>
                </div>

                {/* Long Legs */}
                {longLegs.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-700 dark:text-green-400">Long Positions</span>
                    </div>
                    {longLegs.map(leg => (
                      <LegForm
                        key={leg.id}
                        leg={leg}
                        onUpdate={(updates) => updateLeg(leg.id, updates)}
                        onRemove={() => removeLeg(leg.id)}
                        onSelectAsset={(asset) => selectAssetForLeg(leg.id, asset)}
                        searchResults={activeSearchLegId === leg.id ? pairTradeSearchResults : []}
                        onSearchFocus={() => {
                          setActiveSearchLegId(leg.id)
                          setGlobalAssetSearch(leg.assetSearch)
                        }}
                        onSearchChange={(search) => {
                          updateLeg(leg.id, { assetSearch: search, showAssetSearch: true })
                          setGlobalAssetSearch(search)
                        }}
                        canRemove={legs.length > 2}
                      />
                    ))}
                  </div>
                )}

                {/* Divider with arrow */}
                <div className="flex items-center gap-2 py-2">
                  <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                  <ArrowRightLeft className="h-4 w-4 text-gray-400" />
                  <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                </div>

                {/* Short Legs */}
                {shortLegs.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700 dark:text-red-400">Short Positions</span>
                    </div>
                    {shortLegs.map(leg => (
                      <LegForm
                        key={leg.id}
                        leg={leg}
                        onUpdate={(updates) => updateLeg(leg.id, updates)}
                        onRemove={() => removeLeg(leg.id)}
                        onSelectAsset={(asset) => selectAssetForLeg(leg.id, asset)}
                        searchResults={activeSearchLegId === leg.id ? pairTradeSearchResults : []}
                        onSearchFocus={() => {
                          setActiveSearchLegId(leg.id)
                          setGlobalAssetSearch(leg.assetSearch)
                        }}
                        onSearchChange={(search) => {
                          updateLeg(leg.id, { assetSearch: search, showAssetSearch: true })
                          setGlobalAssetSearch(search)
                        }}
                        canRemove={legs.length > 2}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Urgency (shared) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Urgency
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['low', 'medium', 'high', 'urgent'] as TradeUrgency[]).map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUrgency(u)}
                  className={clsx(
                    "px-3 py-2 rounded-lg border transition-colors capitalize text-sm",
                    urgency === u
                      ? u === 'urgent'
                        ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                        : u === 'high'
                        ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400"
                        : u === 'medium'
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                        : "border-gray-400 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                      : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* Thesis Summary */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Thesis Summary
            </label>
            <Input
              placeholder="Brief summary of the investment thesis..."
              value={thesisSummary}
              onChange={(e) => setThesisSummary(e.target.value)}
            />
          </div>

          {/* Rationale */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Rationale
            </label>
            <TextArea
              placeholder="Why are you proposing this trade? What's the opportunity?"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !portfolioId ||
                (isPairTrade ? legs.filter(l => l.assetId).length < 2 : !assetId) ||
                isMutating
              }
              loading={isMutating}
            >
              {isPairTrade && <Link2 className="h-4 w-4 mr-2" />}
              {isPairTrade ? 'Create Pairs Trade' : 'Add to Queue'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Individual Leg Form Component for Pairs Trades
interface LegFormProps {
  leg: LegFormState
  onUpdate: (updates: Partial<LegFormState>) => void
  onRemove: () => void
  onSelectAsset: (asset: { id: string; symbol: string; company_name: string; sector: string | null }) => void
  searchResults: { id: string; symbol: string; company_name: string; sector: string | null }[] | undefined
  onSearchFocus: () => void
  onSearchChange: (search: string) => void
  canRemove: boolean
}

function LegForm({
  leg,
  onUpdate,
  onRemove,
  onSelectAsset,
  searchResults,
  onSearchFocus,
  onSearchChange,
  canRemove,
}: LegFormProps) {
  const isLong = leg.legType === 'long'

  return (
    <div className={clsx(
      "p-3 rounded-lg border",
      isLong
        ? "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10"
        : "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10"
    )}>
      <div className="flex items-start gap-3">
        {/* Asset Selection */}
        <div className="flex-1">
          {leg.selectedAsset ? (
            <div className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600">
              <div>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {leg.selectedAsset.symbol}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                  {leg.selectedAsset.company_name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onUpdate({ assetId: '', selectedAsset: null })}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search asset..."
                value={leg.assetSearch}
                onChange={(e) => onSearchChange(e.target.value)}
                onFocus={onSearchFocus}
                className="pl-10"
              />
              {leg.showAssetSearch && searchResults && searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map(asset => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => onSelectAsset(asset)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        {asset.symbol}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                        {asset.company_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Remove Button */}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Sizing - only show when asset is selected */}
      {leg.selectedAsset && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Weight (%)
            </label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="2.5"
              value={leg.proposedWeight}
              onChange={(e) => onUpdate({ proposedWeight: e.target.value })}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Shares
            </label>
            <Input
              type="number"
              step="1"
              min="0"
              placeholder="1000"
              value={leg.proposedShares}
              onChange={(e) => onUpdate({ proposedShares: e.target.value })}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Target Price
            </label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="150.00"
              value={leg.targetPrice}
              onChange={(e) => onUpdate({ targetPrice: e.target.value })}
              className="text-sm"
            />
          </div>
        </div>
      )}
    </div>
  )
}
