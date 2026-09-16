/**
 * Desktop Decisions — data.
 *
 * Two reads, split the way every other desktop stage splits:
 *
 *   useDecisionScan(portfolioId?)   the history, light
 *   useDecisionDetail(decision)     price path + current state, for ONE
 *
 * ── Terminal work is the point here ───────────────────────────────────────
 *
 * Every active surface filters terminal records out: Ideas excludes executed
 * and rejected, Today excludes anything resolved. Decisions must do the
 * opposite. An accepted trade from April and a withdrawn request from March are
 * exactly the objects this workspace exists to hold, and reusing an active-work
 * filter here would empty the page. There is deliberately no `visibility_tier`
 * or outcome filter in the scan query.
 */

import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDecisionAccountability } from './useDecisionAccountability'
import { inferDecisionIntelligence } from '../lib/decision-intelligence'
import { phoneStatusLabel } from '../lib/outcomes/phone-status'
import { groupByBatch, type BatchPnl } from '../lib/outcomes/batch-groups'
import { NO_OUTCOME_FACTS, type OutcomeFacts } from '../lib/desktop-decisions/classes'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'
import type { DecisionRecord, DecisionStatus } from '../lib/desktop-decisions/model'
import { fallbackExecutionFor, needsExecutionFallback } from '../lib/desktop-decisions/execution-link'
import { isPilotSeedRow } from '../lib/pilot/seed-visibility'

const DAY = 86_400_000

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : null
}

const personName = (u: any): string | null =>
  u ? ([u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || null) : null

/**
 * The decision history for one book, or for every book the user can see.
 *
 * One query. The joins are all to-one, and nothing here loads a price series, a
 * thesis, a research note or a scenario -- the scan needs who/what/where/when
 * and the two counts a card shows.
 */
export function useDecisionScan(portfolioId: string | null) {
  const { currentOrgId } = useOrganization()

  const { data, isLoading, error } = useQuery<DecisionRecord[]>({
    queryKey: ['desktop-decisions', 'scan', currentOrgId, portfolioId ?? 'all'],
    enabled: !!currentOrgId,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from('decision_requests')
        .select(`
          id, trade_queue_item_id, portfolio_id, status, requested_action,
          context_note, decision_note, deferred_until,
          sizing_weight, sizing_shares, submission_snapshot,
          created_at, reviewed_at, reviewed_by, requested_by, accepted_trade_id,
          portfolios!inner(id, name, organization_id),
          reviewer:users!decision_requests_reviewed_by_fkey(first_name, last_name, email),
          requester:users!decision_requests_requested_by_fkey(first_name, last_name, email),
          trade_queue_items(id, asset_id, origin_metadata, assets(id, symbol, company_name)),
          accepted_trades!decision_requests_accepted_trade_id_fkey(
            id, execution_status, execution_completed_at, executed_by, batch_id,
            target_weight, delta_weight, notional_value)
        `)
        .eq('portfolios.organization_id', currentOrgId!)
        .order('reviewed_at', { ascending: false, nullsFirst: false })
        .limit(300)

      if (portfolioId) q = q.eq('portfolio_id', portfolioId)

      const { data, error } = await q
      if (error) throw new Error(error.message)

      /*
       * Executions Trade Lab never linked.
       *
       * Until the execute writer set `accepted_trade_id`, every Trade Lab
       * execution arrived here with no embedded trade. The trade names its
       * request through `accepted_trades.decision_request_id`, so those are
       * read back by that FK -- for accepted requests only, within the books
       * already scoped to this organisation above -- and kept only where
       * exactly one active, original trade answers (lib/desktop-decisions/
       * execution-link). A failure degrades to "no execution", as before.
       */
      const rows = (data ?? []) as any[]
      const unlinked = rows.filter(r => !r.accepted_trades && needsExecutionFallback(r))
      if (unlinked.length) {
        const { data: trades } = await supabase.from('accepted_trades')
          .select('id, decision_request_id, portfolio_id, is_active, corrects_accepted_trade_id, execution_status, execution_completed_at, executed_by, batch_id, target_weight, delta_weight, notional_value')
          .in('decision_request_id', unlinked.map(r => r.id))
          .in('portfolio_id', [...new Set(unlinked.map(r => r.portfolio_id))])
        for (const r of unlinked) {
          r.accepted_trades = fallbackExecutionFor(r, (trades ?? []) as any[])
        }
      }

      // `accepted_trades.executed_by` references auth.users, which PostgREST
      // cannot embed from the API schema -- asking for it fails the ENTIRE
      // query rather than blanking a field. Resolved separately against
      // public.users, which mirrors the same ids.
      const executorIds = [...new Set(
        rows
          .map(r => r.accepted_trades?.executed_by)
          .filter((x): x is string => !!x),
      )]
      /*
       * The batches those trades were committed in.
       *
       * A second read rather than a deeper embed: `accepted_trades` is
       * embedded through a named FK from `decision_requests`, and nesting
       * another relation under it is the kind of PostgREST path that fails
       * the WHOLE query when one grant is missing -- the same trap the
       * executor lookup below already documents. Batch ids are few, the read
       * is keyed on them, and a failure here can degrade to "no batch" rather
       * than to "no decisions".
       */
      const batchIds = [...new Set(
        rows
          .map(r => r.accepted_trades?.batch_id)
          .filter((x): x is string => !!x),
      )]
      const batches = new Map<string, { name: string | null; description: string | null }>()
      if (batchIds.length) {
        const { data: rows } = await supabase.from('trade_batches')
          .select('id, name, description').in('id', batchIds)
        for (const b of ((rows ?? []) as any[])) {
          batches.set(b.id, { name: b.name ?? null, description: b.description ?? null })
        }
      }

      const executorNames = new Map<string, string>()
      if (executorIds.length) {
        const { data: people } = await supabase.from('users')
          .select('id, first_name, last_name, email').in('id', executorIds)
        for (const u of ((people ?? []) as any[])) {
          const n = personName(u)
          if (n) executorNames.set(u.id, n)
        }
      }

      return rows.map((r): DecisionRecord => {
        const snap = r.submission_snapshot ?? {}
        const idea = r.trade_queue_items
        const exec = r.accepted_trades
        return {
          id: r.id,
          ideaId: r.trade_queue_item_id ?? null,
          portfolioId: r.portfolio_id,
          portfolioName: r.portfolios?.name ?? null,
          assetId: idea?.asset_id ?? null,
          symbol: idea?.assets?.symbol ?? snap.symbol ?? null,
          companyName: idea?.assets?.company_name ?? snap.company_name ?? null,

          status: (r.status ?? 'pending') as DecisionStatus,
          action: r.requested_action ?? snap.action ?? null,

          decidedBy: r.reviewed_by ?? null,
          decidedByName: personName(r.reviewer),
          decidedAt: r.reviewed_at ?? null,

          requestedByName: personName(r.requester) ?? snap.requester_name ?? null,
          requestedAt: r.created_at ?? null,

          decisionNote: r.decision_note ?? null,
          contextNote: r.context_note ?? null,

          sizingWeight: num(r.sizing_weight),
          sizingShares: num(r.sizing_shares),
          // The book's weight when this was submitted, where the snapshot
          // captured it. This is the ONLY decision-time weight that exists;
          // today's holdings cannot answer it.
          baselineWeight: num(snap.baseline_weight),

          deferredUntil: r.deferred_until ?? null,

          // The marker sits on the request's snapshot or on the idea it came
          // from, depending on which the seeder wrote. Read only.
          isPilotSeed: isPilotSeedRow(r) || isPilotSeedRow(idea),

          execution: exec
            ? {
                id: exec.id,
                status: exec.execution_status ?? null,
                completedAt: exec.execution_completed_at ?? null,
                executedByName: exec.executed_by ? (executorNames.get(exec.executed_by) ?? null) : null,
                // The committed trade's own figures, as recorded.
                targetWeight: num(exec.target_weight),
                deltaWeight: num(exec.delta_weight),
                notional: num(exec.notional_value),
              }
            : null,

          /*
           * Only where the trade genuinely carries a batch id AND that batch
           * was read back. A batch id pointing at a row this user cannot see
           * is not a batch we can describe, and inventing a placeholder for
           * it would group trades under an act nobody can open.
           */
          batch: exec?.batch_id && batches.has(exec.batch_id)
            ? { id: exec.batch_id, ...batches.get(exec.batch_id)! }
            : null,
        }
      })
    },
  })

  return { decisions: data ?? [], isLoading, error: error as Error | null }
}

/** The books that actually carry decisions, for the filter. */
export function usePortfoliosWithDecisions(decisions: DecisionRecord[]) {
  return useMemo(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>()
    for (const d of decisions) {
      const held = byId.get(d.portfolioId)
      if (held) held.count += 1
      else byId.set(d.portfolioId, { id: d.portfolioId, name: d.portfolioName ?? 'Untitled', count: 1 })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [decisions])
}

/**
 * What Outcomes already knows about these decisions.
 *
 * ── Read, never recomputed ───────────────────────────────────────────────
 *
 * The move since the decision, the dollar impact, whether the outcome has been
 * reviewed and whether it has gone against the decision are all Outcomes'
 * answers: `useDecisionAccountability` builds accountability rows from the
 * `outcomes_payload` RPC, and `inferDecisionIntelligence` is the one place
 * that judges them. Computing a second version here is how two surfaces end up
 * disagreeing about the same trade.
 *
 * It costs one shared query: the same key Outcomes uses, so opening both pays
 * for one RPC. Keyed on `trade_queue_item_id`, which is an accountability
 * row's `decision_id` for anything acted on and a `DecisionRecord`'s `ideaId`.
 */
export function useDecisionOutcomeFacts() {
  const { rows, isLoading } = useDecisionAccountability()

  const byIdea = useMemo(() => {
    const out = new Map<string, OutcomeFacts>()
    for (const row of rows) {
      if (!row.decision_id) continue
      const intel = inferDecisionIntelligence(row)
      out.set(row.decision_id, {
        sincePct: row.move_since_decision_pct ?? row.move_since_execution_pct ?? null,
        pnl: row.impact_proxy ?? null,
        // The clearer relabelling of the same verdicts, already shared with
        // the phone: "Outcome not reviewed" rather than "Needs Context".
        verdictLabel: phoneStatusLabel(intel),
        // Outcomes' own bar for reviewed: quality assessed against the
        // execution, not a note on the request.
        reviewed: intel.verdict === 'resolved',
        hurting: intel.verdict === 'hurting',
        executed: row.execution_status === 'executed',
      })
    }
    return out
  }, [rows])

  /*
   * A batch's dollars, by Outcomes' own rule.
   *
   * `groupByBatch` already decides when a batch may report a total at all --
   * every trade in it needs its own P&L proxy, and none of them may belong to
   * a second batch, or the same dollars would be counted twice. Reusing it
   * means the Dashboard cannot say a different number from Outcomes, and it
   * keeps the deliberate absence of a batch return percentage.
   */
  const batchPnl = useMemo(() => {
    const items = rows.map(row => ({ row, intel: inferDecisionIntelligence(row) }))
    const out = new Map<string, BatchPnl>()
    for (const g of groupByBatch(items).groups) out.set(g.batch.id, g.pnl)
    return out
  }, [rows])

  const factsFor = useCallback(
    (d: { ideaId: string | null }) => (d.ideaId ? byIdea.get(d.ideaId) : undefined) ?? NO_OUTCOME_FACTS,
    [byIdea],
  )
  const pnlForBatch = useCallback((id: string | null | undefined) => (id ? batchPnl.get(id) ?? null : null), [batchPnl])

  return { factsFor, pnlForBatch, isLoading }
}

export interface DecisionDetail {
  /** Daily closes, from a floor before the decision where history allows. */
  history?: { date: string; close: number }[]
  /** Captured at decision time by the approval snapshot. Rare and durable. */
  priceAtDecision?: number
  /* --- current state, and labelled as current wherever it is shown --- */
  currentPrice?: number
  currentThesisUpdatedAt?: string | null
  currentEvidenceCount?: number
  currentWeightPct?: number
  currentIdeaStatus?: { stage: string | null; status: string | null; outcome: string | null } | null
}

const HISTORY_DAYS = 720

/**
 * Everything else, for the ONE selected decision.
 *
 * Deliberately mixes two kinds of fact and keeps them named apart: what was
 * captured at decision time (`priceAtDecision`) and what is true right now
 * (`current*`). The workspace never renders a current value under a historical
 * heading, and the field names are the first line of that defence.
 */
export function useDecisionDetail(decision: DecisionRecord | null) {
  const { currentOrgId } = useOrganization()
  const id = decision?.id ?? null
  const assetId = decision?.assetId ?? null
  const symbol = decision?.symbol ?? null

  const { data, isLoading } = useQuery<DecisionDetail>({
    queryKey: ['desktop-decisions', 'detail', id, currentOrgId],
    enabled: !!id && !!assetId && !!currentOrgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const floor = new Date(Date.now() - HISTORY_DAYS * DAY).toISOString().slice(0, 10)
      const [history, snapshot, contribs, notes, holdings, idea] = await Promise.all([
        symbol
          ? supabase.from('price_history_cache').select('date, close')
              .eq('symbol', symbol).gte('date', floor).order('date', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        // The one durable historical price. Scoped to this idea AND this book,
        // because an approval price belongs to one portfolio's decision.
        decision?.ideaId
          ? supabase.from('decision_price_snapshots')
              .select('snapshot_price, snapshot_at, snapshot_type')
              .eq('trade_queue_item_id', decision.ideaId)
              .eq('portfolio_id', decision.portfolioId)
              .order('snapshot_at', { ascending: false })
          : Promise.resolve({ data: [] as any[] }),
        // The decision is this organisation's; so is the thesis state and the
        // evidence count shown beside it. `asset_id` alone counted another
        // workspace's notes into this one's "current evidence".
        supabase.from('asset_contributions').select('section, updated_at')
          .eq('organization_id', currentOrgId!)
          .eq('asset_id', assetId!).eq('is_archived', false),
        supabase.from('asset_notes').select('id')
          .eq('organization_id', currentOrgId!)
          .eq('asset_id', assetId!).eq('is_deleted', false),
        supabase.from('portfolio_holdings')
          .select('portfolio_id, asset_id, shares, price, cost, date')
          .eq('portfolio_id', decision!.portfolioId),
        decision?.ideaId
          ? supabase.from('trade_queue_items').select('stage, status, outcome')
              .eq('id', decision.ideaId).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      const out: DecisionDetail = {}

      const series = ((history.data ?? []) as any[])
        .map(r => ({ date: r.date, close: Number(r.close) }))
        .filter(p => Number.isFinite(p.close))
      if (series.length >= 2) {
        out.history = series
        out.currentPrice = series[series.length - 1].close
      }

      const snap = ((snapshot as any).data ?? [])[0]
      const snapPrice = num(snap?.snapshot_price)
      if (snapPrice && snapPrice > 0) out.priceAtDecision = snapPrice

      // Current framework state, for the TODAY column only.
      const CORE = ['thesis', 'where_different', 'risks_to_thesis']
      let newest: string | null = null
      for (const c of ((contribs.data ?? []) as any[])) {
        if (!CORE.includes(c.section)) continue
        if (!newest || c.updated_at > newest) newest = c.updated_at
      }
      out.currentThesisUpdatedAt = newest
      out.currentEvidenceCount = ((notes.data ?? []) as any[]).length

      // Weight is derived through the shared holdings module, so Decisions,
      // Portfolio, Research and Ideas cannot disagree about what a name weighs.
      const { buildBook } = await import('../lib/portfolio/holdings')
      const book = buildBook(decision!.portfolioId, (holdings.data ?? []) as any[])
      const pos = book.positions.find(p => p.assetId === assetId)
      if (pos) out.currentWeightPct = pos.weightPct

      const q = (idea as any).data
      if (q) out.currentIdeaStatus = { stage: q.stage ?? null, status: q.status ?? null, outcome: q.outcome ?? null }

      return out
    },
  })

  void currentOrgId
  return { detail: data, isLoading }
}
