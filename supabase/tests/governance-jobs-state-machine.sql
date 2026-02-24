-- ==========================================================================
-- Phase 16 + 16.1: Governance Jobs State Machine SQL Tests (19 assertions)
-- Tests: status CHECK, claim/complete/fail/cancel export jobs,
--        deletion primitives (claim, execute, release stale locks),
--        idempotency, exponential backoff.
-- Phase 16.1 additions: stale export lock recovery, max_attempts guard,
--        cross-org download block, deletion idempotency, cancel-vs-complete,
--        GRANT tightening.
-- Self-cleaning via _smtest suffix on names.
-- UUIDs: orgA=aaaa...f001, orgB=aaaa...f002
--         admin=bbbb...f001, platadm=bbbb...f002, adminB=bbbb...f003
-- ==========================================================================

-- ---- Setup ----

INSERT INTO organizations (id, name, slug, onboarding_policy)
VALUES
  ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'SMTestOrg_smtest', 'sm-test-org-smtest', 'invite_only'),
  ('aaaa0000-0000-0000-0000-00000000f002'::uuid, 'SMTestOrgB_smtest', 'sm-test-orgb-smtest', 'invite_only');

INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id)
VALUES
  ('bbbb0000-0000-0000-0000-00000000f001'::uuid, 'admin_smtest@firm.com', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000f002'::uuid, 'platadm_smtest@firm.com', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000f003'::uuid, 'adminb_smtest@firm.com', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status)
VALUES
  ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, true, 'active'),
  ('aaaa0000-0000-0000-0000-00000000f002'::uuid, 'bbbb0000-0000-0000-0000-00000000f003'::uuid, true, 'active');

INSERT INTO platform_admins (user_id) VALUES ('bbbb0000-0000-0000-0000-00000000f002'::uuid);

INSERT INTO organization_governance (organization_id)
VALUES
  ('aaaa0000-0000-0000-0000-00000000f001'::uuid),
  ('aaaa0000-0000-0000-0000-00000000f002'::uuid);

-- ========================================================================
-- Test 1: Status CHECK rejects invalid values
-- ========================================================================
DO $$
BEGIN
  BEGIN
    INSERT INTO org_export_jobs (organization_id, requested_by, scope, status)
    VALUES ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, 'metadata_only', 'pending');
    RAISE NOTICE 'Test 1 FAIL: pending should be rejected by CHECK';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Test 1 PASS: invalid status "pending" rejected';
  END;
END $$;

-- ========================================================================
-- Test 2: Valid statuses accepted (queued)
-- ========================================================================
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO org_export_jobs (organization_id, requested_by, scope, status)
  VALUES ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, 'metadata_only', 'queued')
  RETURNING id INTO v_id;
  ASSERT v_id IS NOT NULL, 'Test 2 FAIL: insert should succeed';
  -- cleanup
  DELETE FROM org_export_jobs WHERE id = v_id;
  RAISE NOTICE 'Test 2 PASS: queued status accepted';
END $$;

-- ========================================================================
-- Test 3: claim_next_export_job requires service_role
-- ========================================================================
DO $$
BEGIN
  -- Simulate authenticated user (not service_role)
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000f001',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM claim_next_export_job('test-worker');
    RAISE NOTICE 'Test 3 FAIL: authenticated user should not claim jobs';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 3 PASS: claim_next_export_job blocked for non-service_role';
  END;
END $$;

-- ========================================================================
-- Test 4: claim_next_export_job works for service_role
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
  v_claimed record;
  v_status text;
BEGIN
  -- Create a queued job
  INSERT INTO org_export_jobs (organization_id, requested_by, scope, status)
  VALUES ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, 'metadata_only', 'queued')
  RETURNING id INTO v_job_id;

  -- Simulate service_role
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT * INTO v_claimed FROM claim_next_export_job('test-worker-smtest');
  ASSERT v_claimed.id IS NOT NULL, 'Test 4 FAIL: expected a claimed job';
  ASSERT v_claimed.id = v_job_id, 'Test 4 FAIL: wrong job claimed';

  SELECT status INTO v_status FROM org_export_jobs WHERE id = v_job_id;
  ASSERT v_status = 'running', 'Test 4 FAIL: expected status=running, got ' || v_status;
  RAISE NOTICE 'Test 4 PASS: claim_next_export_job returned job with status=running';
END $$;

-- ========================================================================
-- Test 5: complete_export_job transitions running → succeeded
-- ========================================================================
DO $$
DECLARE
  v_job record;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Find the running job from Test 4
  SELECT id INTO v_job FROM org_export_jobs
  WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000f001'::uuid AND status = 'running'
  LIMIT 1;

  PERFORM complete_export_job(
    p_job_id := v_job.id,
    p_storage_path := 'org-exports/test/file.json',
    p_result_url := 'https://example.com/signed',
    p_expires_at := now() + interval '7 days',
    p_bytes := 1234::bigint
  );

  SELECT * INTO v_job FROM org_export_jobs WHERE id = v_job.id;
  ASSERT v_job.status = 'succeeded', 'Test 5 FAIL: expected succeeded, got ' || v_job.status;
  ASSERT v_job.result_bytes = 1234, 'Test 5 FAIL: result_bytes mismatch';
  ASSERT v_job.storage_path = 'org-exports/test/file.json', 'Test 5 FAIL: storage_path mismatch';
  RAISE NOTICE 'Test 5 PASS: complete_export_job → succeeded with metadata';
END $$;

-- ========================================================================
-- Test 6: fail_export_job increments attempt_count + sets next_attempt_at
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
  v_claimed record;
  v_job record;
BEGIN
  -- Create + claim a job
  INSERT INTO org_export_jobs (organization_id, requested_by, scope, status)
  VALUES ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, 'metadata_only', 'queued')
  RETURNING id INTO v_job_id;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT * INTO v_claimed FROM claim_next_export_job('test-worker-smtest');

  -- Fail it
  PERFORM fail_export_job(v_job_id, 'TEST_ERROR', 'Something went wrong in test');

  SELECT * INTO v_job FROM org_export_jobs WHERE id = v_job_id;
  ASSERT v_job.status = 'failed', 'Test 6 FAIL: expected failed, got ' || v_job.status;
  ASSERT v_job.attempt_count = 1, 'Test 6 FAIL: expected attempt_count=1, got ' || v_job.attempt_count;
  ASSERT v_job.error_code = 'TEST_ERROR', 'Test 6 FAIL: error_code mismatch';
  ASSERT v_job.next_attempt_at IS NOT NULL, 'Test 6 FAIL: next_attempt_at should be set for retry';
  RAISE NOTICE 'Test 6 PASS: fail_export_job → failed with retry metadata';
END $$;

-- ========================================================================
-- Test 7: cancel_export_job transitions queued → cancelled
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
  v_status text;
BEGIN
  INSERT INTO org_export_jobs (organization_id, requested_by, scope, status)
  VALUES ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, 'metadata_only', 'queued')
  RETURNING id INTO v_job_id;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000f001',
    'role', 'authenticated'
  )::text, true);

  PERFORM cancel_export_job(v_job_id);

  SELECT status INTO v_status FROM org_export_jobs WHERE id = v_job_id;
  ASSERT v_status = 'cancelled', 'Test 7 FAIL: expected cancelled, got ' || v_status;
  RAISE NOTICE 'Test 7 PASS: cancel_export_job → cancelled';
END $$;

-- ========================================================================
-- Test 8: cancel_export_job also works on failed jobs
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
  v_status text;
BEGIN
  -- Find the failed job from Test 6
  SELECT id INTO v_job_id FROM org_export_jobs
  WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000f001'::uuid AND status = 'failed'
  LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000f001',
    'role', 'authenticated'
  )::text, true);

  PERFORM cancel_export_job(v_job_id);

  SELECT status INTO v_status FROM org_export_jobs WHERE id = v_job_id;
  ASSERT v_status = 'cancelled', 'Test 8 FAIL: expected cancelled, got ' || v_status;
  RAISE NOTICE 'Test 8 PASS: cancel_export_job works on failed jobs';
END $$;

-- ========================================================================
-- Test 9: Idempotency index prevents duplicate active jobs
-- ========================================================================
DO $$
DECLARE
  v_job1 uuid;
  v_job2 uuid;
BEGIN
  INSERT INTO org_export_jobs (organization_id, requested_by, scope, status, idempotency_key)
  VALUES ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, 'metadata_only', 'queued', 'test-idem-key-smtest')
  RETURNING id INTO v_job1;

  BEGIN
    INSERT INTO org_export_jobs (organization_id, requested_by, scope, status, idempotency_key)
    VALUES ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, 'metadata_only', 'queued', 'test-idem-key-smtest')
    RETURNING id INTO v_job2;
    RAISE NOTICE 'Test 9 FAIL: duplicate idempotency_key should be rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'Test 9 PASS: idempotency index prevents duplicate active jobs';
  END;

  -- Cleanup
  DELETE FROM org_export_jobs WHERE id = v_job1;
END $$;

-- ========================================================================
-- Test 10: Deletion columns exist on organization_governance
-- ========================================================================
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'organization_governance'
    AND column_name IN ('deleted_at', 'deleted_by', 'deletion_locked_at', 'deletion_locked_by');
  ASSERT v_count = 4, 'Test 10 FAIL: expected 4 deletion columns, got ' || v_count;
  RAISE NOTICE 'Test 10 PASS: organization_governance has deletion tracking columns';
END $$;

-- ========================================================================
-- Test 11: claim_next_org_deletion requires service_role
-- ========================================================================
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000f001',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM claim_next_org_deletion('test-worker');
    RAISE NOTICE 'Test 11 FAIL: authenticated user should not claim deletions';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 11 PASS: claim_next_org_deletion blocked for non-service_role';
  END;
END $$;

-- ========================================================================
-- Test 12: execute_org_deletion requires service_role
-- ========================================================================
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000f001',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM execute_org_deletion('aaaa0000-0000-0000-0000-00000000f001'::uuid);
    RAISE NOTICE 'Test 12 FAIL: authenticated user should not execute deletion';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 12 PASS: execute_org_deletion blocked for non-service_role';
  END;
END $$;

-- ========================================================================
-- Phase 16.1 Tests (13–19)
-- ========================================================================

-- ========================================================================
-- Test 13: release_stale_export_locks recovers stuck jobs
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
  v_job record;
  v_released int;
BEGIN
  -- Create a job that simulates a crashed worker
  INSERT INTO org_export_jobs (
    organization_id, requested_by, scope, status,
    locked_at, locked_by, started_at, attempt_count
  )
  VALUES (
    'aaaa0000-0000-0000-0000-00000000f001'::uuid,
    'bbbb0000-0000-0000-0000-00000000f001'::uuid,
    'metadata_only', 'running',
    now() - interval '45 minutes',  -- stale: 45min > 30min threshold
    'crashed-worker-smtest',
    now() - interval '45 minutes',
    1
  )
  RETURNING id INTO v_job_id;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT release_stale_export_locks('30 minutes'::interval) INTO v_released;
  ASSERT v_released >= 1, 'Test 13 FAIL: expected at least 1 released lock, got ' || v_released;

  SELECT * INTO v_job FROM org_export_jobs WHERE id = v_job_id;
  ASSERT v_job.status = 'failed', 'Test 13 FAIL: expected status=failed, got ' || v_job.status;
  ASSERT v_job.error_code = 'STALE_LOCK', 'Test 13 FAIL: expected error_code=STALE_LOCK, got ' || v_job.error_code;
  ASSERT v_job.locked_at IS NULL, 'Test 13 FAIL: locked_at should be NULL';
  ASSERT v_job.locked_by IS NULL, 'Test 13 FAIL: locked_by should be NULL';
  ASSERT v_job.next_attempt_at IS NOT NULL, 'Test 13 FAIL: next_attempt_at should be set for retry';
  RAISE NOTICE 'Test 13 PASS: release_stale_export_locks recovered stuck job';
END $$;

-- ========================================================================
-- Test 14: max_attempts guard — claim skips exhausted jobs
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
  v_claimed record;
BEGIN
  -- Create a failed job that has exhausted all attempts
  INSERT INTO org_export_jobs (
    organization_id, requested_by, scope, status,
    attempt_count, max_attempts, next_attempt_at
  )
  VALUES (
    'aaaa0000-0000-0000-0000-00000000f001'::uuid,
    'bbbb0000-0000-0000-0000-00000000f001'::uuid,
    'metadata_only', 'failed',
    3, 3,  -- attempt_count = max_attempts
    now() - interval '1 hour'  -- eligible by time
  )
  RETURNING id INTO v_job_id;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Claim should NOT return this job (attempt_count >= max_attempts)
  SELECT * INTO v_claimed FROM claim_next_export_job('test-worker-smtest');

  -- v_claimed.id should be NULL or a different job
  IF v_claimed.id IS NOT NULL AND v_claimed.id = v_job_id THEN
    RAISE NOTICE 'Test 14 FAIL: exhausted job should not be claimed';
  ELSE
    RAISE NOTICE 'Test 14 PASS: claim_next_export_job skips exhausted jobs';
  END IF;

  -- Clean up the running job if we claimed something else
  IF v_claimed.id IS NOT NULL AND v_claimed.id != v_job_id THEN
    UPDATE org_export_jobs SET status = 'cancelled', finished_at = now() WHERE id = v_claimed.id;
  END IF;
  DELETE FROM org_export_jobs WHERE id = v_job_id;
END $$;

-- ========================================================================
-- Test 15: fail_export_job sets next_attempt_at = NULL at max_attempts
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
  v_claimed record;
  v_job record;
BEGIN
  -- Create job with max_attempts=1
  INSERT INTO org_export_jobs (
    organization_id, requested_by, scope, status, max_attempts
  )
  VALUES (
    'aaaa0000-0000-0000-0000-00000000f001'::uuid,
    'bbbb0000-0000-0000-0000-00000000f001'::uuid,
    'metadata_only', 'queued', 1
  )
  RETURNING id INTO v_job_id;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Claim it (attempt_count becomes 1 = max_attempts)
  SELECT * INTO v_claimed FROM claim_next_export_job('test-worker-smtest');
  ASSERT v_claimed.id = v_job_id, 'Test 15 FAIL: wrong job claimed';

  -- Fail it — should NOT schedule retry
  PERFORM fail_export_job(v_job_id, 'FINAL_FAIL', 'No more retries');

  SELECT * INTO v_job FROM org_export_jobs WHERE id = v_job_id;
  ASSERT v_job.status = 'failed', 'Test 15 FAIL: expected failed';
  ASSERT v_job.next_attempt_at IS NULL, 'Test 15 FAIL: next_attempt_at should be NULL when max_attempts exhausted, got ' || v_job.next_attempt_at;
  RAISE NOTICE 'Test 15 PASS: fail_export_job sets next_attempt_at=NULL at max_attempts';
END $$;

-- ========================================================================
-- Test 16: get_export_download_url cross-org block
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
BEGIN
  -- Create a succeeded job for Org A
  INSERT INTO org_export_jobs (
    organization_id, requested_by, scope, status,
    storage_path, result_expires_at
  )
  VALUES (
    'aaaa0000-0000-0000-0000-00000000f001'::uuid,
    'bbbb0000-0000-0000-0000-00000000f001'::uuid,
    'metadata_only', 'succeeded',
    'aaaa0000-0000-0000-0000-00000000f001/test.json',
    now() + interval '7 days'
  )
  RETURNING id INTO v_job_id;

  -- Simulate Org B admin trying to download Org A's export
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000f003',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM get_export_download_url(v_job_id);
    RAISE NOTICE 'Test 16 FAIL: Org B admin should not access Org A export';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 16 PASS: get_export_download_url blocks cross-org access';
  END;

  DELETE FROM org_export_jobs WHERE id = v_job_id;
END $$;

-- ========================================================================
-- Test 17: Deletion idempotency — second execute_org_deletion errors safely
-- ========================================================================
DO $$
DECLARE
  v_gov record;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Execute deletion on Org B (fresh org, not used by other tests)
  PERFORM execute_org_deletion('aaaa0000-0000-0000-0000-00000000f002'::uuid);

  -- Verify it worked
  SELECT deleted_at INTO v_gov FROM organization_governance
  WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000f002'::uuid;
  ASSERT v_gov.deleted_at IS NOT NULL, 'Test 17 setup FAIL: first deletion should succeed';

  -- Try again — should error
  BEGIN
    PERFORM execute_org_deletion('aaaa0000-0000-0000-0000-00000000f002'::uuid);
    RAISE NOTICE 'Test 17 FAIL: second deletion should raise exception';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 17 PASS: execute_org_deletion is idempotent (rejects double-delete)';
  END;
END $$;

-- ========================================================================
-- Test 18: Cancel then complete — complete must fail
-- ========================================================================
DO $$
DECLARE
  v_job_id uuid;
BEGIN
  -- Create and claim a job
  INSERT INTO org_export_jobs (organization_id, requested_by, scope, status)
  VALUES ('aaaa0000-0000-0000-0000-00000000f001'::uuid, 'bbbb0000-0000-0000-0000-00000000f001'::uuid, 'metadata_only', 'queued')
  RETURNING id INTO v_job_id;

  -- Cancel it directly (bypassing claim for simplicity)
  UPDATE org_export_jobs SET status = 'cancelled', finished_at = now() WHERE id = v_job_id;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Try to complete the cancelled job
  BEGIN
    PERFORM complete_export_job(
      p_job_id := v_job_id,
      p_storage_path := 'org-exports/test/cancel-conflict.json'
    );
    RAISE NOTICE 'Test 18 FAIL: should not complete a cancelled job';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 18 PASS: complete_export_job rejects cancelled job';
  END;

  DELETE FROM org_export_jobs WHERE id = v_job_id;
END $$;

-- ========================================================================
-- Test 19: release_stale_export_locks requires service_role
-- ========================================================================
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'bbbb0000-0000-0000-0000-00000000f001',
    'role', 'authenticated'
  )::text, true);

  BEGIN
    PERFORM release_stale_export_locks('30 minutes'::interval);
    RAISE NOTICE 'Test 19 FAIL: authenticated user should not release stale locks';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'Test 19 PASS: release_stale_export_locks blocked for non-service_role';
  END;
END $$;

-- ========================================================================
-- Cleanup
-- ========================================================================
DELETE FROM org_export_jobs WHERE organization_id IN (
  'aaaa0000-0000-0000-0000-00000000f001'::uuid,
  'aaaa0000-0000-0000-0000-00000000f002'::uuid
);
DELETE FROM organization_audit_log WHERE organization_id IN (
  'aaaa0000-0000-0000-0000-00000000f001'::uuid,
  'aaaa0000-0000-0000-0000-00000000f002'::uuid
);
DELETE FROM organization_governance WHERE organization_id IN (
  'aaaa0000-0000-0000-0000-00000000f001'::uuid,
  'aaaa0000-0000-0000-0000-00000000f002'::uuid
);
DELETE FROM organization_memberships WHERE organization_id IN (
  'aaaa0000-0000-0000-0000-00000000f001'::uuid,
  'aaaa0000-0000-0000-0000-00000000f002'::uuid
);
DELETE FROM platform_admins WHERE user_id = 'bbbb0000-0000-0000-0000-00000000f002'::uuid;
DELETE FROM auth.users WHERE id IN (
  'bbbb0000-0000-0000-0000-00000000f001'::uuid,
  'bbbb0000-0000-0000-0000-00000000f002'::uuid,
  'bbbb0000-0000-0000-0000-00000000f003'::uuid
);
DELETE FROM organizations WHERE id IN (
  'aaaa0000-0000-0000-0000-00000000f001'::uuid,
  'aaaa0000-0000-0000-0000-00000000f002'::uuid
);
