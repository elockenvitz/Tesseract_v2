import { useState, useMemo } from 'react'
import { Card } from '../ui/Card'
import { Table, ArrowUp, ArrowDown, Minus, Search, Plus, X as XIcon, Filter } from 'lucide-react'
import { Input } from '../ui/Input'
import type { SimulatedHolding, BaselineHolding } from '../../types/trading'
import { clsx } from 'clsx'

interface HoldingsComparisonProps {
  holdings: SimulatedHolding[]
  baseline: BaselineHolding[]
}

type FilterMode = 'all' | 'changed' | 'increased' | 'decreased' | 'new' | 'removed'
type SortField = 'symbol' | 'weight' | 'change'
type SortOrder = 'asc' | 'desc'

/** Minimum |change_from_baseline| to count as a meaningful weight change */
const CHANGE_THRESHOLD = 0.01

export function HoldingsComparison({ holdings, baseline }: HoldingsComparisonProps) {
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('change')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  // Default to "changed" — shows only positions with meaningful weight changes
  const [filter, setFilter] = useState<FilterMode>('changed')

  const baselineMap = useMemo(() => {
    const map = new Map<string, BaselineHolding>()
    baseline.forEach(h => map.set(h.asset_id, h))
    return map
  }, [baseline])

  // Build sector weight change map — each holding's contribution to its sector's total change
  const sectorContribMap = useMemo(() => {
    const map = new Map<string, number>()  // asset_id → contribution to sector change
    // Sum total sector change first
    const sectorTotal = new Map<string, number>()
    const allHoldings = [...holdings]
    // Add removed positions
    baseline.forEach(b => {
      if (!holdings.find(h => h.asset_id === b.asset_id)) {
        allHoldings.push({
          asset_id: b.asset_id, symbol: b.symbol, company_name: b.company_name,
          sector: b.sector, shares: 0, price: b.price, value: 0, weight: 0,
          change_from_baseline: -b.weight, is_new: false, is_removed: true, is_short: false,
        })
      }
    })
    for (const h of allHoldings) {
      const sector = h.sector || 'Other'
      sectorTotal.set(sector, (sectorTotal.get(sector) || 0) + h.change_from_baseline)
    }
    // Each holding's fraction of its sector total change
    for (const h of allHoldings) {
      const sector = h.sector || 'Other'
      const total = sectorTotal.get(sector) || 0
      // Just store the raw change_from_baseline as the sector contribution
      if (Math.abs(total) >= 0.01) {
        map.set(h.asset_id, h.change_from_baseline)
      }
    }
    return map
  }, [holdings, baseline])

  const filteredAndSorted = useMemo(() => {
    let result = [...holdings]

    // Add removed positions (in baseline but not in holdings after)
    baseline.forEach(b => {
      if (!holdings.find(h => h.asset_id === b.asset_id)) {
        result.push({
          asset_id: b.asset_id,
          symbol: b.symbol,
          company_name: b.company_name,
          sector: b.sector,
          shares: 0,
          price: b.price,
          value: 0,
          weight: 0,
          change_from_baseline: -b.weight,
          is_new: false,
          is_removed: true,
          is_short: false,
        })
      }
    })

    // Filter
    if (filter !== 'all') {
      result = result.filter(h => {
        switch (filter) {
          case 'changed': return Math.abs(h.change_from_baseline) > CHANGE_THRESHOLD || h.is_new || h.is_removed
          case 'increased': return h.change_from_baseline > CHANGE_THRESHOLD
          case 'decreased': return h.change_from_baseline < -CHANGE_THRESHOLD
          case 'new': return h.is_new
          case 'removed': return h.is_removed
          default: return true
        }
      })
    }

    // Search
    if (search) {
      const lowerSearch = search.toLowerCase()
      result = result.filter(h =>
        h.symbol.toLowerCase().includes(lowerSearch) ||
        h.company_name.toLowerCase().includes(lowerSearch)
      )
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol)
          break
        case 'weight':
          comparison = a.weight - b.weight
          break
        case 'change':
          comparison = Math.abs(a.change_from_baseline) - Math.abs(b.change_from_baseline)
          break
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return result
  }, [holdings, baseline, search, sortField, sortOrder, filter])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const stats = useMemo(() => {
    const allWithRemoved = [...holdings]
    baseline.forEach(b => {
      if (!holdings.find(h => h.asset_id === b.asset_id)) {
        allWithRemoved.push({
          asset_id: b.asset_id, symbol: b.symbol, company_name: b.company_name,
          sector: b.sector, shares: 0, price: b.price, value: 0, weight: 0,
          change_from_baseline: -b.weight, is_new: false, is_removed: true, is_short: false,
        })
      }
    })
    return {
      total: allWithRemoved.length,
      changed: allWithRemoved.filter(h => Math.abs(h.change_from_baseline) > CHANGE_THRESHOLD || h.is_new || h.is_removed).length,
      increased: allWithRemoved.filter(h => h.change_from_baseline > CHANGE_THRESHOLD && !h.is_new).length,
      decreased: allWithRemoved.filter(h => h.change_from_baseline < -CHANGE_THRESHOLD && !h.is_removed).length,
      new: holdings.filter(h => h.is_new).length,
      removed: baseline.filter(b => !holdings.find(h => h.asset_id === b.asset_id)).length,
    }
  }, [holdings, baseline])

  return (
    <Card className="p-4">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Table className="h-4 w-4" />
        Holdings Comparison
      </h3>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search holdings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('changed')}
            className={clsx(
              "px-3 py-1.5 text-xs rounded-full transition-colors flex items-center gap-1",
              filter === 'changed'
                ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            )}
          >
            <Filter className="h-3 w-3" />
            Changed ({stats.changed})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={clsx(
              "px-3 py-1.5 text-xs rounded-full transition-colors",
              filter === 'all'
                ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            )}
          >
            All ({stats.total})
          </button>
          <button
            onClick={() => setFilter('increased')}
            className={clsx(
              "px-3 py-1.5 text-xs rounded-full transition-colors flex items-center gap-1",
              filter === 'increased'
                ? "bg-green-600 text-white"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200"
            )}
          >
            <ArrowUp className="h-3 w-3" />
            Increased ({stats.increased})
          </button>
          <button
            onClick={() => setFilter('decreased')}
            className={clsx(
              "px-3 py-1.5 text-xs rounded-full transition-colors flex items-center gap-1",
              filter === 'decreased'
                ? "bg-red-600 text-white"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200"
            )}
          >
            <ArrowDown className="h-3 w-3" />
            Decreased ({stats.decreased})
          </button>
          <button
            onClick={() => setFilter('new')}
            className={clsx(
              "px-3 py-1.5 text-xs rounded-full transition-colors flex items-center gap-1",
              filter === 'new'
                ? "bg-blue-600 text-white"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200"
            )}
          >
            <Plus className="h-3 w-3" />
            New ({stats.new})
          </button>
          <button
            onClick={() => setFilter('removed')}
            className={clsx(
              "px-3 py-1.5 text-xs rounded-full transition-colors flex items-center gap-1",
              filter === 'removed'
                ? "bg-gray-600 text-white"
                : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-300"
            )}
          >
            <XIcon className="h-3 w-3" />
            Removed ({stats.removed})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th
                className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                onClick={() => handleSort('symbol')}
              >
                <div className="flex items-center gap-1">
                  Symbol
                  {sortField === 'symbol' && (
                    sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  )}
                </div>
              </th>
              <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400">
                Sector
              </th>
              <th className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400">
                Before
              </th>
              <th
                className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                onClick={() => handleSort('weight')}
              >
                <div className="flex items-center justify-end gap-1">
                  After
                  {sortField === 'weight' && (
                    sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  )}
                </div>
              </th>
              <th
                className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                onClick={() => handleSort('change')}
              >
                <div className="flex items-center justify-end gap-1">
                  Change
                  {sortField === 'change' && (
                    sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  )}
                </div>
              </th>
              <th className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400">
                Sector Δ
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {filteredAndSorted.map(holding => {
              const baselineHolding = baselineMap.get(holding.asset_id)
              const beforeWeight = baselineHolding?.weight || 0
              const sectorContrib = sectorContribMap.get(holding.asset_id)

              return (
                <tr
                  key={holding.asset_id}
                  className={clsx(
                    "hover:bg-gray-50 dark:hover:bg-gray-700/50",
                    holding.is_new && "bg-emerald-50/50 dark:bg-emerald-900/10",
                    holding.is_removed && "bg-red-50/50 dark:bg-red-900/10 opacity-60"
                  )}
                >
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const action = holding.is_new ? 'buy'
                          : holding.is_removed ? 'sell'
                          : holding.change_from_baseline > CHANGE_THRESHOLD ? 'add'
                          : holding.change_from_baseline < -CHANGE_THRESHOLD ? 'trim'
                          : null
                        if (!action) return null
                        const isBuy = action === 'buy' || action === 'add'
                        return (
                          <span className={clsx(
                            'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0',
                            isBuy
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
                          )}>
                            {action}
                          </span>
                        )
                      })()}
                      <span className="font-medium text-gray-900 dark:text-white">{holding.symbol}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">{holding.company_name}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-400">
                    {holding.sector || '—'}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-500 dark:text-gray-400 tabular-nums">
                    {beforeWeight.toFixed(2)}%
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-white tabular-nums">
                    {holding.weight.toFixed(2)}%
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {holding.change_from_baseline > CHANGE_THRESHOLD ? (
                        <ArrowUp className="h-3 w-3 text-green-600" />
                      ) : holding.change_from_baseline < -CHANGE_THRESHOLD ? (
                        <ArrowDown className="h-3 w-3 text-red-600" />
                      ) : (
                        <Minus className="h-3 w-3 text-gray-400" />
                      )}
                      <span className={clsx(
                        "font-medium tabular-nums",
                        holding.change_from_baseline > CHANGE_THRESHOLD ? "text-green-600" :
                        holding.change_from_baseline < -CHANGE_THRESHOLD ? "text-red-600" : "text-gray-400"
                      )}>
                        {holding.change_from_baseline > 0 ? '+' : ''}{holding.change_from_baseline.toFixed(2)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right">
                    {sectorContrib != null && Math.abs(sectorContrib) >= 0.01 ? (
                      <span className={clsx(
                        "text-xs tabular-nums",
                        sectorContrib > 0 ? "text-green-600 dark:text-green-400" :
                        sectorContrib < 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"
                      )}>
                        {sectorContrib > 0 ? '+' : ''}{sectorContrib.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filteredAndSorted.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No holdings match your filters
          </div>
        )}
      </div>
    </Card>
  )
}
