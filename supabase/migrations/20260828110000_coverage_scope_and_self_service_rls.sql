-- =============================================================================
-- Coverage: two lanes, and the policies that keep them apart.
--
-- Adds `coverage_scope`, closes the NULL-organization escape hatch, and
-- replaces the coverage policies with an admin lane and a personal lane so an
-- ordinary professional can state what they follow without a `coverage_admin`
-- flag that 2 of 26 accounts hold.
--
-- Trigger semantics are NOT in this file. They are the companion migration,
-- 20260828110100_coverage_triggers_scope_aware.sql, and BOTH are required for
-- the model to be safe: with only this one applied, a personal insert can still
-- retire an admin-assigned row, because `end_previous_coverage()` matches on
-- asset and organization without regard to lane or owner. That is demonstrated
-- rather than asserted — see supabase/tests/coverage-self-service-security.sql,
-- whose trigger assertions fail against this migration alone.
--
-- ── Verified read-only against production and staging, 2026-08-28 ──────────
--
--   * 34 coverage rows, 26 active, 4 distinct users, ONE organization
--   * 0 rows with a NULL organization_id
--   * `coverage_scope` does not exist yet on either project
--   * staging carries byte-identical policies and triggers to production
--
-- ── Why every existing row is deterministically `org` ──────────────────────
--
-- Not a guess about intent. Until this migration the ONLY way to insert a
-- coverage row was through
-- `WITH CHECK (is_coverage_admin() AND ...)`, so every one of the 34 rows was
-- written by a coverage admin. There is no self-declared row to mistake for an
-- assigned one, because there was no way to declare one.
--
-- Note for anyone tempted to infer ownership from data: one production row has
-- `created_by = user_id`. That is an admin who assigned coverage to themselves,
-- not a self-service row, and reading it as `personal` would hand a governed
-- assignment to the person it names. This migration does not look at
-- `created_by` at all.
--
-- Idempotent. Rollback is 20260828110200_..._rollback.sql.disabled — read it
-- before rolling back, because dropping the column is not a no-op once personal
-- rows exist.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The lane discriminator
--
-- `personal` — declared by `coverage.user_id` about themselves. Editable by
--              exactly that user. Governs nothing.
-- `org`      — assigned by coverage authority. Editable only by coverage
--              admins of the owning organization.
--
-- DEFAULT 'org' is load-bearing. Any write path that has not been taught about
-- lanes — including one added later by someone who never read this file —
-- lands in the governed lane and stays admin-only. The permissive value has to
-- be asked for explicitly, by name.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.coverage
  ADD COLUMN IF NOT EXISTS coverage_scope text NOT NULL DEFAULT 'org';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coverage'::regclass AND conname = 'coverage_scope_valid'
  ) THEN
    ALTER TABLE public.coverage
      ADD CONSTRAINT coverage_scope_valid CHECK (coverage_scope IN ('personal', 'org'));
  END IF;
END $$;

-- Deterministic backfill. A statement of how the rows got here, not a guess.
-- The DEFAULT already covers rows added by the ALTER; this covers any row a
-- concurrent path might have written with an explicit NULL.
UPDATE public.coverage SET coverage_scope = 'org' WHERE coverage_scope IS NULL;

COMMENT ON COLUMN public.coverage.coverage_scope IS
  'Which lane governs this row. ''personal'' = declared by coverage.user_id '
  'about themselves, editable by them alone, carries no organizational '
  'authority. ''org'' = assigned by coverage authority, editable only by '
  'coverage admins of the owning organization. Defaults to ''org'' so an '
  'untaught write path fails closed. Immutable after insert — see '
  'enforce_coverage_scope_immutable().';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. organization_id NOT NULL
--
-- Every coverage policy currently carries an `(organization_id IS NULL OR ...)`
-- branch. A row with a NULL organization is readable by every active member of
-- every organization and writable by any coverage admin anywhere — the exact
-- cross-tenant shape the P0 work closed elsewhere.
--
-- It is safe to enforce now for three separately-checked reasons:
--
--   * production and staging both hold 0 such rows;
--   * Stage 2/2B closed the two client write paths that could create them
--     (CoverageGapsView bulk assign and the CoverageManager CSV import), and
--     an audit of all 8 client insert sites found the remaining 6 already
--     stamping the column;
--   * no database-side path requires NULL. Querying every function whose body
--     inserts into `public.coverage` returns nothing — `bootstrap_organization`
--     writes `coverage_roles` and `log_coverage_change` writes
--     `coverage_history`; neither writes `coverage`.
--
-- The 9 orphaned `coverage_history` rows with a NULL organization are a
-- different table and deliberately do not block this. They stay quarantined and
-- unattributed.
--
-- The guard refuses rather than attributing rows to a guessed tenant if the
-- count is ever non-zero.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_null int;
BEGIN
  SELECT count(*) INTO v_null FROM public.coverage WHERE organization_id IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION
      'coverage has % row(s) with a NULL organization_id. This migration will '
      'not guess which tenant they belong to. Attribute or quarantine them '
      'first, then re-run.', v_null;
  END IF;
END $$;

ALTER TABLE public.coverage ALTER COLUMN organization_id SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A personal row carries no organizational authority
--
-- `team_id` makes a row part of a team's governed coverage and `is_lead` makes
-- its holder answerable for the name. Neither is something a user may assert
-- about themselves, and the constraint enforces it independently of whatever
-- any client or policy allows.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coverage'::regclass
      AND conname = 'coverage_personal_carries_no_authority'
  ) THEN
    ALTER TABLE public.coverage
      ADD CONSTRAINT coverage_personal_carries_no_authority
      CHECK (coverage_scope <> 'personal' OR (team_id IS NULL AND is_lead IS NOT TRUE));
  END IF;
END $$;

-- "What do I cover in this workspace", the read the personal lane makes on
-- every session.
CREATE INDEX IF NOT EXISTS idx_coverage_org_user_active
  ON public.coverage (organization_id, user_id)
  WHERE is_active = true;

-- Finding a user's own personal row for an asset, which is how the data layer
-- keeps the lane free of duplicates.
CREATE INDEX IF NOT EXISTS idx_coverage_personal_owner
  ON public.coverage (organization_id, user_id, asset_id)
  WHERE coverage_scope = 'personal' AND is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Policies
--
-- Postgres OR-s permissive policies for the same command, so the lanes below
-- are independent grants rather than one widened condition.
--
-- ADMIN LANE — unchanged authority, minus the NULL branch:
--   INSERT is additionally pinned to `coverage_scope = 'org'`. That is not a
--   restriction in practice — the column defaults to 'org', so every admin
--   write path in the app continues to pass unchanged — but it means a
--   `personal` row can only ever be created by the person it names. "Self-
--   declared" stays literally true, which is the whole value of the
--   distinction.
--   UPDATE and DELETE stay unrestricted by lane, so an admin can still govern
--   and clean up everything in their organization, including a departed
--   colleague's personal rows. They cannot CONVERT a row between lanes; that is
--   blocked for everyone by a trigger in the companion migration.
--
-- PERSONAL LANE — deliberately cannot:
--   * assign to another user       — `user_id = auth.uid()`
--   * forge or move a tenant       — `organization_id = current_org_id()`, in
--                                    USING *and* WITH CHECK, so a row can
--                                    neither be created in nor moved to another
--                                    organization. current_org_id() itself
--                                    returns NULL unless the caller holds a
--                                    live active membership, so the equality
--                                    fails closed.
--   * claim team authority         — `team_id IS NULL`, `is_lead` not true
--   * escape the lane upward       — `coverage_scope = 'personal'` in WITH CHECK
--   * capture a governed row       — `coverage_scope = 'personal'` in USING,
--                                    so an org row is not even a visible
--                                    update target to this policy
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS coverage_select_org_members  ON public.coverage;
DROP POLICY IF EXISTS coverage_insert_admin_only   ON public.coverage;
DROP POLICY IF EXISTS coverage_update_admin_only   ON public.coverage;
DROP POLICY IF EXISTS coverage_delete_admin_only   ON public.coverage;
DROP POLICY IF EXISTS coverage_insert_admin        ON public.coverage;
DROP POLICY IF EXISTS coverage_update_admin        ON public.coverage;
DROP POLICY IF EXISTS coverage_delete_admin        ON public.coverage;
DROP POLICY IF EXISTS coverage_insert_own_personal ON public.coverage;
DROP POLICY IF EXISTS coverage_update_own_personal ON public.coverage;
DROP POLICY IF EXISTS coverage_delete_own_personal ON public.coverage;

-- Reads: same organization, both lanes. Coverage is not secret inside a
-- workspace — "who covers this name" is the question it exists to answer, and
-- the asset page, thesis tabs, notifications and the org chart all read it.
-- It stops at the tenant edge.
CREATE POLICY coverage_select_org_members
  ON public.coverage FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY coverage_insert_admin
  ON public.coverage FOR INSERT TO authenticated
  WITH CHECK (
    is_coverage_admin()
    AND organization_id = current_org_id()
    AND coverage_scope = 'org'
  );

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
-- quarantined rather than guessed at: dropping the NULL branch makes them
-- invisible to ordinary reads while leaving them in the table, recoverable via
-- the service role. This does NOT add NOT NULL to coverage_history.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS coverage_history_select_org_members ON public.coverage_history;
CREATE POLICY coverage_history_select_org_members
  ON public.coverage_history FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Grants
--
-- `anon` holds `arwd` on both tables and the old DELETE policy was `TO public`,
-- which includes anon. Not exploitable today — `is_coverage_admin()` and
-- `current_org_id()` both resolve through `auth.uid()`, which is NULL for anon,
-- so every policy fails for it. But a table grant that only fails because of a
-- policy predicate is one policy edit away from mattering, and nothing
-- anonymous has any business reading or writing coverage. Every policy above is
-- `TO authenticated`, including DELETE, which was not before.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.coverage         FROM anon;
REVOKE ALL ON public.coverage_history FROM anon;

COMMIT;
