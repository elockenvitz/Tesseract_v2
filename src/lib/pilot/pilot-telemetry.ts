/**
 * Lightweight pilot telemetry.
 *
 * Fire-and-forget: we never want a telemetry write to block UI or surface
 * errors to the user. All events land in public.pilot_telemetry_events.
 *
 * Event taxonomy:
 *   Macro unlocks (one per first-time milestone, per user+org):
 *     - pilot_trade_book_unlocked
 *     - pilot_outcomes_unlocked
 *     - pilot_graduated
 *
 *   In-banner steps (one per first-time step completion, per user+org).
 *   These let the ops funnel show WHERE pilots stall inside each banner,
 *   not just whether they reached the macro unlocks:
 *
 *   Idea Pipeline banner:
 *     - pilot_pipeline_step_idea_dragged
 *     - pilot_pipeline_step_inbox_opened
 *     - pilot_pipeline_step_tradelab_opened
 *   Trade Lab intro banner:
 *     - pilot_tradelab_step_rec_reviewed
 *     - pilot_tradelab_step_rec_sized
 *     - pilot_tradelab_step_executed
 *   Trade Book Get Started banner:
 *     - pilot_tradebook_step_trade_reviewed
 *     - pilot_tradebook_step_rationale_added
 *     - pilot_tradebook_step_opened_outcomes
 *
 *   Decision Recorded modal CTAs:
 *     - decision_recorded_modal_opened
 *     - decision_recorded_view_trade_book_clicked
 *     - decision_recorded_stay_in_trade_lab_clicked
 *
 *   Other:
 *     - pilot_teaser_modal_shown
 */

import { supabase } from '../supabase'

export type PilotEventType =
  | 'decision_recorded_modal_opened'
  | 'decision_recorded_view_trade_book_clicked'
  | 'decision_recorded_stay_in_trade_lab_clicked'
  | 'pilot_trade_book_unlocked'
  | 'pilot_outcomes_unlocked'
  | 'pilot_graduated'
  | 'pilot_teaser_modal_shown'
  // Idea Pipeline banner (3 steps)
  | 'pilot_pipeline_step_idea_dragged'
  | 'pilot_pipeline_step_inbox_opened'
  | 'pilot_pipeline_step_tradelab_opened'
  // Trade Lab banner (3 steps)
  | 'pilot_tradelab_step_rec_reviewed'
  | 'pilot_tradelab_step_rec_sized'
  | 'pilot_tradelab_step_executed'
  // Trade Book banner (3 steps)
  | 'pilot_tradebook_step_trade_reviewed'
  | 'pilot_tradebook_step_rationale_added'
  | 'pilot_tradebook_step_opened_outcomes'
  // Outcomes banner (3 steps — finish the loop)
  | 'pilot_outcomes_step_result_inspected'
  | 'pilot_outcomes_step_thesis_reviewed'
  | 'pilot_outcomes_step_performance_checked'
  // PilotWelcomeBanner localStorage-only items (2)
  | 'pilot_postgrad_idea_feed_viewed'
  | 'pilot_postgrad_asset_explored'
  // PilotWorkspaceCustomizationCard wizard steps (4)
  | 'pilot_customization_profile_completed'
  | 'pilot_customization_role_completed'
  | 'pilot_customization_integrations_completed'
  | 'pilot_customization_teams_completed'

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
