/**
 * actionLoopTelemetry — Lightweight event logger for Action Loop interactions.
 *
 * Logs user interactions to console in development. In production, this
 * would forward to an analytics service. Kept minimal to avoid scope creep.
 */

import type { ActionItemType } from './assetActionLoopEvaluator'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TelemetryEvent =
  | { event: 'action_loop_expand'; assetId: string; itemCount: number }
  | { event: 'action_loop_collapse'; assetId: string }
  | { event: 'action_loop_action_click'; assetId: string; itemType: ActionItemType; actionKey: string }
  | { event: 'action_loop_dismiss'; assetId: string; itemType: ActionItemType }

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const IS_DEV = import.meta.env.DEV

export function logActionLoopEvent(payload: TelemetryEvent): void {
  if (IS_DEV) {
    console.debug('[ActionLoop]', payload.event, payload)
  }

  // Future: forward to analytics endpoint
  // e.g. posthog.capture(payload.event, payload)
}
