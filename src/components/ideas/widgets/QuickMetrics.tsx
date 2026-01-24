import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Activity, DollarSign, BarChart2 } from 'lucide-react'
import { financialDataService } from '../../../lib/financial-data/browser-client'

interface QuickMetricsProps {
  symbol: string
  layout?: 'row' | 'grid'
  showPE?: boolean
  showVolume?: boolean
  showMarketCap?: boolean
  showChange?: boolean
  className?: string
}

export function QuickMetrics({
  symbol,
  layout = 'row',
  showPE = true,
  showVolume = true,
  showMarketCap = true,
  showChange = true,
  className
}: QuickMetricsProps) {
  const { data: quote, isLoading } = useQuery({
    queryKey: ['quick-metrics', symbol],
    queryFn: async () => {
      try {
        const quote = await financialDataService.getQuote(symbol)
        return quote
      } catch {
        return null
      }
    },
    staleTime: 60000,
    refetchOnWindowFocus: false
  })

  if (isLoading) {
    return (
      <div className={clsx(
        'flex gap-2',
        layout === 'grid' ? 'flex-wrap' : '',
        className
      )}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="h-6 w-16 bg-gray-100 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (!quote) {
    return null
  }

  const metrics = []

  if (showChange) {
    const isPositive = quote.change >= 0
    metrics.push({
      icon: isPositive ? TrendingUp : TrendingDown,
      label: 'Change',
      value: `${isPositive ? '+' : ''}${quote.changePercent.toFixed(2)}%`,
      color: isPositive ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'
    })
  }

  if (showVolume && quote.volume) {
    metrics.push({
      icon: Activity,
      label: 'Vol',
      value: formatNumber(quote.volume),
      color: 'text-blue-600 bg-blue-50'
    })
  }

  if (showMarketCap && quote.marketCap) {
    metrics.push({
      icon: DollarSign,
      label: 'MCap',
      value: formatNumber(quote.marketCap),
      color: 'text-purple-600 bg-purple-50'
    })
  }

  if (showPE && quote.pe) {
    metrics.push({
      icon: BarChart2,
      label: 'P/E',
      value: quote.pe.toFixed(1),
      color: 'text-amber-600 bg-amber-50'
    })
  }

  return (
    <div className={clsx(
      'flex gap-2',
      layout === 'grid' ? 'flex-wrap' : 'overflow-x-auto',
      className
    )}>
      {metrics.map((metric, index) => (
        <MetricBadge key={index} {...metric} />
      ))}
    </div>
  )
}

interface MetricBadgeProps {
  icon: typeof TrendingUp
  label: string
  value: string
  color: string
}

function MetricBadge({ icon: Icon, label, value, color }: MetricBadgeProps) {
  return (
    <div className={clsx(
      'flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap',
      color
    )}>
      <Icon className="h-3 w-3" />
      <span>{label}:</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function formatNumber(num: number): string {
  if (num >= 1e12) {
    return (num / 1e12).toFixed(1) + 'T'
  }
  if (num >= 1e9) {
    return (num / 1e9).toFixed(1) + 'B'
  }
  if (num >= 1e6) {
    return (num / 1e6).toFixed(1) + 'M'
  }
  if (num >= 1e3) {
    return (num / 1e3).toFixed(1) + 'K'
  }
  return num.toFixed(0)
}

export default QuickMetrics
