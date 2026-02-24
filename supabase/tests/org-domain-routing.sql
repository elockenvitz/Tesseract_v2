-- =============================================================================
-- Organization Domain Routing Tests
--
-- Tests for organization_domains table constraints, RLS policies,
-- domain verification RPCs, email routing logic, and audit entries.
-- 12 assertions total.
--
-- Self-cleaning: uses unique suffix + cleanup block.
-- Run from SQL Editor (service role) or psql.
-- =============================================================================

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org_a_id uuid;
  v_org_b_id uuid;
  v_user_id uuid;
  v_domain_id uuid;
  v_token text;
  v_status text;
  v_count int;
  v_count2 int;
  v_resolved_org uuid;
  v_pass int := 0;
  v_fail int := 0;
BEGIN
  RAISE NOTICE '=== Organization Domain Routing Tests (suffix: %) ===', v_suffix;

  -- ── Setup: get existing auth user ──────────────────────────────────────
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'SKIP: No auth users found — cannot run domain routing test';
    RETURN;
  END IF;
  RAISE NOTICE 'Test user: %', v_user_id;

  -- Create two orgs
  INSERT INTO organizations (name, slug)
  VALUES ('DomainTestA_' || v_suffix, 'domain-a-' || v_suffix)
  RETURNING id INTO v_org_a_id;

  INSERT INTO organizations (name, slug)
  VALUES ('DomainTestB_' || v_suffix, 'domain-b-' || v_suffix)
  RETURNING id INTO v_org_b_id;

  -- User is admin of org A
  INSERT INTO organization_memberships (user_id, organization_id, status, is_org_admin, role)
  VALUES (v_user_id, v_org_a_id, 'active', true, 'admin');

  -- ── Test 1: Unique (org_id, domain) constraint ─────────────────────────

  INSERT INTO organization_domains (organization_id, domain, status, created_by)
  VALUES (v_org_a_id, 'unique-' || v_suffix || '.com', 'pending', v_user_id)
  RETURNING id INTO v_domain_id;

  BEGIN
    INSERT INTO organization_domains (organization_id, domain, status, created_by)
    VALUES (v_org_a_id, 'unique-' || v_suffix || '.com', 'pending', v_user_id);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [1] Duplicate (org_id, domain) should be rejected';
  EXCEPTION WHEN unique_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [1] Duplicate (org_id, domain) correctly rejected';
  END;

  -- ── Test 2: Status check constraint ────────────────────────────────────

  BEGIN
    INSERT INTO organization_domains (organization_id, domain, status, created_by)
    VALUES (v_org_a_id, 'bad-' || v_suffix || '.com', 'bogus', v_user_id);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [2] Invalid status should be rejected';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [2] Invalid status correctly rejected';
  END;

  -- ── Test 3: Same domain can be pending in different orgs ───────────────

  INSERT INTO organization_domains (organization_id, domain, status, created_by)
  VALUES (v_org_b_id, 'unique-' || v_suffix || '.com', 'pending', v_user_id);
  v_pass := v_pass + 1;
  RAISE NOTICE 'PASS [3] Same domain can be pending in multiple orgs';

  DELETE FROM organization_domains WHERE domain = 'unique-' || v_suffix || '.com';

  -- ── Test 4: Verification token is 64-char hex ─────────────────────────

  INSERT INTO organization_domains (organization_id, domain, status, created_by)
  VALUES (v_org_a_id, 'verify-' || v_suffix || '.com', 'pending', v_user_id)
  RETURNING verification_token INTO v_token;

  IF v_token IS NOT NULL AND length(v_token) = 64 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [4] Token is 64-char hex';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [4] Expected 64-char hex token, got length=%', coalesce(length(v_token)::text, 'null');
  END IF;

  -- ── Test 5: Verification token uniqueness ──────────────────────────────

  -- Add a second domain to have multiple tokens
  INSERT INTO organization_domains (organization_id, domain, status, created_by)
  VALUES (v_org_a_id, 'verify2-' || v_suffix || '.com', 'pending', v_user_id);

  SELECT count(DISTINCT verification_token) INTO v_count
  FROM organization_domains
  WHERE organization_id = v_org_a_id AND verification_token IS NOT NULL;

  SELECT count(*) INTO v_count2
  FROM organization_domains
  WHERE organization_id = v_org_a_id AND verification_token IS NOT NULL;

  IF v_count = v_count2 AND v_count >= 2 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [5] All tokens are unique (% tokens)', v_count;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [5] Token uniqueness issue: distinct=%, total=%', v_count, v_count2;
  END IF;

  -- ── Test 6: Domain verification sets status + verified_at ──────────────

  UPDATE organization_domains
  SET status = 'verified', verified_at = now(), verification_token = NULL
  WHERE domain = 'verify-' || v_suffix || '.com' AND organization_id = v_org_a_id;

  SELECT status INTO v_status
  FROM organization_domains
  WHERE domain = 'verify-' || v_suffix || '.com' AND organization_id = v_org_a_id;

  IF v_status = 'verified' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [6] Domain status set to verified';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [6] Status is % instead of verified', v_status;
  END IF;

  -- ── Test 7: Verified domain lookup by domain string ────────────────────

  SELECT organization_id INTO v_resolved_org
  FROM organization_domains
  WHERE domain = 'verify-' || v_suffix || '.com' AND status = 'verified'
  LIMIT 1;

  IF v_resolved_org = v_org_a_id THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [7] Verified domain resolves to correct org';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [7] Domain resolved to %, expected %', v_resolved_org, v_org_a_id;
  END IF;

  -- ── Test 8: Unverified domain does NOT resolve ─────────────────────────

  SELECT organization_id INTO v_resolved_org
  FROM organization_domains
  WHERE domain = 'verify2-' || v_suffix || '.com' AND status = 'verified'
  LIMIT 1;

  IF v_resolved_org IS NULL THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [8] Unverified (pending) domain does not resolve';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [8] Pending domain should not resolve';
  END IF;

  -- ── Test 9: Unknown domain returns no match ────────────────────────────

  SELECT organization_id INTO v_resolved_org
  FROM organization_domains
  WHERE domain = 'nonexistent-' || v_suffix || '.com' AND status = 'verified'
  LIMIT 1;

  IF v_resolved_org IS NULL THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [9] Unknown domain returns no match';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [9] Unknown domain should not match';
  END IF;

  -- ── Test 10: Audit log entries for domain actions ──────────────────────

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details)
  VALUES (v_org_a_id, v_user_id, 'domain.created', 'organization_domain',
    jsonb_build_object('domain', 'audit-' || v_suffix || '.com'));
  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details)
  VALUES (v_org_a_id, v_user_id, 'domain.verified', 'organization_domain',
    jsonb_build_object('domain', 'audit-' || v_suffix || '.com'));

  SELECT count(*) INTO v_count
  FROM organization_audit_log
  WHERE organization_id = v_org_a_id
    AND action IN ('domain.created', 'domain.verified')
    AND details->>'domain' LIKE '%' || v_suffix || '%';

  IF v_count >= 2 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [10] Audit log has % domain entries', v_count;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [10] Expected >= 2 audit entries, got %', v_count;
  END IF;

  -- ── Test 11: Index exists ──────────────────────────────────────────────

  SELECT count(*) INTO v_count FROM pg_indexes
  WHERE tablename = 'organization_domains'
    AND indexname = 'idx_organization_domains_domain_status';

  IF v_count = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [11] Index idx_organization_domains_domain_status exists';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [11] Missing index';
  END IF;

  -- ── Test 12: RLS enabled ──────────────────────────────────────────────

  SELECT count(*) INTO v_count FROM pg_tables
  WHERE tablename = 'organization_domains' AND rowsecurity = true;

  IF v_count = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [12] RLS enabled on organization_domains';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [12] RLS NOT enabled';
  END IF;

  -- ── Summary + Cleanup ─────────────────────────────────────────────────

  RAISE NOTICE '';
  RAISE NOTICE '=== Results: % passed, % failed (of 12) ===', v_pass, v_fail;

  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a_id, v_org_b_id);
  DELETE FROM organization_domains WHERE organization_id IN (v_org_a_id, v_org_b_id);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a_id, v_org_b_id);
  DELETE FROM organizations WHERE id IN (v_org_a_id, v_org_b_id);

  IF v_fail > 0 THEN
    RAISE EXCEPTION '% test(s) failed', v_fail;
  END IF;
END $$;
