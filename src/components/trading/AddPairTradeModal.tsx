import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Search, TrendingUp, TrendingDown, Plus, Trash2, Link2, ArrowRightLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import type { TradeAction, TradeUrgency, PairLegType, PairTradeLegInput } from '../../types/trading'
import { clsx } from 'clsx'

interface AddPairTradeModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  preselectedPortfolioId?: string
}

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

export function AddPairTradeModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedPortfolioId
}: AddPairTradeModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Form state
  const [portfolioId, setPortfolioId] = useState(preselectedPortfolioId || '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rationale, setRationale] = useState('')
  const [thesisSummary, setThesisSummary] = useState('')
  const [urgency, setUrgency] = useState<TradeUrgency>('medium')

  // Legs state - start with one long and one short leg
  const [legs, setLegs] = useState<LegFormState[]>([
    createEmptyLeg('long'),
    createEmptyLeg('short'),
  ])

  // Track which leg is being searched
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

  // Search assets based on active search
  const { data: searchResults } = useQuery({
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
    enabled: isOpen && globalAssetSearch.length >= 1,
  })

  // Create pair trade mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      // First create the pair trade
      const { data: pairTrade, error: pairError } = await supabase
        .from('pair_trades')
        .insert({
          portfolio_id: portfolioId,
          name,
          description,
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
          rationale: '', // Individual legs don't need rationale - it's on the pair
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

  const resetForm = () => {
    setPortfolioId(preselectedPortfolioId || '')
    setName('')
    setDescription('')
    setRationale('')
    setThesisSummary('')
    setUrgency('medium')
    setLegs([createEmptyLeg('long'), createEmptyLeg('short')])
    setActiveSearchLegId(null)
    setGlobalAssetSearch('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validate at least 2 legs with assets selected
    const validLegs = legs.filter(leg => leg.assetId)
    if (validLegs.length < 2) {
      alert('Please select at least 2 assets for the pairs trade')
      return
    }

    if (!portfolioId || !name) return

    createMutation.mutate()
  }

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

  // Auto-generate name from selected assets
  const autoGenerateName = useMemo(() => {
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

  // Suggest name if empty
  const suggestedName = name || autoGenerateName

  if (!isOpen) return null

  const longLegs = legs.filter(l => l.legType === 'long')
  const shortLegs = legs.filter(l => l.legType === 'short')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Add Pairs Trade
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

          {/* Pairs Trade Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Pairs Trade Name *
            </label>
            <Input
              placeholder={autoGenerateName || ""}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            {autoGenerateName && !name && (
              <p className="text-xs text-gray-500 mt-1">
                Suggested: {autoGenerateName}
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
                    searchResults={activeSearchLegId === leg.id ? searchResults : []}
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
                    searchResults={activeSearchLegId === leg.id ? searchResults : []}
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

          {/* Urgency */}
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
              placeholder="Brief summary of the pairs trade thesis..."
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
              placeholder="Why are you proposing this pairs trade? What's the spread opportunity?"
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
              disabled={!portfolioId || !suggestedName || legs.filter(l => l.assetId).length < 2 || createMutation.isPending}
              loading={createMutation.isPending}
            >
              <Link2 className="h-4 w-4 mr-2" />
              Create Pairs Trade
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Individual Leg Form Component
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
