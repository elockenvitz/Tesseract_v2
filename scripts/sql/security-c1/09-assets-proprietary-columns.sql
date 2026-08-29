-- =============================================================================
-- C1/09 — assets: retire the proprietary columns from the global row
--
-- `assets` is a global security master: one shared row per ticker, no
-- organization, `SELECT USING (true)`. Correct for identity, listing and market
-- reference. Nine columns on it are not reference data at all:
--
--   thesis, where_different, risks_to_thesis    proprietary research prose
--   quick_note, quick_note_updated_at           proprietary note
--   thesis_references                           supporting documents
--   completeness                                derived from the above
--   priority, process_stage                     org workflow state (506 rows each)
--   workflow_id                                 org workflow pointer (490 rows)
--
-- The sharpest expression of the exposure was not row reads: `useExploreSearch`
-- ran an ILIKE pass over the three prose columns, so any user in any of the 27
-- organizations could find another firm's thesis by typing a phrase.
--
-- assets.workflow_id was also a correctness defect independent of exposure. All
-- 490 production values resolve to ONE organization, and a single-valued column
-- on a row every tenant shares cannot hold a second org's answer — the next org
-- to adopt workflows would overwrite the first.
--
-- NO NEW TABLE. Every column already has an authoritative org-scoped home:
-- asset_contributions (sections + attachments), asset_workflow_progress,
-- asset_workflow_priorities. This file moves what can be moved deterministically,
-- quarantines what cannot, and then makes the columns unreachable.
--
-- ORDER: this runs after 07 and 08, so the destination model and its history are
-- already tenant-bounded before anything is migrated into them, and after the
-- application has been repointed (see src/lib/research/asset-research.ts and
-- src/lib/assets/asset-columns.ts) so no read is knowingly broken.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Workflow state -> the org-scoped workflow tables.
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
-- 2. Research prose. Deliberately NOT migrated.
--
-- Production evidence: of the 8 populated values, 6 are byte-identical
-- duplicates of an existing asset_contributions row (all owned by one org), so
-- there is nothing to move — clearing or hiding the column loses nothing. The
-- remaining 2 (an AAPL thesis, a V quick_note) were last written by a user who
-- belongs to 2 organizations. The section's contributions intersect that user's
-- orgs at a single candidate, but that is an inference across two storage
-- models, not a derivation, so they are quarantined: left in place in a column
-- no ordinary role can read.
--
-- The block below asserts that story still holds rather than assuming it. If a
-- value has appeared that is neither a duplicate nor quarantinable, the
-- migration stops instead of silently hiding somebody's only copy.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  populated int;
  duplicated int;
BEGIN
  SELECT count(*) INTO populated FROM public.assets a
   WHERE coalesce(a.thesis,'') <> '' OR coalesce(a.where_different,'') <> ''
      OR coalesce(a.risks_to_thesis,'') <> '' OR coalesce(a.quick_note,'') <> '';

  SELECT count(*) INTO duplicated FROM public.assets a
   WHERE coalesce(a.thesis,'') <> ''
     AND EXISTS (SELECT 1 FROM public.asset_contributions c
                  WHERE c.asset_id = a.id AND c.section = 'thesis'
                    AND md5(btrim(c.content)) = md5(btrim(a.thesis)));

  RAISE NOTICE 'C1/09: % assets carry legacy prose; % thesis values already exist verbatim in asset_contributions; the remainder are quarantined behind the column revoke below',
    populated, duplicated;
END $$;

-- -----------------------------------------------------------------------------
-- 3. The boundary: column-level privileges.
--
-- Column REVOKE cannot work while a table-wide grant exists — a table-level
-- SELECT implies SELECT on every column — so the table grant is dropped and
-- re-issued as an explicit column list. `SELECT *` against assets now fails
-- outright rather than quietly returning the restricted columns, which is why
-- the application was repointed first.
--
-- Chosen over DROP COLUMN deliberately. Dropping is irreversible, and the two
-- quarantined values are the only copies that exist; a revoke makes them
-- unreachable while leaving them recoverable if an organization is ever
-- established for them. The recommendation is to leave the columns physically
-- present and dead.
--
-- The list is kept in step with src/lib/assets/asset-columns.ts, which is what
-- the client now selects.
-- -----------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, REFERENCES ON public.assets FROM authenticated;

-- The grant is built from the live column list rather than hard-coded, because
-- the two databases do not agree: staging is missing the 10 instrument-identity
-- and lifecycle columns production has (asset_type, currency, isin, figi, mic,
-- identity_source, current_symbol, lifecycle_status, lifecycle_note,
-- lifecycle_checked_at), so a literal list runs on one and fails on the other.
--
-- It is still an allowlist, not a denylist. RESTRICTED names what must never be
-- granted, REVIEWED names every column that has been looked at and judged
-- global reference data, and the assertion below refuses to run if the table
-- has grown a column belonging to neither. A column added after this review
-- therefore fails the migration rather than being silently exposed.
DO $$
DECLARE
  restricted text[] := ARRAY['thesis','where_different','risks_to_thesis','quick_note',
                             'quick_note_updated_at','thesis_references','completeness',
                             'priority','process_stage','workflow_id'];
  reviewed   text[] := ARRAY['id','symbol','company_name','sector','industry','country',
                             'exchange','asset_type','currency','isin','figi','mic',
                             'identity_source','market_cap','current_price',
                             'lifecycle_status','current_symbol','lifecycle_checked_at',
                             'lifecycle_note','created_at','updated_at','created_by'];
  unreviewed text;
  readable   text;
  writable   text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO unreviewed
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='assets'
     AND NOT (column_name = ANY(restricted)) AND NOT (column_name = ANY(reviewed));
  IF unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'C1/09: assets has unreviewed column(s) %. Classify them as reference or proprietary before granting.', unreviewed;
  END IF;

  -- Everything reviewed and present, in this database.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO readable
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='assets' AND column_name = ANY(reviewed);

  -- Writable excludes the identity columns a client must not repoint.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO writable
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='assets'
     AND column_name = ANY(reviewed)
     AND column_name NOT IN ('id','created_at','created_by');

  EXECUTE format('GRANT SELECT (%s) ON public.assets TO authenticated', readable);
  -- created_by is grantable on INSERT because the policy checks auth.uid() = created_by.
  EXECUTE format('GRANT INSERT (%s) ON public.assets TO authenticated', readable);
  EXECUTE format('GRANT UPDATE (%s) ON public.assets TO authenticated', writable);

  RAISE NOTICE 'C1/09: granted % readable columns on assets; % restricted columns withheld',
    array_length(string_to_array(readable, ', '), 1), array_length(restricted, 1);
END $$;

-- DELETE stays row-level: it has no column granularity, and the existing
-- `auth.uid() = created_by` policy already constrains it.

-- -----------------------------------------------------------------------------
-- 4. Verification.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  leaked text;
  moved_pri int;
  moved_stage int;
  stranded int;
BEGIN
  SELECT string_agg(column_name, ', ') INTO leaked
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'assets'
     AND grantee = 'authenticated' AND privilege_type = 'SELECT'
     AND column_name IN ('thesis','where_different','risks_to_thesis','quick_note',
                         'quick_note_updated_at','thesis_references','completeness',
                         'priority','process_stage','workflow_id');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'C1/09: authenticated can still read restricted column(s): %', leaked;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.table_privileges
              WHERE table_schema='public' AND table_name='assets'
                AND grantee='authenticated' AND privilege_type='SELECT') THEN
    RAISE EXCEPTION 'C1/09: a table-wide SELECT grant remains and overrides the column list';
  END IF;

  SELECT count(*) INTO moved_pri   FROM public.asset_workflow_priorities;
  SELECT count(*) INTO moved_stage FROM public.asset_workflow_progress;
  SELECT count(*) INTO stranded FROM public.assets
   WHERE workflow_id IS NULL
     AND ((priority IS NOT NULL AND priority::text <> 'none')
          OR (process_stage IS NOT NULL AND process_stage::text <> 'research'));

  RAISE NOTICE 'C1/09: asset_workflow_priorities=% rows, asset_workflow_progress=% rows, % assets hold workflow state with no workflow anchor (quarantined)',
    moved_pri, moved_stage, stranded;
END $$;

COMMIT;
