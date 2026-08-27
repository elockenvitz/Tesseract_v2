-- =============================================================================
-- P0 Phase 5C — application write-path smoke harness
--
-- Runs the exact database write each documented smoke flow performs (14 from
-- Step 11 of the staging plan, plus logout/login after an org switch = 15),
-- as the `authenticated` role with a forged JWT claim — the same way PostgREST
-- presents a browser request. The failure mode this change can introduce is
-- `permission denied for column`, and that manifests here identically to how it
-- would in the app, minus the React layer.
--
-- Column sets are taken from KNOWN_WRITE_SITES in
-- src/lib/security/__tests__/users-authority-columns.test.ts, so what is
-- exercised is what the application actually writes.
--
-- Synthetic fixtures only. The single real staging user is never touched.
-- Everything lives in one DO block: on success the cleanup at the end commits,
-- on failure the RAISE rolls the whole block back. Clean either way.
-- =============================================================================

DO $$
DECLARE
  SA uuid; SB uuid; SC uuid;                      -- orgs
  U_ADMIN uuid := gen_random_uuid();
  U_MEMBER uuid := gen_random_uuid();
  U_TARGET uuid := gen_random_uuid();
  U_ERASE  uuid := gen_random_uuid();
  U_INVITE uuid := gen_random_uuid();
  sfx text := substr(md5(random()::text),1,8);
  inv_email text;
  cl_admin text; cl_member text; cl_target text; cl_invite text;
  v_got uuid; v_cnt int; v_state text; v_pass int := 0; v_fail int := 0;
  v_token uuid;

BEGIN
  inv_email := 'smoke_invitee_'||sfx||'@firm.test';

  -- ── fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO organizations (name,slug) VALUES ('Smoke A '||sfx,'smoke-a-'||sfx) RETURNING id INTO SA;
  INSERT INTO organizations (name,slug) VALUES ('Smoke B '||sfx,'smoke-b-'||sfx) RETURNING id INTO SB;
  INSERT INTO organizations (name,slug) VALUES ('Smoke C '||sfx,'smoke-c-'||sfx) RETURNING id INTO SC;

  -- email_confirmed_at is set because every real identity has it: Supabase
  -- stamps it at signup while mailer_autoconfirm is on. Invitation acceptance
  -- checks it, so a fixture without it is a user that cannot exist.
  INSERT INTO auth.users (id,email,email_confirmed_at,raw_user_meta_data,role,aud,instance_id) VALUES
    (U_ADMIN ,'smoke_admin_'||sfx||'@firm.test' ,now(),'{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (U_MEMBER,'smoke_member_'||sfx||'@firm.test',now(),'{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (U_TARGET,'smoke_target_'||sfx||'@firm.test',now(),'{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (U_ERASE ,'smoke_erase_'||sfx||'@firm.test' ,now(),'{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (U_INVITE, inv_email                        ,now(),'{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id,user_id,is_org_admin,status) VALUES
    (SA,U_ADMIN ,true ,'active'),
    (SA,U_MEMBER,false,'active'),
    (SB,U_MEMBER,false,'active'),
    (SC,U_TARGET,false,'active'),
    (SA,U_ERASE ,false,'active');

  UPDATE users SET current_organization_id=SA WHERE id IN (U_ADMIN,U_MEMBER,U_ERASE);
  UPDATE users SET current_organization_id=SC WHERE id=U_TARGET;

  cl_admin  := json_build_object('sub',U_ADMIN ,'role','authenticated')::text;
  cl_member := json_build_object('sub',U_MEMBER,'role','authenticated')::text;
  cl_target := json_build_object('sub',U_TARGET,'role','authenticated')::text;
  cl_invite := json_build_object('sub',U_INVITE,'role','authenticated')::text;

  RAISE NOTICE '=== Phase 5C application write-path smoke (suffix %) ===', sfx;

  -- ── 1. signup / bootstrap : INSERT users(id,email,first_name,last_name) ────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invite);
    SET LOCAL ROLE authenticated;
    INSERT INTO users (id,email,first_name,last_name)
      VALUES (U_INVITE, inv_email, 'Smoke','Invitee')
      ON CONFLICT (id) DO NOTHING;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  IF v_state='ok' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [1]  signup / profile bootstrap INSERT';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [1]  signup bootstrap — %', v_state; END IF;

  -- ── 2. first / last name edit ─────────────────────────────────────────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_member);
    SET LOCAL ROLE authenticated;
    UPDATE users SET first_name='Smoke', last_name='Member' WHERE id=U_MEMBER;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  IF v_state='ok' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [2]  profile first/last name edit';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [2]  name edit — %', v_state; END IF;

  -- ── 3. timezone edit (SettingsPage) ───────────────────────────────────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_member);
    SET LOCAL ROLE authenticated;
    UPDATE users SET timezone='Europe/London' WHERE id=U_MEMBER;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  IF v_state='ok' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [3]  timezone edit';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [3]  timezone edit — %', v_state; END IF;

  -- ── 4. user_type / onboarding (SetupWizard) ───────────────────────────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_member);
    SET LOCAL ROLE authenticated;
    UPDATE users SET user_type='Investor' WHERE id=U_MEMBER;   -- users_user_type_check: Operations|Compliance|Investor
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  IF v_state='ok' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [4]  user_type / onboarding write';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [4]  user_type — %', v_state; END IF;

  -- ── 5. pilot_progress + email sync (usePilotProgress / useAuth) ───────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_member);
    SET LOCAL ROLE authenticated;
    UPDATE users SET pilot_progress='{"step":2}'::jsonb WHERE id=U_MEMBER;
    UPDATE users SET email='smoke_member_'||sfx||'@firm.test' WHERE id=U_MEMBER;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  IF v_state='ok' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [5]  pilot_progress write + email sync';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [5]  pilot_progress/email — %', v_state; END IF;

  -- ── 6. ordinary authenticated app load ────────────────────────────────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_member);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_cnt FROM users WHERE id=U_MEMBER;
    PERFORM count(*) FROM organizations;
    PERFORM count(*) FROM organization_memberships;
    PERFORM count(*) FROM portfolios;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  IF v_state='ok' AND v_cnt=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [6]  ordinary app load reads own profile + org tables';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [6]  app load — % (own profile rows=%)', v_state, v_cnt; END IF;

  -- ── 7. legitimate organization switching ──────────────────────────────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_member);
    SET LOCAL ROLE authenticated;
    PERFORM set_current_org(SA);
    SELECT current_org_id() INTO v_got;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; v_got:=NULL; END;
  IF v_got=SA THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [7]  legitimate org switch (set_current_org -> current_org_id)';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [7]  org switch — % got %', v_state, v_got; END IF;

  -- ── 8. multi-org switching among active memberships ───────────────────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_member);
    SET LOCAL ROLE authenticated;
    PERFORM set_current_org(SB);
    SELECT current_org_id() INTO v_got;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; v_got:=NULL; END;
  IF v_got=SB THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [8]  multi-org switch A -> B';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [8]  multi-org switch — % got %', v_state, v_got; END IF;

  -- ── 9. org-admin coverage_admin update flow (OrganizationPage) ────────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_admin);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin=true WHERE id=U_MEMBER;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM users WHERE id=U_MEMBER AND coverage_admin;
  IF v_state='ok' AND v_cnt=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [9]  org-admin coverage_admin update';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [9]  coverage_admin admin flow — % (applied=%)', v_state, v_cnt; END IF;
  UPDATE users SET coverage_admin=false WHERE id=U_MEMBER;

  -- ── 10. invitation acceptance (accept_org_invite from /invite/:token) ─────
  --
  -- This flow used to call auto_accept_pending_invites(), which joined anyone
  -- whose auth.users.email matched a pending invitation -- no token, no proof
  -- of mailbox control. That function is retired to a no-op, so the flow now
  -- runs what the application actually runs: the recipient opens their
  -- invitation link and accepts with the token.
  INSERT INTO organization_invites (organization_id,email,invited_by,status)
    VALUES (SC, inv_email, U_ADMIN, 'pending') RETURNING token INTO v_token;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invite);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(v_token);
    SELECT current_org_id() INTO v_got;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; v_got:=NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
    WHERE user_id=U_INVITE AND organization_id=SC AND status='active';
  IF v_state='ok' AND v_cnt=1 AND v_got=SC THEN
    v_pass:=v_pass+1; RAISE NOTICE 'PASS  [10] invitation acceptance -> membership + current org';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [10] invite acceptance — % (membership=%, org=%)', v_state, v_cnt, v_got; END IF;

  -- ── 11. platform-admin morph switch ───────────────────────────────────────
  INSERT INTO platform_admins (user_id) VALUES (U_ADMIN);
  INSERT INTO morph_sessions (admin_user_id,target_user_id,target_org_id,reason,expires_at,is_active)
    VALUES (U_ADMIN,U_TARGET,SC,'phase 5c smoke', now()+interval '1 hour', true);
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_admin);
    SET LOCAL ROLE authenticated;
    PERFORM morph_switch_org(SC);
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  SELECT current_organization_id INTO v_got FROM users WHERE id=U_ADMIN;
  IF v_state='ok' AND v_got=SC THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [11] platform-admin morph switch into target org';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [11] morph switch — % (pointer=%)', v_state, v_got; END IF;

  -- ── 12. platform-admin morph restore ──────────────────────────────────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_admin);
    SET LOCAL ROLE authenticated;
    PERFORM morph_restore_org(SA);
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  SELECT current_organization_id INTO v_got FROM users WHERE id=U_ADMIN;
  IF v_state='ok' AND v_got=SA THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [12] platform-admin morph restore';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [12] morph restore — % (pointer=%)', v_state, v_got; END IF;

  -- ── 13. offboarding: deactivate, then load as the deactivated user ────────
  UPDATE users SET current_organization_id=SB WHERE id=U_MEMBER;
  UPDATE organization_memberships SET status='inactive' WHERE user_id=U_MEMBER AND organization_id=SB;
  UPDATE users SET current_organization_id=SB WHERE id=U_MEMBER;   -- stale pointer restored on purpose
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_member);
    SET LOCAL ROLE authenticated;
    SELECT current_org_id() INTO v_got;
    -- The tenant claim is that they see no OTHER member of the org they left.
    -- Their own membership row stays readable via `Users can read own
    -- memberships` (user_id = auth.uid(), no org predicate) — intentional, the
    -- app needs it to render the no-active-organisation state.
    SELECT count(*) INTO v_cnt FROM organization_memberships
      WHERE organization_id=SB AND user_id <> U_MEMBER;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; v_got:=SB; v_cnt:=-1; END;
  IF v_got IS NULL AND v_cnt=0 THEN
    v_pass:=v_pass+1; RAISE NOTICE 'PASS  [13] offboarded user resolves NULL org and sees no tenant rows';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [13] offboarding — % (org=%, rows=%)', v_state, v_got, v_cnt; END IF;

  -- ── 14. erase-user flow (org admin erases a member of a shared org) ───────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_admin);
    SET LOCAL ROLE authenticated;
    PERFORM erase_user_personal_data(U_ERASE);
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM users WHERE id=U_ERASE AND current_organization_id IS NULL;
  IF v_state='ok' AND v_cnt=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [14] erase_user_personal_data (org pointer cleared)';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [14] erase user — % (cleared=%)', v_state, v_cnt; END IF;

  -- ── 15. logout / login after an org switch (fresh claim context) ──────────
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_target);
    SET LOCAL ROLE authenticated;
    PERFORM set_current_org(SC);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_target);  -- new session
    SET LOCAL ROLE authenticated;
    SELECT current_org_id() INTO v_got;
    RESET ROLE; v_state:='ok';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state:='ERR '||SQLSTATE||' '||SQLERRM; v_got:=NULL; END;
  IF v_got=SC THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS  [15] logout/login after org switch retains the org';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL  [15] relogin — % got %', v_state, v_got; END IF;

  -- ── cleanup ───────────────────────────────────────────────────────────────
  DELETE FROM organization_invites WHERE organization_id IN (SA,SB,SC);
  DELETE FROM morph_sessions WHERE admin_user_id=U_ADMIN;
  DELETE FROM platform_admins WHERE user_id=U_ADMIN;
  DELETE FROM organization_memberships WHERE organization_id IN (SA,SB,SC);
  DELETE FROM organization_audit_log WHERE organization_id IN (SA,SB,SC);
  DELETE FROM auth.users WHERE id IN (U_ADMIN,U_MEMBER,U_TARGET,U_ERASE,U_INVITE);
  DELETE FROM organizations WHERE id IN (SA,SB,SC);

  RAISE NOTICE '';
  RAISE NOTICE '=== SMOKE RESULTS: % passed, % failed of 15 flows ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'PHASE 5C SMOKE FAILED: % flow(s) failed', v_fail;
  END IF;
END;
$$;
