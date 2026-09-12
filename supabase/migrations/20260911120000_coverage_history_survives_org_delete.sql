-- Deleting an organization must not be blocked by its own audit trail.
--
-- ── The failure, exactly ─────────────────────────────────────────────────
--
--   DELETE FROM organizations WHERE id = :org
--     -> coverage cascades           (coverage_organization_id_fkey ON DELETE CASCADE)
--        -> log_coverage_change() fires per row, TG_OP = 'DELETE'
--           -> INSERT INTO coverage_history (..., organization_id = :org)
--              -> coverage_history_organization_id_fkey has nothing to point at
--                 -> ERROR, and the whole organization delete aborts
--
-- Reproduced deleting a client org from the ops portal:
--   insert or update on table "coverage_history" violates foreign key
--   constraint "coverage_history_organization_id_fkey"
--
-- The cascade on `coverage_history` does not help. It removes history rows
-- when an org goes; it cannot permit one to be CREATED for an org that is
-- already gone.
--
-- ── The fix, and what it deliberately is not ─────────────────────────────
--
-- One guard on the DELETE branch: write the history row only while the parent
-- organization still exists. A coverage row disappearing as part of tenant
-- teardown therefore records nothing, which is correct — the audit trail it
-- would join is being deleted in the same statement.
--
-- Everything else is untouched. INSERT and UPDATE auditing is byte-identical,
-- and an ordinary DELETE of one coverage row in a live organization still
-- writes its `deleted` record, which is the case that actually matters.
--
-- Rejected alternatives, for the record:
--
--   * making `coverage_history.organization_id` nullable, or SET NULL on
--     delete — the column exists to keep one tenant's audit trail out of
--     another's (see 20260828090000), and detaching rows from their tenant is
--     the opposite of that
--   * dropping the FK — same objection, louder
--   * disabling the trigger during teardown — a session-level setting that
--     every future caller would have to remember
--   * sequencing the deletes in the ops portal — the database must make
--     DELETE organization safe whatever the caller does
--
-- ── Siblings ─────────────────────────────────────────────────────────────
--
-- Checked every function in this repository with a `TG_OP = 'DELETE'` branch
-- against the fifteen tables that cascade from `organizations`. Three others
-- write an audit row on delete — `portfolio_team_history`,
-- `asset_list_activity` and `project_activity` — and none of them carries an
-- `organization_id`, so none can reach this constraint. `coverage_history` is
-- the only instance.
--
-- Idempotent: CREATE OR REPLACE of one function, no DDL on any table.

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
    -- Only while the tenant still exists.
    --
    -- On an ordinary delete this is true and the `deleted` record is written
    -- exactly as before. During organization teardown it is false: `coverage`
    -- is cascading from a row that has already gone, and inserting history
    -- naming that organization is what aborted the delete. The history this
    -- skips is history the same statement is deleting.
    IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id) THEN
      INSERT INTO coverage_history (
        coverage_id, asset_id, change_type,
        old_user_id, old_analyst_name, old_start_date, old_end_date, old_is_active,
        changed_by, changed_at, organization_id
      ) VALUES (
        OLD.id, OLD.asset_id, 'deleted',
        OLD.user_id, OLD.analyst_name, OLD.start_date, OLD.end_date, OLD.is_active,
        auth.uid(), NOW(), v_org_id
      );
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;
