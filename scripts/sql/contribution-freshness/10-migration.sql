-- ============================================================================
-- contribution-freshness / 10 — MIGRATION  ***DO NOT APPLY***
--
-- PREPARED, UNAPPLIED, AND DELIBERATELY NOT IN supabase/migrations/ so that a
-- deploy cannot pick it up. Applying it requires separate explicit approval,
-- and 00-verify-readonly.sql must be run first: Q1/Q2 name the existing
-- triggers this one has to coexist with, and the backfill in 20- depends on
-- Q5's bucket counts.
--
-- ── What it adds ────────────────────────────────────────────────────────────
--
--   content_updated_at        when the PUBLISHED PROSE last changed
--   content_updated_at_source where that value came from
--
-- `updated_at` is left exactly as it is. It keeps its current meaning — "this
-- row was touched" — and every existing reader keeps working. The new column
-- is the one the Snapshot, the staleness resolver and the Evolution Timeline
-- should read, because they all ask the narrower question and have been
-- getting the wider answer.
--
-- ── Why the maintenance is a trigger and not application code ───────────────
--
-- Six client paths write this row today (`saveContribution`, `saveDraft`,
-- `publishDraft`, `discardDraft`, `updateVisibility`, `saveSectionReferences`),
-- and three of them stamp `updated_at` by hand. A seventh will be added by
-- somebody who has not read this file. A trigger is the only place the rule
-- can live where a new write path cannot bypass it — and note the ELSE branch:
-- it RESTORES the old value, so a client that sets `content_updated_at`
-- explicitly without changing the prose cannot forge freshness.
-- ============================================================================

BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.asset_contributions
  ADD COLUMN IF NOT EXISTS content_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_updated_at_source text;

COMMENT ON COLUMN public.asset_contributions.content_updated_at IS
  'When the published prose (content) last changed. NULL means unknown — a '
  'legacy row whose last content write cannot be dated. Never derived from '
  'updated_at, which also advances on visibility, attachment and draft writes. '
  'Maintained by trigger; client-supplied values are ignored unless content changed.';

COMMENT ON COLUMN public.asset_contributions.content_updated_at_source IS
  'Provenance for content_updated_at: trigger | history | revision | '
  'never_updated | manual_date_only | NULL (unknown). manual_date_only means '
  'the DATE is known from an incident record but the time of day is not — '
  'readers must render it without a clock.';

-- Provenance is enforced, not advisory: an undocumented value cannot be stored.
ALTER TABLE public.asset_contributions
  DROP CONSTRAINT IF EXISTS asset_contributions_content_updated_at_source_chk;
ALTER TABLE public.asset_contributions
  ADD CONSTRAINT asset_contributions_content_updated_at_source_chk
  CHECK (
    content_updated_at_source IS NULL
    OR content_updated_at_source IN
       ('trigger','history','revision','never_updated','manual_date_only')
  );

-- A source without a timestamp, or a timestamp claiming no source, is a bug.
ALTER TABLE public.asset_contributions
  DROP CONSTRAINT IF EXISTS asset_contributions_content_updated_at_pair_chk;
ALTER TABLE public.asset_contributions
  ADD CONSTRAINT asset_contributions_content_updated_at_pair_chk
  CHECK ((content_updated_at IS NULL) = (content_updated_at_source IS NULL));

-- ── 2. Prose identity ──────────────────────────────────────────────────────
-- Must agree with `normalizeProse` in src/lib/research/change-classification.ts.
-- If one changes, the other is wrong, and the drift shows up as a section that
-- reports a different last-written date in the Snapshot than in the timeline.
CREATE OR REPLACE FUNCTION public.contribution_prose_identity(content text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(content, ''), '<[^>]*>', ' ', 'g'),
               '&nbsp;', ' ', 'g'),
             '\s+', ' ', 'g')
         );
$$;

COMMENT ON FUNCTION public.contribution_prose_identity(text) IS
  'Markup and whitespace flattened so a re-serialisation of identical prose is '
  'not mistaken for an edit. Wording, casing and punctuation are preserved: a '
  'change to any of them IS a content change.';

-- ── 3. Maintenance ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.asset_contributions_track_content_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.contribution_prose_identity(NEW.content) <> '' THEN
      NEW.content_updated_at        := coalesce(NEW.created_at, now());
      NEW.content_updated_at_source := 'trigger';
    ELSE
      -- A draft-only insert publishes nothing, so there is no content date.
      NEW.content_updated_at        := NULL;
      NEW.content_updated_at_source := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF public.contribution_prose_identity(NEW.content)
     IS DISTINCT FROM public.contribution_prose_identity(OLD.content) THEN
    NEW.content_updated_at        := now();
    NEW.content_updated_at_source := 'trigger';
  ELSE
    -- THE SAFEGUARD. Whatever the client sent is discarded: a visibility flip,
    -- an attachment, a draft save or a formatting-only re-serialisation cannot
    -- advance this column, by any write path, now or later.
    NEW.content_updated_at        := OLD.content_updated_at;
    NEW.content_updated_at_source := OLD.content_updated_at_source;
  END IF;

  RETURN NEW;
END
$$;

-- Named with a leading `a_` so it runs before any existing BEFORE trigger that
-- rewrites `content` (Postgres fires BEFORE triggers in name order). It reads
-- OLD/NEW.content and writes only the two new columns, so it cannot interfere
-- with whatever maintains `updated_at` — see 00-verify-readonly.sql Q1/Q2 for
-- what that actually is in production.
DROP TRIGGER IF EXISTS a_track_content_updated_at ON public.asset_contributions;
CREATE TRIGGER a_track_content_updated_at
  BEFORE INSERT OR UPDATE ON public.asset_contributions
  FOR EACH ROW
  EXECUTE FUNCTION public.asset_contributions_track_content_updated_at();

COMMIT;

-- ============================================================================
-- NON-VACUITY PROOF — run after applying, in a transaction that ROLLS BACK.
-- A trigger that silently does nothing is the documented failure mode here
-- (CLAUDE.md standing rule 3), so it must be shown refusing a metadata write.
-- ============================================================================
-- BEGIN;
--   -- pick any own-org contribution with prose
--   CREATE TEMP TABLE probe AS
--     SELECT id, content, content_updated_at FROM public.asset_contributions
--      WHERE public.contribution_prose_identity(content) <> '' LIMIT 1;
--
--   -- (a) a metadata-only write must NOT move it
--   UPDATE public.asset_contributions SET visibility = visibility
--    WHERE id = (SELECT id FROM probe);
--   SELECT 'metadata write'  AS probe,
--          (ac.content_updated_at IS NOT DISTINCT FROM p.content_updated_at) AS passed
--     FROM public.asset_contributions ac JOIN probe p ON p.id = ac.id;
--
--   -- (b) a client FORGING the column must NOT move it
--   UPDATE public.asset_contributions SET content_updated_at = now()
--    WHERE id = (SELECT id FROM probe);
--   SELECT 'forged write'    AS probe,
--          (ac.content_updated_at IS NOT DISTINCT FROM p.content_updated_at) AS passed
--     FROM public.asset_contributions ac JOIN probe p ON p.id = ac.id;
--
--   -- (c) a real prose change MUST move it
--   UPDATE public.asset_contributions SET content = content || ' probe'
--    WHERE id = (SELECT id FROM probe);
--   SELECT 'content write'   AS probe,
--          (ac.content_updated_at > coalesce(p.content_updated_at, '-infinity'::timestamptz)) AS passed
--     FROM public.asset_contributions ac JOIN probe p ON p.id = ac.id;
-- ROLLBACK;
