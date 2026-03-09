/**
 * Shared types for the Coverage subsystem.
 *
 * CoverageRecord mirrors the row shape returned by CoverageManager's
 * `all-coverage` query (with joined asset / portfolio / team).
 */

// ─── Core record ──────────────────────────────────────────────────────

export interface CoverageRecord {
  id: string
  asset_id: string
  user_id: string
  analyst_name: string
  created_at: string
  updated_at: string
  start_date: string
  end_date: string | null
  is_active: boolean
  changed_by: string | null
  role?: string | null
  notes?: string | null
  portfolio_id?: string | null
  team_id?: string | null
  visibility?: 'team' | 'division' | 'firm'
  is_lead?: boolean
  assets: {
    id: string
    symbol: string
    company_name: string
    sector?: string
    industry?: string
    market_cap?: number
  } | null
  portfolios?: {
    id: string
    name: string
    team_id?: string | null
  } | null
  teams?: {
    id: string
    name: string
    node_type: string
    parent_id?: string | null
  } | null
}

// ─── Coverage target (canonical group identity) ─────────────────────

/** Canonical representation of which org group a coverage assignment applies to. */
export interface CoverageTarget {
  /** 'firm' = firm-wide, 'org_node' = any org_chart_node (team/div/dept/portfolio), 'unknown' = missing data */
  kind: 'firm' | 'org_node' | 'unknown'
  /** org_chart_nodes.id when kind='org_node', null otherwise */
  id: string | null
  /** Human-readable: the node name, "Firm", or "No scope" */
  name: string
  /** org_chart_nodes.node_type when available: "team", "division", "department", "portfolio" */
  nodeType?: string
  /** Ancestor chain for tooltip: ["Firm", "Equities", "Tech", "Value Team"] */
  breadcrumb?: string[]
}

// ─── List view column types ───────────────────────────────────────────

export type ListColumnId =
  | 'asset'
  | 'analyst'
  | 'coversFor'
  | 'coveredBy'
  | 'sector'
  | 'startDate'
  | 'tenure'
  | 'industry'
  | 'marketCap'

export type ListGroupByLevel =
  | 'division'
  | 'department'
  | 'team'
  | 'portfolio'
  | 'sector'
  | 'industry'
  | 'analyst'

// ─── Grouped-by-asset structures ──────────────────────────────────────

export interface AssetCoverageGroup {
  assetId: string
  symbol: string
  companyName: string
  sector: string
  assignments: CoverageRecord[]
  /**
   * Internal: resolver-chosen row for system routing (not surfaced as business truth).
   * The UI uses `coveredByNames` for display instead.
   */
  resolvedRow: {
    coverageId: string
    analystName: string
    userId: string
    role: string | null
    isLead: boolean
    reason: string
    groupName: string
    target: CoverageTarget
  } | null
  /** All analyst names covering this asset (for "Covered By" column). */
  coveredByNames: string[]
  /** Scoped analyst summaries for richer "Covered By" display. */
  coveredBySummary: Array<{
    analystName: string
    shortName: string
    role: string | null
    isLead: boolean
    scopeName: string
  }>
  conflicts: CoverageConflict[]
  /** Unique coverage targets across all assignments for this asset */
  coverageTargets: CoverageTarget[]
  /** Actual org group names covered by assignments (convenience accessor) */
  groupNames: string[]
}

export interface CoverageConflict {
  assetId: string
  assetSymbol: string
  scope: string
  type: 'multiple_leads' | 'no_lead_multiple_primaries'
  records: CoverageRecord[]
}
