-- ============================================================================
-- price_target_outcomes — tenant isolation
--
-- Background
-- ----------
-- `public.price_target_outcomes` had exactly one SELECT policy and it was the
-- entire read boundary:
--
--     SELECT USING (auth.uid() IS NOT NULL)
--
-- That predicate proves a session exists and nothing about which rows, so every
-- authenticated user in every organization read every row. Measured in
-- production 2026-10-11: 30 rows owned by 2 organizations, readable by all 24
-- organizations with active memberships. A Caffrey Capital user could read all
-- 30 outcome rows while only 3 of the parent price targets were visible to
-- them — 27 child rows escaped the boundary their own parent already enforced.
--
-- Authoritative ownership
-- -----------------------
-- Ownership is NOT derived from the author's membership and NOT from the asset:
--
--   * author membership is mutable and multi-valued — 27 of 30 rows were
--     written by users who are active in more than one organization, and for 7
--     rows the author's current organization is NOT the organization the row
--     belongs to. Deriving from the author would have misfiled 7 rows (23%).
--   * `assets` is global by design and carries no tenant at all.
--
-- The authoritative anchor is the parent price target.
-- `price_target_id` is NOT NULL, UNIQUE, and FK ON DELETE CASCADE to
-- `analyst_price_targets`, which already carries `organization_id`, is already
-- org-scoped by RLS, and already has a BEFORE INSERT trigger stamping
-- `current_org_id()`. Every outcome row is created by the SECURITY DEFINER
-- trigger `create_outcome_for_target()` on that parent — the client never
-- inserts — so a parent is guaranteed to exist. Measured: 30/30 rows resolve
-- to exactly one organization, 0 orphans, 0 unresolvable.
--
-- Fix
-- ---
-- 1. Add `organization_id`; NULL is the quarantine state.
-- 2. Derive it SERVER-SIDE from the parent on every INSERT and UPDATE, so
--    whatever a caller sends is discarded and the column means something a
--    policy can trust. Make the natural key immutable.
-- 3. Backfill from the parent. Preserve every historical row; guess nothing.
-- 4. Replace the AUTH_ONLY SELECT policy with one that mirrors the parent's
--    own boundary exactly, so an outcome is never visible for a price target
--    the reader cannot see.
-- 5. Withdraw the grants the client does not need, and revoke `anon` entirely.
--
-- RLS posture after this migration
-- --------------------------------
--   SELECT  org-scoped, fails closed on NULL  (authenticated only)
--   UPDATE  author-only, within the row's org; stays open for quarantined
--           rows so repair is possible      (authenticated only)
--   INSERT  no policy — deny by default for `authenticated`. The only
--           inserters are SECURITY DEFINER functions owned by `postgres`,
--           which bypass RLS. The client has never inserted here.
--   DELETE  no policy and no grant — unchanged, already denied.
--   anon    no grant at all.
--
-- Repairing a quarantined row: fix `analyst_price_targets.organization_id` on
-- the parent, then touch the outcome row as `service_role`. The trigger
-- re-derives ownership; `service_role` bypasses RLS but NOT triggers, so the
-- derived value still cannot be forged.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema
-- ----------------------------------------------------------------------------

ALTER TABLE public.price_target_outcomes
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES public.organizations(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.price_target_outcomes.organization_id IS
  'Derived server-side from analyst_price_targets.organization_id by '
  'price_target_outcomes_set_org_id. Never accepted from a caller. '
  'NULL means quarantined: preserved, invisible to every tenant, repairable '
  'by service_role once the parent target carries an organization.';

CREATE INDEX IF NOT EXISTS idx_price_target_outcomes_organization_id
  ON public.price_target_outcomes(organization_id);

-- ----------------------------------------------------------------------------
-- 2. Ownership derivation, server-side
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER so the derivation reads the parent regardless of the
-- caller's own RLS. STABLE: one parent row per call, looked up by primary key.
CREATE OR REPLACE FUNCTION public.price_target_outcome_org(p_price_target_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT apt.organization_id
    FROM public.analyst_price_targets apt
   WHERE apt.id = p_price_target_id;
$function$;

CREATE OR REPLACE FUNCTION public.set_price_target_outcome_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- The natural key is immutable: a row must not migrate between tenants
  -- under the guise of an edit.
  IF TG_OP = 'UPDATE'
     AND NEW.price_target_id IS DISTINCT FROM OLD.price_target_id THEN
    RAISE EXCEPTION
      'price_target_outcomes.price_target_id is immutable (row %)', OLD.id;
  END IF;

  -- Ownership is derived, never accepted. An unresolvable parent yields NULL,
  -- which is the quarantine state — not an error, and not a guess.
  NEW.organization_id := public.price_target_outcome_org(NEW.price_target_id);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS price_target_outcomes_set_org_id
  ON public.price_target_outcomes;
CREATE TRIGGER price_target_outcomes_set_org_id
  BEFORE INSERT OR UPDATE ON public.price_target_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.set_price_target_outcome_org();

-- ----------------------------------------------------------------------------
-- 3. Backfill — from the parent only. Nothing is deleted, nothing is guessed.
-- ----------------------------------------------------------------------------

UPDATE public.price_target_outcomes pto
   SET organization_id = apt.organization_id
  FROM public.analyst_price_targets apt
 WHERE apt.id = pto.price_target_id
   AND pto.organization_id IS DISTINCT FROM apt.organization_id;

-- ----------------------------------------------------------------------------
-- 4. Policies — mirror the parent's boundary exactly.
--
--    `analyst_price_targets` uses
--        is_active_member_of_current_org() AND organization_id = current_org_id()
--    and the child must use the same, or an outcome could be visible for a
--    target the reader cannot see.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view all price target outcomes"
  ON public.price_target_outcomes;
DROP POLICY IF EXISTS price_target_outcomes_select
  ON public.price_target_outcomes;
CREATE POLICY price_target_outcomes_select ON public.price_target_outcomes
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND is_active_member_of_current_org()
    AND organization_id = current_org_id()
  );

-- The author may still resolve their own outcome, but only from inside the
-- organization that owns it. WITH CHECK deliberately omits the org predicate:
-- the trigger sets the column, and requiring a match here would brick the only
-- repair route for a quarantined row.
DROP POLICY IF EXISTS "Users can update their own outcomes"
  ON public.price_target_outcomes;
DROP POLICY IF EXISTS price_target_outcomes_update
  ON public.price_target_outcomes;
CREATE POLICY price_target_outcomes_update ON public.price_target_outcomes
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND (organization_id IS NULL OR organization_id = current_org_id())
  )
  WITH CHECK (user_id = auth.uid());

-- Rows are written only by SECURITY DEFINER triggers and sweepers owned by
-- `postgres`, which bypass RLS. No client INSERT path exists, so the
-- AUTH_ONLY INSERT policy is removed rather than rewritten.
DROP POLICY IF EXISTS "System can insert outcomes"
  ON public.price_target_outcomes;

-- ----------------------------------------------------------------------------
-- 5. Grants — a policy is not a boundary while the grant is wider than it.
--    `anon` held DELETE/INSERT/TRUNCATE/UPDATE here.
-- ----------------------------------------------------------------------------

REVOKE ALL ON public.price_target_outcomes FROM anon;

REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.price_target_outcomes FROM authenticated;
GRANT SELECT, UPDATE ON public.price_target_outcomes TO authenticated;

-- NOTE: FORCE ROW LEVEL SECURITY is deliberately NOT set. It applies to the
-- table owner, which is the role this migration and its backfill run through.
