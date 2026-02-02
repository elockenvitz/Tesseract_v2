/**
 * Trade Lab Page
 *
 * One Trade Lab per Portfolio architecture.
 * - Portfolio list shows all portfolios (each has exactly ONE lab)
 * - Inside lab: View selector (My Drafts / Shared / Portfolio Working Set)
 * - Right panel shows Trade Plans for quick access
 */

import React, { useState, useEffect, useMemo } from 'react'
import {
  FlaskConical,
  FolderOpen,
  Users,
  Briefcase,
  Plus,
  FileText,
  ChevronRight,
  ChevronLeft,
  Search,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  MoreVertical,
  Trash2,
  Edit2,
  X,
  Check,
  Clock,
  Send,
  CheckCircle2,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/common/Toast'
import {
  useTradeLab,
  useViewDrafts,
  useTradePlans,
} from '../hooks/useTradeLab'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/common/EmptyState'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { clsx } from 'clsx'
import type { TradeLabViewWithDetails, TradeLabDraftWithDetails } from '../lib/services/trade-lab-service'
import type { TradePlanWithDetails, TradePlanStatus } from '../lib/services/trade-plan-service'

// ============================================================================
// Portfolio List View (landing page)
// ============================================================================

interface PortfolioLabListProps {
  onSelectPortfolio: (portfolioId: string) => void
}

function PortfolioLabList({ onSelectPortfolio }: PortfolioLabListProps) {
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch all portfolios user has access to
  const { data: portfolios, isLoading, error } = useQuery({
    queryKey: ['portfolios-for-labs'],
    queryFn: async () => {
      console.log('Fetching portfolios for Trade Lab...')
      const { data, error } = await supabase
        .from('portfolios')
        .select(`
          id,
          name,
          description,
          benchmark,
          updated_at
        `)
        .order('name')
      if (error) {
        console.error('Failed to fetch portfolios:', error)
        throw new Error(error.message || JSON.stringify(error))
      }
      console.log('Fetched portfolios:', data?.length || 0, data)
      return data || []
    },
  })

  // Get labs to show draft counts (optional - table may not exist yet)
  const { data: tradeLabs } = useQuery({
    queryKey: ['trade-labs-for-list'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('trade_labs')
          .select('id, portfolio_id')
        if (error) {
          console.warn('trade_labs table may not exist yet:', error.message)
          return []
        }
        return data || []
      } catch (e) {
        console.warn('Failed to fetch trade labs:', e)
        return []
      }
    },
    retry: false,
  })

  const labsMap = useMemo(() => {
    const map = new Map<string, { id: string; draft_count?: number }>()
    tradeLabs?.forEach((lab: any) => {
      map.set(lab.portfolio_id, lab)
    })
    return map
  }, [tradeLabs])

  const filteredPortfolios = useMemo(() => {
    if (!portfolios) return []
    if (!searchQuery) return portfolios
    const q = searchQuery.toLowerCase()
    return portfolios.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    )
  }, [portfolios, searchQuery])

  if (isLoading) {
    return (
      <div className="p-6">
        <ListSkeleton count={5} />
      </div>
    )
  }

  if (error) {
    console.error('Portfolio query error:', error)
    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? JSON.stringify(error)
        : String(error)
    return (
      <div className="p-6">
        <EmptyState
          icon={FlaskConical}
          title="Failed to load portfolios"
          description={errorMessage}
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-purple-600" />
            Trade Lab
          </h1>
          <p className="text-gray-500 mt-1">
            Select a portfolio to open its Trade Lab
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Search portfolios..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Portfolio List */}
      <div className="grid gap-4">
        {filteredPortfolios.map((portfolio) => {
          const lab = labsMap.get(portfolio.id)
          return (
            <Card
              key={portfolio.id}
              className="p-4 hover:bg-gray-50 cursor-pointer transition-colors border-l-4 border-l-transparent hover:border-l-purple-500"
              onClick={() => onSelectPortfolio(portfolio.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <FlaskConical className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-medium">{portfolio.name}</h3>
                    <p className="text-sm text-gray-500">
                      {portfolio.description || 'Trade Lab'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {lab?.draft_count !== undefined && lab.draft_count > 0 && (
                    <Badge variant="secondary">
                      {lab.draft_count} draft{lab.draft_count !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </div>
              </div>
            </Card>
          )
        })}

        {filteredPortfolios.length === 0 && (
          <EmptyState
            icon={FlaskConical}
            title="No portfolios found"
            description={
              searchQuery
                ? 'Try a different search term'
                : 'Create a portfolio first'
            }
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// View Selector Component
// ============================================================================

interface ViewSelectorProps {
  views: TradeLabViewWithDetails[]
  selectedViewId: string | null
  onSelectView: (viewId: string) => void
  onCreateView: () => void
  userId: string
}

function ViewSelector({
  views,
  selectedViewId,
  onSelectView,
  onCreateView,
  userId,
}: ViewSelectorProps) {
  const myDrafts = views.find(
    (v) => v.view_type === 'private' && v.owner_id === userId
  )
  const portfolioWorkingSet = views.find(
    (v) => v.view_type === 'portfolio'
  )
  const sharedViews = views.filter((v) => v.view_type === 'shared')

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-100 rounded-lg overflow-x-auto">
      {/* My Drafts */}
      {myDrafts && (
        <button
          onClick={() => onSelectView(myDrafts.id)}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
            selectedViewId === myDrafts.id
              ? 'bg-white shadow text-purple-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
          )}
        >
          <FolderOpen className="h-4 w-4" />
          My Drafts
          {(myDrafts.draft_count || 0) > 0 && (
            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 rounded-full">
              {myDrafts.draft_count}
            </span>
          )}
        </button>
      )}

      {/* Portfolio Working Set */}
      {portfolioWorkingSet && (
        <button
          onClick={() => onSelectView(portfolioWorkingSet.id)}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
            selectedViewId === portfolioWorkingSet.id
              ? 'bg-white shadow text-purple-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
          )}
        >
          <Briefcase className="h-4 w-4" />
          Portfolio Working Set
          {(portfolioWorkingSet.draft_count || 0) > 0 && (
            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 rounded-full">
              {portfolioWorkingSet.draft_count}
            </span>
          )}
        </button>
      )}

      {/* Shared Views */}
      {sharedViews.map((view) => (
        <button
          key={view.id}
          onClick={() => onSelectView(view.id)}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
            selectedViewId === view.id
              ? 'bg-white shadow text-purple-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
          )}
        >
          <Users className="h-4 w-4" />
          {view.name}
          {(view.draft_count || 0) > 0 && (
            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 rounded-full">
              {view.draft_count}
            </span>
          )}
        </button>
      ))}

      {/* Create New View */}
      <button
        onClick={onCreateView}
        className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-md"
        title="Create shared view"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}

// ============================================================================
// Draft Card Component
// ============================================================================

interface DraftCardProps {
  draft: TradeLabDraftWithDetails
  onDelete: () => void
}

function DraftCard({ draft, onDelete }: DraftCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isPositive = draft.action === 'buy'
  const ActionIcon = isPositive ? ArrowUpRight : draft.action === 'sell' ? ArrowDownRight : Minus

  // Get rationale from trade_queue_item or notes
  const rationale = draft.trade_queue_item?.rationale || draft.notes

  return (
    <Card
      className={clsx("p-4 cursor-pointer hover:bg-gray-50 transition-colors", isExpanded && "ring-2 ring-purple-200")}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'p-2 rounded-lg',
              isPositive
                ? 'bg-green-100'
                : draft.action === 'sell'
                ? 'bg-red-100'
                : 'bg-gray-100'
            )}
          >
            <ActionIcon
              className={clsx(
                'h-4 w-4',
                isPositive
                  ? 'text-green-600'
                  : draft.action === 'sell'
                  ? 'text-red-600'
                  : 'text-gray-600'
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={clsx(
                  'text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0',
                  isPositive
                    ? 'bg-green-100 text-green-700'
                    : draft.action === 'sell'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-600'
                )}
              >
                {draft.action.toUpperCase()}
              </span>
              <span className="font-semibold text-gray-900 flex-shrink-0">{draft.asset?.symbol || 'Unknown'}</span>
              {draft.asset?.company_name && (
                <span
                  className="text-sm text-gray-500 truncate min-w-0"
                  title={draft.asset.company_name}
                >
                  {draft.asset.company_name}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ChevronDown className={clsx("h-4 w-4 text-gray-400 transition-transform", isExpanded && "rotate-180")} />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1 text-gray-400 hover:text-red-500"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          {/* Sizing info */}
          {(draft.shares || draft.weight) && (
            <div className="flex items-center gap-4 text-sm">
              {draft.shares && (
                <span className="text-gray-700"><span className="text-gray-500">Shares:</span> {draft.shares.toLocaleString()}</span>
              )}
              {draft.weight && (
                <span className="text-gray-700"><span className="text-gray-500">Weight:</span> {(draft.weight * 100).toFixed(2)}%</span>
              )}
            </div>
          )}
          {/* Rationale */}
          {rationale ? (
            <p className="text-sm text-gray-600">{rationale}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">No rationale provided</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ============================================================================
// Trade Plans Panel
// ============================================================================

interface TradePlansPanelProps {
  portfolioId: string
  onCreatePlan: () => void
  onViewAllPlans: () => void
}

const STATUS_CONFIG: Record<TradePlanStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  pending_approval: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700' },
  sent_to_desk: { label: 'Sent', color: 'bg-blue-100 text-blue-700' },
  acknowledged: { label: 'Done', color: 'bg-purple-100 text-purple-700' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-500' },
}

function TradePlansPanel({
  portfolioId,
  onCreatePlan,
  onViewAllPlans,
}: TradePlansPanelProps) {
  const { plans, isLoading } = useTradePlans({
    portfolioId,
    limit: 10,
  })

  return (
    <div className="border-l bg-gray-50 w-80 flex flex-col h-full">
      <div className="p-4 border-b bg-white">
        <div className="flex items-center justify-between">
          <h3 className="font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Trade Plans
          </h3>
          <Button size="sm" onClick={onCreatePlan}>
            <Plus className="h-4 w-4 mr-1" />
            Create
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="text-center text-gray-500 py-8">Loading...</div>
        ) : plans.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <FileText className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No plans yet</p>
            <p className="text-xs mt-1">Create one from your current view</p>
          </div>
        ) : (
          plans.map((plan) => {
            const statusConfig = STATUS_CONFIG[plan.status]
            return (
              <Card key={plan.id} className="p-3 hover:bg-gray-50 cursor-pointer">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm truncate">{plan.name}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {plan.source_view_name || 'Unknown view'} •{' '}
                      {new Date(plan.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge className={clsx('text-xs', statusConfig.color)}>
                    {statusConfig.label}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                  <Layers className="h-3 w-3" />
                  {plan.trade_plan_items?.length || 0} trades
                </div>
              </Card>
            )
          })
        )}

        {plans.length > 0 && (
          <Button variant="ghost" size="sm" className="w-full" onClick={onViewAllPlans}>
            View All Plans
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Lab Detail View
// ============================================================================

interface LabDetailViewProps {
  portfolioId: string
  onBack: () => void
}

function LabDetailView({ portfolioId, onBack }: LabDetailViewProps) {
  const { user } = useAuth()
  const toast = useToast()

  const {
    lab,
    isLoadingLab,
    views,
    isLoadingViews,
    myDraftsView,
    ensureMyDrafts,
    ensurePortfolioWorkingSet,
    createSharedViewAsync,
  } = useTradeLab({ portfolioId })

  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  const [showCreateViewModal, setShowCreateViewModal] = useState(false)
  const [newViewName, setNewViewName] = useState('')

  // Fetch portfolio info
  const { data: portfolio } = useQuery({
    queryKey: ['portfolio', portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .eq('id', portfolioId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!portfolioId,
  })

  // Ensure My Drafts and PWS exist on mount
  useEffect(() => {
    if (lab && user && !myDraftsView) {
      ensureMyDrafts()
    }
  }, [lab, user, myDraftsView, ensureMyDrafts])

  useEffect(() => {
    if (lab) {
      ensurePortfolioWorkingSet()
    }
  }, [lab, ensurePortfolioWorkingSet])

  // Auto-select My Drafts view
  useEffect(() => {
    if (!selectedViewId && myDraftsView) {
      setSelectedViewId(myDraftsView.id)
    }
  }, [myDraftsView, selectedViewId])

  // Drafts for selected view
  const {
    drafts,
    isLoading: isLoadingDrafts,
    deleteDraft,
  } = useViewDrafts({
    viewId: selectedViewId || undefined,
    labId: lab?.id,
  })

  // Trade plans
  const { createPlanAsync, isCreating } = useTradePlans({ portfolioId })

  const handleCreateView = async () => {
    if (!newViewName.trim()) return
    try {
      await createSharedViewAsync({ name: newViewName.trim() })
      setShowCreateViewModal(false)
      setNewViewName('')
    } catch (error) {
      // Toast handled by hook
    }
  }

  const handleCreatePlan = async () => {
    if (!selectedViewId) {
      toast.warning('Select a view first')
      return
    }

    const name = prompt('Plan name:')
    if (!name) return

    try {
      await createPlanAsync({
        viewId: selectedViewId,
        name,
      })
    } catch (error) {
      // Toast handled by hook
    }
  }

  if (isLoadingLab || isLoadingViews) {
    return (
      <div className="flex h-full">
        <div className="flex-1 p-8">
          <ListSkeleton count={3} />
        </div>
      </div>
    )
  }

  if (!lab) {
    return (
      <div className="p-8 text-center">
        <EmptyState
          icon={FlaskConical}
          title="Lab not found"
          description="Could not load the trade lab for this portfolio"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="p-4 border-b bg-white">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
            <button
              onClick={onBack}
              className="hover:text-gray-700 flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Trade Lab
            </button>
            <ChevronRight className="h-4 w-4" />
            <span className="text-gray-900 font-medium">{portfolio?.name}</span>
          </div>

          {/* View Selector */}
          <ViewSelector
            views={views}
            selectedViewId={selectedViewId}
            onSelectView={setSelectedViewId}
            onCreateView={() => setShowCreateViewModal(true)}
            userId={user?.id || ''}
          />
        </div>

        {/* Drafts Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoadingDrafts ? (
            <ListSkeleton count={3} />
          ) : drafts.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No drafts in this view"
              description="Add trades from the Trade Queue or create new drafts"
            />
          ) : (
            <div className="space-y-3">
              {drafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  onDelete={() => deleteDraft({ draftId: draft.id })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Trade Plans Panel */}
      <TradePlansPanel
        portfolioId={portfolioId}
        onCreatePlan={handleCreatePlan}
        onViewAllPlans={() => {
          // Note: Trade Plans page can be opened via global search
          toast.info('Open Trade Plans from the main menu')
        }}
      />

      {/* Create View Modal */}
      {showCreateViewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-96 p-6">
            <h3 className="text-lg font-semibold mb-4">Create Shared View</h3>
            <Input
              placeholder="View name"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowCreateViewModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateView} disabled={!newViewName.trim()}>
                Create
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Page Component
// ============================================================================

interface TradeLabPageProps {
  portfolioId?: string
  tabId?: string
  onClose?: () => void
}

export function TradeLabPage({ portfolioId: propPortfolioId, tabId }: TradeLabPageProps) {
  // Use internal state to manage portfolio selection (tab-based navigation)
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(propPortfolioId || null)

  const handleSelectPortfolio = (id: string) => {
    setSelectedPortfolioId(id)
  }

  const handleBack = () => {
    setSelectedPortfolioId(null)
  }

  if (selectedPortfolioId) {
    return <LabDetailView portfolioId={selectedPortfolioId} onBack={handleBack} />
  }

  return <PortfolioLabList onSelectPortfolio={handleSelectPortfolio} />
}

export default TradeLabPage
