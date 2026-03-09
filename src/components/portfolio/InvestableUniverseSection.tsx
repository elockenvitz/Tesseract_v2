/**
 * Self-contained Investable Universe management panel.
 * Owns its own queries, mutations, and local UI state.
 * Designed to be dropped into any tab with just a portfolioId.
 */
import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Globe, Search, Plus, Filter, X, Trash2, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'

interface InvestableUniverseSectionProps {
  portfolioId: string
  defaultExpanded?: boolean
  collapsible?: boolean
}

export function InvestableUniverseSection({ portfolioId, defaultExpanded = false, collapsible = true }: InvestableUniverseSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || !collapsible)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [filterType, setFilterType] = useState('sector')
  const [filterOperator, setFilterOperator] = useState('include')
  const [filterValue, setFilterValue] = useState('')
  const [marketCapMin, setMarketCapMin] = useState('')
  const [marketCapMax, setMarketCapMax] = useState('')
  const [marketCapOperator, setMarketCapOperator] = useState<'gt' | 'lt' | 'between'>('gt')

  // ── Queries ──────────────────────────────────────────────

  const { data: universeAssets, refetch: refetchAssets } = useQuery({
    queryKey: ['portfolio-universe-assets', portfolioId],
    enabled: !!portfolioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_universe_assets')
        .select(`id, asset_id, notes, added_at, asset:assets!inner(id, symbol, company_name, sector, industry)`)
        .eq('portfolio_id', portfolioId)
        .order('added_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: universeFilters, refetch: refetchFilters } = useQuery({
    queryKey: ['portfolio-universe-filters', portfolioId],
    enabled: !!portfolioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_universe_filters')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: allAssets } = useQuery({
    queryKey: ['all-assets-for-universe'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, country, exchange, market_cap')
        .order('symbol')
      if (error) throw error
      return data || []
    },
  })

  // ── Derived ──────────────────────────────────────────────

  const filterOptions = useMemo(() => {
    if (!allAssets) return { sectors: [] as string[], industries: [] as string[], countries: [] as string[], exchanges: [] as string[] }
    return {
      sectors: [...new Set(allAssets.map(a => a.sector).filter(Boolean))].sort() as string[],
      industries: [...new Set(allAssets.map(a => a.industry).filter(Boolean))].sort() as string[],
      countries: [...new Set(allAssets.map(a => a.country).filter(Boolean))].sort() as string[],
      exchanges: [...new Set(allAssets.map(a => a.exchange).filter(Boolean))].sort() as string[],
    }
  }, [allAssets])

  const indexOptions = ['S&P 500', 'NASDAQ 100', 'Dow Jones', 'Russell 1000', 'Russell 2000', 'Russell 3000']

  const filteredUniverseAssets = useMemo(() => {
    if (!allAssets || !universeFilters || universeFilters.length === 0) return []
    return allAssets.filter(asset =>
      universeFilters.every((f: any) => {
        switch (f.filter_type) {
          case 'sector': return f.filter_operator === 'include' ? asset.sector === f.filter_value : asset.sector !== f.filter_value
          case 'industry': return f.filter_operator === 'include' ? asset.industry === f.filter_value : asset.industry !== f.filter_value
          case 'country': return f.filter_operator === 'include' ? asset.country === f.filter_value : asset.country !== f.filter_value
          case 'exchange': return f.filter_operator === 'include' ? asset.exchange === f.filter_value : asset.exchange !== f.filter_value
          case 'market_cap': {
            if (!asset.market_cap) return false
            const mcM = Number(asset.market_cap) / 1_000_000
            if (f.filter_operator === 'gt') return mcM > parseFloat(f.filter_value.replace(/[>M]/g, ''))
            if (f.filter_operator === 'lt') return mcM < parseFloat(f.filter_value.replace(/[<M]/g, ''))
            if (f.filter_operator === 'between') {
              const [minS, maxS] = f.filter_value.split('-')
              return mcM >= parseFloat(minS.replace('M', '')) && mcM <= parseFloat(maxS.replace('M', ''))
            }
            return true
          }
          default: return true
        }
      })
    )
  }, [allAssets, universeFilters])

  const combined = useMemo(() => {
    const manualIds = new Set(universeAssets?.map(ua => ua.asset_id) || [])
    const filtered = filteredUniverseAssets.filter(a => !manualIds.has(a.id))
    return { manual: universeAssets || [], filtered, total: (universeAssets?.length || 0) + filtered.length }
  }, [universeAssets, filteredUniverseAssets])

  // ── Mutations ────────────────────────────────────────────

  const addAssetM = useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase.from('portfolio_universe_assets').insert({ portfolio_id: portfolioId, asset_id: assetId })
      if (error) throw error
    },
    onSuccess: () => refetchAssets(),
  })

  const removeAssetM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('portfolio_universe_assets').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => refetchAssets(),
  })

  const addFilterM = useMutation({
    mutationFn: async (filter: { filter_type: string; filter_operator: string; filter_value: string }) => {
      const { error } = await supabase.from('portfolio_universe_filters').insert({ portfolio_id: portfolioId, ...filter })
      if (error) throw error
    },
    onSuccess: () => refetchFilters(),
  })

  const removeFilterM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('portfolio_universe_filters').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => refetchFilters(),
  })

  // ── Handlers ─────────────────────────────────────────────

  const handleAddFilter = () => {
    if (filterType === 'market_cap') {
      let fv = ''
      if (marketCapOperator === 'gt' && marketCapMin) fv = `>${marketCapMin}M`
      else if (marketCapOperator === 'lt' && marketCapMin) fv = `<${marketCapMin}M`
      else if (marketCapOperator === 'between' && marketCapMin && marketCapMax) fv = `${marketCapMin}M-${marketCapMax}M`
      if (fv) {
        addFilterM.mutate({ filter_type: 'market_cap', filter_operator: marketCapOperator, filter_value: fv })
        setMarketCapMin(''); setMarketCapMax(''); setShowFilterModal(false)
      }
    } else if (filterValue.trim()) {
      addFilterM.mutate({ filter_type: filterType, filter_operator: filterOperator, filter_value: filterValue.trim() })
      setFilterValue(''); setShowFilterModal(false)
    }
  }

  const canAddFilter = filterType === 'market_cap'
    ? (marketCapOperator === 'between' ? !!marketCapMin && !!marketCapMax : !!marketCapMin)
    : !!filterValue.trim()

  // ── Render ───────────────────────────────────────────────

  return (
    <div className={`border border-gray-200 rounded-lg overflow-hidden${collapsible ? ' mt-6' : ' h-full flex flex-col'}`}>
      {/* Header */}
      {collapsible ? (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-semibold text-gray-900">Investable Universe</span>
            <span className="text-xs text-gray-500">{combined.total} assets · {(universeFilters?.length || 0)} filters</span>
          </div>
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-semibold text-gray-900">Investable Universe</span>
            <span className="text-xs text-gray-500">{combined.total} assets · {(universeFilters?.length || 0)} filters</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setShowFilterModal(true)}>
              <Filter className="h-3.5 w-3.5 mr-1" /> Add Filter
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowSearch(!showSearch)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Assets
            </Button>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className={`px-3 py-2 border-t border-gray-200${!collapsible ? ' flex-1 flex flex-col min-h-0' : ''}`}>
          {/* Actions — only when collapsible (non-collapsible puts them in header) */}
          {collapsible && (
            <div className="flex items-center gap-1.5 mb-2">
              <Button variant="outline" size="sm" onClick={() => setShowFilterModal(true)}>
                <Filter className="h-3.5 w-3.5 mr-1" /> Add Filter
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowSearch(!showSearch)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Assets
              </Button>
            </div>
          )}

          {/* Asset Search */}
          {showSearch && (
            <div className="mb-2 p-2.5 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Search assets by symbol or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                />
                <Button variant="ghost" size="sm" onClick={() => { setShowSearch(false); setSearchQuery('') }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {searchQuery.length >= 1 && (
                <div className="max-h-48 overflow-y-auto mt-1.5">
                  {allAssets
                    ?.filter(a => a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || a.company_name?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .filter(a => !universeAssets?.some((ua: any) => ua.asset_id === a.id))
                    .slice(0, 10)
                    .map(a => (
                      <div key={a.id} className="flex items-center justify-between px-2 py-1.5 hover:bg-white rounded cursor-pointer" onClick={() => { addAssetM.mutate(a.id); setSearchQuery('') }}>
                        <div>
                          <span className="font-medium text-sm text-gray-900">{a.symbol}</span>
                          <span className="text-gray-500 ml-2 text-xs">{a.company_name}</span>
                        </div>
                        <Plus className="h-3.5 w-3.5 text-indigo-600" />
                      </div>
                    ))}
                  {allAssets?.filter(a => a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || a.company_name?.toLowerCase().includes(searchQuery.toLowerCase())).filter(a => !universeAssets?.some((ua: any) => ua.asset_id === a.id)).length === 0 && (
                    <p className="text-xs text-gray-500 px-2 py-1.5">No matching assets found</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Add Filter Modal */}
          {showFilterModal && (
            <div className="mb-2 p-2.5 bg-indigo-50 rounded-lg border border-indigo-200">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-indigo-900">Add Filter Rule</h4>
                <Button variant="ghost" size="sm" onClick={() => setShowFilterModal(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setFilterValue(''); setMarketCapMin(''); setMarketCapMax('') }} className="px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500">
                  <option value="sector">Sector</option>
                  <option value="industry">Industry</option>
                  <option value="market_cap">Market Cap</option>
                  <option value="index">Index Membership</option>
                  <option value="country">Country</option>
                  <option value="exchange">Exchange</option>
                </select>
                {filterType === 'market_cap' ? (
                  <>
                    <select value={marketCapOperator} onChange={(e) => setMarketCapOperator(e.target.value as any)} className="px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500">
                      <option value="gt">Greater than</option>
                      <option value="lt">Less than</option>
                      <option value="between">Between</option>
                    </select>
                    <input type="number" value={marketCapMin} onChange={(e) => setMarketCapMin(e.target.value)} placeholder={marketCapOperator === 'between' ? 'Min ($M)' : 'Value ($M)'} className="w-28 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500" />
                    {marketCapOperator === 'between' && (
                      <>
                        <span className="text-gray-500 text-xs">and</span>
                        <input type="number" value={marketCapMax} onChange={(e) => setMarketCapMax(e.target.value)} placeholder="Max ($M)" className="w-28 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500" />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <select value={filterOperator} onChange={(e) => setFilterOperator(e.target.value)} className="px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500">
                      <option value="include">Include</option>
                      <option value="exclude">Exclude</option>
                    </select>
                    <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)} className="px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 min-w-[150px]">
                      <option value="">Select...</option>
                      {filterType === 'sector' && filterOptions.sectors.map(s => <option key={s} value={s}>{s}</option>)}
                      {filterType === 'industry' && filterOptions.industries.map(i => <option key={i} value={i}>{i}</option>)}
                      {filterType === 'country' && filterOptions.countries.map(c => <option key={c} value={c}>{c}</option>)}
                      {filterType === 'exchange' && filterOptions.exchanges.map(e => <option key={e} value={e}>{e}</option>)}
                      {filterType === 'index' && indexOptions.map(idx => <option key={idx} value={idx}>{idx}</option>)}
                    </select>
                  </>
                )}
              </div>
              <div className="flex justify-end mt-2">
                <Button size="sm" onClick={handleAddFilter} disabled={!canAddFilter}>Add Filter</Button>
              </div>
            </div>
          )}

          {/* Active Filters */}
          {universeFilters && universeFilters.length > 0 && (
            <div className="mb-2">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Active Filters</h4>
              <div className="flex flex-wrap gap-1.5">
                {universeFilters.map((f: any) => {
                  const isExclude = f.filter_operator === 'exclude'
                  const label = { market_cap: 'Market Cap', sector: 'Sector', industry: 'Industry', country: 'Country', exchange: 'Exchange', index: 'Index' }[f.filter_type as string] || f.filter_type
                  let displayVal = f.filter_value
                  if (f.filter_type === 'market_cap') {
                    const v = f.filter_value
                    if (v.startsWith('>')) displayVal = `> $${v.slice(1)}`
                    else if (v.startsWith('<')) displayVal = `< $${v.slice(1)}`
                    else if (v.includes('-')) { const [mn, mx] = v.split('-'); displayVal = `$${mn} - $${mx}` }
                    else displayVal = `$${v}`
                  }
                  const opLabel = f.filter_type === 'market_cap' ? '' : (f.filter_operator === 'include' ? 'is' : 'is not')

                  return (
                    <div key={f.id} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-xs border ${isExclude ? 'bg-red-50 border-red-200 text-red-700' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}>
                      <span className="font-medium">{label}</span>
                      {opLabel && <span className={isExclude ? 'text-red-500' : 'text-indigo-400'}>{opLabel}</span>}
                      <span className={`font-semibold ${isExclude ? 'text-red-800' : 'text-indigo-900'}`}>{displayVal}</span>
                      <button onClick={() => removeFilterM.mutate(f.id)} className={`p-0.5 rounded transition-colors ${isExclude ? 'hover:bg-red-200 text-red-500' : 'hover:bg-indigo-200 text-indigo-500'}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Assets Table */}
          {combined.total > 0 ? (
            <div className={!collapsible ? 'flex-1 flex flex-col min-h-0' : ''}>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5 shrink-0">
                Included Assets ({combined.total})
                {combined.manual.length > 0 && combined.filtered.length > 0 && (
                  <span className="font-normal text-gray-400 normal-case tracking-normal ml-2">({combined.manual.length} manual + {combined.filtered.length} from filters)</span>
                )}
              </h4>
              <div className={`overflow-y-auto border border-gray-200 rounded-md ${collapsible ? 'max-h-64' : 'flex-1 min-h-0'}`}>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-[11px] font-medium text-gray-500 uppercase">Symbol</th>
                      <th className="px-3 py-1.5 text-left text-[11px] font-medium text-gray-500 uppercase">Company</th>
                      <th className="px-3 py-1.5 text-left text-[11px] font-medium text-gray-500 uppercase">Sector</th>
                      <th className="px-3 py-1.5 text-left text-[11px] font-medium text-gray-500 uppercase">Source</th>
                      <th className="px-3 py-1.5 text-right text-[11px] font-medium text-gray-500 uppercase"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {combined.manual.map((ua: any) => (
                      <tr key={`m-${ua.id}`} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-sm font-medium text-gray-900">{ua.asset?.symbol}</td>
                        <td className="px-3 py-1.5 text-sm text-gray-500">{ua.asset?.company_name}</td>
                        <td className="px-3 py-1.5 text-sm text-gray-500">{ua.asset?.sector || '-'}</td>
                        <td className="px-3 py-1.5"><span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-blue-100 text-blue-800">Manual</span></td>
                        <td className="px-3 py-1.5 text-right"><button onClick={() => removeAssetM.mutate(ua.id)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    ))}
                    {combined.filtered.map((a: any) => (
                      <tr key={`f-${a.id}`} className="hover:bg-gray-50 bg-indigo-50/30">
                        <td className="px-3 py-1.5 text-sm font-medium text-gray-900">{a.symbol}</td>
                        <td className="px-3 py-1.5 text-sm text-gray-500">{a.company_name}</td>
                        <td className="px-3 py-1.5 text-sm text-gray-500">{a.sector || '-'}</td>
                        <td className="px-3 py-1.5"><span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-indigo-100 text-indigo-800">Filter</span></td>
                        <td className="px-3 py-1.5 text-right text-gray-400">-</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-gray-500">
              <Globe className="h-8 w-8 mx-auto mb-1.5 text-gray-300" />
              <p className="font-medium text-sm">No assets in universe</p>
              <p className="text-xs">Add assets manually or create filter rules</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
