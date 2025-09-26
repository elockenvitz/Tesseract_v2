import React from 'react'
import { Calendar, BarChart3, Activity, TrendingUp, FileText, DollarSign, Users, Clock } from 'lucide-react'
import { Card } from './Card'
import { Badge } from './Badge'
import { OutdatedStageView } from './OutdatedStageView'

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
        return isPreview ? (
          <div className="text-sm text-gray-600">
            <p className="font-medium mb-2">Complete Outdated Stage View</p>
            <p>Shows full outdated workflow stage with all sections including portfolio holdings, trading activity, and analysis notes.</p>
          </div>
        ) : assetId && assetSymbol ? (
          <OutdatedStageView assetId={assetId} assetSymbol={assetSymbol} />
        ) : null

      default:
        return <div className="p-4 text-gray-500">Unknown tile type: {tile.tile_type}</div>
    }
  }

  // If it's the special outdated_stage_view, render it without wrapping Card
  if (tile.tile_type === 'outdated_stage_view') {
    return <div className={className}>{renderTileContent()}</div>
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

  // This would use the same logic as in OutdatedStageView
  return (
    <div className="text-sm text-gray-600">
      <p>Last updated: <span className="font-medium">No data available</span></p>
      <p className="text-xs text-gray-500 mt-1">Connect your research tracking to see updates</p>
    </div>
  )
}

function PortfolioHoldingsTile({ assetId, configuration, isPreview }: { assetId?: string; configuration: any; isPreview?: boolean }) {
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

  return (
    <div className="text-sm text-gray-600">
      <p>Portfolio holdings data will be displayed here</p>
      <p className="text-xs text-gray-500 mt-1">Configure your portfolio connections in settings</p>
    </div>
  )
}

function TradingActivityTile({ assetId, configuration, isPreview }: { assetId?: string; configuration: any; isPreview?: boolean }) {
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

  return (
    <div className="text-sm text-gray-600">
      <p>Trading activity data will be displayed here</p>
      <p className="text-xs text-gray-500 mt-1">Connect your trading platforms to see activity</p>
    </div>
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