-- =============================================================================
-- C1/10 — asset_field_history: split system history from research history
--
-- `SELECT USING (true)` over 1,066 rows, 100% visible to a user in no
-- organization. But the rows are not one population, and blanket-quarantining
-- them would have been wrong:
--
--   process_stage   1039 rows, 1007 unattributed, 505 assets, a four-week
--                   window — the signature of a bulk/system operation, not user
--                   edits. Workflow-state churn on global asset records.
--   priority          13 rows, 1 unattributed
--   thesis            10 rows, 0 unattributed  \
--   risks_to_thesis    2 rows, 0 unattributed   > research prose in
--   where_different    2 rows, 0 unattributed  /  old_value / new_value
--
-- The 14 research rows are 100% attributed and carry the same prose the columns
-- did. They are NOT given an inferred organization: 12 of 14 sit on an
-- (asset_id, section) pair with exactly one owning org in asset_contributions,
-- but that infers tenancy for a global-column write from a different table's
-- row — the same reasoning that was rejected for the values themselves. They
-- become creator-only, matching the treatment of asset_revision_events.
--
-- Forward, there is no new proprietary research history to authorise: 09
-- revoked UPDATE on the research columns, so track_asset_field_changes() can no
-- longer be triggered for them by an ordinary user. The org-scoped successor is
-- asset_contribution_history, which 07 bounded.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users can read asset field history"      ON public.asset_field_history;
DROP POLICY IF EXISTS "System can insert asset field history"   ON public.asset_field_history;

-- Two clauses, one per population. `field_name` is the discriminator because it
-- is what actually distinguishes them — the table has no organization, and
-- inventing one for the research rows is exactly what this avoids.
--
-- The system-readable set is exactly the approved one: process_stage and
-- priority. `thesis_references` was briefly included here and should not have
-- been. It is the list of documents supporting a thesis — what a firm read to
-- reach its view — which is proprietary research, not workflow state, and it is
-- one of the nine columns 09b revokes for exactly that reason. Production holds
-- zero such history rows today, so nothing changes hands either way; the
-- forward rule still has to be right, because the moment one is written it
-- would have been world-readable.
-- Replay-safety: these files must be re-runnable against an already
-- remediated database, so the new policy names are dropped as well as the
-- old ones. Without this a second run fails on "policy already exists".
DROP POLICY IF EXISTS asset_field_history_select ON public.asset_field_history;
CREATE POLICY asset_field_history_select ON public.asset_field_history
  FOR SELECT TO authenticated
  USING (
    -- System / workflow-state history over global asset records.
    field_name IN ('process_stage', 'priority')
    -- Proprietary research history: its author only.
    OR changed_by = auth.uid()
  );

-- The only writer is track_asset_field_changes(), a SECURITY DEFINER trigger
-- running as the table owner, so it needs no policy. The previous
-- `WITH CHECK (true)` INSERT policy let any authenticated user forge history
-- rows directly; it is not replaced.

DO $$
DECLARE system_rows int; research_rows int; orphaned int; leaked text;
BEGIN
  -- Regression guard: the system-readable branch must name only the approved
  -- workflow fields. If a research field is ever added back to that list, this
  -- fails rather than shipping.
  SELECT string_agg(f, ', ') INTO leaked
    FROM unnest(ARRAY['thesis','where_different','risks_to_thesis','quick_note',
                      'thesis_references','completeness']) AS f
   WHERE EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='asset_field_history'
                    AND cmd='SELECT' AND qual LIKE '%''' || f || '''%');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'C1/10: research field(s) % are in the system-readable branch', leaked;
  END IF;

  SELECT count(*) FILTER (WHERE field_name IN ('process_stage','priority')),
         count(*) FILTER (WHERE field_name IN ('thesis','risks_to_thesis','where_different','quick_note','thesis_references')),
         count(*) FILTER (WHERE field_name IN ('thesis','risks_to_thesis','where_different','quick_note','thesis_references')
                            AND changed_by IS NULL)
    INTO system_rows, research_rows, orphaned
    FROM public.asset_field_history;

  RAISE NOTICE 'C1/10: % system rows remain authenticated-readable, % research rows are creator-only, % of those have no author and are now unreachable',
    system_rows, research_rows, orphaned;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='asset_field_history' AND (qual='true' OR with_check='true')) THEN
    RAISE EXCEPTION 'C1/10: an unconditional policy remains';
  END IF;
END $$;

COMMIT;
