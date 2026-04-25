/**
 * Lightweight pilot telemetry.
 *
 * Fire-and-forget: we never want a telemetry write to block UI or surface
 * errors to the user. All events land in public.pilot_telemetry_events.
 *
 * Known event types (extend as needed):
 *   - decision_recorded_modal_opened
 *   - decision_recorded_view_trade_book_clicked
 *   - decision_recorded_stay_in_trade_lab_clicked
 *   - pilot_trade_book_unlocked
 *   - pilot_outcomes_unlocked
 *   - pilot_teaser_modal_shown
 */

import { supabase } from '../supabase'

export type PilotEventType =
  | 'decision_recorded_modal_opened'
  | 'decision_recorded_view_trade_book_clicked'
  | 'decision_recorded_stay_in_trade_lab_clicked'
  | 'pilot_trade_book_unlocked'
  | 'pilot_outcomes_unlocked'
  | 'pilot_teaser_modal_shown'

export interface LogPilotEventInput {
  eventType: PilotEventType | string
  metadata?: Record<string, unknown>
  organizationId?: string | null
}

/**
 * Fire-and-forget telemetry log. Swallows all errors.
 *
 * Caller is responsible for providing the current org id (if available) —
 * we can't read it here without introducing a circular context dep.
 */
export function logPilotEvent(input: LogPilotEventInput): void {
  // Intentionally not awaited — drop the promise and move on. Errors are
  // swallowed so a failed log never ruins a user flow.
  void (async () => {
    try {
      const { data: sess } = await supabase.auth.getUser()
      const userId = sess?.user?.id
      if (!userId) return
      await supabase.from('pilot_telemetry_events').insert({
        user_id: userId,
        organization_id: input.organizationId ?? null,
        event_type: input.eventType,
        metadata: input.metadata ?? {},
      })
    } catch {
      // Intentionally ignored — telemetry must never break user flow.
    }
  })()
}
