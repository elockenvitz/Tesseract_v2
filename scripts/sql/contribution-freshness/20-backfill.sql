-- ============================================================================
-- contribution-freshness / 20 — BACKFILL  ***DO NOT APPLY***
--
-- Prepared, unapplied. Requires 10- applied and 00- run first.
--
-- ── The rule this file obeys ────────────────────────────────────────────────
--
-- `updated_at` IS NOT A CONTENT DATE and is not copied as one. It advances on
-- visibility changes (`updateVisibility` stamps it), on attachment changes (a
-- production trigger stamps it — this is how the LLY thesis moved from
-- 2025-12-12 to 2026-10-20), and on draft activity. Copying it would write a
-- false "last written" date into every contaminated row and make the lie
-- permanent and unauditable.
--
-- So each row is dated only from evidence that actually witnesses a prose
-- write, in descending order of strength, and a row with no such evidence is
-- left NULL — "unknown" — rather than guessed. `content_updated_at_source`
-- records which rung of the ladder each value came from, so the next reader
-- does not have to re-derive this.
--
-- Pass 3 is the only one that touches `updated_at`, and only where
-- `updated_at = created_at` proves the row was written once and never touched
-- again. In that case `updated_at` is not a copy of a contaminated clock — it
-- is the original write, by construction.
-- ============================================================================

BEGIN;

-- Safety: refuse to run against a schema without the target columns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='asset_contributions'
       AND column_name='content_updated_at'
  ) THEN
    RAISE EXCEPTION 'content_updated_at missing — apply 10-migration.sql first';
  END IF;
END $$;

-- A reversible record of every pre-backfill value. Keep it: without this the
-- backfill cannot be undone, and 90-rollback.sql reads from it.
CREATE TABLE IF NOT EXISTS public.contribution_freshness_backfill_log (
  contribution_id uuid PRIMARY KEY REFERENCES public.asset_contributions(id) ON DELETE CASCADE,
  prior_content_updated_at        timestamptz,
  prior_content_updated_at_source text,
  prior_updated_at                timestamptz,
  assigned_content_updated_at     timestamptz,
  assigned_source                 text,
  logged_at                       timestamptz NOT NULL DEFAULT now()
);

-- ── Pass 1: history-proven ─────────────────────────────────────────────────
-- A history row whose new_content differs from old_content IS a prose write,
-- and `changed_at` dates it. Attachment-envelope rows are excluded: their
-- format is unread (00- Q4), so they witness nothing about prose.
WITH proven AS (
  SELECT h.contribution_id, max(h.changed_at) AS at
    FROM public.asset_contribution_history h
   WHERE public.contribution_prose_identity(h.new_content)
         IS DISTINCT FROM public.contribution_prose_identity(h.old_content)
     AND h.new_content !~* '^\s*\[\s*attachments\s*:'
     AND h.old_content !~* '^\s*\[\s*attachments\s*:'
   GROUP BY h.contribution_id
), logged AS (
  INSERT INTO public.contribution_freshness_backfill_log AS l
    (contribution_id, prior_content_updated_at, prior_content_updated_at_source,
     prior_updated_at, assigned_content_updated_at, assigned_source)
  SELECT ac.id, ac.content_updated_at, ac.content_updated_at_source,
         ac.updated_at, p.at, 'history'
    FROM public.asset_contributions ac
    JOIN proven p ON p.contribution_id = ac.id
   WHERE ac.content_updated_at IS NULL
     AND public.contribution_prose_identity(ac.content) <> ''
  ON CONFLICT (contribution_id) DO NOTHING
  RETURNING l.contribution_id, l.assigned_content_updated_at
)
UPDATE public.asset_contributions ac
   SET content_updated_at        = lg.assigned_content_updated_at,
       content_updated_at_source = 'history'
  FROM logged lg
 WHERE ac.id = lg.contribution_id;

-- ── Pass 2: revision-proven ────────────────────────────────────────────────
-- `asset_revision_events.after_value` matching the CURRENT content means that
-- revision produced the prose standing today, so its timestamp dates it.
WITH proven AS (
  SELECT ac.id AS contribution_id, max(r.created_at) AS at
    FROM public.asset_contributions ac
    JOIN public.asset_revisions r       ON r.asset_id = ac.asset_id
    JOIN public.asset_revision_events e ON e.revision_id = r.id
   WHERE e.field_key = ac.section
     AND public.contribution_prose_identity(e.after_value)
         = public.contribution_prose_identity(ac.content)
     AND ac.content_updated_at IS NULL
     AND public.contribution_prose_identity(ac.content) <> ''
   GROUP BY ac.id
), logged AS (
  INSERT INTO public.contribution_freshness_backfill_log AS l
    (contribution_id, prior_content_updated_at, prior_content_updated_at_source,
     prior_updated_at, assigned_content_updated_at, assigned_source)
  SELECT ac.id, ac.content_updated_at, ac.content_updated_at_source,
         ac.updated_at, p.at, 'revision'
    FROM public.asset_contributions ac
    JOIN proven p ON p.contribution_id = ac.id
  ON CONFLICT (contribution_id) DO NOTHING
  RETURNING l.contribution_id, l.assigned_content_updated_at
)
UPDATE public.asset_contributions ac
   SET content_updated_at        = lg.assigned_content_updated_at,
       content_updated_at_source = 'revision'
  FROM logged lg
 WHERE ac.id = lg.contribution_id;

-- ── Pass 3: never updated ──────────────────────────────────────────────────
-- `updated_at = created_at` means no UPDATE has ever run on this row, so no
-- metadata write can have contaminated it. This is the ONLY place updated_at
-- is read, and it is read as the original INSERT, not as a last-write clock.
WITH logged AS (
  INSERT INTO public.contribution_freshness_backfill_log AS l
    (contribution_id, prior_content_updated_at, prior_content_updated_at_source,
     prior_updated_at, assigned_content_updated_at, assigned_source)
  SELECT ac.id, ac.content_updated_at, ac.content_updated_at_source,
         ac.updated_at, ac.created_at, 'never_updated'
    FROM public.asset_contributions ac
   WHERE ac.content_updated_at IS NULL
     AND public.contribution_prose_identity(ac.content) <> ''
     AND ac.updated_at IS NOT DISTINCT FROM ac.created_at
  ON CONFLICT (contribution_id) DO NOTHING
  RETURNING l.contribution_id, l.assigned_content_updated_at
)
UPDATE public.asset_contributions ac
   SET content_updated_at        = lg.assigned_content_updated_at,
       content_updated_at_source = 'never_updated'
  FROM logged lg
 WHERE ac.id = lg.contribution_id;

-- ── Pass 4: UNKNOWN — deliberately not backfilled ──────────────────────────
-- Everything still NULL was updated at least once with no surviving evidence
-- of which write changed the prose. These rows stay NULL. The UI must render
-- "last written date unknown"; it must not fall back to `updated_at`, or the
-- contamination simply reappears one layer up.
SELECT 'unknown (left NULL by design)' AS bucket, count(*) AS rows
  FROM public.asset_contributions ac
 WHERE ac.content_updated_at IS NULL
   AND public.contribution_prose_identity(ac.content) <> '';

-- Outcome, by provenance.
SELECT coalesce(content_updated_at_source, 'unknown') AS source, count(*) AS rows
  FROM public.asset_contributions
 WHERE public.contribution_prose_identity(content) <> ''
 GROUP BY 1 ORDER BY rows DESC;

COMMIT;

-- ============================================================================
-- 30 — THE LLY EXCEPTION  ***SEPARATE APPROVAL, NOT PART OF THE BACKFILL***
--
-- See docs/contribution-freshness-audit.md § "LLY incident". The thesis was
-- written 2025-12-12; its `updated_at` was overwritten to 2026-10-20 during
-- browser testing of the Phase 4 evidence picker and the original value is
-- UNRECOVERABLE — there is no history row, no revision event and no audit row
-- for the original write. The DATE is known from the product's own prior
-- display; the TIME OF DAY is not known and is not invented here.
--
-- `manual_date_only` is what makes that honest: readers of this column MUST
-- render a date-only source without a time. Run only if 00- Q6 confirms the
-- row is still in the unknown bucket.
-- ============================================================================
-- BEGIN;
--   INSERT INTO public.contribution_freshness_backfill_log
--     (contribution_id, prior_content_updated_at, prior_content_updated_at_source,
--      prior_updated_at, assigned_content_updated_at, assigned_source)
--   SELECT ac.id, ac.content_updated_at, ac.content_updated_at_source, ac.updated_at,
--          '2025-12-12T00:00:00Z'::timestamptz, 'manual_date_only'
--     FROM public.asset_contributions ac
--     JOIN public.assets a ON a.id = ac.asset_id
--    WHERE a.symbol = 'LLY' AND ac.section = 'thesis'
--   ON CONFLICT (contribution_id) DO NOTHING;
--
--   UPDATE public.asset_contributions ac
--      SET content_updated_at        = '2025-12-12T00:00:00Z'::timestamptz,
--          content_updated_at_source = 'manual_date_only'
--     FROM public.assets a
--    WHERE a.id = ac.asset_id AND a.symbol = 'LLY' AND ac.section = 'thesis';
--
--   -- Expect exactly 1. Anything else means the row set changed: ROLLBACK.
--   SELECT count(*) FROM public.asset_contributions ac JOIN public.assets a ON a.id = ac.asset_id
--    WHERE a.symbol='LLY' AND ac.section='thesis' AND ac.content_updated_at_source='manual_date_only';
-- ROLLBACK;  -- change to COMMIT only after the count reads 1
