-- =============================================================================
-- Coverage triggers: lane- and owner-aware supersession, history and lane
-- immutability.
--
-- Companion to 20260828110000_coverage_scope_and_self_service_rls.sql. Both are
-- required. That migration adds `coverage_scope` and the personal lane; this
-- one makes the triggers understand that a second lane exists, and makes the
-- lane itself immutable.
--
-- -- The threat model, corrected ---------------------------------------------
--
-- An earlier draft of this header said an ordinary user declaring personal
-- coverage would retire the admin-assigned row on the same asset. Independent
-- review established that is NOT true, and the correction matters because it
-- changes which of these predicates is load-bearing and why.
--
-- `end_previous_coverage()` is SECURITY INVOKER. Its UPDATE is therefore
-- filtered by whatever policy admits the caller. For an ordinary user inserting
-- personal coverage that is `coverage_update_own_personal`, which already
-- restricts the reachable set to that user's own personal rows in their own
-- organization. So with migration 1 alone an ordinary user CANNOT retire
-- governed coverage this way. RLS gets there first.
--
-- What is actually exposed, and what these predicates are for:
--
--   1. BROADER AUTHORITY. A coverage admin's UPDATE policy admits every row in
--      the organization, so an admin inserting an org assignment reaches
--      personal declarations with nothing narrowing it. `service_role` and the
--      table owner bypass RLS entirely and are worse. This is the supersession
--      exposure, and it runs in the org -> personal direction.
--
--   2. AN ORG ASSIGNMENT RETIRING PERSONAL DECLARATIONS. The same mechanism,
--      stated as product behaviour rather than as a privilege boundary. An
--      admin deciding who is responsible for a name says nothing about whether
--      a colleague is still watching it, and silently retiring their note to
--      self is wrong even when the person doing it has every right to write the
--      assignment.
--
--   3. HISTORY ATTRIBUTION, which is genuinely unmasked.
--      `log_coverage_change()` is SECURITY DEFINER, so RLS filters nothing at
--      all. Its "existing coverage" lookup decides who is recorded as the
--      PREVIOUS holder in `coverage_history`. Unnarrowed, one user's personal
--      declaration is logged as `analyst_changed` naming a different user --
--      a false statement about somebody else's coverage, writable by any
--      authenticated user, in the audit trail. This one an ordinary user CAN
--      trigger, and it is the strongest single reason this migration exists.
--
-- -- Why the immutability trigger is required, not belt-and-braces -----------
--
-- Migration 1 alone also permits lane conversion through the admin lane, in
-- both directions. `coverage_update_admin` is deliberately not lane-restricted
-- so admins can govern and clean up personal rows -- which means, without this
-- trigger, an admin can:
--
--   * promote a personal declaration into a governed assignment, or
--   * demote a governed assignment into a personal row, after which the analyst
--     it names can edit and retire it themselves
--
-- The second is the sharper one: it converts a row the organization controls
-- into a row its subject controls, with no record that the authority changed.
-- The personal policies pin the lane in USING and WITH CHECK, so the personal
-- lane cannot convert on its own; the trigger is what closes the admin lane and
-- `service_role`, neither of which any policy constrains.
--
-- -- Demonstrated, not asserted --------------------------------------------
--
-- Against 20260828110000 alone, supabase/tests/coverage-self-service-security
-- .sql reports 23 passed / 2 failed on staging:
--
--   [18] history attribution named another user  (ordinary-user reachable)
--   [25] an admin org assignment retired a personal declaration
--
-- Assertions [15] and [16] -- an ORDINARY user's personal insert not retiring a
-- colleague's or an admin's coverage -- pass with or without this migration.
-- They are kept deliberately, because they pin the RLS behaviour the corrected
-- threat model depends on, and would fail loudly if the personal UPDATE policy
-- were ever widened. They are not evidence for this migration.
--
-- With both applied: 25 passed, 0 failed.
--
-- -- The rule ----------------------------------------------------------------
--
-- Supersession and history attribution operate within one lane, and within the
-- personal lane also within one owner:
--
--   org      insert supersedes org rows of the same organization
--   personal insert supersedes that same user's personal rows only
--
-- -- Why this changes nothing for existing data ------------------------------
--
-- After the backfill every existing row is `org`, so for every write path that
-- exists today `coverage_scope = NEW.coverage_scope` selects exactly the set
-- the Stage 1 predicate selected. The org lane's behaviour is unchanged, which
-- is the point: this narrows the blast radius of the NEW lane and of authority
-- acting across lanes, without touching the old one.
--
-- Idempotent: every statement is CREATE OR REPLACE or DROP-then-CREATE.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Supersession respects lane and owner
--
-- Derived from the live post-Stage-1 definition; the only change is the two
-- added predicates on the UPDATE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.end_previous_coverage()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  allow_multiple BOOLEAN;
BEGIN
  -- If this is a new active coverage assignment
  IF NEW.is_active = true AND NEW.end_date IS NULL THEN

    -- Fail closed. A row with no organization has no tenant whose coverage we
    -- could correctly retire, and "retire every tenant's coverage of this
    -- asset" is not a safe fallback. Do nothing rather than guess.
    IF NEW.organization_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Check if allow_multiple_coverage is enabled for THIS organization.
    -- Previously `FROM coverage_settings LIMIT 1`, which returned whichever
    -- row the planner reached first, for every tenant.
    SELECT cs.allow_multiple_coverage INTO allow_multiple
    FROM coverage_settings cs
    WHERE cs.organization_id = NEW.organization_id
    LIMIT 1;

    -- An organization with no settings row of its own allows multiple
    -- coverage. This is what every organization resolves to in production
    -- today via the unscoped read, so it preserves current behaviour exactly;
    -- it is also the non-destructive default, which is the one to pick when
    -- the configuration is silent.
    IF allow_multiple IS NULL THEN
      allow_multiple := true;
    END IF;

    -- Only end previous coverage if allow_multiple_coverage is false
    IF allow_multiple IS NOT TRUE THEN
      -- End all other active coverages for this asset, WITHIN THIS TENANT.
      UPDATE coverage
      SET
        is_active = false,
        end_date = COALESCE(NEW.start_date, CURRENT_DATE) - INTERVAL '1 day',
        changed_by = NEW.changed_by
      WHERE
        asset_id = NEW.asset_id
        AND id != NEW.id
        AND is_active = true
        AND end_date IS NULL
        -- The fix. Without this, one tenant's insert retires every other
        -- tenant's coverage of the same asset.
        AND organization_id = NEW.organization_id
        -- Lane and owner, added in Stage 3 alongside `coverage_scope`.
        -- Organization alone stopped being sufficient the moment a second lane
        -- existed: without these two predicates a user declaring personal
        -- coverage of an asset would retire the admin-assigned row on the same
        -- asset, and every colleague's personal row with it.
        AND coverage_scope = NEW.coverage_scope
        AND (NEW.coverage_scope <> 'personal' OR user_id = NEW.user_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. History attribution respects lane and owner
--
-- Derived from the live post-Stage-1 definition; the only changes are the two
-- added predicates on each of the two `v_existing_coverage` lookups. Every
-- `coverage_history` column list and value is unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_coverage_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_coverage RECORD;
  v_original_changed_by UUID;
  v_allow_multiple BOOLEAN;
  v_org_id UUID;
BEGIN
  -- Determine organization_id
  IF (TG_OP = 'DELETE') THEN
    v_org_id := OLD.organization_id;
  ELSE
    v_org_id := NEW.organization_id;
  END IF;

  -- Check if multiple coverage is allowed FOR THIS ORGANIZATION.
  -- See the migration header: a missing row means true, which is what the
  -- previous unscoped `LIMIT 1` resolved to for every tenant in production.
  SELECT cs.allow_multiple_coverage INTO v_allow_multiple
  FROM coverage_settings cs
  WHERE cs.organization_id = v_org_id
  LIMIT 1;

  IF v_allow_multiple IS NULL THEN
    v_allow_multiple := true;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    -- Check if this is a historical period (inserted with is_active = false and has end_date)
    IF NEW.is_active = false AND NEW.end_date IS NOT NULL THEN
      INSERT INTO coverage_history (
        coverage_id, asset_id, change_type,
        new_user_id, new_analyst_name, new_start_date, new_end_date, new_is_active,
        changed_by, changed_at, organization_id
      ) VALUES (
        NEW.id, NEW.asset_id, 'historical_added',
        NEW.user_id, NEW.analyst_name, NEW.start_date, NEW.end_date, NEW.is_active,
        NEW.changed_by, NEW.updated_at, v_org_id
      );
      RETURN NEW;
    END IF;

    IF NEW.is_active = true THEN
      SELECT * INTO v_existing_coverage
      FROM coverage
      WHERE asset_id = NEW.asset_id
        AND id != NEW.id
        AND is_active = true
        -- The fix. Without this the "previous analyst" recorded in this
        -- tenant's audit trail can be a person from another tenant.
        AND organization_id = v_org_id
        -- Same lane/owner narrowing as the supersede. Without it this
        -- tenant's audit trail can name an admin assignment, or a colleague,
        -- as the "previous" holder of a personal declaration.
        AND coverage_scope = NEW.coverage_scope
        AND (NEW.coverage_scope <> 'personal' OR user_id = NEW.user_id)
      LIMIT 1;

      IF FOUND THEN
        IF v_allow_multiple = true THEN
          INSERT INTO coverage_history (
            coverage_id, asset_id, change_type,
            new_user_id, new_analyst_name, new_start_date, new_end_date, new_is_active,
            changed_by, changed_at, organization_id
          ) VALUES (
            NEW.id, NEW.asset_id, 'coverage_added',
            NEW.user_id, NEW.analyst_name, NEW.start_date, NEW.end_date, NEW.is_active,
            NEW.changed_by, NEW.updated_at, v_org_id
          );
          RETURN NEW;
        ELSE
          INSERT INTO coverage_history (
            coverage_id, asset_id, change_type,
            old_user_id, old_analyst_name, old_start_date, old_end_date, old_is_active,
            new_user_id, new_analyst_name, new_start_date, new_end_date, new_is_active,
            changed_by, changed_at, organization_id
          ) VALUES (
            NEW.id, NEW.asset_id, 'analyst_changed',
            v_existing_coverage.user_id, v_existing_coverage.analyst_name,
            v_existing_coverage.start_date, v_existing_coverage.end_date, v_existing_coverage.is_active,
            NEW.user_id, NEW.analyst_name, NEW.start_date, NEW.end_date, NEW.is_active,
            NEW.changed_by, NEW.updated_at, v_org_id
          );
          RETURN NEW;
        END IF;
      END IF;
    END IF;

    -- New coverage
    INSERT INTO coverage_history (
      coverage_id, asset_id, change_type,
      new_user_id, new_analyst_name, new_start_date, new_end_date, new_is_active,
      changed_by, changed_at, organization_id
    ) VALUES (
      NEW.id, NEW.asset_id, 'created',
      NEW.user_id, NEW.analyst_name, NEW.start_date, NEW.end_date, NEW.is_active,
      NEW.changed_by, NEW.updated_at, v_org_id
    );
    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.is_active = false AND NEW.is_active = true THEN
      v_original_changed_by := OLD.changed_by;

      SELECT * INTO v_existing_coverage
      FROM coverage
      WHERE asset_id = NEW.asset_id
        AND id != NEW.id
        AND is_active = true
        -- Same fix, reactivation path.
        AND organization_id = v_org_id
        -- Same lane/owner narrowing as the supersede. Without it this
        -- tenant's audit trail can name an admin assignment, or a colleague,
        -- as the "previous" holder of a personal declaration.
        AND coverage_scope = NEW.coverage_scope
        AND (NEW.coverage_scope <> 'personal' OR user_id = NEW.user_id)
      LIMIT 1;

      IF FOUND THEN
        IF v_allow_multiple = true THEN
          INSERT INTO coverage_history (
            coverage_id, asset_id, change_type,
            new_user_id, new_analyst_name, new_start_date, new_end_date, new_is_active,
            changed_by, changed_at, organization_id
          ) VALUES (
            NEW.id, NEW.asset_id, 'coverage_added',
            NEW.user_id, NEW.analyst_name, NEW.start_date, NEW.end_date, NEW.is_active,
            v_original_changed_by, NEW.updated_at, v_org_id
          );
          RETURN NEW;
        ELSE
          INSERT INTO coverage_history (
            coverage_id, asset_id, change_type,
            old_user_id, old_analyst_name, old_start_date, old_end_date, old_is_active,
            new_user_id, new_analyst_name, new_start_date, new_end_date, new_is_active,
            changed_by, changed_at, organization_id
          ) VALUES (
            NEW.id, NEW.asset_id, 'analyst_changed',
            v_existing_coverage.user_id, v_existing_coverage.analyst_name,
            v_existing_coverage.start_date, v_existing_coverage.end_date, v_existing_coverage.is_active,
            NEW.user_id, NEW.analyst_name, NEW.start_date, NEW.end_date, NEW.is_active,
            v_original_changed_by, NEW.updated_at, v_org_id
          );
          RETURN NEW;
        END IF;
      END IF;
    END IF;

    -- Determine change type for other updates
    DECLARE
      v_change_type TEXT;
    BEGIN
      IF (OLD.user_id != NEW.user_id OR OLD.analyst_name != NEW.analyst_name) THEN
        v_change_type := 'analyst_changed';
      ELSIF (OLD.start_date != NEW.start_date OR
             (OLD.end_date IS DISTINCT FROM NEW.end_date)) THEN
        v_change_type := 'dates_changed';
      ELSIF (OLD.role IS DISTINCT FROM NEW.role OR
             OLD.is_lead IS DISTINCT FROM NEW.is_lead) THEN
        v_change_type := 'role_change';
      ELSE
        v_change_type := 'dates_changed';
      END IF;

      INSERT INTO coverage_history (
        coverage_id, asset_id, change_type,
        old_user_id, old_analyst_name, old_start_date, old_end_date, old_is_active,
        new_user_id, new_analyst_name, new_start_date, new_end_date, new_is_active,
        changed_by, changed_at, organization_id
      ) VALUES (
        NEW.id, NEW.asset_id, v_change_type,
        OLD.user_id, OLD.analyst_name, OLD.start_date, OLD.end_date, OLD.is_active,
        NEW.user_id, NEW.analyst_name, NEW.start_date, NEW.end_date, NEW.is_active,
        NEW.changed_by, NEW.updated_at, v_org_id
      );
      RETURN NEW;
    END;

  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO coverage_history (
      coverage_id, asset_id, change_type,
      old_user_id, old_analyst_name, old_start_date, old_end_date, old_is_active,
      changed_by, changed_at, organization_id
    ) VALUES (
      OLD.id, OLD.asset_id, 'deleted',
      OLD.user_id, OLD.analyst_name, OLD.start_date, OLD.end_date, OLD.is_active,
      auth.uid(), NOW(), v_org_id
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The lane is immutable
--
-- A personal row may never become an org row, and an org row may never become a
-- personal row. The personal policies already pin the lane in USING and WITH
-- CHECK, so the personal lane cannot convert in either direction on its own.
-- This exists for the admin lane, which is intentionally not lane-restricted on
-- UPDATE so admins can still govern and clean up personal rows -- and would
-- therefore otherwise be able to promote one into a governed assignment, or
-- demote a governed assignment into something its subject can edit.
--
-- A trigger rather than more policy, because the rule is about the transition
-- rather than about who is asking, and it should hold no matter which policy
-- admitted the row -- including `service_role`, which no policy constrains.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_coverage_scope_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.coverage_scope IS DISTINCT FROM OLD.coverage_scope THEN
    RAISE EXCEPTION
      'coverage_scope is immutable (attempted % -> %). Retire the row and '
      'create a new one in the intended lane instead.',
      OLD.coverage_scope, NEW.coverage_scope
      USING ERRCODE = 'P0032';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_coverage_scope_immutable ON public.coverage;
CREATE TRIGGER trg_coverage_scope_immutable
  BEFORE UPDATE ON public.coverage
  FOR EACH ROW EXECUTE FUNCTION public.enforce_coverage_scope_immutable();

-- ---------------------------------------------------------------------------
-- 4. Personal rows carry honest provenance
--
-- `created_by` is what tells a later reader a row was self-declared, and
-- `changed_by` is copied into `coverage_history`. Both are ordinary nullable
-- columns with no constraint, so without this a user could create a row they
-- own while naming a colleague as its author -- putting a false statement in
-- the audit trail, from a lane that is now open to every authenticated user.
--
-- Scoped to `personal` on purpose: org rows keep whatever the admin path sets,
-- which is existing behaviour already gated behind the admin flag. Scoped to
-- `auth.uid() IS NOT NULL` so service-role backfills and migrations are not
-- rewritten to a NULL author.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.stamp_personal_coverage_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.coverage_scope = 'personal' AND auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
    END IF;
    NEW.changed_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stamp_personal_coverage ON public.coverage;
CREATE TRIGGER trg_stamp_personal_coverage
  BEFORE INSERT OR UPDATE ON public.coverage
  FOR EACH ROW EXECUTE FUNCTION public.stamp_personal_coverage_provenance();

COMMIT;
