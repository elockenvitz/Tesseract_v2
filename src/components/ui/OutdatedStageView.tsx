import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calendar, TrendingUp, BarChart3, Activity } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Card } from './Card'
import { Badge } from './Badge'

interface OutdatedStageViewProps {
  assetId: string
  assetSymbol: string
}

interface PortfolioHolding {
  portfolio_id: string
  portfolio_name: string
  shares: number
  price: number
  cost: number
  weight: number
  benchmark_weight?: number
  active_weight?: number
  last_updated: string
}

interface PortfolioTrade {
  portfolio_id: string
  portfolio_name: string
  total_trades: number
  shares_traded: number
  weight_change: number
  last_trade_date: string
  last_trade_type: string
  last_trade_price: number
}

export function OutdatedStageView({ assetId, assetSymbol }: OutdatedStageViewProps) {
  // Query for portfolio holdings
  const { data: holdings, isLoading: holdingsLoading } = useQuery({
    queryKey: ['asset-portfolio-holdings', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          *,
          portfolios:portfolio_id (
            name
          )
        `)
        .eq('asset_id', assetId)
        .order('date', { ascending: false })

      if (error) throw error

      // Process data to calculate weights and active weights
      const processedHoldings: PortfolioHolding[] = data?.map(holding => ({
        portfolio_id: holding.portfolio_id,
        portfolio_name: holding.portfolios?.name || 'Unknown Portfolio',
        shares: Number(holding.shares || 0),
        price: Number(holding.price || 0),
        cost: Number(holding.cost || 0),
        weight: 0, // Would need total portfolio value to calculate
        benchmark_weight: 0, // Would need benchmark data
        active_weight: 0, // Calculated as weight - benchmark_weight
        last_updated: holding.updated_at
      })) || []

      return processedHoldings
    }
  })

  // Query for last research review
  const { data: lastReview } = useQuery({
    queryKey: ['asset-last-review', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_field_history')
        .select('*')
        .eq('asset_id', assetId)
        .order('changed_at', { ascending: false })
        .limit(1)

      if (error) throw error
      return data?.[0] || null
    }
  })

  // Query for portfolio trading data
  const { data: portfolioTrades, isLoading: tradesLoading } = useQuery({
    queryKey: ['asset-portfolio-trades', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_trades')
        .select(`
          *,
          portfolios:portfolio_id (
            name
          )
        `)
        .eq('asset_id', assetId)
        .order('trade_date', { ascending: false })

      if (error) throw error

      // Group trades by portfolio and calculate summary stats
      const tradesByPortfolio: Record<string, PortfolioTrade> = {}

      data?.forEach(trade => {
        const portfolioId = trade.portfolio_id
        const portfolioName = trade.portfolios?.name || 'Unknown Portfolio'

        if (!tradesByPortfolio[portfolioId]) {
          tradesByPortfolio[portfolioId] = {
            portfolio_id: portfolioId,
            portfolio_name: portfolioName,
            total_trades: 0,
            shares_traded: 0,
            weight_change: 0,
            last_trade_date: trade.trade_date,
            last_trade_type: trade.trade_type,
            last_trade_price: Number(trade.price)
          }
        }

        const summary = tradesByPortfolio[portfolioId]
        summary.total_trades += 1
        summary.shares_traded += Number(trade.shares)
        summary.weight_change += Number(trade.weight_change || 0)

        // Update if this is a more recent trade
        if (trade.trade_date > summary.last_trade_date) {
          summary.last_trade_date = trade.trade_date
          summary.last_trade_type = trade.trade_type
          summary.last_trade_price = Number(trade.price)
        }
      })

      return Object.values(tradesByPortfolio)
    }
  })

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(2)}%`
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  return (
    <div className="space-y-6">
      {/* Last Review Section */}
      <Card className="p-4">
        <div className="flex items-center space-x-2 mb-3">
          <Calendar className="w-5 h-5 text-gray-600" />
          <h4 className="font-semibold text-gray-900">Last Research Review</h4>
        </div>
        {lastReview ? (
          <div className="text-sm text-gray-600">
            <p>Last updated: <span className="font-medium">{formatDate(lastReview.changed_at)}</span></p>
            <p>Field: <span className="font-medium">{lastReview.field_name}</span></p>
            {lastReview.old_value && lastReview.new_value && (
              <p>Changed from "{lastReview.old_value}" to "{lastReview.new_value}"</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No research history found</p>
        )}
      </Card>

      {/* Portfolio Holdings Section */}
      <Card className="p-4">
        <div className="flex items-center space-x-2 mb-3">
          <BarChart3 className="w-5 h-5 text-gray-600" />
          <h4 className="font-semibold text-gray-900">Portfolio Holdings</h4>
        </div>
        {holdingsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-600"></div>
          </div>
        ) : holdings && holdings.length > 0 ? (
          <div className="space-y-3">
            {holdings.map((holding, index) => (
              <div key={`${holding.portfolio_id}-${index}`} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{holding.portfolio_name}</span>
                  <Badge variant="secondary" size="sm">
                    {holding.shares.toLocaleString()} shares
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Market Value</span>
                    <p className="font-medium">{formatCurrency(holding.shares * holding.price)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Avg Cost</span>
                    <p className="font-medium">{formatCurrency(holding.cost / holding.shares || 0)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Portfolio Weight</span>
                    <p className="font-medium text-blue-600">{formatPercentage(holding.weight)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Active Weight</span>
                    <p className={`font-medium ${holding.active_weight > 0 ? 'text-green-600' : holding.active_weight < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                      {holding.active_weight > 0 ? '+' : ''}{formatPercentage(holding.active_weight)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Last updated: {formatDate(holding.last_updated)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No portfolio holdings found</p>
        )}
      </Card>

      {/* Portfolio Trading Activity */}
      <Card className="p-4">
        <div className="flex items-center space-x-2 mb-3">
          <Activity className="w-5 h-5 text-gray-600" />
          <h4 className="font-semibold text-gray-900">Portfolio Trading Activity</h4>
        </div>
        {tradesLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-600"></div>
          </div>
        ) : portfolioTrades && portfolioTrades.length > 0 ? (
          <div className="space-y-3">
            {portfolioTrades.map((trade) => (
              <div key={trade.portfolio_id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{trade.portfolio_name}</span>
                  <div className="flex items-center space-x-2">
                    <Badge
                      variant={trade.last_trade_type === 'buy' ? 'success' : 'warning'}
                      size="sm"
                    >
                      Last: {trade.last_trade_type.toUpperCase()}
                    </Badge>
                    <span className="text-xs text-gray-500">{formatDate(trade.last_trade_date)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Total Trades</span>
                    <p className="font-medium">{trade.total_trades}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Shares Traded</span>
                    <p className="font-medium">{trade.shares_traded.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Weight Change</span>
                    <p className={`font-medium ${
                      trade.weight_change > 0 ? 'text-green-600' :
                      trade.weight_change < 0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {trade.weight_change > 0 ? '+' : ''}{formatPercentage(trade.weight_change)}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Last Price</span>
                    <p className="font-medium">{formatCurrency(trade.last_trade_price)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No trading activity recorded</p>
        )}
      </Card>

      {/* Action Items */}
      <Card className="p-4 bg-blue-50 border-blue-200">
        <div className="flex items-center space-x-2 mb-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <h4 className="font-semibold text-blue-900">Next Steps</h4>
        </div>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Review current portfolio allocations and weights</li>
          <li>• Assess if position sizes align with conviction levels</li>
          <li>• Consider recent market developments and company news</li>
          <li>• Determine if research refresh is needed before next action</li>
        </ul>
      </Card>
    </div>
  )
}