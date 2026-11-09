-- =============================================================================
-- asset_checklist_attachments — tenant isolation
--
-- THE DEFECT
--
-- Both read policies prove only that the referenced asset row exists:
--
--   SELECT  USING (EXISTS (SELECT 1 FROM assets WHERE assets.id = asset_id))
--   INSERT  WITH CHECK (EXISTS (SELECT 1 FROM assets WHERE assets.id = asset_id))
--
-- `assets` is global reference data — "Users can read all assets" is
-- USING(true) TO authenticated, by design — so that EXISTS is true for every
-- authenticated user of every organization. The predicate carries no tenant
-- information at all, and the table has no organization_id to carry it.
--
-- Effect: any signed-in user could read every organization's attachment rows
-- (file_name, file_path, description, uploader) and insert a row against
-- another organization's requirement. The worst real path is the asset-scoped
-- read in AssetTab, which filters on asset_id alone: two firms covering AAPL
-- saw each other's attachment filenames on the same ticker.
--
-- UPDATE and DELETE were `uploaded_by = auth.uid()` with no tenant predicate.
--
-- THE BOUNDARY
--
-- No new column. `workflow_id` already carries the tenant: it is FK-bound to
-- workflows(id), and `workflows.organization_id` is the authoritative owner.
-- `workflow_in_current_org(uuid)` already exists — STABLE SECURITY DEFINER,
-- search_path pinned — and is already the boundary on general_checklist_items
-- and general_workflow_progress.
--
-- This also makes the asset table match its own twin, which was remediated
-- and this one was not:
--
--   portfolio_checklist_attachments  SELECT  portfolio_in_current_org(portfolio_id)
--                                    INSERT  … AND uploaded_by = auth.uid()
--
-- `workflow_id` is NULLABLE, and workflow_in_current_org(NULL) is false, so a
-- row with no workflow is readable by nobody and writable by nobody. That is
-- the fail-closed direction. It is safe today because the table holds ZERO
-- rows in production (verified 2026-10-22), so there is nothing to orphan and
-- no backfill to run. A future writer that omits workflow_id will be refused
-- rather than quietly escaping the boundary.
--
-- Storage is untouched. The `assets` bucket already requires
-- foldername[1] = current_org_id(), so the file bytes were never exposed;
-- this closes the metadata half.
--
-- NOT APPLIED. Authored for review under the Stage 1 approval gate.
-- Rollback: 20261022120001_checklist_attachments_tenant_isolation_DOWN.sql.rollback
-- Test:     supabase/tests/checklist-attachments-tenant-isolation.sql
-- =============================================================================

BEGIN;

-- --- Drop every known variant -------------------------------------------------
-- Production has drifted from the migration that created this table: the
-- shipped migration wrote `USING (true)` for SELECT, while production carries
-- an `EXISTS (… assets …)` form under a different name. Both are dropped, by
-- both names, so this migration lands on either.

DROP POLICY IF EXISTS "Users can read attachments"                               ON asset_checklist_attachments;
DROP POLICY IF EXISTS "Users can create attachments"                             ON asset_checklist_attachments;
DROP POLICY IF EXISTS "Users can view attachments for assets they have access to" ON asset_checklist_attachments;
DROP POLICY IF EXISTS "Users can insert attachments for assets they have access to" ON asset_checklist_attachments;
DROP POLICY IF EXISTS "Users can update their own attachments"                   ON asset_checklist_attachments;
DROP POLICY IF EXISTS "Users can delete their own attachments"                   ON asset_checklist_attachments;
-- Idempotence for a re-run of this migration itself.
DROP POLICY IF EXISTS asset_checklist_attachments_select ON asset_checklist_attachments;
DROP POLICY IF EXISTS asset_checklist_attachments_insert ON asset_checklist_attachments;
DROP POLICY IF EXISTS asset_checklist_attachments_update ON asset_checklist_attachments;
DROP POLICY IF EXISTS asset_checklist_attachments_delete ON asset_checklist_attachments;

ALTER TABLE asset_checklist_attachments ENABLE ROW LEVEL SECURITY;

-- --- The boundary -------------------------------------------------------------
-- TO authenticated on every policy: an unqualified policy applies to PUBLIC,
-- which is how the anon role reaches a table it was granted.

-- Read: any active member of the owning organization. Deliberately NOT limited
-- to the uploader — a colleague must be able to open the file a teammate
-- attached to a shared requirement, which is the point of the feature.
CREATE POLICY asset_checklist_attachments_select
  ON asset_checklist_attachments
  FOR SELECT
  TO authenticated
  USING (workflow_in_current_org(workflow_id));

-- Write: the same organization, and you upload as yourself.
CREATE POLICY asset_checklist_attachments_insert
  ON asset_checklist_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workflow_in_current_org(workflow_id)
    AND uploaded_by = auth.uid()
  );

CREATE POLICY asset_checklist_attachments_update
  ON asset_checklist_attachments
  FOR UPDATE
  TO authenticated
  USING (
    workflow_in_current_org(workflow_id)
    AND uploaded_by = auth.uid()
  )
  WITH CHECK (
    workflow_in_current_org(workflow_id)
    AND uploaded_by = auth.uid()
  );

CREATE POLICY asset_checklist_attachments_delete
  ON asset_checklist_attachments
  FOR DELETE
  TO authenticated
  USING (
    workflow_in_current_org(workflow_id)
    AND uploaded_by = auth.uid()
  );

-- --- Grants -------------------------------------------------------------------
-- anon held DELETE, INSERT, SELECT, UPDATE, REFERENCES, TRIGGER and TRUNCATE on
-- this table. The grant was inert, because the old policy's subquery needed
-- `assets` read access that anon does not have — but CLAUDE.md admits no anon
-- grant on an org-owned table, and the next policy edit should not be what
-- turns a dormant grant live.
REVOKE ALL ON asset_checklist_attachments FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON asset_checklist_attachments TO authenticated;

COMMIT;

-- --- Verification (run after applying) ---------------------------------------
-- Expect exactly four policies, all TO {authenticated}, every predicate naming
-- workflow_in_current_org:
--
--   SELECT p.polname, p.polcmd,
--          pg_get_expr(p.polqual, p.polrelid)      AS using_expr,
--          pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr,
--          (SELECT array_agg(r.rolname) FROM pg_roles r WHERE r.oid = ANY(p.polroles)) AS roles
--     FROM pg_policy p
--     JOIN pg_class c ON c.oid = p.polrelid
--    WHERE c.relname = 'asset_checklist_attachments';
--
-- And no anon grant:
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'asset_checklist_attachments' AND grantee = 'anon';
