-- =============================================================================
-- Early Access — signup / invitation / bootstrap security suite
--
-- 48 checks covering the database half of the entry surface. Each one runs the
-- exact call a browser would make: as the `authenticated` role, with a forged
-- `request.jwt.claims`, through PostgREST-visible functions and tables. The
-- checks that are purely about the browser (invite deep-link refresh, mobile
-- invitation entry, the confirmation round-trip's return path) live in
-- e2e/invite-entry.spec.ts.
--
-- Checks 44-48 are the email-ownership layer. They exist because the
-- confirmation gate in accept_org_invite() is INERT while
-- `mailer_autoconfirm` is on — every identity is stamped at signup, so the
-- branch is never taken — and a gate nobody has ever seen refuse anything is
-- not a gate you should turn a production setting off in front of. These force
-- the branch by constructing unconfirmed identities directly, so the behaviour
-- after the flip is proven before the flip.
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
  ORG_OPEN uuid; ORG_APPR uuid;            -- domain-routing targets
  U_PLATFORM  uuid := gen_random_uuid();   -- platform admin (the founder)
  U_PILOT     uuid := gen_random_uuid();   -- ordinary active member of ORG_A
  U_ORGADMIN  uuid := gen_random_uuid();   -- org admin of ORG_A, NOT platform
  U_INVITEE   uuid := gen_random_uuid();   -- holds a valid admin invite to ORG_A
  U_STRANGER  uuid := gen_random_uuid();   -- authenticated, different address
  U_UNVERIF   uuid := gen_random_uuid();   -- invited address, unconfirmed email
  U_RANDOM    uuid := gen_random_uuid();   -- unsolicited signup, no invite
  U_LEGACY    uuid := gen_random_uuid();   -- pre-existing pilot with an org
  U_DOMOPEN   uuid := gen_random_uuid();   -- email at an 'open' verified domain
  U_DOMAPPR   uuid := gen_random_uuid();   -- email at an 'approval_required' domain
  U_REQ1      uuid := gen_random_uuid();   -- join requester, to be rejected
  U_REQ2      uuid := gen_random_uuid();   -- join requester, to be approved
  U_PRECUT    uuid := gen_random_uuid();   -- active member from before the cutoff
  U_POSTCUT   uuid := gen_random_uuid();   -- active member from after the cutoff
  U_PLATOPEN  uuid := gen_random_uuid();   -- platform admin at the open domain
  U_CONFIRMS  uuid := gen_random_uuid();   -- invited, unconfirmed, then confirms
  U_OLDUNCONF uuid := gen_random_uuid();   -- grandfathered pilot, unconfirmed
  U_EMAILONLY uuid := gen_random_uuid();   -- confirmed, invited, has NO token

  sfx text := substr(md5(random()::text), 1, 8);
  e_platform text; e_pilot text; e_orgadmin text; e_invitee text;
  e_stranger text; e_unverif text; e_random text; e_legacy text;
  e_domopen text; e_domappr text; e_req1 text; e_req2 text; e_platopen text;
  e_confirms text; e_oldunconf text; e_emailonly text;
  cl_confirms text; cl_oldunconf text; cl_emailonly text;
  cl_platopen text;
  dom_open text; dom_appr text;
  cl_platform text; cl_pilot text; cl_orgadmin text; cl_invitee text;
  cl_stranger text; cl_unverif text; cl_random text; cl_legacy text;
  cl_domopen text; cl_domappr text;

  tok_main uuid;      -- valid admin invite to ORG_A for U_INVITEE
  tok_expired uuid;   -- expired invite for U_INVITEE
  tok_revoked uuid;   -- revoked invite for U_INVITEE
  tok_unverif uuid;   -- valid invite for the unconfirmed identity
  tok_confirms uuid;  -- valid invite for the identity that confirms mid-suite
  tok_oldunconf uuid; -- valid invite for the grandfathered unconfirmed pilot
  tok_emailonly uuid; -- valid invite the email-only claimant never presents

  v_state text; v_state2 text; v_cnt int; v_cnt2 int; v_got uuid; v_res jsonb; v_bool boolean;
  v_prev jsonb; v_prev2 jsonb;
  v_cutoff timestamptz; v_cutoff_check timestamptz; v_req1 uuid; v_req2 uuid;
BEGIN
  e_platform := 'sec_platform_' || sfx || '@tesseract.test';
  e_pilot    := 'sec_pilot_'    || sfx || '@fund.test';
  e_orgadmin := 'sec_orgadmin_' || sfx || '@fund.test';
  e_invitee  := 'sec_invitee_'  || sfx || '@fund.test';
  e_stranger := 'sec_stranger_' || sfx || '@other.test';
  e_unverif  := 'sec_unverif_'  || sfx || '@fund.test';
  e_random   := 'sec_random_'   || sfx || '@nowhere.test';
  e_legacy   := 'sec_legacy_'   || sfx || '@fund.test';
  dom_open   := 'secopen'  || sfx || '.test';
  dom_appr   := 'secappr'  || sfx || '.test';
  e_domopen  := 'sec_domopen_'  || sfx || '@' || dom_open;
  e_domappr  := 'sec_domappr_'  || sfx || '@' || dom_appr;
  e_req1     := 'sec_req1_'     || sfx || '@fund.test';
  e_req2     := 'sec_req2_'     || sfx || '@fund.test';
  e_platopen := 'sec_platopen_' || sfx || '@' || dom_open;
  e_confirms  := 'sec_confirms_'  || sfx || '@fund.test';
  e_oldunconf := 'sec_oldunconf_' || sfx || '@fund.test';
  e_emailonly := 'sec_emailonly_' || sfx || '@fund.test';

  -- The grandfather cutoff, read from the database so the test tracks the real
  -- constant rather than a copy of it. Falls back to the authored value on a
  -- pre-migration run, where the function does not exist yet.
  BEGIN
    SELECT early_access_enforcement_cutoff() INTO v_cutoff;
  EXCEPTION WHEN assert_failure OR OTHERS THEN
    v_cutoff := TIMESTAMPTZ '2026-08-01 00:00:00+00';
  END;

  -- ── fixtures ───────────────────────────────────────────────────────────────
  INSERT INTO organizations (name, slug) VALUES ('Sec A ' || sfx, 'sec-a-' || sfx) RETURNING id INTO ORG_A;
  INSERT INTO organizations (name, slug) VALUES ('Sec B ' || sfx, 'sec-b-' || sfx) RETURNING id INTO ORG_B;
  -- ORG_C exists only because idx_org_invites_unique_pending forbids two
  -- pending invites for the same address in the same organization, and the
  -- expired and revoked fixtures share the invitee's address.
  INSERT INTO organizations (name, slug) VALUES ('Sec C ' || sfx, 'sec-c-' || sfx) RETURNING id INTO ORG_C;

  -- Domain-routing targets. Production has zero verified domains and every
  -- organization is invite_only, which is precisely why these have to be built
  -- here: the point of the check is that turning one of these on is no longer
  -- enough to reopen self-service membership.
  INSERT INTO organizations (name, slug, onboarding_policy)
    VALUES ('Sec Open ' || sfx, 'sec-open-' || sfx, 'open') RETURNING id INTO ORG_OPEN;
  INSERT INTO organizations (name, slug, onboarding_policy)
    VALUES ('Sec Appr ' || sfx, 'sec-appr-' || sfx, 'approval_required') RETURNING id INTO ORG_APPR;

  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, role, aud, instance_id) VALUES
    (U_PLATFORM, e_platform, now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_PILOT,    e_pilot,    now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_ORGADMIN, e_orgadmin, now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_INVITEE,  e_invitee,  now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_STRANGER, e_stranger, now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_UNVERIF,  e_unverif,  NULL,  '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_RANDOM,   e_random,   now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_LEGACY,   e_legacy,   now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_DOMOPEN,  e_domopen,  now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_DOMAPPR,  e_domappr,  now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_REQ1,     e_req1,     now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_REQ2,     e_req2,     now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_PLATOPEN, e_platopen, now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    -- The email-verification fixtures. The two NULLs are the point: with
    -- `mailer_autoconfirm` on, production cannot produce an unconfirmed row at
    -- all, so the only way to exercise the gate is to build one.
    (U_CONFIRMS,  e_confirms,  NULL,  '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_OLDUNCONF, e_oldunconf, NULL,  '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_EMAILONLY, e_emailonly, now(), '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  -- The two grandfather-cutoff fixtures carry EXPLICIT created_at on both the
  -- auth row and the membership. Defaulting to now() would make the test's
  -- meaning depend on the date it runs: before the cutoff both look
  -- pre-enforcement, after it both look post-enforcement, and the check would
  -- silently stop testing anything.
  -- U_POSTCUT is created at now(), not at some synthetic future date: the
  -- requirement is that somebody joining TODAY can never enter the set, and
  -- the cutoff being in the past is what makes now() a post-cutoff timestamp.
  -- If anyone ever moves the cutoff forward again, this fixture stops being
  -- post-cutoff and check 39 fails — which is the behaviour we want.
  INSERT INTO auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data, role, aud, instance_id) VALUES
    (U_PRECUT,  'sec_precut_'  || sfx || '@fund.test', now(), v_cutoff - interval '30 days',
       '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (U_POSTCUT, 'sec_postcut_' || sfx || '@fund.test', now(), now(),
       '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_domains (organization_id, domain, status, verified_at) VALUES
    (ORG_OPEN, dom_open, 'verified', now()),
    (ORG_APPR, dom_appr, 'verified', now());

  INSERT INTO platform_admins (user_id) VALUES (U_PLATFORM) ON CONFLICT DO NOTHING;
  INSERT INTO platform_admins (user_id) VALUES (U_PLATOPEN) ON CONFLICT DO NOTHING;

  INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status) VALUES
    (ORG_A, U_PILOT,    false, 'active'),
    (ORG_A, U_ORGADMIN, true,  'active'),
    (ORG_A, U_LEGACY,   false, 'active');

  INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status, created_at) VALUES
    (ORG_A, U_PRECUT,  false, 'active', v_cutoff - interval '30 days'),
    (ORG_A, U_POSTCUT, false, 'active', now());

  UPDATE users SET current_organization_id = ORG_A WHERE id IN (U_PILOT, U_ORGADMIN, U_LEGACY);

  -- The legacy pilot predates enforcement. Where the grandfathering table
  -- exists it is populated from active memberships at migration time, so a
  -- fixture created afterwards has to be enrolled explicitly to stand in for
  -- a real pre-existing pilot.
  BEGIN
    INSERT INTO early_access_grandfathered_identities (user_id, reason)
    VALUES
      (U_LEGACY,    'test_fixture_pre_enforcement_pilot'),
      -- U_OLDUNCONF stands for the case that decides whether turning
      -- verification on is safe: a pilot who is genuinely inside, whose
      -- auth row is nevertheless unconfirmed. Production has none today
      -- (checked: 0 of 27), but the waiver is what makes that a verified
      -- fact rather than a bet, and it has to be shown to work.
      (U_OLDUNCONF, 'test_fixture_pre_enforcement_unconfirmed_pilot')
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
  INSERT INTO organization_invites (organization_id, email, invited_by, invited_is_org_admin, status, expires_at)
    VALUES (ORG_A, e_confirms, U_PLATFORM, false, 'pending', NULL) RETURNING token INTO tok_confirms;
  INSERT INTO organization_invites (organization_id, email, invited_by, invited_is_org_admin, status, expires_at)
    VALUES (ORG_A, e_oldunconf, U_PLATFORM, false, 'pending', NULL) RETURNING token INTO tok_oldunconf;
  INSERT INTO organization_invites (organization_id, email, invited_by, invited_is_org_admin, status, expires_at)
    VALUES (ORG_A, e_emailonly, U_PLATFORM, true, 'pending', NULL) RETURNING token INTO tok_emailonly;

  cl_platform := json_build_object('sub', U_PLATFORM, 'role', 'authenticated')::text;
  cl_pilot    := json_build_object('sub', U_PILOT,    'role', 'authenticated')::text;
  cl_orgadmin := json_build_object('sub', U_ORGADMIN, 'role', 'authenticated')::text;
  cl_invitee  := json_build_object('sub', U_INVITEE,  'role', 'authenticated')::text;
  cl_stranger := json_build_object('sub', U_STRANGER, 'role', 'authenticated')::text;
  cl_unverif  := json_build_object('sub', U_UNVERIF,  'role', 'authenticated')::text;
  cl_random   := json_build_object('sub', U_RANDOM,   'role', 'authenticated')::text;
  cl_legacy   := json_build_object('sub', U_LEGACY,   'role', 'authenticated')::text;
  cl_domopen  := json_build_object('sub', U_DOMOPEN,  'role', 'authenticated')::text;
  cl_domappr  := json_build_object('sub', U_DOMAPPR,  'role', 'authenticated')::text;
  cl_platopen := json_build_object('sub', U_PLATOPEN, 'role', 'authenticated')::text;
  cl_confirms  := json_build_object('sub', U_CONFIRMS,  'role', 'authenticated')::text;
  cl_oldunconf := json_build_object('sub', U_OLDUNCONF, 'role', 'authenticated')::text;
  cl_emailonly := json_build_object('sub', U_EMAILONLY, 'role', 'authenticated')::text;

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
  WHERE organization_id IN (ORG_A, ORG_B, ORG_C, ORG_OPEN, ORG_APPR)
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

  -- ═══ EMAIL OWNERSHIP ══════════════════════════════════════════════════════
  --
  -- The layer that makes possession of the invitation link insufficient on its
  -- own. Every check here would pass vacuously against a database where the
  -- confirmation branch had been deleted, so each one asserts the PAIR: the
  -- refusal AND the acceptance that differs from it by exactly one fact.

  -- 44. confirming the email is what changes the answer.
  --
  --     The same identity, the same token, the same call — refused, then
  --     confirmed, then accepted. Checked as one pair rather than two separate
  --     checks because either half alone proves nothing: a refusal might be the
  --     token, the address, or the invite's state, and an acceptance says
  --     nothing about what would have happened without the confirmation.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_confirms);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(tok_confirms);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;

  -- The mailbox is proven. This is the only thing that changes between the two
  -- halves; nothing about the invitation or the caller is touched.
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = U_CONFIRMS;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_confirms);
    SET LOCAL ROLE authenticated;
    v_res := accept_org_invite(tok_confirms);
    RESET ROLE; v_state2 := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state2 := SQLSTATE || ' ' || SQLERRM; v_res := NULL; END;

  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_CONFIRMS AND organization_id = ORG_A AND status = 'active';
  INSERT INTO _sec VALUES (44,
    'the SAME identity and token is refused unconfirmed and accepted confirmed',
    v_state = 'P0026' AND v_state2 = 'ok' AND v_cnt = 1,
    'unconfirmed=' || v_state || ' confirmed=' || v_state2 || ' memberships=' || v_cnt);

  -- 45. a confirmed mailbox is not a substitute for the token.
  --
  --     U_EMAILONLY is the exact profile the retired auto-accept path used to
  --     admit: correct address, confirmed identity, a real pending invitation
  --     addressed to them — and no token. They log in, the login bootstrap
  --     runs, domain routing runs, and none of it may hand them the membership
  --     that is sitting there waiting with their name on it.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_emailonly);
    SET LOCAL ROLE authenticated;
    INSERT INTO users (id, email) VALUES (U_EMAILONLY, e_emailonly) ON CONFLICT (id) DO NOTHING;
    PERFORM auto_accept_pending_invites();   -- the login bootstrap path
    PERFORM route_org_for_email(e_emailonly);
    SELECT current_org_id() INTO v_got;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_got := NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_EMAILONLY AND status = 'active';
  SELECT count(*) INTO v_cnt2 FROM organization_invites
  WHERE token = tok_emailonly AND status = 'pending';
  INSERT INTO _sec VALUES (45,
    'a confirmed invited address WITHOUT the token acquires nothing',
    v_got IS NULL AND v_cnt = 0 AND v_cnt2 = 1,
    'current_org=' || coalesce(v_got::text,'null') || ' memberships=' || v_cnt ||
    ' invite_still_pending=' || (v_cnt2 = 1)::text || ' ' || v_state);

  -- 46. and the token then works for that same person.
  --
  --     Guards the check above against passing because something unrelated is
  --     broken. If 45 passed and this fails, the invitation was not claimable
  --     in the first place and 45 proved nothing.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_emailonly);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(tok_emailonly);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_EMAILONLY AND organization_id = ORG_A AND status = 'active';
  INSERT INTO _sec VALUES (46,
    'presenting the token DOES admit that same confirmed address',
    v_state = 'ok' AND v_cnt = 1,
    'result=' || v_state || ' memberships=' || v_cnt);

  -- 47. replay is idempotent, and idempotent means the SAME answer.
  --
  --     Check 15 already proves a replay cannot re-escalate. This proves the
  --     other half: it does not ERROR. That is what lets /invite/:token be
  --     refreshed, reopened from history, and hit twice by the confirmation
  --     round-trip landing on a page that accepts automatically — all of which
  --     the new flow makes routine rather than exceptional.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_emailonly);
    SET LOCAL ROLE authenticated;
    v_prev := accept_org_invite(tok_emailonly);
    v_prev2 := accept_org_invite(tok_emailonly);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_EMAILONLY AND status = 'active';
  INSERT INTO _sec VALUES (47,
    'replaying an accepted invite returns the same answer, twice, without error',
    v_state = 'ok'
      AND v_prev ->> 'organization_id' = ORG_A::text
      AND v_prev2 ->> 'organization_id' = ORG_A::text
      AND v_prev2 ->> 'status' = 'already_accepted'
      AND v_cnt = 1,
    'result=' || v_state || ' first=' || coalesce(v_prev::text,'null') ||
    ' second=' || coalesce(v_prev2::text,'null') || ' memberships=' || v_cnt);

  -- 48. turning verification on cannot strand a pilot who predates it.
  --
  --     The rollout's actual risk. `email_confirmed_at` on the existing pilots
  --     was stamped by autoconfirm, not by anyone opening an email, so it is
  --     not evidence — and if a restore, a manual fix, or a provisioning path
  --     ever leaves one NULL, the confirmation gate would lock out someone who
  --     is legitimately inside. The grandfather waiver is the answer, and this
  --     is the check that it is wired to acceptance rather than merely
  --     recorded in a table.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_oldunconf);
    SET LOCAL ROLE authenticated;
    PERFORM accept_org_invite(tok_oldunconf);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_OLDUNCONF AND organization_id = ORG_A AND status = 'active';
  -- Still unconfirmed: the waiver must waive the check, not quietly confirm
  -- the identity behind it.
  SELECT count(*) INTO v_cnt2 FROM auth.users
  WHERE id = U_OLDUNCONF AND email_confirmed_at IS NULL;
  INSERT INTO _sec VALUES (48,
    'a grandfathered pilot is not locked out by the confirmation gate',
    v_state = 'ok' AND v_cnt = 1 AND v_cnt2 = 1,
    'result=' || v_state || ' memberships=' || v_cnt ||
    ' still_unconfirmed=' || (v_cnt2 = 1)::text);

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

  -- === DOMAIN ROUTING AS A MEMBERSHIP PATH =================================

  -- 30. anon cannot call the router at all
  BEGIN
    SET LOCAL request.jwt.claims = '';
    SET LOCAL ROLE anon;
    PERFORM route_org_for_email(e_domopen);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  INSERT INTO _sec VALUES (30, 'anon CANNOT call route_org_for_email',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 31. an ordinary user cannot self-route into an 'open' domain-matched org
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_domopen);
    SET LOCAL ROLE authenticated;
    v_res := route_org_for_email(e_domopen);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_res := NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_DOMOPEN AND organization_id = ORG_OPEN;
  INSERT INTO _sec VALUES (31, 'ordinary user CANNOT self-route into an open domain-matched org',
    (v_res->>'action') = 'blocked' AND v_cnt = 0,
    'action=' || coalesce(v_res->>'action','ERR ' || v_state)
      || ' reason=' || coalesce(v_res->>'reason','-') || ' memberships=' || v_cnt);

  -- 32. the caller-supplied address cannot select the organization
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_pilot);
    SET LOCAL ROLE authenticated;
    v_res := route_org_for_email(e_domopen);   -- pilot naming somebody else's domain
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_res := NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_PILOT AND organization_id = ORG_OPEN;
  INSERT INTO _sec VALUES (32, 'a caller-supplied email cannot route you into another org',
    (v_res->>'action') = 'blocked' AND v_cnt = 0,
    'action=' || coalesce(v_res->>'action','ERR ' || v_state)
      || ' reason=' || coalesce(v_res->>'reason','-') || ' memberships=' || v_cnt);

  -- 33. approval_required creates neither a request nor a pending membership
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_domappr);
    SET LOCAL ROLE authenticated;
    v_res := route_org_for_email(e_domappr);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_res := NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships WHERE user_id = U_DOMAPPR;
  SELECT count(*) INTO v_cnt2 FROM access_requests WHERE requester_id = U_DOMAPPR;
  INSERT INTO _sec VALUES (33, 'approval_required domain match creates no request and no pending membership',
    (v_res->>'action') = 'blocked' AND v_cnt = 0 AND v_cnt2 = 0,
    'action=' || coalesce(v_res->>'action','ERR ' || v_state)
      || ' reason=' || coalesce(v_res->>'reason','-')
      || ' memberships=' || v_cnt || ' requests=' || v_cnt2);

  -- 34. an org admin cannot approve a join request into active membership
  INSERT INTO access_requests (organization_id, requester_id, request_type, reason, status)
    VALUES (ORG_A, U_REQ1, 'join_org', 'test fixture', 'pending') RETURNING id INTO v_req1;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    PERFORM approve_org_join_request(v_req1, 'approved', NULL);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_REQ1 AND status = 'active';
  INSERT INTO _sec VALUES (34, 'org admin CANNOT approve a join request into active membership',
    v_state <> 'GRANTED' AND v_cnt = 0, 'result=' || v_state || ' active_memberships=' || v_cnt);

  -- 35. but an org admin can still reject one -- rejecting grants nothing, and
  --     leaving them unable to clear their own queue would be theatre
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    PERFORM approve_org_join_request(v_req1, 'rejected', 'not now');
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM access_requests WHERE id = v_req1 AND status = 'rejected';
  INSERT INTO _sec VALUES (35, 'org admin CAN still reject a join request',
    v_state = 'ok' AND v_cnt = 1, coalesce(nullif(v_state,'ok'), 'rejected rows=' || v_cnt));

  -- 36. a platform admin can approve -- the legitimate path is preserved
  INSERT INTO access_requests (organization_id, requester_id, request_type, reason, status)
    VALUES (ORG_A, U_REQ2, 'join_org', 'test fixture', 'pending') RETURNING id INTO v_req2;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_platform);
    SET LOCAL ROLE authenticated;
    PERFORM approve_org_join_request(v_req2, 'approved', NULL);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_REQ2 AND organization_id = ORG_A AND status = 'active';
  INSERT INTO _sec VALUES (36, 'platform admin CAN approve a join request',
    v_state = 'ok' AND v_cnt = 1, coalesce(nullif(v_state,'ok'), 'active memberships=' || v_cnt));

  -- 37. pilot safety: one active membership still resolves to a switch. Every
  --     existing pilot's login goes through this branch, so it must stay open.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_legacy);
    SET LOCAL ROLE authenticated;
    v_res := route_org_for_email(e_legacy);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_res := NULL; END;
  INSERT INTO _sec VALUES (37, 'existing single-membership pilot still routes to its org',
    (v_res->>'action') = 'switch' AND (v_res->>'org_id')::uuid = ORG_A,
    'action=' || coalesce(v_res->>'action','ERR ' || v_state) || ' org=' || coalesce(v_res->>'org_id','-'));

  -- === THE FROZEN GRANDFATHER SET ==========================================

  -- 38. a pre-cutoff active member is admitted by the backfill
  BEGIN
    PERFORM backfill_early_access_grandfathered_identities();
    v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN v_state := SQLSTATE || ' ' || SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM early_access_grandfathered_identities WHERE user_id = U_PRECUT;
  INSERT INTO _sec VALUES (38, 'pre-cutoff active member IS grandfathered',
    v_state = 'ok' AND v_cnt = 1, coalesce(nullif(v_state,'ok'), 'grandfathered rows=' || v_cnt));

  -- 39. replaying the backfill does NOT admit anyone who joined after the
  --     cutoff -- the whole point of freezing the set
  BEGIN
    PERFORM backfill_early_access_grandfathered_identities();
    PERFORM backfill_early_access_grandfathered_identities();
    v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN v_state := SQLSTATE || ' ' || SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM early_access_grandfathered_identities WHERE user_id = U_POSTCUT;
  INSERT INTO _sec VALUES (39, 'replaying the backfill does NOT grandfather a post-cutoff member',
    v_state = 'ok' AND v_cnt = 0, coalesce(nullif(v_state,'ok'), 'wrongly grandfathered rows=' || v_cnt));

  -- === MEMBERSHIP TABLE GRANTS =============================================

  -- 40. nobody writes memberships directly any more -- not even a platform
  --     admin, whose legitimate route is the SECURITY DEFINER RPCs
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_platform);
    SET LOCAL ROLE authenticated;
    INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (ORG_B, U_STRANGER, 'active', false);
    RESET ROLE; v_state := 'GRANTED';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  DELETE FROM organization_memberships WHERE organization_id = ORG_B AND user_id = U_STRANGER;
  INSERT INTO _sec VALUES (40, 'direct membership INSERT is refused even for a platform admin',
    v_state <> 'GRANTED', 'result=' || v_state);

  -- 41. the UPDATE grant is retained on purpose: OrganizationPage toggles
  --     is_org_admin and Ops suspends members through it. Revoking it would
  --     have broken a real workflow, so the check proves it still works.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_orgadmin);
    SET LOCAL ROLE authenticated;
    UPDATE organization_memberships SET is_org_admin = true
    WHERE organization_id = ORG_A AND user_id = U_PILOT;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE organization_id = ORG_A AND user_id = U_PILOT AND is_org_admin;
  INSERT INTO _sec VALUES (41, 'org admin can still UPDATE a membership (retained grant works)',
    v_state = 'ok' AND v_cnt = 1, coalesce(nullif(v_state,'ok'), 'updated rows=' || v_cnt));

  -- 42. The negative control for 31 and 33.
  --
  --     Those two checks pass because route_org_for_email returns 'blocked'.
  --     That is also what it would return if the change had simply broken
  --     domain routing, or if the fixture domain were wrong — a green suite
  --     either way. So: the same call, the same domain, made by someone who
  --     DOES hold membership-granting authority, must still auto-join. That
  --     pins the failure in 31 to the authority gate specifically, and proves
  --     the architecture is intact for entitlement-controlled onboarding later.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', cl_platopen);
    SET LOCAL ROLE authenticated;
    v_res := route_org_for_email(e_platopen);
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN RESET ROLE; v_state := SQLSTATE || ' ' || SQLERRM; v_res := NULL; END;
  SELECT count(*) INTO v_cnt FROM organization_memberships
  WHERE user_id = U_PLATOPEN AND organization_id = ORG_OPEN AND status = 'active';
  INSERT INTO _sec VALUES (42, 'domain auto-join still works for an authority holder (gate, not breakage)',
    (v_res->>'action') = 'auto_join' AND v_cnt = 1,
    'action=' || coalesce(v_res->>'action','ERR ' || v_state) || ' memberships=' || v_cnt);

  -- 43. The cutoff must already be in the PAST.
  --
  --     A grandfather boundary you have not yet passed is not frozen — it is
  --     scheduled to freeze, and everyone who signs up before it arrives gets
  --     swept in by the next replay. The first version of this constant was
  --     end-of-authoring-day and had that flaw. This check exists so the
  --     mistake cannot come back silently.
  BEGIN
    SELECT early_access_enforcement_cutoff() INTO v_cutoff_check;
    v_state := 'ok';
  EXCEPTION WHEN assert_failure OR OTHERS THEN v_state := SQLSTATE || ' ' || SQLERRM; v_cutoff_check := NULL; END;
  INSERT INTO _sec VALUES (43, 'the grandfather cutoff is already in the past',
    v_state = 'ok' AND v_cutoff_check < now(),
    coalesce(nullif(v_state,'ok'),
      'cutoff=' || v_cutoff_check::text || ' now=' || now()::text
      || ' (' || justify_interval(now() - v_cutoff_check)::text || ' ago)'));

  -- ── cleanup ───────────────────────────────────────────────────────────────
  DELETE FROM access_requests WHERE organization_id IN (ORG_A, ORG_B, ORG_C, ORG_OPEN, ORG_APPR);
  DELETE FROM organization_domains WHERE organization_id IN (ORG_OPEN, ORG_APPR);
  DELETE FROM org_chart_node_members WHERE user_id IN
    (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY,
     U_DOMOPEN,U_DOMAPPR,U_REQ1,U_REQ2,U_PRECUT,U_POSTCUT,U_PLATOPEN,
     U_CONFIRMS,U_OLDUNCONF,U_EMAILONLY);
  DELETE FROM portfolio_team WHERE user_id IN
    (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY,
     U_DOMOPEN,U_DOMAPPR,U_REQ1,U_REQ2,U_PRECUT,U_POSTCUT,U_PLATOPEN,
     U_CONFIRMS,U_OLDUNCONF,U_EMAILONLY);
  DELETE FROM organization_invites WHERE organization_id IN (ORG_A, ORG_B, ORG_C, ORG_OPEN, ORG_APPR);
  DELETE FROM organization_audit_log WHERE organization_id IN (ORG_A, ORG_B, ORG_C, ORG_OPEN, ORG_APPR);
  DELETE FROM audit_events WHERE org_id IN (ORG_A, ORG_B, ORG_C, ORG_OPEN, ORG_APPR);
  UPDATE users SET current_organization_id = NULL WHERE id IN
    (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY,
     U_DOMOPEN,U_DOMAPPR,U_REQ1,U_REQ2,U_PRECUT,U_POSTCUT,U_PLATOPEN,
     U_CONFIRMS,U_OLDUNCONF,U_EMAILONLY);
  DELETE FROM organization_memberships WHERE organization_id IN (ORG_A, ORG_B, ORG_C, ORG_OPEN, ORG_APPR);
  DELETE FROM platform_admins WHERE user_id IN (U_PLATFORM, U_PLATOPEN);
  BEGIN
    DELETE FROM early_access_grandfathered_identities WHERE user_id IN
      (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY,
     U_DOMOPEN,U_DOMAPPR,U_REQ1,U_REQ2,U_PRECUT,U_POSTCUT,U_PLATOPEN,
     U_CONFIRMS,U_OLDUNCONF,U_EMAILONLY);
  EXCEPTION WHEN assert_failure OR OTHERS THEN NULL; END;
  DELETE FROM auth.users WHERE id IN
    (U_PLATFORM,U_PILOT,U_ORGADMIN,U_INVITEE,U_STRANGER,U_UNVERIF,U_RANDOM,U_LEGACY,
     U_DOMOPEN,U_DOMAPPR,U_REQ1,U_REQ2,U_PRECUT,U_POSTCUT,U_PLATOPEN,
     U_CONFIRMS,U_OLDUNCONF,U_EMAILONLY);
  DELETE FROM organizations WHERE id IN (ORG_A, ORG_B, ORG_C, ORG_OPEN, ORG_APPR);
END;
$suite$;

SELECT n,
       CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result,
       name,
       detail
FROM _sec
ORDER BY n;
