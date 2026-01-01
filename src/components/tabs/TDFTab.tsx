import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Target,
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  FileText,
  MessageSquare,
  History,
  Plus,
  ChevronDown,
  ArrowRight,
  RefreshCw,
  Check,
  X,
  Edit2,
  Trash2
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { stripHtml } from '../../utils/stripHtml'
import { Select } from '../ui/Select'
import { ListSkeleton } from '../common/LoadingSkeleton'
import { format, subDays, subWeeks, subMonths, subQuarters, subYears } from 'date-fns'
import { clsx } from 'clsx'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts'
import type {
  TargetDateFund,
  TDFGlidePathTarget,
  TDFHoldingsSnapshot,
  TDFHolding,
  TDFUnderlyingFund,
  TDFNote,
  TDFComment,
  TDFTradeProposal,
  TDFExecutedTrade,
  TDFNoteType,
  TDFTradeStatus,
  ComparisonPeriod
} from '../../types/tdf'

interface TDFTabProps {
  tdf: TargetDateFund
}

const ASSET_CLASS_COLORS: Record<string, string> = {
  'Equity': '#22c55e',
  'Fixed Income': '#8b5cf6',
  'Alternatives': '#f97316',
  'Cash': '#6b7280'
}

const COMPARISON_PERIODS: { value: ComparisonPeriod; label: string }[] = [
  { value: 'week', label: 'vs Last Week' },
  { value: 'month', label: 'vs Last Month' },
  { value: 'quarter', label: 'vs Last Quarter' },
  { value: 'year', label: 'vs Last Year' },
]

export function TDFTab({ tdf }: TDFTabProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [activeSection, setActiveSection] = useState<'overview' | 'holdings' | 'comparison' | 'glidepath' | 'notes' | 'trades'>('overview')
  const [comparisonPeriod, setComparisonPeriod] = useState<ComparisonPeriod>('week')
  const [showAddNote, setShowAddNote] = useState(false)

  // Fetch glide path target
  const { data: glidePathTarget } = useQuery({
    queryKey: ['tdf-glide-path', tdf.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tdf_glide_path_targets')
        .select('*')
        .eq('tdf_id', tdf.id)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data as TDFGlidePathTarget | null
    }
  })

  // Fetch all snapshots for this TDF (for history)
  const { data: snapshots, isLoading: snapshotsLoading } = useQuery({
    queryKey: ['tdf-snapshots', tdf.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tdf_holdings_snapshots')
        .select(`
          *,
          tdf_holdings(
            *,
            tdf_underlying_funds(*)
          )
        `)
        .eq('tdf_id', tdf.id)
        .order('snapshot_date', { ascending: false })
        .limit(52) // Last year of weekly snapshots

      if (error) throw error
      return data as (TDFHoldingsSnapshot & { tdf_holdings: (TDFHolding & { tdf_underlying_funds: TDFUnderlyingFund })[] })[]
    }
  })

  // Latest snapshot
  const latestSnapshot = snapshots?.[0]

  // Get comparison snapshot based on period
  const comparisonSnapshot = useMemo(() => {
    if (!snapshots?.length) return null

    const now = new Date()
    let targetDate: Date
    switch (comparisonPeriod) {
      case 'week':
        targetDate = subWeeks(now, 1)
        break
      case 'month':
        targetDate = subMonths(now, 1)
        break
      case 'quarter':
        targetDate = subQuarters(now, 1)
        break
      case 'year':
        targetDate = subYears(now, 1)
        break
      default:
        targetDate = subWeeks(now, 1)
    }

    // Find closest snapshot to target date
    return snapshots.find(s => new Date(s.snapshot_date) <= targetDate) || snapshots[snapshots.length - 1]
  }, [snapshots, comparisonPeriod])

  // Fetch notes
  const { data: notes } = useQuery({
    queryKey: ['tdf-notes', tdf.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tdf_notes')
        .select('*, users(id, email, first_name, last_name)')
        .eq('tdf_id', tdf.id)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as (TDFNote & { users?: { id: string; email: string; first_name: string | null; last_name: string | null } })[]
    }
  })

  // Fetch trade proposals
  const { data: tradeProposals } = useQuery({
    queryKey: ['tdf-trade-proposals', tdf.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tdf_trade_proposals')
        .select('*')
        .eq('tdf_id', tdf.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as TDFTradeProposal[]
    }
  })

  // Fetch executed trades
  const { data: executedTrades } = useQuery({
    queryKey: ['tdf-executed-trades', tdf.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tdf_executed_trades')
        .select('*, tdf_underlying_funds(*), users(id, email, first_name, last_name)')
        .eq('tdf_id', tdf.id)
        .order('trade_date', { ascending: false })
        .limit(50)

      if (error) throw error
      return data as (TDFExecutedTrade & { tdf_underlying_funds: TDFUnderlyingFund; users?: { id: string; first_name: string | null } })[]
    }
  })

  // Calculate current weights
  const currentWeights = useMemo(() => {
    if (!latestSnapshot?.tdf_holdings) return { equity: 0, fixedIncome: 0, alternatives: 0, cash: 0 }

    let equity = 0, fixedIncome = 0, alternatives = 0, cash = 0
    for (const holding of latestSnapshot.tdf_holdings) {
      const fund = holding.tdf_underlying_funds
      const weight = holding.weight || 0
      if (fund?.asset_class === 'Equity') equity += weight
      else if (fund?.asset_class === 'Fixed Income') fixedIncome += weight
      else if (fund?.asset_class === 'Alternatives') alternatives += weight
      else if (fund?.asset_class === 'Cash') cash += weight
    }
    return { equity, fixedIncome, alternatives, cash }
  }, [latestSnapshot])

  // Add note mutation
  const addNoteMutation = useMutation({
    mutationFn: async ({ title, content, noteType }: { title: string; content: string; noteType: TDFNoteType }) => {
      const { error } = await supabase
        .from('tdf_notes')
        .insert({
          tdf_id: tdf.id,
          title,
          content,
          note_type: noteType,
          created_by: user?.id
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tdf-notes', tdf.id] })
      setShowAddNote(false)
    }
  })

  const yearsToRetirement = Math.max(0, tdf.target_year - new Date().getFullYear())
  const isRetired = yearsToRetirement <= 0

  if (snapshotsLoading) {
    return <ListSkeleton count={6} />
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
            <Target className="h-8 w-8 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tdf.name}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              {tdf.fund_code && <span>{tdf.fund_code}</span>}
              <span>•</span>
              {isRetired ? (
                <span>In Retirement</span>
              ) : (
                <span>{yearsToRetirement} years to retirement</span>
              )}
              {latestSnapshot && (
                <>
                  <span>•</span>
                  <span>Last updated: {format(new Date(latestSnapshot.snapshot_date), 'MMM d, yyyy')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={isRetired ? 'secondary' : yearsToRetirement <= 5 ? 'outline' : 'default'}>
            {tdf.target_year}
          </Badge>
          {latestSnapshot?.total_aum && (
            <Badge variant="outline">
              ${(latestSnapshot.total_aum / 1e9).toFixed(2)}B AUM
            </Badge>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-4">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'holdings', label: 'Holdings' },
            { key: 'comparison', label: 'Comparison' },
            { key: 'glidepath', label: 'Glide Path' },
            { key: 'notes', label: 'Notes' },
            { key: 'trades', label: 'Trade History' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveSection(tab.key as typeof activeSection)}
              className={clsx(
                "pb-3 px-1 text-sm font-medium border-b-2 transition-colors",
                activeSection === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content Sections */}
      {activeSection === 'overview' && (
        <OverviewSection
          currentWeights={currentWeights}
          glidePathTarget={glidePathTarget}
          latestSnapshot={latestSnapshot}
          pendingProposalsCount={tradeProposals?.filter(p => p.status === 'proposed').length || 0}
          recentNotesCount={notes?.length || 0}
        />
      )}

      {activeSection === 'holdings' && latestSnapshot && (
        <HoldingsSection holdings={latestSnapshot.tdf_holdings} totalAum={latestSnapshot.total_aum} />
      )}

      {activeSection === 'comparison' && (
        <ComparisonSection
          latestSnapshot={latestSnapshot}
          comparisonSnapshot={comparisonSnapshot}
          comparisonPeriod={comparisonPeriod}
          setComparisonPeriod={setComparisonPeriod}
        />
      )}

      {activeSection === 'glidepath' && (
        <GlidePathSection
          tdf={tdf}
          snapshots={snapshots || []}
          glidePathTarget={glidePathTarget}
          currentWeights={currentWeights}
        />
      )}

      {activeSection === 'notes' && (
        <NotesSection
          notes={notes || []}
          showAddNote={showAddNote}
          setShowAddNote={setShowAddNote}
          onAddNote={(title, content, noteType) => addNoteMutation.mutate({ title, content, noteType })}
        />
      )}

      {activeSection === 'trades' && (
        <TradesSection
          tradeProposals={tradeProposals || []}
          executedTrades={executedTrades || []}
        />
      )}
    </div>
  )
}

// Overview Section
function OverviewSection({
  currentWeights,
  glidePathTarget,
  latestSnapshot,
  pendingProposalsCount,
  recentNotesCount
}: {
  currentWeights: { equity: number; fixedIncome: number; alternatives: number; cash: number }
  glidePathTarget: TDFGlidePathTarget | null
  latestSnapshot: (TDFHoldingsSnapshot & { tdf_holdings: (TDFHolding & { tdf_underlying_funds: TDFUnderlyingFund })[] }) | undefined
  pendingProposalsCount: number
  recentNotesCount: number
}) {
  const driftFromTarget = glidePathTarget ? currentWeights.equity - glidePathTarget.equity_weight : null
  const hasDrift = driftFromTarget !== null && Math.abs(driftFromTarget) > 2

  const pieData = [
    { name: 'Equity', value: currentWeights.equity, color: ASSET_CLASS_COLORS['Equity'] },
    { name: 'Fixed Income', value: currentWeights.fixedIncome, color: ASSET_CLASS_COLORS['Fixed Income'] },
    { name: 'Alternatives', value: currentWeights.alternatives, color: ASSET_CLASS_COLORS['Alternatives'] },
    { name: 'Cash', value: currentWeights.cash, color: ASSET_CLASS_COLORS['Cash'] },
  ].filter(d => d.value > 0)

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Current Allocation */}
      <Card className="p-4 col-span-2">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Current Allocation</h3>
        <div className="flex items-center gap-8">
          <div className="w-48 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value.toFixed(1)}%`}
                  labelLine={false}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-3">
            {pieData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{item.name}</span>
                </div>
                <span className="font-medium text-gray-900 dark:text-white">{item.value.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Glide Path Status</span>
            {driftFromTarget !== null && (
              <span className={clsx(
                "text-sm font-medium",
                hasDrift ? 'text-yellow-600' : 'text-green-600'
              )}>
                {hasDrift ? (
                  driftFromTarget > 0 ? `+${driftFromTarget.toFixed(1)}% over` : `${driftFromTarget.toFixed(1)}% under`
                ) : (
                  'On Target'
                )}
              </span>
            )}
          </div>
          {glidePathTarget && (
            <div className="mt-2 text-xs text-gray-500">
              Target: {glidePathTarget.equity_weight}% Equity / {glidePathTarget.fixed_income_weight}% FI
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Total AUM</span>
            <span className="text-lg font-semibold text-gray-900 dark:text-white">
              ${latestSnapshot?.total_aum ? (latestSnapshot.total_aum / 1e9).toFixed(2) : '0'}B
            </span>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Pending Proposals</span>
            <Badge variant={pendingProposalsCount > 0 ? 'default' : 'secondary'}>
              {pendingProposalsCount}
            </Badge>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Notes</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">{recentNotesCount}</span>
          </div>
        </Card>
      </div>
    </div>
  )
}

// Holdings Section
function HoldingsSection({
  holdings,
  totalAum
}: {
  holdings: (TDFHolding & { tdf_underlying_funds: TDFUnderlyingFund })[]
  totalAum: number | null
}) {
  // Sort by weight descending
  const sortedHoldings = [...holdings].sort((a, b) => (b.weight || 0) - (a.weight || 0))

  // Group by asset class
  const byAssetClass = holdings.reduce((acc, h) => {
    const assetClass = h.tdf_underlying_funds?.asset_class || 'Other'
    if (!acc[assetClass]) acc[assetClass] = []
    acc[assetClass].push(h)
    return acc
  }, {} as Record<string, typeof holdings>)

  return (
    <div className="space-y-6">
      {/* Holdings Table */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">Holdings ({holdings.length})</h3>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {sortedHoldings.map((holding) => (
            <div key={holding.id} className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-2 h-8 rounded-full"
                  style={{ backgroundColor: ASSET_CLASS_COLORS[holding.tdf_underlying_funds?.asset_class || 'Other'] || '#6b7280' }}
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {holding.tdf_underlying_funds?.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {holding.tdf_underlying_funds?.ticker} • {holding.tdf_underlying_funds?.asset_class}
                    {holding.tdf_underlying_funds?.sub_asset_class && ` • ${holding.tdf_underlying_funds.sub_asset_class}`}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {holding.weight?.toFixed(2)}%
                </div>
                {totalAum && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    ${((holding.weight || 0) / 100 * totalAum / 1e6).toFixed(1)}M
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* By Asset Class */}
      <div className="grid grid-cols-2 gap-4">
        {Object.entries(byAssetClass).map(([assetClass, classHoldings]) => (
          <Card key={assetClass} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: ASSET_CLASS_COLORS[assetClass] || '#6b7280' }}
              />
              <h4 className="font-medium text-gray-900 dark:text-white">{assetClass}</h4>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                ({classHoldings.reduce((sum, h) => sum + (h.weight || 0), 0).toFixed(1)}%)
              </span>
            </div>
            <div className="space-y-2">
              {classHoldings.sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((h) => (
                <div key={h.id} className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{h.tdf_underlying_funds?.ticker}</span>
                  <span className="text-gray-900 dark:text-white">{h.weight?.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// Comparison Section
function ComparisonSection({
  latestSnapshot,
  comparisonSnapshot,
  comparisonPeriod,
  setComparisonPeriod
}: {
  latestSnapshot: (TDFHoldingsSnapshot & { tdf_holdings: (TDFHolding & { tdf_underlying_funds: TDFUnderlyingFund })[] }) | undefined
  comparisonSnapshot: (TDFHoldingsSnapshot & { tdf_holdings: (TDFHolding & { tdf_underlying_funds: TDFUnderlyingFund })[] }) | null
  comparisonPeriod: ComparisonPeriod
  setComparisonPeriod: (period: ComparisonPeriod) => void
}) {
  if (!latestSnapshot || !comparisonSnapshot) {
    return (
      <Card className="p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400">Not enough historical data for comparison</p>
      </Card>
    )
  }

  // Build comparison data
  const comparison = useMemo(() => {
    const currentMap = new Map(
      latestSnapshot.tdf_holdings.map(h => [h.underlying_fund_id, h])
    )
    const previousMap = new Map(
      comparisonSnapshot.tdf_holdings.map(h => [h.underlying_fund_id, h])
    )

    const allFundIds = new Set([...currentMap.keys(), ...previousMap.keys()])

    return Array.from(allFundIds).map(fundId => {
      const current = currentMap.get(fundId)
      const previous = previousMap.get(fundId)
      const fund = current?.tdf_underlying_funds || previous?.tdf_underlying_funds

      return {
        fund,
        currentWeight: current?.weight || 0,
        previousWeight: previous?.weight || 0,
        change: (current?.weight || 0) - (previous?.weight || 0),
        isNew: !previous,
        isRemoved: !current
      }
    }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
  }, [latestSnapshot, comparisonSnapshot])

  return (
    <div className="space-y-4">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Holdings Comparison</h3>
        <Select
          value={comparisonPeriod}
          onChange={(e) => setComparisonPeriod(e.target.value as ComparisonPeriod)}
          className="w-48"
        >
          {COMPARISON_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      </div>

      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span>{format(new Date(comparisonSnapshot.snapshot_date), 'MMM d, yyyy')}</span>
        <ArrowRight className="h-4 w-4" />
        <span>{format(new Date(latestSnapshot.snapshot_date), 'MMM d, yyyy')}</span>
      </div>

      {/* Comparison Table */}
      <Card className="overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fund</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Previous</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Current</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {comparison.map((row) => (
              <tr key={row.fund?.id} className={clsx(
                row.isNew && 'bg-green-50 dark:bg-green-900/10',
                row.isRemoved && 'bg-red-50 dark:bg-red-900/10'
              )}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-6 rounded-full"
                      style={{ backgroundColor: ASSET_CLASS_COLORS[row.fund?.asset_class || 'Other'] || '#6b7280' }}
                    />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{row.fund?.ticker}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{row.fund?.name}</div>
                    </div>
                    {row.isNew && <Badge variant="default" className="text-xs">New</Badge>}
                    {row.isRemoved && <Badge variant="secondary" className="text-xs">Removed</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                  {row.previousWeight.toFixed(2)}%
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                  {row.currentWeight.toFixed(2)}%
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={clsx(
                    "font-medium",
                    row.change > 0 ? 'text-green-600' : row.change < 0 ? 'text-red-600' : 'text-gray-500'
                  )}>
                    {row.change > 0 ? '+' : ''}{row.change.toFixed(2)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// Glide Path Section
function GlidePathSection({
  tdf,
  snapshots,
  glidePathTarget,
  currentWeights
}: {
  tdf: TargetDateFund
  snapshots: (TDFHoldingsSnapshot & { tdf_holdings: (TDFHolding & { tdf_underlying_funds: TDFUnderlyingFund })[] })[]
  glidePathTarget: TDFGlidePathTarget | null
  currentWeights: { equity: number; fixedIncome: number; alternatives: number; cash: number }
}) {
  // Calculate equity weight over time
  const historyData = useMemo(() => {
    return snapshots.slice(0, 26).reverse().map(snapshot => {
      let equity = 0
      for (const holding of snapshot.tdf_holdings) {
        if (holding.tdf_underlying_funds?.asset_class === 'Equity') {
          equity += holding.weight || 0
        }
      }
      return {
        date: format(new Date(snapshot.snapshot_date), 'MMM d'),
        equity,
        target: glidePathTarget?.equity_weight || 0
      }
    })
  }, [snapshots, glidePathTarget])

  return (
    <div className="space-y-6">
      {/* Current vs Target */}
      <div className="grid grid-cols-2 gap-6">
        <Card className="p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Current vs Glide Path Target</h3>
          <div className="space-y-4">
            {(['equity', 'fixedIncome', 'alternatives', 'cash'] as const).map((key) => {
              const current = currentWeights[key]
              const target = glidePathTarget ? (
                key === 'equity' ? glidePathTarget.equity_weight :
                key === 'fixedIncome' ? glidePathTarget.fixed_income_weight :
                key === 'alternatives' ? glidePathTarget.alternatives_weight :
                glidePathTarget.cash_weight
              ) : 0
              const diff = current - target

              return (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400 capitalize">
                      {key === 'fixedIncome' ? 'Fixed Income' : key}
                    </span>
                    <span className={clsx(
                      "font-medium",
                      Math.abs(diff) > 2 ? (diff > 0 ? 'text-red-600' : 'text-blue-600') : 'text-green-600'
                    )}>
                      {current.toFixed(1)}% vs {target}% ({diff > 0 ? '+' : ''}{diff.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
                    <div
                      className="absolute h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.min(current, 100)}%` }}
                    />
                    <div
                      className="absolute h-full w-0.5 bg-red-500"
                      style={{ left: `${target}%` }}
                      title={`Target: ${target}%`}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Glide Path Details</h3>
          {glidePathTarget ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Years to Retirement</span>
                <span className="text-gray-900 dark:text-white">{glidePathTarget.years_to_retirement}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Target Equity</span>
                <span className="text-gray-900 dark:text-white">{glidePathTarget.equity_weight}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Target Fixed Income</span>
                <span className="text-gray-900 dark:text-white">{glidePathTarget.fixed_income_weight}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Target Alternatives</span>
                <span className="text-gray-900 dark:text-white">{glidePathTarget.alternatives_weight}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Target Cash</span>
                <span className="text-gray-900 dark:text-white">{glidePathTarget.cash_weight}%</span>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">No glide path target configured</p>
          )}
        </Card>
      </div>

      {/* Historical Equity Weight Chart */}
      <Card className="p-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Equity Weight History</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} />
              <Legend />
              <Line type="monotone" dataKey="equity" stroke="#22c55e" name="Actual Equity" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="target" stroke="#ef4444" name="Target" strokeDasharray="5 5" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}

// Notes Section
function NotesSection({
  notes,
  showAddNote,
  setShowAddNote,
  onAddNote
}: {
  notes: (TDFNote & { users?: { id: string; email: string; first_name: string | null; last_name: string | null } })[]
  showAddNote: boolean
  setShowAddNote: (show: boolean) => void
  onAddNote: (title: string, content: string, noteType: TDFNoteType) => void
}) {
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newNoteType, setNewNoteType] = useState<TDFNoteType>('general')

  const handleSubmit = () => {
    if (newTitle && newContent) {
      onAddNote(newTitle, newContent, newNoteType)
      setNewTitle('')
      setNewContent('')
      setNewNoteType('general')
    }
  }

  const NOTE_TYPE_COLORS: Record<TDFNoteType, string> = {
    positioning: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    rationale: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    meeting: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    general: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Notes & Rationale</h3>
        <Button onClick={() => setShowAddNote(!showAddNote)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Note
        </Button>
      </div>

      {showAddNote && (
        <Card className="p-4 space-y-3">
          <input
            type="text"
            placeholder="Note title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          <Select value={newNoteType} onChange={(e) => setNewNoteType(e.target.value as TDFNoteType)}>
            <option value="general">General</option>
            <option value="positioning">Positioning</option>
            <option value="rationale">Rationale</option>
            <option value="meeting">Meeting Notes</option>
          </Select>
          <textarea
            placeholder="Note content..."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            rows={4}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowAddNote(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>Save Note</Button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {notes.map((note) => (
          <Card key={note.id} className="p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-gray-900 dark:text-white">{note.title}</h4>
                <span className={clsx("px-2 py-0.5 rounded text-xs", NOTE_TYPE_COLORS[note.note_type])}>
                  {note.note_type}
                </span>
                {note.is_pinned && <Badge variant="secondary">Pinned</Badge>}
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {format(new Date(note.created_at), 'MMM d, yyyy')}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{stripHtml(note.content || '')}</p>
            {note.users && (
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                — {note.users.first_name || note.users.email.split('@')[0]}
              </div>
            )}
          </Card>
        ))}
        {notes.length === 0 && (
          <Card className="p-8 text-center">
            <FileText className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500 dark:text-gray-400">No notes yet</p>
          </Card>
        )}
      </div>
    </div>
  )
}

// Trades Section
function TradesSection({
  tradeProposals,
  executedTrades
}: {
  tradeProposals: TDFTradeProposal[]
  executedTrades: (TDFExecutedTrade & { tdf_underlying_funds: TDFUnderlyingFund; users?: { id: string; first_name: string | null } })[]
}) {
  const [showProposals, setShowProposals] = useState(true)

  const STATUS_COLORS: Record<TDFTradeStatus, string> = {
    proposed: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-blue-100 text-blue-700',
    executed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-700',
  }

  return (
    <div className="space-y-6">
      {/* Toggle */}
      <div className="flex gap-2">
        <Button
          variant={showProposals ? 'default' : 'outline'}
          onClick={() => setShowProposals(true)}
        >
          Proposals ({tradeProposals.length})
        </Button>
        <Button
          variant={!showProposals ? 'default' : 'outline'}
          onClick={() => setShowProposals(false)}
        >
          Executed Trades ({executedTrades.length})
        </Button>
      </div>

      {showProposals ? (
        <div className="space-y-3">
          {tradeProposals.map((proposal) => (
            <Card key={proposal.id} className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white">{proposal.title}</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{proposal.description}</p>
                </div>
                <span className={clsx("px-2 py-1 rounded text-xs font-medium", STATUS_COLORS[proposal.status])}>
                  {proposal.status}
                </span>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                <strong>Rationale:</strong> {proposal.rationale}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Created {format(new Date(proposal.created_at), 'MMM d, yyyy')}
              </div>
            </Card>
          ))}
          {tradeProposals.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">No trade proposals</p>
            </Card>
          )}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fund</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Shares</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Value</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Weight Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {executedTrades.map((trade) => (
                <tr key={trade.id}>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                    {format(new Date(trade.trade_date), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {trade.tdf_underlying_funds?.ticker}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {trade.tdf_underlying_funds?.name}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx(
                      "px-2 py-1 rounded text-xs font-medium",
                      trade.action === 'buy' ? 'bg-green-100 text-green-700' :
                      trade.action === 'sell' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    )}>
                      {trade.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                    {trade.shares?.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                    ${trade.total_value?.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {trade.weight_before !== null && trade.weight_after !== null && (
                      <span className={clsx(
                        "font-medium",
                        (trade.weight_after - trade.weight_before) > 0 ? 'text-green-600' : 'text-red-600'
                      )}>
                        {trade.weight_before.toFixed(1)}% → {trade.weight_after.toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {executedTrades.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">No executed trades</p>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
