import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Target,
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  AlertTriangle,
  Search,
  ChevronRight,
  PieChart,
  Clock
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { EmptyState } from '../components/common/EmptyState'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import type {
  TargetDateFund,
  TDFGlidePathTarget,
  TDFHoldingsSnapshot,
  TDFHolding,
  TDFUnderlyingFund,
  TDFTradeProposal
} from '../types/tdf'

interface TDFListPageProps {
  onTDFSelect?: (tdf: TargetDateFund) => void
}

export function TDFListPage({ onTDFSelect }: TDFListPageProps) {
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch all TDFs
  const { data: tdfs, isLoading: tdfsLoading } = useQuery({
    queryKey: ['target-date-funds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('target_date_funds')
        .select('*')
        .eq('is_active', true)
        .order('target_year')

      if (error) throw error
      return data as TargetDateFund[]
    }
  })

  // Fetch glide path targets for all TDFs
  const { data: glidePathTargets } = useQuery({
    queryKey: ['tdf-glide-path-targets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tdf_glide_path_targets')
        .select('*')

      if (error) throw error
      return data as TDFGlidePathTarget[]
    }
  })

  // Fetch latest snapshots for all TDFs
  const { data: latestSnapshots } = useQuery({
    queryKey: ['tdf-latest-snapshots'],
    queryFn: async () => {
      // Get the most recent snapshot for each TDF
      const { data, error } = await supabase
        .from('tdf_holdings_snapshots')
        .select(`
          *,
          tdf_holdings(
            *,
            tdf_underlying_funds(*)
          )
        `)
        .order('snapshot_date', { ascending: false })

      if (error) throw error

      // Group by TDF and take the latest
      const latestByTdf = new Map<string, typeof data[0]>()
      for (const snapshot of data || []) {
        if (!latestByTdf.has(snapshot.tdf_id)) {
          latestByTdf.set(snapshot.tdf_id, snapshot)
        }
      }
      return Array.from(latestByTdf.values())
    }
  })

  // Fetch pending trade proposals count
  const { data: pendingProposals } = useQuery({
    queryKey: ['tdf-pending-proposals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tdf_trade_proposals')
        .select('id, tdf_id')
        .eq('status', 'proposed')

      if (error) throw error
      return data as { id: string; tdf_id: string }[]
    }
  })

  // Calculate TDF summaries
  const tdfSummaries = useMemo(() => {
    if (!tdfs) return []

    return tdfs.map(tdf => {
      const glidePathTarget = glidePathTargets?.find(g => g.tdf_id === tdf.id)
      const latestSnapshot = latestSnapshots?.find(s => s.tdf_id === tdf.id)
      const pendingCount = pendingProposals?.filter(p => p.tdf_id === tdf.id).length || 0

      // Calculate current asset class weights from holdings
      let equityWeight = 0
      let fixedIncomeWeight = 0
      let alternativesWeight = 0
      let cashWeight = 0

      if (latestSnapshot?.tdf_holdings) {
        for (const holding of latestSnapshot.tdf_holdings) {
          const fund = holding.tdf_underlying_funds as TDFUnderlyingFund
          const weight = holding.weight || 0
          if (fund?.asset_class === 'Equity') equityWeight += weight
          else if (fund?.asset_class === 'Fixed Income') fixedIncomeWeight += weight
          else if (fund?.asset_class === 'Alternatives') alternativesWeight += weight
          else if (fund?.asset_class === 'Cash') cashWeight += weight
        }
      }

      // Calculate drift from glide path target
      let driftFromTarget = null
      if (glidePathTarget) {
        driftFromTarget = equityWeight - glidePathTarget.equity_weight
      }

      return {
        tdf,
        glidePathTarget,
        latestSnapshotDate: latestSnapshot?.snapshot_date || null,
        totalAum: latestSnapshot?.total_aum || null,
        equityWeight,
        fixedIncomeWeight,
        alternativesWeight,
        cashWeight,
        driftFromTarget,
        pendingProposalsCount: pendingCount,
        yearsToRetirement: Math.max(0, tdf.target_year - new Date().getFullYear())
      }
    })
  }, [tdfs, glidePathTargets, latestSnapshots, pendingProposals])

  // Filter TDFs
  const filteredSummaries = useMemo(() => {
    if (!searchQuery) return tdfSummaries
    const query = searchQuery.toLowerCase()
    return tdfSummaries.filter(s =>
      s.tdf.name.toLowerCase().includes(query) ||
      s.tdf.target_year.toString().includes(query) ||
      s.tdf.fund_code?.toLowerCase().includes(query)
    )
  }, [tdfSummaries, searchQuery])

  if (tdfsLoading) {
    return (
      <div className="p-6">
        <ListSkeleton count={12} />
      </div>
    )
  }

  if (!tdfs?.length) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Target}
          title="No Target Date Funds"
          description="No target date funds have been configured yet."
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Target Date Funds</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manage and monitor your TDF series (2015-2070)
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search funds..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Target className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{tdfs.length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total TDFs</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <DollarSign className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                ${((tdfSummaries.reduce((sum, s) => sum + (s.totalAum || 0), 0)) / 1e9).toFixed(1)}B
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total AUM</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {tdfSummaries.filter(s => Math.abs(s.driftFromTarget || 0) > 2).length}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Funds with Drift &gt;2%</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Clock className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {pendingProposals?.length || 0}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Pending Proposals</div>
            </div>
          </div>
        </Card>
      </div>

      {/* TDF Grid */}
      <div className="grid grid-cols-3 gap-4">
        {filteredSummaries.map((summary) => (
          <TDFCard
            key={summary.tdf.id}
            summary={summary}
            onClick={() => onTDFSelect?.(summary.tdf)}
          />
        ))}
      </div>
    </div>
  )
}

// TDF Card Component
function TDFCard({
  summary,
  onClick
}: {
  summary: {
    tdf: TargetDateFund
    glidePathTarget: TDFGlidePathTarget | null
    latestSnapshotDate: string | null
    totalAum: number | null
    equityWeight: number
    fixedIncomeWeight: number
    alternativesWeight: number
    cashWeight: number
    driftFromTarget: number | null
    pendingProposalsCount: number
    yearsToRetirement: number
  }
  onClick: () => void
}) {
  const { tdf, glidePathTarget, equityWeight, fixedIncomeWeight, alternativesWeight, cashWeight, driftFromTarget, pendingProposalsCount, yearsToRetirement, totalAum, latestSnapshotDate } = summary

  // Determine retirement status
  const isRetired = yearsToRetirement <= 0
  const isNearRetirement = yearsToRetirement > 0 && yearsToRetirement <= 5

  // Determine drift status
  const hasDrift = driftFromTarget !== null && Math.abs(driftFromTarget) > 2
  const driftDirection = driftFromTarget && driftFromTarget > 0 ? 'over' : 'under'

  return (
    <Card
      className={clsx(
        "p-4 cursor-pointer hover:shadow-md transition-all border-l-4",
        isRetired ? "border-l-gray-400" : isNearRetirement ? "border-l-yellow-500" : "border-l-blue-500"
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white">{tdf.name}</h3>
            {pendingProposalsCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {pendingProposalsCount} pending
              </Badge>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {tdf.fund_code && <span className="mr-2">{tdf.fund_code}</span>}
            {isRetired ? (
              <span className="text-gray-500">In Retirement</span>
            ) : (
              <span>{yearsToRetirement} years to retirement</span>
            )}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-400" />
      </div>

      {/* Asset Allocation Bar */}
      <div className="mb-3">
        <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
          <div
            className="bg-green-500"
            style={{ width: `${equityWeight}%` }}
            title={`Equity: ${equityWeight.toFixed(1)}%`}
          />
          <div
            className="bg-purple-500"
            style={{ width: `${fixedIncomeWeight}%` }}
            title={`Fixed Income: ${fixedIncomeWeight.toFixed(1)}%`}
          />
          <div
            className="bg-orange-500"
            style={{ width: `${alternativesWeight}%` }}
            title={`Alternatives: ${alternativesWeight.toFixed(1)}%`}
          />
          <div
            className="bg-gray-400"
            style={{ width: `${cashWeight}%` }}
            title={`Cash: ${cashWeight.toFixed(1)}%`}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            Equity {equityWeight.toFixed(0)}%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            FI {fixedIncomeWeight.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Glide Path Comparison */}
      {glidePathTarget && (
        <div className="mb-3 text-xs">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400">
            <span>Target Equity: {glidePathTarget.equity_weight}%</span>
            {driftFromTarget !== null && (
              <span className={clsx(
                "flex items-center gap-1",
                hasDrift ? (driftDirection === 'over' ? 'text-red-600' : 'text-blue-600') : 'text-green-600'
              )}>
                {hasDrift ? (
                  driftDirection === 'over' ? (
                    <>
                      <TrendingUp className="h-3 w-3" />
                      +{driftFromTarget.toFixed(1)}% drift
                    </>
                  ) : (
                    <>
                      <TrendingDown className="h-3 w-3" />
                      {driftFromTarget.toFixed(1)}% drift
                    </>
                  )
                ) : (
                  'On target'
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-800">
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          {totalAum ? `$${(totalAum / 1e9).toFixed(2)}B` : 'N/A'}
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {latestSnapshotDate ? format(new Date(latestSnapshotDate), 'MMM d') : 'No data'}
        </span>
      </div>
    </Card>
  )
}
