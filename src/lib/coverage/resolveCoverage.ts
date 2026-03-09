/**
 * Deterministic coverage resolution.
 *
 * All coverage resolution (picking a single row for system routing) MUST go through this module.
 * See docs/coverage/coverage_contract.md for the canonical tie-break rule.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface CoverageRow {
  id?: string
  asset_id: string
  user_id: string
  analyst_name?: string
  role?: string | null
  is_lead?: boolean | null
  team_id?: string | null
  visibility?: string | null
  portfolio_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ResolvedCoverage {
  /** All active coverage rows, deterministically sorted */
  all: CoverageRow[]
  /** Coverage where analyst's team_id matches viewer's nodes */
  inScope: CoverageRow[]
  /** Coverage with visibility='firm' or no team_id (legacy/unscoped) */
  firmWide: CoverageRow[]
  /** Coverage not in viewer's scope */
  outOfScope: CoverageRow[]
  /** Single deterministic default: inScope first, then firmWide, then any */
  chosenDefault: CoverageRow | null
}

// ─── Role ranking ─────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
}

/** Returns a numeric rank for a coverage role. Lower = higher priority. */
export function coverageRoleRank(role: string | null | undefined): number {
  if (!role) return 4
  return ROLE_RANK[role] ?? 3 // custom roles rank between tertiary and null
}

// ─── Deterministic sort ───────────────────────────────────────────────

/**
 * Sort coverage rows deterministically:
 * 1. is_lead DESC (true first)
 * 2. role priority: primary(0) → secondary(1) → tertiary(2) → custom(3) → null(4)
 * 3. updated_at DESC (most recently updated first)
 * 4. user_id ASC (stable tiebreak)
 */
export function sortCoverageDeterministically<T extends CoverageRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    // 1. is_lead DESC
    const aLead = a.is_lead ? 1 : 0
    const bLead = b.is_lead ? 1 : 0
    if (bLead !== aLead) return bLead - aLead

    // 2. role priority ASC (lower rank = higher priority)
    const aRank = coverageRoleRank(a.role)
    const bRank = coverageRoleRank(b.role)
    if (aRank !== bRank) return aRank - bRank

    // 3. updated_at DESC
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
    if (bTime !== aTime) return bTime - aTime

    // 4. user_id ASC (stable)
    return (a.user_id || '').localeCompare(b.user_id || '')
  })
}

// ─── Default resolution ───────────────────────────────────────────────

/** Pick the single deterministic default from a pre-sorted (or unsorted) array. */
export function resolveCoverageDefault<T extends CoverageRow>(rows: T[]): T | null {
  if (rows.length === 0) return null
  const sorted = sortCoverageDeterministically(rows)
  return sorted[0]
}

// ─── Scope-aware resolution ───────────────────────────────────────────

/**
 * Resolve coverage for an asset from the viewer's perspective.
 *
 * Scope matching (v1):
 *   - row.team_id IN viewerNodeIds → inScope
 *   - row.visibility === 'firm' OR row.team_id is null → firmWide
 *   - else → outOfScope
 *   - chosenDefault: first of sort(inScope) ‖ first of sort(firmWide) ‖ first of sort(all)
 *
 * If viewerNodeIds is not provided, all rows go to firmWide (graceful degradation).
 */
export function resolveCoverageForViewer(
  allRows: CoverageRow[],
  viewerNodeIds?: string[],
): ResolvedCoverage {
  const sorted = sortCoverageDeterministically(allRows)

  if (!viewerNodeIds || viewerNodeIds.length === 0) {
    // No viewer context — treat everything as firm-wide
    return {
      all: sorted,
      inScope: [],
      firmWide: sorted,
      outOfScope: [],
      chosenDefault: sorted[0] ?? null,
    }
  }

  const nodeIdSet = new Set(viewerNodeIds)
  const inScope: CoverageRow[] = []
  const firmWide: CoverageRow[] = []
  const outOfScope: CoverageRow[] = []

  for (const row of sorted) {
    if (row.visibility === 'firm' || !row.team_id) {
      firmWide.push(row)
    } else if (nodeIdSet.has(row.team_id)) {
      inScope.push(row)
    } else {
      outOfScope.push(row)
    }
  }

  const chosenDefault = inScope[0] ?? firmWide[0] ?? sorted[0] ?? null

  return { all: sorted, inScope, firmWide, outOfScope, chosenDefault }
}
