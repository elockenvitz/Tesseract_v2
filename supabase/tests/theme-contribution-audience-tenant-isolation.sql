-- =============================================================================
-- Theme research audience — tenant isolation and authorization
--
-- The regression suite for `20261104140000_theme_contribution_audience.sql`
-- and `20261104140001_set_theme_contribution_audience.sql`, and the
-- cross-org isolation test CLAUDE.md Standing Rule 5 requires every
-- organization-owned feature to ship with.
--
-- Real `authenticated` and `anon` roles, real `request.jwt.claims`. It writes
-- only synthetic `ZZ`-prefixed fixtures and deletes them.
--
-- ── What this is testing, and why it is not a formality ────────────────────
--
-- `theme_contributions_v2.visibility` existed for months and restricted
-- NOTHING. Production's SELECT policy was:
--
--     EXISTS (SELECT 1 FROM themes t WHERE t.id = theme_id
--               AND t.organization_id = current_org_id())
--     AND (visibility = 'shared' OR organization_id = current_org_id())
--
-- Every row's `organization_id` IS the current org for anybody who can reach
-- it, so the second clause is a tautology and the column is inert: every
-- piece of theme research was readable by every member of the organization
-- whatever its visibility said. All four policies were also `TO public`
-- rather than `TO authenticated`, and `anon` held SELECT/INSERT/UPDATE/DELETE
-- grants on the table (measured on production, 2026-11-08).
--
-- The tautology is direct evidence, read off production rather than inferred:
-- `pg_get_expr(polqual, polrelid)` for the SELECT policy returns exactly that
-- predicate.
--
-- ── What the cross-org assertions are, honestly ───────────────────────────
--
-- They are NOT observations of a hole. Measured on production before the
-- migration, 6, 7 and 8 already PASS: the old SELECT and INSERT policies did
-- carry a `themes.organization_id = current_org_id()` predicate, and
-- UPDATE/DELETE were `created_by = auth.uid()`, which a foreign user fails on
-- a row they did not write. The cross-org boundary held.
--
-- They are here because Standing Rule 5 requires them and because the
-- migration rewrites all four policies: their job is to prove the rewrite did
-- not LOSE a boundary that was already there. A guard that only observes new
-- failures cannot notice a regression, and rewriting four policies is exactly
-- when one gets lost.
--
-- The defect this migration actually fixes is the one 5 and 15 describe: the
-- vocabulary could not express a restriction at all, so there was no
-- restricted state for a non-targeted member to be excluded from.
--
-- ── Running this against production ───────────────────────────────────────
--
-- Sanctioned under exactly the four conditions
-- `contribution-audience-management.sql` sets out, none of them relaxable:
--
--   1. The whole file reaches the server as ONE statement batch under
--      autocommit -- `psql -f`, the SQL Editor, or a single Supabase MCP
--      execute_sql call.
--   2. Do NOT wrap it in an explicit BEGIN. A transaction committed despite
--      an earlier error would defeat the rollback guarantee.
--   3. Every fixture is created and destroyed inside the one DO block:
--      success runs cleanup, a caught assertion failure is a subtransaction
--      so cleanup still runs, and an uncaught error aborts the single
--      statement and takes every fixture with it.
--   4. It creates only ZZ-prefixed synthetic organizations, users, themes,
--      org-chart nodes and contributions. The six real theme contributions
--      are never read or written.
--
-- ── Expected ──────────────────────────────────────────────────────────────
--
--   BEFORE the two migrations — MEASURED on production 2026-11-08, not
--   predicted (the first version of this header predicted 5/4/5 and was
--   wrong about 6, 7 and 8; the run is what stands):
--
--                                8 PASS, 2 FAIL, 5 SKIP
--       FAIL: 5  -- 'a non-targeted same-org member read restricted
--                   research'. Before the migration there is no restricted
--                   state to be excluded from: the fixture falls back to
--                   'org', which legitimately means org-wide. So this
--                   failure is the vocabulary's absence, which is the defect
--                   stated precisely rather than a second one.
--             15 -- 'org' accepted, 'firm' rejected, default still 'org'.
--       SKIP: 2, 4, 9, 11, 12 -- `set_theme_contribution_audience` and
--             `theme_contribution_visibility_targets` do not exist yet, so
--             their refusals cannot be observed. A SKIP IS NOT A PASS, and
--             five of fifteen is most of what the migration adds.
--       PASS: 1, 3, 6, 7, 8, 10, 13, 14 -- the boundaries that already held.
--             13 passes BEFORE for the WRONG reason: the old CHECK rejects
--             'firm', so the write fails rather than being pinned. 15 is
--             what tells the two apart, and 14 passes trivially because
--             there is no targets table. Neither is evidence on its own.
--
--   AFTER:                      15 PASS, 0 FAIL, 0 SKIP
--
-- Assertion 3 must pass in BOTH states: it is ordinary research editing. If
-- it ever fails, the restriction has broken writing prose, which is worse
-- than the defect it fixes.
-- =============================================================================

DROP TABLE IF EXISTS _tca_results;
CREATE TEMP TABLE _tca_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org_a    uuid := gen_random_uuid();
  v_org_b    uuid := gen_random_uuid();
  v_author   uuid := gen_random_uuid();   -- org A, writes the research
  v_targeted uuid := gen_random_uuid();   -- org A, ON the targeted team
  v_untarg   uuid := gen_random_uuid();   -- org A, on NO targeted group
  v_foreign  uuid := gen_random_uuid();   -- org B
  v_theme_a  uuid := gen_random_uuid();
  v_theme_b  uuid := gen_random_uuid();
  v_team_a   uuid := gen_random_uuid();   -- org A, team, targeted
  v_team_a2  uuid := gen_random_uuid();   -- org A, team, NOT targeted
  v_team_b   uuid := gen_random_uuid();   -- org B, team
  v_c        uuid;                        -- the contribution under test
  v_pass     int := 0;
  v_fail     int := 0;
  v_skip     int := 0;
  v_n        int;
  v_txt      text;
  v_msg      text;
  v_has_rpc  boolean := to_regprocedure(
    'public.set_theme_contribution_audience(uuid,text,uuid[])') IS NOT NULL;
  v_has_tgt  boolean := to_regclass(
    'public.theme_contribution_visibility_targets') IS NOT NULL;
BEGIN
  RAISE NOTICE '=== Theme audience tenant isolation (suffix: %) ===', v_suffix;
  RAISE NOTICE 'RPC present: %   targets table present: %', v_has_rpc, v_has_tgt;

  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO auth.users(id) VALUES (v_author), (v_targeted), (v_untarg), (v_foreign);
  INSERT INTO organizations(id, name, slug) VALUES
    (v_org_a, 'ZZ Theme A '||v_suffix, 'zz-theme-a-'||v_suffix),
    (v_org_b, 'ZZ Theme B '||v_suffix, 'zz-theme-b-'||v_suffix);
  UPDATE users SET current_organization_id = v_org_a
   WHERE id IN (v_author, v_targeted, v_untarg);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_foreign;
  INSERT INTO organization_memberships(organization_id, user_id, status) VALUES
    (v_org_a, v_author,'active'), (v_org_a, v_targeted,'active'),
    (v_org_a, v_untarg,'active'), (v_org_b, v_foreign,'active');

  INSERT INTO themes(id, organization_id, name, is_public) VALUES
    (v_theme_a, v_org_a, 'ZZ Theme A '||v_suffix, true),
    (v_theme_b, v_org_b, 'ZZ Theme B '||v_suffix, true);

  INSERT INTO org_chart_nodes(id, organization_id, node_type, name) VALUES
    (v_team_a,  v_org_a, 'team', 'ZZ Team A '||v_suffix),
    (v_team_a2, v_org_a, 'team', 'ZZ Team A2 '||v_suffix),
    (v_team_b,  v_org_b, 'team', 'ZZ Team B '||v_suffix);
  INSERT INTO org_chart_node_members(node_id, user_id, role) VALUES
    (v_team_a,  v_author,   'member'),
    (v_team_a,  v_targeted, 'member'),
    (v_team_a2, v_untarg,   'member');

  /*
   * The row under test, written as the author with elevated rights so the
   * fixture does not depend on the policies being tested. 'team' + one target
   * is the interesting state: restricted, and naming a real group.
   *
   * `visibility` is set explicitly so the fixture is valid under BOTH
   * vocabularies' CHECK constraints... which it cannot be, since they are
   * disjoint. So it is set to whatever the live constraint admits, and
   * assertion 15 is what pins which one that is.
   */
  INSERT INTO theme_contributions_v2
    (theme_id, section, content, created_by, organization_id, visibility)
  VALUES (v_theme_a, 'thesis', 'ZZ ORIGINAL PROSE '||v_suffix,
          v_author, v_org_a,
          CASE WHEN v_has_tgt THEN 'team' ELSE 'org' END)
  RETURNING id INTO v_c;

  IF v_has_tgt THEN
    INSERT INTO theme_contribution_visibility_targets
      (contribution_id, node_id, organization_id)
    VALUES (v_c, v_team_a, v_org_a);
  END IF;

  -- ===========================================================================
  -- 1. anon cannot read theme research.              PASSES BEFORE AND AFTER
  --    Before: the grants are there but current_org_id() is NULL for anon,
  --    so the policy returns nothing. After: the grant is revoked too.
  --    It passes both ways and is kept as a floor, not as evidence.
  -- ===========================================================================
  BEGIN
    SET LOCAL request.jwt.claims = '';
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_n FROM theme_contributions_v2 WHERE id = v_c;
    RESET ROLE;
    IF v_n = 0 THEN v_pass := v_pass+1;
      INSERT INTO _tca_results VALUES (1,'PASS','anon reads no theme research');
    ELSE v_fail := v_fail+1;
      INSERT INTO _tca_results VALUES (1,'FAIL', format('anon read %s row(s)', v_n)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (1,'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. anon cannot execute the audience RPC.                     SKIP BEFORE
  -- ===========================================================================
  IF NOT v_has_rpc THEN
    v_skip := v_skip+1;
    INSERT INTO _tca_results VALUES (2,'SKIP','set_theme_contribution_audience does not exist');
  ELSE
    BEGIN
      SET LOCAL request.jwt.claims = '';
      SET LOCAL ROLE anon;
      PERFORM public.set_theme_contribution_audience(v_c, 'firm', '{}');
      RESET ROLE;
      v_fail := v_fail+1;
      INSERT INTO _tca_results VALUES (2,'FAIL','anon could execute the audience RPC');
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE; v_pass := v_pass+1;
      INSERT INTO _tca_results VALUES (2,'PASS', format('anon refused (%s)', SQLSTATE));
    END;
  END IF;

  -- ===========================================================================
  -- 3. ORDINARY RESEARCH EDITING STILL WORKS.       MUST PASS IN BOTH STATES
  --    A content save succeeds and leaves the audience untouched.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_author, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE theme_contributions_v2 SET content = 'ZZ EDITED PROSE '||v_suffix
     WHERE id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := 'content save raised '||SQLSTATE||' ';
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT content INTO v_txt FROM theme_contributions_v2 WHERE id = v_c;
  IF v_txt IS DISTINCT FROM 'ZZ EDITED PROSE '||v_suffix THEN
    v_msg := v_msg||'content not saved '; END IF;
  IF v_has_tgt THEN
    SELECT count(*) INTO v_n FROM theme_contribution_visibility_targets
     WHERE contribution_id = v_c;
    IF v_n <> 1 THEN v_msg := v_msg||format('audience changed (%s targets) ', v_n); END IF;
  END IF;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (3,'PASS','content save works and leaves the audience alone');
  ELSE v_fail := v_fail+1; INSERT INTO _tca_results VALUES (3,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 4. A LEGITIMATE SAME-ORG READER IS ALLOWED.                  SKIP BEFORE
  --    The targeted teammate CAN read the restricted research. This is the
  --    assertion that stops the fix from being "deny everything": a policy
  --    that blocks the intended audience is not isolation, it is an outage.
  -- ===========================================================================
  IF NOT v_has_tgt THEN
    v_skip := v_skip+1;
    INSERT INTO _tca_results VALUES (4,'SKIP','no targets table, so no targeted reader to allow');
  ELSE
    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L',
                     json_build_object('sub', v_targeted, 'role','authenticated')::text);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM theme_contributions_v2 WHERE id = v_c;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
    END;
    SET LOCAL request.jwt.claims = '';
    IF v_n = 1 THEN v_pass := v_pass+1;
      INSERT INTO _tca_results VALUES (4,'PASS','the targeted teammate can read it');
    ELSE v_fail := v_fail+1;
      INSERT INTO _tca_results VALUES (4,'FAIL',
        format('targeted teammate saw %s row(s) -- the audience is locked out', v_n)); END IF;
  END IF;

  -- ===========================================================================
  -- 5. A SAME-ORG NON-TARGETED MEMBER CANNOT READ.               FAILS BEFORE
  --    THE DEFECT. `visibility` restricted nothing, so this member -- in the
  --    org, on a different team, named by no target row -- read every word.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_untarg, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM theme_contributions_v2 WHERE id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := 0;
  END;
  SET LOCAL request.jwt.claims = '';
  IF v_n = 0 THEN v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (5,'PASS','a non-targeted same-org member is denied');
  ELSE v_fail := v_fail+1;
    INSERT INTO _tca_results VALUES (5,'FAIL',
      format('a non-targeted same-org member read research marked %s',
             (SELECT visibility FROM theme_contributions_v2 WHERE id = v_c))); END IF;

  -- ===========================================================================
  -- 6. CROSS-ORG READ IS DENIED.                                 FAILS BEFORE
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_foreign, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM theme_contributions_v2 WHERE id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := 0;
  END;
  SET LOCAL request.jwt.claims = '';
  IF v_n = 0 THEN v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (6,'PASS','another org cannot read this research');
  ELSE v_fail := v_fail+1;
    INSERT INTO _tca_results VALUES (6,'FAIL',
      format('another org read %s row(s) of this org''s research', v_n)); END IF;

  -- ===========================================================================
  -- 7. CROSS-ORG WRITE IS DENIED — UPDATE and DELETE.            FAILS BEFORE
  --    Both paths, because the old policies checked `created_by = auth.uid()`
  --    with NO org predicate. Own-row only, so not a hole on its own, but
  --    asymmetric with INSERT, and an asymmetry is how a policy drifts.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_foreign, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE theme_contributions_v2 SET content = 'ZZ FOREIGN REWRITE '||v_suffix
     WHERE id = v_c;
    DELETE FROM theme_contributions_v2 WHERE id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_n FROM theme_contributions_v2 WHERE id = v_c;
  IF v_n <> 1 THEN v_msg := v_msg||'the row was DELETED by another org '; END IF;
  SELECT content INTO v_txt FROM theme_contributions_v2 WHERE id = v_c;
  IF v_txt = 'ZZ FOREIGN REWRITE '||v_suffix THEN
    v_msg := v_msg||'the prose was REWRITTEN by another org '; END IF;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (7,'PASS','another org can neither rewrite nor delete it');
  ELSE v_fail := v_fail+1; INSERT INTO _tca_results VALUES (7,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 8. CROSS-ORG WRITE IS DENIED — INSERT onto another org's theme.
  --                                                              FAILS BEFORE
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_foreign, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO theme_contributions_v2
      (theme_id, section, content, created_by, organization_id, visibility)
    VALUES (v_theme_a, 'thesis', 'ZZ FOREIGN INSERT '||v_suffix,
            v_foreign, v_org_b, CASE WHEN v_has_tgt THEN 'firm' ELSE 'org' END);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_n FROM theme_contributions_v2
   WHERE theme_id = v_theme_a AND created_by = v_foreign;
  IF v_n = 0 THEN v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (8,'PASS','another org cannot write onto this org''s theme');
  ELSE v_fail := v_fail+1;
    INSERT INTO _tca_results VALUES (8,'FAIL',
      format('another org inserted %s row(s) onto this org''s theme', v_n)); END IF;

  -- ===========================================================================
  -- 9. CROSS-ORG TARGET WRITE IS DENIED.                         SKIP BEFORE
  --    Inserting a target row is how an attacker would hand THEMSELVES the
  --    audience, so the targets table needs its own cross-org proof.
  -- ===========================================================================
  IF NOT v_has_tgt THEN
    v_skip := v_skip+1;
    INSERT INTO _tca_results VALUES (9,'SKIP','no targets table to attack');
  ELSE
    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L',
                     json_build_object('sub', v_foreign, 'role','authenticated')::text);
      SET LOCAL ROLE authenticated;
      INSERT INTO theme_contribution_visibility_targets
        (contribution_id, node_id, organization_id)
      VALUES (v_c, v_team_b, v_org_b);
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE;
    END;
    SET LOCAL request.jwt.claims = '';
    SELECT count(*) INTO v_n FROM theme_contribution_visibility_targets
     WHERE contribution_id = v_c AND node_id = v_team_b;
    IF v_n = 0 THEN v_pass := v_pass+1;
      INSERT INTO _tca_results VALUES (9,'PASS','another org cannot add itself to the audience');
    ELSE v_fail := v_fail+1;
      INSERT INTO _tca_results VALUES (9,'FAIL','another org added its own node to the audience'); END IF;
  END IF;

  -- ===========================================================================
  -- 10. A NON-AUTHOR SAME-ORG MEMBER CANNOT REWRITE IT.  PASSES BEFORE/AFTER
  --     Kept because the fix must not widen it. `created_by = auth.uid()`
  --     already held here; if this ever fails, something was loosened.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_targeted, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE theme_contributions_v2 SET content = 'ZZ TEAMMATE REWRITE '||v_suffix
     WHERE id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT content INTO v_txt FROM theme_contributions_v2 WHERE id = v_c;
  IF v_txt <> 'ZZ TEAMMATE REWRITE '||v_suffix THEN v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (10,'PASS','a same-org non-author cannot rewrite it');
  ELSE v_fail := v_fail+1;
    INSERT INTO _tca_results VALUES (10,'FAIL','a same-org non-author rewrote it'); END IF;

  -- ===========================================================================
  -- 11. THE RPC REFUSES A FOREIGN-ORG NODE.                      SKIP BEFORE
  -- ===========================================================================
  IF NOT v_has_rpc THEN
    v_skip := v_skip+1;
    INSERT INTO _tca_results VALUES (11,'SKIP','no RPC to refuse a foreign node');
  ELSE
    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L',
                     json_build_object('sub', v_author, 'role','authenticated')::text);
      SET LOCAL ROLE authenticated;
      PERFORM public.set_theme_contribution_audience(v_c, 'team', ARRAY[v_team_b]);
      RESET ROLE;
      v_fail := v_fail+1;
      INSERT INTO _tca_results VALUES (11,'FAIL','a node in another org was accepted as a target');
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      IF SQLSTATE = '42501' THEN v_pass := v_pass+1;
        INSERT INTO _tca_results VALUES (11,'PASS','a foreign-org node is refused (42501)');
      ELSE v_fail := v_fail+1;
        INSERT INTO _tca_results VALUES (11,'FAIL',
          format('refused, but with %s rather than 42501', SQLSTATE)); END IF;
    END;
    SET LOCAL request.jwt.claims = '';
  END IF;

  -- ===========================================================================
  -- 12. THE RPC REFUSES A RESTRICTED AUDIENCE NAMING NOBODY.     SKIP BEFORE
  --     `targetIds: []` at a non-firm level is readable by its author alone
  --     while every badge shows it as shared. 23514, by design.
  -- ===========================================================================
  IF NOT v_has_rpc THEN
    v_skip := v_skip+1;
    INSERT INTO _tca_results VALUES (12,'SKIP','no RPC to refuse an empty audience');
  ELSE
    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L',
                     json_build_object('sub', v_author, 'role','authenticated')::text);
      SET LOCAL ROLE authenticated;
      PERFORM public.set_theme_contribution_audience(v_c, 'team', '{}'::uuid[]);
      RESET ROLE;
      v_fail := v_fail+1;
      INSERT INTO _tca_results VALUES (12,'FAIL','a team audience with no groups was accepted');
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      IF SQLSTATE = '23514' THEN v_pass := v_pass+1;
        INSERT INTO _tca_results VALUES (12,'PASS','an empty restricted audience is refused (23514)');
      ELSE v_fail := v_fail+1;
        INSERT INTO _tca_results VALUES (12,'FAIL',
          format('refused, but with %s rather than 23514', SQLSTATE)); END IF;
    END;
    SET LOCAL request.jwt.claims = '';
  END IF;

  -- ===========================================================================
  -- 13. visibility IS PINNED AGAINST A DIRECT UPDATE.    PASSES BEFORE/AFTER
  --     BEFORE it passes for the WRONG reason: the old CHECK rejects 'firm',
  --     so the write fails rather than being pinned. AFTER, the pin trigger
  --     silently restores the old value. Assertion 15 tells the two apart.
  -- ===========================================================================
  SELECT visibility INTO v_txt FROM theme_contributions_v2 WHERE id = v_c;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_author, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE theme_contributions_v2 SET visibility = 'firm' WHERE id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT visibility INTO v_msg FROM theme_contributions_v2 WHERE id = v_c;
  IF v_msg = v_txt THEN v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (13,'PASS',
      format('a direct visibility write did not stick (still %s)', v_msg));
  ELSE v_fail := v_fail+1;
    INSERT INTO _tca_results VALUES (13,'FAIL',
      format('a direct write widened visibility from %s to %s', v_txt, v_msg)); END IF;

  -- ===========================================================================
  -- 14. THE TARGETS SURVIVED THAT ATTEMPT.               PASSES BEFORE/AFTER
  --     A pinned level with a destroyed audience is the worst outcome: the
  --     badge shows a lock and only the author can read it.
  -- ===========================================================================
  IF NOT v_has_tgt THEN
    v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (14,'PASS','no targets table yet, so none to destroy');
  ELSE
    SELECT count(*) INTO v_n FROM theme_contribution_visibility_targets
     WHERE contribution_id = v_c AND node_id = v_team_a;
    IF v_n = 1 THEN v_pass := v_pass+1;
      INSERT INTO _tca_results VALUES (14,'PASS','the audience survived the direct write');
    ELSE v_fail := v_fail+1;
      INSERT INTO _tca_results VALUES (14,'FAIL','the audience was destroyed'); END IF;
  END IF;

  -- ===========================================================================
  -- 15. THE VOCABULARY MOVED.                                    FAILS BEFORE
  --     'org' and 'shared' must now be REJECTED, and 'firm' ACCEPTED. This is
  --     what distinguishes "the fix is applied" from "the old constraint
  --     happened to reject the value my assertion used", and it is the one
  --     thing the frontend cannot ship without -- the deployed bundle writes
  --     'org' on every new contribution.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    INSERT INTO theme_contributions_v2
      (theme_id, section, content, created_by, organization_id, visibility)
    VALUES (v_theme_a, 'zz-vocab-'||v_suffix, 'ZZ VOCAB '||v_suffix,
            v_author, v_org_a, 'org');
    v_msg := v_msg||'''org'' was accepted ';
    DELETE FROM theme_contributions_v2
     WHERE theme_id = v_theme_a AND section = 'zz-vocab-'||v_suffix;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    INSERT INTO theme_contributions_v2
      (theme_id, section, content, created_by, organization_id, visibility)
    VALUES (v_theme_a, 'zz-vocab2-'||v_suffix, 'ZZ VOCAB '||v_suffix,
            v_author, v_org_a, 'firm');
    DELETE FROM theme_contributions_v2
     WHERE theme_id = v_theme_a AND section = 'zz-vocab2-'||v_suffix;
  EXCEPTION WHEN OTHERS THEN v_msg := v_msg||'''firm'' was rejected ';
  END;
  /* The column DEFAULT is part of the vocabulary. It was 'org', which the new
     CHECK rejects, so an INSERT that omits the column would fail with 23514
     on a value nobody typed. */
  BEGIN
    INSERT INTO theme_contributions_v2
      (theme_id, section, content, created_by, organization_id)
    VALUES (v_theme_a, 'zz-vocab3-'||v_suffix, 'ZZ VOCAB '||v_suffix,
            v_author, v_org_a);
    SELECT visibility INTO v_txt FROM theme_contributions_v2
     WHERE theme_id = v_theme_a AND section = 'zz-vocab3-'||v_suffix;
    IF v_txt <> 'firm' THEN
      v_msg := v_msg||format('the default is %s, not firm ', v_txt); END IF;
    DELETE FROM theme_contributions_v2
     WHERE theme_id = v_theme_a AND section = 'zz-vocab3-'||v_suffix;
  EXCEPTION WHEN OTHERS THEN
    v_msg := v_msg||format('an INSERT without visibility raised %s ', SQLSTATE);
  END;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _tca_results VALUES (15,'PASS',
      'the five-level vocabulary is enforced and the default is firm');
  ELSE v_fail := v_fail+1; INSERT INTO _tca_results VALUES (15,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  SET LOCAL request.jwt.claims = '';
  IF v_has_tgt THEN
    DELETE FROM theme_contribution_visibility_targets WHERE contribution_id = v_c;
  END IF;
  DELETE FROM theme_contributions_v2 WHERE theme_id IN (v_theme_a, v_theme_b);
  DELETE FROM themes WHERE id IN (v_theme_a, v_theme_b);
  DELETE FROM org_chart_node_members WHERE node_id IN (v_team_a, v_team_a2, v_team_b);
  DELETE FROM org_chart_nodes        WHERE id      IN (v_team_a, v_team_a2, v_team_b);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL
   WHERE id IN (v_author, v_targeted, v_untarg, v_foreign);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  /* Creating a user seeds default lists and four statuses per list, and
     deleting the user then fires two conflicting referential actions on the
     same row (asset_lists.created_by CASCADE vs list_statuses.created_by SET
     NULL). Children first, scoped to these synthetic users' own lists. See
     contribution-audience-management.sql, which hit this first. */
  DELETE FROM list_statuses
   WHERE list_id IN (SELECT id FROM asset_lists
                      WHERE created_by IN (v_author, v_targeted, v_untarg, v_foreign));
  DELETE FROM asset_lists
   WHERE created_by IN (v_author, v_targeted, v_untarg, v_foreign);
  DELETE FROM auth.users WHERE id IN (v_author, v_targeted, v_untarg, v_foreign);

  RAISE NOTICE '=== RESULTS: % passed, % failed, % skipped out of 15 ===',
    v_pass, v_fail, v_skip;
  RAISE NOTICE 'Before the migrations: 5 and 15 FAIL, 2/4/9/11/12 SKIP. A SKIP is not a pass.';
END $$;

SELECT n, result, detail FROM _tca_results ORDER BY n, result;
