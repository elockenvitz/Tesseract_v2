/**
 * Attention Feed — Normalized item model for the dashboard.
 *
 * Every item displayed on the dashboard conforms to this shape,
 * regardless of whether it originates from the Global Decision Engine
 * or the Attention System. Adapters convert source-specific objects
 * into AttentionFeedItem before they reach the UI.
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

export type AttentionBand = 'now' | 'soon' | 'aware'

export type AttentionFeedSeverity = 'high' | 'medium' | 'low'

export type AttentionFeedItemType =
  | 'proposal'       // Proposal awaiting decision
  | 'simulation'     // Idea not simulated
  | 'execution'      // Execution not confirmed
  | 'deliverable'    // Overdue or due-soon deliverable
  | 'project'        // Project needs attention
  | 'thesis'         // Thesis stale
  | 'risk'           // Rating change, no follow-up
  | 'signal'         // High EV, catalyst, awareness-level signal
  | 'prompt'         // PM prompt or thought revisit
  | 'suggestion'     // List suggestion pending
  | 'notification'   // Informational notification
  | 'alignment'      // Team alignment item

export type AttentionFeedSource =
  | 'trade_queue'
  | 'projects'
  | 'research'
  | 'monitoring'
  | 'notifications'
  | 'team'

// ---------------------------------------------------------------------------
// Action model
// ---------------------------------------------------------------------------

export interface AttentionFeedAction {
  label: string
  /** Maps to dispatchDecisionAction key or a navigation route */
  intent: string
  variant: 'primary' | 'secondary' | 'overflow'
  /** Optional route for direct navigation */
  route?: string
  /** Payload forwarded to the action dispatcher */
  payload?: Record<string, any>
}

// ---------------------------------------------------------------------------
// Core item
// ---------------------------------------------------------------------------

export interface AttentionFeedItem {
  id: string
  type: AttentionFeedItemType
  title: string
  description?: string
  severity: AttentionFeedSeverity
  band: AttentionBand
  source: AttentionFeedSource

  related: {
    assetId?: string
    assetTicker?: string
    portfolioId?: string
    portfolioName?: string
    tradeIdeaId?: string
    proposalId?: string
    projectId?: string
    deliverableId?: string
  }

  ageDays: number
  createdAt: string
  updatedAt: string
  dueAt?: string | null

  owner: {
    userId?: string
    name?: string
  }

  requiresRole?: 'PM' | 'Analyst' | 'Any'

  actions: AttentionFeedAction[]

  /** Chips / metadata tags rendered inline (e.g. ticker, portfolio, age) */
  chips: { label: string; value: string }[]

  /** Is this item overdue? (dueAt < now) */
  overdue: boolean

  /** Is this item due within 7 days? */
  dueSoon: boolean

  /** Does this item require a decision (not just progress)? */
  requiresDecision: boolean

  /** Is this item blocking other work? */
  blocking: boolean

  // Internal sort key — higher = more important within its band
  _sortScore: number

  // Source system for dedup
  _sourceSystem: 'decision_engine' | 'attention_system'

  // Rollup children (if this is a rollup parent from the engine)
  _children?: AttentionFeedItem[]
}

// ---------------------------------------------------------------------------
// Band summary (for header display)
// ---------------------------------------------------------------------------

export interface BandSummary {
  band: AttentionBand
  count: number
  oldestAgeDays: number
  /** Compact breakdown like "3 decisions · 2 sims · 1 overdue" */
  breakdown: string
  /** For AWARE: new since last visit count */
  newSinceLastVisit?: number
  /** For SOON: next due date */
  nextDueAt?: string | null
}
