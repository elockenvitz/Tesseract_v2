-- ═══════════════════════════════════════════════════════════════════════════
--  Rollback for 10-tenant-policies.sql
--
--  Restores the state exactly as captured before the migration. Run as
--  `postgres`, in one transaction.
--
--  THIS REOPENS THE EXPOSURE. The restored SELECT policy is USING (true) and
--  the restored INSERT policy checks only that somebody is logged in, so every
--  authenticated user can again read every organization's deadlines and write
--  one onto any organization's workflow. It is a step back to a known state,
--  not a safe resting place.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Policies: drop the four scoped ones, restore the two permissive ones ────
DROP POLICY IF EXISTS asset_stage_deadlines_select ON public.asset_stage_deadlines;
DROP POLICY IF EXISTS asset_stage_deadlines_insert ON public.asset_stage_deadlines;
DROP POLICY IF EXISTS asset_stage_deadlines_update ON public.asset_stage_deadlines;
DROP POLICY IF EXISTS asset_stage_deadlines_delete ON public.asset_stage_deadlines;

-- Recreated verbatim from the pre-migration catalogue, including the role.
-- Both were defined TO PUBLIC, not TO authenticated — that is part of what
-- made them permissive, and the rollback reproduces it rather than quietly
-- improving on it.
CREATE POLICY "Users can view asset stage deadlines" ON public.asset_stage_deadlines
  FOR SELECT USING (true);

CREATE POLICY "Users can insert asset stage deadlines" ON public.asset_stage_deadlines
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Restoring TRUNCATE is included for exactness. If you are rolling back for a
-- reason unrelated to grants, strike this line: nothing in the application
-- uses it, and leaving it revoked costs nothing.
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.asset_stage_deadlines TO authenticated;

-- ── Unique constraints ──────────────────────────────────────────────────────
--
-- Recreating these can FAIL, and that failure is informative rather than a
-- fault in this script: if any user acquired a priority on the same asset in
-- two organizations while the constraint was absent, the narrow key can no
-- longer be satisfied. Those rows are legitimate — they are exactly what the
-- migration existed to permit. Resolve by deciding which organization's row to
-- keep, or by not rolling this half back at all.
--
-- The query to see the conflicts before running it:
--
--   SELECT asset_id, user_id, count(*), array_agg(organization_id)
--     FROM public.user_asset_priorities
--    GROUP BY asset_id, user_id HAVING count(*) > 1;
--
--   SELECT user_id, asset_id, title, count(*), array_agg(organization_id)
--     FROM public.user_asset_widgets
--    GROUP BY user_id, asset_id, title HAVING count(*) > 1;

ALTER TABLE public.user_asset_priorities
  ADD CONSTRAINT user_asset_priorities_asset_id_user_id_key
  UNIQUE (asset_id, user_id);

ALTER TABLE public.user_asset_widgets
  ADD CONSTRAINT user_asset_widgets_user_id_asset_id_title_key
  UNIQUE (user_id, asset_id, title);

COMMIT;

-- Re-running supabase/tests/stage-deadline-tenant-isolation.sql after this
-- should return to the pre-migration grid — 4 PASS / 11 FAIL — which is itself
-- the proof that the rollback is complete.
