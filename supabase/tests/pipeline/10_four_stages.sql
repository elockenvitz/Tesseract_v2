-- Assertions on the four-stage migration, run against the fixture AFTER the
-- migration has been applied to it.
--
-- Every check uses IS DISTINCT FROM rather than <>. `v <> 0` evaluates to NULL
-- when v is NULL, NULL is not true, and an IF on it therefore does not fire —
-- which is how a check reports PASS having asserted nothing. That exact defect
-- has been found in this codebase's harnesses before.

DO $t$
DECLARE
  v_n        bigint;
  v_txt      text;
  v_type     text;
  v_def      text;
BEGIN
  -- ── 1. The column is the new type, and the type has exactly four labels ──
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.trade_queue_items'::regclass AND a.attname = 'stage';
  IF v_type IS DISTINCT FROM 'idea_stage' THEN
    RAISE EXCEPTION 'FAIL 1a: stage column type is %, expected idea_stage', COALESCE(v_type, '<null>');
  END IF;

  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO v_txt
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typname = 'idea_stage';
  IF v_txt IS DISTINCT FROM 'exploring,researching,developing,ready_to_recommend' THEN
    RAISE EXCEPTION 'FAIL 1b: idea_stage labels/order are [%]', COALESCE(v_txt, '<null>');
  END IF;
  RAISE NOTICE 'PASS 1: column retyped, four labels in pipeline order';

  -- ── 2. No row was lost ───────────────────────────────────────────────────
  -- 16 fixture rows. The migration must not drop, filter or duplicate any.
  SELECT count(*) INTO v_n FROM public.trade_queue_items;
  IF v_n IS DISTINCT FROM 16 THEN
    RAISE EXCEPTION 'FAIL 2: expected 16 rows, found %', v_n;
  END IF;
  RAISE NOTICE 'PASS 2: all 16 rows survived';

  -- ── 3. Every row carries its origin ──────────────────────────────────────
  SELECT count(*) INTO v_n
    FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 3: % rows have no stage_migrated_from', v_n;
  END IF;
  RAISE NOTICE 'PASS 3: stage_migrated_from populated on every row';

  -- ── 4. The mapping, value by value ───────────────────────────────────────
  SELECT string_agg(DISTINCT stage_migrated_from || '->' || stage::text, ', '
                    ORDER BY stage_migrated_from || '->' || stage::text)
    INTO v_txt FROM public.trade_queue_items;
  IF v_txt IS DISTINCT FROM
     'aware->exploring, deciding->ready_to_recommend, deep_research->developing, '
     'idea->exploring, investigate->researching, ready_for_decision->ready_to_recommend, '
     'simulating->developing, thesis_forming->developing'
  THEN
    RAISE EXCEPTION 'FAIL 4: mapping is [%]', v_txt;
  END IF;
  RAISE NOTICE 'PASS 4: every legacy value mapped as specified';

  -- ── 5. investigate went to researching, not exploring ────────────────────
  -- Called out separately because it is the one place this migration departs
  -- from the mapping as originally specified, and because a silent revert to
  -- `exploring` would leave `researching` empty — a new stage shipping dead.
  SELECT count(*) INTO v_n
    FROM public.trade_queue_items WHERE stage = 'researching';
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL 5: expected 2 rows at researching, found %', v_n;
  END IF;
  RAISE NOTICE 'PASS 5: researching is populated (investigate landed there)';

  -- ── 6. `deciding` is gone as a stage but not as a fact ───────────────────
  SELECT count(*) INTO v_n
    FROM public.trade_queue_items WHERE stage::text = 'deciding';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 6a: % rows still at stage deciding', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.trade_queue_items WHERE stage_migrated_from = 'deciding';
  IF v_n IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'FAIL 6b: expected 5 rows recorded as formerly deciding, found %', v_n;
  END IF;

  -- All of them are now at the end of the pipeline.
  SELECT count(*) INTO v_n
    FROM public.trade_queue_items
   WHERE stage_migrated_from = 'deciding' AND stage <> 'ready_to_recommend';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 6c: % former deciding rows are not at ready_to_recommend', v_n;
  END IF;
  RAISE NOTICE 'PASS 6: deciding retired as a stage, preserved as evidence';

  -- ── 7. Decision state survived independently of the stage ────────────────
  -- The 2 deciding rows that HAD a decision_requests row still have it, and
  -- the outcomes recorded on the others are untouched. This is the check that
  -- the collapse did not quietly destroy decision workflow state.
  SELECT count(*) INTO v_n
    FROM public.decision_requests d
    JOIN public.trade_queue_items t ON t.id = d.trade_queue_item_id
   WHERE t.stage_migrated_from = 'deciding';
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL 7a: expected 2 decision_requests on former deciding rows, found %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.trade_queue_items
   WHERE stage_migrated_from = 'deciding' AND outcome IS NOT NULL;
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FAIL 7b: expected 3 former deciding rows with an outcome, found %', v_n;
  END IF;
  RAISE NOTICE 'PASS 7: decision requests and outcomes preserved';

  -- ── 8. The index survived the type change ────────────────────────────────
  SELECT count(*) INTO v_n
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
   WHERE x.indrelid = 'public.trade_queue_items'::regclass
     AND i.relname = 'idx_trade_queue_items_stage';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL 8: stage index count is %, expected 1', v_n;
  END IF;
  RAISE NOTICE 'PASS 8: idx_trade_queue_items_stage rebuilt';

  -- ── 9. A new row gets a sensible default ─────────────────────────────────
  INSERT INTO public.trade_queue_items (asset_id, status) VALUES (gen_random_uuid(), 'idea');
  SELECT stage::text INTO v_txt
    FROM public.trade_queue_items ORDER BY created_at DESC NULLS LAST, id LIMIT 1;
  SELECT count(*) INTO v_n FROM public.trade_queue_items WHERE stage = 'exploring';
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'FAIL 9: expected 4 exploring rows after default insert, found %', v_n;
  END IF;
  DELETE FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;
  RAISE NOTICE 'PASS 9: stage defaults to exploring on insert';

  -- ── 10. Retired labels are rejected outright ─────────────────────────────
  BEGIN
    INSERT INTO public.trade_queue_items (asset_id, stage, status)
    VALUES (gen_random_uuid(), 'deciding', 'idea');
    RAISE EXCEPTION 'FAIL 10: inserting stage=deciding was accepted';
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE NOTICE 'PASS 10: retired stage labels rejected by the type';
  END;

  -- ── 11. The seeder was rewritten, header intact ──────────────────────────
  v_def := pg_get_functiondef('public.seed_demo_ideas(uuid)'::regprocedure);

  -- Only the seven labels unique to `trade_stage`. The fixture seeder writes
  -- status='deciding' in the same VALUES tuple as the stage it sets, and
  -- 'deciding' is a perfectly valid `trade_queue_status` — an earlier version
  -- of this assertion listed it and failed the migration for leaving correct
  -- SQL alone. The overlap between the two enums is the whole hazard here, in
  -- the check as much as in the rewrite.
  IF v_def ~ '''(aware|investigate|deep_research|thesis_forming|ready_for_decision|working_on|modeling)''' THEN
    RAISE EXCEPTION 'FAIL 11a: seeder still contains a retired stage literal';
  END IF;

  -- The status literal must have been left intact — this is the regression
  -- test for the bug the fixture caught: a rewrite that corrupts
  -- status='deciding' into an invalid enum value.
  IF v_def NOT LIKE '%''deciding''%' THEN
    RAISE EXCEPTION 'FAIL 11d: the status literal ''deciding'' was rewritten; the rewrite hit the wrong column';
  END IF;
  IF v_def NOT LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'FAIL 11b: seeder lost SECURITY DEFINER';
  END IF;
  IF v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION 'FAIL 11c: seeder lost its pinned search_path';
  END IF;
  RAISE NOTICE 'PASS 11: seeder rewritten, SECURITY DEFINER and search_path preserved';

  -- ── 12. And it still RUNS, writing the new labels ────────────────────────
  -- 11 proves the text changed. Only this proves the function still works —
  -- a rewrite that produced syntactically valid but semantically broken SQL
  -- would pass 11 and fail here.
  PERFORM public.seed_demo_ideas(gen_random_uuid());

  SELECT string_agg(DISTINCT stage::text, ',' ORDER BY stage::text) INTO v_txt
    FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;
  IF v_txt IS DISTINCT FROM 'developing,exploring,ready_to_recommend,researching' THEN
    RAISE EXCEPTION 'FAIL 12: seeder produced stages [%]', COALESCE(v_txt, '<none>');
  END IF;
  RAISE NOTICE 'PASS 12: rewritten seeder executes and writes canonical stages';

  RAISE NOTICE '--- 12/12 assertions passed ---';
END;
$t$;
