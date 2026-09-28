-- Assertions on PHASE C (contract), run against the MIXED population left by
-- `08_phase_b_writes.sql`: 16 legacy rows from the old build plus 3 canonical
-- rows from the new one, which is the state production will actually be in.
--
-- Every check uses IS DISTINCT FROM: `v <> 0` is NULL when v is NULL, NULL is
-- not true, and an IF on it does not fire — which is how a check reports PASS
-- having asserted nothing. That defect has been found in this codebase's
-- harnesses before.

DO $t$
DECLARE
  v_n    bigint;
  v_txt  text;
  v_type text;
  v_def  text;
BEGIN
  -- ── 1. Both columns are on the four-value type ───────────────────────────
  FOR v_type, v_txt IN
    SELECT c.relname, format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND a.attname = 'stage'
       AND c.relname IN ('trade_queue_items', 'trade_idea_portfolios')
  LOOP
    IF v_txt IS DISTINCT FROM 'idea_stage' THEN
      RAISE EXCEPTION 'FAIL 1a: %.stage is %, expected idea_stage', v_type, v_txt;
    END IF;
  END LOOP;

  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO v_txt
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'idea_stage';
  IF v_txt IS DISTINCT FROM 'exploring,researching,developing,ready_to_recommend' THEN
    RAISE EXCEPTION 'FAIL 1b: idea_stage labels/order are [%]', COALESCE(v_txt, '<null>');
  END IF;
  RAISE NOTICE 'PASS 1: BOTH columns retyped, four labels in pipeline order';

  -- ── 2. No row lost, none duplicated ──────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.trade_queue_items;
  IF v_n IS DISTINCT FROM 19 THEN
    RAISE EXCEPTION 'FAIL 2: expected 19 rows (16 legacy + 3 canonical), found %', v_n;
  END IF;
  RAISE NOTICE 'PASS 2: all 19 rows survived';

  -- ── 3. Every row carries its origin, canonical ones included ─────────────
  SELECT count(*) INTO v_n FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 3a: % rows have no stage_migrated_from', v_n;
  END IF;

  -- Rows the new app wrote record themselves as already-canonical, which is
  -- how you tell later which rows predate the pipeline change.
  SELECT count(*) INTO v_n FROM public.trade_queue_items
   WHERE stage_migrated_from IN ('exploring', 'developing', 'ready_to_recommend');
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FAIL 3b: expected 3 rows recorded as already-canonical, found %', v_n;
  END IF;
  RAISE NOTICE 'PASS 3: origin recorded on every row, legacy and canonical alike';

  -- ── 4. The mapping, value by value ───────────────────────────────────────
  SELECT string_agg(DISTINCT stage_migrated_from || '->' || stage::text, ', '
                    ORDER BY stage_migrated_from || '->' || stage::text)
    INTO v_txt FROM public.trade_queue_items;
  IF v_txt IS DISTINCT FROM
     'aware->exploring, deciding->ready_to_recommend, deep_research->developing, '
     'developing->developing, exploring->exploring, idea->exploring, '
     'investigate->researching, ready_for_decision->ready_to_recommend, '
     'ready_to_recommend->ready_to_recommend, simulating->developing, '
     'thesis_forming->developing'
  THEN
    RAISE EXCEPTION 'FAIL 4: mapping is [%]', v_txt;
  END IF;
  RAISE NOTICE 'PASS 4: every value mapped as specified; canonical rows passed through unchanged';

  -- ── 5. investigate went to researching, not exploring ────────────────────
  -- The one place this departs from the mapping as originally specified. A
  -- silent revert to `exploring` would leave `researching` populated only by
  -- the Phase B rows — a new stage all but shipping dead.
  SELECT count(*) INTO v_n FROM public.trade_queue_items WHERE stage_migrated_from = 'investigate';
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL 5a: expected 2 rows from investigate, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.trade_queue_items WHERE stage_migrated_from = 'investigate' AND stage <> 'researching';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 5b: % investigate rows did not land on researching', v_n;
  END IF;
  RAISE NOTICE 'PASS 5: investigate landed on researching';

  -- ── 6. `deciding` gone as a stage, preserved as evidence ─────────────────
  SELECT count(*) INTO v_n FROM public.trade_queue_items WHERE stage::text = 'deciding';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 6a: % rows still at stage deciding', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.trade_queue_items WHERE stage_migrated_from = 'deciding';
  IF v_n IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'FAIL 6b: expected 5 rows recorded as formerly deciding, found %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.trade_queue_items
   WHERE stage_migrated_from = 'deciding' AND stage <> 'ready_to_recommend';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 6c: % former deciding rows are not at ready_to_recommend', v_n;
  END IF;
  RAISE NOTICE 'PASS 6: deciding retired as a stage, preserved as evidence';

  -- ── 7. Decision state survived independently of the stage ────────────────
  SELECT count(*) INTO v_n
    FROM public.decision_requests d
    JOIN public.trade_queue_items t ON t.id = d.trade_queue_item_id
   WHERE t.stage_migrated_from = 'deciding';
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL 7a: expected 2 decision_requests on former deciding rows, found %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.trade_queue_items
   WHERE stage_migrated_from = 'deciding' AND outcome IS NOT NULL;
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FAIL 7b: expected 3 former deciding rows with an outcome, found %', v_n;
  END IF;
  RAISE NOTICE 'PASS 7: decision requests and outcomes preserved';

  -- ── 8. THE SECOND COLUMN — the one the single-shot migration forgot ──────
  SELECT count(*) INTO v_n FROM public.trade_idea_portfolios;
  IF v_n IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'FAIL 8a: expected 5 portfolio tracks, found %', v_n;
  END IF;

  SELECT string_agg(DISTINCT stage_migrated_from || '->' || stage::text, ', '
                    ORDER BY stage_migrated_from || '->' || stage::text)
    INTO v_txt FROM public.trade_idea_portfolios;
  IF v_txt IS DISTINCT FROM
     'deciding->ready_to_recommend, idea->exploring, modeling->developing, '
     'researching->researching, working_on->developing'
  THEN
    RAISE EXCEPTION 'FAIL 8b: portfolio track mapping is [%]', v_txt;
  END IF;
  RAISE NOTICE 'PASS 8: trade_idea_portfolios.stage migrated with its sibling';

  -- ── 9. Indexes survived both type changes ────────────────────────────────
  SELECT count(*) INTO v_n
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
   WHERE i.relname IN ('idx_trade_queue_items_stage', 'idx_tip_stage');
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL 9: expected both stage indexes rebuilt, found %', v_n;
  END IF;
  RAISE NOTICE 'PASS 9: both stage indexes rebuilt';

  -- ── 10. Default, and retired labels rejected ─────────────────────────────
  INSERT INTO public.trade_queue_items (asset_id, status) VALUES (gen_random_uuid(), 'idea');
  SELECT count(*) INTO v_n FROM public.trade_queue_items
   WHERE stage = 'exploring' AND stage_migrated_from IS NULL;
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL 10a: stage did not default to exploring on insert';
  END IF;
  DELETE FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;

  BEGIN
    INSERT INTO public.trade_queue_items (asset_id, stage, status)
    VALUES (gen_random_uuid(), 'deciding', 'idea');
    RAISE EXCEPTION 'FAIL 10b: inserting stage=deciding was accepted after contract';
  EXCEPTION WHEN invalid_text_representation THEN
    NULL; -- expected
  END;
  RAISE NOTICE 'PASS 10: defaults to exploring; retired labels now rejected';

  -- ── 11. Seeder rewritten, header intact ──────────────────────────────────
  v_def := pg_get_functiondef('public.seed_demo_ideas(uuid)'::regprocedure);

  -- Only the seven labels unique to trade_stage. The fixture seeder writes
  -- status='deciding' in the same VALUES tuple as the stage it sets, and
  -- 'deciding' is a perfectly valid trade_queue_status — an earlier version of
  -- this assertion listed it and failed the migration for leaving correct SQL
  -- alone. The overlap is the hazard in the check as much as in the rewrite.
  IF v_def ~ '''(aware|investigate|deep_research|thesis_forming|ready_for_decision|working_on|modeling)''' THEN
    RAISE EXCEPTION 'FAIL 11a: seeder still contains a retired stage literal';
  END IF;
  IF v_def NOT LIKE '%''deciding''%' THEN
    RAISE EXCEPTION 'FAIL 11b: the status literal ''deciding'' was rewritten; the rewrite hit the wrong column';
  END IF;
  IF v_def NOT LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'FAIL 11c: seeder lost SECURITY DEFINER';
  END IF;
  IF v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION 'FAIL 11d: seeder lost its pinned search_path';
  END IF;
  RAISE NOTICE 'PASS 11: seeder rewritten, SECURITY DEFINER and search_path preserved';

  -- ── 12. And it still RUNS ────────────────────────────────────────────────
  -- 11 proves the text changed. Only this proves the function still works —
  -- and this is the provisioning path, which swallows errors, so a break here
  -- would show up as a pilot org with no demo data and no explanation.
  PERFORM public.seed_demo_ideas(gen_random_uuid());

  SELECT string_agg(DISTINCT stage::text, ',' ORDER BY stage::text) INTO v_txt
    FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;
  IF v_txt IS DISTINCT FROM 'developing,exploring,ready_to_recommend,researching' THEN
    RAISE EXCEPTION 'FAIL 12: seeder produced stages [%]', COALESCE(v_txt, '<none>');
  END IF;
  RAISE NOTICE 'PASS 12: rewritten seeder executes and writes canonical stages';

  -- ── 13. SHARED-LABEL REGRESSION, at row level ────────────────────────────
  -- trade_stage and trade_queue_status share four labels. The seeder's last
  -- tuple is the collision case:
  --     (gen_random_uuid(), 'ready_for_decision', 'deciding', p_org)
  --                          ^ stage              ^ status
  -- A broad quoted-string rewrite turns that status into 'ready_to_recommend',
  -- which trade_queue_status does not accept. 11b catches that in the function
  -- TEXT; this catches it in the WRITTEN ROW.
  SELECT count(*) INTO v_n FROM public.trade_queue_items
   WHERE stage_migrated_from IS NULL AND stage = 'ready_to_recommend' AND status = 'deciding';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'FAIL 13a: expected 1 seeded row with stage=ready_to_recommend AND status=deciding, found %', v_n;
  END IF;

  SELECT string_agg(DISTINCT status::text, ',' ORDER BY status::text) INTO v_txt
    FROM public.trade_queue_items WHERE stage_migrated_from IS NULL;
  IF v_txt IS DISTINCT FROM 'deciding,idea,simulating' THEN
    RAISE EXCEPTION 'FAIL 13b: seeded statuses are [%], expected [deciding,idea,simulating]', v_txt;
  END IF;
  RAISE NOTICE 'PASS 13: shared labels survive in the status column';

  -- ── 14. Migrated rows keep their status untouched ────────────────────────
  -- Asserted as a histogram rather than a hand-counted total — an expected
  -- number worked out by eye is one I can get wrong, and a wrong expectation
  -- in a regression test is indistinguishable from the regression it exists to
  -- catch. (It was wrong the first time: 12, against 9 actual.)
  SELECT string_agg(s, ',' ORDER BY s) INTO v_txt FROM (
    SELECT status::text || '=' || count(*)::text AS s
      FROM public.trade_queue_items WHERE stage_migrated_from IS NOT NULL
     GROUP BY status::text
  ) h;
  IF v_txt IS DISTINCT FROM
     'approved=1,cancelled=1,deciding=3,deleted=2,discussing=1,executed=2,idea=6,rejected=1,simulating=2'
  THEN
    RAISE EXCEPTION 'FAIL 14: migrated status histogram is [%]', COALESCE(v_txt, '<none>');
  END IF;
  RAISE NOTICE 'PASS 14: migrated rows keep their trade_queue_status untouched';

  RAISE NOTICE '--- contract: 14/14 assertions passed ---';
END;
$t$;
