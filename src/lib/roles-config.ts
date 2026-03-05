// ─── Portfolio roles (used in portfolio_team) ────────────────────────────

export const ROLE_OPTIONS = [
  'Portfolio Manager',
  'Analyst',
  'Trader',
  'Operations',
  'Support',
  'Member',
] as const

export type RoleType = (typeof ROLE_OPTIONS)[number]

export const ROLE_FOCUS_OPTIONS: Record<RoleType, string[]> = {
  'Portfolio Manager': ['Generalist', 'Growth', 'Value', 'Income', 'Multi-Strategy', 'Macro'],
  'Analyst': [
    'Technology', 'Healthcare', 'Energy', 'Financials', 'Consumer',
    'Industrials', 'Utilities', 'Materials', 'Real Estate',
    'Risk', 'Performance', 'Quantitative', 'ESG', 'Credit', 'Technical',
  ],
  'Trader': ['Equities', 'Fixed Income', 'Derivatives', 'FX', 'Commodities', 'Multi-Asset'],
  'Operations': ['Compliance', 'Settlements', 'Reconciliation', 'Fund Accounting', 'Reporting', 'Data Management'],
  'Support': ['IT', 'HR', 'Legal', 'Marketing', 'Client Services', 'Administration'],
  'Member': [],
}

/** Get focus options for a role. Returns empty array for unknown roles. */
export function getFocusOptionsForRole(role: string): string[] {
  return ROLE_FOCUS_OPTIONS[role as RoleType] ?? []
}

// ─── Team node roles (used in org_chart_node_members for team/division/department) ──

export const TEAM_ROLE_OPTIONS = [
  'Head',
  'Senior Member',
  'Member',
  'Associate',
  'Consultant',
  'Observer',
] as const

export type TeamRoleType = (typeof TEAM_ROLE_OPTIONS)[number]

export const TEAM_FUNCTION_OPTIONS = [
  'Investment',
  'Trading',
  'Operations',
  'Compliance',
  'Research',
  'Support',
] as const

export type TeamFunctionType = (typeof TEAM_FUNCTION_OPTIONS)[number]

// ─── Runtime guards ───────────────────────────────────────────────────

const PORTFOLIO_ROLE_SET = new Set<string>(ROLE_OPTIONS)
const TEAM_ROLE_SET = new Set<string>(TEAM_ROLE_OPTIONS)

/**
 * Returns true if the role is a valid portfolio role (from ROLE_OPTIONS).
 * Use this to filter out team roles that may have leaked into portfolio_team data.
 */
export function isPortfolioRole(role: string): boolean {
  return PORTFOLIO_ROLE_SET.has(role)
}

/**
 * Returns true if the role is a valid team node role (from TEAM_ROLE_OPTIONS).
 */
export function isTeamRole(role: string): boolean {
  return TEAM_ROLE_SET.has(role)
}

/**
 * Guard: validate a role for portfolio context. If it's not a valid portfolio role,
 * log a warning in dev and return null. Callers should skip rendering nulls.
 */
export function validatePortfolioRole(role: string): RoleType | null {
  if (PORTFOLIO_ROLE_SET.has(role)) return role as RoleType
  if (import.meta.env.DEV) {
    console.warn(`[roles-config] Unexpected portfolio role "${role}" — not in ROLE_OPTIONS. This may be a team role.`)
  }
  return null
}
