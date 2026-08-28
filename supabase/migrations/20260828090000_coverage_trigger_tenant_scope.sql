-- =============================================================================
-- Coverage triggers: scope every cross-row read and write to one tenant.
--
-- Three statements across the two `coverage` triggers reach outside the
-- organization of the row being written. All three are reachable from an
-- ordinary INSERT or UPDATE on `coverage`.
--
--   (1) `end_previous_coverage()` resolves `allow_multiple_coverage` with
--       `SELECT ... FROM coverage_settings LIMIT 1` — no org predicate, no
--       ORDER BY. One arbitrary organization's setting governs every
--       organization, and which one is whatever the planner returns first.
--
--   (2) When that setting is not true, the same function runs
--       `UPDATE coverage SET is_active = false WHERE asset_id = NEW.asset_id
--        AND id != NEW.id AND is_active = true AND end_date IS NULL` — no org
--       predicate. One tenant's insert retires other tenants' coverage of the
--       same asset. `assets` is a shared catalogue, so two tenants covering
--       the same security is the normal case, not a corner case.
--
--   (3) `log_coverage_change()` selects "the existing coverage" for the asset
--       with that same unscoped predicate and copies the row's `user_id` and
--       `analyst_name` into `coverage_history` as `old_user_id` /
--       `old_analyst_name`. This one is live today: the function is
--       SECURITY DEFINER, so the read bypasses RLS outright and can write
--       another tenant's analyst into this tenant's audit trail.
--
-- (1) and (2) are currently masked rather than safe. `end_previous_coverage()`
-- is SECURITY INVOKER, so its UPDATE is filtered by the `coverage` UPDATE
-- policy — which still admits `organization_id IS NULL` rows belonging to any
-- tenant, and which stops filtering anything at all under `service_role`, a
-- SECURITY DEFINER caller, or any future change to that policy. A trigger that
-- is only safe because of the policy currently sitting above it is not safe;
-- it is lucky.
--
-- ── The behaviour this migration must NOT change ─────────────────────────────
--
-- Production has ONE `coverage_settings` row, for 27 organizations, and it says
-- `allow_multiple_coverage = true`. Because the lookup is `LIMIT 1` with no
-- predicate, that single row is what every organization reads today — so the
-- effective state of production is "multiple coverage allowed, everywhere",
-- and the destructive branch in (2) never executes.
--
-- Scoping the lookup naively would therefore be a regression, not a fix: the
-- 26 organizations with no settings row of their own would resolve NULL, fall
-- into `IS NOT TRUE`, and begin superseding coverage they have never
-- superseded before. A security fix that silently starts deactivating rows is
-- worse than the bug it closes.
--
-- So a missing settings row now explicitly means `allow_multiple := true`.
-- That is the same answer every organization gets today, arrived at honestly
-- instead of by borrowing another tenant's row.
--
-- ── Fail closed ──────────────────────────────────────────────────────────────
--
-- `coverage.organization_id` is nullable (0 such rows in production, but the
-- column permits them). With no tenant there is no correct set of rows to
-- inspect or retire, so both functions decline to act rather than guess:
-- (2) skips the supersede entirely, and (3) finds no previous coverage and
-- logs `created` rather than attributing the change to an arbitrary analyst.
-- Declining is the closed direction here — the alternative is a cross-row
-- mutation against an unknown tenant.
--
-- Deliberately NOT in this migration: no schema change, no policy change, no
-- change to either function's security context or search_path, and no change
-- to any history row this function writes beyond the `old_*` values in (3)
-- that were being sourced from the wrong tenant. Everything else is
-- byte-for-byte the deployed definition.
--
-- Verified read-only against production and staging on 2026-08-28: both
-- projects carry byte-identical definitions of both functions
-- (md5 3336cfa29c778c66d22b95c1a683ce01 and ce7573b46f3849173a06a15e082d3c72).
--
-- Idempotent: both statements are CREATE OR REPLACE.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) + (2) — end_previous_coverage()
-- ─────────────────────────────────────────────────────────────────────────────

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
        AND organization_id = NEW.organization_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) — log_coverage_change()
--
-- Three changes only: the settings read is scoped the same way as above, and
-- the two `v_existing_coverage` lookups gain an organization predicate. Every
-- other line, including every `coverage_history` column list and value, is the
-- deployed definition unchanged.
--
-- `organization_id = v_org_id` rather than `IS NOT DISTINCT FROM`: when
-- `v_org_id` is NULL the comparison yields NULL, no row is FOUND, and the
-- function logs `created` instead of attributing the change to some other
-- tenant's analyst. Treating two tenant-less rows as the same tenant — which
-- `IS NOT DISTINCT FROM` would do — is the bug in a smaller costume.
-- ─────────────────────────────────────────────────────────────────────────────

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

COMMIT;
