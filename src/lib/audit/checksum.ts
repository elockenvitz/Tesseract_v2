/**
 * Checksum Utility for Audit Events
 *
 * Calculates SHA-256 hash of core audit event fields for tamper detection.
 * Uses Web Crypto API for browser compatibility.
 */

import type { ActorType, ActionType, StateSnapshot } from './types'

interface ChecksumPayload {
  occurred_at: string
  actor_id: string | null
  actor_type: ActorType
  entity_type: string
  entity_id: string
  action_type: ActionType
  from_state: StateSnapshot | null
  to_state: StateSnapshot | null
  org_id: string
}

/**
 * Calculate SHA-256 checksum of audit event core fields
 *
 * This checksum is used for tamper detection. If any of the core fields
 * are modified, the checksum will no longer match.
 */
export async function calculateChecksum(payload: ChecksumPayload): Promise<string> {
  const normalized = JSON.stringify({
    occurred_at: payload.occurred_at,
    actor_id: payload.actor_id,
    actor_type: payload.actor_type,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    action_type: payload.action_type,
    from_state: payload.from_state,
    to_state: payload.to_state,
    org_id: payload.org_id,
  })

  // Use Web Crypto API for browser compatibility
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

  return hashHex
}

/**
 * Verify checksum of an audit event
 */
export async function verifyChecksum(
  event: ChecksumPayload & { checksum: string }
): Promise<boolean> {
  const calculated = await calculateChecksum(event)
  return calculated === event.checksum
}

/**
 * Synchronous checksum calculation (fallback for environments without Web Crypto)
 * Uses a simple hash function - less secure but works everywhere
 */
export function calculateChecksumSync(payload: ChecksumPayload): string {
  const normalized = JSON.stringify({
    occurred_at: payload.occurred_at,
    actor_id: payload.actor_id,
    actor_type: payload.actor_type,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    action_type: payload.action_type,
    from_state: payload.from_state,
    to_state: payload.to_state,
    org_id: payload.org_id,
  })

  // Simple hash function (djb2 variant)
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i)
  }

  // Convert to hex and pad
  const hex = (hash >>> 0).toString(16).padStart(8, '0')

  // Return a longer string by repeating the process
  let result = hex
  for (let i = 0; i < 7; i++) {
    hash = ((hash << 5) + hash) ^ (hash >>> 16)
    result += (hash >>> 0).toString(16).padStart(8, '0')
  }

  return result
}
