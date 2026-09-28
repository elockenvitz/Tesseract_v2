-- Simulates the ROLLOUT WINDOW: the expanded database, with the new
-- application deployed and writing canonical stages while legacy rows written
-- by the old build are still sitting there.
--
-- This is the population the contract migration will actually meet in
-- production — not a clean all-legacy table. A contract migration tested only
-- against legacy rows is tested against a state that will never exist.
--
-- Run AFTER the expand migration, BEFORE the contract migration.

-- Three ideas written by the Phase B application.
INSERT INTO public.trade_queue_items (asset_id, stage, status, rationale, thesis_text) VALUES
  (gen_random_uuid(), 'exploring',          'idea',     '',        NULL),
  (gen_random_uuid(), 'developing',         'simulating', 'Why now', 'Thesis'),
  -- The collision shape, written the NEW way: canonical stage beside a status
  -- that happens to share a label with the legacy stage vocabulary.
  (gen_random_uuid(), 'ready_to_recommend', 'deciding', 'Why now', 'Thesis');

-- And one portfolio track, on the column the original migration forgot.
INSERT INTO public.trade_idea_portfolios (trade_queue_item_id, portfolio_id, stage)
SELECT id, gen_random_uuid(), 'researching'
  FROM public.trade_queue_items WHERE stage::text = 'exploring' ORDER BY id LIMIT 1;

DO $t$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.trade_queue_items
   WHERE stage::text IN ('exploring', 'researching', 'developing', 'ready_to_recommend');
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Phase B setup wrote % canonical rows, expected 3', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.trade_queue_items
   WHERE stage::text NOT IN ('exploring', 'researching', 'developing', 'ready_to_recommend');
  IF v_n IS DISTINCT FROM 16 THEN
    RAISE EXCEPTION 'Phase B setup: expected 16 legacy rows remaining, found %', v_n;
  END IF;

  RAISE NOTICE 'Rollout window simulated: 16 legacy + 3 canonical rows coexisting.';
END;
$t$;
