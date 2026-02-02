import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { X, Search, TrendingUp, TrendingDown, Info, CheckCircle, XCircle, Link2, Plus, Trash2, ArrowRightLeft, ChevronDown, Check, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTradeIdeaService } from '../../hooks/useTradeIdeaService'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import { ContextTagsInput, type ContextTag } from '../ui/ContextTagsInput'
import { inferProvenance, getProvenanceDisplayText, type Provenance } from '../../lib/provenance'
import type { TradeAction, TradeUrgency, PairLegType } from '../../types/trading'
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
  const location = useLocation()

  // Use the audited trade idea service
  const {
    createTrade,
    createPairTrade,
    isCreating,
    isCreatingPairTrade,
  } = useTradeIdeaService({
    onCreateSuccess: () => {
      resetForm()
      onSuccess()
    },
    onCreatePairTradeSuccess: () => {
      resetForm()
      onSuccess()
    },
  })

  // Mode toggle - single trade vs pair trade
  const [isPairTrade, setIsPairTrade] = useState(false)

  // Form state (shared)
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>(
    preselectedPortfolioId ? [preselectedPortfolioId] : []
  )
  const [showPortfolioDropdown, setShowPortfolioDropdown] = useState(false)
  const portfolioDropdownRef = useRef<HTMLDivElement>(null)
  const [urgency, setUrgency] = useState<TradeUrgency>('medium')
  const [rationale, setRationale] = useState('')
  const [thesisSummary, setThesisSummary] = useState('')
  const [contextTags, setContextTags] = useState<ContextTag[]>([])

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

  // Fetch which portfolios hold the selected asset
  const { data: portfoliosHoldingAsset } = useQuery({
    queryKey: ['portfolios-holding-asset', assetId],
    queryFn: async () => {
      if (!assetId) return []
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id')
        .eq('asset_id', assetId)
        .gt('shares', 0)

      if (error) throw error
      return data?.map(h => h.portfolio_id) || []
    },
    enabled: isOpen && !!assetId && !isPairTrade,
  })

  // Fetch detailed holdings for selected portfolios (for context display)
  const { data: selectedPortfolioHoldings } = useQuery({
    queryKey: ['selected-portfolio-holdings', selectedPortfolioIds, assetId],
    queryFn: async () => {
      if (selectedPortfolioIds.length === 0 || !assetId) return []

      // Get holdings for the selected asset in all selected portfolios
      const { data: assetHoldings, error: assetError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, price')
        .eq('asset_id', assetId)
        .in('portfolio_id', selectedPortfolioIds)

      if (assetError) throw assetError

      // Get total portfolio values for weight calculation
      const { data: allHoldings, error: allError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, price')
        .in('portfolio_id', selectedPortfolioIds)

      if (allError) throw allError

      // Calculate totals per portfolio
      const portfolioTotals: Record<string, number> = {}
      allHoldings?.forEach(h => {
        portfolioTotals[h.portfolio_id] = (portfolioTotals[h.portfolio_id] || 0) + (h.shares * h.price)
      })

      // Build result with context for each portfolio
      return selectedPortfolioIds.map(portfolioId => {
        const holding = assetHoldings?.find(h => h.portfolio_id === portfolioId)
        const totalValue = portfolioTotals[portfolioId] || 0
        const marketValue = holding ? holding.shares * holding.price : 0
        const weight = totalValue > 0 ? (marketValue / totalValue) * 100 : 0

        return {
          portfolioId,
          isOwned: !!holding && holding.shares > 0,
          shares: holding?.shares || 0,
          marketValue,
          weight,
          totalPortfolioValue: totalValue,
        }
      })
    },
    enabled: isOpen && selectedPortfolioIds.length > 0 && !!assetId && !isPairTrade,
  })

  // Click outside handler for portfolio dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (portfolioDropdownRef.current && !portfolioDropdownRef.current.contains(event.target as Node)) {
        setShowPortfolioDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  // For position info display, use the first selected portfolio
  const firstSelectedPortfolioId = selectedPortfolioIds[0] || null

  // Fetch portfolio holdings to check if asset is owned
  const { data: portfolioHoldings } = useQuery({
    queryKey: ['portfolio-holdings', firstSelectedPortfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('asset_id, shares, price')
        .eq('portfolio_id', firstSelectedPortfolioId!)

      if (error) throw error
      return data
    },
    enabled: !!firstSelectedPortfolioId,
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

  // Compute provenance from current context
  const provenance = useMemo<Provenance>(() => {
    return inferProvenance({
      pathname: location.pathname,
      assetId: assetId || preselectedAssetId,
      assetSymbol: selectedAsset?.symbol,
      assetName: selectedAsset?.company_name,
      portfolioId: selectedPortfolioIds[0] || preselectedPortfolioId,
      portfolioName: portfolios?.find(p => p.id === (selectedPortfolioIds[0] || preselectedPortfolioId))?.name,
    })
  }, [location.pathname, assetId, preselectedAssetId, selectedAsset, selectedPortfolioIds, preselectedPortfolioId, portfolios])

  // Get display text for provenance (shown as passive info)
  const provenanceDisplayText = useMemo(() => {
    return getProvenanceDisplayText(provenance)
  }, [provenance])

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

  // Auto-select portfolios where the asset is held
  useEffect(() => {
    if (!portfoliosHoldingAsset || portfoliosHoldingAsset.length === 0) return
    if (isPairTrade) return

    // Merge with existing selections, avoiding duplicates
    setSelectedPortfolioIds(prev => {
      const newIds = portfoliosHoldingAsset.filter(id => !prev.includes(id))
      if (newIds.length === 0) return prev
      return [...prev, ...newIds]
    })
  }, [portfoliosHoldingAsset, isPairTrade])

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
    setSelectedPortfolioIds(preselectedPortfolioId ? [preselectedPortfolioId] : [])
    setShowPortfolioDropdown(false)
    setUrgency('medium')
    setRationale('')
    setThesisSummary('')
    setContextTags([])
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (selectedPortfolioIds.length === 0) return

    if (isPairTrade) {
      // Validate at least 2 legs with assets selected
      const validLegs = legs.filter(leg => leg.assetId)
      if (validLegs.length < 2) {
        alert('Please select at least 2 assets for the pairs trade')
        return
      }
      // Create pair trade for each selected portfolio
      for (const portfolioId of selectedPortfolioIds) {
        createPairTrade({
          portfolioId,
          name: pairTradeName || autoGeneratePairTradeName,
          description: pairTradeDescription,
          rationale,
          thesisSummary,
          urgency,
          legs: validLegs.map(leg => ({
            assetId: leg.assetId,
            action: leg.action,
            legType: leg.legType,
            proposedWeight: leg.proposedWeight ? parseFloat(leg.proposedWeight) : null,
            proposedShares: leg.proposedShares ? parseFloat(leg.proposedShares) : null,
            targetPrice: leg.targetPrice ? parseFloat(leg.targetPrice) : null,
          })),
          uiSource: 'add_trade_modal',
        })
      }
    } else {
      if (!assetId) return
      // Create trade for each selected portfolio
      for (const portfolioId of selectedPortfolioIds) {
        createTrade({
          portfolioId,
          assetId,
          action,
          proposedWeight: proposedWeight ? parseFloat(proposedWeight) : null,
          proposedShares: proposedShares ? parseFloat(proposedShares) : null,
          targetPrice: targetPrice ? parseFloat(targetPrice) : null,
          urgency,
          rationale,
          thesisSummary,
          uiSource: 'add_trade_modal',
          // Provenance
          originType: provenance.origin_type,
          originEntityType: provenance.origin_entity_type,
          originEntityId: provenance.origin_entity_id,
          originRoute: provenance.origin_route,
          originMetadata: provenance.origin_metadata,
          // Context tags
          contextTags,
        })
      }
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
  const isMutating = isCreating || isCreatingPairTrade

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

          {/* Portfolio Selection - Multi-select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Portfolio(s) *
            </label>
            <div className="relative" ref={portfolioDropdownRef}>
              <button
                type="button"
                onClick={() => setShowPortfolioDropdown(!showPortfolioDropdown)}
                className={clsx(
                  "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-left flex items-center justify-between",
                  selectedPortfolioIds.length === 0
                    ? "border-gray-300 dark:border-gray-600"
                    : "border-primary-500 dark:border-primary-400"
                )}
              >
                <span className={clsx(
                  selectedPortfolioIds.length === 0
                    ? "text-gray-500 dark:text-gray-400"
                    : "text-gray-900 dark:text-white"
                )}>
                  {selectedPortfolioIds.length === 0
                    ? "Select portfolio(s)"
                    : `${selectedPortfolioIds.length} portfolio${selectedPortfolioIds.length > 1 ? 's' : ''} selected`}
                </span>
                <ChevronDown className={clsx(
                  "h-4 w-4 text-gray-400 transition-transform",
                  showPortfolioDropdown && "rotate-180"
                )} />
              </button>

              {showPortfolioDropdown && (
                <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {portfolios?.map(p => {
                    const isSelected = selectedPortfolioIds.includes(p.id)
                    const holdsAsset = portfoliosHoldingAsset?.includes(p.id)

                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPortfolioIds(prev =>
                            isSelected
                              ? prev.filter(id => id !== p.id)
                              : [...prev, p.id]
                          )
                        }}
                        className={clsx(
                          "w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700",
                          isSelected && "bg-primary-50 dark:bg-primary-900/20"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className={clsx(
                            "w-4 h-4 rounded border flex items-center justify-center",
                            isSelected
                              ? "bg-primary-600 border-primary-600"
                              : "border-gray-300 dark:border-gray-600"
                          )}>
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className="text-gray-900 dark:text-white">{p.name}</span>
                        </div>
                        {holdsAsset && !isPairTrade && (
                          <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                            Holds asset
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Required message when no portfolios selected */}
            {selectedPortfolioIds.length === 0 && (
              <div className="mt-2 flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  No portfolio selected yet. Select at least one portfolio to see trade ideas in the portfolio trade labs.
                </span>
              </div>
            )}

            {/* Show selected portfolios as tags */}
            {selectedPortfolioIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedPortfolioIds.map(id => {
                  const portfolio = portfolios?.find(p => p.id === id)
                  if (!portfolio) return null
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded text-xs"
                    >
                      {portfolio.name}
                      <button
                        type="button"
                        onClick={() => setSelectedPortfolioIds(prev => prev.filter(pid => pid !== id))}
                        className="hover:text-primary-900 dark:hover:text-primary-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
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
              {firstSelectedPortfolioId && assetId && positionInfo && (
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

              {/* Portfolio Context - show ownership in each selected portfolio */}
              {selectedPortfolioIds.length > 0 && assetId && selectedPortfolioHoldings && selectedPortfolioHoldings.length > 0 && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Portfolio Context
                  </label>
                  <div className="space-y-2">
                    {selectedPortfolioHoldings.map(holding => {
                      const portfolio = portfolios?.find(p => p.id === holding.portfolioId)
                      if (!portfolio) return null

                      return (
                        <div
                          key={holding.portfolioId}
                          className={clsx(
                            "p-3 rounded-lg border",
                            holding.isOwned
                              ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                              : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                          )}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-900 dark:text-white text-sm">
                              {portfolio.name}
                            </span>
                            <span className={clsx(
                              "text-xs px-2 py-0.5 rounded-full",
                              holding.isOwned
                                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                                : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                            )}>
                              {holding.isOwned ? 'Owned' : 'Not Owned'}
                            </span>
                          </div>

                          {holding.isOwned ? (
                            <div className="grid grid-cols-3 gap-3 text-xs">
                              <div>
                                <div className="text-gray-500 dark:text-gray-400">Shares</div>
                                <div className="font-medium text-gray-900 dark:text-white">
                                  {holding.shares.toLocaleString()}
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500 dark:text-gray-400">Weight</div>
                                <div className="font-medium text-gray-900 dark:text-white">
                                  {holding.weight.toFixed(2)}%
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500 dark:text-gray-400">Value</div>
                                <div className="font-medium text-gray-900 dark:text-white">
                                  ${holding.marketValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              This asset is not currently held in this portfolio
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
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

          {/* Context Tags */}
          <ContextTagsInput
            value={contextTags}
            onChange={setContextTags}
            placeholder="Search assets, themes, portfolios..."
          />

          {/* Provenance Display */}
          {provenanceDisplayText && (
            <div className="text-xs text-gray-400 dark:text-gray-500 italic">
              {provenanceDisplayText}
            </div>
          )}

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
                selectedPortfolioIds.length === 0 ||
                (isPairTrade ? legs.filter(l => l.assetId).length < 2 : !assetId) ||
                isMutating
              }
              loading={isMutating}
            >
              {isPairTrade && <Link2 className="h-4 w-4 mr-2" />}
              {isPairTrade ? 'Create Pairs Trade' : `Add to ${selectedPortfolioIds.length > 1 ? `${selectedPortfolioIds.length} Portfolios` : 'Queue'}`}
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
