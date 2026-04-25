/**
 * TradeBookPage — Top-level page for the Trade Book.
 *
 * The SOLE canonical committed-trade surface. All committed trades live here.
 * Two views:
 *   - Trades: individual accepted trades with execution tracking
 *   - Batches: grouped trades with approval workflow (replaces old Trade Plans)
 *
 * trade_batches are the approval/grouping layer. Do not reintroduce Trade Plans.
 * Trade Sheets are snapshot artifacts only and must not mutate decision state.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { BookOpen, Layers, List, Briefcase, ChevronDown, Search, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { useAcceptedTrades, useTradeBatches } from '../hooks/useAcceptedTrades'
import { AcceptedTradesTable } from '../components/trading/AcceptedTradesTable'
import { buildPairInfoByAsset } from '../lib/trade-lab/pair-info'
import { markStaleAcceptedTrades } from '../lib/services/trade-reconciliation-service'
import { BatchListView } from '../components/trading/BatchListView'
import { TabStateManager } from '../lib/tabStateManager'
import type { ExecutionStatus, ActionContext, TradeAction } from '../types/trading'
import { usePilotMode } from '../hooks/usePilotMode'
import { usePilotProgress } from '../hooks/usePilotProgress'
import { PilotTradeBookGetStarted } from '../components/pilot/PilotTradeBookGetStarted'

// Stable key for TabStateManager — there's only ever one Trade Book
// tab open, so a literal id is fine. Used to persist view toggle,
// selected batch, and selected portfolio across tab switches so
// returning to the Trade Book puts the PM right back where they left
// off. Stored in sessionStorage via TabStateManager — clears on logout
// or explicit reset, not on page navigation within the session.
const TRADE_BOOK_TAB_ID = 'trade-book'

interface PersistedTradeBookState {
  view?: BookView
  selectedBatchId?: string | null
  selectedPortfolioId?: string
}

// ---------------------------------------------------------------------------
// View toggle type
// ---------------------------------------------------------------------------

type BookView = 'trades' | 'batches'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TradeBookPageProps {
  initialPortfolioId?: string
  /** Optional list of accepted_trade ids to scroll into view + briefly
   *  highlight on mount. Set by SimulationPage's "View in Trade Book" CTA in
   *  the Decision Recorded modal so the PM immediately sees what just landed. */
  highlightTradeIds?: string[]
  /** Optional trade_batch id to pre-select in the left rail. When the user
   *  arrives via the Decision Recorded modal we know exactly which batch
   *  they just committed; pre-selecting it skips a hunt-and-click. */
  highlightBatchId?: string
}

export function TradeBookPage({ initialPortfolioId, highlightTradeIds, highlightBatchId }: TradeBookPageProps = {}) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  // Hydrate from session-persisted state once, at mount. TabStateManager
  // stores state keyed by tab id in sessionStorage so tab-switch round
  // trips restore the user's exact context (view, selected batch,
  // selected portfolio) instead of reverting to defaults. Loaded
  // synchronously in the useState initializer so there's no first-paint
  // flash of default state before the hydration effect runs.
  const persisted: PersistedTradeBookState = useMemo(
    () => (TabStateManager.loadTabState(TRADE_BOOK_TAB_ID) as PersistedTradeBookState) || {},
    // Intentional: read once on mount. Later writes are driven by the
    // save effect, and reading again would erase in-flight local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Batches view is the default — trades come in coherent groups
  // (rebalances, cash raises, individual ideas) and the batch rationale
  // + name carry the context a PM needs to recall the intent behind a
  // commit. The flat trades list is a drill-down, not the overview.
  // Always land on Batches on mount — regardless of what view the user
  // was on when they last left this tab, and regardless of whether the
  // caller handed us highlightTradeIds. The user asked for this: the
  // batch context (name, rationale, grouped trades) is the intended
  // landing. If they switch to the Trades view during the session, the
  // highlight effect below still scrolls to and flashes the new rows.
  const [view, setView] = useState<BookView>('batches')
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(
    // Caller-supplied highlightBatchId beats persisted state — it
    // means "the user just committed this batch, land on it." Without
    // this initial-state override there's a frame where the persisted
    // (stale) batch is selected before the override-on-mount effect
    // below runs, which reads as a brief flash of the wrong batch.
    highlightBatchId ?? persisted.selectedBatchId ?? null,
  )

  // One-shot: if the page mount carried a highlightBatchId AND the
  // user is on the Batches view (default), make sure the prop wins
  // even if a render after mount tries to fall back to persisted
  // state. Intentionally fires only when `highlightBatchId` flips —
  // a manual click on a different batch later in the session is not
  // overridden.
  const lastHandledBatchHighlightRef = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightBatchId) return
    if (lastHandledBatchHighlightRef.current === highlightBatchId) return
    lastHandledBatchHighlightRef.current = highlightBatchId
    setSelectedBatchId(highlightBatchId)
    setView('batches')
  }, [highlightBatchId])
  // Transient "pre-fill the Trades view search with this string"
  // signal. Set ONLY by handleViewBatchTrades (explicit "Open in
  // Trades" from the Batches detail panel). Intentionally NOT
  // persisted — on tab-switch return this stays null, so the Trades
  // view's search is blank unless the user just explicitly asked
  // for a batch-scoped view. This decouples "batch is selected in
  // the Batches view" from "trades view should be pre-filtered"
  // which was previously entangled and caused stale V2B-style
  // pre-fills after tab-switching.
  const [pendingTradesSearch, setPendingTradesSearch] = useState<string | null>(null)

  // Clear the pending search whenever we leave the Trades view. On
  // re-entry the value will either be null (toggle button) or
  // freshly-set (Open in Trades from Batches detail).
  useEffect(() => {
    if (view !== 'trades') setPendingTradesSearch(null)
  }, [view])

  // Portfolio selector
  const { data: portfolios = [], isLoading: portfoliosLoading } = useQuery({
    queryKey: ['portfolios-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('portfolios')
        .select('id, name, portfolio_id, holdings_source')
        .order('name')
      return data || []
    },
    staleTime: 60_000,
  })

  // Prefer the explicit initialPortfolioId prop (e.g. when the user
  // navigates in with a specific portfolio context) over the persisted
  // value. Fall back to persisted only when the prop isn't supplied.
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | undefined>(
    initialPortfolioId ?? persisted.selectedPortfolioId,
  )

  // Persist state whenever any of the tracked fields change. The
  // initial render writes the hydrated values straight back — cheap
  // and keeps a single source of truth, so no "wait for first
  // initialization" flag is needed.
  useEffect(() => {
    TabStateManager.saveTabState(TRADE_BOOK_TAB_ID, {
      view,
      selectedBatchId,
      selectedPortfolioId,
    } satisfies PersistedTradeBookState)
  }, [view, selectedBatchId, selectedPortfolioId])
  const portfolioId = selectedPortfolioId || portfolios[0]?.id
  const [portfolioDropdownOpen, setPortfolioDropdownOpen] = useState(false)
  const [portfolioSearch, setPortfolioSearch] = useState('')
  const portfolioDropdownRef = useRef<HTMLDivElement>(null)
  const portfolioSearchRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!portfolioDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (portfolioDropdownRef.current && !portfolioDropdownRef.current.contains(e.target as Node)) {
        setPortfolioDropdownOpen(false)
        setPortfolioSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [portfolioDropdownOpen])

  // Auto-focus search on open
  useEffect(() => {
    if (portfolioDropdownOpen) portfolioSearchRef.current?.focus()
  }, [portfolioDropdownOpen])

  const filteredPortfolios = portfolios.filter((p: any) => {
    if (!portfolioSearch) return true
    const q = portfolioSearch.toLowerCase()
    return p.name?.toLowerCase().includes(q) || p.portfolio_id?.toLowerCase().includes(q)
  })

  // Fetch user's role for this portfolio
  const { data: userRole } = useQuery({
    queryKey: ['user-portfolio-role', user?.id, portfolioId],
    queryFn: async () => {
      if (!user?.id || !portfolioId) return null
      const { data } = await supabase
        .from('portfolio_team')
        .select('role')
        .eq('user_id', user.id)
        .eq('portfolio_id', portfolioId)
        .maybeSingle()
      return data?.role as string | null
    },
    enabled: !!user?.id && !!portfolioId,
    staleTime: 60_000,
  })

  const {
    trades,
    isLoading: tradesLoading,
    updateExecutionStatus,
    updateSizing,
    revert,
    correct,
    addComment,
  } = useAcceptedTrades(portfolioId)

  const { batches, isLoading: batchesLoading } = useTradeBatches(portfolioId)

  // Treat "still resolving the portfolio id" and "either child query
  // still loading" as loading. Without this guard the page renders the
  // empty state for one frame between mount and the first query firing
  // (or between trades resolving and batches resolving) — visible as a
  // brief "No batches yet" / "No trades" flash.
  const isLoading = portfoliosLoading || !portfolioId || tradesLoading || batchesLoading

  // Pilot unlock for Outcomes: once the pilot user has opened Trade Book at
  // least once with a real committed trade visible, promote outcomes
  // 'preview' → 'full'. Idempotent — markPilotStage no-ops if already set.
  const pilotMode = usePilotMode()
  const { mark: markPilotStage, hasUnlockedOutcomes } = usePilotProgress()
  useEffect(() => {
    if (!pilotMode.isPilot || pilotMode.isLoading) return
    if (hasUnlockedOutcomes) return
    if (!trades || trades.length === 0) return
    markPilotStage('outcomes_unlocked')
  }, [pilotMode.isPilot, pilotMode.isLoading, hasUnlockedOutcomes, trades, markPilotStage])

  // Highlight newly-committed rows: when the PM clicks "View in Trade Book"
  // from the Decision Recorded modal, we receive their accepted_trade ids
  // via highlightTradeIds. Wait until the trades list actually includes the
  // target rows, then scroll the first one into view and apply a brief
  // ring animation. Fires once.
  const highlightedAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightTradeIds || highlightTradeIds.length === 0) return
    if (!trades || trades.length === 0) return
    const firstId = highlightTradeIds[0]
    if (highlightedAppliedRef.current === firstId) return
    // Wait until at least the first target is present in the list
    if (!trades.some(t => t.id === firstId)) return

    highlightedAppliedRef.current = firstId

    // Give the table a tick to mount
    const timeout = setTimeout(() => {
      for (const id of highlightTradeIds) {
        const el = document.querySelector<HTMLElement>(`tr[data-trade-id="${id}"]`)
        if (!el) continue
        if (id === firstId) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        // Flash class — a soft amber ring that fades out.
        el.classList.add('decision-recorded-flash')
        setTimeout(() => el.classList.remove('decision-recorded-flash'), 2600)
      }
    }, 80)

    return () => clearTimeout(timeout)
  }, [highlightTradeIds, trades])

  // Staleness sweep: flag pending accepted_trades whose activity clock has
  // crossed the portfolio's inactivity window. Fire once per portfolio mount
  // — the sweep is idempotent and cheap, and the Trade Book is the primary
  // surface where stale rows matter. Errors are swallowed: a failed sweep
  // must not block the page.
  const sweptPortfoliosRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!portfolioId) return
    if (sweptPortfoliosRef.current.has(portfolioId)) return
    sweptPortfoliosRef.current.add(portfolioId)
    markStaleAcceptedTrades(portfolioId).catch((e) =>
      console.warn('[TradeBook] Staleness sweep failed', e),
    )
  }, [portfolioId])

  // Full pair context for the Trade Book. Even if only one leg of a pair
  // has been committed to accepted_trades, we want its row to show the full
  // pair badge with all partner symbols. To do that we fetch trade_queue_items
  // for every pair_id referenced by the current accepted_trades, which gives
  // us a complete picture of every leg in each pair (accepted or not).
  const pairIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of trades) {
      const pid = t.trade_queue_item?.pair_id || t.trade_queue_item?.pair_trade_id
      if (pid) set.add(pid)
    }
    return Array.from(set)
  }, [trades])

  const { data: pairContextItems = [] } = useQuery({
    queryKey: ['trade-book-pair-context', portfolioId, pairIds.sort().join(',')],
    enabled: pairIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select('id, asset_id, pair_id, pair_trade_id, pair_leg_type, action, assets:asset_id(symbol)')
        .or(`pair_id.in.(${pairIds.join(',')}),pair_trade_id.in.(${pairIds.join(',')})`)
      if (error) throw error
      return data || []
    },
    staleTime: 60_000,
  })

  const pairInfoByAsset = useMemo(() => {
    return buildPairInfoByAsset(
      pairContextItems.map((it: any) => ({
        asset_id: it.asset_id,
        symbol: it.assets?.symbol,
        pair_id: it.pair_id,
        pair_trade_id: it.pair_trade_id,
        pair_leg_type: it.pair_leg_type,
        action: it.action,
      })),
    )
  }, [pairContextItems])

  // Role-based permissions
  const isPM = userRole === 'pm' || userRole === 'admin'
  const isTrader = userRole === 'trader'
  const canEdit = isPM
  const canUpdateExecution = isPM || isTrader
  const canRevert = isPM

  const getContext = useCallback((): ActionContext => ({
    actorId: user!.id,
    actorName: (user as any)?.first_name || user?.email || 'User',
    actorRole: 'pm',
    requestId: `trade-book-${Date.now()}`,
  }), [user])

  const handleUpdateExecutionStatus = useCallback(
    (id: string, status: ExecutionStatus, note: string | null, context: ActionContext) => {
      updateExecutionStatus({ id, status, note, context })
    },
    [updateExecutionStatus]
  )

  const handleUpdateSizing = useCallback(
    (id: string, updates: { sizing_input?: string; action?: TradeAction }, context: ActionContext) => {
      updateSizing({ id, updates, context })
    },
    [updateSizing]
  )

  const handleRevert = useCallback(
    (id: string, reason: string, context: ActionContext) => {
      revert({ id, reason, context })
    },
    [revert]
  )

  const handleCreateCorrection = useCallback(
    (originalTradeId: string, sizingInput: string, note: string, context: ActionContext) => {
      if (!user) return
      correct({
        originalTradeId,
        acceptedBy: context.actorId || user.id,
        sizing_input: sizingInput,
        note,
      }).catch((e: any) => {
        // Surface failures inline — the prompt flow has no toast harness.
        console.error('[TradeBook] Correction failed', e)
        window.alert(`Correction failed: ${e?.message || 'unknown error'}`)
      })
    },
    [user, correct]
  )

  const handleAddComment = useCallback(
    (tradeId: string, content: string) => {
      if (!user) return
      addComment({ tradeId, userId: user.id, content })
    },
    [user, addComment]
  )

  const handleSelectBatch = useCallback((batchId: string | null) => {
    setSelectedBatchId(batchId)
  }, [])

  // "View Trades" from batch detail → switch to Trades view pre-filled
  // with the batch's NAME in the search. The batch-id is also kept as
  // the current `selectedBatchId` (so returning to Batches still shows
  // it selected), but the Trades view reads from `pendingTradesSearch`,
  // NOT `selectedBatchId`, so tab-switch persistence doesn't cause a
  // stale pre-fill.
  const handleViewBatchTrades = useCallback((batchId: string) => {
    const b = batches.find((x) => x.id === batchId)
    setPendingTradesSearch(b?.name || null)
    setSelectedBatchId(batchId)
    setView('trades')
  }, [batches])

  // Batch the user JUST committed (from the Decision Recorded modal's
  // "View in Trade Book" CTA). Derived from highlightTradeIds — we look up
  // the first highlighted accepted_trade and take its batch_id. Used to
  // badge the batch card, paint a continuity line in the detail panel,
  // and auto-select that batch on first mount so the PM lands on the
  // right context without having to find it in the left rail.
  const justCommittedBatchId = useMemo<string | null>(() => {
    if (!highlightTradeIds || highlightTradeIds.length === 0) return null
    if (!trades || trades.length === 0) return null
    for (const id of highlightTradeIds) {
      const t = trades.find(x => x.id === id)
      if (t?.batch_id) return t.batch_id
    }
    return null
  }, [highlightTradeIds, trades])

  // Auto-select the just-committed batch once, on first successful
  // resolve. We use a ref (not a state flag) so switching between the
  // Trades and Batches views within the same session doesn't re-select
  // it and fight the user's navigation.
  const autoSelectedJustCommittedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!justCommittedBatchId) return
    if (autoSelectedJustCommittedRef.current === justCommittedBatchId) return
    autoSelectedJustCommittedRef.current = justCommittedBatchId
    setSelectedBatchId(justCommittedBatchId)
  }, [justCommittedBatchId])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center px-6 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Trade Book</h1>

          {/* Separator */}
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

          {/* Portfolio selector */}
          <div className="relative" ref={portfolioDropdownRef}>
            <button
              onClick={() => setPortfolioDropdownOpen(!portfolioDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
            >
              <Briefcase className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="text-gray-900 dark:text-white font-medium">
                {portfolios.find((p: any) => p.id === portfolioId)?.name || 'Select portfolio'}
              </span>
              <ChevronDown className={clsx("h-4 w-4 text-gray-400 transition-transform", portfolioDropdownOpen && "rotate-180")} />
            </button>

            {portfolioDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 overflow-hidden">
                {/* Search */}
                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      ref={portfolioSearchRef}
                      type="text"
                      value={portfolioSearch}
                      onChange={e => setPortfolioSearch(e.target.value)}
                      placeholder="Search portfolios..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
                {/* List */}
                <div className="max-h-64 overflow-y-auto">
                  {filteredPortfolios.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">No portfolios found</div>
                  ) : (
                    filteredPortfolios.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPortfolioId(p.id)
                          setPortfolioDropdownOpen(false)
                          setPortfolioSearch('')
                        }}
                        className={clsx(
                          "w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors",
                          p.id === portfolioId
                            ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                            : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        )}
                      >
                        <Briefcase className={clsx("h-4 w-4 flex-shrink-0", p.id === portfolioId ? "text-primary-500" : "text-gray-400")} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{p.name}</div>
                          {p.portfolio_id && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{p.portfolio_id}</div>
                          )}
                        </div>
                        {p.id === portfolioId && <Check className="h-4 w-4 text-primary-500 flex-shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Separator */}
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

          {/* View toggle — Batches first because it's the default
              (reading surface), Trades second (operations surface). */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => setView('batches')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                view === 'batches'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              Batches
            </button>
            <button
              onClick={() => setView('trades')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                view === 'trades'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <List className="w-3.5 h-3.5" />
              Trades
            </button>
          </div>
        </div>
      </div>

      {/* Pilot next-step nudge: once outcomes has unlocked (user has at
          least one committed trade visible on this page), prompt them to
          move on to Outcomes. Gated on pilot mode so non-pilots never see
          it. Dismissible per-user. */}
      {pilotMode.effectiveIsPilot && hasUnlockedOutcomes && trades && trades.length > 0 && (
        <PilotTradeBookGetStarted
          userId={user?.id}
          orgId={currentOrgId}
          onOpenOutcomes={() => {
            window.dispatchEvent(
              new CustomEvent('decision-engine-action', {
                detail: { id: 'outcomes', title: 'Outcomes', type: 'outcomes', data: null },
              }),
            )
          }}
        />
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading ? (
          <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-400">Loading…</p>
            </div>
          </div>
        ) : view === 'batches' ? (
          <BatchListView
            batches={batches}
            trades={trades}
            selectedBatchId={selectedBatchId}
            onSelectBatch={handleSelectBatch}
            onViewBatchTrades={handleViewBatchTrades}
            onAddComment={handleAddComment}
          />
        ) : (
          <AcceptedTradesTable
            trades={trades}
            batches={batches}
            initialSearchQuery={pendingTradesSearch}
            holdingsSource={(portfolios.find((p: any) => p.id === portfolioId) as any)?.holdings_source}
            pairInfoByAsset={pairInfoByAsset}
            onUpdateExecutionStatus={handleUpdateExecutionStatus}
            onUpdateSizing={handleUpdateSizing}
            onRevert={handleRevert}
            onCreateCorrection={handleCreateCorrection}
            onAddComment={handleAddComment}
            onOpenBatch={(batchId) => {
              setSelectedBatchId(batchId)
              setPendingTradesSearch(null)
              setView('batches')
            }}
            canEdit={canEdit}
            canUpdateExecution={canUpdateExecution}
            canRevert={canRevert}
          />
        )}
      </div>
    </div>
  )
}
