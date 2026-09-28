-- Idea Pipeline, PHASE C — CONTRACT. Irreversible.
--
-- ── Do not apply this until the Phase B application is deployed and stable ─
--
-- It rewrites every legacy stage row and then removes the legacy labels from
-- the type. The moment it commits, any still-running OLD application instance
-- throws on its next stage write. That is acceptable only once no old
-- instance remains.
--
-- The migration cannot verify that from inside the database — a deployed
-- application version is not a fact SQL can read. It checks everything it
-- CAN: that expand ran, that no legacy rows survive its own rewrite, that no
-- SQL function still emits a legacy label, and that the sibling status enum
-- is untouched. The one prerequisite left to a human is written out at the
-- bottom rather than silently assumed.
--
-- ── What it does ───────────────────────────────────────────────────────────
--
--   1. refuse unless Phase A has run
--   2. record every row's original stage
--   3. rewrite rows on BOTH columns that use this enum
--   4. rewrite the pilot seeder functions
--   5. swap both columns onto a clean four-value type
--   6. verify, including the shared-label protection
--
-- Steps 2-6 are one transaction. A half-contracted schema is not a state
-- anything should observe.

-- ── 0. Preconditions — outside the transaction, so they fail fast ──────────
DO $pre$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(want, ', ') INTO v_missing
    FROM unnest(ARRAY['exploring', 'researching', 'developing', 'ready_to_recommend']) want
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'trade_stage' AND e.enumlabel = want
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Phase A (expand) has not been applied — trade_stage is missing %. Apply 20260928120000_idea_pipeline_expand.sql first, deploy the compatible application, then return here.',
      v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'trade_queue_items'
       AND column_name = 'stage_migrated_from'
  ) THEN
    RAISE EXCEPTION 'stage_migrated_from is absent — Phase A did not complete.';
  END IF;
END;
$pre$;

BEGIN;

-- ── 1. Record what each row was, before touching anything ──────────────────
UPDATE public.trade_queue_items
   SET stage_migrated_from = stage::text
 WHERE stage_migrated_from IS NULL;

UPDATE public.trade_idea_portfolios
   SET stage_migrated_from = stage::text
 WHERE stage_migrated_from IS NULL;

-- ── 2. The mapping, applied to rows ────────────────────────────────────────
--
--   aware, idea            → exploring   On the radar; no real time committed.
--
--   investigate            → researching NOT exploring, which is where the
--                                        label alone would suggest. Its own
--                                        description in the app was "actively
--                                        researching fundamentals, catalysts
--                                        and competitive position" — that is
--                                        evidence-gathering. Sending those
--                                        rows to `exploring` would demote work
--                                        genuinely underway AND leave
--                                        `researching` empty on day one.
--
--   deep_research          → developing  Despite the name: "building the
--                                        model, stress-testing assumptions,
--                                        sizing" is synthesis, not gathering.
--   thesis_forming         → developing  Literally forming the view.
--   modeling, simulating   → developing  Scenario and sizing work.
--   working_on, discussing → developing  Ambiguous legacy labels; this is
--                                        where the v1→v2 mapping already sent
--                                        them, so it preserves the existing
--                                        reading rather than inventing one.
--
--   ready_for_decision     → ready_to_recommend   Direct rename.
--   deciding               → ready_to_recommend   The stage goes, the fact
--                                        does not: stage_migrated_from keeps
--                                        it, and any real decision lives in
--                                        decision_requests / accepted_trades.
CREATE OR REPLACE FUNCTION pg_temp.canonical_stage(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE p
    WHEN 'aware'              THEN 'exploring'
    WHEN 'idea'               THEN 'exploring'
    WHEN 'investigate'        THEN 'researching'
    WHEN 'deep_research'      THEN 'developing'
    WHEN 'thesis_forming'     THEN 'developing'
    WHEN 'modeling'           THEN 'developing'
    WHEN 'simulating'         THEN 'developing'
    WHEN 'working_on'         THEN 'developing'
    WHEN 'discussing'         THEN 'developing'
    WHEN 'ready_for_decision' THEN 'ready_to_recommend'
    WHEN 'deciding'           THEN 'ready_to_recommend'
    -- Already canonical values pass through unchanged. Rows written by the
    -- Phase B application during the rollout window land here.
    WHEN 'exploring'          THEN 'exploring'
    WHEN 'researching'        THEN 'researching'
    WHEN 'developing'         THEN 'developing'
    WHEN 'ready_to_recommend' THEN 'ready_to_recommend'
  END
$fn$;

-- Refuse on anything the map does not know, naming it. Without this the
-- UPDATE below would write NULL into a NOT NULL column and fail with an error
-- that names neither the value nor the row.
DO $guard$
DECLARE
  v_unmapped text;
BEGIN
  SELECT string_agg(DISTINCT s, ', ') INTO v_unmapped FROM (
    SELECT stage::text AS s FROM public.trade_queue_items
    UNION
    SELECT stage::text FROM public.trade_idea_portfolios
  ) all_stages
  WHERE pg_temp.canonical_stage(s) IS NULL;

  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION 'Unmapped stage value(s): %. Add them to canonical_stage before contracting.', v_unmapped;
  END IF;
END;
$guard$;

UPDATE public.trade_queue_items
   SET stage = pg_temp.canonical_stage(stage::text)::public.trade_stage
 WHERE stage::text IS DISTINCT FROM pg_temp.canonical_stage(stage::text);

UPDATE public.trade_idea_portfolios
   SET stage = pg_temp.canonical_stage(stage::text)::public.trade_stage
 WHERE stage::text IS DISTINCT FROM pg_temp.canonical_stage(stage::text);

-- ── 3. Swap both columns onto a clean four-value type ──────────────────────
--
-- PostgreSQL cannot remove a label from an enum, so the legacy labels go by
-- building a replacement type and retyping onto it. Both columns move
-- together: leaving `trade_idea_portfolios.stage` on the old type would be a
-- split model, and would pin `trade_stage` in place forever.
--
-- Every value is canonical by now, so the USING clause is a plain cast rather
-- than a second copy of the mapping — one mapping, in `canonical_stage`.
--
-- This runs BEFORE the function rewrite below, and the order matters: the
-- seeders carry `::trade_stage` casts, and those have to become `::idea_stage`
-- to match the column they feed. Rewriting the functions first would leave
-- them casting to a type the column no longer is — valid SQL that fails at
-- RUN time, inside a provisioning path that swallows the error. The first
-- draft of this migration did exactly that; the fixture caught it.
DO $mk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typname = 'idea_stage'
  ) THEN
    CREATE TYPE public.idea_stage AS ENUM (
      'exploring', 'researching', 'developing', 'ready_to_recommend'
    );
  END IF;
END;
$mk$;

ALTER TABLE public.trade_queue_items
  ALTER COLUMN stage DROP DEFAULT,
  ALTER COLUMN stage TYPE public.idea_stage USING stage::text::public.idea_stage;

ALTER TABLE public.trade_idea_portfolios
  ALTER COLUMN stage DROP DEFAULT,
  ALTER COLUMN stage TYPE public.idea_stage USING stage::text::public.idea_stage;

-- New ideas start at the beginning. Safe now, and only now: before the swap
-- a default of `exploring` would have been reachable by INSERTs from old code
-- that cannot read it.
ALTER TABLE public.trade_queue_items
  ALTER COLUMN stage SET DEFAULT 'exploring'::public.idea_stage;

-- ── 4. Rewrite the functions that emit legacy labels ───────────────────────
--
-- Four pilot/demo seeder bodies hardcode stage literals. They are called from
-- best-effort provisioning paths that swallow errors, so without this a new
-- pilot org would simply get no demo data and nothing would say why.
--
-- ── The trap this loop exists to avoid ─────────────────────────────────────
--
-- `trade_stage` and `trade_queue_status` SHARE FOUR LABELS: idea, discussing,
-- simulating, deciding. The seeders write both columns, adjacent, in one
-- positional VALUES tuple:
--
--     (gen_random_uuid(), 'ready_for_decision', 'deciding', p_org)
--                          ^ stage              ^ status
--
-- Neither literal is anywhere near the word "stage", so no predicate over the
-- surrounding text can tell which column a bare literal feeds. An earlier
-- draft rewrote every quoted label and turned that status into
-- 'ready_to_recommend', which trade_queue_status rejects — at seeder RUN time,
-- silently. So bare literals are rewritten ONLY for the seven labels unique
-- to trade_stage; the four shared ones are rewritten only when an explicit
-- ::trade_stage cast proves they are stages.
--
-- The substitution is then CHECKED by counting, below, because a loop that
-- matched nothing looks identical to one that worked.
DO $fix$
DECLARE
  r        record;
  v_def    text;
  v_new    text;
  v_shared text;
  v_before int;
  v_cast   int;
  v_after  int;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosrc LIKE '%trade_queue_items%'
       AND (
         p.prosrc LIKE '%trade_stage%'
         OR p.prosrc ~ '''(aware|investigate|deep_research|thesis_forming|ready_for_decision|working_on|modeling)'''
       )
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;

    -- (a) Cast-qualified: the cast settles which column the literal feeds, so
    --     even the shared labels are safe to rewrite here. The cast itself is
    --     retargeted at the same time — the column is `idea_stage` now.
    v_new := replace(v_new, '''ready_for_decision''::trade_stage', '''ready_to_recommend''::idea_stage');
    v_new := replace(v_new, '''thesis_forming''::trade_stage',     '''developing''::idea_stage');
    v_new := replace(v_new, '''deep_research''::trade_stage',      '''developing''::idea_stage');
    v_new := replace(v_new, '''investigate''::trade_stage',        '''researching''::idea_stage');
    v_new := replace(v_new, '''working_on''::trade_stage',         '''developing''::idea_stage');
    v_new := replace(v_new, '''modeling''::trade_stage',           '''developing''::idea_stage');
    v_new := replace(v_new, '''aware''::trade_stage',              '''exploring''::idea_stage');
    v_new := replace(v_new, '''deciding''::trade_stage',           '''ready_to_recommend''::idea_stage');
    v_new := replace(v_new, '''discussing''::trade_stage',         '''developing''::idea_stage');
    v_new := replace(v_new, '''simulating''::trade_stage',         '''developing''::idea_stage');
    v_new := replace(v_new, '''idea''::trade_stage',               '''exploring''::idea_stage');

    -- (b) Bare literals — ONLY the seven unique to trade_stage. A bare
    --     'aware' cannot be anything but a stage.
    v_new := replace(v_new, '''ready_for_decision''', '''ready_to_recommend''');
    v_new := replace(v_new, '''thesis_forming''',     '''developing''');
    v_new := replace(v_new, '''deep_research''',      '''developing''');
    v_new := replace(v_new, '''investigate''',        '''researching''');
    v_new := replace(v_new, '''working_on''',         '''developing''');
    v_new := replace(v_new, '''modeling''',           '''developing''');
    v_new := replace(v_new, '''aware''',              '''exploring''');

    -- (c) Any surviving reference to the retired type itself. A bare
    --     `::trade_stage` left behind would be valid SQL against a column
    --     that is no longer that type.
    v_new := replace(v_new, '::trade_stage', '::idea_stage');
    v_new := replace(v_new, 'trade_stage[]', 'idea_stage[]');

    -- (d) Prove no shared label was disturbed, by counting rather than by
    --     pattern. Every legitimate rewrite of a shared label was
    --     cast-qualified and consumed in (a), so each shared label's count
    --     must now equal its original count minus its cast-qualified ones.
    --     Any further drop means a bare status literal was hit.
    FOREACH v_shared IN ARRAY ARRAY['idea', 'discussing', 'simulating', 'deciding'] LOOP
      v_before := (length(v_def) - length(replace(v_def, '''' || v_shared || '''', '')))
                / length('''' || v_shared || '''');
      v_cast   := (length(v_def) - length(replace(v_def, '''' || v_shared || '''::trade_stage', '')))
                / length('''' || v_shared || '''::trade_stage');
      v_after  := (length(v_new) - length(replace(v_new, '''' || v_shared || '''', '')))
                / length('''' || v_shared || '''');

      IF v_after IS DISTINCT FROM (v_before - v_cast) THEN
        RAISE EXCEPTION
          'Rewrite disturbed the shared label ''%'' in %: % occurrences before (% cast-qualified), % after — expected %. A trade_queue_status literal was almost certainly rewritten.',
          v_shared, r.sig, v_before, v_cast, v_after, v_before - v_cast;
      END IF;
    END LOOP;

    IF v_new IS DISTINCT FROM v_def THEN
      EXECUTE v_new;
      RAISE NOTICE 'Rewrote stage literals in %', r.sig;
    END IF;
  END LOOP;
END;
$fix$;

-- ── 5. Verify ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_type    text;
  v_labels  text;
  v_n       bigint;
  v_status  text;
BEGIN
  FOR v_type, v_labels IN
    SELECT c.relname, format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND a.attname = 'stage'
       AND c.relname IN ('trade_queue_items', 'trade_idea_portfolios')
  LOOP
    IF v_labels IS DISTINCT FROM 'idea_stage' THEN
      RAISE EXCEPTION '%.stage is still %, expected idea_stage', v_type, v_labels;
    END IF;
  END LOOP;

  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO v_labels
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'idea_stage';
  IF v_labels IS DISTINCT FROM 'exploring,researching,developing,ready_to_recommend' THEN
    RAISE EXCEPTION 'idea_stage labels/order are [%]', COALESCE(v_labels, '<null>');
  END IF;

  -- Every row carries its origin.
  SELECT count(*) INTO v_n FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% trade_queue_items rows have no stage_migrated_from', v_n;
  END IF;

  -- No function may still contain a retired stage label. Only the seven
  -- unique to trade_stage are checked: the four shared with
  -- trade_queue_status remain legitimate in these bodies AS STATUSES, and
  -- flagging them would fail the migration for writing correct SQL.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_labels
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.prosrc LIKE '%trade_queue_items%'
     AND p.prosrc ~ '''(aware|investigate|deep_research|thesis_forming|ready_for_decision|working_on|modeling)''';
  IF v_labels IS NOT NULL THEN
    RAISE EXCEPTION 'Retired stage literal still present in: %', v_labels;
  END IF;

  -- The sibling enum is byte-for-byte what it was.
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO v_status
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'trade_queue_status';
  IF v_status IS DISTINCT FROM
     'idea,discussing,approved,rejected,executed,cancelled,deleted,deciding,simulating,archived'
  THEN
    RAISE EXCEPTION 'trade_queue_status was altered: [%]', v_status;
  END IF;

  RAISE NOTICE 'Contract verified: both columns on idea_stage, four labels, status enum intact.';
END;
$verify$;

COMMIT;

-- ── Deliberately NOT done here ─────────────────────────────────────────────
--
-- `DROP TYPE public.trade_stage` is not run. After this migration nothing
-- references it, so dropping is possible — but it is irreversible and buys
-- nothing, and `stage_migrated_from` holds the old labels as text either way.
-- It belongs in a later cleanup, alongside removing `LEGACY_STAGE_MAP` from
-- the application, once production has run on four stages long enough that
-- nobody wants the old column back.
--
-- ── THE HUMAN PREREQUISITE ─────────────────────────────────────────────────
--
-- No SQL check can tell whether an old application instance is still running.
-- Before applying this, confirm that the Phase B build is fully rolled out and
-- no pre-four-stage instance remains serving traffic. This query should return
-- zero for a sustained period beforehand — it detects an old writer by the
-- labels it leaves behind:
--
--   SELECT count(*) FROM trade_queue_items
--    WHERE stage::text IN ('aware','investigate','deep_research','thesis_forming',
--                          'ready_for_decision','idea','discussing','working_on',
--                          'modeling','simulating','deciding')
--      AND updated_at > now() - interval '1 hour';
--
-- A non-zero result means something is still writing legacy stages. Find it
-- before contracting; this migration will happily rewrite those rows and the
-- writer will then start failing.
