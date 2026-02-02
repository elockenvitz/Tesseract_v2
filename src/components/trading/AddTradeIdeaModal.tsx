import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { X, Search, TrendingUp, TrendingDown, Link2, ArrowLeftRight, ChevronDown, ChevronUp, Check, FolderKanban, Lock, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTradeIdeaService } from '../../hooks/useTradeIdeaService'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { ContextTagsInput, type ContextTag } from '../ui/ContextTagsInput'
import { inferProvenance, type Provenance } from '../../lib/provenance'
import type { TradeAction, TradeUrgency, PairLegType } from '../../types/trading'
import { clsx } from 'clsx'

// Urgency options matching QuickTradeIdeaCapture
const urgencyOptions: { value: TradeUrgency; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-slate-700 bg-slate-100 border-slate-300' },
  { value: 'medium', label: 'Medium', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { value: 'high', label: 'High', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-600 bg-red-50 border-red-200' },
]

// Visibility options - must match database constraint: 'private', 'team', 'public'
type VisibilityOption = 'private' | 'team'
const visibilityOptions: { value: VisibilityOption; label: string; description: string; icon: typeof Lock }[] = [
  { value: 'private', label: 'Private', description: 'Only visible to you', icon: Lock },
  { value: 'team', label: 'Team', description: 'Members of selected portfolios can see', icon: Users },
]

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
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Use the audited trade idea service
  const {
    createTradeAsync,
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
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const portfolioDropdownRef = useRef<HTMLDivElement>(null)
  const portfolioButtonRef = useRef<HTMLButtonElement>(null)
  const [urgency, setUrgency] = useState<TradeUrgency>('medium')
  // Combined rationale/thesis field (matching QuickTradeIdeaCapture)
  const [rationale, setRationale] = useState('')
  const [contextTags, setContextTags] = useState<ContextTag[]>([])

  // Visibility
  const [visibility, setVisibility] = useState<VisibilityOption>('private')
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false)

  // Advanced section toggle
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Sizing mode: how to interpret target weights
  type SizingMode = 'absolute' | 'relative_current' | 'relative_benchmark'
  const [sizingMode, setSizingMode] = useState<SizingMode>('absolute')

  // Per-portfolio targets - stores ABSOLUTE values internally
  // Display converts based on sizingMode, input converts back to absolute
  const [portfolioTargets, setPortfolioTargets] = useState<Record<string, {
    absoluteWeight: number | null  // Always stored as absolute target %
    absoluteShares: number | null  // Always stored as absolute target shares
    sourceField: 'weight' | 'shares' | null
  }>>({})

  // Track active input to show raw value while typing (prevents formatting interference)
  const [activeInput, setActiveInput] = useState<{
    portfolioId: string
    field: 'weight' | 'shares'
    rawValue: string
  } | null>(null)

  // Track which portfolio badge is expanded to show positioning details
  const [expandedPortfolioBadge, setExpandedPortfolioBadge] = useState<string | null>(null)

  // Additional price targets
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')

  // Conviction level - null means unselected
  const [conviction, setConviction] = useState<'low' | 'medium' | 'high' | null>(null)

  // Time horizon - null means unselected
  const [timeHorizon, setTimeHorizon] = useState<'short' | 'medium' | 'long' | null>(null)

  // Single trade state
  const [assetId, setAssetId] = useState(preselectedAssetId || '')
  const [assetSearch, setAssetSearch] = useState('')
  const [assetSearchHighlightIndex, setAssetSearchHighlightIndex] = useState(0)
  const [action, setAction] = useState<TradeAction | null>(null)
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
          price: holding?.price || 0,
          marketValue,
          weight,
          totalPortfolioValue: totalValue,
        }
      })
    },
    enabled: isOpen && selectedPortfolioIds.length > 0 && !!assetId && !isPairTrade,
  })

  // Fetch current asset price (for calculations when asset not held in portfolio)
  const { data: assetPrice } = useQuery({
    queryKey: ['asset-price', assetId],
    queryFn: async () => {
      // First try to get from portfolio_holdings (most recent price)
      const { data: holdingData } = await supabase
        .from('portfolio_holdings')
        .select('price')
        .eq('asset_id', assetId)
        .gt('price', 0)
        .limit(1)
        .single()

      if (holdingData?.price) return holdingData.price

      // Fallback to assets table if it has a price field
      const { data: assetData } = await supabase
        .from('assets')
        .select('price')
        .eq('id', assetId)
        .single()

      return assetData?.price || 0
    },
    enabled: isOpen && !!assetId && !isPairTrade,
  })

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      // Reset all form state when modal opens
      setIsPairTrade(false)
      setSelectedPortfolioIds(preselectedPortfolioId ? [preselectedPortfolioId] : [])
      setShowPortfolioDropdown(false)
      setUrgency('medium')
      setRationale('')
      setContextTags([])
      setVisibility('private')
      setShowVisibilityMenu(false)
      setShowAdvanced(false)
      // Advanced options
      setSizingMode('absolute')
      setPortfolioTargets({})
      setActiveInput(null)
      setExpandedPortfolioBadge(null)
      setStopLoss('')
      setTakeProfit('')
      setConviction(null)
      setTimeHorizon(null)
      // Single trade
      setAssetId(preselectedAssetId || '')
      setAssetSearch('')
      setAction(null)
      setProposedWeight('')
      setProposedShares('')
      setTargetPrice('')
      setShowAssetSearch(false)
      setPairTradeName('')
      setPairTradeDescription('')
      setLegs([createEmptyLeg('long'), createEmptyLeg('short')])
      setActiveSearchLegId(null)
      setGlobalAssetSearch('')
    }
  }, [isOpen, preselectedPortfolioId, preselectedAssetId])

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

  // Calculate dropdown position when opening (use fixed positioning)
  useEffect(() => {
    if (showPortfolioDropdown && portfolioButtonRef.current) {
      const buttonRect = portfolioButtonRef.current.getBoundingClientRect()
      const dropdownHeight = 200 // approximate max height of dropdown
      const spaceBelow = window.innerHeight - buttonRect.bottom - 8
      const spaceAbove = buttonRect.top - 8

      // Show above if not enough space below and more space above
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        setDropdownStyle({
          position: 'fixed',
          bottom: window.innerHeight - buttonRect.top + 4,
          left: buttonRect.left,
          width: buttonRect.width,
          maxHeight: Math.min(spaceAbove, 200),
        })
      } else {
        setDropdownStyle({
          position: 'fixed',
          top: buttonRect.bottom + 4,
          left: buttonRect.left,
          width: buttonRect.width,
          maxHeight: Math.min(spaceBelow, 200),
        })
      }
    }
  }, [showPortfolioDropdown])

  // Search assets - prioritize exact ticker matches
  const { data: assets } = useQuery({
    queryKey: ['assets-search', assetSearch],
    queryFn: async () => {
      if (!assetSearch || assetSearch.length < 1) return []

      const searchTerm = assetSearch.trim().toUpperCase()

      // First, try to get exact symbol match
      const { data: exactMatch } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .ilike('symbol', searchTerm)
        .limit(1)

      // Then get partial matches
      const { data: partialMatches, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${assetSearch}%,company_name.ilike.%${assetSearch}%`)
        .limit(15)

      if (error) throw error

      // Combine: exact first, then others (excluding duplicates)
      const exactIds = new Set(exactMatch?.map(a => a.id) || [])
      const others = (partialMatches || []).filter(a => !exactIds.has(a.id))

      // Sort others: symbol matches before company name matches
      const sortedOthers = others.sort((a, b) => {
        const aSymbol = a.symbol.toUpperCase()
        const bSymbol = b.symbol.toUpperCase()

        // Symbol starts with search term
        const aStarts = aSymbol.startsWith(searchTerm) ? 0 : 1
        const bStarts = bSymbol.startsWith(searchTerm) ? 0 : 1
        if (aStarts !== bStarts) return aStarts - bStarts

        // Symbol contains search term
        const aContains = aSymbol.includes(searchTerm) ? 0 : 1
        const bContains = bSymbol.includes(searchTerm) ? 0 : 1
        if (aContains !== bContains) return aContains - bContains

        return aSymbol.localeCompare(bSymbol)
      })

      return [...(exactMatch || []), ...sortedOthers].slice(0, 10)
    },
    enabled: isOpen && assetSearch.length >= 1 && !isPairTrade,
  })

  // Search assets for pair trade legs - prioritize exact ticker matches
  const { data: pairTradeSearchResults } = useQuery({
    queryKey: ['assets-search', globalAssetSearch],
    queryFn: async () => {
      if (!globalAssetSearch || globalAssetSearch.length < 1) return []

      const searchTerm = globalAssetSearch.trim().toUpperCase()

      // First, try to get exact symbol match
      const { data: exactMatch } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .ilike('symbol', searchTerm)
        .limit(1)

      // Then get partial matches
      const { data: partialMatches, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${globalAssetSearch}%,company_name.ilike.%${globalAssetSearch}%`)
        .limit(15)

      if (error) throw error

      // Combine: exact first, then others (excluding duplicates)
      const exactIds = new Set(exactMatch?.map(a => a.id) || [])
      const others = (partialMatches || []).filter(a => !exactIds.has(a.id))

      // Sort others: symbol matches before company name matches
      const sortedOthers = others.sort((a, b) => {
        const aSymbol = a.symbol.toUpperCase()
        const bSymbol = b.symbol.toUpperCase()

        const aStarts = aSymbol.startsWith(searchTerm) ? 0 : 1
        const bStarts = bSymbol.startsWith(searchTerm) ? 0 : 1
        if (aStarts !== bStarts) return aStarts - bStarts

        const aContains = aSymbol.includes(searchTerm) ? 0 : 1
        const bContains = bSymbol.includes(searchTerm) ? 0 : 1
        if (aContains !== bContains) return aContains - bContains

        return aSymbol.localeCompare(bSymbol)
      })

      return [...(exactMatch || []), ...sortedOthers].slice(0, 10)
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
    setContextTags([])
    setVisibility('private')
    setShowVisibilityMenu(false)
    setIsPairTrade(false)
    setShowAdvanced(false)

    // Advanced options
    setSizingMode('absolute')
    setPortfolioTargets({})
    setActiveInput(null)
    setExpandedPortfolioBadge(null)
    setStopLoss('')
    setTakeProfit('')
    setConviction(null)
    setTimeHorizon(null)

    // Single trade
    setAssetId(preselectedAssetId || '')
    setAssetSearch('')
    setAction(null)
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

    const primaryPortfolioId = selectedPortfolioIds[0] || null

    if (isPairTrade) {
      // Validate at least 2 legs with assets selected
      const validLegs = legs.filter(leg => leg.assetId)
      if (validLegs.length < 2) {
        alert('Please select at least 2 assets for the pairs trade')
        return
      }
      createPairTrade({
        portfolioId: primaryPortfolioId!,
        name: pairTradeName || autoGeneratePairTradeName,
        description: pairTradeDescription,
        rationale,
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
    } else {
      if (!assetId || !action) return

      // Create the trade and get the ID back
      const result = await createTradeAsync({
        portfolioId: primaryPortfolioId!,
        assetId,
        action: action as TradeAction,
        proposedWeight: proposedWeight ? parseFloat(proposedWeight) : null,
        proposedShares: proposedShares ? parseFloat(proposedShares) : null,
        targetPrice: targetPrice ? parseFloat(targetPrice) : null,
        urgency,
        rationale,
        sharingVisibility: visibility,
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

      // Link to trade labs for ALL selected portfolios
      if (result?.id && selectedPortfolioIds.length > 0 && user?.id) {
        try {
          // Find existing trade labs for selected portfolios
          const { data: existingLabs } = await supabase
            .from('trade_labs')
            .select('id, portfolio_id')
            .in('portfolio_id', selectedPortfolioIds)

          const existingLabPortfolioIds = new Set(existingLabs?.map(l => l.portfolio_id) || [])

          // Find portfolios that need a lab created
          const portfoliosNeedingLabs = selectedPortfolioIds.filter(id => !existingLabPortfolioIds.has(id))

          // Create labs for portfolios that don't have one
          let newLabs: { id: string; portfolio_id: string }[] = []
          if (portfoliosNeedingLabs.length > 0) {
            const { data: portfolioData } = await supabase
              .from('portfolios')
              .select('id, name')
              .in('id', portfoliosNeedingLabs)

            const labInserts = portfolioData?.map(p => ({
              portfolio_id: p.id,
              name: `${p.name} Trade Lab`,
              settings: {},
              created_by: user.id,
            })) || []

            if (labInserts.length > 0) {
              const { data: createdLabs } = await supabase
                .from('trade_labs')
                .insert(labInserts)
                .select('id, portfolio_id')

              newLabs = createdLabs || []
            }
          }

          // Combine existing and new labs
          const allLabs = [...(existingLabs || []), ...newLabs]

          // Link the trade to ALL labs
          if (allLabs.length > 0) {
            const labLinks = allLabs.map(lab => ({
              trade_queue_item_id: result.id,
              trade_lab_id: lab.id,
              created_by: user.id,
            }))

            // Use upsert with onConflict to handle existing links
            await supabase
              .from('trade_lab_idea_links')
              .upsert(labLinks, {
                onConflict: 'trade_lab_id,trade_queue_item_id',
                ignoreDuplicates: true
              })

            // Invalidate queries to show updated portfolio links
            queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
            queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusions'] })
            queryClient.invalidateQueries({ queryKey: ['trade-detail'] })
          }
        } catch (linkError) {
          console.error('Failed to link trade to labs:', linkError)
          // Don't fail the whole operation if linking fails
        }
      }
    }
  }

  // Helper: Get display value for weight based on sizing mode
  const getDisplayWeight = (portfolioId: string): string => {
    const target = portfolioTargets[portfolioId]
    if (target?.absoluteWeight === null || target?.absoluteWeight === undefined) return ''

    const holding = selectedPortfolioHoldings?.find(h => h.portfolioId === portfolioId)
    const currentWeight = holding?.weight || 0
    const benchWeight = 0 // TODO: fetch from benchmark

    switch (sizingMode) {
      case 'absolute':
        return target.absoluteWeight.toFixed(2)
      case 'relative_current':
        return (target.absoluteWeight - currentWeight).toFixed(2)
      case 'relative_benchmark':
        return (target.absoluteWeight - benchWeight).toFixed(2)
      default:
        return target.absoluteWeight.toFixed(2)
    }
  }

  // Helper: Get display value for shares based on sizing mode
  const getDisplayShares = (portfolioId: string): string => {
    const target = portfolioTargets[portfolioId]
    if (target?.absoluteShares === null || target?.absoluteShares === undefined) return ''

    const holding = selectedPortfolioHoldings?.find(h => h.portfolioId === portfolioId)
    const currentShares = holding?.shares || 0
    const price = holding?.price || assetPrice || 0
    const totalPortfolioValue = holding?.totalPortfolioValue || 0
    const benchWeight = 0 // TODO: fetch from benchmark
    const benchShares = (price > 0 && totalPortfolioValue > 0)
      ? Math.round((benchWeight / 100) * totalPortfolioValue / price)
      : 0

    switch (sizingMode) {
      case 'absolute':
        return Math.round(target.absoluteShares).toString()
      case 'relative_current':
        // Show change from current shares
        const deltaFromCurrent = Math.round(target.absoluteShares - currentShares)
        return deltaFromCurrent.toString()
      case 'relative_benchmark':
        // Show change from benchmark shares
        const deltaFromBench = Math.round(target.absoluteShares - benchShares)
        return deltaFromBench.toString()
      default:
        return Math.round(target.absoluteShares).toString()
    }
  }

  // Portfolio target helper with auto-calculation
  // Converts input to absolute values, calculates the other field
  const updatePortfolioTarget = (portfolioId: string, field: 'weight' | 'shares', value: string) => {
    const holding = selectedPortfolioHoldings?.find(h => h.portfolioId === portfolioId)
    const price = holding?.price || assetPrice || 0
    const totalPortfolioValue = holding?.totalPortfolioValue || 0
    const currentWeight = holding?.weight || 0
    const benchWeight = 0 // TODO: fetch from benchmark

    // If clearing the value, reset both fields
    if (!value || value.trim() === '') {
      setPortfolioTargets(prev => ({
        ...prev,
        [portfolioId]: {
          absoluteWeight: null,
          absoluteShares: null,
          sourceField: null,
        }
      }))
      return
    }

    const numValue = parseFloat(value)
    if (isNaN(numValue)) return // Don't update if not a valid number

    let absoluteWeight: number | null = null
    let absoluteShares: number | null = null

    if (field === 'weight') {
      // Convert input to absolute weight based on sizing mode
      switch (sizingMode) {
        case 'absolute':
          absoluteWeight = numValue
          break
        case 'relative_current':
          absoluteWeight = currentWeight + numValue
          break
        case 'relative_benchmark':
          absoluteWeight = benchWeight + numValue
          break
      }

      // Calculate shares from absolute weight
      if (absoluteWeight !== null && price > 0 && totalPortfolioValue > 0) {
        const targetMarketValue = (absoluteWeight / 100) * totalPortfolioValue
        absoluteShares = Math.round(targetMarketValue / price)
      }
    } else if (field === 'shares') {
      // Convert input to absolute shares based on sizing mode
      const currentShares = holding?.shares || 0
      const benchShares = (price > 0 && totalPortfolioValue > 0)
        ? Math.round((benchWeight / 100) * totalPortfolioValue / price)
        : 0

      switch (sizingMode) {
        case 'absolute':
          absoluteShares = numValue
          break
        case 'relative_current':
          // Input is +/- change from current, convert to absolute
          absoluteShares = currentShares + numValue
          break
        case 'relative_benchmark':
          // Input is +/- change from benchmark, convert to absolute
          absoluteShares = benchShares + numValue
          break
      }

      // Calculate absolute weight from shares
      if (absoluteShares !== null && price > 0 && totalPortfolioValue > 0) {
        const targetMarketValue = absoluteShares * price
        absoluteWeight = (targetMarketValue / totalPortfolioValue) * 100
      }
    }

    setPortfolioTargets(prev => ({
      ...prev,
      [portfolioId]: {
        absoluteWeight,
        absoluteShares,
        sourceField: field,
      }
    }))
  }

  // Pair trade helper functions
  const updateLeg = (legId: string, updates: Partial<LegFormState>) => {
    setLegs(prev => prev.map(leg =>
      leg.id === legId ? { ...leg, ...updates } : leg
    ))
  }

  const addLeg = (legType: PairLegType) => {
    setLegs(prev => [...prev, createEmptyLeg(legType)])
  }

  const selectAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    setAssetId(asset.id)
    setAssetSearch('')
    setShowAssetSearch(false)
    setAssetSearchHighlightIndex(0)
  }

  // Handle keyboard navigation for asset search
  const handleAssetSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!assets || assets.length === 0) {
      // If no results but user presses Enter, try exact ticker match
      if (e.key === 'Enter' && assetSearch.trim()) {
        e.preventDefault()
        // The query should find exact match - handled in the effect below
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setAssetSearchHighlightIndex(prev =>
          prev < assets.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setAssetSearchHighlightIndex(prev =>
          prev > 0 ? prev - 1 : 0
        )
        break
      case 'Enter':
        e.preventDefault()
        if (assets[assetSearchHighlightIndex]) {
          selectAsset(assets[assetSearchHighlightIndex])
        }
        break
      case 'Escape':
        setShowAssetSearch(false)
        setAssetSearchHighlightIndex(0)
        break
    }
  }

  // Reset highlight index when search changes
  useEffect(() => {
    setAssetSearchHighlightIndex(0)
  }, [assetSearch])

  // Auto-select on exact ticker match when pressing Enter
  useEffect(() => {
    if (assets && assets.length > 0 && assetSearch.trim()) {
      // Check for exact ticker match (case insensitive)
      const exactMatch = assets.find(
        a => a.symbol.toLowerCase() === assetSearch.trim().toLowerCase()
      )
      if (exactMatch) {
        // Move exact match to top of highlight
        const exactMatchIndex = assets.findIndex(
          a => a.symbol.toLowerCase() === assetSearch.trim().toLowerCase()
        )
        if (exactMatchIndex !== -1 && assetSearchHighlightIndex === 0) {
          setAssetSearchHighlightIndex(exactMatchIndex)
        }
      }
    }
  }, [assets, assetSearch])

  if (!isOpen) return null

  const longLegs = legs.filter(l => l.legType === 'long')
  const shortLegs = legs.filter(l => l.legType === 'short')
  const isMutating = isCreating || isCreatingPairTrade

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl h-[85vh] flex flex-col">
        {/* Header - sticky */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            {isPairTrade && <Link2 className="h-5 w-5 text-purple-600" />}
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isPairTrade ? 'Add Pairs Trade' : 'Add Trade Idea'}
            </h2>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form - scrollable body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ====================================== */}
          {/* REQUIRED SECTION                       */}
          {/* ====================================== */}
          <div className="space-y-4">
            {/* Trade Type Toggle - matching QuickTradeIdeaCapture style */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Trade Type
              </span>
              <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setIsPairTrade(false)}
                  className={clsx(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                    !isPairTrade
                      ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  )}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setIsPairTrade(true)}
                  className={clsx(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1",
                    isPairTrade
                      ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  )}
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  Pair
                </button>
              </div>
            </div>

            {/* Context Tags - above asset selection */}
            <div>
              <ContextTagsInput
                value={contextTags}
                onChange={setContextTags}
                placeholder="Link to assets, themes, portfolios..."
              />
            </div>

            {/* Asset Search - Single Trade */}
            {!isPairTrade && (
              <div className="relative">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                  Asset
                </label>
                {selectedAsset ? (
                  <div className="flex items-center justify-between p-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700">
                    <div>
                      <span className="font-semibold text-gray-900 dark:text-white">{selectedAsset.symbol}</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">{selectedAsset.company_name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAssetId('')
                        setShowAssetSearch(true)
                      }}
                      className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
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
                      onKeyDown={handleAssetSearchKeyDown}
                      className="pl-10"
                    />
                    {showAssetSearch && assets && assets.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {assets.map((asset, index) => {
                          const isHighlighted = index === assetSearchHighlightIndex
                          const isExactMatch = asset.symbol.toLowerCase() === assetSearch.trim().toLowerCase()
                          return (
                            <button
                              key={asset.id}
                              type="button"
                              onClick={() => selectAsset(asset)}
                              onMouseEnter={() => setAssetSearchHighlightIndex(index)}
                              className={clsx(
                                "w-full text-left px-3 py-2",
                                isHighlighted
                                  ? "bg-primary-50 dark:bg-primary-900/30"
                                  : "hover:bg-gray-50 dark:hover:bg-gray-700"
                              )}
                            >
                              <span className={clsx(
                                "font-medium",
                                isExactMatch ? "text-primary-600 dark:text-primary-400" : "text-gray-900 dark:text-white"
                              )}>
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
                              {isExactMatch && (
                                <span className="text-[9px] text-primary-500 ml-2">↵ Enter</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Pairs Trade Assets */}
            {isPairTrade && (
              <div className="space-y-3">
                {/* Long Side */}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded">Long</span>
                    {longLegs.filter(l => l.selectedAsset).length > 0 && (
                      <span className="text-xs text-gray-400">{longLegs.filter(l => l.selectedAsset).length} selected</span>
                    )}
                  </div>
                  {/* Selected long assets */}
                  {longLegs.filter(l => l.selectedAsset).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {longLegs.filter(l => l.selectedAsset).map(leg => (
                        <span
                          key={leg.id}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-md text-xs"
                        >
                          <span className="font-medium text-green-700 dark:text-green-300">{leg.selectedAsset!.symbol}</span>
                          <button
                            type="button"
                            onClick={() => updateLeg(leg.id, { assetId: '', selectedAsset: null })}
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
                    <Input
                      placeholder="Add long position..."
                      value={globalAssetSearch}
                      onChange={(e) => {
                        setGlobalAssetSearch(e.target.value)
                        setActiveSearchLegId('long-new')
                      }}
                      onFocus={() => setActiveSearchLegId('long-new')}
                      className="pl-10"
                    />
                    {activeSearchLegId === 'long-new' && pairTradeSearchResults && pairTradeSearchResults.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {pairTradeSearchResults.map(asset => (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => {
                              addLeg('long')
                              const newLeg = { ...createEmptyLeg('long'), assetId: asset.id, selectedAsset: asset }
                              setLegs(prev => [...prev.filter(l => l.legType !== 'long' || l.assetId), newLeg, ...prev.filter(l => l.legType === 'short')])
                              setGlobalAssetSearch('')
                              setActiveSearchLegId(null)
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <span className="font-medium text-gray-900 dark:text-white">{asset.symbol}</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">{asset.company_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Short Side */}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded">Short</span>
                    {shortLegs.filter(l => l.selectedAsset).length > 0 && (
                      <span className="text-xs text-gray-400">{shortLegs.filter(l => l.selectedAsset).length} selected</span>
                    )}
                  </div>
                  {/* Selected short assets */}
                  {shortLegs.filter(l => l.selectedAsset).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {shortLegs.filter(l => l.selectedAsset).map(leg => (
                        <span
                          key={leg.id}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md text-xs"
                        >
                          <span className="font-medium text-red-700 dark:text-red-300">{leg.selectedAsset!.symbol}</span>
                          <button
                            type="button"
                            onClick={() => updateLeg(leg.id, { assetId: '', selectedAsset: null })}
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
                    <Input
                      placeholder="Add short position..."
                      value={activeSearchLegId === 'short-new' ? globalAssetSearch : ''}
                      onChange={(e) => {
                        setGlobalAssetSearch(e.target.value)
                        setActiveSearchLegId('short-new')
                      }}
                      onFocus={() => setActiveSearchLegId('short-new')}
                      className="pl-10"
                    />
                    {activeSearchLegId === 'short-new' && pairTradeSearchResults && pairTradeSearchResults.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {pairTradeSearchResults.map(asset => (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => {
                              addLeg('short')
                              const newLeg = { ...createEmptyLeg('short'), assetId: asset.id, selectedAsset: asset }
                              setLegs(prev => [...prev.filter(l => l.legType === 'long'), ...prev.filter(l => l.legType !== 'short' || l.assetId), newLeg])
                              setGlobalAssetSearch('')
                              setActiveSearchLegId(null)
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <span className="font-medium text-gray-900 dark:text-white">{asset.symbol}</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">{asset.company_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons - Single trade only, simplified to buy/sell */}
            {!isPairTrade && (
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                  Action
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAction('buy')}
                    className={clsx(
                      "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all capitalize",
                      action === 'buy'
                        ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                        : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    )}
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction('sell')}
                    className={clsx(
                      "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all capitalize",
                      action === 'sell'
                        ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                        : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    )}
                  >
                    <TrendingDown className="h-3.5 w-3.5" />
                    Sell
                  </button>
                </div>
              </div>
            )}

            {/* Urgency - pill style matching QuickTradeIdeaCapture */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Urgency</span>
                <span className="text-xs text-gray-400">· affects priority ranking</span>
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
                        "px-2.5 py-1 rounded-full text-xs font-medium border transition-all capitalize",
                        isSelected ? option.color + ' border-current' : "text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Combined Rationale/Thesis field */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Why now / What's the catalyst?
              </label>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Why now? What's the catalyst or risk? (optional)"
                className="w-full resize-none border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 dark:text-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500 min-h-[70px]"
                rows={2}
              />
            </div>

            {/* Visibility Selector */}
            <div className="relative">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Visibility
              </label>
              <button
                type="button"
                onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors bg-white dark:bg-gray-800"
              >
                <div className="flex items-center gap-2">
                  {visibility === 'private' && <Lock className="h-3.5 w-3.5 text-gray-400" />}
                  {visibility === 'team' && <Users className="h-3.5 w-3.5 text-blue-500" />}
                  <span className="text-gray-700 dark:text-gray-300">
                    {visibilityOptions.find(v => v.value === visibility)?.label}
                  </span>
                </div>
                <ChevronDown className={clsx("h-4 w-4 text-gray-400 transition-transform", showVisibilityMenu && "rotate-180")} />
              </button>

              {showVisibilityMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowVisibilityMenu(false)} />
                  <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
                    {visibilityOptions.map(option => {
                      const Icon = option.icon
                      const isSelected = visibility === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setVisibility(option.value)
                            setShowVisibilityMenu(false)
                          }}
                          className={clsx(
                            "w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-sm",
                            isSelected && "bg-primary-50 dark:bg-primary-900/20"
                          )}
                        >
                          <Icon className={clsx(
                            "h-4 w-4",
                            option.value === 'private' && "text-gray-400",
                            option.value === 'portfolio' && "text-blue-500"
                          )} />
                          <div className="flex-1">
                            <div className="font-medium text-gray-900 dark:text-white">{option.label}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{option.description}</div>
                          </div>
                          {isSelected && <Check className="h-4 w-4 text-primary-500" />}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Portfolio Selection - matching QuickTradeIdeaCapture style */}
            <div className="relative" ref={portfolioDropdownRef}>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Portfolios
              </label>
              <button
                ref={portfolioButtonRef}
                type="button"
                onClick={() => setShowPortfolioDropdown(!showPortfolioDropdown)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors bg-white dark:bg-gray-800"
              >
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-gray-700 dark:text-gray-300">
                    {selectedPortfolioIds.length === 0
                      ? 'No specific portfolio'
                      : selectedPortfolioIds.length === 1
                        ? portfolios?.find(p => p.id === selectedPortfolioIds[0])?.name
                        : `${selectedPortfolioIds.length} portfolios`}
                  </span>
                </div>
                <ChevronDown className={clsx("h-4 w-4 text-gray-400 transition-transform", showPortfolioDropdown && "rotate-180")} />
              </button>

              {showPortfolioDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowPortfolioDropdown(false)} />
                  <div
                    style={dropdownStyle}
                    className="z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 overflow-y-auto"
                  >
                    {/* No portfolio option */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPortfolioIds([])
                        setShowPortfolioDropdown(false)
                      }}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-sm",
                        selectedPortfolioIds.length === 0 && "bg-primary-50 dark:bg-primary-900/20"
                      )}
                    >
                      <div className={clsx(
                        "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                        selectedPortfolioIds.length === 0 ? "bg-primary-500 border-primary-500" : "border-gray-300 dark:border-gray-600"
                      )}>
                        {selectedPortfolioIds.length === 0 && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <span className="text-gray-600 dark:text-gray-400">No specific portfolio</span>
                    </button>

                    <div className="border-t border-gray-100 dark:border-gray-700 my-1" />

                    {/* Portfolio options - multi-select */}
                    {portfolios?.map(p => {
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
                            "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-sm",
                            isSelected && "bg-primary-50 dark:bg-primary-900/20"
                          )}
                        >
                          <div className={clsx(
                            "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                            isSelected ? "bg-primary-500 border-primary-500" : "border-gray-300 dark:border-gray-600"
                          )}>
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className="text-gray-700 dark:text-gray-300 flex-1">{p.name}</span>
                          {holdsAsset && !isPairTrade && (
                            <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
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

            {/* Portfolio Context Summary - show when portfolios and asset selected */}
            {!isPairTrade && selectedPortfolioIds.length > 0 && assetId && selectedPortfolioHoldings && selectedPortfolioHoldings.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedPortfolioHoldings.map(holding => {
                  const portfolio = portfolios?.find(p => p.id === holding.portfolioId)
                  if (!portfolio) return null
                  const isExpanded = expandedPortfolioBadge === holding.portfolioId
                  const benchWeight = 0 // TODO: fetch from benchmark
                  const activeWeight = holding.weight - benchWeight

                  return (
                    <div key={holding.portfolioId} className="relative">
                      <button
                        type="button"
                        onClick={() => setExpandedPortfolioBadge(isExpanded ? null : holding.portfolioId)}
                        className={clsx(
                          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors",
                          isExpanded
                            ? "bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700"
                            : "bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                        )}
                      >
                        <span className="font-medium text-gray-700 dark:text-gray-300">{portfolio.name}</span>
                        {holding.isOwned ? (
                          <span className="text-[9px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-medium">
                            Held
                          </span>
                        ) : (
                          <span className="text-[9px] bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                            Not held
                          </span>
                        )}
                      </button>

                      {/* Expanded positioning popover */}
                      {isExpanded && (
                        <div className="absolute z-30 top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
                          <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                            Current Position
                          </div>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-500 dark:text-gray-400">Weight</span>
                              <span className="font-medium text-gray-800 dark:text-gray-200">
                                {holding.weight > 0 ? `${holding.weight.toFixed(2)}%` : '0.00%'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 dark:text-gray-400">Shares</span>
                              <span className="font-medium text-gray-800 dark:text-gray-200">
                                {holding.shares > 0 ? holding.shares.toLocaleString() : '—'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 dark:text-gray-400">Benchmark</span>
                              <span className="font-medium text-gray-800 dark:text-gray-200">
                                {benchWeight > 0 ? `${benchWeight.toFixed(2)}%` : '—'}
                              </span>
                            </div>
                            <div className="flex justify-between border-t border-gray-100 dark:border-gray-700 pt-1.5 mt-1.5">
                              <span className="text-gray-500 dark:text-gray-400">Active</span>
                              <span className={clsx(
                                "font-semibold",
                                activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                activeWeight < 0 ? "text-red-600 dark:text-red-400" :
                                "text-gray-500"
                              )}>
                                {activeWeight !== 0 ? (activeWeight > 0 ? '+' : '') + activeWeight.toFixed(2) + '%' : '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setShowAdvanced(true)}
                  className="text-[10px] text-primary-600 dark:text-primary-400 hover:underline self-center"
                >
                  Set targets →
                </button>
              </div>
            )}
          </div>

          {/* ====================================== */}
          {/* SIZING & TIMING SECTION (Collapsible) */}
          {/* ====================================== */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              <span>Sizing & Timing <span className="font-normal text-gray-400">(Optional)</span></span>
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {showAdvanced && (
              <div className="space-y-5">
                {/* Section helper text */}
                <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed -mt-1">
                  Optional modeling inputs to estimate portfolio impact if this idea becomes a trade. These do not place orders.
                </p>
                {/* ========== SINGLE TRADE ADVANCED ========== */}
                {!isPairTrade && (
                  <>
                    {/* Position Sizing Table */}
                    {selectedPortfolioIds.length > 0 && assetId && selectedPortfolioHoldings && selectedPortfolioHoldings.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            Position Sizing
                          </label>
                          <div className="flex rounded-md border border-gray-200 dark:border-gray-600 overflow-hidden">
                            {[
                              { value: 'absolute', label: 'Target %', desc: 'Set target weight' },
                              { value: 'relative_current', label: '+/− Current', desc: 'Change from current' },
                              { value: 'relative_benchmark', label: '+/− Bench', desc: 'vs benchmark' },
                            ].map((mode) => (
                              <button
                                key={mode.value}
                                type="button"
                                onClick={() => setSizingMode(mode.value as typeof sizingMode)}
                                className={clsx(
                                  "px-2.5 py-1 text-[10px] font-medium transition-colors border-r last:border-r-0 border-gray-200 dark:border-gray-600",
                                  sizingMode === mode.value
                                    ? "bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300"
                                    : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                                )}
                              >
                                {mode.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">Portfolio</th>
                                  <th className="text-right py-2.5 px-2 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap" title="Current portfolio weight">
                                    <div className="flex flex-col items-end">
                                      <span>Current</span>
                                      <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                    </div>
                                  </th>
                                  <th className="text-right py-2.5 px-2 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap" title="Benchmark weight">
                                    <div className="flex flex-col items-end">
                                      <span>Bench</span>
                                      <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                    </div>
                                  </th>
                                  <th className="text-right py-2.5 px-2 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap" title="Active weight (current - benchmark)">
                                    <div className="flex flex-col items-end">
                                      <span>Active</span>
                                      <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                    </div>
                                  </th>
                                  <th className="text-right py-2.5 px-2 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap" title="Current shares held">
                                    <div className="flex flex-col items-end">
                                      <span>Current</span>
                                      <span className="text-[9px] font-normal text-gray-400">Shares</span>
                                    </div>
                                  </th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap bg-primary-50/50 dark:bg-primary-900/20">
                                    <div className="flex flex-col items-center">
                                      <span>{sizingMode === 'absolute' ? 'Target' : '+/−'}</span>
                                      <span className="text-[9px] font-normal">Weight %</span>
                                    </div>
                                  </th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap bg-primary-50/50 dark:bg-primary-900/20">
                                    <div className="flex flex-col items-center">
                                      <span>Target</span>
                                      <span className="text-[9px] font-normal">Shares</span>
                                    </div>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedPortfolioHoldings.map((holding, idx) => {
                                  const portfolio = portfolios?.find(p => p.id === holding.portfolioId)
                                  if (!portfolio) return null
                                  const target = portfolioTargets[holding.portfolioId]
                                  const benchWeight = 0 // TODO: fetch from benchmark
                                  const activeWeight = holding.weight - benchWeight

                                  return (
                                    <tr
                                      key={holding.portfolioId}
                                      className={clsx(
                                        "border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/30",
                                        idx % 2 === 1 && "bg-gray-25 dark:bg-gray-800/30"
                                      )}
                                    >
                                      <td className="py-2 px-3">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-medium text-gray-800 dark:text-gray-200">{portfolio.name}</span>
                                          {holding.isOwned && (
                                            <span className="text-[8px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded font-medium">
                                              HELD
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="text-right py-2 px-2 tabular-nums">
                                        <span className={clsx(
                                          "font-medium",
                                          holding.weight > 0 ? "text-gray-700 dark:text-gray-300" : "text-gray-400"
                                        )}>
                                          {holding.weight.toFixed(2)}%
                                        </span>
                                      </td>
                                      <td className="text-right py-2 px-2 text-gray-400 dark:text-gray-500 tabular-nums">
                                        {benchWeight > 0 ? `${benchWeight.toFixed(2)}%` : '—'}
                                      </td>
                                      <td className="text-right py-2 px-2 tabular-nums">
                                        <span className={clsx(
                                          "font-medium",
                                          activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                          activeWeight < 0 ? "text-red-600 dark:text-red-400" :
                                          "text-gray-400"
                                        )}>
                                          {activeWeight !== 0 ? (activeWeight > 0 ? '+' : '') + activeWeight.toFixed(2) + '%' : '—'}
                                        </span>
                                      </td>
                                      <td className="text-right py-2 px-2 tabular-nums">
                                        <span className={clsx(
                                          holding.shares > 0 ? "text-gray-700 dark:text-gray-300 font-medium" : "text-gray-400"
                                        )}>
                                          {holding.shares > 0 ? holding.shares.toLocaleString() : '—'}
                                        </span>
                                      </td>
                                      <td className="py-1.5 px-1.5 bg-primary-50/30 dark:bg-primary-900/10">
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          placeholder={sizingMode === 'absolute' ? (holding.weight > 0 ? holding.weight.toFixed(1) : '2.0') : '+0.5'}
                                          value={
                                            activeInput?.portfolioId === holding.portfolioId && activeInput?.field === 'weight'
                                              ? activeInput.rawValue
                                              : getDisplayWeight(holding.portfolioId)
                                          }
                                          onFocus={() => setActiveInput({
                                            portfolioId: holding.portfolioId,
                                            field: 'weight',
                                            rawValue: getDisplayWeight(holding.portfolioId)
                                          })}
                                          onChange={(e) => {
                                            setActiveInput({
                                              portfolioId: holding.portfolioId,
                                              field: 'weight',
                                              rawValue: e.target.value
                                            })
                                            updatePortfolioTarget(holding.portfolioId, 'weight', e.target.value)
                                          }}
                                          onBlur={() => setActiveInput(null)}
                                          className={clsx(
                                            "text-center text-xs h-7 w-full min-w-[60px] rounded-lg border px-2 focus:outline-none focus:ring-1",
                                            target?.sourceField === 'weight'
                                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold focus:border-blue-500 focus:ring-blue-500"
                                              : target?.sourceField === 'shares' && target?.absoluteWeight !== null
                                                ? "border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 italic font-normal"
                                                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium focus:border-primary-500 focus:ring-primary-500"
                                          )}
                                        />
                                      </td>
                                      <td className="py-1.5 px-1.5 bg-primary-50/30 dark:bg-primary-900/10">
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          placeholder={holding.shares > 0 ? Math.round(holding.shares).toString() : '—'}
                                          value={
                                            activeInput?.portfolioId === holding.portfolioId && activeInput?.field === 'shares'
                                              ? activeInput.rawValue
                                              : getDisplayShares(holding.portfolioId)
                                          }
                                          onFocus={() => setActiveInput({
                                            portfolioId: holding.portfolioId,
                                            field: 'shares',
                                            rawValue: getDisplayShares(holding.portfolioId)
                                          })}
                                          onChange={(e) => {
                                            setActiveInput({
                                              portfolioId: holding.portfolioId,
                                              field: 'shares',
                                              rawValue: e.target.value
                                            })
                                            updatePortfolioTarget(holding.portfolioId, 'shares', e.target.value)
                                          }}
                                          onBlur={() => setActiveInput(null)}
                                          className={clsx(
                                            "text-center text-xs h-7 w-full min-w-[70px] rounded-lg border px-2 focus:outline-none focus:ring-1",
                                            target?.sourceField === 'shares'
                                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold focus:border-blue-500 focus:ring-blue-500"
                                              : target?.sourceField === 'weight' && target?.absoluteShares !== null
                                                ? "border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 italic font-normal"
                                                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium focus:border-primary-500 focus:ring-primary-500"
                                          )}
                                        />
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <p className="text-[10px] text-gray-400">
                            {sizingMode === 'absolute' && 'Enter target weight % or shares — the other auto-calculates.'}
                            {sizingMode === 'relative_current' && 'Enter +/− change from current — the other auto-calculates.'}
                            {sizingMode === 'relative_benchmark' && 'Enter +/− vs benchmark — the other auto-calculates.'}
                          </p>
                          <div className="flex items-center gap-3 text-[9px]">
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded bg-blue-100 border border-blue-500"></span>
                              <span className="text-gray-500">Your input</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded bg-gray-100 border border-gray-300"></span>
                              <span className="text-gray-400 italic">Calculated</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Reference Levels (de-emphasized) */}
                    <div className="rounded-lg border border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 p-3">
                      <div className="flex items-baseline gap-2 mb-2">
                        <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                          Reference Levels
                        </label>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500">
                          — not orders
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-1">Entry Price</label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="150.00"
                            value={targetPrice}
                            onChange={(e) => setTargetPrice(e.target.value)}
                            className="text-xs bg-white dark:bg-gray-800"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-1">Stop Loss</label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="140.00"
                            value={stopLoss}
                            onChange={(e) => setStopLoss(e.target.value)}
                            className="text-xs bg-white dark:bg-gray-800"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-1">Take Profit</label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="180.00"
                            value={takeProfit}
                            onChange={(e) => setTakeProfit(e.target.value)}
                            className="text-xs bg-white dark:bg-gray-800"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Conviction & Time Horizon */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="mb-2">
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            Conviction
                          </label>
                          <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">
                            Confidence in the thesis (separate from urgency/priority)
                          </p>
                        </div>
                        <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                          {(['low', 'medium', 'high'] as const).map((level) => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => setConviction(level)}
                              className={clsx(
                                "flex-1 px-2 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0 border-gray-200 dark:border-gray-600 capitalize",
                                conviction === level
                                  ? level === 'high'
                                    ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                                    : level === 'medium'
                                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                                  : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                              )}
                            >
                              {level}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="mb-2">
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            Time Horizon
                          </label>
                          <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">
                            Expected holding period
                          </p>
                        </div>
                        <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                          {([
                            { value: 'short', label: 'Short' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'long', label: 'Long' },
                          ] as const).map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setTimeHorizon(option.value)}
                              className={clsx(
                                "flex-1 px-2 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0 border-gray-200 dark:border-gray-600",
                                timeHorizon === option.value
                                  ? "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                                  : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                              )}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* ========== PAIR TRADE ADVANCED ========== */}
                {isPairTrade && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Pairs Trade Name
                    </label>
                    <Input
                      placeholder={autoGeneratePairTradeName || "Enter pairs trade name..."}
                      value={pairTradeName}
                      onChange={(e) => setPairTradeName(e.target.value)}
                    />
                    {autoGeneratePairTradeName && !pairTradeName && (
                      <p className="text-xs text-gray-400 mt-1">
                        Will use: {autoGeneratePairTradeName}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          </div>

          {/* Footer - sticky at bottom */}
          <div className="flex-shrink-0 flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
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
                (isPairTrade ? legs.filter(l => l.assetId).length < 2 : (!assetId || !action)) ||
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

