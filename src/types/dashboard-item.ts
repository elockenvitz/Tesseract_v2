/**
 * DashboardItem — Normalized item model for the Decision Engine Console.
 *
 * Every row on the dashboard conforms to this shape, regardless of
 * whether it originates from the Global Decision Engine evaluators
 * or the Attention System collectors. The mapping layer converts
 * source-specific objects into DashboardItem before the UI touches them.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type DashboardBand = 'NOW' | 'SOON' | 'AWARE'

export type DashboardSeverity = 'HIGH' | 'MED' | 'LOW'

export type DashboardItemType =
  | 'DECISION'
  | 'SIMULATION'
  | 'PROJECT'
  | 'THESIS'
  | 'RATING'
  | 'SIGNAL'
  | 'OTHER'

// ---------------------------------------------------------------------------
// Action model
// ---------------------------------------------------------------------------

export interface DashboardItemAction {
  label: string
  onClick: () => void
}

// ---------------------------------------------------------------------------
// Rich metadata (populated per item type)
// ---------------------------------------------------------------------------

export interface DashboardItemMeta {
  /** Trade action: Buy, Sell, Trim, Add */
  action?: string
  /** Urgency: low, medium, high, urgent */
  urgency?: string
  /** Rationale text from trade idea */
  rationale?: string
  /** Project name for deliverables */
  projectName?: string
  /** Days overdue for deliverables */
  overdueDays?: number
  /** Rating change: old value */
  ratingFrom?: string
  /** Rating change: new value */
  ratingTo?: string
  /** Proposed weight % for trade proposals */
  proposedWeight?: number
  /** Whether this item represents a pair trade */
  isPairTrade?: boolean
  /** Original trade queue stage (idea, simulating, deciding) */
  stage?: string
}

// ---------------------------------------------------------------------------
// Core item
// ---------------------------------------------------------------------------

export interface DashboardItem {
  id: string
  band: DashboardBand
  severity: DashboardSeverity
  type: DashboardItemType
  title: string
  reason: string
  ageDays?: number
  createdAt?: string
  portfolio?: { id: string; name: string }
  asset?: { id: string; ticker: string; name?: string }
  /** Owner / assignee for blended team clarity */
  owner?: { name?: string; role?: string }
  /** Structured metadata for contextual display */
  meta?: DashboardItemMeta
  contextChips?: string[]
  primaryAction: DashboardItemAction
  secondaryActions?: DashboardItemAction[]
  route?: { path: string; openMode?: 'tab' | 'modal' | 'rightPane' }
}

// ---------------------------------------------------------------------------
// Band summary (for header display)
// ---------------------------------------------------------------------------

export interface DashboardBandSummary {
  band: DashboardBand
  count: number
  oldestAgeDays: number
  breakdownChips: { label: string; count: number }[]
  /** For SOON: nearest due date */
  nextDueAt?: string | null
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type DashboardGroupBy = 'none' | 'portfolio' | 'type'

export interface DashboardGroup {
  key: string
  label: string
  items: DashboardItem[]
}
