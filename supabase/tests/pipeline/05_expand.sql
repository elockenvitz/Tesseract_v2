-- Assertions on PHASE A (expand), run against the fixture AFTER the expand
-- migration and BEFORE the contract migration.
--
-- The whole point of this phase is a schema that BOTH application versions are
-- correct against at the same time. So the assertions come in pairs: the new
-- label must be accepted, and the old label must still be accepted. A test
-- that only checked the first would pass on a migration that had broken
-- production.
--
-- Every check uses IS DISTINCT FROM: `v <> 0` is NULL when v is NULL, NULL is
-- not true, and an IF on it does not fire — which is how a check reports PASS
-- having asserted nothing.

DO $t$
DECLARE
  v_n      bigint;
  v_txt    text;
  v_id     uuid;
BEGIN
  -- ── 1. The type now carries BOTH vocabularies ────────────────────────────
  SELECT count(*) INTO v_n
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'trade_stage';
  IF v_n IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'FAIL 1a: trade_stage has % labels, expected 15 (11 legacy + 4 canonical)', v_n;
  END IF;

  SELECT string_agg(want, ',' ORDER BY want) INTO v_txt
    FROM unnest(ARRAY['exploring', 'researching', 'developing', 'ready_to_recommend']) want
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'trade_stage' AND e.enumlabel = want
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1b: canonical labels missing: %', v_txt;
  END IF;
  RAISE NOTICE 'PASS 1: trade_stage carries all 15 labels';

  -- ── 2. OLD CODE still works — legacy writes are accepted ─────────────────
  -- This is the assertion that makes the rollout safe. If it ever fails, the
  -- expand step has become a breaking change.
  INSERT INTO public.trade_queue_items (asset_id, stage, status)
  VALUES (gen_random_uuid(), 'deciding', 'deciding') RETURNING id INTO v_id;
  DELETE FROM public.trade_queue_items WHERE id = v_id;

  INSERT INTO public.trade_queue_items (asset_id, stage, status)
  VALUES (gen_random_uuid(), 'aware', 'idea') RETURNING id INTO v_id;
  DELETE FROM public.trade_queue_items WHERE id = v_id;
  RAISE NOTICE 'PASS 2: legacy stage writes still accepted (old app unaffected)';

  -- ── 3. NEW CODE works — canonical writes are accepted ────────────────────
  INSERT INTO public.trade_queue_items (asset_id, stage, status)
  VALUES (gen_random_uuid(), 'ready_to_recommend', 'deciding') RETURNING id INTO v_id;
  DELETE FROM public.trade_queue_items WHERE id = v_id;

  INSERT INTO public.trade_queue_items (asset_id, stage, status)
  VALUES (gen_random_uuid(), 'exploring', 'idea') RETURNING id INTO v_id;
  DELETE FROM public.trade_queue_items WHERE id = v_id;
  RAISE NOTICE 'PASS 3: canonical stage writes accepted (new app works)';

  -- ── 4. Both on the OTHER column that shares this enum ────────────────────
  -- trade_idea_portfolios.stage is the column the original single-shot
  -- migration forgot. It must expand with its sibling.
  INSERT INTO public.trade_idea_portfolios (trade_queue_item_id, portfolio_id, stage)
  SELECT id, gen_random_uuid(), 'developing' FROM public.trade_queue_items ORDER BY id LIMIT 1
  RETURNING id INTO v_id;
  DELETE FROM public.trade_idea_portfolios WHERE id = v_id;

  INSERT INTO public.trade_idea_portfolios (trade_queue_item_id, portfolio_id, stage)
  SELECT id, gen_random_uuid(), 'working_on' FROM public.trade_queue_items ORDER BY id LIMIT 1
  RETURNING id INTO v_id;
  DELETE FROM public.trade_idea_portfolios WHERE id = v_id;
  RAISE NOTICE 'PASS 4: trade_idea_portfolios accepts both vocabularies too';

  -- ── 5. NOTHING was rewritten ─────────────────────────────────────────────
  -- Expand is additive. The legacy rows must still be legacy, or old code
  -- reading them would see values it cannot map.
  SELECT count(*) INTO v_n
    FROM public.trade_queue_items
   WHERE stage::text IN ('aware', 'investigate', 'deep_research', 'thesis_forming',
                         'ready_for_decision', 'idea', 'simulating', 'deciding');
  IF v_n IS DISTINCT FROM 16 THEN
    RAISE EXCEPTION 'FAIL 5a: expected all 16 fixture rows still on legacy stages, found %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.trade_queue_items WHERE stage_migrated_from IS NOT NULL;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 5b: expand populated stage_migrated_from on % rows; that is Phase C''s job', v_n;
  END IF;
  RAISE NOTICE 'PASS 5: no row rewritten, no origin recorded yet';

  -- ── 6. The seeder still emits LEGACY, on purpose ─────────────────────────
  -- Rewriting it during expand would hand canonical stages to the old build,
  -- which maps unknown labels to `aware` — demo data would silently all
  -- appear in the first column for anyone on the old version.
  IF pg_get_functiondef('public.seed_demo_ideas(uuid)'::regprocedure)
     NOT LIKE '%''ready_for_decision''%' THEN
    RAISE EXCEPTION 'FAIL 6: expand rewrote the seeder; that belongs in Phase C';
  END IF;

  PERFORM public.seed_demo_ideas(gen_random_uuid());
  SELECT count(*) INTO v_n FROM public.trade_queue_items WHERE organization_id IS NOT NULL;
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'FAIL 6b: seeder produced % rows, expected 4', v_n;
  END IF;
  DELETE FROM public.trade_queue_items WHERE organization_id IS NOT NULL;
  RAISE NOTICE 'PASS 6: provisioning still works and still emits legacy stages';

  -- ── 7. The sibling status enum is untouched ──────────────────────────────
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO v_txt
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'trade_queue_status';
  IF v_txt IS DISTINCT FROM
     'idea,discussing,approved,rejected,executed,cancelled,deleted,deciding,simulating,archived'
  THEN
    RAISE EXCEPTION 'FAIL 7: trade_queue_status changed: [%]', v_txt;
  END IF;
  RAISE NOTICE 'PASS 7: trade_queue_status untouched by expand';

  -- ── 8. No default was added to `stage` ───────────────────────────────────
  -- A default of `exploring` would be reachable by INSERTs from the OLD code,
  -- which cannot read that label.
  SELECT pg_get_expr(ad.adbin, ad.adrelid) INTO v_txt
    FROM pg_attrdef ad
    JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
   WHERE ad.adrelid = 'public.trade_queue_items'::regclass AND a.attname = 'stage';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 8: expand set a stage default (%), which old code cannot read', v_txt;
  END IF;
  RAISE NOTICE 'PASS 8: no stage default until contract';

  RAISE NOTICE '--- expand: 8/8 assertions passed ---';
END;
$t$;
