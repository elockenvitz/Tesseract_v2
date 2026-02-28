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
