/**
 * PilotActionDashboard — multi-thread pilot workspace dashboard.
 *
 * Product direction: the dashboard answers "what needs my attention
 * across the decision system right now?" — not "complete the AAPL
 * tutorial." The staged AAPL scenario appears as one actionable item
 * among several live workstreams, never as the whole page.
 *
 * Layout:
 *   ┌──────────────────────────── Header ─────────────────────────────┐
 *   │ What needs attention (main, left)     │ Feedback loop (right)   │
 *   │                                       │ Start a new idea        │
 *   │ Pipeline overview                     │ System loop             │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * State awareness:
 *   - usePilotScenarioStatus resolves the scenario's lifecycle
 *     (pending / completed / reviewed) via trade_queue_item_id ↔
 *     accepted_trades. The AAPL attention item swaps between
 *     "Increase AAPL position" (pending) and "Review AAPL outcome"
 *     (committed without review). Once reviewed, AAPL drops out of
 *     the attention queue entirely and the next pipeline item moves up.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  ArrowRight, Workflow, Target, Beaker, BookOpen,
  CheckCircle2, Plus, Lightbulb, AlertCircle, MessageSquare, Search, FileText,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { usePilotProgress } from '../../hooks/usePilotProgress'
import { usePilotScenarioStatus, type PilotScenarioState } from '../../hooks/usePilotScenarioStatus'

interface PilotActionDashboardProps {
  onOpenTradeLab: (scenarioContext?: { scenarioId?: string; tradeQueueItemId?: string }) => void
  onOpenIdeaPipeline: () => void
  onOpenTradeBook: () => void
  onOpenOutcomes: () => void
}

// ── Attention-item model ─────────────────────────────────────────
// One row in the "What needs attention" list. Kept internal; the
// card renders badge + title + meta + supporting text + CTA.
type AttentionBadge =
  | 'Review due' | 'Ready for decision'
  | 'Thesis forming' | 'Researching' | 'New signal'

interface AttentionItem {
  id: string
  badge: AttentionBadge
  title: string
  /** "Why this is next" line — the reason the system surfaced
   *  this row. Reads like a sentence fragment (e.g. "One step
   *  away from a formal recommendation"). */
  why: string
  meta?: string | null
  ctaLabel: string
  onClick: () => void
  tone: 'emerald' | 'primary' | 'amber' | 'slate'
  /** Sort priority — lower fires first. */
  priority: number
}

const STAGE_PRIORITY: Record<string, number> = {
  ready_for_decision: 0,
  thesis_forming: 1,
  deep_research: 2,
  investigate: 3,
  aware: 4,
}

const STAGE_LABEL: Record<string, string> = {
  ready_for_decision: 'Ready for decision',
  thesis_forming: 'Thesis forming',
  deep_research: 'Researching',
  investigate: 'Researching',
  aware: 'New signal',
}

const STAGE_VERB: Record<string, (sym: string) => string> = {
  ready_for_decision: (sym) => `${sym} ready for decision`,
  thesis_forming:     (sym) => `Advance ${sym} thesis`,
  deep_research:      (sym) => `Validate ${sym} assumptions`,
  investigate:        (sym) => `Continue ${sym} investigation`,
  aware:              (sym) => `Triage ${sym} signal`,
}

export function PilotActionDashboard({
  onOpenTradeLab,
  onOpenIdeaPipeline,
  onOpenTradeBook,
  onOpenOutcomes,
}: PilotActionDashboardProps) {
  const { user } = useAuth()
  const { currentOrganization } = useOrganization()
  const { scenario, state, acceptedTrade, committedAt, hasReview } = usePilotScenarioStatus()
  const { hasUnlockedTradeBook, hasUnlockedOutcomes } = usePilotProgress()

  // Scenario symbol — resolved early because several downstream
  // memos (closestToDecision, attentionItems) reference it.
  const sym = scenario?.asset?.symbol || scenario?.symbol || 'AAPL'

  // Pipeline items — drives attention queue + pipeline overview.
  // Scoped to the pilot portfolio (or scenario portfolio) so rows
  // from unrelated portfolios don't inflate the count. Status is
  // filtered to in-flight states; executed/archived rows are out.
  const pilotPortfolioId = scenario?.portfolio_id ?? null
  const { data: pipelineItems, isLoading: pipelineLoading } = useQuery({
    queryKey: ['pilot-dashboard-pipeline-items', currentOrganization?.id, pilotPortfolioId],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      let q = supabase
        .from('trade_queue_items')
        .select('id, stage, status, asset:assets(symbol, company_name), created_at, stage_changed_at, origin_metadata')
        .eq('visibility_tier', 'active')
        .in('status', ['idea', 'discussing', 'simulating', 'deciding'])
        .order('created_at', { ascending: false })
        .limit(50)
      if (pilotPortfolioId) q = q.eq('portfolio_id', pilotPortfolioId)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as Array<{
        id: string
        stage: string
        status: string
        asset: { symbol: string | null; company_name: string | null } | null
        created_at: string
        stage_changed_at: string | null
        origin_metadata: Record<string, unknown> | null
      }>
    },
    staleTime: 30_000,
  })

  // Stage counts — derived directly from the query. No
  // scenario-exclusion trick; the attention queue handles AAPL
  // dedup via symbol so we don't need to subtract it from counts.
  const pipelineCounts = useMemo(() => {
    const items = pipelineItems || []
    return {
      total: items.length,
      aware: items.filter(r => r.stage === 'aware').length,
      investigate: items.filter(r => r.stage === 'investigate').length,
      deepResearch: items.filter(r => r.stage === 'deep_research').length,
      thesisForming: items.filter(r => r.stage === 'thesis_forming').length,
      readyForDecision: items.filter(r => r.stage === 'ready_for_decision').length,
    }
  }, [pipelineItems])

  // Closest-to-decision — top item by stage priority. Once AAPL is
  // committed we skip any row for the same asset so the callout
  // surfaces the NEXT pipeline idea, not the already-decided one.
  // System Loop progress signals — both derived from pipelineItems
  // so the loop reflects what the user has actually done.
  //   hasUserIdea — at least one non-pilot-seed idea exists
  //   hasMovedIdea — any item has been moved (stage_changed_at >
  //                  created_at by more than a second). A small
  //                  buffer avoids false positives from inserts
  //                  whose triggers set stage_changed_at = NOW()
  //                  alongside created_at.
  const hasUserIdea = useMemo(() => {
    return (pipelineItems || []).some(i => !(i.origin_metadata as any)?.pilot_seed)
  }, [pipelineItems])
  const hasMovedIdea = useMemo(() => {
    return (pipelineItems || []).some(i => {
      if (!i.stage_changed_at) return false
      const moved = new Date(i.stage_changed_at).getTime()
      const created = new Date(i.created_at).getTime()
      return Number.isFinite(moved) && Number.isFinite(created) && moved - created > 1000
    })
  }, [pipelineItems])

  const closestToDecision = useMemo(() => {
    const items = (pipelineItems || []).slice()
    items.sort((a, b) => (STAGE_PRIORITY[a.stage] ?? 99) - (STAGE_PRIORITY[b.stage] ?? 99))
    const skipSym = state === 'completed' ? sym.toUpperCase() : null
    const top = items.find(i => !skipSym || (i.asset?.symbol || '').toUpperCase() !== skipSym)
    if (!top || !top.asset?.symbol) return null
    return { symbol: top.asset.symbol, stage: top.stage, label: STAGE_LABEL[top.stage] || top.stage }
  }, [pipelineItems, state, sym])

  // Bottleneck — oldest row still in an early stage (aware or
  // investigate). A pilot who commits AAPL and never touches
  // research can see this nudging them back into the pipeline.
  const bottleneck = useMemo(() => {
    const items = (pipelineItems || []).filter(i =>
      i.stage === 'aware' || i.stage === 'investigate'
    )
    if (items.length === 0) return null
    items.sort((a, b) => {
      const da = new Date(a.stage_changed_at || a.created_at).getTime()
      const db = new Date(b.stage_changed_at || b.created_at).getTime()
      return da - db
    })
    const top = items[0]
    if (!top.asset?.symbol) return null
    return {
      symbol: top.asset.symbol,
      hint: top.stage === 'aware' ? 'needs triage' : 'needs research',
    }
  }, [pipelineItems])

  // Feedback counts — total decisions + awaiting review across the org.
  const { data: feedbackCounts } = useQuery({
    queryKey: ['pilot-dashboard-feedback-counts', currentOrganization?.id, user?.id, acceptedTrade?.id, hasReview],
    enabled: !!currentOrganization?.id && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accepted_trades')
        .select('id, portfolio:portfolios!inner(organization_id)')
        .eq('portfolio.organization_id', currentOrganization!.id)
      if (error) throw error
      const ids = (data || []).map(r => r.id as string)
      if (ids.length === 0) return { decisions: 0, awaitingReview: 0, reviewed: 0 }
      const { data: reviews } = await supabase
        .from('decision_reviews')
        .select('decision_id, thesis_played_out, process_note')
        .in('decision_id', ids)
      const reviewedIds = new Set(
        (reviews || [])
          .filter(r => r.thesis_played_out || (r.process_note || '').trim())
          .map(r => r.decision_id as string),
      )
      return {
        decisions: ids.length,
        awaitingReview: ids.length - reviewedIds.size,
        reviewed: reviewedIds.size,
      }
    },
    staleTime: 15_000,
  })

  const scenarioContext = useMemo(() => {
    if (!scenario) return undefined
    return {
      scenarioId: scenario.id,
      tradeQueueItemId: scenario.trade_queue_item_id ?? undefined,
    }
  }, [scenario])

  const sizingLine = useMemo(() => {
    const target = acceptedTrade?.target_weight ?? scenario?.target_weight_pct ?? null
    const delta = acceptedTrade?.delta_weight ?? scenario?.delta_weight_pct ?? null
    if (target != null && delta != null) {
      const before = target - delta
      return `${before.toFixed(1)}% → ${target.toFixed(1)}%`
    }
    if (scenario?.proposed_sizing_input) return scenario.proposed_sizing_input
    return null
  }, [acceptedTrade, scenario])

  const actionVerb = useMemo(() => {
    const raw = String(scenario?.proposed_action || acceptedTrade?.action || '').toLowerCase()
    if (raw === 'add' || raw === 'buy' || raw === 'initiate' || raw === 'increase') return 'Increase'
    if (raw === 'trim' || raw === 'sell' || raw === 'exit' || raw === 'reduce') return 'Reduce'
    return 'Adjust'
  }, [scenario?.proposed_action, acceptedTrade?.action])

  const committedLabel = useMemo(() => {
    if (!committedAt) return null
    try {
      const ms = Date.now() - new Date(committedAt).getTime()
      if (ms < 24 * 60 * 60 * 1000) return 'Decision recorded today'
      if (ms < 7 * 24 * 60 * 60 * 1000) return `Decision recorded ${formatDistanceToNow(new Date(committedAt), { addSuffix: true })}`
      return `Decision recorded ${format(new Date(committedAt), 'MMM d, yyyy')}`
    } catch {
      return null
    }
  }, [committedAt])

  // ── Build the attention queue ────────────────────────────────
  // Order of assembly:
  //   1. Review AAPL (when committed but no review)
  //   2. AAPL ready for decision (pending)
  //   3. Top pipeline items by stage priority
  const attentionItems = useMemo((): AttentionItem[] => {
    const items: AttentionItem[] = []

    // AAPL — pending OR review-due states.
    if (state === 'completed' && !hasReview) {
      items.push({
        id: `aapl-review`,
        badge: 'Review due',
        title: `Review ${sym} outcome`,
        why: 'Decision recorded — capture what worked and what changed.',
        meta: committedLabel ?? 'Decision recorded',
        ctaLabel: hasUnlockedOutcomes ? 'Review outcome' : 'View in Trade Book',
        onClick: hasUnlockedOutcomes ? onOpenOutcomes : onOpenTradeBook,
        tone: 'emerald',
        priority: 0,
      })
    } else if (state === 'pending' && scenario) {
      items.push({
        id: `aapl-pending`,
        badge: 'Ready for decision',
        title: `${actionVerb} ${sym} position`,
        why: scenario.why_now || 'Recommendation is ready — simulate and commit in Trade Lab.',
        meta: sizingLine,
        ctaLabel: 'Open in Trade Lab',
        onClick: () => onOpenTradeLab(scenarioContext),
        tone: 'primary',
        priority: 0,
      })
    }

    // Pipeline — take the top N items by stage priority, dedup by
    // symbol. Stage-specific "why this is next" copy so each row
    // tells the user what the system is asking them to do.
    const stageWhy: Record<string, string> = {
      ready_for_decision: 'Simulate the sizing and commit a decision.',
      thesis_forming:     'One step away from a formal recommendation.',
      deep_research:      'Model and assumptions need to be pressure-tested.',
      investigate:        'Validate the core drivers before it can move toward thesis.',
      aware:              'Fresh signal — decide whether to start research.',
    }
    const stageTitleOverride: Record<string, (sym: string) => string> = {
      ready_for_decision: (s) => `Review ${s} recommendation`,
    }
    const seenSymbols = new Set<string>([sym])
    const sortedPipeline = (pipelineItems || []).slice().sort(
      (a, b) => (STAGE_PRIORITY[a.stage] ?? 99) - (STAGE_PRIORITY[b.stage] ?? 99)
    )
    let pipelineAdded = 0
    for (const p of sortedPipeline) {
      if (pipelineAdded >= 3) break
      if (!p.asset?.symbol) continue
      if (seenSymbols.has(p.asset.symbol)) continue
      seenSymbols.add(p.asset.symbol)
      const label = STAGE_LABEL[p.stage] as AttentionBadge | undefined
      const defaultTitleBuilder = STAGE_VERB[p.stage]
      const overrideBuilder = stageTitleOverride[p.stage]
      const titleBuilder = overrideBuilder || defaultTitleBuilder
      if (!label || !titleBuilder) continue
      const stagePri = STAGE_PRIORITY[p.stage] ?? 99
      const tone: AttentionItem['tone'] =
        p.stage === 'ready_for_decision' ? 'primary'
        : p.stage === 'thesis_forming' ? 'amber'
        : 'slate'
      items.push({
        id: `pipe-${p.id}`,
        badge: label,
        title: titleBuilder(p.asset.symbol),
        why: stageWhy[p.stage] || 'Keep this idea moving through the pipeline.',
        meta: p.asset.company_name || null,
        ctaLabel: p.stage === 'ready_for_decision' ? 'Open in Trade Lab' : 'View in Pipeline',
        onClick: p.stage === 'ready_for_decision' ? () => onOpenTradeLab() : onOpenIdeaPipeline,
        tone,
        priority: 1 + stagePri,
      })
      pipelineAdded++
    }

    items.sort((a, b) => a.priority - b.priority)
    return items.slice(0, 4)
  }, [
    state, hasReview, scenario, sym, committedLabel, hasUnlockedOutcomes,
    onOpenOutcomes, onOpenTradeBook, actionVerb, sizingLine, scenarioContext,
    onOpenTradeLab, pipelineItems, onOpenIdeaPipeline,
  ])

  // Header subtitle — action-framed, not explanatory. Reads the
  // dashboard as a control center: "start with the highest-priority
  // item, or keep ideas moving through the pipeline."
  const headerSubtitle = useMemo(() => {
    if (state === 'seeding') return 'Your pilot workspace is being prepared.'
    return 'Tesseract prioritizes ideas, decisions, and reviews so you know what to work on next.'
  }, [state])

  // "Create idea" handler — opens the right-hand capture sidebar
  // (same pane the lightbulb icon in the header opens) pre-focused
  // on the trade-idea capture form. This reuses the existing
  // openThoughtsCapture event Layout already listens for, so no
  // new routing is needed.
  const handleCreateIdea = () => {
    try {
      window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
        detail: { captureType: 'trade_idea' },
      }))
    } catch {
      onOpenIdeaPipeline()
    }
  }

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        {/* ── Header — action-framed, not explanatory. Header CTA
            removed — capturing a new idea now lives inside the
            System Loop's "Capture" stage so the page header stays
            focused on the attention queue. */}
        <div className="space-y-0.5">
          <h1 className="text-[20px] font-semibold text-gray-900 dark:text-white leading-tight">
            What needs your attention
          </h1>
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-snug">
            {headerSubtitle}
          </p>
          <p className="text-[11px] text-gray-500 leading-snug">
            Start with the highest-priority item, or jump into the pipeline to keep ideas moving.
          </p>
        </div>

        {/* ── System Loop — full-width strip across the top so the
            mental model is visible before any of the operational
            tiles. Stages are clickable; each one reveals a short
            explainer + jump CTA below. */}
        <SystemLoopCard
          state={state}
          hasReview={hasReview}
          hasUserIdea={hasUserIdea}
          hasMovedIdea={hasMovedIdea}
          onOpenTradeLab={() => onOpenTradeLab(scenarioContext)}
          onOpenIdeaPipeline={onOpenIdeaPipeline}
          onOpenTradeBook={onOpenTradeBook}
          onOpenOutcomes={onOpenOutcomes}
        />

        {/* ── Main grid — attention + pipeline lead; right rail
            carries outcomes and the Create-idea reminder. */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-3 space-y-4">
            <AttentionSection
              items={attentionItems}
              loading={state === 'loading' || state === 'seeding' || pipelineLoading}
            />
            <PipelineOverview
              counts={pipelineCounts}
              loading={pipelineLoading}
              closestToDecision={closestToDecision}
              bottleneck={bottleneck}
              onOpen={onOpenIdeaPipeline}
            />
          </div>
          <div className="md:col-span-2 space-y-4">
            <OutcomesSection
              feedbackCounts={feedbackCounts ?? null}
              hasReview={hasReview}
              hasUnlockedTradeBook={hasUnlockedTradeBook}
              hasUnlockedOutcomes={hasUnlockedOutcomes}
              onOpenTradeBook={onOpenTradeBook}
              onOpenOutcomes={onOpenOutcomes}
              onOpenTradeLab={() => onOpenTradeLab(scenarioContext)}
            />
            <StartNewIdeaCard onCreateIdea={handleCreateIdea} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── What needs attention ─────────────────────────────────────────

function AttentionSection({ items, loading }: { items: AttentionItem[]; loading: boolean }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white leading-tight">
            Attention queue
          </h2>
          <p className="text-[10px] text-gray-500 leading-tight">
            Prioritized by readiness, pending reviews, and stalled research.
          </p>
        </div>
        {items.length > 0 && (
          <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-2 pt-1">
          {/* Skeleton rows — never show a dead "0 active" state
              while queries are still resolving. */}
          {[0, 1, 2].map(i => (
            <div key={i} className="animate-pulse flex items-start gap-3 py-2.5">
              <div className="flex-1 space-y-1.5">
                <div className="h-2 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-3 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-2 w-56 bg-gray-100 dark:bg-gray-800 rounded" />
              </div>
              <div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          ))}
          <p className="text-[10px] text-gray-400 italic text-center pt-0.5">Preparing your pilot workspace…</p>
        </div>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic">All caught up — nothing in the attention queue.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {items.map(item => (
            <AttentionRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const badgeTone = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    primary: 'bg-primary-50 text-primary-700 border-primary-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
    slate:   'bg-slate-50 text-slate-700 border-slate-200',
  }[item.tone]
  const ctaTone = {
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    primary: 'border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100',
    amber:   'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
    slate:   'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
  }[item.tone]
  const BadgeIcon = item.badge === 'Review due' ? MessageSquare
    : item.badge === 'Ready for decision' ? Beaker
    : item.badge === 'Thesis forming' ? FileText
    : item.badge === 'Researching' ? Search
    : AlertCircle

  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded border ${badgeTone}`}>
              <BadgeIcon className="w-2.5 h-2.5" />
              {item.badge}
            </span>
            <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white leading-tight">{item.title}</h3>
          </div>
          {/* Why this is next — the single reason the system
              surfaced this row. Reads like a sentence fragment so
              it flows under the title without heavy label chrome. */}
          <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
            <span className="text-gray-400">Why next: </span>
            {item.why}
          </p>
          {item.meta && (
            <div className="text-[10px] text-gray-500 tabular-nums">{item.meta}</div>
          )}
        </div>
        <button
          type="button"
          onClick={item.onClick}
          className={`text-[10px] font-semibold px-2.5 py-1.5 rounded border transition-colors whitespace-nowrap flex-shrink-0 ${ctaTone}`}
        >
          {item.ctaLabel}
        </button>
      </div>
    </div>
  )
}

// ── Pipeline overview ────────────────────────────────────────────

function PipelineOverview({
  counts,
  loading,
  closestToDecision,
  bottleneck,
  onOpen,
}: {
  counts: {
    total: number
    aware: number
    investigate: number
    deepResearch: number
    thesisForming: number
    readyForDecision: number
  }
  loading: boolean
  closestToDecision: { symbol: string; stage: string; label: string } | null
  bottleneck: { symbol: string; hint: string } | null
  onOpen: () => void
}) {
  const showLoading = loading && counts.total === 0
  const showEmpty = !loading && counts.total === 0

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white leading-tight flex items-center gap-1.5">
            <Workflow className="w-3.5 h-3.5 text-slate-600" />
            Pipeline overview
          </h2>
          <p className="text-[10px] text-gray-500 leading-tight">
            Active ideas at every stage of research.
          </p>
        </div>
        {!showLoading && !showEmpty && (
          <span className="text-[10px] text-gray-400 tabular-nums">
            {counts.total} active
          </span>
        )}
      </div>

      {showLoading ? (
        <div className="grid grid-cols-5 gap-2 text-[11px] mt-1">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse rounded-md border border-gray-200 bg-gray-50/60 dark:bg-gray-900/40 dark:border-gray-700 px-2 py-1.5">
              <div className="h-4 w-5 bg-gray-200 dark:bg-gray-700 rounded mx-auto mb-1" />
              <div className="h-1.5 w-12 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <p className="text-[11px] text-gray-400 italic">Pilot ideas are being staged. Refresh in a moment or open the pipeline.</p>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-2 text-[11px] mt-1">
            <StageCol label="Aware" count={counts.aware} />
            <StageCol label="Investigate" count={counts.investigate} />
            <StageCol label="Deep research" count={counts.deepResearch} />
            <StageCol label="Thesis" count={counts.thesisForming} />
            <StageCol label="Ready" count={counts.readyForDecision} highlight />
          </div>
          <div className="mt-2 space-y-0.5">
            {closestToDecision && (
              <div className="text-[11px] text-gray-600 dark:text-gray-300">
                <span className="text-gray-500">Closest to decision:</span>
                <span className="font-semibold text-gray-900 dark:text-white ml-1">
                  {closestToDecision.symbol}
                </span>
                <span className="text-gray-500 ml-1">· {closestToDecision.label}</span>
              </div>
            )}
            {bottleneck && (
              <div className="text-[11px] text-gray-600 dark:text-gray-300">
                <span className="text-gray-500">Bottleneck:</span>
                <span className="font-semibold text-gray-900 dark:text-white ml-1">
                  {bottleneck.symbol}
                </span>
                <span className="text-gray-500 ml-1">· {bottleneck.hint}</span>
              </div>
            )}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onOpen}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[11px] font-semibold hover:border-gray-400 transition-colors"
      >
        View Idea Pipeline
        <ArrowRight className="w-3 h-3" />
      </button>
    </section>
  )
}

function StageCol({ label, count, highlight }: { label: string; count: number; highlight?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 text-center ${
      highlight
        ? 'border-primary-200 bg-primary-50/50'
        : 'border-gray-200 bg-gray-50/60 dark:bg-gray-900/40 dark:border-gray-700'
    }`}>
      <div className={`text-[14px] font-semibold tabular-nums ${
        highlight && count > 0 ? 'text-primary-700' : 'text-gray-900 dark:text-white'
      }`}>
        {count}
      </div>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider leading-tight">{label}</div>
    </div>
  )
}

// ── Outcomes section (replaces the Feedback loop card) ──────────

function OutcomesSection({
  feedbackCounts,
  hasReview,
  hasUnlockedTradeBook,
  hasUnlockedOutcomes,
  onOpenTradeBook,
  onOpenOutcomes,
  onOpenTradeLab,
}: {
  feedbackCounts: { decisions: number; awaitingReview: number; reviewed: number } | null
  hasReview: boolean
  hasUnlockedTradeBook: boolean
  hasUnlockedOutcomes: boolean
  onOpenTradeBook: () => void
  onOpenOutcomes: () => void
  onOpenTradeLab: () => void
}) {
  const decisions = feedbackCounts?.decisions ?? 0
  const awaitingReview = feedbackCounts?.awaitingReview ?? 0
  const reviewed = feedbackCounts?.reviewed ?? 0
  const hasAny = decisions > 0

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white leading-tight flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-emerald-600" />
            Outcomes
          </h2>
          <p className="text-[10px] text-gray-500 leading-tight">
            Track recorded decisions and the reviews they generate.
          </p>
        </div>
      </div>

      {hasAny ? (
        <>
          {/* Three compact metric tiles — the dashboard-y shape the
              previous "feedback loop" copy lacked. */}
          <div className="grid grid-cols-3 gap-2">
            <OutcomeStat label="Recorded" count={decisions} tone="gray" />
            <OutcomeStat label="Awaiting review" count={awaitingReview} tone={awaitingReview > 0 ? 'amber' : 'gray'} />
            <OutcomeStat label="Reviewed" count={reviewed} tone={reviewed > 0 ? 'emerald' : 'gray'} />
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
            {hasReview
              ? 'Learnings captured — use them to refine future ideas.'
              : 'Recorded decisions become evidence for future recommendations.'}
          </p>
          <button
            type="button"
            onClick={hasUnlockedOutcomes ? onOpenOutcomes : onOpenTradeBook}
            disabled={!hasUnlockedTradeBook && !hasUnlockedOutcomes}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11px] font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {hasUnlockedOutcomes
              ? <>Open Outcomes <ArrowRight className="w-3 h-3" /></>
              : <><BookOpen className="w-3 h-3" /> Open Trade Book</>}
          </button>
        </>
      ) : (
        <>
          <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-3 text-center space-y-0.5">
            <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">No decisions recorded yet</div>
            <p className="text-[10px] text-gray-500">
              Once you commit a decision it shows up here with price, review, and learning data.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenTradeLab}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 text-[11px] font-semibold transition-colors"
          >
            <Beaker className="w-3 h-3" /> Open Trade Lab
          </button>
        </>
      )}
    </section>
  )
}

function OutcomeStat({ label, count, tone }: { label: string; count: number; tone: 'gray' | 'amber' | 'emerald' }) {
  const toneMap = {
    gray:    'border-gray-200 bg-gray-50/60 text-gray-900 dark:text-white',
    amber:   'border-amber-200 bg-amber-50 text-amber-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  }[tone]
  return (
    <div className={`rounded-md border ${toneMap} px-2 py-2 text-center`}>
      <div className="text-[16px] font-semibold tabular-nums">{count}</div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500 leading-tight">{label}</div>
    </div>
  )
}

// ── Legacy helper (kept around in case other callers exist) ─────

function StartNewIdeaCard({ onCreateIdea }: { onCreateIdea: () => void }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-amber-50 border border-amber-100 flex items-center justify-center">
          <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-gray-900 dark:text-white leading-tight">
            Start a new idea
          </div>
          <div className="text-[10px] text-gray-500 leading-tight">
            Capture a new opportunity and move it through the pipeline.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onCreateIdea}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-[11px] font-semibold transition-colors"
      >
        <Plus className="w-3 h-3" /> Create idea
      </button>
    </section>
  )
}

// ── System loop — prominent full-width strip with clickable stages
// Clicking a stage reveals a one-line explanation of what the pilot
// can do at that step, plus a jump CTA to the relevant surface.
// The active stage is emphasised; past stages show a subtle check;
// future stages stay neutral. No flashy treatment.

type SystemLoopStageKey =
  | 'capture' | 'develop' | 'decide' | 'record' | 'review' | 'improve'

interface SystemLoopStage {
  key: SystemLoopStageKey
  label: string
  /** Short explainer for the expanded panel. */
  explainer: string
  /** CTA the pilot can act on for this stage. */
  cta?: { label: string; run: () => void }
}

function SystemLoopCard({
  state,
  hasReview,
  hasUserIdea,
  hasMovedIdea,
  onOpenTradeLab,
  onOpenIdeaPipeline,
  onOpenTradeBook,
  onOpenOutcomes,
}: {
  state: PilotScenarioState
  hasReview: boolean
  /** User has captured at least one of their own ideas. */
  hasUserIdea: boolean
  /** Any idea in the org has been moved through the kanban
   *  (stage_changed_at meaningfully later than created_at). */
  hasMovedIdea: boolean
  onOpenTradeLab: () => void
  onOpenIdeaPipeline: () => void
  onOpenTradeBook: () => void
  onOpenOutcomes: () => void
}) {
  // Step completion reflects the USER's actions, not the seed's.
  // Stages independently turn green when their condition fires —
  // not strictly sequential, since a pilot might commit AAPL
  // before ever capturing their own idea or moving the kanban.
  //   1. Capture  → user has logged at least one of their own ideas
  //   2. Develop  → user has moved any idea through the kanban
  //   3. Decide   → committed
  //   4. Record   → committed (Trade Lab commits + records together)
  //   5. Review   → reflection saved
  //   6. Improve  → future / active once Review is complete
  const completed = state === 'completed'
  const stepDone: boolean[] = [
    hasUserIdea,           // 1. Capture
    hasMovedIdea,          // 2. Develop
    completed,             // 3. Decide
    completed,             // 4. Record
    completed && hasReview, // 5. Review
    false,                 // 6. Improve (always future)
  ]
  // Steps-done count for downstream "next active" computation —
  // first non-done index is the active step (or "Improve" once all
  // 5 prior steps are done).
  const activeIdx = (() => {
    const firstUndone = stepDone.findIndex(d => !d)
    if (firstUndone === -1) return 5 // all done → Improve active
    // If literally nothing is done yet, jump straight to Decide as
    // the active cue since the staged scenario is queued there.
    if (!stepDone.some(d => d)) return 2
    return firstUndone
  })()

  const stages: SystemLoopStage[] = [
    {
      key: 'capture',
      label: 'Capture',
      explainer: 'Log a new opportunity as an idea. Ideas start here before they get any research.',
      cta: {
        label: 'Start a new idea',
        run: () => {
          // Match the dashboard's "Start a new idea" CTA — opens the
          // right-hand capture sidebar pre-focused on the trade-idea
          // form, instead of just routing to the pipeline.
          try {
            window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
              detail: { captureType: 'trade_idea' },
            }))
          } catch {
            onOpenIdeaPipeline()
          }
        },
      },
    },
    {
      key: 'develop',
      label: 'Develop',
      explainer: 'Move ideas through investigation, deep research, and thesis forming as they mature.',
      cta: { label: 'Open Idea Pipeline', run: onOpenIdeaPipeline },
    },
    {
      key: 'decide',
      label: 'Decide',
      explainer: 'Open the staged recommendation in Trade Lab to simulate sizing and commit the decision.',
      cta: { label: 'Open Trade Lab', run: onOpenTradeLab },
    },
    {
      key: 'record',
      label: 'Record',
      explainer: 'Committing in Trade Lab writes the decision to the Trade Book — the system of record.',
      cta: { label: 'Open Trade Book', run: onOpenTradeBook },
    },
    {
      key: 'review',
      label: 'Review',
      explainer: 'Outcomes interprets the result and asks you to reflect on whether the thesis played out.',
      cta: { label: 'Open Outcomes', run: onOpenOutcomes },
    },
    {
      key: 'improve',
      label: 'Improve',
      explainer: 'Captured reflections become evidence for future ideas and recommendations.',
      cta: { label: 'Open Outcomes', run: onOpenOutcomes },
    },
  ]

  // Open stage state — default to the active step so the panel
  // immediately surfaces the "what to do now" copy. User can click
  // any stage to replace the panel contents.
  const [openKey, setOpenKey] = useState<SystemLoopStageKey>(stages[activeIdx]?.key ?? 'decide')
  const openStage = stages.find(s => s.key === openKey) ?? stages[activeIdx]

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-1 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white leading-tight flex items-center gap-1.5">
            <Workflow className="w-3.5 h-3.5 text-slate-600" />
            System loop
          </h2>
          <p className="text-[10px] text-gray-500 leading-tight">
            How ideas become decisions and decisions become learnings.
          </p>
        </div>
        <span className="text-[10px] text-gray-400">Click a stage to learn more</span>
      </div>

      {/* Stage strip — buttons sit side-by-side, equal weight, with
          quiet arrows between them. */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div className="grid grid-cols-6 gap-1 items-stretch">
          {stages.map((s, i) => {
            const done = stepDone[i]
            const active = i === activeIdx && !done
            const isOpen = s.key === openKey
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setOpenKey(s.key)}
                className={`group rounded-md border px-2 py-2 text-center transition-colors ${
                  isOpen
                    ? 'border-primary-300 bg-primary-50/60'
                    : active
                      ? 'border-primary-200 bg-primary-50/30 hover:bg-primary-50'
                      : done
                        ? 'border-gray-200 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/40 dark:border-gray-700'
                        : 'border-gray-200 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  {done ? (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                    </span>
                  ) : (
                    <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold tabular-nums ${
                      active
                        ? 'bg-primary-100 border border-primary-200 text-primary-700'
                        : 'bg-gray-100 border border-gray-200 text-gray-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300'
                    }`}>
                      {i + 1}
                    </span>
                  )}
                </div>
                <div className={`text-[11px] font-semibold leading-tight ${
                  isOpen
                    ? 'text-primary-800'
                    : active
                      ? 'text-gray-900 dark:text-white'
                      : done
                        ? 'text-gray-500'
                        : 'text-gray-600 dark:text-gray-300'
                }`}>
                  {s.label}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Explainer panel — updates when a stage is clicked. */}
      <div className="px-4 py-3 flex items-start justify-between gap-3 bg-gray-50/40 dark:bg-gray-900/30">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">
            {openStage.label}
          </div>
          <p className="text-[12px] text-gray-700 dark:text-gray-200 leading-snug">
            {openStage.explainer}
          </p>
        </div>
        {openStage.cta && (
          <button
            type="button"
            onClick={openStage.cta.run}
            className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[11px] font-semibold hover:border-gray-400 transition-colors whitespace-nowrap"
          >
            {openStage.cta.label} <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </section>
  )
}
