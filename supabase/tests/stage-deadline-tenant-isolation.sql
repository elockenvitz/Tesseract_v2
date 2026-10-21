-- ═══════════════════════════════════════════════════════════════════════════
--  Stage deadlines — tenant isolation across two real organizations
--
--  Regression coverage for scripts/sql/stage-deadlines/10-tenant-policies.sql.
--
--  Every check runs as the `authenticated` role with real
--  `request.jwt.claims`, as two different signed-in users in two different
--  organizations — not as `postgres`, which carries BYPASSRLS and would pass
--  every assertion here against a completely unprotected table.
--
--  ── NON-VACUITY ────────────────────────────────────────────────────────────
--
--  Run this BEFORE applying the migration and expect 6 PASS / 9 FAIL.
--  Assertions 2, 4, 5, 6, 10, 11, 12, 13 and 15 must FAIL: the SELECT policy
--  is USING (true), INSERT checks only that somebody is logged in, and there
--  is no UPDATE or DELETE policy at all. If they pass against an unmigrated
--  database this suite is not testing what it claims.
--
--  Three of the pre-migration passes are VACUOUS and say so in their detail:
--  7, 8 and 9 pass before the migration only because nobody can update or
--  delete anything, which is defect 2 rather than a boundary. They become
--  meaningful afterwards, when the same-org user CAN write and the
--  cross-org user still cannot.
--
--  ── Production safety ──────────────────────────────────────────────────────
--
--    1. Every fixture row is synthetic, prefixed 'ZZ ' with a random suffix,
--       and created here. No existing row is read for anything but a count,
--       and none is modified.
--    2. Cleanup is unconditional, in reverse dependency order, and includes
--       the list_statuses/asset_lists children that user creation seeds.
--    3. One statement to the server, so one transaction: an uncaught error
--       rolls every fixture back.
--    4. Must run as `postgres` — SET ROLE authenticated requires it, and the
--       fixtures are written with RLS bypassed on purpose.
--
--  Verify afterwards:
--    SELECT count(*) FROM organizations WHERE name LIKE 'ZZ SD%';   -- 0
--    SELECT count(*) FROM asset_stage_deadlines;                    -- unchanged
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS _sd_results;
CREATE TEMP TABLE _sd_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_both   uuid := gen_random_uuid();   -- member of BOTH orgs (assertions 12-13)
  v_asset  uuid := gen_random_uuid();   -- assets are global; one serves both
  v_wf_a   uuid := gen_random_uuid();
  v_wf_b   uuid := gen_random_uuid();
  v_dl_a   uuid;                        -- a deadline owned by org A's workflow
  v_claims_a text; v_claims_b text; v_claims_both_a text; v_claims_both_b text;
  v_n     int;
  v_pass  int := 0;
  v_fail  int := 0;
  v_base  int;
BEGIN
  RAISE NOTICE '=== Stage deadline tenant isolation (suffix: %) ===', v_suffix;
  SELECT count(*) INTO v_base FROM asset_stage_deadlines;

  -- ── Fixtures, written as postgres with RLS bypassed ───────────────────────
  INSERT INTO auth.users(id) VALUES (v_user_a), (v_user_b), (v_both);
  INSERT INTO organizations(id, name, slug) VALUES
    (v_org_a, 'ZZ SD A '||v_suffix, 'zz-sd-a-'||v_suffix),
    (v_org_b, 'ZZ SD B '||v_suffix, 'zz-sd-b-'||v_suffix);
  INSERT INTO organization_memberships(organization_id, user_id, status) VALUES
    (v_org_a, v_user_a,'active'), (v_org_b, v_user_b,'active'),
    (v_org_a, v_both,'active'),   (v_org_b, v_both,'active');
  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_user_a, v_both);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  INSERT INTO assets(id, symbol, company_name)
  VALUES (v_asset, 'ZZS'||v_suffix, 'ZZ Stage Deadline Co '||v_suffix);

  -- is_public so the workflows SELECT policy admits each org's own member:
  -- the deadline predicate reads through it, so an invisible workflow would
  -- make its deadlines invisible too and confuse a real finding with fixture
  -- misconfiguration.
  INSERT INTO workflows(id, name, organization_id, created_by, is_public) VALUES
    (v_wf_a, 'ZZ SD WF A '||v_suffix, v_org_a, v_user_a, true),
    (v_wf_b, 'ZZ SD WF B '||v_suffix, v_org_b, v_user_b, true);

  INSERT INTO asset_stage_deadlines(asset_id, workflow_id, stage_id, deadline_date, set_by)
  VALUES (v_asset, v_wf_a, 'research', current_date + 7, v_user_a)
  RETURNING id INTO v_dl_a;

  v_claims_a      := json_build_object('sub', v_user_a, 'role','authenticated')::text;
  v_claims_b      := json_build_object('sub', v_user_b, 'role','authenticated')::text;
  v_claims_both_a := json_build_object('sub', v_both,   'role','authenticated')::text;
  v_claims_both_b := v_claims_both_a;  -- same person; the ORG is switched below

  -- ═══════════════════════════════════════════════════════════════ SELECT ══
  -- 1. The owning organization reads its own deadline.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_a);
    SET ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_stage_deadlines WHERE id = v_dl_a;
    RESET ROLE;
    IF v_n = 1 THEN
      INSERT INTO _sd_results VALUES (1,'PASS','org A reads its own deadline');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _sd_results VALUES (1,'FAIL','org A cannot read its own deadline — the boundary is too tight');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (1,'FAIL','raised '||SQLSTATE||': '||SQLERRM);
    v_fail := v_fail+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- 2. The other organization cannot. THE headline assertion.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_b);
    SET ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_stage_deadlines WHERE id = v_dl_a;
    RESET ROLE;
    IF v_n = 0 THEN
      INSERT INTO _sd_results VALUES (2,'PASS','org B cannot read org A''s deadline');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _sd_results VALUES (2,'FAIL','org B READ org A''s deadline ('||v_n||' row)');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (2,'FAIL','raised '||SQLSTATE||': '||SQLERRM);
    v_fail := v_fail+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- ═══════════════════════════════════════════════════════════════ INSERT ══
  -- 3. A member writes a deadline onto their own organization's workflow.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_a);
    SET ROLE authenticated;
    INSERT INTO asset_stage_deadlines(asset_id, workflow_id, stage_id, deadline_date, set_by)
    VALUES (v_asset, v_wf_a, 'analysis', current_date + 14, v_user_a);
    RESET ROLE;
    INSERT INTO _sd_results VALUES (3,'PASS','org A writes onto its own workflow');
    v_pass := v_pass+1;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (3,'FAIL','legitimate insert refused: '||SQLSTATE||' '||SQLERRM);
    v_fail := v_fail+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- 4. A non-member cannot write onto another organization's workflow.
  --    This is the question "does INSERT also need workflow-derived validation".
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_b);
    SET ROLE authenticated;
    INSERT INTO asset_stage_deadlines(asset_id, workflow_id, stage_id, deadline_date, set_by)
    VALUES (v_asset, v_wf_a, 'zz-intruder', current_date + 21, v_user_b);
    RESET ROLE;
    INSERT INTO _sd_results VALUES (4,'FAIL','org B WROTE a deadline onto org A''s workflow');
    v_fail := v_fail+1;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (4,'PASS','org B refused on org A''s workflow ('||SQLSTATE||')');
    v_pass := v_pass+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- 5. Attribution cannot be forged: a member may insert, but not sign the row
  --    with another user's id.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_a);
    SET ROLE authenticated;
    INSERT INTO asset_stage_deadlines(asset_id, workflow_id, stage_id, deadline_date, set_by)
    VALUES (v_asset, v_wf_a, 'zz-forged', current_date + 28, v_user_b);
    RESET ROLE;
    INSERT INTO _sd_results VALUES (5,'FAIL','a deadline was stamped with another user''s id');
    v_fail := v_fail+1;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (5,'PASS','forged set_by refused ('||SQLSTATE||')');
    v_pass := v_pass+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- ═══════════════════════════════════════════════════════════════ UPDATE ══
  -- 6. The owner can edit. Before the migration there is no UPDATE policy at
  --    all, so this fails — a deadline is write-once.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_a);
    SET ROLE authenticated;
    UPDATE asset_stage_deadlines SET deadline_date = current_date + 30
     WHERE id = v_dl_a;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    IF v_n = 1 THEN
      INSERT INTO _sd_results VALUES (6,'PASS','org A edits its own deadline');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _sd_results VALUES (6,'FAIL','org A could not edit its own deadline ('||v_n||' rows) — no UPDATE policy');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (6,'FAIL','raised '||SQLSTATE||': '||SQLERRM);
    v_fail := v_fail+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- 7. The other organization cannot edit it. VACUOUS before the migration.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_b);
    SET ROLE authenticated;
    UPDATE asset_stage_deadlines SET deadline_date = current_date + 999
     WHERE id = v_dl_a;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    IF v_n = 0 THEN
      INSERT INTO _sd_results VALUES (7,'PASS','org B changed nothing (vacuous until 6 passes)');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _sd_results VALUES (7,'FAIL','org B EDITED org A''s deadline');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (7,'PASS','org B refused ('||SQLSTATE||')');
    v_pass := v_pass+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- 8. A row cannot be MOVED out of its organization. This is what the
  --    UPDATE policy's WITH CHECK half exists for — USING alone would permit
  --    reading your own row and rewriting its workflow_id to another org's.
  --    VACUOUS before the migration.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_a);
    SET ROLE authenticated;
    UPDATE asset_stage_deadlines SET workflow_id = v_wf_b WHERE id = v_dl_a;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    IF v_n = 0 THEN
      INSERT INTO _sd_results VALUES (8,'PASS','the row could not be moved to org B''s workflow (vacuous until 6 passes)');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _sd_results VALUES (8,'FAIL','a deadline was MOVED into another organization');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (8,'PASS','the move was refused ('||SQLSTATE||')');
    v_pass := v_pass+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- ═══════════════════════════════════════════════════════════════ DELETE ══
  -- 9. The other organization cannot delete it. VACUOUS before the migration.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_b);
    SET ROLE authenticated;
    DELETE FROM asset_stage_deadlines WHERE id = v_dl_a;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    IF v_n = 0 THEN
      INSERT INTO _sd_results VALUES (9,'PASS','org B deleted nothing (vacuous until 10 passes)');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _sd_results VALUES (9,'FAIL','org B DELETED org A''s deadline');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (9,'PASS','org B refused ('||SQLSTATE||')');
    v_pass := v_pass+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- 10. The owner can delete. Fails before the migration — no DELETE policy,
  --     so the UI's "remove deadline" silently removes nothing.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_a);
    SET ROLE authenticated;
    DELETE FROM asset_stage_deadlines WHERE id = v_dl_a;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    IF v_n = 1 THEN
      INSERT INTO _sd_results VALUES (10,'PASS','org A deletes its own deadline');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _sd_results VALUES (10,'FAIL','org A''s delete removed '||v_n||' rows — no DELETE policy');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (10,'FAIL','raised '||SQLSTATE||': '||SQLERRM);
    v_fail := v_fail+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- 11. A sweep, not a lookup: org B listing every deadline on the shared
  --     asset must see only its own organization's.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_b);
    SET ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_stage_deadlines WHERE asset_id = v_asset;
    RESET ROLE;
    IF v_n = 0 THEN
      INSERT INTO _sd_results VALUES (11,'PASS','org B sees none of org A''s deadlines on a shared asset');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _sd_results VALUES (11,'FAIL','org B listed '||v_n||' of org A''s deadlines');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (11,'FAIL','raised '||SQLSTATE||': '||SQLERRM);
    v_fail := v_fail+1;
  END;
  SET LOCAL request.jwt.claims = '';

  -- ══════════════════ the superseded unique constraints ═══════════════════
  -- 12. ONE user, ONE asset, TWO organizations — two priorities must coexist.
  --     Before the drop the narrow UNIQUE (asset_id, user_id) raises 23505 on
  --     the second organization.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_both_a);
    SET ROLE authenticated;
    INSERT INTO user_asset_priorities(organization_id, asset_id, user_id, priority)
    VALUES (v_org_a, v_asset, v_both, 'high');
    RESET ROLE;
    -- the SAME person, now acting in their OTHER organization
    UPDATE users SET current_organization_id = v_org_b WHERE id = v_both;
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_both_b);
    SET ROLE authenticated;
    INSERT INTO user_asset_priorities(organization_id, asset_id, user_id, priority)
    VALUES (v_org_b, v_asset, v_both, 'low');
    RESET ROLE;
    INSERT INTO _sd_results VALUES (12,'PASS','one user holds the same asset at two priorities in two orgs');
    v_pass := v_pass+1;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (12,'FAIL','second org refused ('||SQLSTATE||'): '||SQLERRM);
    v_fail := v_fail+1;
  END;
  SET LOCAL request.jwt.claims = '';
  UPDATE users SET current_organization_id = v_org_a WHERE id = v_both;

  -- 13. The same for widgets, where the narrow key also carries the title.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_both_a);
    SET ROLE authenticated;
    INSERT INTO user_asset_widgets(organization_id, user_id, asset_id, widget_type, title)
    VALUES (v_org_a, v_both, v_asset, 'rich_text', 'ZZ Notes '||v_suffix);
    RESET ROLE;
    UPDATE users SET current_organization_id = v_org_b WHERE id = v_both;
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims_both_b);
    SET ROLE authenticated;
    INSERT INTO user_asset_widgets(organization_id, user_id, asset_id, widget_type, title)
    VALUES (v_org_b, v_both, v_asset, 'rich_text', 'ZZ Notes '||v_suffix);
    RESET ROLE;
    INSERT INTO _sd_results VALUES (13,'PASS','the same widget title exists in both orgs for one user');
    v_pass := v_pass+1;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sd_results VALUES (13,'FAIL','second org refused ('||SQLSTATE||'): '||SQLERRM);
    v_fail := v_fail+1;
  END;
  SET LOCAL request.jwt.claims = '';
  UPDATE users SET current_organization_id = v_org_a WHERE id = v_both;

  -- 14. The replacements survived. Dropping BOTH keys would leave these tables
  --     with no uniqueness at all, which is the way this migration could go
  --     wrong quietly.
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conname IN ('user_asset_priorities_org_asset_user_key',
                     'user_asset_widgets_org_user_asset_title_key');
  IF v_n = 2 THEN
    INSERT INTO _sd_results VALUES (14,'PASS','both org-composite unique keys are intact');
    v_pass := v_pass+1;
  ELSE
    INSERT INTO _sd_results VALUES (14,'FAIL','only '||v_n||' of 2 org-composite keys remain');
    v_fail := v_fail+1;
  END IF;

  -- 15. No unconditional policy survives on the deadline table.
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid = 'public.asset_stage_deadlines'::regclass
     AND coalesce(pg_get_expr(polqual, polrelid), '') = 'true';
  IF v_n = 0 THEN
    INSERT INTO _sd_results VALUES (15,'PASS','no USING (true) policy on asset_stage_deadlines');
    v_pass := v_pass+1;
  ELSE
    INSERT INTO _sd_results VALUES (15,'FAIL',v_n||' unconditional policy/policies remain');
    v_fail := v_fail+1;
  END IF;

  -- ═══════════════════════════════════════════════════════════════ CLEANUP ══
  SET LOCAL request.jwt.claims = '';
  DELETE FROM user_asset_widgets WHERE user_id IN (v_user_a, v_user_b, v_both);
  DELETE FROM user_asset_priorities WHERE user_id IN (v_user_a, v_user_b, v_both);
  DELETE FROM asset_stage_deadlines WHERE asset_id = v_asset;
  DELETE FROM workflows WHERE id IN (v_wf_a, v_wf_b);
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL
   WHERE id IN (v_user_a, v_user_b, v_both);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  -- User creation seeds default lists and four statuses per list; the two
  -- referential actions on the same row conflict unless the children go first.
  DELETE FROM list_statuses
   WHERE list_id IN (SELECT id FROM asset_lists
                      WHERE created_by IN (v_user_a, v_user_b, v_both));
  DELETE FROM asset_lists WHERE created_by IN (v_user_a, v_user_b, v_both);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b, v_both);

  SELECT count(*) INTO v_n FROM asset_stage_deadlines;
  IF v_n <> v_base THEN
    RAISE WARNING 'CLEANUP INCOMPLETE: deadlines %, expected %', v_n, v_base;
  END IF;

  RAISE NOTICE '=== RESULTS: % passed, % failed out of 15 ===', v_pass, v_fail;
  RAISE NOTICE 'AFTER the migration: expect 15 passed, 0 failed.';
  RAISE NOTICE 'BEFORE it: expect 6 passed (1,3,7,8,9,14) and 9 failed (2,4,5,6,10,11,12,13,15).';
  RAISE NOTICE '7, 8 and 9 pass beforehand only because nothing can be updated or deleted at all.';
END $$;

SELECT n, result, detail FROM _sd_results ORDER BY n;
