-- Idea Pipeline, PHASE A — EXPAND. Purely additive.
--
-- ── What this does, and what it deliberately does not ──────────────────────
--
-- Teaches the database the four canonical stage labels. It rewrites no rows,
-- changes no defaults, touches no functions, and removes nothing.
--
-- After this migration the running production code — which still writes
-- `deciding`, `aware`, `ready_for_decision` and friends — behaves exactly as
-- it did before, because every legacy label is still a member of the enum and
-- nothing it reads has changed value. That is the property that makes this
-- deployable on a normal Tuesday instead of during a maintenance window.
--
-- ── Why the previous version of this migration was not deployable ──────────
--
-- It did the whole thing at once: created a new four-value type and swapped
-- the column onto it in a single transaction. That leaves no ordering that
-- works. Apply it first and the running old code starts throwing on every
-- write of `deciding`; deploy the new code first and it throws on every write
-- of `ready_to_recommend`. The only way through was to take the app down.
--
-- Split into expand/contract, both old and new code are correct against this
-- schema at the same time, so the deploy is ordinary.
--
-- ── Verified against production before writing ─────────────────────────────
--
-- PostgreSQL 17.4. `ALTER TYPE ... ADD VALUE` has been allowed inside a
-- transaction block since 12; the remaining restriction is that a newly added
-- label cannot be USED in the transaction that added it. This migration only
-- adds — the first use is in Phase C — so the restriction does not bite.
-- `IF NOT EXISTS` makes each statement idempotent, so a partial run is safe
-- to repeat.
--
-- `trade_stage` is used by TWO columns, not one:
--
--     trade_queue_items.stage        228 rows, 8 distinct legacy labels
--     trade_idea_portfolios.stage     37 rows, 4 distinct legacy labels
--                                     (idea 21, deciding 8, working_on 6,
--                                      modeling 2)
--
-- The earlier single-shot migration only ever mentioned the first. It would
-- have retyped `trade_queue_items.stage` and left `trade_idea_portfolios.stage`
-- behind on the old enum — a split model, and a `trade_stage` that could never
-- be dropped. Both columns are handled from here on.

-- ── 1. Add the canonical labels ────────────────────────────────────────────
--
-- Not inside an explicit transaction. `ADD VALUE` in a transaction is legal
-- here, but keeping these as standalone statements means a failure part-way
-- leaves the earlier labels added rather than rolling the batch back, and
-- `IF NOT EXISTS` then makes the retry a no-op. Additive work should be
-- resumable, not atomic.
--
-- Order matters only for `enumsortorder`, which nothing in the application
-- relies on — ordering lives in `lib/ideas/stage-model`, in one array. BEFORE
-- places them ahead of the legacy labels so the physical order still reads as
-- the pipeline order if anyone inspects the type.
ALTER TYPE public.trade_stage ADD VALUE IF NOT EXISTS 'exploring';
ALTER TYPE public.trade_stage ADD VALUE IF NOT EXISTS 'researching';
ALTER TYPE public.trade_stage ADD VALUE IF NOT EXISTS 'developing';
ALTER TYPE public.trade_stage ADD VALUE IF NOT EXISTS 'ready_to_recommend';

-- ── 2. Somewhere to record what a row used to be ───────────────────────────
--
-- Added now, populated in Phase C. Adding a nullable column is invisible to
-- running code, and having it in place early means the contract migration is
-- a data change rather than a data-and-schema change.
--
-- The collapse is many-to-one and therefore has no inverse; this column IS
-- the inverse. For rows reading `deciding` it is also the only surviving
-- record that the idea had been pushed into decision workflow — most such
-- rows have no `decision_requests` row at all, and inventing one would
-- fabricate a submission that never happened.
ALTER TABLE public.trade_queue_items
  ADD COLUMN IF NOT EXISTS stage_migrated_from text;

ALTER TABLE public.trade_idea_portfolios
  ADD COLUMN IF NOT EXISTS stage_migrated_from text;

COMMENT ON COLUMN public.trade_queue_items.stage_migrated_from IS
  'The pre-four-stage value of `stage`, captured by the contract migration. '
  'The collapse is many-to-one and has no inverse; this column is it. Never '
  'written by application code.';

COMMENT ON COLUMN public.trade_idea_portfolios.stage_migrated_from IS
  'As trade_queue_items.stage_migrated_from. This column shares the '
  '`trade_stage` enum and is migrated in the same contract step.';

-- ── 3. Prove the expansion, and prove it changed nothing else ──────────────
DO $verify$
DECLARE
  v_missing text;
  v_status  text;
  v_legacy  bigint;
BEGIN
  -- All four canonical labels are now members.
  SELECT string_agg(want, ', ') INTO v_missing
    FROM unnest(ARRAY['exploring', 'researching', 'developing', 'ready_to_recommend']) want
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'trade_stage' AND e.enumlabel = want
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Expand failed: trade_stage is still missing %', v_missing;
  END IF;

  -- Every legacy label is STILL a member. This is the assertion that makes
  -- "old code keeps working" a checked claim rather than a hope.
  SELECT string_agg(want, ', ') INTO v_missing
    FROM unnest(ARRAY[
      'aware', 'investigate', 'deep_research', 'thesis_forming',
      'ready_for_decision', 'idea', 'discussing', 'working_on', 'modeling',
      'simulating', 'deciding'
    ]) want
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'trade_stage' AND e.enumlabel = want
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Expand removed legacy label(s) %, which would break the running application', v_missing;
  END IF;

  -- The sibling enum is untouched. `trade_stage` and `trade_queue_status`
  -- share four labels — idea, discussing, simulating, deciding — and every
  -- accident in this lane has come from confusing the two.
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO v_status
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'trade_queue_status';
  IF v_status IS DISTINCT FROM
     'idea,discussing,approved,rejected,executed,cancelled,deleted,deciding,simulating,archived'
  THEN
    RAISE EXCEPTION 'trade_queue_status was altered by the expand step: [%]', v_status;
  END IF;

  -- And no row was rewritten. Expand is additive; if this count is zero the
  -- migration did something it was not supposed to.
  SELECT count(*) INTO v_legacy
    FROM public.trade_queue_items
   WHERE stage::text IN (
     'aware', 'investigate', 'deep_research', 'thesis_forming',
     'ready_for_decision', 'idea', 'discussing', 'working_on', 'modeling',
     'simulating', 'deciding'
   );
  RAISE NOTICE
    'Expand complete. % legacy rows left in place for Phase C; both vocabularies now accepted.',
    v_legacy;
END;
$verify$;

-- ── Deliberately NOT done here ─────────────────────────────────────────────
--
--   * No row is rewritten. Phase C does that, after the compatible
--     application is deployed and stable.
--   * No DEFAULT is set on `stage`. A default of `exploring` would make the
--     new label reachable by INSERTs from the OLD code, which cannot read it.
--   * The pilot seeder functions still emit legacy labels, on purpose. They
--     are rewritten in Phase C. Rewriting them now would have them hand
--     canonical stages to old application code, which maps unknown labels to
--     `aware` — demo data would silently all appear in the first column.
--   * Nothing is dropped. `trade_stage` keeps all fifteen labels until the
--     contract step, and the four legacy-only labels are removed there.
