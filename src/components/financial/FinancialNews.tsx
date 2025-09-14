import React, { useState, useEffect } from 'react'
import { financialDataService, type NewsItem } from '../../lib/financial-data/browser-client'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { ExternalLink, Calendar } from 'lucide-react'

interface FinancialNewsProps {
  symbols?: string[]
  limit?: number
  className?: string
}

export function FinancialNews({ symbols, limit = 5, className = '' }: FinancialNewsProps) {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchNews = async () => {
      setLoading(true)
      setError(null)

      try {
        const newsData = await financialDataService.getNews(symbols, limit)
        setNews(newsData)
      } catch (err) {
        setError('Financial news temporarily unavailable')
        console.warn('Financial news fetch failed (non-blocking):', err)
      } finally {
        setLoading(false)
      }
    }

    // Add a small delay to prevent immediate API calls on page load
    const timeoutId = setTimeout(fetchNews, 1500)
    return () => clearTimeout(timeoutId)
  }, [symbols?.join(','), limit])

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[...Array(3)].map((_, i) => (
          <Card key={i} padding="sm" className="animate-pulse">
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-3 bg-gray-200 rounded w-full"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className={`text-red-500 text-sm ${className}`}>
        {error}
      </div>
    )
  }

  if (!news || news.length === 0) {
    return (
      <div className={`text-gray-500 text-sm text-center py-8 ${className}`}>
        No financial news available
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {news.map((item) => (
        <Card key={item.id} padding="sm" className="hover:shadow-md transition-shadow">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <h4 className="font-medium text-gray-900 text-sm leading-5 flex-1">
                {item.headline}
              </h4>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>

            {item.summary && (
              <p className="text-xs text-gray-600 line-clamp-2">
                {item.summary}
              </p>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Badge variant="default" size="sm" className="text-xs">
                  {item.source}
                </Badge>
                {item.symbols && item.symbols.length > 0 && (
                  <div className="flex space-x-1">
                    {item.symbols.slice(0, 3).map((symbol) => (
                      <Badge key={symbol} variant="primary" size="sm" className="text-xs">
                        {symbol}
                      </Badge>
                    ))}
                    {item.symbols.length > 3 && (
                      <Badge variant="primary" size="sm" className="text-xs">
                        +{item.symbols.length - 3}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center text-xs text-gray-400">
                <Calendar className="h-3 w-3 mr-1" />
                {new Date(item.publishedAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}