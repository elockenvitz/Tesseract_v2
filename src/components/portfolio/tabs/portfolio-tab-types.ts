export type PortfolioTabType = 'overview' | 'positions' | 'performance' | 'log' | 'journal' | 'team' | 'processes' | 'universe'

export interface PortfolioHolding {
  id: string
  asset_id: string
  portfolio_id: string
  shares: string
  price: string
  cost: string
  date: string
  assets?: {
    id: string
    symbol: string
    company_name: string
    sector: string
    industry?: string
    thesis?: string
    where_different?: string
    risks_to_thesis?: string
    priority?: string
    process_stage?: string
    created_at?: string
    updated_at?: string
    created_by?: string
    workflow_id?: string
    price_targets?: Array<{
      type: string
      price: number
      timeframe?: string
      reasoning?: string
    }>
  }
}

export interface UniverseAsset {
  id: string
  asset_id: string
  notes?: string
  added_at: string
  asset: {
    id: string
    symbol: string
    company_name: string
    sector?: string
    industry?: string
  }
}

export interface UniverseFilter {
  id: string
  filter_type: string
  filter_operator: string
  filter_value: string
}

export interface CombinedUniverse {
  manual: UniverseAsset[]
  filtered: Array<{
    id: string
    symbol: string
    company_name: string
    sector?: string
    industry?: string
    country?: string
    exchange?: string
    market_cap?: number
  }>
  total: number
}

export interface FilterOptions {
  sectors: string[]
  industries: string[]
  countries: string[]
  exchanges: string[]
}

export interface TeamMember {
  id: string
  teamRecordIds: string[]
  user: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
  focus: string[]
  created_at: string
}

export interface NavigateHandler {
  (tab: { id: string; title: string; type: string; data?: any }): void
}

// Utility functions extracted from PortfolioTab
export function getUserDisplayName(user: any): string {
  if (!user) return 'Unknown User'
  if (user.first_name && user.last_name) {
    return `${user.first_name} ${user.last_name}`
  }
  return user.email || 'Unknown User'
}

export function getUserInitials(user: any): string {
  if (!user) return 'UU'
  if (user.first_name && user.last_name) {
    return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
  }
  const nameParts = user.email?.split('@')[0].split('.')
  if (nameParts && nameParts.length > 1) {
    return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
  }
  return user.email?.substring(0, 2).toUpperCase() || 'UU'
}
