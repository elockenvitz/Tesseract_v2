-- Idea Pipeline: collapse eleven stage values into four.
--
-- ── What this changes ──────────────────────────────────────────────────────
--
-- `trade_queue_items.stage` becomes a four-value enum:
--
--     exploring → researching → developing → ready_to_recommend
--
-- and stops being the place where decision workflow is recorded. `deciding`
-- is not carried forward: whether a decision is underway is a fact about a
-- `decision_requests` row, not about how well understood an idea is.
--
-- ── Why a type swap rather than ALTER TYPE ─────────────────────────────────
--
-- This is a MANY-TO-ONE collapse: six legacy values fold into `developing`
-- alone. `ALTER TYPE ... RENAME VALUE` renames one label to one label and
-- cannot express that, and there is no `ALTER TYPE ... MERGE`. So the column
-- is retyped with an explicit USING map, which is the only form that is both
-- total (every old value has a destination) and auditable (the mapping is
-- visible in one place rather than spread across an UPDATE and a cast).
--
-- ── Verified against production before writing ─────────────────────────────
--
-- The `trade_stage` enum has ELEVEN members, not the five the TypeScript
-- suggested. Eight carry rows (228 total):
--
--     ready_for_decision  56     deciding             23
--     idea                42     deep_research        23
--     investigate         28     thesis_forming       23
--     aware               27     simulating            6
--
-- `discussing`, `working_on` and `modeling` are enum members with zero rows.
-- They are still mapped below — an unmapped value would make the USING clause
-- return NULL against a NOT NULL column and abort the whole migration, and
-- "no rows today" is not a guarantee about the moment this runs.
--
-- Also verified: `stage` is NOT NULL with NO default, so nothing needs a new
-- default; no view depends on it; one index (`idx_trade_queue_items_stage`)
-- does, and is rebuilt automatically by the type change;
-- `can_modify_trade_stage` contains no stage literals and is unaffected.
--
-- ── Restart safety ─────────────────────────────────────────────────────────
--
-- Every step is guarded on its own observable precondition rather than on a
-- migration-ledger row, so a half-applied run can be re-run. The whole thing
-- is one transaction regardless: a partially-retyped column is not a state
-- anything should ever observe.

BEGIN;

-- ── 1. Preserve the original value, losslessly ─────────────────────────────
--
-- Recorded BEFORE anything is rewritten. Three things depend on this:
--
--   * `deciding` rows. Only 10 of the 23 have a `decision_requests` row, so
--     for the other 13 this column is the ONLY surviving evidence that the
--     idea had been pushed toward a decision. Mapping them to
--     `ready_to_recommend` without recording where they came from would
--     destroy that, and no recommendation record can be honestly
--     reconstructed for them — inventing one would fabricate a submission
--     that never happened.
--   * Reversibility. The forward mapping is many-to-one and therefore has no
--     inverse. This column IS the inverse.
--   * Auditing the migration after the fact, against live rows rather than
--     against this file's claims.
ALTER TABLE public.trade_queue_items
  ADD COLUMN IF NOT EXISTS stage_migrated_from text;

COMMENT ON COLUMN public.trade_queue_items.stage_migrated_from IS
  'The pre-2026-09 stage value, captured by the four-stage migration. The '
  'stage collapse is many-to-one and has no inverse; this column is it. For '
  'rows that read ''deciding'' it is also the only record that the idea had '
  'been pushed into decision workflow, since most such rows have no '
  'decision_requests row. Never written by application code.';

UPDATE public.trade_queue_items
   SET stage_migrated_from = stage::text
 WHERE stage_migrated_from IS NULL;

-- ── 2. Assert the mapping is total ─────────────────────────────────────────
--
-- Runs BEFORE the type swap. If production holds a stage value this migration
-- does not know about, the USING clause below would evaluate to NULL against
-- a NOT NULL column and fail with a constraint error that names neither the
-- value nor the row. Fail here instead, with the offending label.
DO $guard$
DECLARE
  v_unmapped text;
BEGIN
  SELECT string_agg(DISTINCT t.stage::text, ', ')
    INTO v_unmapped
    FROM public.trade_queue_items t
   WHERE t.stage::text NOT IN (
     'aware', 'investigate', 'deep_research', 'thesis_forming',
     'ready_for_decision', 'idea', 'discussing', 'working_on', 'modeling',
     'simulating', 'deciding'
   );

  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION
      'Unmapped stage value(s) present in trade_queue_items: %. Add them to the USING map before running this migration.',
      v_unmapped;
  END IF;
END;
$guard$;

-- ── 3. The new type ────────────────────────────────────────────────────────
--
-- Declared in pipeline order. Postgres orders enum comparisons by declaration
-- order, so `stage < 'developing'` means what a reader expects — but nothing
-- in the app relies on that, and nothing new should: ordering lives in
-- `lib/ideas/stage-model`, in one array.
DO $mk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typname = 'idea_stage'
  ) THEN
    CREATE TYPE public.idea_stage AS ENUM (
      'exploring', 'researching', 'developing', 'ready_to_recommend'
    );
  END IF;
END;
$mk$;

-- ── 4. Retype the column ───────────────────────────────────────────────────
--
-- The mapping, and why each line reads as it does:
--
--   aware, idea            → exploring   On the radar; nobody has committed
--                                        real time yet.
--
--   investigate            → researching NOT exploring, which is where a
--                                        naive reading of the label would put
--                                        it. Its own description in the app
--                                        was "actively researching
--                                        fundamentals, catalysts, and
--                                        competitive position" — that is
--                                        evidence-gathering, which is
--                                        Researching. Mapping these 28 rows
--                                        to `exploring` would demote work
--                                        that is genuinely underway AND leave
--                                        `researching` with zero rows on day
--                                        one, so a new stage would ship
--                                        looking dead. Least-destructive
--                                        agrees: promoting one stage too far
--                                        is one ungated click to undo;
--                                        erasing visible progress is not.
--
--   deep_research          → developing  Despite the name. Its description
--                                        was "building the model,
--                                        stress-testing assumptions, and
--                                        sizing the opportunity" — synthesis,
--                                        not gathering.
--   thesis_forming         → developing  Literally forming the view.
--   modeling, simulating   → developing  Scenario and sizing work.
--   working_on, discussing → developing  Ambiguous legacy labels with zero
--                                        rows in production. Sent to
--                                        `developing` because that is where
--                                        the v1→v2 mapping already sent them
--                                        (`working_on` → `thesis_forming`),
--                                        so this preserves the existing
--                                        interpretation rather than inventing
--                                        a new one.
--
--   ready_for_decision     → ready_to_recommend   Direct rename.
--   deciding               → ready_to_recommend   The stage is dropped, not
--                                        the fact: `stage_migrated_from`
--                                        keeps it, and for the 10 rows that
--                                        have one, the `decision_requests`
--                                        row already carries the real
--                                        workflow state. 21 of these 23 rows
--                                        also carry a non-null `outcome`, so
--                                        the decision itself is recorded
--                                        independently of the stage.
ALTER TABLE public.trade_queue_items
  ALTER COLUMN stage TYPE public.idea_stage
  USING (
    CASE stage::text
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
    END
  )::public.idea_stage;

-- New ideas start at the beginning. The column had no default before, which
-- meant every INSERT had to name a stage and any path that forgot got a NOT
-- NULL violation rather than a sensible starting point.
ALTER TABLE public.trade_queue_items
  ALTER COLUMN stage SET DEFAULT 'exploring'::public.idea_stage;

-- ── 5. Repoint the functions that hardcode stage literals ──────────────────
--
-- Four function bodies (three names, one of which has two overloads) write
-- literal stage values into `trade_queue_items`. Verified in production:
--
--   seed_pilot_pipeline_demo_ideas   'aware', 'deep_research', 'investigate'
--                                     — and the only one using an explicit
--                                       ::trade_stage cast
--   ensure_pilot_scenario_for_user   'ready_for_decision', 'thesis_forming'
--   stage_pilot_scenario (x2)        'ready_for_decision'
--
-- All four are pilot/demo seeders called from best-effort provisioning paths,
-- so without this they would fail SILENTLY the moment the column stopped
-- accepting the old labels — a new pilot org would simply get no demo data
-- and nothing would report why.
--
-- `can_modify_trade_stage` is deliberately absent. It was inspected: it reads
-- created_by / assigned_to / portfolio_id and contains no stage literal at
-- all, so the type change cannot affect it.
--
-- ── Why rewrite rather than restate ────────────────────────────────────────
--
-- The header of each function (argument names and defaults, return type,
-- volatility, SECURITY DEFINER, search_path) is taken from
-- `pg_get_functiondef`, which emits a complete and correct CREATE OR REPLACE
-- statement. Only the stage literals inside it are substituted. Hand-
-- assembling those headers from catalog columns is where this would go wrong
-- — a dropped `SET search_path` on a SECURITY DEFINER function is a security
-- regression, not a cosmetic one.
--
-- The substitution is then CHECKED, in step 6, by re-reading every function
-- body and failing if any old label survives. A rewrite that quietly matched
-- nothing would otherwise look identical to a rewrite that worked.
DO $fix$
DECLARE
  r      record;
  v_def  text;
  v_new  text;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND (
         p.prosrc LIKE '%trade_stage%'
         OR p.prosrc ~ '''(aware|investigate|deep_research|thesis_forming|ready_for_decision|deciding|working_on|modeling|discussing)'''
       )
       -- Only functions that actually touch the idea pipeline. Without this
       -- the pattern above would also catch anything mentioning, say,
       -- 'discussing' in an unrelated status context.
       AND p.prosrc LIKE '%trade_queue_items%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;

    -- ── The trap, and why only seven labels are rewritten below ──────────
    --
    -- `trade_stage` and `trade_queue_status` SHARE FOUR LABELS: idea,
    -- discussing, simulating, deciding. These seeders write both columns,
    -- often in the same INSERT and adjacent in the same VALUES tuple:
    --
    --     (gen_random_uuid(), 'ready_for_decision', 'deciding', p_org)
    --                          ^ stage              ^ status
    --
    -- A blind rewrite of every quoted label turns that status into
    -- 'ready_to_recommend', which is not a valid trade_queue_status, and the
    -- seeder then fails at RUN time rather than at migrate time — in a
    -- best-effort provisioning path that swallows the error. An earlier draft
    -- of this migration did exactly that; the fixture caught it.
    --
    -- So: bare literals are rewritten ONLY for the seven labels unique to
    -- trade_stage. The four shared labels are rewritten only when an explicit
    -- ::trade_stage cast proves they are stages. Anything ambiguous that is
    -- left is caught by the guard below rather than guessed at.

    -- (a) Cast-qualified literals — the cast settles which column they feed.
    v_new := replace(v_new, '''ready_for_decision''::trade_stage', '''ready_to_recommend''::idea_stage');
    v_new := replace(v_new, '''thesis_forming''::trade_stage',     '''developing''::idea_stage');
    v_new := replace(v_new, '''deep_research''::trade_stage',      '''developing''::idea_stage');
    v_new := replace(v_new, '''investigate''::trade_stage',        '''researching''::idea_stage');
    v_new := replace(v_new, '''working_on''::trade_stage',         '''developing''::idea_stage');
    v_new := replace(v_new, '''modeling''::trade_stage',           '''developing''::idea_stage');
    v_new := replace(v_new, '''aware''::trade_stage',              '''exploring''::idea_stage');
    -- The four shared labels, safe here because the cast disambiguates them.
    v_new := replace(v_new, '''deciding''::trade_stage',           '''ready_to_recommend''::idea_stage');
    v_new := replace(v_new, '''discussing''::trade_stage',         '''developing''::idea_stage');
    v_new := replace(v_new, '''simulating''::trade_stage',         '''developing''::idea_stage');
    v_new := replace(v_new, '''idea''::trade_stage',               '''exploring''::idea_stage');

    -- (b) Bare literals, unique-to-trade_stage labels only. A bare 'aware'
    --     cannot be anything but a stage, because no other enum these
    --     functions touch has that label.
    v_new := replace(v_new, '''ready_for_decision''', '''ready_to_recommend''');
    v_new := replace(v_new, '''thesis_forming''',     '''developing''');
    v_new := replace(v_new, '''deep_research''',      '''developing''');
    v_new := replace(v_new, '''investigate''',        '''researching''');
    v_new := replace(v_new, '''working_on''',         '''developing''');
    v_new := replace(v_new, '''modeling''',           '''developing''');
    v_new := replace(v_new, '''aware''',              '''exploring''');

    -- (c) Any surviving reference to the type itself.
    v_new := replace(v_new, '::trade_stage', '::idea_stage');
    v_new := replace(v_new, 'trade_stage[]', 'idea_stage[]');

    -- (d) Refuse to guess. If a shared label still sits in a position that
    --     assigns to `stage`, this migration cannot tell whether it means the
    --     stage or the status, and silently picking one is how the bug above
    --     happened. Verified against production before writing: none of the
    --     four affected functions contains a bare shared label in a stage
    --     position, so this should never fire. If it does, the function needs
    --     an explicit rewrite rather than a pattern.
    IF v_new ~ 'stage[^,)]*=>?\s*''(idea|discussing|simulating|deciding)''' THEN
      RAISE EXCEPTION
        'Ambiguous shared enum label in a stage position in % — rewrite this function explicitly.', r.sig;
    END IF;

    IF v_new IS DISTINCT FROM v_def THEN
      EXECUTE v_new;
      RAISE NOTICE 'Rewrote stage literals in %', r.sig;
    END IF;
  END LOOP;
END;
$fix$;

-- ── 6. Assert the result ───────────────────────────────────────────────────
--
-- A migration that reports success having changed nothing is the failure mode
-- this codebase keeps finding. Check the subject, not a proxy for it.
DO $verify$
DECLARE
  v_type    text;
  v_rows    bigint;
  v_missing bigint;
  v_labels  text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.trade_queue_items'::regclass
     AND a.attname = 'stage';

  IF v_type IS DISTINCT FROM 'idea_stage' THEN
    RAISE EXCEPTION 'stage column is still %, expected idea_stage', COALESCE(v_type, '<absent>');
  END IF;

  -- Every row must carry its origin. `IS DISTINCT FROM` rather than `<>`:
  -- a NULL count would make `<>` evaluate to NULL, which is not true, which
  -- means the check would pass having asserted nothing.
  SELECT count(*) INTO v_rows FROM public.trade_queue_items;
  SELECT count(*) INTO v_missing
    FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;

  IF v_missing IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'stage_migrated_from is NULL on % of % rows', v_missing, v_rows;
  END IF;

  -- And no stage outside the four may exist, whatever the type says.
  SELECT string_agg(DISTINCT stage::text, ', ') INTO v_labels
    FROM public.trade_queue_items
   WHERE stage::text NOT IN ('exploring', 'researching', 'developing', 'ready_to_recommend');

  IF v_labels IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected stage value(s) after migration: %', v_labels;
  END IF;

  -- And no function body may still contain a retired stage label. This is
  -- what makes step 5 non-vacuous: a substitution loop that matched nothing
  -- would be indistinguishable from one that worked, and the failure would
  -- surface later as a pilot org with no demo data and no error.
  --
  -- Only the seven labels unique to `trade_stage` are checked. The four
  -- shared with `trade_queue_status` — idea, discussing, simulating,
  -- deciding — remain legitimate in these bodies as STATUS values, and
  -- flagging them here would fail the migration for writing correct SQL.
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_labels
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND p.prosrc LIKE '%trade_queue_items%'
     AND p.prosrc ~ '''(aware|investigate|deep_research|thesis_forming|ready_for_decision|working_on|modeling)''';

  IF v_labels IS NOT NULL THEN
    RAISE EXCEPTION
      'Retired stage literal still present in function body/bodies: %', v_labels;
  END IF;

  RAISE NOTICE 'Four-stage migration verified across % rows.', v_rows;
END;
$verify$;

COMMIT;

-- ── Deliberately NOT done here ─────────────────────────────────────────────
--
-- `DROP TYPE public.trade_stage` is not run. `stage_migrated_from` holds its
-- labels as text and nothing else references the type, so dropping it is safe
-- in principle — but it is also irreversible, and keeping a dead type costs
-- nothing. It belongs in a follow-up once the four-stage model has run in
-- production long enough that nobody wants the old column back.
--
-- `trade_queue_items.status` is untouched. It is a second, older lifecycle
-- column still read in many places and still written (derived) by
-- `stageToLegacyStatus`. Collapsing it is a separate change with a separate
-- blast radius.
--
-- `decision_requests` is untouched. It already models the recommendation and
-- the decision correctly — `trade_queue_item_id`, `requested_by`,
-- `requested_action`, sizing, `context_note`, `submission_snapshot`, then
-- `reviewed_by` / `reviewed_at` / `decision_note` / `accepted_trade_id`. The
-- Decision Inbox reads it and is already independent of `stage`. No new
-- domain object was created, and none was needed.
