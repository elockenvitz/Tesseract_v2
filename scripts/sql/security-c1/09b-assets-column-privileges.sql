-- =============================================================================
-- C1/09b — assets: revoke the proprietary columns from ordinary access
--
-- RESTRICTIVE AND POST-DEPLOY. This is the security boundary, and it is the
-- statement that breaks an old client: `SELECT *` on `assets` expands to every
-- column and then checks privileges on all of them, so any query still asking
-- for the restricted columns FAILS ENTIRELY rather than returning fewer fields.
--
-- It must therefore run AFTER the application deploy, not before:
--
--     01 … 08b → 09a → APPLICATION DEPLOY → 09b → 10 → 11
--
-- Splitting this from 09a is what makes a zero-break release possible. 09a puts
-- the workflow data where the new client reads it, while the old client keeps
-- working; the deploy switches the readers; 09b then closes the door behind
-- them.
--
-- `assets` is a global security master: one shared row per ticker, no
-- organization, SELECT USING (true). Correct for identity, listing and market
-- reference. Nine columns on it were not reference data at all:
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
-- on a row every tenant shares cannot hold a second org's answer.
--
-- IDEMPOTENT. Re-running re-issues the same REVOKE and GRANT statements, which
-- are declarative; the assertions then re-verify the same end state.
--
-- NOT DESTRUCTIVE. No column is dropped. The two quarantined prose values stay
-- in place, unreadable but recoverable if an organization is ever established
-- for them. Physical removal is deliberately left out of C1: dropping is
-- irreversible and buys nothing the revoke has not already bought.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- The boundary: column-level privileges.
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
    RAISE EXCEPTION 'C1/09b: assets has unreviewed column(s) %. Classify them as reference or proprietary before granting.', unreviewed;
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

  RAISE NOTICE 'C1/09b: granted % readable columns on assets; % restricted columns withheld',
    array_length(string_to_array(readable, ', '), 1), array_length(restricted, 1);
END $$;

-- DELETE stays row-level: it has no column granularity, and the existing
-- `auth.uid() = created_by` policy already constrains it.

-- -----------------------------------------------------------------------------
-- Verification.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  leaked text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO leaked
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'assets'
     AND grantee = 'authenticated' AND privilege_type = 'SELECT'
     AND column_name IN ('thesis','where_different','risks_to_thesis','quick_note',
                         'quick_note_updated_at','thesis_references','completeness',
                         'priority','process_stage','workflow_id');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'C1/09b: authenticated can still read restricted column(s): %', leaked;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.table_privileges
              WHERE table_schema='public' AND table_name='assets'
                AND grantee='authenticated' AND privilege_type='SELECT') THEN
    RAISE EXCEPTION 'C1/09b: a table-wide SELECT grant remains and overrides the column list';
  END IF;

  RAISE NOTICE 'C1/09b: the nine proprietary columns are unreachable by authenticated; assets exposes reference data only';
END $$;

COMMIT;
