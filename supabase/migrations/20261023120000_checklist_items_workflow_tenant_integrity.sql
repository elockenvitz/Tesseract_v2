-- =============================================================================
-- asset_checklist_items — requirement/workflow tenant integrity
--
-- THE DEFECT, REPRODUCED
--
-- `asset_checklist_items.organization_id` is stamped by a BEFORE trigger from
-- `current_org_id()` — the caller's session — while `workflow_id` is FK-bound
-- to `workflows(id)` and checked against nothing else. Nothing ties the two
-- together, so a member of org A can create, or repoint, a requirement whose
-- workflow belongs to org B.
--
-- Executed against production on 2026-10-22 inside a rollback transaction:
--
--   org A inserts a requirement referencing org B's PRIVATE workflow  → WROTE
--   org A repoints an existing requirement at org B's workflow        → REPOINTED
--
-- WHAT IT IS AND IS NOT
--
-- It is referential corruption, not data exposure. The planted row is stamped
-- with the attacker's own org, so the victim cannot read it; the victim's
-- workflow row and stage rows stay hidden behind their own policies; and a
-- cross-org process RUN is already refused, because
-- `asset_workflow_progress`'s policy derives org from the workflow. All four
-- were verified.
--
-- It still matters. A dangling cross-tenant pointer is exactly the thing an
-- audit writer, a report, or a future join would follow — and the first draft
-- of the Process audit design did derive event tenancy from this workflow,
-- which would have written one org's history into another's.
--
-- THE FIX
--
-- A composite foreign key, not a trigger. It is declarative, so it holds for
-- authenticated clients, for cron, for SECURITY DEFINER functions and for the
-- table owner alike — a trigger can be disabled and a definer function can
-- sidestep one. And it compares data to data rather than to a session, so it
-- cannot break the automation that has no session.
--
-- `MATCH SIMPLE` (the default) does not enforce when a referencing column is
-- NULL. That is deliberate: it grandfathers the 7 quarantined rows that carry
-- NULL in BOTH columns, with no backfill and no remediation. See the residual
-- note at the foot of this file.
--
-- Verified on the live schema, 2026-10-23:
--   asset_checklist_items.workflow_id       uuid, nullable
--   asset_checklist_items.organization_id   uuid, nullable
--   workflows.organization_id               uuid, NOT NULL
--   rows with mismatched orgs                             0
--   rows with NULL org AND NULL workflow                  7
--   rows with exactly one of the two NULL                 0
--
-- NOT APPLIED. Authored for review.
-- Rollback: 20261023120001_checklist_items_workflow_tenant_integrity_DOWN.sql.rollback
-- Test:     supabase/tests/checklist-items-workflow-tenant-integrity.sql
-- =============================================================================

BEGIN;

-- --- The referencable key ------------------------------------------------------
-- `id` is already the primary key; a composite foreign key needs a unique
-- constraint over exactly the referenced pair, so this adds one. It is
-- redundant for uniqueness and required for referencability.
ALTER TABLE workflows
  ADD CONSTRAINT workflows_id_org_key
  UNIQUE (id, organization_id);

-- --- The boundary --------------------------------------------------------------
-- A requirement may only reference a workflow owned by the requirement's own
-- organization. No ON DELETE clause: the existing single-column FK
-- (`asset_checklist_items_workflow_id_fkey`) already governs what happens when
-- a workflow is deleted, and this constraint must not quietly change that.
ALTER TABLE asset_checklist_items
  ADD CONSTRAINT asset_checklist_items_workflow_same_org_fkey
  FOREIGN KEY (workflow_id, organization_id)
  REFERENCES workflows (id, organization_id);

COMMIT;

-- --- Verification (run after applying) ----------------------------------------
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname IN ('workflows_id_org_key',
--                      'asset_checklist_items_workflow_same_org_fkey');
--
-- Expect the unique constraint on (id, organization_id) and the two-column FK.
--
-- --- Residual, reported not fixed ---------------------------------------------
-- `MATCH SIMPLE` means a row with `organization_id` NULL and a cross-org
-- `workflow_id` is not caught. No client can reach that state today: the
-- `asset_checklist_items_set_org` BEFORE trigger fills a NULL org from
-- `current_org_id()`, and the INSERT policy's WITH CHECK requires
-- `organization_id = current_org_id()`, which is unsatisfiable when
-- `current_org_id()` is NULL. `MATCH FULL` would close it, but would also
-- reject a requirement that legitimately has an org and no workflow — a shape
-- the nullable column still permits. Assertion 11 in the test proves the
-- bypass is unreachable through the authenticated role.
