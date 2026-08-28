-- =============================================================================
-- Coverage: self-service personal coverage, and the tenant boundary that makes
-- it safe.
--
-- ── Why this exists ──────────────────────────────────────────────────────────
--
-- Coverage is the context Tesseract needs in order to say anything useful to a
-- new user, and today essentially nobody has any. Verified against production
-- on 2026-08-27:
--
--   * 34 coverage rows, 26 active, 4 distinct users, in exactly ONE org.
--   * 20 one-member pilot orgs have zero coverage rows between them.
--   * 26 users; 2 global coverage admins; 0 node-level coverage admins.
--   * 13 users completed the setup wizard and 9 declared a `sector_focus`,
--     which lands in `user_profile_extended` and is read by one display column.
--
-- That is not low adoption, it is an unreachable feature: `coverage` is
-- INSERT/UPDATE/DELETE gated on `is_coverage_admin()`, and two people in the
-- whole system have that flag. A solo professional in a one-member workspace
-- cannot state what they cover, so the product cannot be relevant to them.
--
-- NOTE for anyone reading docs/coverage/current_coverage_system.md: its §8 and
-- §9 describe `coverage` RLS as `USING (true)` with UI-only enforcement and no
-- `organization_id`. That has not been true for some time. The live policies
-- are admin-only and org-scoped. The doc is stale in the dangerous direction —
-- it reads as "loosen this" when the actual problem is the opposite.
--
-- ── What this migration does ─────────────────────────────────────────────────
--
--   1. Adds `coverage_scope` — the smallest explicit discriminator between
--      coverage a person declares about themselves and coverage the
--      organization assigns. Backfilled deterministically, not inferred.
--   2. Closes the `organization_id IS NULL` escape hatch that every coverage
--      policy currently carries.
--   3. Fixes three unscoped cross-tenant paths in the coverage triggers, which
--      a self-service write path would otherwise route straight through.
--   4. Replaces the coverage policies with an admin lane and a personal lane.
--
-- Idempotent. Safe to re-run. Rollback lives in the companion `..._rollback`
-- migration; do not roll back past step 3 without re-reading its comment.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The discriminator
--
-- `personal` — the covering user said "this is mine". Self-service, editable by
--              exactly that user, governs nothing but their own attention.
-- `org`      — assigned by coverage authority. Editable only by that authority.
--              This is what every row that exists today is, by construction:
--              until this migration the only write path was admin-gated.
--
-- DEFAULT 'org' is deliberate and load-bearing. Any write path that has not
-- been taught about scope — including ones added later by someone who never
-- read this file — lands in the governed lane and stays admin-only. The
-- permissive value has to be asked for explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.coverage
  ADD COLUMN IF NOT EXISTS coverage_scope text NOT NULL DEFAULT 'org';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coverage'::regclass
      AND conname = 'coverage_scope_valid'
  ) THEN
    ALTER TABLE public.coverage
      ADD CONSTRAINT coverage_scope_valid
      CHECK (coverage_scope IN ('personal', 'org'));
  END IF;
END $$;

-- Deterministic backfill. Every pre-existing row passed through an admin-only
-- WITH CHECK, so every pre-existing row is `org`. This is a statement of that
-- fact rather than a guess about intent — there was no other way in.
UPDATE public.coverage SET coverage_scope = 'org' WHERE coverage_scope IS NULL;

COMMENT ON COLUMN public.coverage.coverage_scope IS
  'Who governs this row. ''personal'' = declared by coverage.user_id about '
  'themselves, editable by them alone. ''org'' = assigned by coverage '
  'authority, editable only by coverage admins in the owning organization. '
  'Defaults to ''org'' so an untaught write path fails closed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Close the NULL-organization escape hatch
--
-- Every coverage policy carries an `(organization_id IS NULL OR ...)` branch.
-- A row with a NULL org is readable by every active member of every
-- organization and writable by any coverage admin anywhere — the exact
-- cross-tenant shape the P0 work closed elsewhere.
--
-- It is safe to close now because the branch is dead: production has zero
-- coverage rows with a NULL organization_id. The guard below refuses to
-- proceed rather than silently attributing rows to a guessed tenant if that
-- ever stops being true.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_null_rows int;
BEGIN
  SELECT count(*) INTO v_null_rows
  FROM public.coverage WHERE organization_id IS NULL;

  IF v_null_rows > 0 THEN
    RAISE EXCEPTION
      'coverage has % row(s) with a NULL organization_id. This migration will '
      'not guess which tenant they belong to. Attribute or quarantine them '
      'first, then re-run.', v_null_rows;
  END IF;
END $$;

ALTER TABLE public.coverage ALTER COLUMN organization_id SET NOT NULL;

-- Personal rows may not carry organizational authority. `team_id` makes a row
-- part of a team's governed coverage and `is_lead` makes its holder answerable
-- for the name — neither is something a user may assert about themselves.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coverage'::regclass
      AND conname = 'coverage_personal_carries_no_authority'
  ) THEN
    ALTER TABLE public.coverage
      ADD CONSTRAINT coverage_personal_carries_no_authority
      CHECK (
        coverage_scope <> 'personal'
        OR (team_id IS NULL AND is_lead IS NOT TRUE)
      );
  END IF;
END $$;

-- The self-service read: "what do I cover in this workspace".
CREATE INDEX IF NOT EXISTS idx_coverage_org_user_active
  ON public.coverage (organization_id, user_id)
  WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The trigger fixes
--
-- Three separate unscoped statements across the two coverage triggers reach
-- across tenants. All three are reachable from an ordinary INSERT, so they had
-- to be fixed before any non-admin could perform one.
--
--   a. `end_previous_coverage()` resolves `allow_multiple_coverage` with
--      `SELECT ... FROM coverage_settings LIMIT 1` — no org filter. One
--      arbitrary organization's setting governs every organization.
--
--   b. When that setting is not true, the same function runs
--      `UPDATE coverage SET is_active = false WHERE asset_id = NEW.asset_id
--      AND id != NEW.id` — no org filter. One tenant's insert deactivates
--      other tenants' coverage of the same asset.
--
--   c. `log_coverage_change()` selects the "existing" coverage row for an
--      asset with the same unscoped predicate and copies its `user_id` and
--      `analyst_name` into `coverage_history` as the `old_*` values —
--      writing one tenant's analyst into another tenant's audit trail.
--
-- (b) and (c) are dormant today only because the single `coverage_settings`
-- row happens to say `allow_multiple_coverage = true`, and that row is the one
-- every org reads. Deleting it or setting it false arms them globally.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.end_previous_coverage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  allow_multiple BOOLEAN;
BEGIN
  IF NEW.is_active = true AND NEW.end_date IS NULL THEN
    -- Scoped to the row's own organization. A missing settings row means
    -- "allow multiple", which is what the single production row says and
    -- therefore preserves current effective behaviour for every tenant.
    SELECT cs.allow_multiple_coverage INTO allow_multiple
    FROM coverage_settings cs
    WHERE cs.organization_id = NEW.organization_id
    LIMIT 1;

    IF allow_multiple IS NULL THEN
      allow_multiple := true;
    END IF;

    IF allow_multiple IS NOT TRUE THEN
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
        -- Never reach outside the inserting row's tenant.
        AND organization_id = NEW.organization_id
        -- Never let one lane supersede the other. A personal declaration
        -- must not retire the organization's assignment, and an assignment
        -- must not silently delete somebody's personal note to self.
        AND coverage_scope = NEW.coverage_scope
        -- Within the personal lane, a user may only supersede their own row.
        AND (NEW.coverage_scope <> 'personal' OR user_id = NEW.user_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Stamp provenance on personal rows in the database rather than trusting the
-- client to send it. `created_by` is what tells a later reader that a row was
-- self-declared; a client that forgets it would produce a row indistinguishable
-- from an admin assignment.
CREATE OR REPLACE FUNCTION public.stamp_personal_coverage_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

-- Fix (c): scope the "existing coverage" lookup and the settings read inside
-- the history logger. Only the two unscoped SELECTs and the settings read
-- change; every history row this function writes is otherwise identical.
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
  IF (TG_OP = 'DELETE') THEN
    v_org_id := OLD.organization_id;
  ELSE
    v_org_id := NEW.organization_id;
  END IF;

  SELECT cs.allow_multiple_coverage INTO v_allow_multiple
  FROM coverage_settings cs
  WHERE cs.organization_id = v_org_id
  LIMIT 1;
  IF v_allow_multiple IS NULL THEN
    v_allow_multiple := true;
  END IF;

  IF (TG_OP = 'INSERT') THEN
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
        AND organization_id = v_org_id
        AND coverage_scope = NEW.coverage_scope
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
        AND organization_id = v_org_id
        AND coverage_scope = NEW.coverage_scope
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Policies: an admin lane and a personal lane
--
-- Postgres OR-s permissive policies for the same command, so these are two
-- independent grants rather than one widened condition. The admin lane is the
-- existing policy with its NULL-org branch removed and nothing else changed —
-- every write CoverageManager performs today still passes it. The personal
-- lane is new and narrow.
--
-- What the personal lane deliberately cannot do:
--   * assign coverage to another user     — `user_id = auth.uid()`
--   * forge a tenant                      — `organization_id = current_org_id()`,
--                                           and current_org_id() itself returns
--                                           NULL unless the caller holds a live
--                                           active membership of that org, so
--                                           the equality fails closed
--   * claim team authority                — `team_id IS NULL`, `is_lead` false
--   * promote itself to governed coverage — `coverage_scope = 'personal'` sits
--                                           in USING *and* WITH CHECK, so
--                                           neither direction of conversion is
--                                           reachable from this lane
--   * capture a governed row              — USING pins the OLD row to the
--                                           personal lane too
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS coverage_select_org_members    ON public.coverage;
DROP POLICY IF EXISTS coverage_insert_admin_only     ON public.coverage;
DROP POLICY IF EXISTS coverage_update_admin_only     ON public.coverage;
DROP POLICY IF EXISTS coverage_delete_admin_only     ON public.coverage;
DROP POLICY IF EXISTS coverage_insert_own_personal   ON public.coverage;
DROP POLICY IF EXISTS coverage_update_own_personal   ON public.coverage;
DROP POLICY IF EXISTS coverage_delete_own_personal   ON public.coverage;

-- Reads: same organization, both lanes. Coverage is not secret within a
-- workspace — knowing who covers what is the point of it — but it stops at
-- the tenant edge.
CREATE POLICY coverage_select_org_members
  ON public.coverage FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY coverage_insert_admin
  ON public.coverage FOR INSERT TO authenticated
  WITH CHECK (is_coverage_admin() AND organization_id = current_org_id());

CREATE POLICY coverage_update_admin
  ON public.coverage FOR UPDATE TO authenticated
  USING      (is_coverage_admin() AND organization_id = current_org_id())
  WITH CHECK (is_coverage_admin() AND organization_id = current_org_id());

CREATE POLICY coverage_delete_admin
  ON public.coverage FOR DELETE TO authenticated
  USING (is_coverage_admin() AND organization_id = current_org_id());

CREATE POLICY coverage_insert_own_personal
  ON public.coverage FOR INSERT TO authenticated
  WITH CHECK (
    coverage_scope = 'personal'
    AND user_id = auth.uid()
    AND organization_id = current_org_id()
    AND team_id IS NULL
    AND is_lead IS NOT TRUE
  );

CREATE POLICY coverage_update_own_personal
  ON public.coverage FOR UPDATE TO authenticated
  USING (
    coverage_scope = 'personal'
    AND user_id = auth.uid()
    AND organization_id = current_org_id()
  )
  WITH CHECK (
    coverage_scope = 'personal'
    AND user_id = auth.uid()
    AND organization_id = current_org_id()
    AND team_id IS NULL
    AND is_lead IS NOT TRUE
  );

CREATE POLICY coverage_delete_own_personal
  ON public.coverage FOR DELETE TO authenticated
  USING (
    coverage_scope = 'personal'
    AND user_id = auth.uid()
    AND organization_id = current_org_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. History reads stop at the tenant edge too
--
-- `coverage_history` carries 9 rows with a NULL organization_id, all orphaned
-- (their parent coverage row was deleted) and all against a single asset. They
-- predate the org column and cannot be attributed from the parent, so they are
-- quarantined rather than guessed at: the NULL branch is dropped from the read
-- policy, which makes them invisible to ordinary reads while leaving them in
-- the table, recoverable via the service role. See the rollback migration.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS coverage_history_select_org_members ON public.coverage_history;
CREATE POLICY coverage_history_select_org_members
  ON public.coverage_history FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

REVOKE ALL ON public.coverage FROM anon;
REVOKE ALL ON public.coverage_history FROM anon;

COMMIT;
