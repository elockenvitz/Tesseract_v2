/**
 * Fire-and-forget helpers for logging structured org activity events.
 * Calls SECURITY DEFINER RPCs — never blocks the caller.
 *
 * - initiator_user_id: the human who triggered this event chain
 * - actor_id: who executed it (auth.uid() for direct, NULL for cascade)
 * - actorOverride: batch-only — set to null so cascade events have actor_id=NULL
 */

import { supabase } from './supabase'
import type { LogOrgActivityParams } from '../types/organization'

/** Log a single org activity event (fire-and-forget). */
export function logOrgActivity(params: LogOrgActivityParams): void {
  supabase
    .rpc('log_org_activity_event', {
      p_organization_id: params.organizationId,
      p_action: params.action,
      p_target_type: params.targetType,
      p_target_id: params.targetId ?? null,
      p_details: params.details ?? {},
      p_entity_type: params.entityType ?? null,
      p_action_type: params.actionType ?? null,
      p_target_user_id: params.targetUserId ?? null,
      p_source_type: params.sourceType ?? 'direct',
      p_source_id: params.sourceId ?? null,
      p_metadata: params.metadata ?? {},
      p_initiator_user_id: params.initiatorUserId ?? null,
    })
    .then(({ error }) => {
      if (error) console.error('[org-activity-log]', error.message)
    })
}

/** Log a batch of org activity events (fire-and-forget). */
export function logOrgActivityBatch(events: LogOrgActivityParams[]): void {
  const payload = events.map((e) => {
    const row: Record<string, unknown> = {
      organization_id: e.organizationId,
      action: e.action,
      target_type: e.targetType,
      target_id: e.targetId ?? null,
      details: e.details ?? {},
      entity_type: e.entityType ?? null,
      action_type: e.actionType ?? null,
      target_user_id: e.targetUserId ?? null,
      source_type: e.sourceType ?? 'direct',
      source_id: e.sourceId ?? null,
      metadata: e.metadata ?? {},
      initiator_user_id: e.initiatorUserId ?? null,
    }
    // When actorOverride is explicitly provided (even as null),
    // include actor_user_id key so the RPC uses it instead of auth.uid()
    if ('actorOverride' in e) {
      row.actor_user_id = e.actorOverride ?? null
    }
    return row
  })

  supabase
    .rpc('log_org_activity_events_batch', { p_events: payload })
    .then(({ error }) => {
      if (error) console.error('[org-activity-log] batch', error.message)
    })
}
