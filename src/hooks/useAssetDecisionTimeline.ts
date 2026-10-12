/**
 * useAssetDecisionTimeline — Derived read model for asset decision narrative.
 *
 * Runs parallel queries against existing tables, merges into a unified
 * DecisionTimelineEvent[] sorted by timestamp descending.
 *
 * Design principles:
 *   - Meaningful milestones only — no noisy audit trail
 *   - Rationale folded into trade execution unless captured materially later (>24h)
 *   - Proposal revisions excluded (only initial submission shown)
 *   - No new source-of-truth table — pure query-time derivation
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type {
  DecisionTimelineEvent,
  TimelineEventType,
  TimelinePhase,
  TimelineFilter,
  TimelineDisposition,
  ExecutionProof,
} from '../types/decision-timeline'
import { EVENT_PHASE, TERMINAL_DECISION_STATUSES } from '../types/decision-timeline'
/* Pure helpers live outside this module so the desktop harness, which
 * resolves THIS module to a fixture stub, does not also have to stub
 * them. Re-exported for callers that already import them from here. */
import {
  timelineSortKey,
  parseTimelineDate,
  isDateOnly,
  gradeExecutionProof,
} from '../lib/asset-decisions/timeline'

export { timelineSortKey, parseTimelineDate, isDateOnly, gradeExecutionProof }

// ============================================================
// Constants
// ============================================================

/** If rationale was captured within this window of the trade event, fold it in */
const RATIONALE_FOLD_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

const ACTION_LABELS: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  add: 'Add',
  trim: 'Trim',
  initiate: 'Initiate',
  exit: 'Exit',
  cover: 'Cover',
  short_initiate: 'Short',
  reduce: 'Reduce',
  rebalance: 'Rebalance',
  hedge: 'Hedge',
  other: 'Trade',
}

// ============================================================
// Helpers
// ============================================================

function getInitials(firstName: string | null, lastName: string | null): string {
  const f = firstName?.charAt(0)?.toUpperCase() ?? ''
  const l = lastName?.charAt(0)?.toUpperCase() ?? ''
  return f + l || '?'
}

function getFullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown'
}

function actionDisposition(action: string): TimelineDisposition {
  if (['buy', 'add', 'initiate'].includes(action)) return 'positive'
  if (['sell', 'trim', 'exit', 'short_initiate', 'reduce', 'cover'].includes(action)) return 'negative'
  return 'neutral'
}

// ============================================================
// Hook
// ============================================================

interface UseAssetDecisionTimelineOptions {
  assetId: string
  filter?: TimelineFilter
  portfolioId?: string | null
  enabled?: boolean
}

export function useAssetDecisionTimeline({
  assetId,
  filter = 'all',
  portfolioId = null,
  enabled = true,
}: UseAssetDecisionTimelineOptions) {
  const query = useQuery({
    queryKey: ['asset-decision-timeline', assetId, filter, portfolioId],
    queryFn: () => fetchTimeline(assetId, portfolioId),
    enabled: !!assetId && enabled,
    staleTime: 60_000,
  })

  // Apply client-side phase filter
  const allEvents = query.data ?? []
  const filtered = filter === 'all'
    ? allEvents
    : allEvents.filter(e => e.phase === filter)

  // Count by phase for filter badges
  const phaseCounts: Record<TimelinePhase | 'all', number> = {
    all: allEvents.length,
    exploratory: 0,
    formal: 0,
    execution: 0,
    review: 0,
  }
  for (const e of allEvents) {
    phaseCounts[e.phase]++
  }

  return {
    events: filtered,
    allEvents,
    phaseCounts,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

// ============================================================
// Data fetching + merge
// ============================================================

async function fetchTimeline(
  assetId: string,
  portfolioId: string | null,
): Promise<DecisionTimelineEvent[]> {
  // Fan out queries in parallel
  const [ideas, portfolioTracks, proposals, tradeEvents, outcomes, acceptedTrades, thesisEvents] =
    await Promise.all([
      fetchIdeas(assetId),
      fetchPortfolioDecisions(assetId),
      fetchRecommendations(assetId),
      fetchTradeEvents(assetId, portfolioId),
      fetchOutcomes(assetId),
      fetchAcceptedTrades(assetId, portfolioId),
      fetchThesisEvents(assetId),
    ])

  /*
   * Reviews are keyed on the decision they reviewed, so they can only be
   * fetched once the decision ids are known. `decision_reviews.decision_id`
   * is polymorphic — see `useUpsertDecisionReview` — so every id this
   * timeline knows about is offered and only the ones that match come back.
   *
   * `decision_reviews` is tenant-safe since PR #251; its own policy scopes
   * the read, so this does not add an org predicate of its own.
   */
  const reviewableIds = [
    ...proposals.map(p => p.id),
    ...ideas.map(i => i.id),
    ...tradeEvents.events.map(e => e.id),
  ]
  const reviews = await fetchDecisionReviews(reviewableIds)

  // Build rationale map for folding into trade events
  const rationaleMap = new Map<string, { reason: string; authoredAt: string }>()
  for (const te of tradeEvents.withRationale) {
    if (te.rationaleReason) {
      rationaleMap.set(te.eventId, {
        reason: te.rationaleReason,
        authoredAt: te.rationaleAuthoredAt!,
      })
    }
  }

  const events: DecisionTimelineEvent[] = []

  // --- 1. Idea created events ---
  for (const idea of ideas) {
    events.push({
      id: `idea_created:${idea.id}`,
      type: 'idea_created',
      phase: 'exploratory',
      timestamp: idea.created_at,
      title: `${ACTION_LABELS[idea.action] ?? idea.action} idea created`,
      subtitle: idea.rationale || null,
      actor: idea.creator
        ? {
            name: getFullName(idea.creator.first_name, idea.creator.last_name),
            initials: getInitials(idea.creator.first_name, idea.creator.last_name),
          }
        : null,
      portfolio: idea.portfolio,
      sizing: null,
      rationale: null,
      sourceRef: { type: 'trade_idea', id: idea.id },
      executionProof: null,
      provenance: {
        table: 'trade_queue_items',
        rowId: idea.id,
        ideaId: idea.id,
        portfolioId: idea.portfolio?.id ?? null,
      },
      disposition: actionDisposition(idea.action),
    })
  }

  // --- 2. Idea escalated to deciding ---
  for (const track of portfolioTracks) {
    if (track.stage === 'deciding') {
      events.push({
        id: `idea_escalated:${track.id}`,
        type: 'idea_escalated',
        phase: 'exploratory',
        timestamp: track.updated_at,
        title: 'Escalated to deciding',
        subtitle: null,
        actor: null,
        portfolio: track.portfolio,
        sizing: null,
        rationale: null,
        sourceRef: { type: 'trade_idea', id: track.trade_queue_item_id },
        executionProof: null,
        provenance: {
          table: 'trade_idea_portfolios',
          rowId: track.id,
          ideaId: track.trade_queue_item_id,
          portfolioId: track.portfolio?.id ?? null,
        },
        disposition: 'neutral',
      })
    }

    /*
     * `trade_idea_portfolios.decision_outcome` used to produce the PM ruling
     * here and no longer does. It is 95% blank in production — 37 rows, 2
     * outcomes, ZERO reasons — so a timeline built on it showed almost no
     * decisions and no reasons at all. The ruling is written to
     * `decision_requests.status` / `reviewed_at`, which is what
     * `useDesktopDecisions` reads, and it is emitted in step 4 below from the
     * same rows that carry the recommendation.
     */
  }

  // --- 4. Recommendation submitted (first per user per portfolio only) ---
  const seenRecs = new Set<string>()
  for (const rec of proposals) {
    // Deduplicate: one entry per user+portfolio combination
    const dedupeKey = `${rec.user_id}:${rec.portfolio_id}`
    if (seenRecs.has(dedupeKey)) continue
    seenRecs.add(dedupeKey)

    const sizingLabel = rec.weight != null
      ? `${rec.weight}%`
      : rec.shares != null
        ? `#${rec.shares.toLocaleString()}`
        : null

    events.push({
      id: `proposal_submitted:${rec.id}`,
      type: 'proposal_submitted',
      phase: 'formal',
      timestamp: rec.created_at,
      title: `Recommendation submitted${sizingLabel ? ` — ${sizingLabel}` : ''}`,
      subtitle: rec.notes || null,
      actor: rec.user
        ? {
            name: getFullName(rec.user.first_name, rec.user.last_name),
            initials: getInitials(rec.user.first_name, rec.user.last_name),
          }
        : null,
      portfolio: rec.portfolio,
      sizing: rec.weight != null || rec.shares != null
        ? {
            action: rec.action ?? 'trade',
            weightDelta: null,
            sharesDelta: null,
            weightBefore: null,
            weightAfter: rec.weight,
          }
        : null,
      rationale: null,
      sourceRef: { type: 'decision_request', id: rec.id },
      executionProof: null,
      provenance: {
        table: 'decision_requests',
        rowId: rec.id,
        ideaId: rec.trade_queue_item_id,
        portfolioId: rec.portfolio_id,
      },
      disposition: 'neutral',
    })
  }

  /*
   * --- 4b. The PM's ruling, from the SAME decision_requests rows.
   *
   * Not deduplicated, unlike the submission above: every ruling is a distinct
   * act by a named person at a named time, and collapsing two rulings on one
   * asset would hide a reversal. A request with no terminal status has not
   * been ruled on and produces nothing — "pending" is not a decision.
   */
  for (const rec of proposals) {
    if (!rec.status || !TERMINAL_DECISION_STATUSES.includes(rec.status)) continue

    const type: TimelineEventType =
      rec.status === 'accepted' || rec.status === 'accepted_with_modification'
        ? 'decision_accepted'
        : rec.status === 'rejected'
          ? 'decision_rejected'
          : 'decision_deferred'

    const actionLabel = ACTION_LABELS[rec.action ?? ''] ?? 'Trade'
    const modified = rec.status === 'accepted_with_modification'
    const deferredTo = rec.status === 'deferred' && rec.deferred_until
      ? ` until ${rec.deferred_until.slice(0, 10)}`
      : ''

    events.push({
      id: `${type}:${rec.id}`,
      type,
      phase: 'formal',
      /*
       * `reviewed_at` is when the PM ruled. Falling back to `updated_at`
       * would date the ruling to the last touch of any kind, so a row with a
       * terminal status and no `reviewed_at` is dated by `created_at` and is
       * visibly undated rather than silently misdated.
       */
      timestamp: rec.reviewed_at || rec.created_at,
      title: `${actionLabel} — ${
        type === 'decision_accepted'
          ? modified ? 'Accepted (modified)' : 'Accepted'
          : type === 'decision_rejected' ? 'Rejected' : `Deferred${deferredTo}`
      }`,
      subtitle: rec.decision_note || null,
      actor: rec.reviewer
        ? {
            name: getFullName(rec.reviewer.first_name, rec.reviewer.last_name),
            initials: getInitials(rec.reviewer.first_name, rec.reviewer.last_name),
          }
        : null,
      portfolio: rec.portfolio,
      sizing: null,
      rationale: null,
      sourceRef: { type: 'decision_request', id: rec.id },
      // A ruling is not an execution. This stays null even when the request
      // already points at an accepted trade.
      executionProof: null,
      provenance: {
        table: 'decision_requests',
        rowId: rec.id,
        ideaId: rec.trade_queue_item_id,
        portfolioId: rec.portfolio_id,
        acceptedTradeId: rec.accepted_trade_id,
      },
      disposition:
        type === 'decision_accepted' ? 'positive'
          : type === 'decision_rejected' ? 'negative'
            : 'deferred',
    })
  }

  /*
   * --- 4c. Withdrawn requests.
   *
   * 29 of 111 requests in production are withdrawn. A withdrawal is not a
   * rejection — nobody ruled — so it gets its own type and a neutral
   * disposition rather than being folded in with rejections.
   */
  for (const rec of proposals) {
    if (rec.status !== 'withdrawn') continue
    events.push({
      id: `decision_withdrawn:${rec.id}`,
      type: 'decision_withdrawn',
      phase: 'formal',
      timestamp: rec.reviewed_at || rec.created_at,
      title: `${ACTION_LABELS[rec.action ?? ''] ?? 'Trade'} — Withdrawn`,
      subtitle: rec.decision_note || 'Withdrawn before a decision was made',
      actor: null,
      portfolio: rec.portfolio,
      sizing: null,
      rationale: null,
      sourceRef: { type: 'decision_request', id: rec.id },
      executionProof: null,
      provenance: {
        table: 'decision_requests',
        rowId: rec.id,
        ideaId: rec.trade_queue_item_id,
        portfolioId: rec.portfolio_id,
      },
      disposition: 'neutral',
    })
  }

  /*
   * --- 4d. Committed trades, and commitments that never executed.
   *
   * `accepted_trades` is the ONLY committed trade record in this system.
   * Without it the timeline could not render "decided but not executed" at
   * all — it would show a decision and then nothing, which reads as if the
   * decision were never acted on when in fact it is waiting.
   */
  for (const t of acceptedTrades) {
    const actionLabel = ACTION_LABELS[t.action] ?? t.action
    const executed = t.execution_status === 'complete'

    const sizeBits: string[] = []
    if (t.delta_weight != null && t.delta_weight !== 0) {
      const sign = t.delta_weight > 0 ? '+' : ''
      sizeBits.push(`${sign}${(t.delta_weight * 100).toFixed(0)}bps`)
    }
    if (t.delta_shares != null && t.delta_shares !== 0) {
      const sign = t.delta_shares > 0 ? '+' : ''
      sizeBits.push(`${sign}${t.delta_shares.toLocaleString()} shs`)
    }
    const sizeLabel = sizeBits.length ? ` — ${sizeBits.join(', ')}` : ''

    events.push({
      id: `${executed ? 'trade_committed' : 'execution_pending'}:${t.id}`,
      type: executed ? 'trade_committed' : 'execution_pending',
      phase: 'execution',
      timestamp: t.created_at,
      title: executed
        ? `${actionLabel} committed${sizeLabel}`
        : `${actionLabel} committed, awaiting execution${sizeLabel}`,
      subtitle: executed
        ? t.acceptance_note || null
        : t.acceptance_note
          || `Committed${t.source ? ` from ${t.source}` : ''}; the book has not moved`,
      actor: t.accepted_by_user
        ? {
            name: getFullName(t.accepted_by_user.first_name, t.accepted_by_user.last_name),
            initials: getInitials(t.accepted_by_user.first_name, t.accepted_by_user.last_name),
          }
        : null,
      portfolio: t.portfolio,
      sizing: {
        action: t.action,
        weightDelta: t.delta_weight,
        sharesDelta: t.delta_shares,
        weightBefore: null,
        weightAfter: t.target_weight,
      },
      rationale: null,
      sourceRef: { type: 'accepted_trade', id: t.id },
      // Commitment is not observation. The proof grade belongs on the
      // execution event, which is the row that claims the book moved.
      executionProof: null,
      provenance: {
        table: 'accepted_trades',
        rowId: t.id,
        portfolioId: t.portfolio?.id ?? null,
        batchId: t.batch_id,
        acceptedTradeId: t.id,
      },
      disposition: executed ? actionDisposition(t.action) : 'deferred',
    })
  }

  // --- 5. Trade execution events (with folded rationale) ---
  for (const te of tradeEvents.events) {
    const actionLabel = ACTION_LABELS[te.action_type] ?? te.action_type
    const rat = rationaleMap.get(te.id)

    // Determine if rationale should be folded in
    let foldedRationale: string | null = null
    if (rat) {
      const eventTime = new Date(te.event_date).getTime()
      const rationaleTime = new Date(rat.authoredAt).getTime()
      const gap = Math.abs(rationaleTime - eventTime)
      if (gap <= RATIONALE_FOLD_WINDOW_MS) {
        foldedRationale = rat.reason
      }
      // If gap > 24h, rationale is NOT shown as a separate event either —
      // it stays accessible via the trade journal. This keeps the timeline clean.
    }

    // Build sizing subtitle
    const sizingParts: string[] = []
    if (te.weight_delta != null && te.weight_delta !== 0) {
      const sign = te.weight_delta > 0 ? '+' : ''
      sizingParts.push(`${sign}${(te.weight_delta * 100).toFixed(0)}bps`)
    }
    if (te.quantity_delta != null && te.quantity_delta !== 0) {
      const sign = te.quantity_delta > 0 ? '+' : ''
      sizingParts.push(`${sign}${te.quantity_delta.toLocaleString()} shs`)
    }

    events.push({
      id: `trade_executed:${te.id}`,
      type: 'trade_executed',
      phase: 'execution',
      timestamp: te.event_date,
      title: `${actionLabel}${sizingParts.length > 0 ? ` — ${sizingParts.join(', ')}` : ''}`,
      /*
       * No subtitle. It was `te.portfolio_name`, which this event already
       * carries in `portfolio` below — and both surfaces render the meta line
       * from that field, so every execution row printed its book twice, one
       * line under the other:
       *
       *     Add — +45bps, +12,000 shs
       *     Tech & Consumer Growth        <- subtitle
       *     Tech & Consumer Growth        <- meta line
       *
       * Fixed here rather than by suppressing it in each renderer: it is one
       * fact, and the duplication is at the source. Nothing is lost — the
       * portfolio is still on the event, still in the meta line, and still
       * what the book filter matches on.
       */
      subtitle: null,
      actor: te.created_by_user
        ? {
            name: getFullName(te.created_by_user.first_name, te.created_by_user.last_name),
            initials: getInitials(te.created_by_user.first_name, te.created_by_user.last_name),
          }
        : null,
      portfolio: te.portfolio_id
        ? { id: te.portfolio_id, name: te.portfolio_name || 'Portfolio' }
        : null,
      sizing: {
        action: te.action_type,
        weightDelta: te.weight_delta,
        sharesDelta: te.quantity_delta,
        weightBefore: te.weight_before,
        weightAfter: te.weight_after,
      },
      rationale: foldedRationale,
      sourceRef: { type: 'trade_event', id: te.id },
      // The only event that carries a proof grade, because it is the only
      // one that claims the portfolio actually moved.
      executionProof: gradeExecutionProof(te),
      provenance: {
        table: 'portfolio_trade_events',
        rowId: te.id,
        ideaId: te.linked_trade_idea_id,
        portfolioId: te.portfolio_id,
        acceptedTradeId: te.accepted_trade_id,
      },
      disposition: actionDisposition(te.action_type),
    })
  }

  // --- 6. Outcome evaluations ---
  for (const outcome of outcomes) {
    const isHit = outcome.status === 'hit'
    const isMissed = outcome.status === 'missed'
    const priceInfo = outcome.target_price
      ? `$${outcome.target_price.toFixed(2)}`
      : null

    events.push({
      id: `outcome_evaluated:${outcome.id}`,
      type: 'outcome_evaluated',
      phase: 'review',
      timestamp: outcome.evaluated_at || outcome.updated_at,
      title: `Price target ${outcome.status}${priceInfo ? ` — ${priceInfo}` : ''}`,
      subtitle: outcome.accuracy_pct != null
        ? `${outcome.accuracy_pct.toFixed(0)}% accuracy`
        : null,
      actor: outcome.user
        ? {
            name: getFullName(outcome.user.first_name, outcome.user.last_name),
            initials: getInitials(outcome.user.first_name, outcome.user.last_name),
          }
        : null,
      portfolio: null,
      sizing: null,
      rationale: null,
      sourceRef: { type: 'outcome', id: outcome.id },
      executionProof: null,
      provenance: { table: 'price_target_outcomes', rowId: outcome.id },
      disposition: isHit ? 'positive' : isMissed ? 'negative' : 'neutral',
    })
  }

  // --- 7. Decision reviews ---
  for (const r of reviews) {
    events.push({
      id: `review_recorded:${r.id}`,
      type: 'review_recorded',
      phase: 'review',
      timestamp: r.created_at,
      title: r.decision_quality
        ? `Decision reviewed — ${r.decision_quality}`
        : 'Decision reviewed',
      subtitle: r.process_note || null,
      actor: r.reviewer
        ? {
            name: getFullName(r.reviewer.first_name, r.reviewer.last_name),
            initials: getInitials(r.reviewer.first_name, r.reviewer.last_name),
          }
        : null,
      portfolio: null,
      sizing: null,
      rationale: null,
      sourceRef: { type: 'review', id: r.id },
      executionProof: null,
      provenance: { table: 'decision_reviews', rowId: r.id },
      disposition:
        r.decision_quality === 'good' ? 'positive'
          : r.decision_quality === 'bad' ? 'negative'
            : 'neutral',
    })
  }

  // --- 8. Thesis changes ---
  for (const m of thesisEvents) {
    events.push({
      id: `thesis_changed:${m.id}`,
      type: 'thesis_changed',
      phase: 'exploratory',
      timestamp: m.occurred_at,
      title: m.event_type ? `Thesis — ${m.event_type.replace(/_/g, ' ')}` : 'Thesis changed',
      subtitle: m.source_field || null,
      actor: m.actor
        ? {
            name: getFullName(m.actor.first_name, m.actor.last_name),
            initials: getInitials(m.actor.first_name, m.actor.last_name),
          }
        : null,
      portfolio: null,
      sizing: null,
      rationale: null,
      sourceRef: { type: 'memory_event', id: m.id },
      executionProof: null,
      provenance: { table: 'memory_events', rowId: m.id },
      disposition: 'neutral',
    })
  }

  /*
   * Sort on parsed epoch time, not on the string. `event_date` is a DATE and
   * everything else is `timestamptz`, so `localeCompare` sorted every
   * execution below its own day's decisions — see `timelineSortKey`.
   */
  events.sort((a, b) => timelineSortKey(b.timestamp) - timelineSortKey(a.timestamp))

  // Apply portfolio filter
  if (portfolioId) {
    return events.filter(e => !e.portfolio || e.portfolio.id === portfolioId)
  }

  return events
}

// ============================================================
// Individual query functions
// ============================================================

interface IdeaRow {
  id: string
  action: string
  rationale: string | null
  created_at: string
  creator: { first_name: string | null; last_name: string | null } | null
  portfolio: { id: string; name: string } | null
}

async function fetchIdeas(assetId: string): Promise<IdeaRow[]> {
  const { data, error } = await supabase
    .from('trade_queue_items')
    .select(`
      id,
      action,
      rationale,
      created_at,
      origin_metadata,
      users:created_by (first_name, last_name),
      portfolios:portfolio_id (id, name)
    `)
    .eq('asset_id', assetId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error

  return (data || []).map((row: any) => ({
    id: row.id,
    action: row.action || 'buy',
    rationale: row.rationale,
    created_at: row.created_at,
    // Pilot-seeded ideas show as authored by "Pilot" (a synthetic
    // persona) regardless of the real created_by, so the user doesn't
    // see the platform admin or their own name attached to demo data.
    creator: row.origin_metadata?.pilot_seed === true
      ? { first_name: 'Pilot', last_name: null }
      : (row.users || null),
    portfolio: row.portfolios || null,
  }))
}

interface PortfolioTrackRow {
  id: string
  trade_queue_item_id: string
  stage: string
  action: string
  decision_outcome: string | null
  decision_reason: string | null
  decided_at: string | null
  updated_at: string
  portfolio: { id: string; name: string } | null
  decided_by_user: { first_name: string | null; last_name: string | null } | null
}

async function fetchPortfolioDecisions(assetId: string): Promise<PortfolioTrackRow[]> {
  // Get trade_queue_item IDs for this asset first
  const { data: items, error: itemsErr } = await supabase
    .from('trade_queue_items')
    .select('id, action')
    .eq('asset_id', assetId)

  if (itemsErr) throw itemsErr
  if (!items || items.length === 0) return []

  const itemIds = items.map(i => i.id)
  const actionMap = new Map(items.map(i => [i.id, i.action || 'buy']))

  const { data, error } = await supabase
    .from('trade_idea_portfolios')
    .select(`
      id,
      trade_queue_item_id,
      stage,
      decision_outcome,
      decision_reason,
      decided_at,
      updated_at,
      portfolio:portfolio_id (id, name),
      decided_by_user:decided_by (first_name, last_name)
    `)
    .in('trade_queue_item_id', itemIds)
    .order('updated_at', { ascending: false })

  if (error) throw error

  return (data || []).map((row: any) => ({
    id: row.id,
    trade_queue_item_id: row.trade_queue_item_id,
    stage: row.stage,
    action: actionMap.get(row.trade_queue_item_id) || 'buy',
    decision_outcome: row.decision_outcome,
    decision_reason: row.decision_reason,
    decided_at: row.decided_at,
    updated_at: row.updated_at,
    portfolio: row.portfolio || null,
    decided_by_user: row.decided_by_user || null,
  }))
}

interface RecommendationRow {
  id: string
  trade_queue_item_id: string
  user_id: string
  portfolio_id: string
  action: string | null
  weight: number | null
  shares: number | null
  notes: string | null
  created_at: string
  user: { first_name: string | null; last_name: string | null } | null
  portfolio: { id: string; name: string } | null
  // The PM's ruling, from the same row. See step 4b in fetchTimeline.
  status: string | null
  reviewed_at: string | null
  decision_note: string | null
  deferred_until: string | null
  accepted_trade_id: string | null
  reviewer: { first_name: string | null; last_name: string | null } | null
}

async function fetchRecommendations(assetId: string): Promise<RecommendationRow[]> {
  // Get trade_queue_item IDs for this asset, plus origin_metadata so we
  // can override the displayed author for pilot-seeded recommendations.
  const { data: items, error: itemsErr } = await supabase
    .from('trade_queue_items')
    .select('id, action, origin_metadata')
    .eq('asset_id', assetId)

  if (itemsErr) throw itemsErr
  if (!items || items.length === 0) return []

  const itemIds = items.map(i => i.id)
  const actionMap = new Map(items.map(i => [i.id, i.action]))
  const pilotSeededItemIds = new Set(
    items.filter((i: any) => i.origin_metadata?.pilot_seed === true).map(i => i.id)
  )

  // Read from decision_requests + submission_snapshot instead of trade_proposals
  const { data, error } = await supabase
    .from('decision_requests')
    .select(`
      id,
      trade_queue_item_id,
      requested_by,
      portfolio_id,
      requested_action,
      submission_snapshot,
      created_at,
      status,
      reviewed_at,
      decision_note,
      deferred_until,
      accepted_trade_id,
      requester:requested_by (first_name, last_name),
      reviewer:users!decision_requests_reviewed_by_fkey (first_name, last_name),
      portfolio:portfolio_id (id, name)
    `)
    .in('trade_queue_item_id', itemIds)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []).map((row: any) => {
    const snap = row.submission_snapshot as Record<string, any> | null
    const isPilotSeeded = pilotSeededItemIds.has(row.trade_queue_item_id)
    return {
      id: row.id,
      trade_queue_item_id: row.trade_queue_item_id,
      user_id: row.requested_by,
      portfolio_id: row.portfolio_id,
      action: snap?.action || row.requested_action || actionMap.get(row.trade_queue_item_id) || null,
      weight: snap?.weight ?? null,
      shares: snap?.shares ?? null,
      notes: snap?.notes ?? null,
      created_at: snap?.submitted_at || row.created_at,
      // Override author display for pilot-seeded data — see fetchIdeas.
      user: isPilotSeeded
        ? { first_name: 'Pilot', last_name: null }
        : (row.requester || null),
      portfolio: row.portfolio || null,
      status: row.status ?? null,
      reviewed_at: row.reviewed_at ?? null,
      decision_note: row.decision_note ?? null,
      deferred_until: row.deferred_until ?? null,
      accepted_trade_id: row.accepted_trade_id ?? null,
      // The ruling's author is NOT overridden for pilot data: a pilot-seeded
      // idea can be ruled on by a real PM, and attributing their decision to
      // a synthetic persona would misreport who decided.
      reviewer: row.reviewer || null,
    }
  })
}

// ---------------------------------------------------------------------------
// accepted_trades — the only committed trade record
// ---------------------------------------------------------------------------

interface AcceptedTradeRow {
  id: string
  action: string
  execution_status: string | null
  source: string | null
  acceptance_note: string | null
  target_weight: number | null
  delta_weight: number | null
  delta_shares: number | null
  batch_id: string | null
  created_at: string
  portfolio: { id: string; name: string } | null
  accepted_by_user: { first_name: string | null; last_name: string | null } | null
}

async function fetchAcceptedTrades(
  assetId: string,
  portfolioId: string | null,
): Promise<AcceptedTradeRow[]> {
  /*
   * `is_active` filters reverted trades out. A reverted commitment is not a
   * commitment that stands, and showing it as one would overstate the book.
   * The revert itself remains visible through `portfolio_trade_events`.
   */
  let query = supabase
    .from('accepted_trades')
    .select(`
      id,
      action,
      execution_status,
      source,
      acceptance_note,
      target_weight,
      delta_weight,
      delta_shares,
      batch_id,
      created_at,
      accepted_by,
      portfolio:portfolio_id (id, name)
    `)
    .eq('asset_id', assetId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(50)

  if (portfolioId) query = query.eq('portfolio_id', portfolioId)

  const { data, error } = await query
  if (error) throw error

  const rows = (data || []) as any[]

  /*
   * The actor's name, resolved SEPARATELY — and this is the bug that broke
   * Decision Memory in the authenticated app.
   *
   * `accepted_trades.accepted_by` is a foreign key to **auth.users**, not
   * `public.users`. PostgREST cannot embed through it: `auth` is not an
   * exposed schema and `auth.users` has no `first_name` column at all. The
   * embed `users!accepted_trades_accepted_by_fkey(first_name, last_name)`
   * therefore failed the WHOLE request, which threw, which surfaced as
   * "Decision history could not be loaded" on both the Snapshot and the
   * Decisions tab — they share this hook.
   *
   * `fetchTradeEvents` already carried the comment "FK references auth.users
   * — can't join directly". The same trap, one function below, and I walked
   * into it.
   *
   * The ids DO resolve in `public.users` (verified: 50 of 50 in production),
   * so one keyed lookup gets the names. A failure here degrades to unnamed
   * actors rather than taking the narrative down.
   */
  const actorIds = [...new Set(rows.map(r => r.accepted_by).filter(Boolean))]
  const actorNames = new Map<string, { first_name: string | null; last_name: string | null }>()
  if (actorIds.length > 0) {
    const { data: people, error: peopleErr } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .in('id', actorIds)
    if (peopleErr) {
      console.warn('[DecisionTimeline] accepted_trades actor lookup failed', peopleErr)
    } else {
      for (const p of (people || []) as any[]) {
        actorNames.set(p.id, { first_name: p.first_name, last_name: p.last_name })
      }
    }
  }

  return rows.map((row: any) => ({
    id: row.id,
    action: row.action || 'buy',
    execution_status: row.execution_status,
    source: row.source,
    acceptance_note: row.acceptance_note,
    target_weight: row.target_weight != null ? Number(row.target_weight) : null,
    delta_weight: row.delta_weight != null ? Number(row.delta_weight) : null,
    delta_shares: row.delta_shares != null ? Number(row.delta_shares) : null,
    batch_id: row.batch_id ?? null,
    created_at: row.created_at,
    portfolio: row.portfolio || null,
    accepted_by_user: row.accepted_by ? actorNames.get(row.accepted_by) ?? null : null,
  }))
}

// ---------------------------------------------------------------------------
// decision_reviews — tenant-safe since PR #251
// ---------------------------------------------------------------------------

interface ReviewRow {
  id: string
  decision_id: string
  decision_quality: string | null
  process_note: string | null
  created_at: string
  reviewer: { first_name: string | null; last_name: string | null } | null
}

async function fetchDecisionReviews(decisionIds: string[]): Promise<ReviewRow[]> {
  const ids = [...new Set(decisionIds.filter(Boolean))]
  if (ids.length === 0) return []

  /*
   * `decision_reviews.decision_id` is TEXT and polymorphic — it may name a
   * trade_queue_item, a decision_request or a portfolio_trade_event (see
   * `useUpsertDecisionReview`). So every id this timeline knows is offered
   * and the table answers for the ones it holds.
   *
   * Reads are org-scoped by the table's own policy since PR #251; this adds
   * no predicate of its own and must not, or it would be asserting a
   * boundary the policy already owns.
   */
  const { data, error } = await supabase
    .from('decision_reviews')
    .select(`
      id,
      decision_id,
      decision_quality,
      process_note,
      created_at,
      reviewed_by
    `)
    .in('decision_id', ids)
    .order('created_at', { ascending: false })
    .limit(50)

  // A missing grant here must not blank the whole timeline.
  if (error) {
    console.warn('[DecisionTimeline] decision_reviews read failed', error)
    return []
  }

  const rows = (data || []) as any[]

  /*
   * Same trap as `accepted_trades`: `decision_reviews.reviewed_by` is a
   * foreign key to **auth.users**, so it cannot be embedded. This one was
   * already inside a try/warn, so it degraded to "no reviews" instead of
   * breaking the page — which is worse in one way, because it failed
   * SILENTLY and reviews simply never appeared.
   *
   * Verified in production: all 7 `reviewed_by` ids resolve in `public.users`.
   */
  const reviewerIds = [...new Set(rows.map(r => r.reviewed_by).filter(Boolean))]
  const names = new Map<string, { first_name: string | null; last_name: string | null }>()
  if (reviewerIds.length > 0) {
    const { data: people } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .in('id', reviewerIds)
    for (const p of (people || []) as any[]) {
      names.set(p.id, { first_name: p.first_name, last_name: p.last_name })
    }
  }

  return rows.map((row: any) => ({
    id: row.id,
    decision_id: row.decision_id,
    decision_quality: row.decision_quality,
    process_note: row.process_note,
    created_at: row.created_at,
    reviewer: row.reviewed_by ? names.get(row.reviewed_by) ?? null : null,
  }))
}

// ---------------------------------------------------------------------------
// memory_events — the thesis verb
// ---------------------------------------------------------------------------

interface ThesisEventRow {
  id: string
  event_type: string | null
  source_field: string | null
  occurred_at: string
  actor: { first_name: string | null; last_name: string | null } | null
}

async function fetchThesisEvents(assetId: string): Promise<ThesisEventRow[]> {
  const { data, error } = await supabase
    .from('memory_events')
    .select(`
      id,
      event_type,
      source_field,
      occurred_at,
      actor:users!memory_events_actor_id_fkey (first_name, last_name)
    `)
    .eq('subject_type', 'asset')
    .eq('subject_id', assetId)
    .order('occurred_at', { ascending: false })
    .limit(25)

  if (error) {
    console.warn('[DecisionTimeline] memory_events read failed', error)
    return []
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    event_type: row.event_type,
    source_field: row.source_field,
    occurred_at: row.occurred_at,
    actor: row.actor || null,
  }))
}

interface TradeEventRow {
  id: string
  portfolio_id: string
  portfolio_name: string | null
  action_type: string
  event_date: string
  quantity_delta: number | null
  weight_delta: number | null
  weight_before: number | null
  weight_after: number | null
  created_by_user: { first_name: string | null; last_name: string | null } | null
  /* Execution provenance. Without these three the grades of proof are
   * indistinguishable and the page can only say "executed". */
  source_type: string | null
  detected_by_system: boolean | null
  metadata: Record<string, unknown> | null
  linked_trade_idea_id: string | null
  accepted_trade_id: string | null
}

interface TradeEventWithRationale {
  eventId: string
  rationaleReason: string | null
  rationaleAuthoredAt: string | null
}

async function fetchTradeEvents(
  assetId: string,
  portfolioId: string | null,
): Promise<{ events: TradeEventRow[]; withRationale: TradeEventWithRationale[] }> {
  let query = supabase
    .from('portfolio_trade_events')
    .select(`
      id,
      portfolio_id,
      action_type,
      event_date,
      quantity_delta,
      weight_delta,
      weight_before,
      weight_after,
      created_by,
      source_type,
      detected_by_system,
      metadata,
      linked_trade_idea_id,
      portfolios:portfolio_id (id, name)
    `)
    .eq('asset_id', assetId)
    .order('event_date', { ascending: false })
    .limit(50)

  if (portfolioId) {
    query = query.eq('portfolio_id', portfolioId)
  }

  const { data, error } = await query
  if (error) throw error

  const events: TradeEventRow[] = (data || []).map((row: any) => ({
    id: row.id,
    portfolio_id: row.portfolio_id,
    portfolio_name: row.portfolios?.name || null,
    action_type: row.action_type,
    event_date: row.event_date,
    quantity_delta: row.quantity_delta,
    weight_delta: row.weight_delta,
    weight_before: row.weight_before,
    weight_after: row.weight_after,
    created_by_user: null, // FK references auth.users — can't join directly
    source_type: row.source_type ?? null,
    detected_by_system: row.detected_by_system ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    linked_trade_idea_id: row.linked_trade_idea_id ?? null,
    // The writer stores the accepted trade in metadata, not a column.
    accepted_trade_id:
      typeof (row.metadata as any)?.accepted_trade_id === 'string'
        ? (row.metadata as any).accepted_trade_id
        : null,
  }))

  // Fetch rationales for these events
  const eventIds = events.map(e => e.id)
  let withRationale: TradeEventWithRationale[] = []

  if (eventIds.length > 0) {
    const { data: rationales } = await supabase
      .from('trade_event_rationales')
      .select('trade_event_id, reason_for_action, authored_at')
      .in('trade_event_id', eventIds)
      .order('version_number', { ascending: false })

    if (rationales) {
      // Keep latest version per event
      const seen = new Set<string>()
      for (const r of rationales) {
        if (!seen.has(r.trade_event_id)) {
          seen.add(r.trade_event_id)
          withRationale.push({
            eventId: r.trade_event_id,
            rationaleReason: r.reason_for_action,
            rationaleAuthoredAt: r.authored_at,
          })
        }
      }
    }
  }

  return { events, withRationale }
}

interface OutcomeRow {
  id: string
  status: string
  target_price: number | null
  accuracy_pct: number | null
  evaluated_at: string | null
  updated_at: string
  user: { first_name: string | null; last_name: string | null } | null
}

async function fetchOutcomes(assetId: string): Promise<OutcomeRow[]> {
  const { data, error } = await supabase
    .from('price_target_outcomes')
    .select(`
      id,
      status,
      target_price,
      accuracy_pct,
      evaluated_at,
      updated_at,
      user:users!price_target_outcomes_user_id_fkey(first_name, last_name)
    `)
    .eq('asset_id', assetId)
    .in('status', ['hit', 'missed', 'expired'])
    .order('evaluated_at', { ascending: false, nullsFirst: false })
    .limit(20)

  if (error) throw error

  return (data || []).map((row: any) => ({
    id: row.id,
    status: row.status,
    target_price: row.target_price != null ? Number(row.target_price) : null,
    accuracy_pct: row.accuracy_pct != null ? Number(row.accuracy_pct) : null,
    evaluated_at: row.evaluated_at,
    updated_at: row.updated_at,
    user: row.user || null,
  }))
}
