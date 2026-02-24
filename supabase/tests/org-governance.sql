-- ==========================================================================
-- Phase 13B: Organization Governance SQL Tests (16 assertions)
-- Tests: governance table, set_org_governance, schedule/cancel deletion,
--        archive_org, request_org_export, apply_audit_log_retention,
--        legal hold blocking, platform admin gating, audit log entries.
-- Self-cleaning via _govtest suffix on names.
-- UUIDs: org=aaa...e001, admin=bbb...e001, platadm=bbb...e002, regular=bbb...e003
-- ==========================================================================

-- ---- Setup: create ephemeral org, users, memberships ----

INSERT INTO organizations (id, name, slug, onboarding_policy)
VALUES ('aaaa0000-0000-0000-0000-00000000e001'::uuid, 'GovTestOrg_govtest', 'gov-test-org-govtest', 'invite_only');

-- auth.users (trigger on_auth_user_created auto-creates public.users rows)
INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id)
VALUES
  ('bbbb0000-0000-0000-0000-00000000e001'::uuid, 'admin_govtest@firm.com', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000e002'::uuid, 'platadm_govtest@firm.com', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000e003'::uuid, 'regular_govtest@firm.com', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status)
VALUES ('aaaa0000-0000-0000-0000-00000000e001'::uuid, 'bbbb0000-0000-0000-0000-00000000e001'::uuid, true, 'active');

INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status)
VALUES ('aaaa0000-0000-0000-0000-00000000e001'::uuid, 'bbbb0000-0000-0000-0000-00000000e003'::uuid, false, 'active');

INSERT INTO platform_admins (user_id) VALUES ('bbbb0000-0000-0000-0000-00000000e002'::uuid);

-- ========================================================================
-- Test 1: organization_governance table exists with correct columns
-- ========================================================================
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'organization_governance'
    AND column_name IN ('organization_id','retention_days_audit_log','legal_hold','deletion_scheduled_at','archived_at','archived_by');
  ASSERT v_count = 6, 'Test 1 FAIL: expected 6 governance columns, got ' || v_count;
  RAISE NOTICE 'Test 1 PASS: organization_governance has all expected columns';
END $$;

-- ========================================================================
-- Test 2: Default retention_days is 365
-- ========================================================================
DO $$
DECLARE v_days int;
BEGIN
  INSERT INTO organization_governance (organization_id)
  VALUES ('aaaa0000-0000-0000-0000-00000000e001'::uuid)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT retention_days_audit_log INTO v_days
  FROM organization_governance WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
  ASSERT v_days = 365, 'Test 2 FAIL: expected default 365, got ' || v_days;
  RAISE NOTICE 'Test 2 PASS: default retention_days_audit_log is 365';
END $$;

-- ========================================================================
-- Test 3: Org admin can set retention_days via set_org_governance
-- ========================================================================
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e001',
    'role', 'authenticated'
  )::text, true);

  SELECT set_org_governance(
    'aaaa0000-0000-0000-0000-00000000e001'::uuid,
    p_retention_days := 180
  ) INTO v_result;
  ASSERT (v_result->>'retention_days_audit_log')::int = 180,
    'Test 3 FAIL: expected 180, got ' || (v_result->>'retention_days_audit_log');
  RAISE NOTICE 'Test 3 PASS: org admin set retention to 180';
END $$;

-- ========================================================================
-- Test 4: Org admin CANNOT toggle legal_hold (platform admin only)
-- ========================================================================
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e001',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM set_org_governance(
      'aaaa0000-0000-0000-0000-00000000e001'::uuid,
      p_legal_hold := true
    );
    RAISE NOTICE 'Test 4 FAIL: org admin should not toggle legal_hold';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 4 PASS: org admin cannot toggle legal_hold';
  END;
END $$;

-- ========================================================================
-- Test 5: Platform admin CAN toggle legal_hold
-- ========================================================================
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e002',
    'role', 'authenticated'
  )::text, true);

  SELECT set_org_governance(
    'aaaa0000-0000-0000-0000-00000000e001'::uuid,
    p_legal_hold := true
  ) INTO v_result;
  ASSERT (v_result->>'legal_hold')::boolean = true,
    'Test 5 FAIL: expected legal_hold=true';
  RAISE NOTICE 'Test 5 PASS: platform admin set legal_hold=true';
END $$;

-- ========================================================================
-- Test 6: Cannot schedule deletion when under legal hold
-- ========================================================================
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e002',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM schedule_org_deletion(
      'aaaa0000-0000-0000-0000-00000000e001'::uuid,
      now() + interval '30 days'
    );
    RAISE NOTICE 'Test 6 FAIL: should block deletion under legal hold';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 6 PASS: deletion blocked by legal hold';
  END;
END $$;

-- ========================================================================
-- Test 7: Remove legal hold, then schedule deletion succeeds
-- ========================================================================
DO $$
DECLARE v_sched timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e002',
    'role', 'authenticated'
  )::text, true);

  PERFORM set_org_governance(
    'aaaa0000-0000-0000-0000-00000000e001'::uuid,
    p_legal_hold := false
  );

  PERFORM schedule_org_deletion(
    'aaaa0000-0000-0000-0000-00000000e001'::uuid,
    now() + interval '30 days'
  );

  SELECT deletion_scheduled_at INTO v_sched
  FROM organization_governance WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
  ASSERT v_sched IS NOT NULL, 'Test 7 FAIL: deletion_scheduled_at should be set';
  RAISE NOTICE 'Test 7 PASS: deletion scheduled after removing legal hold';
END $$;

-- ========================================================================
-- Test 8: cancel_org_deletion clears the schedule
-- ========================================================================
DO $$
DECLARE v_sched timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e002',
    'role', 'authenticated'
  )::text, true);

  PERFORM cancel_org_deletion('aaaa0000-0000-0000-0000-00000000e001'::uuid);

  SELECT deletion_scheduled_at INTO v_sched
  FROM organization_governance WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
  ASSERT v_sched IS NULL, 'Test 8 FAIL: deletion_scheduled_at should be NULL';
  RAISE NOTICE 'Test 8 PASS: cancel_org_deletion cleared schedule';
END $$;

-- ========================================================================
-- Test 9: archive_org sets archived_at + archived_by
-- ========================================================================
DO $$
DECLARE
  v_at timestamptz;
  v_by uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e002',
    'role', 'authenticated'
  )::text, true);

  PERFORM archive_org('aaaa0000-0000-0000-0000-00000000e001'::uuid);

  SELECT archived_at, archived_by INTO v_at, v_by
  FROM organization_governance WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
  ASSERT v_at IS NOT NULL, 'Test 9 FAIL: archived_at should be set';
  ASSERT v_by = 'bbbb0000-0000-0000-0000-00000000e002'::uuid, 'Test 9 FAIL: archived_by mismatch';
  RAISE NOTICE 'Test 9 PASS: archive_org sets archived_at + archived_by';
END $$;

-- ========================================================================
-- Test 10: is_org_archived returns true for archived org
-- ========================================================================
DO $$
DECLARE v_archived boolean;
BEGIN
  SELECT is_org_archived('aaaa0000-0000-0000-0000-00000000e001'::uuid) INTO v_archived;
  ASSERT v_archived = true, 'Test 10 FAIL: expected is_org_archived=true';
  RAISE NOTICE 'Test 10 PASS: is_org_archived returns true';
END $$;

-- ========================================================================
-- Test 11: Regular member cannot call set_org_governance
-- ========================================================================
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e003',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM set_org_governance(
      'aaaa0000-0000-0000-0000-00000000e001'::uuid,
      p_retention_days := 90
    );
    RAISE NOTICE 'Test 11 FAIL: regular member should not call set_org_governance';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 11 PASS: regular member blocked from set_org_governance';
  END;
END $$;

-- ========================================================================
-- Test 12: Non-platform-admin cannot call archive_org
-- ========================================================================
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e001',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM archive_org('aaaa0000-0000-0000-0000-00000000e001'::uuid);
    RAISE NOTICE 'Test 12 FAIL: org admin should not call archive_org';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 12 PASS: non-platform-admin blocked from archive_org';
  END;
END $$;

-- ========================================================================
-- Test 13: request_org_export creates a job and returns uuid
-- ========================================================================
DO $$
DECLARE v_job_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e001',
    'role', 'authenticated'
  )::text, true);

  SELECT request_org_export(
    'aaaa0000-0000-0000-0000-00000000e001'::uuid,
    'metadata_only'
  ) INTO v_job_id;
  ASSERT v_job_id IS NOT NULL, 'Test 13 FAIL: expected a job uuid';

  ASSERT EXISTS (
    SELECT 1 FROM org_export_jobs WHERE id = v_job_id AND status = 'queued'
  ), 'Test 13 FAIL: job row not found or wrong status';
  RAISE NOTICE 'Test 13 PASS: request_org_export created job %', v_job_id;
END $$;

-- ========================================================================
-- Test 14: apply_audit_log_retention skips orgs under legal hold
-- ========================================================================
DO $$
DECLARE
  v_result jsonb;
  v_pre_count int;
  v_post_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e002',
    'role', 'authenticated'
  )::text, true);

  -- Set minimum retention (30 days) + enable legal hold
  PERFORM set_org_governance(
    'aaaa0000-0000-0000-0000-00000000e001'::uuid,
    p_retention_days := 30,
    p_legal_hold := true
  );

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details, created_at)
  VALUES ('aaaa0000-0000-0000-0000-00000000e001'::uuid, 'bbbb0000-0000-0000-0000-00000000e002'::uuid,
    'test.old_entry_govtest', 'organization', '{}', now() - interval '400 days');

  SELECT count(*) INTO v_pre_count
  FROM organization_audit_log
  WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid
    AND action = 'test.old_entry_govtest';

  SELECT apply_audit_log_retention() INTO v_result;

  SELECT count(*) INTO v_post_count
  FROM organization_audit_log
  WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid
    AND action = 'test.old_entry_govtest';

  ASSERT v_post_count = v_pre_count, 'Test 14 FAIL: legal hold should prevent deletion, pre=' || v_pre_count || ' post=' || v_post_count;
  RAISE NOTICE 'Test 14 PASS: apply_audit_log_retention skipped org under legal hold';
END $$;

-- ========================================================================
-- Test 15: apply_audit_log_retention deletes old entries when no legal hold
-- ========================================================================
DO $$
DECLARE
  v_result jsonb;
  v_post_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000e002',
    'role', 'authenticated'
  )::text, true);

  PERFORM set_org_governance(
    'aaaa0000-0000-0000-0000-00000000e001'::uuid,
    p_legal_hold := false
  );

  SELECT apply_audit_log_retention() INTO v_result;

  SELECT count(*) INTO v_post_count
  FROM organization_audit_log
  WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid
    AND action = 'test.old_entry_govtest';

  ASSERT v_post_count = 0, 'Test 15 FAIL: old entry should be deleted, got ' || v_post_count;
  RAISE NOTICE 'Test 15 PASS: apply_audit_log_retention deleted old entries';
END $$;

-- ========================================================================
-- Test 16: Audit log entries created for governance actions
-- ========================================================================
DO $$
DECLARE v_actions text[];
BEGIN
  SELECT array_agg(DISTINCT action ORDER BY action) INTO v_actions
  FROM organization_audit_log
  WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid
    AND (action LIKE '%gov%' OR action LIKE '%legal%' OR action LIKE '%archive%'
    OR action LIKE '%deletion%' OR action LIKE '%export%' OR action LIKE '%retention%');

  ASSERT 'governance.updated' = ANY(v_actions), 'Test 16 FAIL: missing governance.updated audit entry';
  ASSERT 'legal_hold.toggled' = ANY(v_actions), 'Test 16 FAIL: missing legal_hold.toggled audit entry';
  ASSERT 'org.archived' = ANY(v_actions), 'Test 16 FAIL: missing org.archived audit entry';
  ASSERT 'org.deletion_scheduled' = ANY(v_actions), 'Test 16 FAIL: missing org.deletion_scheduled audit entry';
  ASSERT 'org.deletion_cancelled' = ANY(v_actions), 'Test 16 FAIL: missing org.deletion_cancelled audit entry';
  ASSERT 'export.requested' = ANY(v_actions), 'Test 16 FAIL: missing export.requested audit entry';
  RAISE NOTICE 'Test 16 PASS: all expected audit log actions found: %', v_actions;
END $$;

-- ========================================================================
-- Cleanup: remove all test data
-- ========================================================================
DELETE FROM org_export_jobs WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
DELETE FROM organization_audit_log WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
DELETE FROM organization_governance WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
DELETE FROM organization_memberships WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
DELETE FROM platform_admins WHERE user_id = 'bbbb0000-0000-0000-0000-00000000e002'::uuid;
-- auth.users deletion cascades to public.users via trigger/FK
DELETE FROM auth.users WHERE id IN (
  'bbbb0000-0000-0000-0000-00000000e001'::uuid,
  'bbbb0000-0000-0000-0000-00000000e002'::uuid,
  'bbbb0000-0000-0000-0000-00000000e003'::uuid
);
DELETE FROM organizations WHERE id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
