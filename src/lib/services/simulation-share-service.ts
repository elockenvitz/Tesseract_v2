/**
 * Simulation Share Service
 *
 * Handles sharing simulations with other users.
 * Supports two modes:
 * - Snapshot: Creates an immutable copy of the simulation
 * - Live: Grants access to the original simulation (future feature)
 *
 * Access levels:
 * - view: Can view the simulation but not modify
 * - suggest: Can view and submit suggestions (future feature)
 * - collaborate: Full edit access (future feature for live mode)
 */

import { supabase } from '../supabase'

// ============================================================
// Types
// ============================================================

export type SimulationShareAccess = 'view' | 'suggest' | 'collaborate'
export type SimulationShareMode = 'snapshot' | 'live'

export interface SimulationShare {
  id: string
  simulation_id: string
  snapshot_id: string | null
  shared_by: string
  shared_with: string
  access_level: SimulationShareAccess
  share_mode: SimulationShareMode
  message: string | null
  created_at: string
  updated_at: string
  revoked_at: string | null
  revoked_by: string | null
}

export interface SimulationSnapshot {
  id: string
  source_simulation_id: string
  name: string
  description: string | null
  baseline_holdings: unknown
  baseline_total_value: number | null
  snapshot_trades: unknown[]
  result_metrics: unknown
  created_by: string
  created_at: string
  source_version: number
}

export interface ShareSimulationParams {
  simulationId: string
  recipientIds: string[]
  accessLevel: SimulationShareAccess
  shareMode: SimulationShareMode
  message?: string
  actorId: string
}

export interface RevokeShareParams {
  shareId: string
  actorId: string
}

export interface UpdateShareAccessParams {
  shareId: string
  accessLevel: SimulationShareAccess
  actorId: string
}

export interface SharedSimulationListItem {
  id: string
  share_id: string
  simulation_id: string
  snapshot_id: string | null
  name: string
  description: string | null
  shared_by: {
    id: string
    full_name: string
    email: string
  }
  access_level: SimulationShareAccess
  share_mode: SimulationShareMode
  message: string | null
  shared_at: string
  // For snapshot mode
  baseline_holdings?: unknown
  baseline_total_value?: number | null
  snapshot_trades?: unknown[]
  result_metrics?: unknown
}

// ============================================================
// Core Service Functions
// ============================================================

/**
 * Share a simulation with one or more users
 * Creates a snapshot by default (snapshot mode)
 */
export async function shareSimulation(params: ShareSimulationParams): Promise<{
  shares: SimulationShare[]
  snapshot: SimulationSnapshot | null
}> {
  const { simulationId, recipientIds, accessLevel, shareMode, message, actorId } = params

  // Verify user owns the simulation
  const { data: simulation, error: simError } = await supabase
    .from('simulations')
    .select(`
      id, name, description, status,
      baseline_holdings, baseline_total_value,
      result_metrics, created_by,
      simulation_trades (
        id, asset_id, direction, shares, weight,
        price, value, rationale, created_at
      )
    `)
    .eq('id', simulationId)
    .single()

  if (simError || !simulation) {
    throw new Error(`Simulation not found: ${simulationId}`)
  }

  if (simulation.created_by !== actorId) {
    throw new Error('Only the simulation owner can share it')
  }

  let snapshotId: string | null = null
  let snapshot: SimulationSnapshot | null = null

  // Create snapshot if in snapshot mode
  if (shareMode === 'snapshot') {
    const { data: newSnapshot, error: snapError } = await supabase
      .from('simulation_snapshots')
      .insert({
        source_simulation_id: simulationId,
        name: simulation.name,
        description: simulation.description,
        baseline_holdings: simulation.baseline_holdings,
        baseline_total_value: simulation.baseline_total_value,
        snapshot_trades: simulation.simulation_trades || [],
        result_metrics: simulation.result_metrics,
        created_by: actorId,
        source_version: 1, // TODO: Track simulation versions
      })
      .select()
      .single()

    if (snapError) {
      throw new Error(`Failed to create snapshot: ${snapError.message}`)
    }

    snapshotId = newSnapshot.id
    snapshot = newSnapshot as SimulationSnapshot
  }

  // Create share records for each recipient
  const shareInserts = recipientIds.map(recipientId => ({
    simulation_id: simulationId,
    snapshot_id: snapshotId,
    shared_by: actorId,
    shared_with: recipientId,
    access_level: accessLevel,
    share_mode: shareMode,
    message: message || null,
  }))

  const { data: shares, error: shareError } = await supabase
    .from('simulation_shares')
    .insert(shareInserts)
    .select()

  if (shareError) {
    throw new Error(`Failed to create shares: ${shareError.message}`)
  }

  // Log share events
  for (const share of shares || []) {
    await logShareEvent({
      shareId: share.id,
      simulationId,
      eventType: 'shared',
      actorId,
      details: {
        recipient_id: share.shared_with,
        access_level: accessLevel,
        share_mode: shareMode,
        snapshot_id: snapshotId,
      },
    })
  }

  return {
    shares: shares as SimulationShare[],
    snapshot,
  }
}

/**
 * Revoke a share (soft delete)
 */
export async function revokeShare(params: RevokeShareParams): Promise<void> {
  const { shareId, actorId } = params

  // Get share and verify ownership
  const { data: share, error: fetchError } = await supabase
    .from('simulation_shares')
    .select('id, simulation_id, shared_by, shared_with, revoked_at')
    .eq('id', shareId)
    .single()

  if (fetchError || !share) {
    throw new Error(`Share not found: ${shareId}`)
  }

  if (share.shared_by !== actorId) {
    throw new Error('Only the sharer can revoke access')
  }

  if (share.revoked_at) {
    throw new Error('Share has already been revoked')
  }

  // Soft delete
  const { error: updateError } = await supabase
    .from('simulation_shares')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: actorId,
    })
    .eq('id', shareId)

  if (updateError) {
    throw new Error(`Failed to revoke share: ${updateError.message}`)
  }

  // Log event
  await logShareEvent({
    shareId,
    simulationId: share.simulation_id,
    eventType: 'revoked',
    actorId,
    details: {
      recipient_id: share.shared_with,
    },
  })
}

/**
 * Update the access level of an existing share
 */
export async function updateShareAccess(params: UpdateShareAccessParams): Promise<void> {
  const { shareId, accessLevel, actorId } = params

  // Get share and verify ownership
  const { data: share, error: fetchError } = await supabase
    .from('simulation_shares')
    .select('id, simulation_id, shared_by, access_level, revoked_at')
    .eq('id', shareId)
    .single()

  if (fetchError || !share) {
    throw new Error(`Share not found: ${shareId}`)
  }

  if (share.shared_by !== actorId) {
    throw new Error('Only the sharer can update access')
  }

  if (share.revoked_at) {
    throw new Error('Cannot update revoked share')
  }

  const previousLevel = share.access_level

  // Update access
  const { error: updateError } = await supabase
    .from('simulation_shares')
    .update({
      access_level: accessLevel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', shareId)

  if (updateError) {
    throw new Error(`Failed to update access: ${updateError.message}`)
  }

  // Log event
  await logShareEvent({
    shareId,
    simulationId: share.simulation_id,
    eventType: 'access_changed',
    actorId,
    details: {
      previous_level: previousLevel,
      new_level: accessLevel,
    },
  })
}

/**
 * Get simulations shared with the current user
 */
export async function getSharedWithMe(userId: string): Promise<SharedSimulationListItem[]> {
  // Get active shares where the user is the recipient
  const { data: shares, error } = await supabase
    .from('simulation_shares')
    .select(`
      id,
      simulation_id,
      snapshot_id,
      access_level,
      share_mode,
      message,
      created_at,
      shared_by,
      users:shared_by (
        id,
        full_name,
        email
      )
    `)
    .eq('shared_with', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch shared simulations: ${error.message}`)
  }

  if (!shares || shares.length === 0) {
    return []
  }

  // For each share, get either the snapshot or live simulation data
  const result: SharedSimulationListItem[] = []

  for (const share of shares) {
    if (share.share_mode === 'snapshot' && share.snapshot_id) {
      // Get snapshot data
      const { data: snapshot } = await supabase
        .from('simulation_snapshots')
        .select('*')
        .eq('id', share.snapshot_id)
        .single()

      if (snapshot) {
        result.push({
          id: snapshot.id,
          share_id: share.id,
          simulation_id: share.simulation_id,
          snapshot_id: share.snapshot_id,
          name: snapshot.name,
          description: snapshot.description,
          shared_by: share.users as any,
          access_level: share.access_level as SimulationShareAccess,
          share_mode: share.share_mode as SimulationShareMode,
          message: share.message,
          shared_at: share.created_at,
          baseline_holdings: snapshot.baseline_holdings,
          baseline_total_value: snapshot.baseline_total_value,
          snapshot_trades: snapshot.snapshot_trades as unknown[],
          result_metrics: snapshot.result_metrics,
        })
      }
    } else {
      // Live mode - get original simulation
      const { data: simulation } = await supabase
        .from('simulations')
        .select(`
          id, name, description,
          baseline_holdings, baseline_total_value, result_metrics
        `)
        .eq('id', share.simulation_id)
        .single()

      if (simulation) {
        result.push({
          id: simulation.id,
          share_id: share.id,
          simulation_id: share.simulation_id,
          snapshot_id: null,
          name: simulation.name,
          description: simulation.description,
          shared_by: share.users as any,
          access_level: share.access_level as SimulationShareAccess,
          share_mode: share.share_mode as SimulationShareMode,
          message: share.message,
          shared_at: share.created_at,
          baseline_holdings: simulation.baseline_holdings,
          baseline_total_value: simulation.baseline_total_value,
          result_metrics: simulation.result_metrics,
        })
      }
    }
  }

  return result
}

/**
 * Get shares created by the user (simulations they've shared)
 */
export async function getMyShares(userId: string): Promise<{
  simulationId: string
  simulationName: string
  shares: Array<{
    id: string
    shared_with: { id: string; full_name: string; email: string }
    access_level: SimulationShareAccess
    share_mode: SimulationShareMode
    created_at: string
    revoked_at: string | null
  }>
}[]> {
  const { data: shares, error } = await supabase
    .from('simulation_shares')
    .select(`
      id,
      simulation_id,
      access_level,
      share_mode,
      created_at,
      revoked_at,
      shared_with_user:shared_with (
        id,
        full_name,
        email
      ),
      simulations:simulation_id (
        id,
        name
      )
    `)
    .eq('shared_by', userId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch shares: ${error.message}`)
  }

  // Group by simulation
  const grouped = new Map<string, {
    simulationId: string
    simulationName: string
    shares: Array<{
      id: string
      shared_with: { id: string; full_name: string; email: string }
      access_level: SimulationShareAccess
      share_mode: SimulationShareMode
      created_at: string
      revoked_at: string | null
    }>
  }>()

  for (const share of shares || []) {
    const sim = share.simulations as any
    if (!sim) continue

    if (!grouped.has(share.simulation_id)) {
      grouped.set(share.simulation_id, {
        simulationId: share.simulation_id,
        simulationName: sim.name,
        shares: [],
      })
    }

    grouped.get(share.simulation_id)!.shares.push({
      id: share.id,
      shared_with: share.shared_with_user as any,
      access_level: share.access_level as SimulationShareAccess,
      share_mode: share.share_mode as SimulationShareMode,
      created_at: share.created_at,
      revoked_at: share.revoked_at,
    })
  }

  return Array.from(grouped.values())
}

/**
 * Check if user has access to a simulation (via share)
 */
export async function checkShareAccess(
  simulationId: string,
  userId: string
): Promise<{ hasAccess: boolean; accessLevel: SimulationShareAccess | null; shareMode: SimulationShareMode | null }> {
  const { data: share, error } = await supabase
    .from('simulation_shares')
    .select('access_level, share_mode')
    .eq('simulation_id', simulationId)
    .eq('shared_with', userId)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) {
    console.error('Error checking share access:', error)
    return { hasAccess: false, accessLevel: null, shareMode: null }
  }

  return {
    hasAccess: !!share,
    accessLevel: share?.access_level as SimulationShareAccess | null,
    shareMode: share?.share_mode as SimulationShareMode | null,
  }
}

/**
 * Get a shared simulation by share ID
 */
export async function getSharedSimulation(
  shareId: string,
  userId: string
): Promise<SharedSimulationListItem | null> {
  // Verify user has access to this share
  const { data: share, error } = await supabase
    .from('simulation_shares')
    .select(`
      id,
      simulation_id,
      snapshot_id,
      access_level,
      share_mode,
      message,
      created_at,
      shared_by,
      shared_with,
      users:shared_by (
        id,
        full_name,
        email
      )
    `)
    .eq('id', shareId)
    .is('revoked_at', null)
    .single()

  if (error || !share) {
    return null
  }

  // Verify user is the recipient
  if (share.shared_with !== userId) {
    return null
  }

  if (share.share_mode === 'snapshot' && share.snapshot_id) {
    const { data: snapshot } = await supabase
      .from('simulation_snapshots')
      .select('*')
      .eq('id', share.snapshot_id)
      .single()

    if (!snapshot) return null

    return {
      id: snapshot.id,
      share_id: share.id,
      simulation_id: share.simulation_id,
      snapshot_id: share.snapshot_id,
      name: snapshot.name,
      description: snapshot.description,
      shared_by: share.users as any,
      access_level: share.access_level as SimulationShareAccess,
      share_mode: share.share_mode as SimulationShareMode,
      message: share.message,
      shared_at: share.created_at,
      baseline_holdings: snapshot.baseline_holdings,
      baseline_total_value: snapshot.baseline_total_value,
      snapshot_trades: snapshot.snapshot_trades as unknown[],
      result_metrics: snapshot.result_metrics,
    }
  } else {
    const { data: simulation } = await supabase
      .from('simulations')
      .select(`
        id, name, description,
        baseline_holdings, baseline_total_value, result_metrics
      `)
      .eq('id', share.simulation_id)
      .single()

    if (!simulation) return null

    return {
      id: simulation.id,
      share_id: share.id,
      simulation_id: share.simulation_id,
      snapshot_id: null,
      name: simulation.name,
      description: simulation.description,
      shared_by: share.users as any,
      access_level: share.access_level as SimulationShareAccess,
      share_mode: share.share_mode as SimulationShareMode,
      message: share.message,
      shared_at: share.created_at,
      baseline_holdings: simulation.baseline_holdings,
      baseline_total_value: simulation.baseline_total_value,
      result_metrics: simulation.result_metrics,
    }
  }
}

// ============================================================
// Internal Helpers
// ============================================================

async function logShareEvent(params: {
  shareId: string
  simulationId: string
  eventType: 'shared' | 'access_changed' | 'revoked' | 'snapshot_created' | 'suggestion_submitted'
  actorId: string
  details?: Record<string, unknown>
}): Promise<void> {
  const { shareId, simulationId, eventType, actorId, details } = params

  const { error } = await supabase
    .from('simulation_share_events')
    .insert({
      share_id: shareId,
      simulation_id: simulationId,
      event_type: eventType,
      actor_id: actorId,
      details: details || {},
    })

  if (error) {
    console.error('Failed to log share event:', error)
  }
}
