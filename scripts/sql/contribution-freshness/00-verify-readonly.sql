-- ============================================================================
-- contribution-freshness / 00 — READ-ONLY CHARACTERISATION
--
-- NOTHING HERE WRITES. Every statement is a SELECT. Run this FIRST; the
-- backfill in 20- cannot be written responsibly until its output is known,
-- because the only alternative is to copy `updated_at`, which is contaminated.
--
-- Why this file exists at all: the database objects that maintain
-- `asset_contributions.updated_at` and populate `asset_contribution_history`
-- ARE NOT IN VERSION CONTROL. The repository holds only the RLS policy for
-- that table (`scripts/sql/security-c1/07-asset-contribution-history.sql`).
-- The Evolution Timeline renders strings of the form `[Attachments: 2 items]`
-- and `Added 1 reference(s)` that appear NOWHERE in the application source,
-- so a production trigger composes them. Its format must be read, not guessed.
-- ============================================================================

-- Q1. What maintains these rows? Names the triggers and their functions, so
--     the migration in 10- can be ordered against them instead of hoping.
SELECT t.tgname,
       p.proname        AS function_name,
       t.tgenabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE c.relname = 'asset_contributions'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- Q2. The body of each of those functions. This is the only way to learn
--     whether `updated_at` is stamped on EVERY update (which the LLY incident
--     implies) and what shape it writes into history.
SELECT p.proname, pg_get_functiondef(p.oid) AS source
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    SELECT p2.proname
    FROM pg_trigger t
    JOIN pg_class c  ON c.oid = t.tgrelid
    JOIN pg_proc  p2 ON p2.oid = t.tgfoid
    WHERE c.relname = 'asset_contributions' AND NOT t.tgisinternal
  );

-- Q3. Does the column already exist, under this or another name?
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'asset_contributions'
ORDER BY ordinal_position;

-- Q4. History row shapes. This is the input the classifier in
--     `src/lib/research/change-classification.ts` must handle, and the reason
--     `OBSERVED_NON_PROSE_ENVELOPE` is currently a single conservative
--     pattern rather than a parser.
SELECT CASE
         WHEN h.new_content ~* '^\s*\[\s*attachments\s*:'  THEN 'attachment-envelope'
         WHEN h.new_content IS NULL                        THEN 'null'
         WHEN btrim(h.new_content) = ''                    THEN 'empty'
         WHEN h.new_content ~ '^\s*[\[{]'                  THEN 'other-structured'
         ELSE 'prose'
       END AS new_content_shape,
       (h.old_content IS NULL)                             AS old_missing,
       (btrim(coalesce(h.old_content,'')) = btrim(coalesce(h.new_content,''))) AS identical,
       count(*) AS rows
FROM public.asset_contribution_history h
GROUP BY 1, 2, 3
ORDER BY rows DESC;

-- Q5. BACKFILL BUCKETS — the numbers that decide whether the plan in 20- is
--     acceptable. Each contribution falls in exactly one bucket.
--       history_proven  : a history row proves a prose change and dates it.
--       revision_proven : an asset_revisions event dates the current content.
--       never_updated   : updated_at = created_at, so it was written once and
--                         never touched again — updated_at IS the write time.
--       unknown         : touched since creation with no surviving proof of
--                         WHICH write changed the prose. Must NOT be backfilled
--                         from updated_at.
WITH c AS (
  SELECT ac.id, ac.section, ac.content, ac.created_at, ac.updated_at,
         (SELECT max(h.changed_at)
            FROM public.asset_contribution_history h
           WHERE h.contribution_id = ac.id
             AND btrim(coalesce(h.new_content,'')) <> btrim(coalesce(h.old_content,''))
             AND h.new_content !~* '^\s*\[\s*attachments\s*:') AS history_content_at,
         (SELECT max(r.created_at)
            FROM public.asset_revisions r
            JOIN public.asset_revision_events e ON e.revision_id = r.id
           WHERE r.asset_id = ac.asset_id
             AND e.field_key = ac.section
             AND btrim(coalesce(e.after_value,'')) = btrim(coalesce(ac.content,''))) AS revision_content_at
  FROM public.asset_contributions ac
  WHERE coalesce(ac.is_archived, false) = false
)
SELECT CASE
         WHEN btrim(coalesce(content,'')) = ''                 THEN 'no_content'
         WHEN history_content_at  IS NOT NULL                  THEN 'history_proven'
         WHEN revision_content_at IS NOT NULL                  THEN 'revision_proven'
         WHEN updated_at IS NOT DISTINCT FROM created_at        THEN 'never_updated'
         ELSE 'unknown'
       END AS bucket,
       count(*) AS rows
FROM c
GROUP BY 1
ORDER BY rows DESC;

-- Q6. The LLY row named in the incident record, with every timestamp that
--     bears on it. Confirms what is recoverable before anything is proposed.
SELECT ac.id, a.symbol, ac.section, ac.created_at, ac.updated_at,
       ac.draft_updated_at,
       length(ac.content) AS content_len,
       jsonb_array_length(coalesce(ac.attachments, '[]'::jsonb)) AS attachment_count,
       (SELECT count(*) FROM public.asset_contribution_history h WHERE h.contribution_id = ac.id) AS history_rows,
       (SELECT min(h.changed_at) FROM public.asset_contribution_history h WHERE h.contribution_id = ac.id) AS first_history_at
FROM public.asset_contributions ac
JOIN public.assets a ON a.id = ac.asset_id
WHERE a.symbol = 'LLY' AND ac.section = 'thesis';

-- Q7. How wide is the contamination? Any audit_events / pilot_telemetry row
--     that dates the original write would move LLY out of the unknown bucket.
SELECT event_type, count(*) AS rows, min(created_at) AS earliest, max(created_at) AS latest
FROM public.audit_events
WHERE created_at < '2026-01-01'
  AND (event_type ILIKE '%contribution%' OR event_type ILIKE '%thesis%' OR event_type ILIKE '%research%')
GROUP BY 1
ORDER BY rows DESC;
