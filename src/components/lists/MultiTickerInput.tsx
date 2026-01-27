import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Loader2, Check, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'

interface MultiTickerInputProps {
  listId: string
  existingAssetIds: string[]
  onComplete?: () => void
}

interface ParsedTicker {
  symbol: string
  status: 'pending' | 'valid' | 'invalid' | 'duplicate'
  assetId?: string
  companyName?: string
}

// Parse raw input into uppercase ticker symbols
const parseTickers = (input: string): string[] => {
  return input
    .toUpperCase()
    .split(/[,\s;]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0 && /^[A-Z0-9.]+$/.test(t))
}

export function MultiTickerInput({ listId, existingAssetIds, onComplete }: MultiTickerInputProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [parsedTickers, setParsedTickers] = useState<ParsedTicker[]>([])
  const [isValidating, setIsValidating] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (!showResults) {
          handleClose()
        }
      }
    }
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExpanded, showResults])

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isExpanded])

  // Validate tickers against database
  const validateTickers = async (symbols: string[]): Promise<ParsedTicker[]> => {
    if (symbols.length === 0) return []

    const existingSet = new Set(existingAssetIds)

    // Query all matching assets in batch
    const { data: assets, error } = await supabase
      .from('assets')
      .select('id, symbol, company_name')
      .in('symbol', symbols)

    if (error) {
      console.error('Error validating tickers:', error)
      return symbols.map(s => ({ symbol: s, status: 'invalid' as const }))
    }

    const assetMap = new Map(assets?.map(a => [a.symbol, a]) || [])

    return symbols.map(symbol => {
      const asset = assetMap.get(symbol)
      if (!asset) {
        return { symbol, status: 'invalid' as const }
      }
      if (existingSet.has(asset.id)) {
        return {
          symbol,
          status: 'duplicate' as const,
          assetId: asset.id,
          companyName: asset.company_name
        }
      }
      return {
        symbol,
        status: 'valid' as const,
        assetId: asset.id,
        companyName: asset.company_name
      }
    })
  }

  // Handle input change with live parsing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    // Clear parsed tickers when input changes
    if (parsedTickers.length > 0) {
      setParsedTickers([])
      setShowResults(false)
    }
  }

  // Handle paste event for batch processing
  const handlePaste = async (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const newValue = inputValue + pastedText
    setInputValue(newValue)

    // Auto-validate on paste
    const symbols = parseTickers(newValue)
    if (symbols.length > 0) {
      setIsValidating(true)
      const validated = await validateTickers(symbols)
      setParsedTickers(validated)
      setShowResults(true)
      setIsValidating(false)
    }
  }

  // Handle Enter key to validate and show preview
  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose()
      return
    }

    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()

      if (!showResults) {
        // First Enter: validate and show preview
        const symbols = parseTickers(inputValue)
        if (symbols.length > 0) {
          setIsValidating(true)
          const validated = await validateTickers(symbols)
          setParsedTickers(validated)
          setShowResults(true)
          setIsValidating(false)
        }
      } else {
        // Second Enter: add valid tickers
        addValidTickers()
      }
    }
  }

  // Add mutation for batch insert
  const addMutation = useMutation({
    mutationFn: async (assetIds: string[]) => {
      const insertData = assetIds.map(assetId => ({
        list_id: listId,
        asset_id: assetId,
        added_by: user?.id
      }))

      const { error } = await supabase
        .from('asset_list_items')
        .insert(insertData)

      if (error) throw error
      return assetIds.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      handleClose()
      onComplete?.()
    }
  })

  const addValidTickers = () => {
    const validAssetIds = parsedTickers
      .filter(t => t.status === 'valid' && t.assetId)
      .map(t => t.assetId!)

    if (validAssetIds.length > 0) {
      addMutation.mutate(validAssetIds)
    }
  }

  const handleClose = () => {
    setIsExpanded(false)
    setInputValue('')
    setParsedTickers([])
    setShowResults(false)
  }

  const removeTickerFromList = (symbolToRemove: string) => {
    setParsedTickers(prev => prev.filter(t => t.symbol !== symbolToRemove))
  }

  // Stats for display
  const validCount = parsedTickers.filter(t => t.status === 'valid').length
  const invalidCount = parsedTickers.filter(t => t.status === 'invalid').length
  const duplicateCount = parsedTickers.filter(t => t.status === 'duplicate').length

  if (!isExpanded) {
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => setIsExpanded(true)}
      >
        <Plus className="h-4 w-4 mr-1.5" />
        Add Assets
      </Button>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder="Type or paste tickers (AAPL, MSFT, GOOGL)"
            className="w-72 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {isValidating && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
          )}
        </div>
        <button
          onClick={handleClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Preview dropdown */}
      {showResults && parsedTickers.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Summary header */}
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-3 text-xs">
            {validCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <Check className="h-3.5 w-3.5" />
                {validCount} valid
              </span>
            )}
            {duplicateCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertCircle className="h-3.5 w-3.5" />
                {duplicateCount} already in list
              </span>
            )}
            {invalidCount > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <X className="h-3.5 w-3.5" />
                {invalidCount} not found
              </span>
            )}
          </div>

          {/* Ticker chips */}
          <div className="p-3 flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
            {parsedTickers.map((ticker, idx) => (
              <div
                key={`${ticker.symbol}-${idx}`}
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
                  ticker.status === 'valid' && 'bg-green-100 text-green-800',
                  ticker.status === 'invalid' && 'bg-red-100 text-red-800',
                  ticker.status === 'duplicate' && 'bg-amber-100 text-amber-800'
                )}
                title={ticker.companyName || (ticker.status === 'invalid' ? 'Ticker not found' : 'Already in list')}
              >
                <span>{ticker.symbol}</span>
                <button
                  onClick={() => removeTickerFromList(ticker.symbol)}
                  className="p-0.5 rounded hover:bg-black/10"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              Press Enter to add or click button
            </span>
            <Button
              size="sm"
              variant="primary"
              onClick={addValidTickers}
              disabled={validCount === 0 || addMutation.isPending}
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add {validCount} Asset{validCount !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Help text when typing */}
      {!showResults && inputValue.length > 0 && (
        <div className="absolute top-full left-0 mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-md text-xs text-gray-500">
          Press Enter to validate tickers
        </div>
      )}
    </div>
  )
}

export default MultiTickerInput
