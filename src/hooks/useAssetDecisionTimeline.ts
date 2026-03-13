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
} from '../types/decision-timeline'
import { EVENT_PHASE } from '../types/decision-timeline'

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
  const [ideas, portfolioTracks, proposals, tradeEvents, outcomes] = await Promise.all([
    fetchIdeas(assetId),
    fetchPortfolioDecisions(assetId),
    fetchProposals(assetId),
    fetchTradeEvents(assetId, portfolioId),
    fetchOutcomes(assetId),
  ])

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
        disposition: 'neutral',
      })
    }

    // --- 3. Decision outcomes ---
    if (track.decision_outcome && track.decided_at) {
      const decType = `decision_${track.decision_outcome}` as TimelineEventType
      events.push({
        id: `${decType}:${track.id}`,
        type: decType,
        phase: 'formal',
        timestamp: track.decided_at,
        title: track.decision_outcome === 'accepted'
          ? `${ACTION_LABELS[track.action] ?? 'Trade'} — Accepted`
          : track.decision_outcome === 'rejected'
            ? `${ACTION_LABELS[track.action] ?? 'Trade'} — Rejected`
            : `${ACTION_LABELS[track.action] ?? 'Trade'} — Deferred`,
        subtitle: track.decision_reason || null,
        actor: track.decided_by_user
          ? {
              name: getFullName(track.decided_by_user.first_name, track.decided_by_user.last_name),
              initials: getInitials(track.decided_by_user.first_name, track.decided_by_user.last_name),
            }
          : null,
        portfolio: track.portfolio,
        sizing: null,
        rationale: null,
        sourceRef: { type: 'decision', id: track.id },
        disposition: track.decision_outcome === 'accepted'
          ? 'positive'
          : track.decision_outcome === 'rejected'
            ? 'negative'
            : 'deferred',
      })
    }
  }

  // --- 4. Proposal submitted (first per user per portfolio only) ---
  const seenProposals = new Set<string>()
  for (const proposal of proposals) {
    // Deduplicate: one entry per user+portfolio combination
    const dedupeKey = `${proposal.user_id}:${proposal.portfolio_id}`
    if (seenProposals.has(dedupeKey)) continue
    seenProposals.add(dedupeKey)

    const sizingLabel = proposal.weight != null
      ? `${proposal.weight}%`
      : proposal.shares != null
        ? `#${proposal.shares.toLocaleString()}`
        : null

    events.push({
      id: `proposal_submitted:${proposal.id}`,
      type: 'proposal_submitted',
      phase: 'formal',
      timestamp: proposal.created_at,
      title: `Proposal submitted${sizingLabel ? ` — ${sizingLabel}` : ''}`,
      subtitle: proposal.notes || null,
      actor: proposal.user
        ? {
            name: getFullName(proposal.user.first_name, proposal.user.last_name),
            initials: getInitials(proposal.user.first_name, proposal.user.last_name),
          }
        : null,
      portfolio: proposal.portfolio,
      sizing: proposal.weight != null || proposal.shares != null
        ? {
            action: proposal.action ?? 'trade',
            weightDelta: null,
            sharesDelta: null,
            weightBefore: null,
            weightAfter: proposal.weight,
          }
        : null,
      rationale: null,
      sourceRef: { type: 'proposal', id: proposal.id },
      disposition: 'neutral',
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
      subtitle: te.portfolio_name || null,
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
      disposition: isHit ? 'positive' : isMissed ? 'negative' : 'neutral',
    })
  }

  // Sort by timestamp descending (most recent first)
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

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
    creator: row.users || null,
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

interface ProposalRow {
  id: string
  user_id: string
  portfolio_id: string
  action: string | null
  weight: number | null
  shares: number | null
  notes: string | null
  created_at: string
  user: { first_name: string | null; last_name: string | null } | null
  portfolio: { id: string; name: string } | null
}

async function fetchProposals(assetId: string): Promise<ProposalRow[]> {
  // Get trade_queue_item IDs for this asset
  const { data: items, error: itemsErr } = await supabase
    .from('trade_queue_items')
    .select('id, action')
    .eq('asset_id', assetId)

  if (itemsErr) throw itemsErr
  if (!items || items.length === 0) return []

  const itemIds = items.map(i => i.id)
  const actionMap = new Map(items.map(i => [i.id, i.action]))

  const { data, error } = await supabase
    .from('trade_proposals')
    .select(`
      id,
      trade_queue_item_id,
      user_id,
      portfolio_id,
      weight,
      shares,
      notes,
      created_at,
      users:user_id (first_name, last_name),
      portfolio:portfolio_id (id, name)
    `)
    .in('trade_queue_item_id', itemIds)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    portfolio_id: row.portfolio_id,
    action: actionMap.get(row.trade_queue_item_id) || null,
    weight: row.weight,
    shares: row.shares,
    notes: row.notes,
    created_at: row.created_at,
    user: row.users || null,
    portfolio: row.portfolio || null,
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
