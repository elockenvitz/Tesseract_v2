/**
 * Client-side service for seeding and cleaning up pilot demo data.
 *
 * Calls the seed-pilot-data edge function which creates demo users
 * (Emily Thompson as PM, David Mitchell as Analyst) and sample content.
 */

import { supabase } from '../supabase'

export interface SeedResult {
  success: boolean
  demo_users: {
    pm: { id: string; name: string }
    analyst: { id: string; name: string }
  }
  seeded: {
    trade_ideas: number
    lab_variant: number
    decision_requests: number
    accepted_trades: number
  }
  processedAt: string
}

export interface CleanupResult {
  success: boolean
  removed: number
  removed_user_ids?: string[]
  processedAt: string
}

/**
 * Seed demo users and sample content for a pilot organization.
 * Should be called once after the onboarding wizard completes.
 */
export async function seedPilotDemoData(
  organizationId: string,
  portfolioId: string,
): Promise<SeedResult> {
  const { data, error } = await supabase.functions.invoke('seed-pilot-data', {
    method: 'POST',
    body: { organization_id: organizationId, portfolio_id: portfolioId },
  })

  if (error) throw new Error(`Failed to seed demo data: ${error.message}`)
  if (data?.error) throw new Error(data.error)
  return data as SeedResult
}

/**
 * Remove all demo users and their authored content from an organization.
 * Called from org settings when the pilot user is ready to use real data.
 */
export async function clearPilotDemoData(
  organizationId: string,
): Promise<CleanupResult> {
  const { data, error } = await supabase.functions.invoke('seed-pilot-data', {
    method: 'DELETE',
    body: { organization_id: organizationId },
  })

  if (error) throw new Error(`Failed to clear demo data: ${error.message}`)
  if (data?.error) throw new Error(data.error)
  return data as CleanupResult
}
