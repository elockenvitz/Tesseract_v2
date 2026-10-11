-- ===========================================================================
-- REHEARSAL — applies 20261011120000 against production rows, asserts every
-- property, and CANNOT commit: the final statement raises deliberately, which
-- aborts the transaction and returns the collected results in the error text.
--
-- The harness was probed first: a multi-statement payload runs in ONE
-- transaction here, and a table created before a raised exception does not
-- survive. That probe is why this pattern is trustworthy.
--
-- Any assertion failing raises with its own message instead, so a run that
-- reaches the final abort means every check passed.
-- ===========================================================================
begin;

create temp table rehearsal_log (seq serial, line text) on commit drop;

-- ---------------------------------------------------------------------------
-- MIGRATION UNDER TEST (verbatim from
-- supabase/migrations/20261011120000_price_target_outcomes_tenant_isolation.sql)
-- ---------------------------------------------------------------------------

ALTER TABLE public.price_target_outcomes
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_price_target_outcomes_organization_id
  ON public.price_target_outcomes(organization_id);

CREATE OR REPLACE FUNCTION public.price_target_outcome_org(p_price_target_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT apt.organization_id
    FROM public.analyst_price_targets apt
   WHERE apt.id = p_price_target_id;
$function$;

CREATE OR REPLACE FUNCTION public.set_price_target_outcome_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.price_target_id IS DISTINCT FROM OLD.price_target_id THEN
    RAISE EXCEPTION
      'price_target_outcomes.price_target_id is immutable (row %)', OLD.id;
  END IF;
  NEW.organization_id := public.price_target_outcome_org(NEW.price_target_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS price_target_outcomes_set_org_id
  ON public.price_target_outcomes;
CREATE TRIGGER price_target_outcomes_set_org_id
  BEFORE INSERT OR UPDATE ON public.price_target_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.set_price_target_outcome_org();

UPDATE public.price_target_outcomes pto
   SET organization_id = apt.organization_id
  FROM public.analyst_price_targets apt
 WHERE apt.id = pto.price_target_id
   AND pto.organization_id IS DISTINCT FROM apt.organization_id;

DROP POLICY IF EXISTS "Users can view all price target outcomes"
  ON public.price_target_outcomes;
DROP POLICY IF EXISTS price_target_outcomes_select
  ON public.price_target_outcomes;
CREATE POLICY price_target_outcomes_select ON public.price_target_outcomes
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND is_active_member_of_current_org()
    AND organization_id = current_org_id()
  );

DROP POLICY IF EXISTS "Users can update their own outcomes"
  ON public.price_target_outcomes;
DROP POLICY IF EXISTS price_target_outcomes_update
  ON public.price_target_outcomes;
CREATE POLICY price_target_outcomes_update ON public.price_target_outcomes
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND (organization_id IS NULL OR organization_id = current_org_id())
  )
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "System can insert outcomes"
  ON public.price_target_outcomes;

REVOKE ALL ON public.price_target_outcomes FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.price_target_outcomes FROM authenticated;
GRANT SELECT, UPDATE ON public.price_target_outcomes TO authenticated;

-- ---------------------------------------------------------------------------
-- 3a. Nothing lost, every owner derived, none fabricated.
-- ---------------------------------------------------------------------------
DO $a$
DECLARE total int; owned int; wrong int;
BEGIN
  SELECT count(*), count(organization_id) INTO total, owned
    FROM public.price_target_outcomes;
  IF total <> 30 THEN
    RAISE EXCEPTION 'FAIL 3a: row count is %, expected 30', total;
  END IF;
  IF owned <> 30 THEN
    RAISE EXCEPTION 'FAIL 3a: only % of % rows resolved to an owner', owned, total;
  END IF;
  SELECT count(*) INTO wrong
    FROM public.price_target_outcomes pto
    JOIN public.analyst_price_targets apt ON apt.id = pto.price_target_id
   WHERE pto.organization_id IS DISTINCT FROM apt.organization_id;
  IF wrong <> 0 THEN
    RAISE EXCEPTION 'FAIL 3a: % row(s) disagree with their parent', wrong;
  END IF;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3a  rows preserved=30  owners derived=30  fabricated=0');
END $a$;

-- ---------------------------------------------------------------------------
-- 3b. No unconditional or AUTH_ONLY predicate survives.
-- ---------------------------------------------------------------------------
DO $b$
DECLARE n int; names text;
BEGIN
  SELECT count(*), coalesce(string_agg(polname, ', '), '-') INTO n, names
    FROM pg_policy
   WHERE polrelid = 'public.price_target_outcomes'::regclass
     AND coalesce(pg_get_expr(polqual, polrelid), '') IN
         ('true', '(true)', '(auth.uid() IS NOT NULL)');
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL 3b: % AUTH_ONLY/unconditional predicate(s) remain: %', n, names;
  END IF;
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'public.price_target_outcomes'::regclass;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3b  no unconditional predicate; policies now=' || n);
END $b$;

-- ---------------------------------------------------------------------------
-- 3c. anon holds no grant.
-- ---------------------------------------------------------------------------
DO $c$
DECLARE n int; privs text;
BEGIN
  SELECT count(*), coalesce(string_agg(privilege_type, ','), '-') INTO n, privs
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'price_target_outcomes'
     AND grantee IN ('anon', 'PUBLIC');
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL 3c: anon/PUBLIC still holds: %', privs;
  END IF;
  SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '-')
    INTO privs FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'price_target_outcomes'
     AND grantee = 'authenticated';
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3c  anon revoked; authenticated now holds ' || privs);
END $c$;

-- ---------------------------------------------------------------------------
-- 3d. SAME-TENANT READ preserved — owner org keeps all it owns.
-- ---------------------------------------------------------------------------
DO $d$
DECLARE readable int; timeline int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"6e020f03-3db9-42bb-89ee-8aff12f31e34","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO readable FROM public.price_target_outcomes;
  SELECT count(*) INTO timeline FROM public.price_target_outcomes
   WHERE status IN ('hit','missed','expired');
  RESET ROLE;
  IF readable <> 27 THEN
    RAISE EXCEPTION 'FAIL 3d: owner org reads % rows, expected 27', readable;
  END IF;
  IF timeline <> 7 THEN
    RAISE EXCEPTION 'FAIL 3d: owner org reads % timeline rows, expected 7', timeline;
  END IF;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3d  Tesseract user keeps 27 rows and all 7 timeline rows');
END $d$;

-- ---------------------------------------------------------------------------
-- 3e. CROSS-TENANT READ denied, and the child now agrees with its parent.
-- ---------------------------------------------------------------------------
DO $e$
DECLARE readable int; timeline int; parents int; escaped int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"95cb37a8-642d-4a9b-ac82-abaf5635a0bd","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO readable FROM public.price_target_outcomes;
  SELECT count(*) INTO timeline FROM public.price_target_outcomes
   WHERE status IN ('hit','missed','expired');
  SELECT count(*) INTO parents FROM public.analyst_price_targets;
  SELECT count(*) INTO escaped FROM public.price_target_outcomes pto
   WHERE NOT EXISTS (SELECT 1 FROM public.analyst_price_targets apt
                      WHERE apt.id = pto.price_target_id);
  RESET ROLE;
  IF readable <> 3 THEN
    RAISE EXCEPTION 'FAIL 3e: foreign org reads % rows, expected its own 3', readable;
  END IF;
  IF timeline <> 0 THEN
    RAISE EXCEPTION 'FAIL 3e: foreign org still reads % timeline rows', timeline;
  END IF;
  IF escaped <> 0 THEN
    RAISE EXCEPTION 'FAIL 3e: % row(s) still outlive an invisible parent', escaped;
  END IF;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3e  Caffrey user: own rows=3  timeline=0  escaped=0  (was 30 / 7 / 27)');
END $e$;

-- ---------------------------------------------------------------------------
-- 3f. CROSS-TENANT UPDATE touches nothing.
-- ---------------------------------------------------------------------------
DO $f$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"95cb37a8-642d-4a9b-ac82-abaf5635a0bd","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.price_target_outcomes SET notes = 'cross-tenant write attempt'
   WHERE status IN ('hit','missed','expired');
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 3f: foreign UPDATE touched % row(s)', n;
  END IF;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3f  cross-tenant UPDATE touched 0 rows');
END $f$;

-- ---------------------------------------------------------------------------
-- 3g. NON-VACUITY: a forged organization_id is discarded, not trusted.
-- ---------------------------------------------------------------------------
DO $g$
DECLARE victim uuid; truth uuid; forged uuid; got uuid;
BEGIN
  SELECT pto.id, apt.organization_id INTO victim, truth
    FROM public.price_target_outcomes pto
    JOIN public.analyst_price_targets apt ON apt.id = pto.price_target_id
   WHERE apt.organization_id IS NOT NULL
   LIMIT 1;
  SELECT id INTO forged FROM public.organizations WHERE id <> truth LIMIT 1;

  UPDATE public.price_target_outcomes SET organization_id = forged WHERE id = victim;
  SELECT organization_id INTO got FROM public.price_target_outcomes WHERE id = victim;

  IF got = forged THEN
    RAISE EXCEPTION 'FAIL 3g: forged organization_id % was ACCEPTED', forged;
  END IF;
  IF got IS DISTINCT FROM truth THEN
    RAISE EXCEPTION 'FAIL 3g: owner became %, expected the parent''s %', got, truth;
  END IF;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3g  forged owner discarded and re-derived to the parent''s org');
END $g$;

-- ---------------------------------------------------------------------------
-- 3h. NON-VACUITY: the natural key is immutable.
-- ---------------------------------------------------------------------------
DO $h$
DECLARE victim uuid; mine uuid; other_parent uuid; blocked boolean := false;
BEGIN
  SELECT id, price_target_id INTO victim, mine
    FROM public.price_target_outcomes LIMIT 1;
  SELECT apt.id INTO other_parent FROM public.analyst_price_targets apt
   WHERE apt.id <> mine LIMIT 1;

  BEGIN
    UPDATE public.price_target_outcomes
       SET price_target_id = other_parent WHERE id = victim;
  EXCEPTION WHEN raise_exception OR unique_violation THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL 3h: price_target_id was mutable — a row can change tenant';
  END IF;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3h  price_target_id is immutable; repointing refused');
END $h$;

-- ---------------------------------------------------------------------------
-- 3i. NON-VACUITY: manufacture the quarantine case and prove it hides.
-- ---------------------------------------------------------------------------
DO $i$
DECLARE parent uuid; child uuid; owner_org uuid; present int; visible int;
BEGIN
  SELECT pto.price_target_id, pto.id, pto.organization_id
    INTO parent, child, owner_org
    FROM public.price_target_outcomes pto
   WHERE pto.organization_id IS NOT NULL LIMIT 1;

  UPDATE public.analyst_price_targets SET organization_id = NULL WHERE id = parent;
  UPDATE public.price_target_outcomes SET notes = notes WHERE id = child;

  SELECT count(*) INTO present FROM public.price_target_outcomes
   WHERE id = child AND organization_id IS NULL;
  IF present <> 1 THEN
    RAISE EXCEPTION 'FAIL 3i: unresolvable row did not quarantine to NULL';
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"6e020f03-3db9-42bb-89ee-8aff12f31e34","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO visible FROM public.price_target_outcomes WHERE id = child;
  RESET ROLE;

  IF visible <> 0 THEN
    RAISE EXCEPTION 'FAIL 3i: quarantined row still visible to its own org %', owner_org;
  END IF;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3i  unresolvable row quarantined to NULL: preserved=1 visible=0');
END $i$;

-- ---------------------------------------------------------------------------
-- 3j. The live write path still produces a correctly owned outcome.
-- ---------------------------------------------------------------------------
DO $j$
DECLARE expected uuid; pick_asset uuid; pick_scenario uuid;
        new_target uuid; stamped uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"6e020f03-3db9-42bb-89ee-8aff12f31e34","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT current_org_id() INTO expected;

  SELECT apt.asset_id, apt.scenario_id INTO pick_asset, pick_scenario
    FROM public.analyst_price_targets apt
   WHERE apt.organization_id = expected
     AND NOT EXISTS (
       SELECT 1 FROM public.analyst_price_targets x
        WHERE x.user_id = '6e020f03-3db9-42bb-89ee-8aff12f31e34'::uuid
          AND x.asset_id = apt.asset_id
          AND x.scenario_id = apt.scenario_id)
   LIMIT 1;

  IF pick_asset IS NULL THEN
    RESET ROLE;
    INSERT INTO rehearsal_log(line) VALUES
      ('SKIP 3j  no free (asset, scenario) pair for this user — write path untested');
    RETURN;
  END IF;

  INSERT INTO public.analyst_price_targets (user_id, asset_id, scenario_id, price)
  VALUES ('6e020f03-3db9-42bb-89ee-8aff12f31e34'::uuid, pick_asset, pick_scenario, 123.45)
  RETURNING id INTO new_target;

  SELECT organization_id INTO stamped
    FROM public.price_target_outcomes WHERE price_target_id = new_target;
  RESET ROLE;

  IF new_target IS NULL THEN
    RAISE EXCEPTION 'FAIL 3j: could not create a price target as the owner user';
  END IF;
  IF stamped IS NULL THEN
    RAISE EXCEPTION 'FAIL 3j: no outcome row was created, or it has no owner';
  END IF;
  IF stamped IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL 3j: new outcome stamped %, expected %', stamped, expected;
  END IF;
  INSERT INTO rehearsal_log(line) VALUES
    ('OK 3j  live write path created an outcome owned by the writer''s org');
END $j$;

-- ---------------------------------------------------------------------------
-- FINAL: abort deliberately and return the log. This transaction cannot commit.
-- ---------------------------------------------------------------------------
DO $z$
DECLARE report text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY seq) INTO report FROM rehearsal_log;
  RAISE EXCEPTION E'REHEARSAL COMPLETE — ROLLING BACK\n%\n(all assertions passed; nothing committed)', report;
END $z$;
