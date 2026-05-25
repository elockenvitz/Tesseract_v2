-- Broaden the pilot_scenarios "one active scenario" unique index from
-- per-user to per-(user, org).
--
-- The original index (20260424050000_pilot_scenario_seeding.sql:37)
-- assumed a user pilots in exactly one org for their whole lifetime.
-- That's wrong: an internal tester running through multiple pilot
-- clients, or any user invited to a second pilot org, ends up with a
-- pre-existing active row that blocks seeding in the new org with a
-- 23505 ("pilot_scenarios_user_active_unique") even though the
-- ensure_pilot_scenario_for_user() function's own lookup is correctly
-- scoped by (user_id, organization_id) and finds nothing in the new
-- org before attempting the INSERT.
--
-- The function itself doesn't change — its SELECT already filters on
-- organization_id, so it'll short-circuit correctly on the second
-- visit to an org once a row exists there.
--
-- Safe to apply: the old constraint allowed at most one active
-- non-template row per user, so every row already satisfies the
-- stricter (user_id, organization_id) variant.

DROP INDEX IF EXISTS public.pilot_scenarios_user_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS pilot_scenarios_user_org_active_unique
  ON public.pilot_scenarios (user_id, organization_id)
  WHERE user_id IS NOT NULL
    AND organization_id IS NOT NULL
    AND status = 'active'
    AND is_template = FALSE;
