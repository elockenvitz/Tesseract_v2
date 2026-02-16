/**
 * Global Decision Engine — Shared contract types.
 *
 * Used by dashboard surfaces (Action Queue, Intelligence Radar)
 * and potentially by asset-level action loop.
 */

export type DecisionSeverity = 'red' | 'orange' | 'yellow' | 'blue' | 'gray'
export type DecisionSurface = 'action' | 'intel'
export type DecisionCategory =
  | 'process'
  | 'risk'
  | 'alpha'
  | 'project'
  | 'prompt'
  | 'catalyst'

export type DecisionTier = 'capital' | 'integrity' | 'coverage'

export type DecisionContext = {
  assetId?: string
  assetTicker?: string
  portfolioId?: string
  portfolioName?: string
  tradeIdeaId?: string
  proposalId?: string
  projectId?: string
  projectName?: string
  workflowId?: string
  /** Trade action: Buy, Sell, Trim, Add */
  action?: string
  /** Days overdue for deliverables */
  overdueDays?: number
  /** Rating change: old value */
  ratingFrom?: string
  /** Rating change: new value */
  ratingTo?: string
  /** Urgency from trade idea */
  urgency?: string
  /** Rationale text from trade idea */
  rationale?: string
  /** Proposed weight % for trade proposals */
  proposedWeight?: number
  /** Whether this item represents a pair trade */
  isPairTrade?: boolean
  /** Original trade queue stage (idea, simulating, deciding) */
  stage?: string
}

export type DecisionCTA = {
  label: string
  actionKey: string
  payload?: Record<string, any>
  kind?: 'primary' | 'secondary'
}

export type DecisionItem = {
  id: string
  surface: DecisionSurface
  severity: DecisionSeverity
  category: DecisionCategory

  title: string
  titleKey?: string
  description: string
  chips?: { label: string; value: string }[]

  context: DecisionContext

  ctas: DecisionCTA[]
  dismissible?: boolean

  children?: DecisionItem[]

  decisionTier?: DecisionTier
  sortScore: number
  createdAt?: string
}
