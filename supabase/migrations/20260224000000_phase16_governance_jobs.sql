-- ============================================================================
-- Phase 16 + 16.1: Governance Jobs State Machine
-- Consolidated, idempotent migration for local reproducibility.
--
-- Phase 16:  Status CHECK, 18 new columns, 8 RPCs, 3 indexes, storage bucket
-- Phase 16.1: Stale export lock recovery RPC, GRANT hardening, trigger bypass
--             for org deletion, fail_export_job max_attempts guard
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Status CHECK migration on org_export_jobs
-- ---------------------------------------------------------------------------
-- Data migration: rename old statuses
UPDATE org_export_jobs SET status = 'queued'    WHERE status = 'pending';
UPDATE org_export_jobs SET status = 'succeeded' WHERE status = 'completed';

-- Drop old CHECK and create new one (idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE org_export_jobs DROP CONSTRAINT IF EXISTS org_export_jobs_status_check;
  ALTER TABLE org_export_jobs ADD CONSTRAINT org_export_jobs_status_check
    CHECK (status IN ('queued','running','succeeded','failed','cancelled'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. New columns on org_export_jobs (14 added)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz DEFAULT now();
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS locked_at timestamptz;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS locked_by text;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS error_code text;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS error_message text;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS result_url text;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS storage_path text;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS result_expires_at timestamptz;
  ALTER TABLE org_export_jobs ADD COLUMN IF NOT EXISTS result_bytes bigint;
END $$;

-- ---------------------------------------------------------------------------
-- 3. New columns on organization_governance (4 added)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE organization_governance ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  ALTER TABLE organization_governance ADD COLUMN IF NOT EXISTS deleted_by uuid;
  ALTER TABLE organization_governance ADD COLUMN IF NOT EXISTS deletion_locked_at timestamptz;
  ALTER TABLE organization_governance ADD COLUMN IF NOT EXISTS deletion_locked_by text;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_export_jobs_claim
  ON org_export_jobs (status, next_attempt_at)
  WHERE status IN ('queued','failed');

CREATE INDEX IF NOT EXISTS idx_export_jobs_org_created
  ON org_export_jobs (organization_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_export_jobs_idempotency
  ON org_export_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Storage bucket for export artifacts
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-exports', 'org-exports', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. RPCs — Phase 16 (8) + Phase 16.1 (1 new + 2 updated triggers)
-- ---------------------------------------------------------------------------

-- 6a. claim_next_export_job
CREATE OR REPLACE FUNCTION public.claim_next_export_job(
  p_worker_id text,
  p_limit integer DEFAULT 1
)
RETURNS SETOF org_export_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM org_export_jobs
    WHERE status IN ('queued', 'failed')
      AND next_attempt_at <= now()
      AND attempt_count < max_attempts
    ORDER BY next_attempt_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE org_export_jobs j
  SET
    status = 'running',
    locked_at = now(),
    locked_by = p_worker_id,
    started_at = COALESCE(j.started_at, now()),
    attempt_count = j.attempt_count + 1,
    updated_at = now()
  FROM claimed c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$function$;

-- 6b. complete_export_job
CREATE OR REPLACE FUNCTION public.complete_export_job(
  p_job_id uuid,
  p_storage_path text,
  p_result_url text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT now() + interval '7 days',
  p_bytes bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_job org_export_jobs;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_job FROM org_export_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF v_job.status != 'running' THEN RAISE EXCEPTION 'Job is not running (status=%)', v_job.status; END IF;

  UPDATE org_export_jobs SET
    status = 'succeeded',
    storage_path = p_storage_path,
    result_url = p_result_url,
    result_expires_at = p_expires_at,
    result_bytes = p_bytes,
    finished_at = now(),
    file_path = p_storage_path,
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now()
  WHERE id = p_job_id;

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_job.organization_id, NULL, 'export.succeeded', 'org_export_job', p_job_id,
    jsonb_build_object(
      'attempt_count', v_job.attempt_count,
      'bytes', p_bytes,
      'scope', v_job.scope,
      'storage_path', p_storage_path
    ));
END;
$function$;

-- 6c. fail_export_job (Phase 16.1E: max_attempts guard)
CREATE OR REPLACE FUNCTION public.fail_export_job(
  p_job_id uuid,
  p_error_code text DEFAULT 'UNKNOWN',
  p_error_message text DEFAULT '',
  p_retry_in_seconds integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_job org_export_jobs;
  v_retry_interval interval;
  v_next_attempt timestamptz;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_job FROM org_export_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF v_job.status != 'running' THEN RAISE EXCEPTION 'Job is not running (status=%)', v_job.status; END IF;

  -- Only schedule retry if under max_attempts
  IF v_job.attempt_count < v_job.max_attempts THEN
    IF p_retry_in_seconds IS NOT NULL THEN
      v_retry_interval := (p_retry_in_seconds || ' seconds')::interval;
    ELSE
      -- Exponential backoff: 5min * 2^(attempt-1), capped at 1 hour
      v_retry_interval := LEAST(
        (300 * power(2, v_job.attempt_count - 1))::int || ' seconds',
        '3600 seconds'
      )::interval;
    END IF;
    v_next_attempt := now() + v_retry_interval;
  ELSE
    v_next_attempt := NULL;  -- No more retries
  END IF;

  UPDATE org_export_jobs SET
    status = 'failed',
    error_code = p_error_code,
    error_message = p_error_message,
    error = p_error_message,
    finished_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    next_attempt_at = v_next_attempt,
    updated_at = now()
  WHERE id = p_job_id;

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_job.organization_id, NULL, 'export.failed', 'org_export_job', p_job_id,
    jsonb_build_object(
      'attempt_count', v_job.attempt_count,
      'error_code', p_error_code,
      'error_message', left(p_error_message, 500),
      'retryable', v_job.attempt_count < v_job.max_attempts
    ));
END;
$function$;

-- 6d. cancel_export_job
CREATE OR REPLACE FUNCTION public.cancel_export_job(
  p_job_id uuid,
  p_reason text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_job org_export_jobs;
  v_caller uuid := auth.uid();
  v_is_authorized boolean;
BEGIN
  SELECT * INTO v_job FROM org_export_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF v_job.status NOT IN ('queued', 'failed') THEN
    RAISE EXCEPTION 'Can only cancel queued or failed jobs (status=%)', v_job.status;
  END IF;

  -- Check authorization: org admin or platform admin
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = v_job.organization_id AND user_id = v_caller
      AND is_org_admin = true AND status = 'active'
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Not authorized to cancel this job';
  END IF;

  UPDATE org_export_jobs SET
    status = 'cancelled',
    finished_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    error_message = p_reason,
    updated_at = now()
  WHERE id = p_job_id;

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_job.organization_id, v_caller, 'export.cancelled', 'org_export_job', p_job_id,
    jsonb_build_object('reason', p_reason));
END;
$function$;

-- 6e. get_export_download_url
CREATE OR REPLACE FUNCTION public.get_export_download_url(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_job org_export_jobs;
  v_caller uuid := auth.uid();
  v_is_authorized boolean;
BEGIN
  SELECT * INTO v_job FROM org_export_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF v_job.status != 'succeeded' THEN RAISE EXCEPTION 'Job not completed'; END IF;
  IF v_job.storage_path IS NULL THEN RAISE EXCEPTION 'No export file'; END IF;
  IF v_job.result_expires_at IS NOT NULL AND v_job.result_expires_at < now() THEN
    RAISE EXCEPTION 'Export has expired';
  END IF;

  -- Check authorization
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = v_job.organization_id AND user_id = v_caller
      AND is_org_admin = true AND status = 'active'
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN v_job.storage_path;
END;
$function$;

-- 6f. request_org_export
CREATE OR REPLACE FUNCTION public.request_org_export(
  p_org_id uuid,
  p_scope text DEFAULT 'metadata_only'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_authorized boolean;
  v_job_id uuid;
BEGIN
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = p_org_id AND user_id = v_caller
      AND is_org_admin = true AND status = 'active'
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO org_export_jobs (organization_id, requested_by, scope)
  VALUES (p_org_id, v_caller, p_scope)
  RETURNING id INTO v_job_id;

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (p_org_id, v_caller, 'export.requested', 'org_export_job', v_job_id,
    jsonb_build_object('scope', p_scope));

  RETURN v_job_id;
END;
$function$;

-- 6g. set_org_governance
CREATE OR REPLACE FUNCTION public.set_org_governance(
  p_org_id uuid,
  p_retention_days integer DEFAULT NULL,
  p_legal_hold boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_org_admin boolean;
  v_is_platform boolean;
  v_gov organization_governance%ROWTYPE;
BEGIN
  SELECT is_platform_admin() INTO v_is_platform;

  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = p_org_id AND user_id = v_caller
      AND is_org_admin = true AND status = 'active'
  ) INTO v_is_org_admin;

  IF NOT v_is_org_admin AND NOT v_is_platform THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_legal_hold IS NOT NULL AND NOT v_is_platform THEN
    RAISE EXCEPTION 'Legal hold can only be toggled by platform admin';
  END IF;

  INSERT INTO organization_governance (organization_id)
  VALUES (p_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  IF p_retention_days IS NOT NULL THEN
    UPDATE organization_governance SET retention_days_audit_log = p_retention_days, updated_at = now()
    WHERE organization_id = p_org_id;
  END IF;

  IF p_legal_hold IS NOT NULL THEN
    UPDATE organization_governance SET legal_hold = p_legal_hold, updated_at = now()
    WHERE organization_id = p_org_id;

    INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details)
    VALUES (p_org_id, v_caller, 'legal_hold.toggled', 'organization',
      jsonb_build_object('legal_hold', p_legal_hold));
  END IF;

  IF p_retention_days IS NOT NULL THEN
    INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details)
    VALUES (p_org_id, v_caller, 'governance.updated', 'organization',
      jsonb_build_object('retention_days_audit_log', p_retention_days));
  END IF;

  SELECT * INTO v_gov FROM organization_governance WHERE organization_id = p_org_id;

  RETURN jsonb_build_object(
    'retention_days_audit_log', v_gov.retention_days_audit_log,
    'legal_hold', v_gov.legal_hold,
    'archived_at', v_gov.archived_at,
    'deletion_scheduled_at', v_gov.deletion_scheduled_at
  );
END;
$function$;

-- 6h. claim_next_org_deletion
CREATE OR REPLACE FUNCTION public.claim_next_org_deletion(
  p_worker_id text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(organization_id uuid, org_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT g.organization_id
    FROM organization_governance g
    WHERE g.deletion_scheduled_at <= now()
      AND g.legal_hold = false
      AND g.deleted_at IS NULL
      AND g.deletion_locked_at IS NULL
    ORDER BY g.deletion_scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF g SKIP LOCKED
  )
  UPDATE organization_governance gov
  SET
    deletion_locked_at = now(),
    deletion_locked_by = p_worker_id,
    updated_at = now()
  FROM claimed c
  WHERE gov.organization_id = c.organization_id
  RETURNING gov.organization_id,
    (SELECT o.name FROM organizations o WHERE o.id = gov.organization_id) AS org_name;
END;
$function$;

-- 6i. execute_org_deletion (Phase 16.1: trigger bypass + reordered steps)
CREATE OR REPLACE FUNCTION public.execute_org_deletion(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_gov organization_governance;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_gov FROM organization_governance WHERE organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Governance record not found for org %', p_org_id; END IF;
  IF v_gov.legal_hold THEN RAISE EXCEPTION 'Cannot delete org under legal hold'; END IF;
  IF v_gov.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Org already deleted'; END IF;

  -- Set bypass flag for safety triggers (transaction-local)
  PERFORM set_config('app.executing_org_deletion', 'true', true);

  -- 1. Deactivate all memberships
  UPDATE organization_memberships SET status = 'inactive', updated_at = now()
  WHERE organization_id = p_org_id AND status = 'active';

  -- 2. Delete domain routing
  DELETE FROM organization_domains WHERE organization_id = p_org_id;

  -- 3. Disable SSO
  UPDATE organization_identity_providers SET enabled = false
  WHERE organization_id = p_org_id;

  -- 4. Cancel pending invites
  UPDATE organization_invites SET status = 'cancelled'
  WHERE organization_id = p_org_id AND status IN ('pending', 'sent');

  -- 5. Cancel pending export jobs
  UPDATE org_export_jobs SET status = 'cancelled', finished_at = now(), updated_at = now()
  WHERE organization_id = p_org_id AND status IN ('queued', 'failed');

  -- 6. Audit log entry
  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (p_org_id, NULL, 'org.deletion_executed', 'organization', p_org_id,
    jsonb_build_object('soft_delete', true));

  -- 7. Set archived_at + deleted_at on governance (sets the archive flag LAST)
  UPDATE organization_governance SET
    archived_at = COALESCE(archived_at, now()),
    deleted_at = now(),
    deleted_by = NULL,
    deletion_locked_at = NULL,
    deletion_locked_by = NULL,
    updated_at = now()
  WHERE organization_id = p_org_id;

  -- Clear bypass flag
  PERFORM set_config('app.executing_org_deletion', '', true);
END;
$function$;

-- 6j. release_stale_deletion_locks
CREATE OR REPLACE FUNCTION public.release_stale_deletion_locks(
  p_stale_minutes integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  UPDATE organization_governance
  SET deletion_locked_at = NULL, deletion_locked_by = NULL, updated_at = now()
  WHERE deletion_locked_at IS NOT NULL
    AND deletion_locked_at < now() - (p_stale_minutes || ' minutes')::interval
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 6k. release_stale_export_locks (Phase 16.1A — NEW)
CREATE OR REPLACE FUNCTION public.release_stale_export_locks(
  p_max_age interval DEFAULT interval '30 minutes'
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
  v_job record;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  -- Find and transition stale running jobs to failed
  WITH stale AS (
    SELECT id, organization_id
    FROM org_export_jobs
    WHERE status = 'running'
      AND locked_at IS NOT NULL
      AND locked_at < now() - p_max_age
    FOR UPDATE SKIP LOCKED
  )
  UPDATE org_export_jobs j
  SET
    status = 'failed',
    error_code = 'STALE_LOCK',
    error_message = 'Export job lock expired due to worker timeout',
    finished_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    next_attempt_at = CASE
      WHEN j.attempt_count < j.max_attempts THEN now()
      ELSE NULL
    END,
    updated_at = now()
  FROM stale s
  WHERE j.id = s.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Audit each released lock
  IF v_count > 0 THEN
    INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
    SELECT
      j.organization_id, NULL, 'export.stale_lock_released', 'org_export_job', j.id,
      jsonb_build_object(
        'attempt_count', j.attempt_count,
        'max_attempts', j.max_attempts,
        'error_code', 'STALE_LOCK'
      )
    FROM org_export_jobs j
    WHERE j.status = 'failed'
      AND j.error_code = 'STALE_LOCK'
      AND j.updated_at >= now() - interval '5 seconds';
  END IF;

  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Trigger updates (Phase 16.1: bypass during org deletion)
-- ---------------------------------------------------------------------------

-- 7a. enforce_org_not_archived — add bypass for app.executing_org_deletion
CREATE OR REPLACE FUNCTION public.enforce_org_not_archived()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
BEGIN
  -- Bypass during org deletion (privileged operation)
  IF current_setting('app.executing_org_deletion', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_org_id := OLD.organization_id;
  ELSE
    v_org_id := NEW.organization_id;
  END IF;

  IF v_org_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF is_org_archived(v_org_id) THEN
    RAISE EXCEPTION 'Organization is archived. No modifications allowed.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- 7b. prevent_last_org_admin_removal — add bypass for app.executing_org_deletion
CREATE OR REPLACE FUNCTION public.prevent_last_org_admin_removal()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  active_admin_count integer;
BEGIN
  -- Bypass during org deletion (privileged operation)
  IF current_setting('app.executing_org_deletion', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF (
    (OLD.is_org_admin = true AND NEW.is_org_admin = false)
    OR (OLD.status = 'active' AND NEW.status != 'active' AND OLD.is_org_admin = true)
  ) THEN
    SELECT count(*)
    INTO active_admin_count
    FROM organization_memberships
    WHERE organization_id = OLD.organization_id
      AND is_org_admin = true
      AND status = 'active'
      AND id != OLD.id;

    IF active_admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last active admin from an organization. Promote another user to admin first.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. GRANT/REVOKE hardening (Phase 16.1B)
-- ---------------------------------------------------------------------------

-- Service-role-only RPCs
REVOKE ALL ON FUNCTION claim_next_export_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_next_export_job(text, integer) FROM anon;
REVOKE ALL ON FUNCTION claim_next_export_job(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_next_export_job(text, integer) TO service_role;

REVOKE ALL ON FUNCTION complete_export_job(uuid, text, text, timestamptz, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_export_job(uuid, text, text, timestamptz, bigint) FROM anon;
REVOKE ALL ON FUNCTION complete_export_job(uuid, text, text, timestamptz, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION complete_export_job(uuid, text, text, timestamptz, bigint) TO service_role;

REVOKE ALL ON FUNCTION fail_export_job(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_export_job(uuid, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION fail_export_job(uuid, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION fail_export_job(uuid, text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION claim_next_org_deletion(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_next_org_deletion(text, integer) FROM anon;
REVOKE ALL ON FUNCTION claim_next_org_deletion(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_next_org_deletion(text, integer) TO service_role;

REVOKE ALL ON FUNCTION execute_org_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION execute_org_deletion(uuid) FROM anon;
REVOKE ALL ON FUNCTION execute_org_deletion(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION execute_org_deletion(uuid) TO service_role;

REVOKE ALL ON FUNCTION release_stale_deletion_locks(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_stale_deletion_locks(integer) FROM anon;
REVOKE ALL ON FUNCTION release_stale_deletion_locks(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION release_stale_deletion_locks(integer) TO service_role;

REVOKE ALL ON FUNCTION release_stale_export_locks(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_stale_export_locks(interval) FROM anon;
REVOKE ALL ON FUNCTION release_stale_export_locks(interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION release_stale_export_locks(interval) TO service_role;

-- Authenticated RPCs (org admin check inside function)
REVOKE ALL ON FUNCTION cancel_export_job(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_export_job(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_export_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_export_job(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION get_export_download_url(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_export_download_url(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_export_download_url(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_export_download_url(uuid) TO service_role;
