import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Loader2, ArrowRight, X } from 'lucide-react'
import { financialDataService, type Quote } from '../../lib/financial-data/browser-client'
import { ChartDataAdapter } from '../charts/utils/dataAdapter'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { format } from 'date-fns'

export interface InlineReferencePopupProps {
  type: 'asset' | 'mention' | 'hashtag'
  attrs: Record<string, string>
  rect: DOMRect
  onClose: () => void
  onNavigate: (type: string, id: string) => void
}

const ACCENT_COLORS = {
  asset: 'border-l-emerald-500',
  mention: 'border-l-blue-500',
  hashtag: 'border-l-amber-500',
} as const

// ─── Dot Commands ───────────────────────────────────────────────────

type DotCommand = '.chart' | '.price' | '.volume' | '.marketcap' | '.change' | '.thesis' | '.overview'

const DOT_COMMANDS: { cmd: DotCommand; label: string }[] = [
  { cmd: '.chart', label: 'Price chart' },
  { cmd: '.price', label: 'Price details' },
  { cmd: '.volume', label: 'Volume' },
  { cmd: '.marketcap', label: 'Market cap' },
  { cmd: '.change', label: 'Price change' },
  { cmd: '.thesis', label: 'Investment thesis' },
  { cmd: '.overview', label: 'Overview' },
]

// ─── Formatters ─────────────────────────────────────────────────────

function formatMarketCap(value: number | null | undefined): string {
  if (!value) return ''
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`
  return `$${value.toLocaleString()}`
}

function formatVolume(value: number | null | undefined): string {
  if (!value) return '—'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toLocaleString()
}

function formatPrice(value: number | null | undefined): string {
  if (value == null) return '—'
  return `$${value.toFixed(2)}`
}

// ─── Command Input with Autocomplete ────────────────────────────────

function CommandInput({
  value,
  onChange,
}: {
  value: DotCommand
  onChange: (cmd: DotCommand) => void
}) {
  const [inputValue, setInputValue] = useState(value)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = inputValue.toLowerCase()
    if (!q || q === '.') return DOT_COMMANDS
    return DOT_COMMANDS.filter(
      (c) => c.cmd.startsWith(q) || c.label.toLowerCase().includes(q.replace(/^\./, ''))
    )
  }, [inputValue])

  useEffect(() => {
    setHighlightIdx(0)
  }, [filtered.length])

  const selectCommand = useCallback(
    (cmd: DotCommand) => {
      setInputValue(cmd)
      setShowDropdown(false)
      onChange(cmd)
    },
    [onChange]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setShowDropdown(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((i) => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlightIdx]) selectCommand(filtered[highlightIdx].cmd)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setShowDropdown(false)
      setInputValue(value)
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => {
          // Delay to allow click on dropdown item
          setTimeout(() => setShowDropdown(false), 150)
        }}
        onKeyDown={handleKeyDown}
        className="w-full text-sm font-mono bg-gray-50 border-0 border-b border-gray-200 px-3 py-1.5 focus:outline-none focus:bg-gray-100 text-gray-700 rounded-t-xl"
        placeholder=".command"
        spellCheck={false}
        autoComplete="off"
      />
      {showDropdown && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-10 bg-white border border-gray-200 rounded-b-lg shadow-lg max-h-[200px] overflow-y-auto">
          {filtered.map((item, idx) => (
            <button
              key={item.cmd}
              onMouseDown={(e) => {
                e.preventDefault()
                selectCommand(item.cmd)
              }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                idx === highlightIdx ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="font-mono text-xs">{item.cmd}</span>
              <span className="text-gray-400 text-xs">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Quote Header (always visible in asset popup) ───────────────────

function QuoteHeader({ quote, symbol }: { quote: Quote | null | undefined; symbol: string }) {
  const isPositive = (quote?.changePercent ?? 0) >= 0
  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1">
      <span className="font-semibold text-gray-900 text-sm">{symbol}</span>
      {quote && (
        <>
          <span className="text-sm font-medium text-gray-800">{formatPrice(quote.price)}</span>
          <span className={`text-xs font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
            {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
          </span>
        </>
      )}
    </div>
  )
}

// ─── Chart View ─────────────────────────────────────────────────────

const TIMEFRAMES = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
]

function ChartView({ symbol, quote }: { symbol: string; quote: Quote | null | undefined }) {
  const [days, setDays] = useState(30)
  const isPositive = (quote?.changePercent ?? 0) >= 0
  const color = isPositive ? '#10b981' : '#ef4444'

  const data = useMemo(() => {
    return ChartDataAdapter.generateHistoricalData(symbol, quote ?? undefined, days)
  }, [symbol, quote, days])

  return (
    <div className="px-2 pb-1">
      <div className="h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`fill-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="timestamp"
              tickFormatter={(v) => format(new Date(v), days <= 30 ? 'MMM d' : 'MMM yy')}
              tick={{ fontSize: 9, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 9, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload
                return (
                  <div className="bg-gray-900 text-white text-[10px] px-2 py-1 rounded shadow">
                    {format(new Date(d.timestamp), 'MMM d, yyyy')} — {formatPrice(d.value)}
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              fill={`url(#fill-${symbol})`}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-1 px-1 pb-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.label}
            onClick={() => setDays(tf.days)}
            className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
              days === tf.days
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Price View ─────────────────────────────────────────────────────

function PriceView({ quote }: { quote: Quote | null | undefined }) {
  if (!quote) return <NoDataMsg />
  const isPositive = quote.changePercent >= 0
  return (
    <div className="px-3 py-2 space-y-2 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-gray-900">{formatPrice(quote.price)}</span>
        <span className={`text-sm font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
          {isPositive ? '+' : ''}{quote.change.toFixed(2)} ({isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%)
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
        <div>Open <span className="text-gray-700 float-right">{formatPrice(quote.open)}</span></div>
        <div>Prev Close <span className="text-gray-700 float-right">{formatPrice(quote.previousClose)}</span></div>
        <div>Day High <span className="text-gray-700 float-right">{formatPrice(quote.dayHigh)}</span></div>
        <div>Day Low <span className="text-gray-700 float-right">{formatPrice(quote.dayLow)}</span></div>
      </div>
    </div>
  )
}

// ─── Volume View ────────────────────────────────────────────────────

function VolumeView({ quote }: { quote: Quote | null | undefined }) {
  if (!quote) return <NoDataMsg />
  return (
    <div className="px-3 py-3 text-center">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Volume</div>
      <div className="text-2xl font-semibold text-gray-900">{formatVolume(quote.volume)}</div>
    </div>
  )
}

// ─── Market Cap View ────────────────────────────────────────────────

function MarketCapView({ quote }: { quote: Quote | null | undefined }) {
  if (!quote?.marketCap) return <NoDataMsg />
  return (
    <div className="px-3 py-3 text-center">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Market Cap</div>
      <div className="text-2xl font-semibold text-gray-900">{formatMarketCap(quote.marketCap)}</div>
    </div>
  )
}

// ─── Change View ────────────────────────────────────────────────────

function ChangeView({ quote }: { quote: Quote | null | undefined }) {
  if (!quote) return <NoDataMsg />
  const isPositive = quote.changePercent >= 0
  const color = isPositive ? 'text-emerald-600' : 'text-red-500'
  return (
    <div className="px-3 py-3 text-center">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Change</div>
      <div className={`text-2xl font-semibold ${color}`}>
        {isPositive ? '+' : ''}{quote.change.toFixed(2)}
      </div>
      <div className={`text-sm font-medium ${color} mt-0.5`}>
        {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
      </div>
    </div>
  )
}

// ─── Thesis View ────────────────────────────────────────────────────

function ThesisView({ assetId }: { assetId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['inline-ref-thesis', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('thesis, where_different, risks_to_thesis')
        .eq('id', assetId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!assetId,
    staleTime: 60_000,
  })

  if (isLoading) return <LoadingSpinner />
  if (!data) return <NoDataMsg />

  const fields = [
    { label: 'Thesis', value: data.thesis },
    { label: 'Where Different', value: data.where_different },
    { label: 'Risks', value: data.risks_to_thesis },
  ].filter((f) => f.value)

  if (fields.length === 0) return <NoDataMsg msg="No thesis data" />

  return (
    <div className="px-3 py-2 max-h-[200px] overflow-y-auto space-y-2">
      {fields.map((f) => (
        <div key={f.label}>
          <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">{f.label}</div>
          <div className="text-xs text-gray-700 leading-relaxed">{f.value}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Overview View (original) ───────────────────────────────────────

function OverviewView({
  asset,
}: {
  asset: { id: string; symbol: string; company_name: string; sector: string | null; market_cap: number | null }
}) {
  return (
    <div className="px-3 py-2 space-y-1">
      <div className="font-semibold text-gray-900">{asset.symbol}</div>
      <div className="text-sm text-gray-600">{asset.company_name}</div>
      {(asset.sector || asset.market_cap) && (
        <div className="text-xs text-gray-400">
          {[asset.sector, formatMarketCap(asset.market_cap)].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  )
}

// ─── No Data Message ────────────────────────────────────────────────

function NoDataMsg({ msg = 'No data available' }: { msg?: string }) {
  return <div className="px-3 py-4 text-xs text-gray-400 text-center">{msg}</div>
}

// ─── Asset Content (with dot-command input) ─────────────────────────

function AssetContent({
  attrs,
  onNavigate,
  onClose,
}: {
  attrs: Record<string, string>
  onNavigate: InlineReferencePopupProps['onNavigate']
  onClose: () => void
}) {
  const assetId = attrs['data-id']
  const symbol = attrs['data-symbol'] || ''
  const [activeCmd, setActiveCmd] = useState<DotCommand>('.chart')

  // Fetch asset basic info
  const { data: asset, isLoading: assetLoading } = useQuery({
    queryKey: ['inline-ref-asset', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, market_cap')
        .eq('id', assetId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!assetId,
    staleTime: 60_000,
  })

  const resolvedSymbol = asset?.symbol || symbol

  // Fetch quote (needed for chart, price, volume, marketcap, change)
  const needsQuote = ['.chart', '.price', '.volume', '.marketcap', '.change'].includes(activeCmd)
  const { data: quote, isLoading: quoteLoading } = useQuery({
    queryKey: ['inline-ref-quote', resolvedSymbol],
    queryFn: () => financialDataService.getQuote(resolvedSymbol),
    enabled: !!resolvedSymbol && needsQuote,
    staleTime: 5 * 60_000,
  })

  if (assetLoading) return <LoadingSpinner />
  if (!asset) return <div className="p-3 text-sm text-gray-500">Asset not found</div>

  return (
    <>
      {/* Command input */}
      <div className="flex items-center">
        <div className="flex-1">
          <CommandInput value={activeCmd} onChange={setActiveCmd} />
        </div>
        <button
          onClick={onClose}
          className="px-2 py-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded-tr-xl"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Quote header */}
      <QuoteHeader quote={needsQuote ? quote : null} symbol={resolvedSymbol} />

      {/* Content area */}
      {needsQuote && quoteLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          {activeCmd === '.chart' && <ChartView symbol={resolvedSymbol} quote={quote} />}
          {activeCmd === '.price' && <PriceView quote={quote} />}
          {activeCmd === '.volume' && <VolumeView quote={quote} />}
          {activeCmd === '.marketcap' && <MarketCapView quote={quote} />}
          {activeCmd === '.change' && <ChangeView quote={quote} />}
          {activeCmd === '.thesis' && <ThesisView assetId={assetId} />}
          {activeCmd === '.overview' && <OverviewView asset={asset} />}
        </>
      )}

      {/* View Asset link */}
      <div className="px-3 pb-2">
        <button
          onClick={() => onNavigate('asset', asset.id)}
          className="text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition-colors"
        >
          View Asset <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </>
  )
}

// ─── Mention Content (unchanged) ────────────────────────────────────

function MentionContent({ attrs }: { attrs: Record<string, string> }) {
  const userId = attrs['data-id']

  const { data: user, isLoading } = useQuery({
    queryKey: ['inline-ref-user', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('id', userId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!userId,
    staleTime: 60_000,
  })

  if (isLoading) return <LoadingSpinner />
  if (!user) return <div className="p-3 text-sm text-gray-500">User not found</div>

  return (
    <div className="p-3">
      <div className="font-semibold text-gray-900">{user.full_name}</div>
      {user.email && (
        <div className="text-sm text-gray-500 mt-0.5">{user.email}</div>
      )}
    </div>
  )
}

// ─── Hashtag Content (unchanged) ────────────────────────────────────

function HashtagContent({ attrs, onNavigate }: { attrs: Record<string, string>; onNavigate: InlineReferencePopupProps['onNavigate'] }) {
  const tagType = attrs['data-tag-type']
  const tagId = attrs['data-id']

  const { data, isLoading } = useQuery({
    queryKey: ['inline-ref-hashtag', tagType, tagId],
    queryFn: async () => {
      if (tagType === 'theme') {
        const { data, error } = await supabase
          .from('themes')
          .select('id, name, description')
          .eq('id', tagId)
          .single()
        if (error) throw error
        return { ...data, entityType: 'theme' as const }
      }
      if (tagType === 'portfolio') {
        const { data, error } = await supabase
          .from('portfolios')
          .select('id, name, description')
          .eq('id', tagId)
          .single()
        if (error) throw error
        return { ...data, entityType: 'portfolio' as const }
      }
      return null
    },
    enabled: !!tagId && !!tagType,
    staleTime: 60_000,
  })

  if (isLoading) return <LoadingSpinner />
  if (!data) return <div className="p-3 text-sm text-gray-500">Not found</div>

  const typeLabel = data.entityType === 'theme' ? 'Theme' : 'Portfolio'

  return (
    <div className="p-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-gray-900">{data.name}</div>
        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{typeLabel}</span>
      </div>
      {data.description && (
        <div className="text-sm text-gray-500 mt-1 line-clamp-2">{data.description}</div>
      )}
      <button
        onClick={() => onNavigate(data.entityType, data.id)}
        className="mt-2.5 text-xs font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1 transition-colors"
      >
        View {typeLabel} <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  )
}

// ─── Loading Spinner ────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="p-4 flex items-center justify-center">
      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
    </div>
  )
}

// ─── Main Popup ─────────────────────────────────────────────────────

export function InlineReferencePopup({ type, attrs, rect, onClose, onNavigate }: InlineReferencePopupProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  const popupWidth = type === 'asset' ? 400 : 280

  // Calculate position synchronously to avoid flash at (0,0)
  let left = rect.left
  let top: number | undefined = rect.bottom + 6
  let bottom: number | undefined = undefined

  if (top + 300 > window.innerHeight) {
    top = undefined
    bottom = window.innerHeight - rect.top + 6
  }
  if (left + popupWidth > window.innerWidth) {
    left = window.innerWidth - popupWidth - 10
  }

  const position = { left, top, bottom }

  // Dismiss on outside click
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
      onClose()
    }
  }, [onClose])

  // Dismiss on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  // Dismiss on scroll
  const handleScroll = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [handleOutsideClick, handleKeyDown, handleScroll])

  const style: React.CSSProperties = {
    left: position.left,
    width: popupWidth,
    ...(position.top !== undefined ? { top: position.top } : {}),
    ...(position.bottom !== undefined ? { bottom: position.bottom } : {}),
  }

  return createPortal(
    <div
      ref={popoverRef}
      className={`fixed z-[9999] bg-white rounded-xl shadow-xl border border-gray-200 border-l-4 ${ACCENT_COLORS[type]}`}
      style={style}
    >
      {type === 'asset' && <AssetContent attrs={attrs} onNavigate={onNavigate} onClose={onClose} />}
      {type === 'mention' && <MentionContent attrs={attrs} />}
      {type === 'hashtag' && <HashtagContent attrs={attrs} onNavigate={onNavigate} />}
    </div>,
    document.body
  )
}
