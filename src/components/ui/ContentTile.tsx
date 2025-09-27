import React from 'react'
import { Calendar, BarChart3, Activity, TrendingUp, FileText, DollarSign, Users, Clock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Card } from './Card'
import { Badge } from './Badge'

interface ContentTileProps {
  tile: {
    id: string
    tile_type: string
    title: string
    description?: string
    configuration: any
    sort_order: number
    is_enabled: boolean
  }
  assetId?: string
  assetSymbol?: string
  className?: string
  isPreview?: boolean
}

interface PortfolioHolding {
  portfolio_id: string
  portfolio_name: string
  shares: number
  price: number
  cost: number
  weight: number
  last_updated: string
}

interface TradingActivity {
  portfolio_id: string
  portfolio_name: string
  total_trades: number
  shares_traded: number
  weight_change: number
  last_trade_date: string
  last_trade_type: string
  last_trade_price: number
}

export function ContentTile({ tile, assetId, assetSymbol, className = '', isPreview = false }: ContentTileProps) {
  if (!tile.is_enabled) return null

  const renderTileContent = () => {
    switch (tile.tile_type) {
      case 'last_review':
        return <LastReviewTile assetId={assetId} configuration={tile.configuration} isPreview={isPreview} />

      case 'portfolio_holdings':
        return <PortfolioHoldingsTile assetId={assetId} configuration={tile.configuration} isPreview={isPreview} />

      case 'trading_activity':
        return <TradingActivityTile assetId={assetId} configuration={tile.configuration} isPreview={isPreview} />

      case 'action_items':
        return <ActionItemsTile configuration={tile.configuration} isPreview={isPreview} />

      case 'custom_text':
        return <CustomTextTile configuration={tile.configuration} isPreview={isPreview} />

      case 'financial_metrics':
        return <FinancialMetricsTile assetSymbol={assetSymbol} configuration={tile.configuration} isPreview={isPreview} />

      case 'outdated_stage_view':
        return (
          <div className="text-sm text-gray-600">
            <p className="font-medium mb-2">Outdated Stage Analysis</p>
            <p>Use specific tile types (Portfolio Holdings, Trading Activity, etc.) for targeted data views.</p>
          </div>
        )

      default:
        return <div className="p-4 text-gray-500">Unknown tile type: {tile.tile_type}</div>
    }
  }


  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-center space-x-2 mb-3">
        {getTileIcon(tile.tile_type)}
        <h4 className="font-semibold text-gray-900">{tile.title}</h4>
      </div>
      {tile.description && (
        <p className="text-sm text-gray-600 mb-3">{tile.description}</p>
      )}
      {renderTileContent()}
    </Card>
  )
}

function getTileIcon(tileType: string) {
  switch (tileType) {
    case 'last_review':
      return <Calendar className="w-5 h-5 text-gray-600" />
    case 'portfolio_holdings':
      return <BarChart3 className="w-5 h-5 text-gray-600" />
    case 'trading_activity':
      return <Activity className="w-5 h-5 text-gray-600" />
    case 'action_items':
      return <TrendingUp className="w-5 h-5 text-blue-600" />
    case 'custom_text':
      return <FileText className="w-5 h-5 text-gray-600" />
    case 'financial_metrics':
      return <DollarSign className="w-5 h-5 text-green-600" />
    default:
      return <FileText className="w-5 h-5 text-gray-600" />
  }
}

// Individual tile components
function LastReviewTile({ assetId, configuration, isPreview }: { assetId?: string; configuration: any; isPreview?: boolean }) {
  // Query for last research review
  const { data: lastReview } = useQuery({
    queryKey: ['asset-last-review', assetId],
    queryFn: async () => {
      if (!assetId) return null

      const { data, error } = await supabase
        .from('asset_field_history')
        .select('*')
        .eq('asset_id', assetId)
        .order('changed_at', { ascending: false })
        .limit(1)

      if (error) throw error
      return data?.[0] || null
    },
    enabled: !!assetId && !isPreview
  })

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  if (isPreview) {
    return (
      <div className="text-sm text-gray-600">
        <p>Last updated: <span className="font-medium text-green-600">2 days ago</span></p>
        <p className="text-xs text-gray-500 mt-1">Research review completed by John Smith</p>
        <div className="mt-2">
          <Badge variant="outline" size="sm">✓ Up to date</Badge>
        </div>
      </div>
    )
  }

  if (lastReview) {
    return (
      <div className="text-sm text-gray-600">
        <p>Last updated: <span className="font-medium">{formatDate(lastReview.changed_at)}</span></p>
        <p>Field: <span className="font-medium">{lastReview.field_name}</span></p>
        {lastReview.old_value && lastReview.new_value && (
          <p className="text-xs text-gray-500 mt-1">Changed from "{lastReview.old_value}" to "{lastReview.new_value}"</p>
        )}
      </div>
    )
  }

  return (
    <div className="text-sm text-gray-500">No research history found</div>
  )
}

function PortfolioHoldingsTile({ assetId, configuration, isPreview }: { assetId?: string; configuration: any; isPreview?: boolean }) {
  // Query for portfolio holdings
  const { data: holdings, isLoading: holdingsLoading } = useQuery({
    queryKey: ['asset-portfolio-holdings', assetId],
    queryFn: async () => {
      if (!assetId) return []

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
      const processedHoldings = data?.map(holding => ({
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
    },
    enabled: !!assetId && !isPreview
  })

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  if (isPreview) {
    return (
      <div className="text-sm">
        <div className="space-y-2">
          <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
            <span className="font-medium">Growth Portfolio</span>
            <span className="text-green-600">+2.4%</span>
          </div>
          <div className="flex justify-between text-xs text-gray-600">
            <span>250 shares @ $45.20</span>
            <span>$11,300 (8.5%)</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
            <span className="font-medium">Tech Fund</span>
            <span className="text-red-600">-1.2%</span>
          </div>
          <div className="flex justify-between text-xs text-gray-600">
            <span>150 shares @ $32.80</span>
            <span>$4,920 (3.7%)</span>
          </div>
        </div>
      </div>
    )
  }

  if (holdingsLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
      </div>
    )
  }

  if (holdings && holdings.length > 0) {
    return (
      <div className="space-y-3">
        {holdings.map((holding, index) => (
          <div key={`${holding.portfolio_id}-${index}`} className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-900">{holding.portfolio_name}</span>
              <Badge variant="secondary" size="sm">
                {holding.shares.toLocaleString()} shares
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Market Value</span>
                <p className="font-medium">{formatCurrency(holding.shares * holding.price)}</p>
              </div>
              <div>
                <span className="text-gray-500">Avg Cost</span>
                <p className="font-medium">{formatCurrency(holding.cost / holding.shares || 0)}</p>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Last updated: {formatDate(holding.last_updated)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="text-sm text-gray-500">No portfolio holdings found</div>
  )
}

function TradingActivityTile({ assetId, configuration, isPreview }: { assetId?: string; configuration: any; isPreview?: boolean }) {
  // Query for portfolio trading data
  const { data: portfolioTrades, isLoading: tradesLoading } = useQuery({
    queryKey: ['asset-portfolio-trades', assetId],
    queryFn: async () => {
      if (!assetId) return []

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
      const tradesByPortfolio: Record<string, any> = {}

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
    },
    enabled: !!assetId && !isPreview
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

  if (isPreview) {
    return (
      <div className="text-sm">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-green-600 font-medium">+50 shares</span>
            <span className="text-xs text-gray-500">2 days ago</span>
          </div>
          <div className="text-xs text-gray-600">Growth Portfolio • $42.15</div>
          <div className="flex justify-between items-center">
            <span className="text-red-600 font-medium">-25 shares</span>
            <span className="text-xs text-gray-500">1 week ago</span>
          </div>
          <div className="text-xs text-gray-600">Tech Fund • $34.80</div>
          <div className="pt-2 border-t">
            <div className="flex justify-between text-xs">
              <span>Total trades this month:</span>
              <span className="font-medium">8</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (tradesLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
      </div>
    )
  }

  if (portfolioTrades && portfolioTrades.length > 0) {
    return (
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
            <div className="grid grid-cols-2 gap-3 text-sm">
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
    )
  }

  return (
    <div className="text-sm text-gray-500">No trading activity recorded</div>
  )
}

function ActionItemsTile({ configuration, isPreview }: { configuration: any; isPreview?: boolean }) {
  const defaultItems = [
    'Review current analysis and assumptions',
    'Check for recent news and developments',
    'Assess position sizing and risk parameters',
    'Consider market conditions and timing'
  ]

  const previewItems = [
    'Review quarterly earnings report',
    'Analyze competitor performance',
    'Update price targets and projections',
    'Check regulatory filings'
  ]

  const items = isPreview ? previewItems : (configuration.items || defaultItems)

  return (
    <div className="space-y-1">
      {items.map((item: string, index: number) => (
        <div key={index} className="flex items-start space-x-2 text-sm">
          <span className="text-blue-600 mt-0.5">•</span>
          <span className="text-blue-800">{item}</span>
        </div>
      ))}
    </div>
  )
}

function CustomTextTile({ configuration, isPreview }: { configuration: any; isPreview?: boolean }) {
  const previewContent = `Key Research Notes:

• Company shows strong fundamentals with consistent revenue growth
• Management team has solid track record of execution
• Market position is competitive with defendable moat
• Consider entry points around $40-45 support level`

  const content = isPreview ? previewContent : (configuration.content || 'Add your custom content here')

  return (
    <div className="text-sm text-gray-700 whitespace-pre-wrap">
      {content}
    </div>
  )
}

function FinancialMetricsTile({ assetSymbol, configuration, isPreview }: { assetSymbol?: string; configuration: any; isPreview?: boolean }) {
  if (isPreview) {
    return (
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-500">P/E Ratio</span>
          <p className="font-medium text-blue-600">18.4</p>
        </div>
        <div>
          <span className="text-gray-500">Revenue Growth</span>
          <p className="font-medium text-green-600">+12.3%</p>
        </div>
        <div>
          <span className="text-gray-500">Profit Margin</span>
          <p className="font-medium text-green-600">22.1%</p>
        </div>
        <div>
          <span className="text-gray-500">ROE</span>
          <p className="font-medium text-blue-600">15.7%</p>
        </div>
        <div>
          <span className="text-gray-500">Debt/Equity</span>
          <p className="font-medium">0.42</p>
        </div>
        <div>
          <span className="text-gray-500">Price/Book</span>
          <p className="font-medium">2.8</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <span className="text-gray-500">P/E Ratio</span>
        <p className="font-medium">--</p>
      </div>
      <div>
        <span className="text-gray-500">Revenue Growth</span>
        <p className="font-medium">--</p>
      </div>
      <div>
        <span className="text-gray-500">Profit Margin</span>
        <p className="font-medium">--</p>
      </div>
      <div>
        <span className="text-gray-500">ROE</span>
        <p className="font-medium">--</p>
      </div>
      <p className="col-span-2 text-xs text-gray-500 mt-2">
        Financial metrics will be populated from connected data sources
      </p>
    </div>
  )
}