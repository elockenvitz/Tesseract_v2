-- Allow platform admins (Ops portal staff) to read every row in
-- pilot_telemetry_events for analytics. The original RLS only allowed
-- `user_id = auth.uid()` for SELECT, which made the ops funnel report
-- in OpsClientDetailPage impossible to populate — the query would only
-- ever return the ops user's own rows, never the rows of the pilot
-- members the report is supposed to describe.
--
-- We keep the original per-user policy in place so non-ops users still
-- only see their own telemetry. Insert policy is unchanged
-- (`user_id = auth.uid()` for WITH CHECK) — telemetry is logged by the
-- acting user from the browser, so ops staff never insert on behalf of
-- pilots.

DROP POLICY IF EXISTS "Platform admins can view all pilot telemetry"
  ON public.pilot_telemetry_events;

CREATE POLICY "Platform admins can view all pilot telemetry"
  ON public.pilot_telemetry_events FOR SELECT
  USING (public.is_platform_admin());
