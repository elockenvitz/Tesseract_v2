-- =============================================================================
-- Organization SSO / OIDC Routing Tests
--
-- Tests for organization_identity_providers table, RPCs (upsert, delete,
-- get_identity_provider_for_email), permission checks, and audit logging.
-- 13 assertions total.
--
-- Self-cleaning: uses unique suffix + cleanup block.
-- Run from SQL Editor (service role) or psql.
-- =============================================================================

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org_id uuid; v_admin_id uuid; v_user_id uuid;
  v_result jsonb; v_provider_id uuid; v_sso_info jsonb; v_count int;
  v_pass int := 0; v_fail int := 0;
BEGIN
  RAISE NOTICE '=== SSO Routing Tests (suffix: %) ===', v_suffix;
  SELECT id INTO v_admin_id FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_user_id FROM auth.users WHERE id != v_admin_id ORDER BY created_at LIMIT 1;
  IF v_admin_id IS NULL OR v_user_id IS NULL THEN RAISE NOTICE 'SKIP: need 2 users'; RETURN; END IF;

  INSERT INTO organizations (name,slug,onboarding_policy) VALUES ('SSO_'||v_suffix,'sso-'||v_suffix,'open') RETURNING id INTO v_org_id;
  INSERT INTO organization_memberships (user_id,organization_id,status,is_org_admin,role) VALUES (v_admin_id,v_org_id,'active',true,'admin');
  INSERT INTO organization_domains (organization_id,domain,status,created_by,verified_at) VALUES (v_org_id,'sso-'||v_suffix||'.com','verified',v_admin_id,now());

  -- [1] Table has correct columns
  SELECT count(*) INTO v_count FROM information_schema.columns WHERE table_name='organization_identity_providers' AND column_name IN ('discovery_url','client_id','sso_only','enabled');
  IF v_count=4 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [1] Table columns'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [1]'; END IF;

  -- [2] SSO-only without verified domain blocked
  DECLARE v_ndo uuid;
  BEGIN
    INSERT INTO organizations (name,slug) VALUES ('ND_'||v_suffix,'nd-'||v_suffix) RETURNING id INTO v_ndo;
    INSERT INTO organization_memberships (user_id,organization_id,status,is_org_admin,role) VALUES (v_admin_id,v_ndo,'active',true,'admin');
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin_id::text,'role','authenticated')::text,true);
    PERFORM upsert_identity_provider(v_ndo,'https://x.com/.wk','c1',true,true);
    v_fail:=v_fail+1; RAISE NOTICE 'FAIL [2]';
  EXCEPTION WHEN raise_exception THEN
    v_pass:=v_pass+1; RAISE NOTICE 'PASS [2] SSO-only blocked w/o domain';
  END;
  DELETE FROM organization_memberships WHERE user_id=v_admin_id AND organization_id IN (SELECT id FROM organizations WHERE slug='nd-'||v_suffix);
  DELETE FROM organizations WHERE slug='nd-'||v_suffix;

  -- [3] Admin creates IdP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin_id::text,'role','authenticated')::text,true);
  SELECT upsert_identity_provider(v_org_id,'https://login.ex.com/.wk','my-client',false,true) INTO v_result;
  v_provider_id:=(v_result->>'provider_id')::uuid;
  IF v_provider_id IS NOT NULL THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [3] Created'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [3]'; END IF;

  -- [4] Non-admin cannot upsert
  BEGIN
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user_id::text,'role','authenticated')::text,true);
    PERFORM upsert_identity_provider(v_org_id,'https://evil.com','ev',false,true);
    v_fail:=v_fail+1; RAISE NOTICE 'FAIL [4]';
  EXCEPTION WHEN raise_exception THEN
    v_pass:=v_pass+1; RAISE NOTICE 'PASS [4] Non-admin blocked';
  END;

  -- [5] Non-admin cannot delete
  BEGIN
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user_id::text,'role','authenticated')::text,true);
    PERFORM delete_identity_provider(v_provider_id);
    v_fail:=v_fail+1; RAISE NOTICE 'FAIL [5]';
  EXCEPTION WHEN raise_exception THEN
    v_pass:=v_pass+1; RAISE NOTICE 'PASS [5] Non-admin delete blocked';
  END;

  -- [6] Admin can update (upsert again)
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin_id::text,'role','authenticated')::text,true);
  SELECT upsert_identity_provider(v_org_id,'https://login2.ex.com/.wk','new-client',true,true) INTO v_result;
  IF (v_result->>'updated')::boolean THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [6] Updated'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [6]'; END IF;

  -- [7] get_identity_provider_for_email returns correct provider
  SELECT get_identity_provider_for_email('u@sso-'||v_suffix||'.com') INTO v_sso_info;
  IF (v_sso_info->>'has_sso')::boolean AND v_sso_info->>'client_id'='new-client' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [7]'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [7] %',v_sso_info; END IF;

  -- [8] sso_only flag
  IF (v_sso_info->>'sso_only')::boolean THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [8] sso_only=true'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [8]'; END IF;

  -- [9] Unknown domain returns has_sso=false
  SELECT get_identity_provider_for_email('u@unk-'||v_suffix||'.com') INTO v_sso_info;
  IF NOT (v_sso_info->>'has_sso')::boolean THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [9]'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [9]'; END IF;

  -- [10] onboarding_policy in response
  SELECT get_identity_provider_for_email('u@sso-'||v_suffix||'.com') INTO v_sso_info;
  IF v_sso_info->>'onboarding_policy'='open' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [10]'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [10]'; END IF;

  -- [11] invite_only blocks auto join via route
  UPDATE organizations SET onboarding_policy='invite_only' WHERE id=v_org_id;
  DELETE FROM organization_memberships WHERE user_id=v_user_id AND organization_id=v_org_id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user_id::text,'role','authenticated')::text,true);
  SELECT route_org_for_email('u@sso-'||v_suffix||'.com') INTO v_result;
  IF v_result->>'action'='blocked' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [11]'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [11]'; END IF;

  -- [12] Audit log entries for SSO config
  SELECT count(*) INTO v_count FROM organization_audit_log WHERE organization_id=v_org_id AND action LIKE 'sso.%';
  IF v_count>=2 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [12] % audit',v_count; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [12]'; END IF;

  -- [13] Admin can delete IdP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin_id::text,'role','authenticated')::text,true);
  PERFORM delete_identity_provider(v_provider_id);
  SELECT count(*) INTO v_count FROM organization_identity_providers WHERE id=v_provider_id;
  IF v_count=0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [13] Deleted'; ELSE v_fail:=v_fail+1; RAISE NOTICE 'FAIL [13]'; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== Results: % passed, % failed (of 13) ===',v_pass,v_fail;

  DELETE FROM organization_audit_log WHERE organization_id=v_org_id;
  DELETE FROM organization_identity_providers WHERE organization_id=v_org_id;
  DELETE FROM organization_domains WHERE organization_id=v_org_id;
  DELETE FROM organization_memberships WHERE organization_id=v_org_id;
  DELETE FROM organizations WHERE id=v_org_id;
  IF v_fail>0 THEN RAISE EXCEPTION '% test(s) failed',v_fail; END IF;
END $$;
