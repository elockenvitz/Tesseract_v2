/**
 * Adds pilot unlock-progress tracking + telemetry events.
 *
 * users.pilot_progress — JSONB map of stage → ISO timestamp.
 *   Known keys today: trade_book_unlocked_at, outcomes_unlocked_at.
 *   Reads by usePilotMode to progressively upgrade pilot_access levels.
 *
 * pilot_telemetry_events — lightweight per-user event log for product
 *   analytics (decision-recorded modal opens, CTA clicks, etc.). RLS:
 *   users can insert/select only their own rows.
 */

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pilot_progress jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.pilot_telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pilot_telemetry_user_created
  ON public.pilot_telemetry_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pilot_telemetry_event_created
  ON public.pilot_telemetry_events (event_type, created_at DESC);

ALTER TABLE public.pilot_telemetry_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own pilot telemetry" ON public.pilot_telemetry_events;
CREATE POLICY "Users can insert their own pilot telemetry"
  ON public.pilot_telemetry_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view their own pilot telemetry" ON public.pilot_telemetry_events;
CREATE POLICY "Users can view their own pilot telemetry"
  ON public.pilot_telemetry_events FOR SELECT
  USING (user_id = auth.uid());
