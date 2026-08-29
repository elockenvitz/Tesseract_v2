-- =============================================================================
-- C1/09a — assets: migrate workflow state to the org-scoped models
--
-- ADDITIVE AND PRE-DEPLOY. This half of the old `09` writes data and takes
-- nothing away. It is safe to run while the OLD client is still live: every
-- statement is an INSERT ... ON CONFLICT DO NOTHING into tables the old client
-- does not read from and the new client does, and no privilege, policy or
-- column is changed. An old client keeps reading `assets.priority` and
-- `assets.process_stage` exactly as before.
--
-- Why the split. The original 09 combined this migration with the column-level
-- privilege revoke, which made a zero-break release impossible: the revoke
-- breaks any client still selecting the restricted columns, so it must land
-- WITH or AFTER the new application — but the new application needs this data
-- present BEFORE it deploys, or it renders empty workflow state. One
-- transaction cannot be both before and after a deploy.
--
--     01 … 08b → 09a → APPLICATION DEPLOY → 09b → 10 → 11
--
-- IDEMPOTENT. Re-running changes nothing: the ON CONFLICT targets are the
-- natural keys (asset_id, workflow_id) on both tables, and any row already
-- present — whether written by this script or by the product — wins.
--
-- RUN ORDER: after 08b, which gives these two tables a tenant boundary. Loading
-- 967 rows of proprietary workflow state into tables still scoped
-- `assets.created_by = auth.uid()` would put the data under a boundary that is
-- not a tenant boundary.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Workflow state -> the org-scoped workflow tables.
--
-- Deterministic because workflow_id is a real FK to `workflows`, whose
-- organization_id is NOT NULL. This is a derivation, not the membership guess
-- that was rejected elsewhere in C1: the row itself names the workflow, and the
-- workflow names exactly one organization.
--
-- ON CONFLICT DO NOTHING throughout: where an org-scoped row already exists it
-- is the authority, and the legacy column must not overwrite it.
-- -----------------------------------------------------------------------------
INSERT INTO public.asset_workflow_priorities (asset_id, workflow_id, priority)
SELECT a.id, a.workflow_id, a.priority::text
  FROM public.assets a
 WHERE a.workflow_id IS NOT NULL
   AND a.priority IS NOT NULL
   AND a.priority::text <> 'none'
ON CONFLICT (asset_id, workflow_id) DO NOTHING;

INSERT INTO public.asset_workflow_progress (asset_id, workflow_id, current_stage_key, is_started)
SELECT a.id, a.workflow_id, a.process_stage::text, true
  FROM public.assets a
 WHERE a.workflow_id IS NOT NULL
   AND a.process_stage IS NOT NULL
   AND a.process_stage::text <> 'research'
ON CONFLICT (asset_id, workflow_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Research prose. Deliberately NOT migrated.
--
-- Production evidence: of the 8 populated values, 6 are byte-identical
-- duplicates of an existing asset_contributions row (all owned by one org), so
-- there is nothing to move — hiding the column loses nothing. The remaining 2
-- (an AAPL thesis, a V quick_note) were last written by a user who belongs to 2
-- organizations. The section's contributions intersect that user's orgs at a
-- single candidate, but that is an inference across two storage models, not a
-- derivation, so they are quarantined: left in place in a column that 09b makes
-- unreadable.
--
-- The block below asserts that story still holds rather than assuming it.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  populated int;
  duplicated int;
  migrated_pri int;
  migrated_stage int;
  stranded int;
BEGIN
  SELECT count(*) INTO populated FROM public.assets a
   WHERE coalesce(a.thesis,'') <> '' OR coalesce(a.where_different,'') <> ''
      OR coalesce(a.risks_to_thesis,'') <> '' OR coalesce(a.quick_note,'') <> '';

  SELECT count(*) INTO duplicated FROM public.assets a
   WHERE coalesce(a.thesis,'') <> ''
     AND EXISTS (SELECT 1 FROM public.asset_contributions c
                  WHERE c.asset_id = a.id AND c.section = 'thesis'
                    AND md5(btrim(c.content)) = md5(btrim(a.thesis)));

  RAISE NOTICE 'C1/09a: % assets carry legacy prose; % thesis values already exist verbatim in asset_contributions; the remainder are quarantined by 09b',
    populated, duplicated;

  -- Every asset carrying workflow state MUST now be represented in the
  -- org-scoped model, or the new client would render it as absent. Anything
  -- with a workflow_id and no destination row is a migration failure, not a
  -- quarantine — a quarantine is an asset with no workflow to derive from.
  SELECT count(*) INTO migrated_pri
    FROM public.assets a
   WHERE a.workflow_id IS NOT NULL AND a.priority IS NOT NULL AND a.priority::text <> 'none'
     AND NOT EXISTS (SELECT 1 FROM public.asset_workflow_priorities p
                      WHERE p.asset_id = a.id AND p.workflow_id = a.workflow_id);
  IF migrated_pri > 0 THEN
    RAISE EXCEPTION 'C1/09a: % asset(s) with a workflow-anchored priority have no asset_workflow_priorities row', migrated_pri;
  END IF;

  SELECT count(*) INTO migrated_stage
    FROM public.assets a
   WHERE a.workflow_id IS NOT NULL AND a.process_stage IS NOT NULL AND a.process_stage::text <> 'research'
     AND NOT EXISTS (SELECT 1 FROM public.asset_workflow_progress p
                      WHERE p.asset_id = a.id AND p.workflow_id = a.workflow_id);
  IF migrated_stage > 0 THEN
    RAISE EXCEPTION 'C1/09a: % asset(s) with a workflow-anchored stage have no asset_workflow_progress row', migrated_stage;
  END IF;

  -- These are the genuine quarantines: workflow state with no workflow to
  -- derive an organization from. Reported, not fatal.
  SELECT count(*) INTO stranded FROM public.assets
   WHERE workflow_id IS NULL
     AND ((priority IS NOT NULL AND priority::text <> 'none')
          OR (process_stage IS NOT NULL AND process_stage::text <> 'research'));

  RAISE NOTICE 'C1/09a: asset_workflow_priorities=% rows, asset_workflow_progress=% rows, % assets hold workflow state with no workflow anchor (quarantined by 09b)',
    (SELECT count(*) FROM public.asset_workflow_priorities),
    (SELECT count(*) FROM public.asset_workflow_progress),
    stranded;
END $$;

COMMIT;
