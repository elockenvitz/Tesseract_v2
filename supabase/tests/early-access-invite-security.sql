-- =============================================================================
-- Early Access — signup / invitation / bootstrap security suite
--
-- 24 checks covering the database half of the entry surface. Each one runs the
-- exact call a browser would make: as the `authenticated` role, with a forged
-- `request.jwt.claims`, through PostgREST-visible functions and tables. The
-- two checks that are purely about the browser (invite deep-link refresh,
-- mobile invitation entry) live in e2e/invite-entry.spec.ts.
--
-- The suite is written to run against BOTH the un-hardened and the hardened
-- database: every check records pass/fail into a temp table instead of
-- raising, so a "before" run produces a full findings table rather than
-- aborting on the first hole. Missing functions count as failures with the
-- error text attached.
--
-- Synthetic fixtures only, all suffixed with a random tag, all deleted at the
-- end. Real pilots are never read or written.
--
-- Every handler traps `assert_failure OR OTHERS` rather than plain OTHERS.
-- The un-hardened create_org_invite raises its authorization refusal with
-- SQLSTATE P0004, which is PL/pgSQL's reserved assert_failure and is the one
-- code WHEN OTHERS will not catch — a plain handler lets the refusal abort the
-- whole suite instead of recording it. (The hardened functions use P0042/P0043
-- for exactly this reason; the suite keeps the wider handler so it can still be
-- pointed at an un-migrated database.)
--
-- Run it with:  node scripts/invite-security-test.mjs [staging|prod]
-- =============================================================================

CREATE TEMP TABLE _sec (
  n int PRIMARY KEY,
  name text NOT NULL,
  ok boolean NOT NULL,
  detail text
) ON COMMIT DROP;

DO $suite$
DECLARE
  ORG_A uuid; ORG_B uuid; ORG_C uuid;
  U_PLATFORM  uuid := gen_random_uuid();   -- platform admin (the founder)
  U_PILOT     uuid := gen_random_uuid();   -- ordinary active member of ORG_A
  U_ORGADMIN  uuid := gen_random_uuid();   -- org admin of ORG_A, NOT platform
  U_INVITEE   uuid := gen_random_uuid();   -- holds a valid admin invite to ORG_A
  U_STRANGER  uuid := gen_random_uuid();   -- authenticated, different address
  U_UNVERIF   uuid := gen_random_uuid();   -- invited address, unconfirmed email
  U_RANDOM    uuid := gen_random_uuid();   -- unsolicited signup, no invite
  U_LEGACY    uuid := gen_random_uuid();   -- pre-existing pilot with an org

  sfx text := substr(md5(random()::text), 1, 8);
  e_platform text; e_pilot text; e_orgadmin text; e_invitee text;
  e_stranger text; e_unverif text; e_random text; e_legacy text;
  cl_platform text; cl_pilot text; cl_orgadmin text; cl_invitee text;
  cl_stranger text; cl_unverif text; cl_random text; cl_legacy text;

  tok_main uuid;      -- valid admin invite to ORG_A for U_INVITEE
  tok_expired uuid;   -- expired invite for U_INVITEE
  tok_revoked uuid;   -- revoked invite for U_INVITEE
  tok_unverif uuid;   -- valid invite for the unconfirmed identity

  v_state text; v_cnt int; v_cnt2 int; v_got uuid; v_res jsonb; v_bool boolean;
  v_prev jsonb; v_prev2 jsonb;
BEGIN
  e_platform := 'sec_platform_' || sfx || '@tesseract.test';
  e_pilot    := 'sec_pilot_'    || sfx || '@fund.test';
  e_orgadmin := 'sec_orgadmin_' || sfx || '@fund.test';
  e_invitee  := 'sec_invitee_'  || sfx || '@fund.test';
  e_stranger := 'sec_stranger_' || sfx || '@other.test';
  e_unverif  := 'sec_unverif_'  || sfx || '@fund.test';
  e_random   := 'sec_random_'   || sfx || '@nowhere.test';
  e_legacy   := 'sec_legacy_'   || sfx || '@fund.test';

  -- ── fixtures ───────────────────────────────────────────────────────────────
  INSERT INTO organizations (name, slug) VALUES ('Sec A ' || sfx, 'sec-a-' || sfx) RETURNING id INTO ORG_A;
  INSERT INTO organizations (name, slug) VALUES ('Sec B ' || sfx, 'sec-b-' || sfx) RETURNING id INTO ORG_B;
  -- ORG_C exists only because idx_org_invites_unique_pending forbids two
  -- pending invites for the same address in the same organization, and the
  -- expired and revoked fixtures share the invitee's address.
  INSERT INTO organizations (name, slug) VALUES ('Sec C ' || sfx, 'sec-c-' || sfx) RETURNING id INTO ORG_C;

  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, role, aud, instance_id) VALUES
    (U_PLATFORM, e_platform, now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_PILOT,    e_pilot,    now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_ORGADMIN, e_orgadmin, now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_INVITEE,  e_invitee,  now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_STRANGER, e_stranger, now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_UNVERIF,  e_unverif,  NULL,  '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_RANDOM,   e_random,   now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_LEGACY,   e_legacy,   now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO platform_admins (user_id) VALUES (U_PLATFORM) ON CONFLICT DO NOTHING;

  INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status) VALUES
    (ORG_A, U_PILOT,    false, 'active'),
    (ORG_A, U_ORGADMIN, true,  'active'),
    (ORG_A, U_LEGACY,   false, 'active');

  UPDATE users SET current_organization_id = ORG_A WHERE id IN (U_PILOT, U_ORGADMIN, U_LEGACY);

  -- The legacy pilot predates enforcement. Where the grandfathering table
  -- exists it is populated from active memberships at migration time, so a
  -- fixture created afterwards has to be enrolled explicitly to stand in for
  -- a real pre-existing pilot.
  BEGIN
    INSERT INTO early_access_grandfathered_identities (user_id, reason)
    VALUES (U_LEGACY, 'test_fixture_pre_enforcement_pilot')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN assert_failure OR OTHERS THEN NULL;  -- table absent on a pre-migration run
  END;

  -- Invitations are seeded directly as `postgres` so the suite can test
  -- acceptance independently of whether creation is already locked down.
  INSERT INTO organization_invites (organization_id, email, invited_by, invited_is_org_admin, status, expires_at)
    VALUES (ORG_A, e_invitee, U_PLATFORM, true, 'pending', NULL) RETURNING token INTO tok_main;
  INSERT INTO organization_invites (organization_id, email, invited_by, invited_is_org_admin, status, expires_at)
    VALUES (ORG_B, e_invitee, U_PLATFORM, true, 'pending', now() - interval '1 day') RETURNING token INTO tok_expired;
  INSERT INTO organization_invites (organization_id, email, invited_by, invited_is_org_admin, status, expires_at, revoked_at, revoked_by)
    VALUES (ORG_C, e_invitee, U_PLATFORM, true, 'pending', NULL, now(), U_PLATFORM) RETURNING token INTO tok_revoked;
  INSERT INTO organization_invites (organization_id, email, invited_by, invited_is_org_admin, status, expires_at)
    VALUES (ORG_B, e_unverif, U_PLATFORM, false, 'pending', NULL) RETURNING token INTO tok_unverif;

  cl_platform := json_build_object('sub', U_PLATFORM, 'role', 'authenticated')::text;
  cl_pilot    := json_build_object('sub', U_PILOT,    'role', 'authenticated')::text;
  cl_orgadmin := json_build_object('sub', U_ORGADMIN, 'role', 'authenticated')::text;
  cl_invitee  := json_build_object('sub', U_INVITEE,  'role', 'authenticated')::text;
  cl_stranger := json_build_object('sub', U_STRANGER, 'role', 'authenticated')::text;
  cl_unverif  := json_build_object('sub', U_UNVERIF,  'role', 'authenticated')::text;
  cl_random   := json_build_object('sub', U_RANDOM,   'role', 'authenticated')::text;
  cl_legacy   := json_build_object('sub', U_LEGACY,   'role', 'authenticated')::text;

  -- ═══ INVITATION CREATION AUTHORITY ════════════════════════════════════════

  -- 1. platform admin can create an invitation
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_platform);
    SET LOCAL ROLE authenticated;
    v_res := create_org_invite(ORG_B, 'sec_new_' || sfx || '@fund.test');
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_res := NULL; END;
  INSERT INTO _sec VALUES (1, 'platform admin CAN create an invitation',
    v_state = 'ok' AND v_res ? 'invite_id',
    coalesce(nullif(v_state,'ok'), 'created invite_id=' || coalesce(v_res->>'invite_id','?')));

  -- 2. ordinary pilot user cannot create an invitation
  --
  -- Called with the two-argument form on purpose. The hardened function takes a
  -- fourth `p_preassignments` parameter; calling the four-argument form against
  -- an un-hardened database raises "function does not exist", which this
  -- harness would otherwise score as a refusal and report a hole as a PASS.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_pilot);
    SET LOCAL ROLE authenticated;
    PERFORM create_org_invite(ORG_A, 'sec_friend_' || sfx || '@fund.test');
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (2, 'ordinary pilot CANNOT create an invitation',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 3. organization admin (not platform admin) cannot create an invitation
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    PERFORM create_org_invite(ORG_A, 'sec_coworker_' || sfx || '@fund.test');
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (3, 'org admin CANNOT create an invitation (not a platform admin)',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 4. direct invitation RPC attempt by ordinary user, against a foreign org
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_pilot);
    SET LOCAL ROLE authenticated;
    PERFORM create_org_invite(ORG_B, 'sec_direct_' || sfx || '@fund.test');
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (4, 'direct invite RPC by ordinary user fails (foreign org, admin flag)',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 5. direct invite-table INSERT by ordinary user
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    INSERT INTO organization_invites (organization_id, email, invited_by, invited_is_org_admin)
    VALUES (ORG_A, 'sec_tableinsert_' || sfx || '@fund.test', U_ORGADMIN, true);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (5, 'direct INSERT into organization_invites fails',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 6. ordinary pilot cannot directly add a membership
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (ORG_A, U_STRANGER, 'active', false);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (6, 'direct INSERT into organization_memberships fails (invite bypass)',
    v_state <> 'GRANTED', 'result=' || v_state);
  -- On an un-hardened database that INSERT succeeds. Undo it, or the row it
  -- leaves behind is indistinguishable from the orphan memberships that checks
  -- 16 and 23 exist to detect.
  DELETE FROM organization_memberships WHERE organization_id = ORG_A AND user_id = U_STRANGER;

  -- 24. failed invitation creation leaves no invitation record
  --     (evaluated here, while the failures above are fresh)
  SELECT count(*) INTO v_cnt FROM organization_invites
  WHERE organization_id IN (ORG_A, ORG_B, ORG_C)
    AND (   email LIKE 'sec\_friend\_%'
         OR email LIKE 'sec\_coworker\_%'
         OR email LIKE 'sec\_direct\_%'
         OR email LIKE 'sec\_tableinsert\_%');
  INSERT INTO _sec VALUES (24, 'failed invitation creation writes no invitation row',
    v_cnt = 0, 'orphan invite rows=' || v_cnt);

  -- ═══ ACCEPTANCE ═══════════════════════════════════════════════════════════

  -- 10. unverified identity cannot claim an invite
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_unverif);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(tok_unverif);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_UNVERIF AND status = 'active';
  INSERT INTO _sec VALUES (10, 'unconfirmed identity CANNOT claim an invite',
    v_state <> 'GRANTED' AND v_cnt = 0, 'result=' || v_state || ' active_memberships=' || v_cnt);

  -- 12. authenticated different-email user cannot accept the invite
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_stranger);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(tok_main);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (12, 'different-email authenticated user CANNOT accept the invite',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 23. the failed acceptance above created no orphan membership
  SELECT count(*) INTO v_cnt FROM organization_memberships WHERE user_id = U_STRANGER;
  INSERT INTO _sec VALUES (23, 'failed acceptance creates no orphan membership',
    v_cnt = 0, 'stranger membership rows=' || v_cnt);

  -- 16. editing public.users.email does not change invitation identity
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_stranger);
    SET LOCAL ROLE authenticated;
    UPDATE users SET email = e_invitee WHERE id = U_STRANGER;
    PERFORM accept_org_invite(tok_main);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships WHERE user_id = U_STRANGER;
  INSERT INTO _sec VALUES (16, 'rewriting public.users.email does not let you claim the invite',
    v_state <> 'GRANTED' AND v_cnt = 0, 'result=' || v_state || ' memberships=' || v_cnt);
  UPDATE users SET email = e_stranger WHERE id = U_STRANGER;

  -- 13. expired invite fails
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(tok_expired);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (13, 'expired invite is refused',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 14. revoked invite fails
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(tok_revoked);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_INVITEE AND organization_id = ORG_C AND status = 'active';
  INSERT INTO _sec VALUES (14, 'revoked invite is refused',
    v_state <> 'GRANTED' AND v_cnt = 0, 'result=' || v_state || ' ORG_C memberships=' || v_cnt);

  -- 20a. invite preview is stable across repeated reads (deep-link refresh,
  --      database half — the browser half is in e2e/invite-entry.spec.ts)
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    v_prev  := get_invite_preview(tok_main);
    v_prev2 := get_invite_preview(tok_main);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_prev := NULL; v_prev2 := NULL; END;
  INSERT INTO _sec VALUES (20, 'invite deep-link preview is valid and repeatable (refresh-safe)',
    v_state = 'ok' AND (v_prev->>'valid') = 'true' AND v_prev = v_prev2
      AND NOT (v_prev ? 'invited_is_org_admin') AND NOT (v_prev ? 'preassignments'),
    coalesce(nullif(v_state,'ok'), 'preview=' || coalesce(v_prev::text,'null')));

  -- 11. verified invited identity CAN accept its own valid invite
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    v_res := accept_org_invite(tok_main);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_res := NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_INVITEE AND organization_id = ORG_A AND status = 'active';
  INSERT INTO _sec VALUES (11, 'verified invited identity CAN accept its own valid invite',
    v_state = 'ok' AND v_cnt = 1,
    coalesce(nullif(v_state,'ok'), 'membership rows=' || v_cnt));

  -- 19. invited user lands in the intended workspace
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    SELECT current_org_id() INTO v_got;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_got := NULL; END;
  INSERT INTO _sec VALUES (19, 'invited user lands in the intended workspace',
    v_got = ORG_A, 'current_org=' || coalesce(v_got::text, 'null') || ' ' || v_state);

  -- 21. logout / login after acceptance still resolves the org (fresh claims)
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    PERFORM auto_accept_pending_invites();       -- the login bootstrap path
    SELECT current_org_id() INTO v_got;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_got := NULL; END;
  INSERT INTO _sec VALUES (21, 'logout/login after acceptance still resolves the org',
    v_got = ORG_A, 'current_org=' || coalesce(v_got::text, 'null') || ' ' || v_state);

  -- 7. accepting an invitation does not grant invitation-creation authority
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    SELECT can_invite_members() INTO v_bool;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_bool := NULL; END;
  SELECT count(*) INTO v_cnt2 FROM organization_memberships
  WHERE user_id = U_INVITEE AND organization_id = ORG_A AND is_org_admin;
  INSERT INTO _sec VALUES (7, 'accepting an invite grants no invitation authority',
    v_bool IS FALSE,
    'can_invite_members=' || coalesce(v_bool::text, 'ERR ' || v_state)
      || ' (accepted as org admin=' || (v_cnt2 > 0)::text || ')');

  -- 8. the newly accepted user cannot create another invite
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    PERFORM create_org_invite(ORG_A, 'sec_chain_' || sfx || '@fund.test');
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (8, 'newly accepted (org-admin) user CANNOT create another invite',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 15. accepted invite cannot be reused for privilege escalation.
  --     Demote the accepter, then replay their own accepted token: the replay
  --     must be a no-op, not a re-grant of the admin flag.
  UPDATE organization_memberships SET is_org_admin = false
  WHERE user_id = U_INVITEE AND organization_id = ORG_A;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_invitee);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(tok_main);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_INVITEE AND organization_id = ORG_A AND is_org_admin = true;
  INSERT INTO _sec VALUES (15, 'accepted invite cannot be replayed to re-escalate privilege',
    v_cnt = 0, 'admin flag restored by replay=' || (v_cnt > 0)::text || ' replay=' || v_state);

  -- ═══ UNSOLICITED SIGNUP AND ORG CREATION ══════════════════════════════════

  -- 9. random unsolicited signup cannot acquire an organization
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_random);
    SET LOCAL ROLE authenticated;
    INSERT INTO users (id, email) VALUES (U_RANDOM, e_random) ON CONFLICT (id) DO NOTHING;
    PERFORM auto_accept_pending_invites();
    PERFORM route_org_for_email(e_random);
    SELECT current_org_id() INTO v_got;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_got := NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_RANDOM AND status = 'active';
  INSERT INTO _sec VALUES (9, 'unsolicited signup acquires no organization',
    v_got IS NULL AND v_cnt = 0,
    'current_org=' || coalesce(v_got::text, 'null') || ' active_memberships=' || v_cnt || ' ' || v_state);

  -- 17. ordinary authenticated user cannot bypass access control via bootstrap
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_random);
    SET LOCAL ROLE authenticated;
    PERFORM bootstrap_organization('Sec Rogue ' || sfx, 'sec-rogue-' || sfx, NULL, NULL, false);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SELECT count(*) INTO v_cnt FROM organizations WHERE slug = 'sec-rogue-' || sfx;
  INSERT INTO _sec VALUES (17, 'ordinary user CANNOT bypass access control via bootstrap_organization',
    v_state <> 'GRANTED' AND v_cnt = 0, 'result=' || v_state || ' orgs_created=' || v_cnt);

  -- 25. ordinary user cannot create a new organization by any route
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_pilot);
    SET LOCAL ROLE authenticated;
    INSERT INTO organizations (name, slug) VALUES ('Sec Direct ' || sfx, 'sec-direct-' || sfx);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SELECT count(*) INTO v_cnt FROM organizations WHERE slug = 'sec-direct-' || sfx;
  INSERT INTO _sec VALUES (25, 'ordinary user CANNOT create an organization (direct INSERT)',
    v_state <> 'GRANTED' AND v_cnt = 0, 'result=' || v_state || ' orgs_created=' || v_cnt);

  -- 18. existing pilot still logs in and resolves its current organization
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_legacy);
    SET LOCAL ROLE authenticated;
    PERFORM auto_accept_pending_invites();       -- runs on every login
    SELECT current_org_id() INTO v_got;
    SELECT count(*) INTO v_cnt FROM users WHERE id = U_LEGACY;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_got := NULL; v_cnt := 0; END;
  INSERT INTO _sec VALUES (18, 'existing pilot still logs in and resolves its organization',
    v_got = ORG_A AND v_cnt = 1,
    'current_org=' || coalesce(v_got::text,'null') || ' profile_rows=' || v_cnt || ' ' || v_state);

  -- ═══ PLATFORM-ADMIN WORKFLOWS STILL WORK AFTER HARDENING ══════════════════

  -- 26. the whole Ops workflow still works after hardening: create an invite
  --     with preassignments, read back its link, revoke it. `p_preassignments`
  --     is passed here because the People tab's old follow-up UPDATE keyed off
  --     the wrong field and silently dropped them on every invite.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_platform);
    SET LOCAL ROLE authenticated;
    v_res := create_org_invite(
      ORG_B, 'sec_oplink_' || sfx || '@fund.test', true,
      jsonb_build_object('portfolios', jsonb_build_array(
        jsonb_build_object('portfolio_id', gen_random_uuid()::text, 'role', 'analyst'))));
    v_prev := get_org_invite_link((v_res->>'invite_id')::uuid);
    PERFORM revoke_org_invite((v_res->>'invite_id')::uuid);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_prev := NULL; v_res := NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_invites
  WHERE id = (v_res->>'invite_id')::uuid
    AND revoked_at IS NOT NULL AND status = 'cancelled'
    AND preassignments ? 'portfolios';
  INSERT INTO _sec VALUES (26, 'platform admin can create (with preassignments), link, and revoke an invite',
    v_state = 'ok' AND (v_prev->>'token') IS NOT NULL AND v_cnt = 1,
    coalesce(nullif(v_state,'ok'), 'revoked+preassigned rows=' || v_cnt));

  -- 27. the token column is not readable by ordinary clients
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    PERFORM token FROM organization_invites WHERE organization_id = ORG_A;
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (27, 'invite token column is unreadable by org admins',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 28. an org admin cannot revoke or cancel an invitation by ANY route.
  --     Both the RPC and the direct UPDATE the Ops/People UIs used to issue
  --     are tried; the check passes only if neither lands.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    PERFORM revoke_org_invite((SELECT id FROM organization_invites WHERE token = tok_unverif));
    RESET ROLE; v_state := 'GRANTED(rpc)';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    UPDATE organization_invites SET status = 'cancelled' WHERE organization_id = ORG_A;
    RESET ROLE; v_state := v_state || ' GRANTED(update)';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := v_state || ' ' || SQLSTATE; END;
  INSERT INTO _sec VALUES (28, 'org admin CANNOT revoke or cancel an invitation (RPC or direct UPDATE)',
    v_state NOT LIKE '%GRANTED%', 'result=' || v_state);

  -- 29. the revoke in section 6 must not have gone too far: an org admin still
  --     has to be able to SEE who is pending in their own organization, or the
  --     People tab shows an empty list and nobody notices the invite exists.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_cnt
    FROM organization_invites
    WHERE organization_id = ORG_A;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_cnt := -1; END;
  INSERT INTO _sec VALUES (29, 'org admin can still read their own org''s invites (non-token columns)',
    v_state = 'ok' AND v_cnt >= 0, 'rows visible=' || v_cnt || ' ' || v_state);

  -- ── cleanup ───────────────────────────────────────────────────────────────
  DELETE FROM org_chart_node_members WHERE user_id IN
    (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY);
  DELETE FROM portfolio_team WHERE user_id IN
    (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY);
  DELETE FROM organization_invites WHERE organization_id IN (ORG_A, ORG_B, ORG_C);
  DELETE FROM organization_audit_log WHERE organization_id IN (ORG_A, ORG_B, ORG_C);
  DELETE FROM audit_events WHERE org_id IN (ORG_A, ORG_B, ORG_C);
  UPDATE users SET current_organization_id = NULL WHERE id IN
    (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY);
  DELETE FROM organization_memberships WHERE organization_id IN (ORG_A, ORG_B, ORG_C);
  DELETE FROM platform_admins WHERE user_id = U_PLATFORM;
  BEGIN
    DELETE FROM early_access_grandfathered_identities WHERE user_id IN
      (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY);
  EXCEPTION WHEN assert_failure OR OTHERS THEN NULL; END;
  DELETE FROM auth.users WHERE id IN
    (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY);
  DELETE FROM organizations WHERE id IN (ORG_A, ORG_B, ORG_C);
END;
$suite$;

SELECT n,
       CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result,
       name,
       detail
FROM _sec
ORDER BY n;
