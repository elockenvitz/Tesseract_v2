/**
 * The facts the suggested questions are built from.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * `lib/ai/prompt-candidates` decides which questions to offer and why, from
 * counts and a handful of exemplars. This hook is the only thing that fetches
 * them. The split is deliberate: the ranking is the part with judgement in it
 * and the part that was previously untestable, so it lives in a pure module,
 * and this file stays a query.
 *
 * ── Permission scope ────────────────────────────────────────────────────
 *
 * Every read here runs on the browser's own client, so RLS applies exactly as
 * it does everywhere else, and a record the reader may not see is not
 * returned and not counted. That is the right behaviour for a suggestion: a
 * question is offered only because a visible record justifies it, so an
 * RLS-filtered zero produces no candidate rather than a wrong one. Nothing
 * here needs to reason about what it cannot see -- unlike the retrieval
 * tools, which must report absence and therefore must declare their reach.
 *
 * RLS posture -- no new table, no new policy, nothing widened. Six reads
 * through existing SELECT policies:
 *   decision_requests      portfolio_in_current_org AND (raised by me OR portfolio_team)
 *   trade_queue_items      mine, or my org's non-private
 *   asset_checklist_items  through the existing item policy, filtered to my assignments
 *   asset_list_items       items of lists I own or collaborate on
 *   coverage               organization_id = current_org_id()
 *
 * ── Why one query and not six hooks ─────────────────────────────────────
 *
 * The panel needs all of it or none of it: a partial set would rank against
 * incomplete facts and reorder as the rest arrived, which is the unstable
 * ordering this work exists to remove. One cache entry also means one
 * `isLoading`, which the pane's settle gate can hold the empty state on so
 * the questions paint once, already grounded.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { toIdeaStage } from '../../lib/ideas/stage-model'
import { isLiveIdea } from '../../lib/trade-status-semantics'
import { DECIDED_DECISION_STATUSES } from '../../lib/decisions/outcome-eligibility'
import {
  RECENT_DECISION_WINDOW_DAYS,
  type CandidateInput,
} from '../../lib/ai/prompt-candidates'

/** The facts, with nothing the ranking does not use. */
export interface PromptFacts {
  pendingDecisions: NonNullable<CandidateInput['pendingDecisions']>
  pipeline: NonNullable<CandidateInput['pipeline']>
  work: NonNullable<CandidateInput['work']>
  lists: NonNullable<CandidateInput['lists']>
  coverage: NonNullable<CandidateInput['coverage']>
  recentDecisions: NonNullable<CandidateInput['recentDecisions']>
}

export const groundedPromptsKey = (userId: string | null | undefined) =>
  ['ai-grounded-prompt-facts', userId] as const

const DAY_MS = 86_400_000

/** Whole days between an ISO timestamp and now, or null when unparseable. */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / DAY_MS)
}

/** Today in the same shape the date columns store, for an honest comparison. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function useGroundedPromptFacts(enabled = true) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  return useQuery<PromptFacts>({
    queryKey: groundedPromptsKey(userId),
    enabled: enabled && Boolean(userId),
    /*
     * A minute. Long enough that opening the panel twice in a row does not
     * re-read the desk, short enough that a ruling made in another tab shows
     * up in the suggestions on the next open. The requirement is that
     * suggestions change when the underlying records change, not that they
     * track them live: a subscription here would re-rank under the reader's
     * cursor while they were deciding which question to press.
     */
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    /* Retried once. A failure leaves the pure layer with no facts, which
       produces the fallback questions rather than a broken panel. */
    retry: 1,
    queryFn: async (): Promise<PromptFacts> => {
      if (!userId) throw new Error('not signed in')

      const answered = [...DECIDED_DECISION_STATUSES, 'withdrawn']
      const today = todayISO()
      const since = new Date(Date.now() - RECENT_DECISION_WINDOW_DAYS * DAY_MS).toISOString()

      const [open, ideas, myItems, flagged, cov, recent] = await Promise.all([
        /* Open recommendations visible to the reader. Rows rather than a
           count, because the waiting time and the reviewer are both needed
           and a count cannot carry them. */
        supabase.from('decision_requests')
          .select('id, created_at, reviewed_by')
          .not('status', 'in', `(${answered.join(',')})`)
          .order('created_at', { ascending: true })
          .limit(60),

        /* Live ideas the reader owns or is assigned. Liveness cannot be a
           query filter: it is outcome-then-status, and `outcome` is null on
           rows whose status is already terminal, so it is applied below. */
        supabase.from('trade_queue_items')
          .select('id, stage, status, outcome, stage_changed_at, created_at, assets:asset_id(symbol)')
          .is('deleted_at', null)
          .eq('visibility_tier', 'active')
          .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
          .limit(200),

        /* The reader's own open requirements. Scoped to their assignments
           rather than the organization: "what is overdue" asked in the first
           person is a question about their plate, and the desk's 600 open
           requirements would drown it. */
        supabase.from('asset_checklist_items')
          .select('id, asset_id, status, due_date, assets:asset_id(symbol)')
          .eq('assignee_id', userId)
          .neq('status', 'completed')
          .limit(200),

        supabase.from('asset_list_items')
          .select('id, is_flagged, asset_lists:list_id(id, name)')
          .eq('is_flagged', true)
          .limit(100),

        supabase.from('coverage')
          .select('asset_id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_active', true),

        supabase.from('decision_requests')
          .select('id', { count: 'exact', head: true })
          .in('status', DECIDED_DECISION_STATUSES as string[])
          .gte('updated_at', since),
      ])

      /*
       * A failed read contributes nothing rather than failing the set. The
       * alternative -- throwing -- would cost the reader every suggestion
       * because one table was slow, and the pure layer already treats missing
       * facts as "no candidate from this source".
       */
      const openRows = open.error ? [] : (open.data ?? [])
      const ideaRows = ideas.error ? [] : (ideas.data ?? [])
      const itemRows = myItems.error ? [] : (myItems.data ?? [])
      const flaggedRows = flagged.error ? [] : (flagged.data ?? [])

      /* ── Pending decisions ─────────────────────────────────────────── */
      const waits = openRows
        .map((r: Record<string, unknown>) => daysSince(r.created_at as string))
        .filter((n): n is number => n !== null)
      const pendingDecisions = {
        count: openRows.length,
        longestWaitingDays: waits.length ? Math.max(...waits) : null,
        yoursToAnswer: openRows.filter(
          (r: Record<string, unknown>) => r.reviewed_by === userId,
        ).length,
      }

      /* ── Pipeline ──────────────────────────────────────────────────── */
      const live = ideaRows.filter((r: Record<string, unknown>) =>
        isLiveIdea({ outcome: r.outcome as string | null, status: r.status as string | null }))
      const ready = live.filter(
        (r: Record<string, unknown>) => toIdeaStage(r.stage as string) === 'ready_to_recommend')
      /* The single most stalled idea, not a list: one specific question about
         one name beats a vague question about several. */
      let stalled: { symbol: string | null; daysInStage: number } | null = null
      for (const r of live) {
        const row = r as Record<string, any>
        const d = daysSince(row.stage_changed_at ?? row.created_at)
        if (d === null) continue
        if (!stalled || d > stalled.daysInStage) {
          stalled = { symbol: row.assets?.symbol ?? null, daysInStage: d }
        }
      }
      const pipeline = {
        readyToRecommend: ready.length,
        stalled,
        liveTotal: live.length,
      }

      /* ── Work ──────────────────────────────────────────────────────── */
      const overdue = itemRows.filter(
        (r: Record<string, unknown>) => Boolean(r.due_date) && String(r.due_date) < today)
      /* The asset carrying the most, so the question can name it. Ties go to
         whichever the query returned first, which is stable for a stable
         query and never user-visible as an ordering. */
      const perAsset = new Map<string, { symbol: string | null; n: number }>()
      for (const r of itemRows) {
        const row = r as Record<string, any>
        if (!row.asset_id) continue
        const prev = perAsset.get(row.asset_id)
        perAsset.set(row.asset_id, {
          symbol: row.assets?.symbol ?? prev?.symbol ?? null,
          n: (prev?.n ?? 0) + 1,
        })
      }
      let busiest: { symbol: string | null; n: number } | null = null
      for (const v of perAsset.values()) if (!busiest || v.n > busiest.n) busiest = v
      const work = {
        overdueRequirements: overdue.length,
        openRequirements: itemRows.length,
        busiestSymbol: busiest?.symbol ?? null,
      }

      /* ── Lists ─────────────────────────────────────────────────────── */
      const perList = new Map<string, { name: string | null; n: number }>()
      for (const r of flaggedRows) {
        const row = r as Record<string, any>
        const id = row.asset_lists?.id
        if (!id) continue
        const prev = perList.get(id)
        perList.set(id, { name: row.asset_lists?.name ?? prev?.name ?? null, n: (prev?.n ?? 0) + 1 })
      }
      let topList: { name: string | null; n: number } | null = null
      for (const v of perList.values()) if (!topList || v.n > topList.n) topList = v
      const lists = {
        flaggedCount: flaggedRows.length,
        flaggedListName: topList?.name ?? null,
      }

      return {
        pendingDecisions,
        pipeline,
        work,
        lists,
        coverage: { assetCount: cov.error ? 0 : (cov.count ?? 0) },
        recentDecisions: {
          count: recent.error ? 0 : (recent.count ?? 0),
          windowDays: RECENT_DECISION_WINDOW_DAYS,
        },
      }
    },
  })
}
