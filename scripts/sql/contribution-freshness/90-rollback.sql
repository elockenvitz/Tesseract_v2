-- ============================================================================
-- contribution-freshness / 90 — ROLLBACK  ***DO NOT APPLY***
--
-- Reverses 10- and 20- without touching `content`, `updated_at`, attachments
-- or any other production data. The backfill log is what makes the data half
-- reversible; it is dropped LAST and only by the full teardown.
-- ============================================================================

-- ── A. Undo the backfill only (keep the column and trigger) ────────────────
BEGIN;
  UPDATE public.asset_contributions ac
     SET content_updated_at        = l.prior_content_updated_at,
         content_updated_at_source = l.prior_content_updated_at_source
    FROM public.contribution_freshness_backfill_log l
   WHERE l.contribution_id = ac.id;

  -- Expect 0 rows still carrying a backfilled provenance.
  SELECT count(*) AS rows_still_backfilled
    FROM public.asset_contributions
   WHERE content_updated_at_source IN ('history','revision','never_updated','manual_date_only');
COMMIT;

-- ── B. Full teardown ───────────────────────────────────────────────────────
-- Note the ORDER: the trigger goes first, so no write can repopulate the
-- column between the two statements.
-- BEGIN;
--   DROP TRIGGER IF EXISTS a_track_content_updated_at ON public.asset_contributions;
--   DROP FUNCTION IF EXISTS public.asset_contributions_track_content_updated_at();
--
--   ALTER TABLE public.asset_contributions
--     DROP CONSTRAINT IF EXISTS asset_contributions_content_updated_at_pair_chk,
--     DROP CONSTRAINT IF EXISTS asset_contributions_content_updated_at_source_chk,
--     DROP COLUMN IF EXISTS content_updated_at_source,
--     DROP COLUMN IF EXISTS content_updated_at;
--
--   -- contribution_prose_identity is referenced by 00-/20- diagnostics; drop
--   -- only if nothing else has started using it.
--   DROP FUNCTION IF EXISTS public.contribution_prose_identity(text);
--
--   DROP TABLE IF EXISTS public.contribution_freshness_backfill_log;
-- COMMIT;

-- ── RLS posture of the one new table ───────────────────────────────────────
-- `contribution_freshness_backfill_log` is an operations artifact, not a
-- product surface: it holds contribution ids and timestamps, no prose. It is
-- created with no grants, so under Supabase defaults `anon` and
-- `authenticated` cannot read it and only the service role can. Enable RLS
-- explicitly anyway, so the posture is stated in the schema rather than
-- inferred from an absent grant:
--
--   ALTER TABLE public.contribution_freshness_backfill_log ENABLE ROW LEVEL SECURITY;
--   REVOKE ALL ON public.contribution_freshness_backfill_log FROM anon, authenticated;
--
-- With RLS on and no policy, every non-superuser read returns zero rows.
-- Verify after applying:
--   SELECT relrowsecurity FROM pg_class WHERE relname='contribution_freshness_backfill_log';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name='contribution_freshness_backfill_log';
