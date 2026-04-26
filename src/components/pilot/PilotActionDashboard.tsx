/**
 * PilotActionDashboard — System Loop is the dashboard.
 *
 * Pilots learn the product by following the closed loop —
 * Capture → Develop → Decide → Record → Review → Improve. The
 * dashboard surfaces that loop as a single, focused control
 * surface. The active stage (the one the user needs to act on
 * next) pulses; every stage is freely clickable so a curious
 * pilot can preview later stages without having to complete
 * earlier ones first.
 *
 * Selecting a stage swaps the body underneath the strip:
 *   - Stage description (bold, prominent)
 *   - A colored, primary-action CTA
 *   - Attention items for that stage — the actual rows the user
 *     should be looking at right now (their ideas, pipeline items,
 *     pending recommendations, recorded decisions, etc.)
 *
 * The dashboard intentionally drops the previous attention queue,
 * pipeline overview, outcomes summary, and "Start a new idea"
 * card — that information now lives inside the loop where the
 * user is currently looking.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  ArrowRight, Workflow, CheckCircle2, Lightbulb, FileText,
  ListChecks, Beaker, BookOpen, Sparkles, Plus, Lock,
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

// ── Stage definitions ─────────────────────────────────────────────

type StageKey = 'capture' | 'develop' | 'decide' | 'review' | 'analyze'

interface StageMeta {
  key: StageKey
  label: string
  /** Bold, single-sentence "what this stage is for" — surfaced in
   *  the body when the stage is selected so the pilot reads exactly
   *  what they're supposed to do here. */
  description: string
  icon: React.ElementType
  /** Tailwind class name for the stage's accent color used on the
   *  CTA, the active ring, and the icon halo. */
  accent: 'amber' | 'sky' | 'primary' | 'violet' | 'emerald' | 'teal'
}

const STAGES: StageMeta[] = [
  {
    key: 'capture',
    label: 'Capture',
    description: 'Log a new idea. Every trade thesis starts here as a quick note before any research.',
    icon: Lightbulb,
    accent: 'amber',
  },
  {
    key: 'develop',
    label: 'Develop',
    description: 'Move ideas through investigate, research, and thesis-forming as conviction builds.',
    icon: ListChecks,
    accent: 'sky',
  },
  {
    key: 'decide',
    label: 'Decide',
    description: 'Open recommendations in Trade Lab, simulate sizing, and commit the decision.',
    icon: Beaker,
    accent: 'primary',
  },
  {
    key: 'review',
    label: 'Review',
    description: 'See the committed decision land on the Trade Book — your system of record for every trade.',
    icon: BookOpen,
    accent: 'violet',
  },
  {
    key: 'analyze',
    label: 'Analyze',
    description: 'Reflect on whether the thesis played out — Outcomes turns those reflections into evidence for sharper future ideas.',
    icon: Sparkles,
    accent: 'emerald',
  },
]

// Tailwind class lookups — pre-built so the JIT picker keeps them.
const ACCENT_CTA: Record<StageMeta['accent'], string> = {
  amber:   'bg-amber-500 hover:bg-amber-600 text-white shadow-sm',
  sky:     'bg-sky-500 hover:bg-sky-600 text-white shadow-sm',
  primary: 'bg-primary-500 hover:bg-primary-600 text-white shadow-sm',
  violet:  'bg-violet-500 hover:bg-violet-600 text-white shadow-sm',
  emerald: 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm',
  teal:    'bg-teal-500 hover:bg-teal-600 text-white shadow-sm',
}

const ACCENT_RING: Record<StageMeta['accent'], string> = {
  amber:   'ring-amber-300/60 bg-amber-50/70 border-amber-300',
  sky:     'ring-sky-300/60 bg-sky-50/70 border-sky-300',
  primary: 'ring-primary-300/60 bg-primary-50/70 border-primary-300',
  violet:  'ring-violet-300/60 bg-violet-50/70 border-violet-300',
  emerald: 'ring-emerald-300/60 bg-emerald-50/70 border-emerald-300',
  teal:    'ring-teal-300/60 bg-teal-50/70 border-teal-300',
}

const ACCENT_OPEN: Record<StageMeta['accent'], string> = {
  amber:   'border-amber-400 bg-amber-50 text-amber-900',
  sky:     'border-sky-400 bg-sky-50 text-sky-900',
  primary: 'border-primary-400 bg-primary-50 text-primary-900',
  violet:  'border-violet-400 bg-violet-50 text-violet-900',
  emerald: 'border-emerald-400 bg-emerald-50 text-emerald-900',
  teal:    'border-teal-400 bg-teal-50 text-teal-900',
}

const ACCENT_ICON_BG: Record<StageMeta['accent'], string> = {
  amber:   'bg-amber-100 text-amber-700',
  sky:     'bg-sky-100 text-sky-700',
  primary: 'bg-primary-100 text-primary-700',
  violet:  'bg-violet-100 text-violet-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  teal:    'bg-teal-100 text-teal-700',
}

const PIPELINE_STAGE_ORDER = ['aware', 'investigate', 'deep_research', 'thesis_forming', 'ready_for_decision'] as const
const PIPELINE_STAGE_LABEL: Record<string, string> = {
  aware: 'Aware',
  investigate: 'Investigate',
  deep_research: 'Deep research',
  thesis_forming: 'Thesis forming',
  ready_for_decision: 'Ready for decision',
}

export function PilotActionDashboard({
  onOpenTradeLab,
  onOpenIdeaPipeline,
  onOpenTradeBook,
  onOpenOutcomes,
}: PilotActionDashboardProps) {
  const { user } = useAuth()
  const { currentOrg } = useOrganization()
  const queryClient = useQueryClient()
  const { scenario, state, acceptedTrade, committedAt, hasReview } = usePilotScenarioStatus()
  const { hasUnlockedTradeBook, hasUnlockedOutcomes } = usePilotProgress()

  // Listen for cross-component refresh signals (e.g., user submitted a
  // trade idea in the right-hand capture sidebar). Without this, the
  // System Loop's "stage 1 done?" check would lag behind the database
  // until the next manual refresh.
  useEffect(() => {
    const handler = () => {
      queryClient.refetchQueries({ queryKey: ['trade-queue-items'] })
      queryClient.refetchQueries({ queryKey: ['pilot-dashboard-recorded'] })
    }
    window.addEventListener('pilot-loop:refresh', handler)
    return () => window.removeEventListener('pilot-loop:refresh', handler)
  }, [queryClient])

  // Realtime subscription to trade_queue_items inserts/updates — gives
  // the dashboard a database-driven refresh path that doesn't depend on
  // any specific component being mounted at submit time. Belt-and-
  // suspenders alongside the React Query invalidations.
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`pilot-dashboard-tqi-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_queue_items' },
        () => {
          // Tiny delay so the insert is fully visible to readers before
          // we refetch (avoids race against postgres replica lag).
          setTimeout(() => {
            queryClient.refetchQueries({ queryKey: ['trade-queue-items'] })
          }, 300)
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, queryClient])

  // Pilot scenario context — passed when opening Trade Lab so the
  // recommendation card highlights immediately.
  const scenarioContext = useMemo(() => {
    if (!scenario) return undefined
    return {
      scenarioId: scenario.id,
      tradeQueueItemId: scenario.trade_queue_item_id ?? undefined,
    }
  }, [scenario])

  const pilotPortfolioId = scenario?.portfolio_id ?? null

  // ── Pipeline items (fuels Capture/Develop/Decide attention lists) ──
  const { data: pipelineItems, isLoading: pipelineLoading } = useQuery({
    // Sharing the `trade-queue-items` prefix means every place in the
    // app that invalidates that key (QuickTradeIdeaCapture, the
    // pipeline page, etc.) automatically refreshes the dashboard's
    // System Loop. Without this, the dashboard had its own private
    // key and only refetched when explicitly nudged.
    queryKey: ['trade-queue-items', 'pilot-dashboard-pipeline', currentOrg?.id, pilotPortfolioId],
    enabled: !!currentOrg?.id,
    // Aggressive refresh strategy — the System Loop relies on this
    // data being current, and the cost of an extra fetch is trivial.
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    staleTime: 0,
    queryFn: async () => {
      // Without a known pilot portfolio, this query has no org-scope —
      // it would return the user's trade_queue_items from any org and
      // make Capture light up on a fresh pilot client. Wait until the
      // scenario resolves to its portfolio before fetching.
      if (!pilotPortfolioId) return []
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select('id, stage, status, created_at, stage_changed_at, origin_metadata, asset:assets(symbol, company_name)')
        .eq('visibility_tier', 'active')
        .in('status', ['idea', 'discussing', 'simulating', 'deciding'])
        .eq('portfolio_id', pilotPortfolioId)
        .order('stage_changed_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(60)
      if (error) throw error
      return (data || []) as Array<{
        id: string
        stage: string
        status: string
        created_at: string
        stage_changed_at: string | null
        origin_metadata: Record<string, unknown> | null
        asset: { symbol: string | null; company_name: string | null } | null
      }>
    },
  })

  // ── Recorded decisions (Record + Review + Improve stages) ──
  const { data: recordedDecisions } = useQuery({
    queryKey: ['pilot-dashboard-recorded', currentOrg?.id],
    enabled: !!currentOrg?.id,
    queryFn: async () => {
      const { data: trades } = await supabase
        .from('accepted_trades')
        .select('id, action, asset_id, created_at, target_weight, asset:assets(symbol, company_name), portfolio:portfolios!inner(organization_id)')
        .eq('portfolio.organization_id', currentOrg!.id)
        .order('created_at', { ascending: false })
        .limit(20)
      const trade_rows = (trades || []) as Array<{
        id: string
        action: string | null
        asset_id: string | null
        created_at: string
        target_weight: number | null
        asset: { symbol: string | null; company_name: string | null } | null
      }>
      const ids = trade_rows.map(t => t.id)
      if (ids.length === 0) return { trades: trade_rows, reviewedIds: new Set<string>() }
      const { data: reviews } = await supabase
        .from('decision_reviews')
        .select('decision_id, thesis_played_out, process_note')
        .in('decision_id', ids)
      const reviewedIds = new Set(
        (reviews || [])
          .filter(r => r.thesis_played_out || (r.process_note || '').trim())
          .map(r => r.decision_id as string),
      )
      return { trades: trade_rows, reviewedIds }
    },
    staleTime: 30_000,
  })

  // ── Capture-stage list: ideas the user has logged themselves
  // (excludes pilot seeds). Uses the union of `quick_thoughts` and
  // `trade_queue_items` so a freshly-typed thought from the right
  // sidebar shows up here even before it reaches the kanban. ──
  const { data: userCaptured } = useQuery({
    // Stays on its OWN key prefix (not `trade-queue-items`) because
    // this query returns `{ ideas, thoughts }` instead of a flat
    // array — other places in the app run optimistic updates with
    // `setQueriesData({ queryKey: ['trade-queue-items'] }, old =>
    // old.map(...))` which crash if matched against this shape. The
    // dedicated window event + Realtime subscription cover refresh.
    queryKey: ['pilot-dashboard-user-captured', currentOrg?.id, user?.id, pilotPortfolioId],
    enabled: !!currentOrg?.id && !!user?.id,
    // Same aggressive refresh strategy as pipelineItems — see comment
    // there. The System Loop is the dashboard's most prominent state
    // and pilots must see step 1 turn green the instant they submit.
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    staleTime: 0,
    queryFn: async () => {
      const tqQuery = supabase
        .from('trade_queue_items')
        .select('id, created_at, stage, asset:assets(symbol, company_name), origin_metadata')
        .eq('visibility_tier', 'active')
        .eq('created_by', user!.id)
        .order('created_at', { ascending: false })
        .limit(10)
      // Constrain trade_queue_items to the pilot org's portfolio.
      // Mirrors what `pipelineItems` does — without it, ideas from
      // other orgs the user belongs to leak in.
      if (pilotPortfolioId) tqQuery.eq('portfolio_id', pilotPortfolioId)

      // Only thoughts explicitly tied to the pilot's portfolio
      // count. Thoughts without portfolio context (the user types a
      // free-floating thought) can't be reliably attributed to any
      // specific org, so they were leaking across pilot clients on
      // the same user account. Strictly scoping by portfolio_id
      // closes the leak — a user who wants a free-floating thought
      // to count toward Capture can attach it to the pilot
      // portfolio.
      const qtQuery = pilotPortfolioId
        ? supabase
            .from('quick_thoughts')
            .select('id, content, idea_type, created_at')
            .eq('created_by', user!.id)
            .in('idea_type', ['trade_idea', 'thesis', 'thought'])
            .eq('portfolio_id', pilotPortfolioId)
            .order('created_at', { ascending: false })
            .limit(10)
        : null

      const [tqRes, qtRes] = await Promise.all([tqQuery, qtQuery ?? Promise.resolve({ data: [] as any[] })])
      const tqRows = (tqRes.data || []) as Array<{
        id: string
        created_at: string
        stage: string | null
        asset: { symbol: string | null; company_name: string | null } | null
        origin_metadata: Record<string, unknown> | null
      }>
      const qtRows = (qtRes.data || []) as Array<{
        id: string
        content: string | null
        idea_type: string | null
        created_at: string
      }>
      // Drop pilot seeds — the loop is teaching pilots to capture
      // their OWN ideas; the demo seeds shouldn't fill this list.
      return {
        ideas: tqRows.filter(r => !(r.origin_metadata as any)?.pilot_seed),
        thoughts: qtRows,
      }
    },
  })

  // Treat any non-pilot-seed pipeline item as a captured idea — the
  // pipeline query is the same source the Idea Pipeline page reads
  // from, so anything visible there counts here. (The dedicated
  // `userCaptured` query was returning empty for some pilot sessions
  // even when the row clearly existed; piggy-backing on `pipelineItems`
  // sidesteps that by reusing the known-good fetch.)
  const userIdeasFromPipeline = useMemo(() => {
    return (pipelineItems || []).filter(i => !(i.origin_metadata as any)?.pilot_seed)
  }, [pipelineItems])

  // ── Stage completion (drives the active step + pulse) ──
  // Capture: user has logged a trade idea in THIS org's pilot portfolio.
  //   Quick thoughts are NOT counted — they often have no org context
  //   (no portfolio_id / asset_id / visibility_org_id), so they leak
  //   between pilot clients on a single user account. Trade ideas live
  //   in trade_queue_items which is reliably scoped by portfolio_id.
  // Develop: any pipeline item has a stage_changed_at meaningfully after creation
  // Decide / Record: pilot scenario reached `completed`
  // Review: pilot scenario has a saved reflection
  // Improve: review captured (always-future visual)
  const hasUserIdea = useMemo(() => {
    const fromPipeline = userIdeasFromPipeline.length
    const fromCapturedIdeas = userCaptured?.ideas?.length ?? 0
    return (fromPipeline + fromCapturedIdeas) > 0
  }, [userIdeasFromPipeline, userCaptured])
  const hasMovedIdea = useMemo(() => {
    return (pipelineItems || []).some(i => {
      if (!i.stage_changed_at) return false
      const moved = new Date(i.stage_changed_at).getTime()
      const created = new Date(i.created_at).getTime()
      return Number.isFinite(moved) && Number.isFinite(created) && moved - created > 1000
    })
  }, [pipelineItems])
  const completed = state === 'completed'
  const liveStepDone: Record<StageKey, boolean> = {
    capture: hasUserIdea,
    develop: hasMovedIdea,
    decide:  completed,
    // Review closes the moment the trade lands on the Trade Book —
    // that happens at commit, so it tracks `completed`.
    review:  completed,
    // Analyze closes once the user has captured a reflection — that's
    // the signal Tesseract has the data it needs to feed back into
    // future ideas. Until then it's the open work.
    analyze: completed && hasReview,
  }

  // Cache the per-step completion in localStorage so a hard refresh
  // hydrates the loop with the LAST KNOWN state immediately, before
  // the queries re-resolve. Without this, the loop briefly renders
  // every step as "not done" while pipelineItems is still loading,
  // then hitches into the correct state when data arrives. The cache
  // is keyed per user+org so each pilot client tracks independently.
  // v4 — bumped after thoughts with no org context were strictly
  // excluded from Capture display + signal. Old caches could still
  // hold a stale capture=true from the previous, lossier filter.
  const stepCacheKey = `pilot_loop_steps_v4_${user?.id || 'anon'}_${currentOrg?.id || 'no-org'}`
  const [cachedStepDone, setCachedStepDone] = useState<Record<StageKey, boolean> | null>(() => {
    try {
      const raw = localStorage.getItem(stepCacheKey)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      // Defensive — if the cached shape ever drifts (new stage added,
      // old removed) just ignore it instead of crashing.
      if (typeof parsed === 'object' && parsed !== null
        && 'capture' in parsed && 'develop' in parsed
        && 'decide' in parsed && 'review' in parsed && 'analyze' in parsed) {
        return parsed as Record<StageKey, boolean>
      }
      return null
    } catch {
      return null
    }
  })

  // While the pipeline query is still loading after a hard refresh,
  // prefer the cached state so the visuals don't flicker. Once the
  // real data arrives, swap in liveStepDone and persist it for the
  // next refresh.
  const stepDone: Record<StageKey, boolean> = pipelineLoading && cachedStepDone
    ? cachedStepDone
    : liveStepDone

  useEffect(() => {
    if (pipelineLoading) return
    try {
      localStorage.setItem(stepCacheKey, JSON.stringify(liveStepDone))
    } catch { /* ignore */ }
    setCachedStepDone(liveStepDone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineLoading, liveStepDone.capture, liveStepDone.develop, liveStepDone.decide, liveStepDone.review, liveStepDone.analyze, stepCacheKey])

  // First incomplete step is the active one. The pilot lands on
  // Capture by default — if NOTHING is done yet, that's where the
  // pulse lives. (Previously we jumped to Decide for new pilots,
  // which over-promoted the AAPL recommendation and made Capture
  // feel optional. Capture is the loop's entry point — keep it
  // visible.)
  const activeKey: StageKey = useMemo(() => {
    for (const s of STAGES) {
      if (!stepDone[s.key]) return s.key
    }
    return 'analyze'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepDone.capture, stepDone.develop, stepDone.decide, stepDone.review, stepDone.analyze])

  // Open stage = whatever the user clicked (defaults to active).
  const [openKey, setOpenKey] = useState<StageKey>(activeKey)
  const openStage = STAGES.find(s => s.key === openKey) ?? STAGES[0]

  // Auto-advance: only fire on the *actual* transition from undone
  // → done for whichever stage is currently open. Track the previous
  // done state per-stage in a ref. If the user submits their first
  // idea while viewing Capture, the open stage flips false → true
  // and we advance to the next active step. Once advanced, clicking
  // back into Capture (or any other completed stage) is honored and
  // sticky — no transition is detected because the stage was
  // already done.
  const prevStepDoneRef = useRef(stepDone)
  useEffect(() => {
    const prev = prevStepDoneRef.current
    if (!prev[openKey] && stepDone[openKey]) {
      // The stage we're looking at just got completed — walk forward.
      setOpenKey(activeKey)
    }
    prevStepDoneRef.current = stepDone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepDone.capture, stepDone.develop, stepDone.decide, stepDone.review, stepDone.analyze, openKey, activeKey])

  // Capture handler — opens the right-hand sidebar pre-focused on
  // the trade-idea capture form (same as the lightbulb icon).
  const openCapture = () => {
    try {
      window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
        detail: { captureType: 'trade_idea' },
      }))
    } catch {
      onOpenIdeaPipeline()
    }
  }

  // Per-stage CTA — the loud, colored primary-action button
  // beneath the description. Review and Analyze stay greyed out
  // until the user has actually committed a trade — until then
  // there's nothing for those surfaces to show, but we keep the
  // button visible (with a "locked" tooltip) so the user can see
  // what's coming next.
  const ctaForStage = (key: StageKey) => {
    switch (key) {
      case 'capture': return { label: 'Start a new trade idea', icon: Plus, run: openCapture, locked: false }
      case 'develop': return { label: 'Open Idea Pipeline', icon: ArrowRight, run: onOpenIdeaPipeline, locked: false }
      case 'decide':  return { label: 'Open Trade Lab', icon: ArrowRight, run: () => onOpenTradeLab(scenarioContext), locked: false }
      case 'review':  return {
        label: 'Open Trade Book',
        icon: ArrowRight,
        run: onOpenTradeBook,
        locked: !hasUnlockedTradeBook,
        lockHint: 'Unlocks after you commit your first trade.',
      }
      case 'analyze': return {
        label: 'Open Outcomes',
        icon: ArrowRight,
        run: onOpenOutcomes,
        locked: !hasUnlockedOutcomes,
        lockHint: 'Unlocks after you commit your first trade.',
      }
    }
  }

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto p-6 space-y-5">

        {/* ── Page header ────────────────────────────────────────
            H1 + a single supporting subtitle. The loop tagline is
            already shown inline with the System Loop card title
            below — repeating it here was redundant. */}
        <div className="space-y-0.5">
          <h1 className="text-[20px] font-semibold text-gray-900 dark:text-white leading-tight">
            What needs your attention
          </h1>
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-snug">
            Tesseract prioritizes ideas, decisions, and reviews so you know what to work on next.
          </p>
        </div>

        {/* ── System loop card ───────────────────────────────────
            Single dominant surface. Header has the title PLUS the
            "how ideas become decisions" tagline inline so it lands
            on the same row as the title (per pilot UX request).
            Body is the 6-stage strip + the selected-stage panel. */}
        <SystemLoopCard
          stages={STAGES}
          stepDone={stepDone}
          activeKey={activeKey}
          openKey={openKey}
          onSelect={setOpenKey}
        />

        {/* ── Selected-stage panel ───────────────────────────────
            Bold description + colored CTA + stage-specific
            attention items. Stays inside the same visual block as
            the loop header so the dashboard reads as one focused
            surface, not a stack of panels. */}
        <StagePanel
          stage={openStage}
          cta={ctaForStage(openStage.key)}
          state={state}
          scenario={scenario}
          acceptedTrade={acceptedTrade}
          committedAt={committedAt}
          hasReview={hasReview}
          pipelineItems={pipelineItems || []}
          pipelineLoading={pipelineLoading}
          recorded={recordedDecisions ?? null}
          userCaptured={userCaptured ?? null}
          userIdeasFromPipeline={userIdeasFromPipeline}
          onOpenTradeLab={() => onOpenTradeLab(scenarioContext)}
          onOpenIdeaPipeline={onOpenIdeaPipeline}
          onOpenTradeBook={onOpenTradeBook}
          onOpenOutcomes={onOpenOutcomes}
          onCapture={openCapture}
          hasUnlockedTradeBook={hasUnlockedTradeBook}
          hasUnlockedOutcomes={hasUnlockedOutcomes}
        />
      </div>
    </div>
  )
}

// ── System Loop Card ─────────────────────────────────────────────

function SystemLoopCard({
  stages,
  stepDone,
  activeKey,
  openKey,
  onSelect,
}: {
  stages: StageMeta[]
  stepDone: Record<StageKey, boolean>
  activeKey: StageKey
  openKey: StageKey
  onSelect: (key: StageKey) => void
}) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      {/* Header row — title + tagline live on the SAME line per
          pilot UX request. Tagline reads as a quiet middot-prefixed
          continuation so the line doesn't feel cramped. */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-2 flex-wrap">
        <Workflow className="w-4 h-4 text-slate-600" />
        <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white leading-tight">
          System loop
        </h2>
        <span className="text-[12px] text-gray-500 dark:text-gray-400 leading-tight">
          · How ideas become decisions, and decisions become learnings.
        </span>
        <span className="ml-auto text-[10px] text-gray-400">Click any stage to explore</span>
      </div>

      {/* Stage strip */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div className="grid grid-cols-5 gap-1.5 items-stretch">
          {stages.map((s, i) => {
            const Icon = s.icon
            const done = stepDone[s.key]
            const isActive = s.key === activeKey && !done
            const isOpen = s.key === openKey
            // Visual state precedence: open > active (pulse) > done > neutral.
            const baseClass = 'group relative rounded-lg border px-2 py-2.5 text-center transition-all duration-150 cursor-pointer'
            const stateClass = isOpen
              ? `${ACCENT_OPEN[s.accent]} shadow-sm`
              : isActive
                ? `border-2 ring-2 ring-offset-1 ${ACCENT_RING[s.accent]} animate-pulse hover:animate-none`
                : done
                  ? 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800/60'
                  : 'border-gray-200 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700'
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onSelect(s.key)}
                className={`${baseClass} ${stateClass}`}
                aria-current={isActive ? 'step' : undefined}
              >
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  {done ? (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700">
                      <CheckCircle2 className="w-3 h-3" />
                    </span>
                  ) : (
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${
                      isOpen || isActive ? ACCENT_ICON_BG[s.accent] : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                      <Icon className="w-3 h-3" />
                    </span>
                  )}
                  <span className="text-[9px] font-bold tabular-nums text-gray-400">
                    {i + 1}
                  </span>
                </div>
                <div className={`text-[12px] font-semibold leading-tight ${
                  isOpen
                    ? 'text-gray-900 dark:text-white'
                    : isActive
                      ? 'text-gray-900 dark:text-white'
                      : done
                        ? 'text-emerald-700'
                        : 'text-gray-700 dark:text-gray-200'
                }`}>
                  {s.label}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ── Stage Panel — bold description + CTA + attention items ───────

interface StagePanelProps {
  stage: StageMeta
  cta: ReturnType<PilotActionDashboardCtaBuilder>
  state: PilotScenarioState
  scenario: ReturnType<typeof usePilotScenarioStatus>['scenario']
  acceptedTrade: ReturnType<typeof usePilotScenarioStatus>['acceptedTrade']
  committedAt: string | null
  hasReview: boolean
  pipelineItems: Array<{
    id: string
    stage: string
    status: string
    created_at: string
    stage_changed_at: string | null
    origin_metadata: Record<string, unknown> | null
    asset: { symbol: string | null; company_name: string | null } | null
  }>
  pipelineLoading: boolean
  recorded: {
    trades: Array<{
      id: string
      action: string | null
      asset_id: string | null
      created_at: string
      target_weight: number | null
      asset: { symbol: string | null; company_name: string | null } | null
    }>
    reviewedIds: Set<string>
  } | null
  userCaptured: {
    ideas: Array<{
      id: string
      created_at: string
      stage: string | null
      asset: { symbol: string | null; company_name: string | null } | null
      origin_metadata: Record<string, unknown> | null
    }>
    thoughts: Array<{
      id: string
      content: string | null
      idea_type: string | null
      created_at: string
    }>
  } | null
  // Pipeline items already filtered to non-pilot-seed entries — used
  // as the primary source for the Capture stage list.
  userIdeasFromPipeline: Array<{
    id: string
    stage: string
    status: string
    created_at: string
    stage_changed_at: string | null
    origin_metadata: Record<string, unknown> | null
    asset: { symbol: string | null; company_name: string | null } | null
  }>
  onOpenTradeLab: () => void
  onOpenIdeaPipeline: () => void
  onOpenTradeBook: () => void
  onOpenOutcomes: () => void
  onCapture: () => void
  hasUnlockedTradeBook: boolean
  hasUnlockedOutcomes: boolean
}

type PilotActionDashboardCtaBuilder = (key: StageKey) => {
  label: string
  icon: React.ElementType
  run: () => void
  /** When true, the CTA renders as a disabled lock chip — visible
   *  so the user can preview "what's next" but not pressable until
   *  the unlock condition is met (committing a trade for review/
   *  analyze, etc.). */
  locked?: boolean
  /** Optional explanation surfaced as the button's title attribute
   *  while locked. */
  lockHint?: string
}

function StagePanel({
  stage, cta, state, scenario, acceptedTrade, committedAt, hasReview,
  pipelineItems, pipelineLoading, recorded, userCaptured, userIdeasFromPipeline,
  onOpenTradeLab, onOpenIdeaPipeline, onOpenTradeBook, onOpenOutcomes,
  onCapture, hasUnlockedTradeBook, hasUnlockedOutcomes,
}: StagePanelProps) {
  const Icon = stage.icon
  const CtaIcon = cta.icon

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
      {/* Stage header — bold, prominent, single-sentence
          description with the stage's accent icon. Reads as the
          pilot's instruction for "what this step is about." */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg ${ACCENT_ICON_BG[stage.accent]}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">
              Step · {stage.label}
            </div>
            <p className="text-[15px] font-semibold text-gray-900 dark:text-white leading-snug">
              {stage.description}
            </p>
          </div>
          <button
            type="button"
            onClick={cta.run}
            disabled={cta.locked}
            title={cta.locked ? (cta.lockHint || 'Unlocks later in the loop.') : undefined}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
              cta.locked
                ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 cursor-not-allowed'
                : ACCENT_CTA[stage.accent]
            }`}
          >
            {cta.locked && <Lock className="w-3 h-3" />}
            {cta.label}
            {!cta.locked && <CtaIcon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Stage-specific attention list */}
      <div className="px-5 py-4">
        {stage.key === 'capture' && (
          <CaptureAttention
            // Prefer pipelineItems-derived ideas — that query is the
            // same one feeding the Idea Pipeline page so any visible
            // there is guaranteed to show here too. Fall back to the
            // dedicated capture query if the pipeline list is empty
            // (e.g., scenario portfolio not yet known).
            ideas={
              userIdeasFromPipeline.length > 0
                ? userIdeasFromPipeline
                : (userCaptured?.ideas ?? [])
            }
            thoughts={userCaptured?.thoughts ?? []}
            onCapture={onCapture}
          />
        )}

        {stage.key === 'develop' && (
          <DevelopAttention
            items={pipelineItems}
            loading={pipelineLoading}
            onOpenIdeaPipeline={onOpenIdeaPipeline}
          />
        )}

        {stage.key === 'decide' && (
          <DecideAttention
            state={state}
            scenario={scenario}
            committedAt={committedAt}
            pipelineItems={pipelineItems}
            onOpenTradeLab={onOpenTradeLab}
          />
        )}

        {stage.key === 'review' && (
          <ReviewAttention
            trades={recorded?.trades ?? []}
            committedAt={committedAt}
            scenarioState={state}
            acceptedTrade={acceptedTrade}
            hasUnlockedTradeBook={hasUnlockedTradeBook}
            onOpenTradeBook={onOpenTradeBook}
          />
        )}

        {stage.key === 'analyze' && (
          <AnalyzeAttention
            trades={recorded?.trades ?? []}
            reviewedIds={recorded?.reviewedIds ?? new Set()}
            scenarioState={state}
            hasReview={hasReview}
            hasUnlockedOutcomes={hasUnlockedOutcomes}
            onOpenOutcomes={onOpenOutcomes}
          />
        )}
      </div>
    </section>
  )
}

// ── Per-stage attention sections ─────────────────────────────────

// Accepts ideas from either the dedicated capture query or the
// broader pipeline query — both share the same minimal shape we
// render below (id, asset, created_at, stage). Typed as the union
// so TS doesn't reject either source.
type CaptureIdea = {
  id: string
  created_at: string
  stage: string | null
  asset: { symbol: string | null; company_name: string | null } | null
  origin_metadata: Record<string, unknown> | null
}

function CaptureAttention({
  ideas, thoughts, onCapture,
}: {
  ideas: ReadonlyArray<CaptureIdea>
  thoughts: StagePanelProps['userCaptured'] extends infer T ? T extends { thoughts: infer Q } ? Q : never : never
  onCapture: () => void
}) {
  const total = ideas.length + thoughts.length
  if (total === 0) {
    return (
      <EmptyAttention
        title="No captured ideas yet"
        body="Start by typing what's on your mind. The loop runs on your conviction — even a one-line note here counts as the first step."
        ctaLabel="Capture your first idea"
        onCta={onCapture}
      />
    )
  }
  return (
    <>
      <AttentionHeader
        title="Your recent captures"
        count={total}
        helper="Ideas you've logged. They become candidates for the pipeline once you give them more shape."
      />
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {ideas.slice(0, 4).map(i => {
          const sym = i.asset?.symbol || '—'
          const name = i.asset?.company_name || ''
          return (
            <li key={`tq-${i.id}`} className="py-2.5 flex items-start gap-3">
              <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-50 border border-amber-200 text-amber-700">
                <Lightbulb className="w-3 h-3" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{sym}</span>
                  {name && <span className="text-[11px] text-gray-500 truncate">{name}</span>}
                  <span className="text-[10px] text-gray-400 ml-auto">
                    {fmtRelative(i.created_at)}
                  </span>
                </div>
                <div className="text-[10px] text-gray-500">
                  In pipeline · {PIPELINE_STAGE_LABEL[i.stage || 'aware'] || i.stage}
                </div>
              </div>
            </li>
          )
        })}
        {thoughts.slice(0, 4 - Math.min(4, ideas.length)).map(t => (
          <li key={`qt-${t.id}`} className="py-2.5 flex items-start gap-3">
            <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-50 border border-amber-200 text-amber-700">
              <FileText className="w-3 h-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase font-bold tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-[1px] rounded">
                  {(t.idea_type || 'note').replace('_', ' ')}
                </span>
                <span className="text-[10px] text-gray-400 ml-auto">{fmtRelative(t.created_at)}</span>
              </div>
              <p className="text-[12px] text-gray-700 dark:text-gray-200 line-clamp-2 mt-0.5 leading-snug">
                {t.content || '(no body)'}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function DevelopAttention({
  items, loading, onOpenIdeaPipeline,
}: {
  items: StagePanelProps['pipelineItems']
  loading: boolean
  onOpenIdeaPipeline: () => void
}) {
  const grouped = useMemo(() => {
    const by: Record<string, typeof items> = {}
    for (const k of PIPELINE_STAGE_ORDER) by[k] = []
    for (const it of items) {
      // Newly-captured ideas land with `stage='idea'` (legacy enum
      // value used by QuickTradeIdeaCapture) rather than `'aware'`.
      // Surface them in the Aware column so the pilot sees their
      // capture in the kanban breakdown without having to drag it.
      // Anything else with an unrecognized stage also falls back
      // to Aware rather than getting silently dropped.
      const normalized = (it.stage === 'idea' || !PIPELINE_STAGE_ORDER.includes(it.stage as any))
        ? 'aware'
        : it.stage
      if (by[normalized]) by[normalized].push(it)
    }
    return by
  }, [items])

  const total = items.length
  if (loading && total === 0) {
    return <p className="text-[11px] text-gray-400 italic">Loading pipeline…</p>
  }
  if (total === 0) {
    return (
      <EmptyAttention
        title="No ideas in the pipeline yet"
        body="Capture an idea first, then it'll appear here ready to drag through the research stages."
        ctaLabel="Open Idea Pipeline"
        onCta={onOpenIdeaPipeline}
      />
    )
  }
  // Maturity-coded styling per stage. Light/cool on the left
  // (just-aware) → warm/saturated on the right (ready) to give
  // the row a visual sense of conviction building as ideas move
  // through the pipeline. The leading dot, top border, and count
  // all share the same accent so each column reads as one cohesive
  // chip rather than a generic grid cell.
  const STAGE_STYLE: Record<typeof PIPELINE_STAGE_ORDER[number], {
    accent: string
    accentDot: string
    accentBorder: string
    accentText: string
    pill: string
  }> = {
    aware:              { accent: 'from-sky-50',     accentDot: 'bg-sky-400',     accentBorder: 'border-t-sky-300',     accentText: 'text-sky-700',     pill: 'bg-sky-50 text-sky-800 border-sky-200' },
    investigate:        { accent: 'from-indigo-50',  accentDot: 'bg-indigo-400',  accentBorder: 'border-t-indigo-300',  accentText: 'text-indigo-700',  pill: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
    deep_research:      { accent: 'from-violet-50',  accentDot: 'bg-violet-400',  accentBorder: 'border-t-violet-300',  accentText: 'text-violet-700',  pill: 'bg-violet-50 text-violet-800 border-violet-200' },
    thesis_forming:     { accent: 'from-amber-50',   accentDot: 'bg-amber-400',   accentBorder: 'border-t-amber-300',   accentText: 'text-amber-700',   pill: 'bg-amber-50 text-amber-800 border-amber-200' },
    ready_for_decision: { accent: 'from-emerald-50', accentDot: 'bg-emerald-500', accentBorder: 'border-t-emerald-400', accentText: 'text-emerald-700', pill: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  }

  return (
    <>
      <AttentionHeader
        title="Ideas in flight, by stage"
        count={total}
        helper="Drag ideas left to right in the pipeline as conviction builds."
      />
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
        {PIPELINE_STAGE_ORDER.map((stageKey, idx) => {
          const list = grouped[stageKey] || []
          const style = STAGE_STYLE[stageKey]
          const stageLabel = PIPELINE_STAGE_LABEL[stageKey]
          return (
            <div
              key={stageKey}
              className={`group relative rounded-lg border-t-2 ${style.accentBorder} border border-gray-200 dark:border-gray-700 bg-gradient-to-b ${style.accent} via-white to-white dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 p-2.5 min-h-[120px] transition-shadow hover:shadow-sm`}
            >
              {/* Header row: colored dot, stage name, count badge */}
              <div className="flex items-center justify-between gap-1.5 mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${style.accentDot} flex-shrink-0`} />
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${style.accentText} truncate`}>
                    {stageLabel}
                  </span>
                </div>
                <span className={`text-[14px] font-bold tabular-nums leading-none ${list.length > 0 ? style.accentText : 'text-gray-300 dark:text-gray-600'}`}>
                  {list.length}
                </span>
              </div>

              {/* Ticker pills */}
              {list.length === 0 ? (
                <p className="text-[10px] text-gray-300 dark:text-gray-600 italic mt-3 text-center">empty</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {list.slice(0, 4).map(i => {
                    const sym = i.asset?.symbol || '—'
                    const name = i.asset?.company_name || sym
                    return (
                      <span
                        key={i.id}
                        title={name}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold tabular-nums ${style.pill}`}
                      >
                        {sym}
                      </span>
                    )
                  })}
                  {list.length > 4 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-dashed border-gray-200 dark:border-gray-700 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                      +{list.length - 4}
                    </span>
                  )}
                </div>
              )}

              {/* Step number — ghost watermark in the bottom-right
                  corner so the funnel ordering is glanceable even
                  when stage labels truncate at very narrow widths. */}
              <span className="absolute right-1.5 bottom-1 text-[9px] font-bold tabular-nums text-gray-300/70 dark:text-gray-600/70 pointer-events-none">
                {idx + 1}/{PIPELINE_STAGE_ORDER.length}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function DecideAttention({
  state, scenario, committedAt, pipelineItems, onOpenTradeLab,
}: {
  state: PilotScenarioState
  scenario: StagePanelProps['scenario']
  committedAt: string | null
  pipelineItems: StagePanelProps['pipelineItems']
  onOpenTradeLab: () => void
}) {
  // Pull every "ready_for_decision" row so any user-promoted idea
  // sits alongside the seeded recommendation.
  const ready = pipelineItems.filter(i => i.stage === 'ready_for_decision')
  if (state === 'completed') {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-3">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-[12px] font-semibold text-emerald-900">
            Decision recorded
          </span>
        </div>
        <p className="text-[11px] text-emerald-800/80 leading-snug">
          {scenario?.symbol || 'Your trade'} was committed{committedAt ? ` ${fmtRelative(committedAt)}` : ''}.
          Move on to <strong>Record</strong> to see it on the Trade Book.
        </p>
      </div>
    )
  }
  if (ready.length === 0) {
    return (
      <EmptyAttention
        title="Nothing ready for a decision yet"
        body="When an idea reaches the Ready for decision stage, it'll show here so you can simulate sizing in Trade Lab and commit."
        ctaLabel="Open Trade Lab"
        onCta={onOpenTradeLab}
      />
    )
  }
  return (
    <>
      <AttentionHeader
        title="Recommendations ready for a decision"
        count={ready.length}
        helper="Open in Trade Lab to simulate sizing and commit."
      />
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {ready.slice(0, 4).map(r => {
          const isPilotRec = (r.origin_metadata as any)?.role === 'recommendation'
          return (
            <li key={r.id} className="py-2.5 flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary-50 border border-primary-200 text-primary-700">
                <Beaker className="w-3 h-3" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                    {r.asset?.symbol || '—'}
                  </span>
                  {r.asset?.company_name && (
                    <span className="text-[11px] text-gray-500 truncate">{r.asset.company_name}</span>
                  )}
                  {isPilotRec && (
                    <span className="text-[9px] uppercase font-bold tracking-wider text-primary-700 bg-primary-50 border border-primary-200 px-1.5 py-[1px] rounded">
                      Pilot recommendation
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenTradeLab}
                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors whitespace-nowrap"
              >
                Open Trade Lab
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// Review stage = "see the trade land on the Trade Book." Lists the
// most recent committed decisions; this is the destination of the
// commit, not the place to reflect.
function ReviewAttention({
  trades, committedAt, scenarioState, acceptedTrade, hasUnlockedTradeBook, onOpenTradeBook,
}: {
  trades: StagePanelProps['recorded'] extends infer T ? T extends { trades: infer X } ? X : never : never
  committedAt: string | null
  scenarioState: PilotScenarioState
  acceptedTrade: StagePanelProps['acceptedTrade']
  hasUnlockedTradeBook: boolean
  onOpenTradeBook: () => void
}) {
  const hasAny = trades.length > 0
  if (!hasAny) {
    return (
      <EmptyAttention
        title="No decisions on the Trade Book yet"
        body="Once you commit a trade in Trade Lab, it lands here permanently. The Trade Book is your system of record — every committed decision lives there."
        ctaLabel={hasUnlockedTradeBook ? 'Open Trade Book' : 'Open Trade Lab'}
        onCta={onOpenTradeBook}
      />
    )
  }
  return (
    <>
      <AttentionHeader
        title="Recently committed decisions"
        count={trades.length}
        helper="Click through to the Trade Book to see the full audit trail."
      />
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {trades.slice(0, 4).map(t => (
          <li key={t.id} className="py-2.5 flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-violet-50 border border-violet-200 text-violet-700">
              <BookOpen className="w-3 h-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                  {(t.action || 'TRADE').toUpperCase()} {t.asset?.symbol || '—'}
                </span>
                {t.target_weight != null && (
                  <span className="text-[11px] text-gray-500 tabular-nums">
                    {Number(t.target_weight).toFixed(2)}% target
                  </span>
                )}
              </div>
              <div className="text-[10px] text-gray-400">{fmtRelative(t.created_at)}</div>
            </div>
          </li>
        ))}
      </ul>
      {scenarioState === 'completed' && acceptedTrade && (
        <p className="text-[11px] text-violet-700 mt-3">
          {`Your pilot decision is on the book${committedAt ? ` (${fmtRelative(committedAt)})` : ''}.`}
        </p>
      )}
    </>
  )
}

// Analyze stage = the merged Review + Improve work. Shows pending
// reflections (top of the list, the open work) followed by captured
// learnings (closed loop). Empty state explains that reflections
// only become available after a commit lands.
function AnalyzeAttention({
  trades, reviewedIds, scenarioState, hasReview, hasUnlockedOutcomes, onOpenOutcomes,
}: {
  trades: StagePanelProps['recorded'] extends infer T ? T extends { trades: infer X } ? X : never : never
  reviewedIds: Set<string>
  scenarioState: PilotScenarioState
  hasReview: boolean
  hasUnlockedOutcomes: boolean
  onOpenOutcomes: () => void
}) {
  const pendingReview = trades.filter(t => !reviewedIds.has(t.id))
  const reviewed = trades.filter(t => reviewedIds.has(t.id))
  if (trades.length === 0) {
    return (
      <EmptyAttention
        title="Nothing to analyze yet"
        body="Analysis opens up after you commit a decision. Outcomes will measure the result and prompt you to reflect on whether the thesis played out."
        ctaLabel={hasUnlockedOutcomes ? 'Open Outcomes' : 'Outcomes unlocks after committing'}
        onCta={hasUnlockedOutcomes ? onOpenOutcomes : () => {}}
      />
    )
  }
  // Hot state — pilot scenario committed but no reflection yet.
  // Surface the prompt above everything so it's the single thing
  // the user does next.
  const pilotPromptingReflection = scenarioState === 'completed' && !hasReview
  return (
    <>
      {pendingReview.length > 0 && (
        <>
          <AttentionHeader
            title={pilotPromptingReflection ? 'Capture your reflection' : 'Reflections waiting on you'}
            count={pendingReview.length}
            helper="Tesseract has the price data — it just needs your read on whether the thesis played out."
          />
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 mb-4">
            {pendingReview.slice(0, 4).map(t => (
              <li key={t.id} className="py-2.5 flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700">
                  <Sparkles className="w-3 h-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                      {(t.action || 'TRADE').toUpperCase()} {t.asset?.symbol || '—'}
                    </span>
                    <span className="text-[10px] text-gray-400">{fmtRelative(t.created_at)}</span>
                  </div>
                  <div className="text-[10px] text-emerald-700">Reflection pending</div>
                </div>
                <button
                  type="button"
                  onClick={onOpenOutcomes}
                  disabled={!hasUnlockedOutcomes}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  Reflect
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {reviewed.length > 0 ? (
        <>
          <AttentionHeader
            title="Captured learnings"
            count={reviewed.length}
            helper="Reflections you've completed. These shape future recommendations."
          />
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {reviewed.slice(0, 4).map(t => (
              <li key={t.id} className="py-2.5 flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-teal-50 border border-teal-200 text-teal-700">
                  <Sparkles className="w-3 h-3" />
                </span>
                <div className="min-w-0 flex-1 text-[12px]">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {(t.action || 'TRADE').toUpperCase()} {t.asset?.symbol || '—'}
                  </span>
                  <span className="text-gray-400 ml-2 text-[10px]">{fmtRelative(t.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : pendingReview.length === 0 ? (
        <p className="text-[11px] text-emerald-700">Caught up — every decision has a reflection on file.</p>
      ) : null}
    </>
  )
}

// ── Shared atoms ─────────────────────────────────────────────────

function AttentionHeader({ title, count, helper }: { title: string; count: number; helper: string }) {
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-200">
          {title}
        </h3>
        {count > 0 && (
          <span className="text-[10px] text-gray-400 tabular-nums">
            {count} item{count !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 leading-snug">{helper}</p>
    </div>
  )
}

// Empty-state blurb. The trailing CTA was duplicative of the stage
// panel's main button (same label, same destination), so it's been
// dropped — the empty state now only narrates the "nothing here yet"
// context. Callers still pass the CTA fields for backward compat;
// they're intentionally ignored at render time.
function EmptyAttention({
  title, body,
}: {
  title: string
  body: string
  ctaLabel?: string
  onCta?: () => void
}) {
  return (
    <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-700 px-4 py-4 text-center">
      <div className="text-[13px] font-semibold text-gray-700 dark:text-gray-200 mb-0.5">
        {title}
      </div>
      <p className="text-[11px] text-gray-500 leading-snug max-w-md mx-auto">{body}</p>
    </div>
  )
}

function fmtRelative(date: string) {
  try {
    const ms = Date.now() - new Date(date).getTime()
    if (ms < 24 * 60 * 60 * 1000) return formatDistanceToNow(new Date(date), { addSuffix: true })
    if (ms < 7 * 24 * 60 * 60 * 1000) return formatDistanceToNow(new Date(date), { addSuffix: true })
    return format(new Date(date), 'MMM d')
  } catch {
    return ''
  }
}
