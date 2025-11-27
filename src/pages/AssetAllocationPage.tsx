import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PieChart,
  Plus,
  Users,
  X,
  Calendar,
  UserPlus,
  Trash2,
  FileText,
  Check,
  ChevronDown
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { EmptyState } from '../components/common/EmptyState'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import type {
  AssetClass,
  AllocationPeriod,
  OfficialAllocationView,
  AllocationView,
} from '../types/allocation'

// View configuration - columns in the grid (professional muted colors)
const VIEW_COLUMNS: { key: AllocationView; label: string; shortLabel: string; color: string; lightBg: string; darkBg: string }[] = [
  {
    key: 'strong_underweight',
    label: 'Strong Underweight',
    shortLabel: 'S-UW',
    color: '#b91c1c',
    lightBg: 'bg-red-700',
    darkBg: 'bg-red-800',
  },
  {
    key: 'underweight',
    label: 'Underweight',
    shortLabel: 'UW',
    color: '#c2410c',
    lightBg: 'bg-orange-600',
    darkBg: 'bg-orange-700',
  },
  {
    key: 'market_weight',
    label: 'Market Weight',
    shortLabel: 'MW',
    color: '#4b5563',
    lightBg: 'bg-gray-500',
    darkBg: 'bg-gray-600',
  },
  {
    key: 'overweight',
    label: 'Overweight',
    shortLabel: 'OW',
    color: '#15803d',
    lightBg: 'bg-green-700',
    darkBg: 'bg-green-800',
  },
  {
    key: 'strong_overweight',
    label: 'Strong Overweight',
    shortLabel: 'S-OW',
    color: '#166534',
    lightBg: 'bg-green-800',
    darkBg: 'bg-green-900',
  },
]

// Professional muted category colors
const CATEGORY_CONFIG: Record<string, { label: string; borderColor: string; textColor: string; bgColor: string }> = {
  equities: { label: 'Equities', borderColor: 'border-l-blue-600', textColor: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
  fixed_income: { label: 'Fixed Income', borderColor: 'border-l-purple-600', textColor: 'text-purple-700 dark:text-purple-400', bgColor: 'bg-purple-50 dark:bg-purple-900/20' },
  alternatives: { label: 'Alternatives', borderColor: 'border-l-amber-600', textColor: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-900/20' },
  cash: { label: 'Cash & Liquidity', borderColor: 'border-l-slate-500', textColor: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-50 dark:bg-slate-800/50' },
  other: { label: 'Other', borderColor: 'border-l-gray-500', textColor: 'text-gray-600 dark:text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-800/50' },
}

interface AssetClassWithCategory extends AssetClass {
  category?: string
}

interface AllocationCellNote {
  id: string
  period_id: string
  asset_class_id: string
  view_type: AllocationView
  thesis_notes: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

interface AllocationTeamMember {
  id: string
  user_id: string
  role: 'admin' | 'lead' | 'member' | 'viewer'
  asset_class_assignments: string[]
  is_active: boolean
  users: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
}

interface AssetAllocationPageProps {
  onOpenTab?: (type: string, data: unknown) => void
  initialPeriodId?: string
}

export function AssetAllocationPage({ onOpenTab, initialPeriodId }: AssetAllocationPageProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(initialPeriodId || null)
  const [showCreatePeriodModal, setShowCreatePeriodModal] = useState(false)
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{ assetClassId: string; viewType: AllocationView } | null>(null)

  // Fetch allocation periods
  const { data: periods, isLoading: periodsLoading } = useQuery({
    queryKey: ['allocation-periods'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('allocation_periods')
        .select('*')
        .order('start_date', { ascending: false })

      if (error) throw error
      return data as AllocationPeriod[]
    }
  })

  // Auto-select active period
  const activePeriod = useMemo(() => {
    if (selectedPeriodId) {
      return periods?.find(p => p.id === selectedPeriodId)
    }
    return periods?.find(p => p.status === 'active') || periods?.[0]
  }, [periods, selectedPeriodId])

  // Fetch asset classes
  const { data: assetClasses, isLoading: assetClassesLoading } = useQuery({
    queryKey: ['asset-classes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_classes')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')

      if (error) throw error
      return data as AssetClassWithCategory[]
    }
  })

  // Group asset classes by category
  const groupedAssetClasses = useMemo(() => {
    if (!assetClasses) return {}

    const groups: Record<string, AssetClassWithCategory[]> = {}
    assetClasses.forEach(ac => {
      const category = ac.category || 'other'
      if (!groups[category]) groups[category] = []
      groups[category].push(ac)
    })
    return groups
  }, [assetClasses])

  // Fetch official views for selected period
  const { data: officialViews, isLoading: officialViewsLoading } = useQuery({
    queryKey: ['official-allocation-views', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod?.id) return []
      const { data, error } = await supabase
        .from('official_allocation_views')
        .select('*, asset_classes(*)')
        .eq('period_id', activePeriod.id)

      if (error) throw error
      return data as (OfficialAllocationView & { asset_classes: AssetClass; notes?: string })[]
    },
    enabled: !!activePeriod?.id
  })

  // Fetch cell notes for selected period
  const { data: cellNotes } = useQuery({
    queryKey: ['allocation-cell-notes', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod?.id) return []
      const { data, error } = await supabase
        .from('allocation_cell_notes')
        .select('*')
        .eq('period_id', activePeriod.id)

      if (error) throw error
      return data as AllocationCellNote[]
    },
    enabled: !!activePeriod?.id
  })

  // Fetch team members
  const { data: teamMembers } = useQuery({
    queryKey: ['allocation-team-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('allocation_team_members')
        .select('*, users(id, email, first_name, last_name)')
        .eq('is_active', true)

      if (error) throw error
      return data as AllocationTeamMember[]
    }
  })

  // Create period mutation
  const createPeriodMutation = useMutation({
    mutationFn: async (data: { name: string; start_date: string; end_date: string }) => {
      const { error } = await supabase
        .from('allocation_periods')
        .insert({
          ...data,
          status: 'active',
          created_by: user?.id
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allocation-periods'] })
      setShowCreatePeriodModal(false)
    }
  })

  // Update official view mutation
  const updateOfficialViewMutation = useMutation({
    mutationFn: async ({ assetClassId, view }: { assetClassId: string; view: AllocationView }) => {
      const existing = officialViews?.find(v => v.asset_class_id === assetClassId)

      if (existing) {
        const { error } = await supabase
          .from('official_allocation_views')
          .update({ view, set_by: user?.id, approved_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('official_allocation_views')
          .insert({
            period_id: activePeriod!.id,
            asset_class_id: assetClassId,
            view,
            set_by: user?.id,
            approved_at: new Date().toISOString()
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['official-allocation-views'] })
    }
  })

  // Get view for asset class
  const getOfficialView = (assetClassId: string) => {
    return officialViews?.find(v => v.asset_class_id === assetClassId)
  }

  // Get cell note
  const getCellNote = (assetClassId: string, viewType: AllocationView) => {
    return cellNotes?.find(n => n.asset_class_id === assetClassId && n.view_type === viewType)
  }

  const isLoading = periodsLoading || assetClassesLoading || officialViewsLoading

  if (isLoading) {
    return (
      <div className="p-6">
        <ListSkeleton count={8} />
      </div>
    )
  }

  if (!periods?.length) {
    return (
      <div className="p-6">
        <EmptyState
          icon={PieChart}
          title="No Allocation Periods"
          description="Create your first allocation period to start tracking asset allocation views."
          action={
            <Button onClick={() => setShowCreatePeriodModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Period
            </Button>
          }
        />
        {showCreatePeriodModal && (
          <CreatePeriodModal
            onClose={() => setShowCreatePeriodModal(false)}
            onSubmit={(data) => createPeriodMutation.mutate(data)}
            isLoading={createPeriodMutation.isPending}
          />
        )}
      </div>
    )
  }

  // Order categories for display
  const categoryOrder = ['equities', 'fixed_income', 'alternatives', 'cash', 'other']

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
              <PieChart className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Asset Allocation</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Tactical allocation framework
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Period Selector */}
            <div className="relative">
              <select
                value={activePeriod?.id || ''}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white font-medium cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
              >
                {periods?.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.name} {period.status === 'active' && '(Active)'}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>

            <Button variant="outline" size="sm" onClick={() => setShowTeamModal(true)}>
              <Users className="h-4 w-4 mr-2" />
              Team
            </Button>

            <Button size="sm" onClick={() => setShowCreatePeriodModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Period
            </Button>
          </div>
        </div>

        {/* Period Info Bar */}
        {activePeriod && (
          <div className="mt-3 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <Calendar className="h-4 w-4" />
              <span>
                {format(new Date(activePeriod.start_date), 'MMM d, yyyy')} - {format(new Date(activePeriod.end_date), 'MMM d, yyyy')}
              </span>
            </div>
            <Badge
              variant={activePeriod.status === 'active' ? 'default' : 'secondary'}
              className={activePeriod.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
            >
              {activePeriod.status.charAt(0).toUpperCase() + activePeriod.status.slice(1)}
            </Badge>
          </div>
        )}
      </div>

      {/* Main Grid */}
      <div className="flex-1 overflow-auto p-6">
        <Card className="overflow-hidden shadow-sm">
          <div className="min-w-[900px]">
            {/* Grid Header */}
            <div className="grid grid-cols-[220px_repeat(5,1fr)] border-b border-gray-200 dark:border-gray-700">
              {/* Empty corner cell */}
              <div className="p-4 bg-gray-50 dark:bg-gray-800/50 font-semibold text-sm text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Asset Class
              </div>
              {/* Column headers */}
              {VIEW_COLUMNS.map((col) => (
                <div
                  key={col.key}
                  className={clsx(
                    "p-4 text-center font-semibold text-sm text-white",
                    col.lightBg
                  )}
                >
                  <div className="hidden lg:block">{col.label}</div>
                  <div className="lg:hidden">{col.shortLabel}</div>
                </div>
              ))}
            </div>

            {/* Asset Class Rows grouped by Category */}
            {categoryOrder.map((category) => {
              const categoryAssetClasses = groupedAssetClasses[category] || []
              if (categoryAssetClasses.length === 0) return null

              const config = CATEGORY_CONFIG[category]

              return (
                <div key={category}>
                  {/* Category Header Row */}
                  <div className={clsx(
                    "px-4 py-2 font-semibold text-sm border-l-4",
                    config.borderColor,
                    config.bgColor,
                    config.textColor
                  )}>
                    {config.label}
                  </div>

                  {/* Asset Class Rows */}
                  {categoryAssetClasses.map((assetClass, idx) => {
                    const officialView = getOfficialView(assetClass.id)
                    const isLast = idx === categoryAssetClasses.length - 1

                    return (
                      <div
                        key={assetClass.id}
                        className={clsx(
                          "grid grid-cols-[220px_repeat(5,1fr)]",
                          !isLast && "border-b border-gray-100 dark:border-gray-800"
                        )}
                      >
                        {/* Asset Class Name */}
                        <div className="p-4 flex items-center bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {assetClass.name}
                          </span>
                        </div>

                        {/* View Cells */}
                        {VIEW_COLUMNS.map((col) => {
                          const isCurrentView = officialView?.view === col.key
                          const cellNote = getCellNote(assetClass.id, col.key)
                          const hasNotes = !!cellNote?.thesis_notes

                          return (
                            <div
                              key={col.key}
                              onClick={() => setSelectedCell({ assetClassId: assetClass.id, viewType: col.key })}
                              className={clsx(
                                "p-3 flex items-center justify-center border-r border-gray-100 dark:border-gray-800 transition-all cursor-pointer group relative",
                                isCurrentView
                                  ? "bg-gray-100 dark:bg-gray-800"
                                  : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                              )}
                            >
                              {/* Selected indicator (circle) */}
                              {isCurrentView && (
                                <div
                                  className={clsx(
                                    "w-8 h-8 rounded-full flex items-center justify-center shadow-sm",
                                    col.lightBg
                                  )}
                                >
                                  <Check className="h-4 w-4 text-white" />
                                </div>
                              )}

                              {/* Notes indicator */}
                              {hasNotes && !isCurrentView && (
                                <div className="absolute top-1 right-1">
                                  <FileText className="h-3 w-3 text-gray-400" />
                                </div>
                              )}

                              {/* Hover hint */}
                              {!isCurrentView && (
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                  <div className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center">
                                    <Plus className="h-3 w-3 text-gray-400" />
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </Card>

        {/* Legend */}
        <div className="mt-6 flex items-center justify-center gap-8">
          {VIEW_COLUMNS.map((col) => (
            <div key={col.key} className="flex items-center gap-2">
              <div
                className={clsx(
                  "w-3 h-3 rounded-full",
                  col.lightBg
                )}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">{col.label}</span>
            </div>
          ))}
        </div>

        {/* Instructions */}
        <div className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
          Click any cell to add thesis notes or change the current view
        </div>
      </div>

      {/* Modals */}
      {showCreatePeriodModal && (
        <CreatePeriodModal
          onClose={() => setShowCreatePeriodModal(false)}
          onSubmit={(data) => createPeriodMutation.mutate(data)}
          isLoading={createPeriodMutation.isPending}
        />
      )}

      {showTeamModal && (
        <TeamManagementModal
          teamMembers={teamMembers || []}
          assetClasses={assetClasses || []}
          onClose={() => setShowTeamModal(false)}
        />
      )}

      {selectedCell && activePeriod && (
        <CellDetailModal
          periodId={activePeriod.id}
          assetClassId={selectedCell.assetClassId}
          viewType={selectedCell.viewType}
          assetClassName={assetClasses?.find(ac => ac.id === selectedCell.assetClassId)?.name || ''}
          isCurrentView={getOfficialView(selectedCell.assetClassId)?.view === selectedCell.viewType}
          existingNote={getCellNote(selectedCell.assetClassId, selectedCell.viewType)}
          onClose={() => setSelectedCell(null)}
          onSetAsView={() => {
            updateOfficialViewMutation.mutate({
              assetClassId: selectedCell.assetClassId,
              view: selectedCell.viewType
            })
          }}
        />
      )}
    </div>
  )
}

// Cell Detail Modal - for thesis notes and setting view
function CellDetailModal({
  periodId,
  assetClassId,
  viewType,
  assetClassName,
  isCurrentView,
  existingNote,
  onClose,
  onSetAsView
}: {
  periodId: string
  assetClassId: string
  viewType: AllocationView
  assetClassName: string
  isCurrentView: boolean
  existingNote: AllocationCellNote | undefined
  onClose: () => void
  onSetAsView: () => void
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [notes, setNotes] = useState(existingNote?.thesis_notes || '')
  const [isSaving, setIsSaving] = useState(false)

  const viewConfig = VIEW_COLUMNS.find(v => v.key === viewType)!

  const handleSaveNotes = async () => {
    setIsSaving(true)
    try {
      if (existingNote) {
        await supabase
          .from('allocation_cell_notes')
          .update({ thesis_notes: notes, updated_by: user?.id })
          .eq('id', existingNote.id)
      } else {
        await supabase
          .from('allocation_cell_notes')
          .insert({
            period_id: periodId,
            asset_class_id: assetClassId,
            view_type: viewType,
            thesis_notes: notes,
            updated_by: user?.id
          })
      }
      queryClient.invalidateQueries({ queryKey: ['allocation-cell-notes'] })
    } catch (error) {
      console.error('Failed to save notes:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleSetAsView = () => {
    onSetAsView()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {assetClassName}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <div className={clsx("w-3 h-3 rounded-full", viewConfig.lightBg)} />
              <span className="text-sm text-gray-600 dark:text-gray-400">{viewConfig.label}</span>
              {isCurrentView && (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">
                  Current View
                </Badge>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Thesis Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Thesis Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add investment thesis points for why this view might be appropriate..."
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Document key thesis points supporting this allocation view
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
          <Button
            variant="outline"
            onClick={handleSaveNotes}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Notes'}
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {!isCurrentView && (
              <Button onClick={handleSetAsView}>
                <Check className="h-4 w-4 mr-2" />
                Set as Current View
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Create Period Modal
function CreatePeriodModal({
  onClose,
  onSubmit,
  isLoading
}: {
  onClose: () => void
  onSubmit: (data: { name: string; start_date: string; end_date: string }) => void
  isLoading: boolean
}) {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name && startDate && endDate) {
      onSubmit({ name, start_date: startDate, end_date: endDate })
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create Allocation Period</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Period Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="e.g., Q4 2024"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start Date *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                End Date *
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Period'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Team Management Modal
function TeamManagementModal({
  teamMembers,
  assetClasses,
  onClose
}: {
  teamMembers: AllocationTeamMember[]
  assetClasses: AssetClassWithCategory[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [showAddMember, setShowAddMember] = useState(false)

  // Fetch all users for adding new members
  const { data: allUsers } = useQuery({
    queryKey: ['users-for-allocation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('email')

      if (error) throw error
      return data
    }
  })

  const addMemberMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase
        .from('allocation_team_members')
        .insert({
          user_id: userId,
          role,
          added_by: user?.id
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allocation-team-members'] })
      setShowAddMember(false)
    }
  })

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('allocation_team_members')
        .update({ is_active: false })
        .eq('id', memberId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allocation-team-members'] })
    }
  })

  const existingUserIds = teamMembers.map(m => m.user_id)
  const availableUsers = allUsers?.filter(u => !existingUserIds.includes(u.id)) || []

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            Asset Allocation Team
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Add Member Button */}
          <div className="mb-4">
            <Button onClick={() => setShowAddMember(!showAddMember)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Team Member
            </Button>
          </div>

          {/* Add Member Form */}
          {showAddMember && (
            <Card className="p-4 mb-4 border-indigo-200 dark:border-indigo-800">
              <h3 className="font-medium mb-3 text-gray-900 dark:text-white">Add New Member</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const formData = new FormData(e.currentTarget)
                  const userId = formData.get('userId') as string
                  const role = formData.get('role') as string
                  if (userId && role) {
                    addMemberMutation.mutate({ userId, role })
                  }
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">User</label>
                  <select
                    name="userId"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    required
                  >
                    <option value="">Select a user...</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.first_name ? `${u.first_name} ${u.last_name}` : u.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Role</label>
                  <select
                    name="role"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    required
                  >
                    <option value="member">Member</option>
                    <option value="lead">Lead</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={addMemberMutation.isPending}>
                    Add Member
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddMember(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {/* Team Members List */}
          <div className="space-y-2">
            {teamMembers.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">No team members yet</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">Add members to collaborate on allocation decisions</p>
              </div>
            ) : (
              teamMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                      <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                        {member.users.first_name?.[0] || member.users.email[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white text-sm">
                        {member.users.first_name
                          ? `${member.users.first_name} ${member.users.last_name}`
                          : member.users.email}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{member.users.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMemberMutation.mutate(member.id)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
          <Button variant="outline" onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
