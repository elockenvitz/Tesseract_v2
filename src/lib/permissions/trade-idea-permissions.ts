/**
 * Trade Idea Permission Utilities
 *
 * Implements permission checking based on the following rules:
 *
 * VISIBILITY:
 * - Creator, assigned analyst, co-analysts can see the idea
 * - PMs can see ideas linked to portfolios they manage
 * - PMs only see their own portfolios (not cross-portfolio linkage)
 *
 * GLOBAL STAGE MOVEMENT (Idea → Working On → Modeling):
 * - Only creator, assigned analyst, or co-analysts can move
 * - PMs CANNOT move global stages
 *
 * DECIDING (Portfolio-Scoped):
 * - PMs can initiate decisions for their portfolios only
 * - This creates a PM-owned proposal, does NOT change global stage
 *
 * PROPOSALS:
 * - Analysts can create proposals for portfolios they're assigned to
 * - Analysts can continue proposing until PM records a decision
 */

import { supabase } from '../supabase'

// Types
export interface TradeIdeaPermissionContext {
  userId: string
  tradeIdea: {
    id: string
    created_by: string | null
    assigned_to: string | null
    collaborators?: string[] | null
  }
}

export interface PortfolioPermissionContext {
  userId: string
  portfolioId: string
}

export interface PortfolioLink {
  portfolioId: string
  portfolioName: string
  labId?: string
}

// Cache for user portfolio roles (cleared on page navigation)
const userRoleCache = new Map<string, { role: 'analyst' | 'pm'; timestamp: number }>()
const CACHE_TTL_MS = 60000 // 1 minute cache

/**
 * Check if user is the creator, assigned analyst, or co-analyst of a trade idea
 * These users can move the idea through global stages (Idea → Working On → Modeling)
 */
export function isCreatorOrCoAnalyst(
  userId: string,
  tradeIdea: {
    created_by: string | null
    assigned_to: string | null
    collaborators?: string[] | null
  }
): boolean {
  if (!userId) return false

  // Creator can always move stages
  if (tradeIdea.created_by === userId) return true

  // Assigned analyst can move stages
  if (tradeIdea.assigned_to === userId) return true

  // Co-analysts (collaborators) can move stages
  if (tradeIdea.collaborators?.includes(userId)) return true

  return false
}

/**
 * Check if user can move a trade idea through global stages
 * Only creator/assigned/co-analysts can do this, NOT PMs
 */
export function canMoveGlobalStage(
  userId: string,
  tradeIdea: {
    created_by: string | null
    assigned_to: string | null
    collaborators?: string[] | null
  }
): boolean {
  return isCreatorOrCoAnalyst(userId, tradeIdea)
}

/**
 * Get user's role for a specific portfolio (analyst or pm)
 * Queries portfolio_team table with caching
 */
export async function getUserPortfolioRole(
  userId: string,
  portfolioId: string
): Promise<'analyst' | 'pm'> {
  const cacheKey = `${userId}:${portfolioId}`
  const cached = userRoleCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.role
  }

  const { data, error } = await supabase
    .from('portfolio_team')
    .select('role')
    .eq('user_id', userId)
    .eq('portfolio_id', portfolioId)
    .maybeSingle()

  if (error) {
    console.warn('Failed to get user trade role, defaulting to analyst:', error)
    return 'analyst'
  }

  // Map database role to internal role type
  const role = data?.role === 'Portfolio Manager' ? 'pm' : 'analyst'
  userRoleCache.set(cacheKey, { role, timestamp: Date.now() })

  return role
}

/**
 * Check if user is a PM for the given portfolio
 */
export async function isPMForPortfolio(
  userId: string,
  portfolioId: string
): Promise<boolean> {
  const role = await getUserPortfolioRole(userId, portfolioId)
  return role === 'pm'
}

/**
 * Check if user can initiate a decision for a portfolio
 * Only PMs can initiate decisions for their portfolios
 */
export async function canInitiateDecision(
  userId: string,
  portfolioId: string
): Promise<boolean> {
  return isPMForPortfolio(userId, portfolioId)
}

/**
 * Check if user can submit a proposal for a trade idea in a portfolio
 * Analysts can submit proposals for portfolios they're assigned to
 * Cannot submit after PM has recorded a decision
 */
export async function canSubmitProposal(
  userId: string,
  portfolioId: string,
  portfolioDecisionOutcome: string | null
): Promise<boolean> {
  // Cannot submit proposals after decision is made
  if (portfolioDecisionOutcome !== null) {
    return false
  }

  // Check if user is a member of this portfolio
  const { data, error } = await supabase
    .from('portfolio_team')
    .select('id')
    .eq('user_id', userId)
    .eq('portfolio_id', portfolioId)
    .maybeSingle()

  if (error || !data) {
    return false
  }

  return true
}

/**
 * Filter portfolio links to only show those the user can see
 * PMs only see their own portfolios, analysts/creators see all
 */
export async function getVisiblePortfoliosForUser(
  userId: string,
  allPortfolioLinks: PortfolioLink[],
  tradeIdea: {
    created_by: string | null
    assigned_to: string | null
    collaborators?: string[] | null
  }
): Promise<PortfolioLink[]> {
  // Creator, assigned, and co-analysts can see all linked portfolios
  if (isCreatorOrCoAnalyst(userId, tradeIdea)) {
    return allPortfolioLinks
  }

  // For PMs, only show portfolios they manage
  const visiblePortfolios: PortfolioLink[] = []

  for (const link of allPortfolioLinks) {
    const isPM = await isPMForPortfolio(userId, link.portfolioId)
    if (isPM) {
      visiblePortfolios.push(link)
    }
  }

  return visiblePortfolios
}

/**
 * Check if user can view a trade idea
 * Visible to: creator, assigned, co-analysts, PMs of linked portfolios
 */
export async function canViewTradeIdea(
  userId: string,
  tradeIdea: {
    created_by: string | null
    assigned_to: string | null
    collaborators?: string[] | null
  },
  linkedPortfolioIds: string[]
): Promise<boolean> {
  // Creator, assigned, co-analysts can always view
  if (isCreatorOrCoAnalyst(userId, tradeIdea)) {
    return true
  }

  // Check if user is PM for any linked portfolio
  for (const portfolioId of linkedPortfolioIds) {
    const isPM = await isPMForPortfolio(userId, portfolioId)
    if (isPM) {
      return true
    }
  }

  return false
}

/**
 * Check if user can make a decision (accept/reject/defer) for a portfolio
 * Only PMs can make decisions, and only for their portfolios
 */
export async function canMakeDecision(
  userId: string,
  portfolioId: string
): Promise<boolean> {
  return isPMForPortfolio(userId, portfolioId)
}

/**
 * Check if user can revert a decision back to modeling
 * Only PMs can revert decisions for their portfolios
 */
export async function canRevertDecision(
  userId: string,
  portfolioId: string
): Promise<boolean> {
  return isPMForPortfolio(userId, portfolioId)
}

/**
 * Get all portfolios where user is a PM
 */
export async function getUserPMPortfolios(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('portfolio_team')
    .select('portfolio_id')
    .eq('user_id', userId)
    .eq('role', 'Portfolio Manager')

  if (error || !data) {
    return []
  }

  return data.map(d => d.portfolio_id)
}

/**
 * Clear the role cache (call on logout or when roles change)
 */
export function clearRoleCache(): void {
  userRoleCache.clear()
}

/**
 * Proposal type constants
 */
export const PROPOSAL_TYPE = {
  ANALYST: 'analyst',
  PM_INITIATED: 'pm_initiated',
} as const

export type ProposalType = typeof PROPOSAL_TYPE[keyof typeof PROPOSAL_TYPE]
