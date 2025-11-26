import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { X, Beaker, TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import type { TradeQueueItemWithDetails, BaselineHolding } from '../../types/trading'
import { clsx } from 'clsx'

interface CreateSimulationModalProps {
  isOpen: boolean
  onClose: () => void
  selectedTradeIds: string[]
  onSuccess: () => void
}

export function CreateSimulationModal({
  isOpen,
  onClose,
  selectedTradeIds,
  onSuccess
}: CreateSimulationModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [portfolioId, setPortfolioId] = useState('')

  // Fetch selected trades
  const { data: selectedTrades } = useQuery({
    queryKey: ['trade-queue-items-selected', selectedTradeIds],
    queryFn: async () => {
      if (selectedTradeIds.length === 0) return []

      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id)
        `)
        .in('id', selectedTradeIds)

      if (error) throw error
      return data as TradeQueueItemWithDetails[]
    },
    enabled: isOpen && selectedTradeIds.length > 0,
  })

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

  // Auto-select portfolio based on selected trades
  useEffect(() => {
    if (selectedTrades && selectedTrades.length > 0) {
      const firstPortfolio = selectedTrades[0].portfolio_id
      const allSamePortfolio = selectedTrades.every(t => t.portfolio_id === firstPortfolio)
      if (allSamePortfolio) {
        setPortfolioId(firstPortfolio)
      }
    }
  }, [selectedTrades])

  // Fetch portfolio holdings for baseline
  const { data: holdings } = useQuery({
    queryKey: ['portfolio-holdings', portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          *,
          assets (id, symbol, company_name, sector)
        `)
        .eq('portfolio_id', portfolioId)

      if (error) throw error
      return data
    },
    enabled: isOpen && !!portfolioId,
  })

  // Create simulation mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      // Calculate baseline holdings
      const baselineHoldings: BaselineHolding[] = (holdings || []).map(h => {
        const value = (h.shares || 0) * (h.price || 0)
        return {
          asset_id: h.asset_id,
          symbol: h.assets?.symbol || '',
          company_name: h.assets?.company_name || '',
          sector: h.assets?.sector || null,
          shares: h.shares || 0,
          price: h.price || 0,
          value,
          weight: 0, // Will be calculated after we have total
        }
      })

      const totalValue = baselineHoldings.reduce((sum, h) => sum + h.value, 0)
      baselineHoldings.forEach(h => {
        h.weight = totalValue > 0 ? (h.value / totalValue) * 100 : 0
      })

      // Create simulation
      const { data: simulation, error: simError } = await supabase
        .from('simulations')
        .insert({
          portfolio_id: portfolioId,
          name,
          description,
          baseline_holdings: baselineHoldings,
          baseline_total_value: totalValue,
          created_by: user?.id,
        })
        .select()
        .single()

      if (simError) throw simError

      // Add selected trades to simulation
      if (selectedTrades && selectedTrades.length > 0) {
        const simulationTrades = selectedTrades.map((trade, index) => ({
          simulation_id: simulation.id,
          trade_queue_item_id: trade.id,
          asset_id: trade.asset_id,
          action: trade.action,
          shares: trade.proposed_shares,
          weight: trade.proposed_weight,
          price: trade.target_price,
          sort_order: index,
        }))

        const { error: tradesError } = await supabase
          .from('simulation_trades')
          .insert(simulationTrades)

        if (tradesError) throw tradesError
      }

      return simulation
    },
    onSuccess: (simulation) => {
      queryClient.invalidateQueries({ queryKey: ['simulations'] })
      setName('')
      setDescription('')
      setPortfolioId('')
      onSuccess()
      // Navigate to simulation page
      window.dispatchEvent(new CustomEvent('navigate-to-simulation', { detail: { simulationId: simulation.id } }))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!portfolioId || !name) return
    createMutation.mutate()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Beaker className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Create Simulation
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
          {/* Selected Trades Preview */}
          {selectedTrades && selectedTrades.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Trades to Include ({selectedTrades.length})
              </label>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700 max-h-40 overflow-y-auto">
                {selectedTrades.map(trade => (
                  <div key={trade.id} className="flex items-center justify-between p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={clsx(
                        "flex items-center gap-1",
                        trade.action === 'buy' || trade.action === 'add'
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      )}>
                        {trade.action === 'buy' || trade.action === 'add' ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        <span className="uppercase text-xs">{trade.action}</span>
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {trade.assets?.symbol}
                      </span>
                    </div>
                    <span className="text-gray-500 dark:text-gray-400">
                      {trade.proposed_weight ? `${trade.proposed_weight}%` : trade.proposed_shares ? `${trade.proposed_shares} sh` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Simulation Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Simulation Name *
            </label>
            <Input
              placeholder="e.g., Tech Rebalance Q4"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
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

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description (optional)
            </label>
            <TextArea
              placeholder="Describe the purpose of this simulation..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Portfolio Summary */}
          {holdings && holdings.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Current Portfolio
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {holdings.length}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">Positions</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    ${holdings.reduce((sum, h) => sum + (h.shares || 0) * (h.price || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">Total Value</div>
                </div>
              </div>
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
              disabled={!portfolioId || !name || createMutation.isPending}
              loading={createMutation.isPending}
            >
              <Beaker className="h-4 w-4 mr-2" />
              Create Simulation
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
