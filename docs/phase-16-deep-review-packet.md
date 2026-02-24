# Phase 16 Deep Review Packet — Governance Jobs Actually Run

**Generated**: 2026-02-23
**Reviewer focus**: Atomicity, idempotency, tenant-safety, download security

---

## SECTION 0 — Repo + Environment

| Item | Value |
|------|-------|
| **Commit** | `5a7e2cb85e830f7e8933fd97186b5a38c267ac4c` |
| **Branch** | `project-adjustment` |
| **Supabase project ref** | `wfcebeagznzgeuyysbnt` |
| **Supabase URL** | `https://wfcebeagznzgeuyysbnt.supabase.co` |
| **Migration version** | `20260224015108` / `phase16_governance_jobs_state_machine` |

### Phase 16 Files Changed/Added

| File | Status |
|------|--------|
| `src/components/organization/OrgGovernanceSection.tsx` | Modified |
| `src/pages/AdminConsolePage.tsx` | Modified |
| `supabase/tests/governance-jobs-state-machine.sql` | **NEW** |
| `supabase/tests/org-governance.sql` | Modified (Test 13 status fix) |
| Edge Function `export-jobs-runner` | **NEW** (deployed, ACTIVE) |
| Edge Function `org-deletion-runner` | **NEW** (deployed, ACTIVE) |
| Migration `phase16_governance_jobs_state_machine` | Applied |

---

## SECTION 1 — DB Schema (Verbatim)

### 1.1 `org_export_jobs` Table

**Columns** (queried from `information_schema.columns`):

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| `id` | uuid | `gen_random_uuid()` | NO |
| `organization_id` | uuid | — | NO |
| `requested_by` | uuid | — | NO |
| `status` | text | `'queued'` | NO |
| `scope` | text | `'metadata_only'` | NO |
| `file_path` | text | — | YES |
| `error` | text | — | YES |
| `created_at` | timestamptz | `now()` | NO |
| `updated_at` | timestamptz | `now()` | NO |
| `completed_at` | timestamptz | — | YES |
| `idempotency_key` | text | — | YES |
| `attempt_count` | integer | `0` | NO |
| `max_attempts` | integer | `3` | NO |
| `next_attempt_at` | timestamptz | `now()` | YES |
| `locked_at` | timestamptz | — | YES |
| `locked_by` | text | — | YES |
| `started_at` | timestamptz | — | YES |
| `finished_at` | timestamptz | — | YES |
| `error_code` | text | — | YES |
| `error_message` | text | — | YES |
| `result_url` | text | — | YES |
| `storage_path` | text | — | YES |
| `result_expires_at` | timestamptz | — | YES |
| `result_bytes` | bigint | — | YES |

**Constraints** (verbatim from `pg_constraint`):

```sql
-- Primary key
PRIMARY KEY (id)

-- Foreign keys
FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
FOREIGN KEY (requested_by) REFERENCES auth.users(id)

-- CHECK constraints
CHECK ((scope = ANY (ARRAY['metadata_only'::text, 'full'::text])))
CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
```

**Indexes** (verbatim from `pg_indexes`):

```sql
CREATE UNIQUE INDEX org_export_jobs_pkey
  ON public.org_export_jobs USING btree (id);

CREATE INDEX idx_export_jobs_claim
  ON public.org_export_jobs USING btree (status, next_attempt_at)
  WHERE (status = ANY (ARRAY['queued'::text, 'failed'::text]));

CREATE INDEX idx_export_jobs_org_created
  ON public.org_export_jobs USING btree (organization_id, created_at DESC);

CREATE UNIQUE INDEX idx_export_jobs_idempotency
  ON public.org_export_jobs USING btree (idempotency_key)
  WHERE (idempotency_key IS NOT NULL);

CREATE INDEX idx_export_jobs_org
  ON public.org_export_jobs USING btree (organization_id);
```

**RLS Policies** (verbatim from `pg_policies`):

```sql
-- SELECT: org admin within current org context
export_select: PERMISSIVE, roles={authenticated}, cmd=SELECT
  qual: (organization_id = current_org_id()) AND EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_memberships.organization_id = org_export_jobs.organization_id
      AND organization_memberships.user_id = auth.uid()
      AND organization_memberships.is_org_admin = true
      AND organization_memberships.status = 'active'::text
  )

-- SELECT: platform admin bypass
export_select_platform: PERMISSIVE, roles={authenticated}, cmd=SELECT
  qual: is_platform_admin()

-- INSERT: blocked for direct inserts (use request_org_export RPC)
export_insert: PERMISSIVE, roles={authenticated}, cmd=INSERT
  with_check: false

-- UPDATE: blocked for direct updates (use RPCs)
export_update: PERMISSIVE, roles={authenticated}, cmd=UPDATE
  qual: false
```

### 1.2 `organization_governance` Deletion Fields

**Full column listing** (queried from `information_schema.columns`):

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| `organization_id` | uuid | — | NO |
| `retention_days_audit_log` | integer | `365` | NO |
| `legal_hold` | boolean | `false` | NO |
| `deletion_scheduled_at` | timestamptz | — | YES |
| `archived_at` | timestamptz | — | YES |
| `archived_by` | uuid | — | YES |
| `created_at` | timestamptz | `now()` | NO |
| `updated_at` | timestamptz | `now()` | NO |
| `deleted_at` | timestamptz | — | YES |
| `deleted_by` | uuid | — | YES |
| `deletion_locked_at` | timestamptz | — | YES |
| `deletion_locked_by` | text | — | YES |

Phase 16 added 4 columns: `deleted_at`, `deleted_by`, `deletion_locked_at`, `deletion_locked_by`.

**Indexes**:

```sql
CREATE UNIQUE INDEX organization_governance_pkey
  ON public.organization_governance USING btree (organization_id);
```

> No additional indexes were added on the deletion columns. The claim query uses `deletion_scheduled_at <= now()` with `FOR UPDATE SKIP LOCKED`, which scans the small governance table (one row per org).

### 1.3 Storage

**Bucket** (queried from `storage.buckets`):

| Field | Value |
|-------|-------|
| `id` | `org-exports` |
| `name` | `org-exports` |
| `public` | `false` |
| `file_size_limit` | `null` (unlimited) |
| `allowed_mime_types` | `null` (any) |
| `created_at` | `2026-02-24T01:51:08.533254+00` |

**Storage policies**: No explicit RLS policies found on `storage.objects` for the `org-exports` bucket. Access is controlled via:
1. The bucket is **private** (`public = false`)
2. Edge Functions use `service_role` key for upload
3. Download uses `get_export_download_url` RPC (authorization check) + client-side `createSignedUrl`

---

## SECTION 2 — RPCs (Verbatim Bodies + Notes)

### 2.1 `claim_next_export_job`

```sql
CREATE OR REPLACE FUNCTION public.claim_next_export_job(p_worker_id text, p_limit integer DEFAULT 1)
 RETURNS SETOF org_export_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
```

**SECURITY DEFINER**: Yes
**SET search_path**: `'public'`
**GRANTs**: `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` (default EXECUTE)

**Behavior Notes**:
- **FOR UPDATE SKIP LOCKED**: Yes. The CTE `claimed` locks rows with `FOR UPDATE SKIP LOCKED`, preventing two workers from claiming the same job.
- **Atomic claim**: Yes. The CTE + UPDATE runs as a single atomic statement inside the function.
- **Allowed input statuses**: `queued` or `failed` (with `attempt_count < max_attempts` and `next_attempt_at <= now()`).
- **Retries/backoff**: Failed jobs are re-claimable after `next_attempt_at` passes. Backoff is set by `fail_export_job`. The `attempt_count < max_attempts` guard prevents infinite retries.
- **org_id enforcement**: Not applicable — this is a service_role-only queue-draining function. It returns all claimable jobs regardless of org. The Edge Function processes each job's `organization_id` for tenant scoping.

### 2.2 `complete_export_job`

```sql
CREATE OR REPLACE FUNCTION public.complete_export_job(p_job_id uuid, p_storage_path text, p_result_url text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval), p_bytes bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
```

**SECURITY DEFINER**: Yes
**SET search_path**: `'public'`

**Behavior Notes**:
- **FOR UPDATE SKIP LOCKED**: Uses `FOR UPDATE` (blocking, not SKIP LOCKED) — appropriate since only the owning worker should call this.
- **Atomic**: Yes. SELECT FOR UPDATE + UPDATE in single transaction.
- **Allowed input statuses**: Only `running`. Any other status raises an exception.
- **Retries/backoff**: N/A — this is a terminal transition.
- **org_id enforcement**: service_role-only. The job's `organization_id` is inherited from creation. Audit log records the org.

### 2.3 `fail_export_job`

```sql
CREATE OR REPLACE FUNCTION public.fail_export_job(p_job_id uuid, p_error_code text DEFAULT 'UNKNOWN'::text, p_error_message text DEFAULT ''::text, p_retry_in_seconds integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job org_export_jobs;
  v_retry_interval interval;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_job FROM org_export_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF v_job.status != 'running' THEN RAISE EXCEPTION 'Job is not running (status=%)', v_job.status; END IF;

  -- Exponential backoff: 5min * 2^(attempt-1), capped at 1 hour
  IF p_retry_in_seconds IS NOT NULL THEN
    v_retry_interval := (p_retry_in_seconds || ' seconds')::interval;
  ELSE
    v_retry_interval := LEAST(
      (300 * power(2, v_job.attempt_count - 1))::int || ' seconds',
      '3600 seconds'
    )::interval;
  END IF;

  UPDATE org_export_jobs SET
    status = 'failed',
    error_code = p_error_code,
    error_message = p_error_message,
    error = p_error_message,
    finished_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    next_attempt_at = now() + v_retry_interval,
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
$function$
```

**SECURITY DEFINER**: Yes
**SET search_path**: `'public'`

**Behavior Notes**:
- **FOR UPDATE SKIP LOCKED**: Uses `FOR UPDATE` (blocking).
- **Atomic**: Yes.
- **Allowed input statuses**: Only `running`.
- **Retries/backoff**: Exponential backoff: `300 * 2^(attempt-1)` seconds, capped at 3600s. Override via `p_retry_in_seconds`. The job stays `failed` and becomes re-claimable after `next_attempt_at`.
- **org_id enforcement**: service_role-only. Error message truncated to 500 chars in audit log.

### 2.4 `cancel_export_job`

```sql
CREATE OR REPLACE FUNCTION public.cancel_export_job(p_job_id uuid, p_reason text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
```

**SECURITY DEFINER**: Yes
**SET search_path**: `'public'`

**Behavior Notes**:
- **FOR UPDATE SKIP LOCKED**: Uses `FOR UPDATE` (blocking). Appropriate since the user is targeting a specific job.
- **Atomic**: Yes.
- **Allowed input statuses**: `queued` or `failed` only. Cannot cancel `running`, `succeeded`, or `cancelled`.
- **Retries/backoff**: N/A — terminal transition.
- **org_id enforcement**: Authorization checks that the caller is an org admin of the job's org OR a platform admin. Cross-org access is blocked.

### 2.5 `get_export_download_url`

```sql
CREATE OR REPLACE FUNCTION public.get_export_download_url(p_job_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job org_export_jobs;
  v_caller uuid := auth.uid();
  v_is_authorized boolean;
  v_url text;
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

  -- Returns path for client to use with storage.createSignedUrl
  RETURN v_job.storage_path;
END;
$function$
```

**SECURITY DEFINER**: Yes
**SET search_path**: `'public'`

**Behavior Notes**:
- **FOR UPDATE SKIP LOCKED**: Not used (read-only operation, no row locking needed).
- **Atomic**: Yes (single SELECT + auth check).
- **Allowed input statuses**: Only `succeeded` jobs with non-null `storage_path` and non-expired `result_expires_at`.
- **Retries/backoff**: N/A.
- **org_id enforcement**: **Cross-org access blocked.** The function checks that the caller is either a platform admin OR an active org admin of the job's organization. Returns `storage_path` (not a signed URL) — the client generates the signed URL via Supabase Storage SDK.

### 2.6 `claim_next_org_deletion`

```sql
CREATE OR REPLACE FUNCTION public.claim_next_org_deletion(p_worker_id text, p_limit integer DEFAULT 10)
 RETURNS TABLE(organization_id uuid, org_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  RETURNING gov.organization_id, (SELECT o.name FROM organizations o WHERE o.id = gov.organization_id) AS org_name;
END;
$function$
```

**SECURITY DEFINER**: Yes
**SET search_path**: `'public'`

**Behavior Notes**:
- **FOR UPDATE SKIP LOCKED**: Yes (`FOR UPDATE OF g SKIP LOCKED`).
- **Atomic**: Yes. CTE + UPDATE in a single statement.
- **Allowed input statuses**: Rows where `deletion_scheduled_at <= now()`, `legal_hold = false`, `deleted_at IS NULL`, `deletion_locked_at IS NULL`.
- **Retries/backoff**: Handled externally via `release_stale_deletion_locks`. If a worker crashes, the lock persists until the stale lock release clears it.
- **org_id enforcement**: service_role-only. Returns all eligible orgs across tenants (by design — this is a global scheduler).

### 2.7 `execute_org_deletion`

```sql
CREATE OR REPLACE FUNCTION public.execute_org_deletion(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- 1. Ensure archived
  IF v_gov.archived_at IS NULL THEN
    UPDATE organization_governance SET archived_at = now(), updated_at = now()
    WHERE organization_id = p_org_id;
  END IF;

  -- 2. Soft delete: mark governance
  UPDATE organization_governance SET
    deleted_at = now(),
    deleted_by = NULL,
    deletion_locked_at = NULL,
    deletion_locked_by = NULL,
    updated_at = now()
  WHERE organization_id = p_org_id;

  -- 3. Deactivate all memberships
  UPDATE organization_memberships SET status = 'inactive', updated_at = now()
  WHERE organization_id = p_org_id AND status = 'active';

  -- 4. Disable domain routing
  DELETE FROM organization_domains WHERE organization_id = p_org_id;

  -- 5. Disable SSO
  UPDATE organization_identity_providers SET enabled = false
  WHERE organization_id = p_org_id;

  -- 6. Cancel pending invites
  UPDATE organization_invites SET status = 'cancelled'
  WHERE organization_id = p_org_id AND status IN ('pending', 'sent');

  -- 7. Cancel pending export jobs
  UPDATE org_export_jobs SET status = 'cancelled', finished_at = now(), updated_at = now()
  WHERE organization_id = p_org_id AND status IN ('queued', 'failed');

  -- 8. Audit
  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (p_org_id, NULL, 'org.deletion_executed', 'organization', p_org_id,
    jsonb_build_object('soft_delete', true));
END;
$function$
```

**SECURITY DEFINER**: Yes
**SET search_path**: `'public'`

**Behavior Notes**:
- **FOR UPDATE SKIP LOCKED**: Uses `FOR UPDATE` (blocking) on the governance row.
- **Atomic**: Yes. All 8 steps execute in a single transaction. If any step fails, the entire deletion rolls back.
- **Allowed input statuses**: `deleted_at IS NULL` and `legal_hold = false`. Already-deleted orgs raise an exception (idempotency guard).
- **Retries/backoff**: If deletion fails, the Edge Function releases the lock. The org remains eligible for the next run.
- **org_id enforcement**: service_role-only. All queries are explicitly scoped to `p_org_id`.

### 2.8 `release_stale_deletion_locks`

```sql
CREATE OR REPLACE FUNCTION public.release_stale_deletion_locks(p_stale_minutes integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
```

**SECURITY DEFINER**: Yes
**SET search_path**: `'public'`

**Behavior Notes**:
- **FOR UPDATE SKIP LOCKED**: No (not needed — bulk cleanup operation).
- **Atomic**: Yes (single UPDATE).
- **Allowed input statuses**: Rows with `deletion_locked_at IS NOT NULL`, older than `p_stale_minutes`, and `deleted_at IS NULL`.
- **Retries/backoff**: N/A — this is the retry/unstick mechanism itself.
- **org_id enforcement**: service_role-only. Operates across all orgs (by design).

### Supplementary RPC: `request_org_export`

```sql
CREATE OR REPLACE FUNCTION public.request_org_export(p_org_id uuid, p_scope text DEFAULT 'metadata_only'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
```

---

## SECTION 3 — Edge Functions (Verbatim Core)

### 3.1 `export-jobs-runner/index.ts`

**Slug**: `export-jobs-runner` | **verify_jwt**: `true` | **Status**: `ACTIVE` | **ID**: `98362327-afb1-4df9-8c77-94658ea80885`

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, any>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const WORKER_ID = `export-runner-${crypto.randomUUID().slice(0, 8)}`;

// Tables to export per org (tenant-scoped)
const EXPORT_TABLES = [
  { table: 'organizations', filter: 'id' },
  { table: 'organization_governance', filter: 'organization_id' },
  { table: 'organization_memberships', filter: 'organization_id' },
  { table: 'organization_invites', filter: 'organization_id' },
  { table: 'organization_domains', filter: 'organization_id' },
  { table: 'organization_identity_providers', filter: 'organization_id' },
  { table: 'teams', filter: 'organization_id' },
  { table: 'portfolios', filter: 'organization_id', via: 'teams' },
  { table: 'workflows', filter: 'organization_id' },
  { table: 'projects', filter: 'organization_id' },
  { table: 'themes', filter: 'organization_id' },
  { table: 'topics', filter: 'organization_id' },
  { table: 'captures', filter: 'organization_id' },
  { table: 'calendar_events', filter: 'organization_id' },
];

async function gatherExportData(
  supabase: any,
  orgId: string,
  scope: string
): Promise<Record<string, any>> {
  const result: Record<string, any> = {};

  for (const def of EXPORT_TABLES) {
    try {
      if (def.table === 'organizations') {
        const { data } = await supabase.from(def.table).select('*').eq('id', orgId).maybeSingle();
        result[def.table] = data ? [data] : [];
      } else if (def.table === 'portfolios' && def.via === 'teams') {
        // Portfolios are linked via teams.organization_id
        const { data: teamIds } = await supabase
          .from('teams')
          .select('id')
          .eq('organization_id', orgId);
        if (teamIds && teamIds.length > 0) {
          const ids = teamIds.map((t: any) => t.id);
          const { data } = await supabase.from('portfolios').select('*').in('team_id', ids);
          result[def.table] = data || [];
        } else {
          result[def.table] = [];
        }
      } else {
        const { data } = await supabase
          .from(def.table)
          .select('*')
          .eq(def.filter, orgId)
          .limit(10000);
        result[def.table] = data || [];
      }
    } catch (e: any) {
      // Non-fatal: skip tables that don't exist or error
      result[def.table] = { error: e?.message || 'fetch_failed' };
    }
  }

  // If full scope, include audit log (respect retention)
  if (scope === 'full') {
    try {
      const { data: gov } = await supabase
        .from('organization_governance')
        .select('retention_days_audit_log')
        .eq('organization_id', orgId)
        .maybeSingle();
      const retentionDays = gov?.retention_days_audit_log || 365;
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();

      const { data } = await supabase
        .from('organization_audit_log')
        .select('*')
        .eq('organization_id', orgId)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(50000);
      result['organization_audit_log'] = data || [];
    } catch (e: any) {
      result['organization_audit_log'] = { error: e?.message };
    }
  }

  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 1. Claim jobs
    const { data: jobs, error: claimErr } = await supabase.rpc('claim_next_export_job', {
      p_worker_id: WORKER_ID,
      p_limit: 3,
    });

    if (claimErr) {
      console.error('Claim error:', claimErr);
      return json({ error: claimErr.message }, 500);
    }

    if (!jobs || jobs.length === 0) {
      return json({ message: 'No jobs to process', worker: WORKER_ID });
    }

    const results: Array<{ job_id: string; status: string; error?: string }> = [];

    for (const job of jobs) {
      try {
        // 2. Gather data
        const exportData = await gatherExportData(supabase, job.organization_id, job.scope);

        // Add metadata
        const artifact = {
          export_version: '1.0',
          organization_id: job.organization_id,
          job_id: job.id,
          scope: job.scope,
          exported_at: new Date().toISOString(),
          tables: exportData,
        };

        const jsonStr = JSON.stringify(artifact, null, 2);
        const bytes = new TextEncoder().encode(jsonStr).length;
        const storagePath = `${job.organization_id}/${job.id}.json`;

        // 3. Upload to storage
        const { error: uploadErr } = await supabase.storage
          .from('org-exports')
          .upload(storagePath, jsonStr, {
            contentType: 'application/json',
            upsert: true,
          });

        if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

        // 4. Create signed URL (7 day expiry)
        const expiresAt = new Date(Date.now() + 7 * 86400000);
        const { data: signedData, error: signErr } = await supabase.storage
          .from('org-exports')
          .createSignedUrl(storagePath, 7 * 86400); // seconds

        if (signErr) throw new Error(`Signed URL failed: ${signErr.message}`);

        // 5. Mark complete
        const { error: completeErr } = await supabase.rpc('complete_export_job', {
          p_job_id: job.id,
          p_storage_path: storagePath,
          p_result_url: signedData?.signedUrl || null,
          p_expires_at: expiresAt.toISOString(),
          p_bytes: bytes,
        });

        if (completeErr) throw new Error(`Complete RPC failed: ${completeErr.message}`);

        results.push({ job_id: job.id, status: 'succeeded' });
      } catch (jobErr: any) {
        console.error(`Job ${job.id} failed:`, jobErr);

        // Mark failed with retry
        await supabase.rpc('fail_export_job', {
          p_job_id: job.id,
          p_error_code: 'EXPORT_ERROR',
          p_error_message: jobErr?.message?.slice(0, 1000) || 'Unknown error',
        });

        results.push({ job_id: job.id, status: 'failed', error: jobErr?.message });
      }
    }

    return json({
      worker: WORKER_ID,
      processed: results.length,
      results,
    });
  } catch (err: any) {
    console.error('Export runner error:', err);
    return json({ error: err?.message || 'Internal error' }, 500);
  }
});
```

**Operational Notes**:
1. **Scheduling/trigger**: Manual invoke via POST. No built-in cron — requires external scheduler (pg_cron or Supabase cron extension) to trigger periodically.
2. **Job claiming**: Calls `claim_next_export_job` RPC with `p_limit: 3`. Multiple concurrent invocations are safe due to `FOR UPDATE SKIP LOCKED`.
3. **Idempotency**: Each invocation claims fresh jobs. Re-running the function when no jobs are queued returns early. Failed jobs are retried after backoff.
4. **Tenant scoping**: Every table query uses `.eq('organization_id', orgId)` or `.eq('id', orgId)` for the `organizations` table. Portfolios use a two-step join via teams. **14 tables exported**: `organizations`, `organization_governance`, `organization_memberships`, `organization_invites`, `organization_domains`, `organization_identity_providers`, `teams`, `portfolios`, `workflows`, `projects`, `themes`, `topics`, `captures`, `calendar_events`. Plus `organization_audit_log` for `full` scope.
5. **Size limits/chunking**: Each table capped at `.limit(10000)` rows (audit log at 50000). No streaming or chunking — entire JSON artifact built in memory.
6. **Error handling**: Per-job try/catch. On failure, calls `fail_export_job` RPC (sets error_code, error_message, exponential backoff). Error messages truncated to 1000 chars.
7. **Upload path**: `{organization_id}/{job_id}.json` — tenant-scoped by org UUID prefix.
8. **Signed URL**: Created server-side with 7-day expiry. Stored in `result_url` column. Client-side re-generates fresh 10-minute signed URLs via `get_export_download_url` + Storage SDK.

### 3.2 `org-deletion-runner/index.ts`

**Slug**: `org-deletion-runner` | **verify_jwt**: `true` | **Status**: `ACTIVE` | **ID**: `7e97c67e-e031-4e48-a535-9401fac3d2b1`

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, any>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const WORKER_ID = `deletion-runner-${crypto.randomUUID().slice(0, 8)}`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 1. Release stale locks first
    const { data: released } = await supabase.rpc('release_stale_deletion_locks', {
      p_stale_minutes: 30,
    });
    if (released && released > 0) {
      console.log(`Released ${released} stale deletion locks`);
    }

    // 2. Claim orgs due for deletion
    const { data: orgs, error: claimErr } = await supabase.rpc('claim_next_org_deletion', {
      p_worker_id: WORKER_ID,
      p_limit: 5,
    });

    if (claimErr) {
      console.error('Claim error:', claimErr);
      return json({ error: claimErr.message }, 500);
    }

    if (!orgs || orgs.length === 0) {
      return json({ message: 'No orgs due for deletion', worker: WORKER_ID });
    }

    const results: Array<{ organization_id: string; org_name: string; status: string; error?: string }> = [];

    for (const org of orgs) {
      try {
        // 3. Execute soft deletion
        const { error: execErr } = await supabase.rpc('execute_org_deletion', {
          p_org_id: org.organization_id,
        });

        if (execErr) throw new Error(execErr.message);

        results.push({
          organization_id: org.organization_id,
          org_name: org.org_name,
          status: 'deleted',
        });
      } catch (delErr: any) {
        console.error(`Deletion failed for org ${org.organization_id}:`, delErr);

        // Release lock on failure
        await supabase
          .from('organization_governance')
          .update({
            deletion_locked_at: null,
            deletion_locked_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq('organization_id', org.organization_id);

        // Audit the failure
        await supabase.from('organization_audit_log').insert({
          organization_id: org.organization_id,
          actor_id: null,
          action: 'org.deletion_failed',
          target_type: 'organization',
          target_id: org.organization_id,
          details: { error: delErr?.message?.slice(0, 500), worker: WORKER_ID },
        });

        results.push({
          organization_id: org.organization_id,
          org_name: org.org_name,
          status: 'failed',
          error: delErr?.message,
        });
      }
    }

    return json({
      worker: WORKER_ID,
      processed: results.length,
      results,
    });
  } catch (err: any) {
    console.error('Deletion runner error:', err);
    return json({ error: err?.message || 'Internal error' }, 500);
  }
});
```

**Operational Notes**:
1. **Scheduling/trigger**: Manual invoke via POST. Requires external cron.
2. **Job claiming**: First calls `release_stale_deletion_locks(30)`, then `claim_next_org_deletion` with `p_limit: 5`. SKIP LOCKED prevents double-claims.
3. **Idempotency**: `execute_org_deletion` checks `deleted_at IS NOT NULL` and raises exception if already deleted. The runner catches this error and releases the lock.
4. **Tenant scoping**: All deletion operations inside `execute_org_deletion` RPC are explicitly filtered by `organization_id = p_org_id`.
5. **Size limits/chunking**: N/A — deletion is a series of UPDATEs/DELETEs, not data export.
6. **Error handling**: Per-org try/catch. On failure: releases lock via direct table update, writes `org.deletion_failed` audit log entry.
7. **Upload path**: N/A.
8. **Stale lock timeout**: 30 minutes. Released at the start of each run.

---

## SECTION 4 — Export Contents + PII

### Export File Structure

Each export produces a single JSON file at `org-exports/{organization_id}/{job_id}.json`:

```json
{
  "export_version": "1.0",
  "organization_id": "uuid",
  "job_id": "uuid",
  "scope": "metadata_only",
  "exported_at": "2026-02-23T...",
  "tables": {
    "organizations": [...],
    "organization_governance": [...],
    "organization_memberships": [...],
    "organization_invites": [...],
    "organization_domains": [...],
    "organization_identity_providers": [...],
    "teams": [...],
    "portfolios": [...],
    "workflows": [...],
    "projects": [...],
    "themes": [...],
    "topics": [...],
    "captures": [...],
    "calendar_events": [...]
  }
}
```

For `scope: 'full'`, an additional `organization_audit_log` key is included.

### Redacted Sample Export Manifest

```json
{
  "export_version": "1.0",
  "organization_id": "aaaa0000-0000-0000-0000-000000000001",
  "job_id": "bbbb0000-0000-0000-0000-000000000099",
  "scope": "metadata_only",
  "exported_at": "2026-02-23T12:00:00.000Z",
  "tables": {
    "organizations": [{ "id": "aaaa...", "name": "Acme Capital", "slug": "acme-capital", "...": "..." }],
    "organization_governance": [{ "organization_id": "aaaa...", "retention_days_audit_log": 365, "...": "..." }],
    "organization_memberships": [{ "rowCount": 12 }],
    "organization_invites": [{ "rowCount": 3 }],
    "organization_domains": [{ "rowCount": 1 }],
    "organization_identity_providers": [{ "rowCount": 1 }],
    "teams": [{ "rowCount": 4 }],
    "portfolios": [{ "rowCount": 2 }],
    "workflows": [{ "rowCount": 7 }],
    "projects": [{ "rowCount": 15 }],
    "themes": [{ "rowCount": 3 }],
    "topics": [{ "rowCount": 8 }],
    "captures": [{ "rowCount": 42 }],
    "calendar_events": [{ "rowCount": 25 }]
  }
}
```

**Storage path**: `aaaa0000-0000-0000-0000-000000000001/bbbb0000-0000-0000-0000-000000000099.json`

### PII Handling

**User fields included in export**:
- `organization_memberships` contains `user_id` (UUID) — **no email or name directly**.
- `organization_invites` contains `email` — **PII present**.
- All tables use `SELECT *`, so any user-facing columns (names, descriptions) are exported verbatim.

**Redaction logic**: **NONE**. There is no PII redaction or masking in the export pipeline. The `gatherExportData` function uses `.select('*')` for all tables. This is by design — the export is intended for org admins who already have access to this data.

---

## SECTION 5 — Deletion Semantics

### Soft Delete Definition

"Soft delete" in this repo means setting `organization_governance.deleted_at` to `now()`. The org row in `organizations` is NOT deleted. Data remains in all tables.

**Columns set by `execute_org_deletion`**:
- `organization_governance.deleted_at = now()`
- `organization_governance.deleted_by = NULL` (service_role actor)
- `organization_governance.archived_at = now()` (if not already archived)
- `organization_governance.deletion_locked_at = NULL` (lock released)

**What is blocked afterward**:
1. **Routing**: `organization_domains` rows are DELETEd (SSO discovery fails).
2. **Switching**: `is_org_archived()` returns `true` → org blocked in context switching.
3. **New invites**: `organization_invites` with `status IN ('pending','sent')` → cancelled.
4. **RLS writes**: The `enforce_org_not_archived` trigger blocks INSERT/UPDATE/DELETE on 25 tables.
5. **SSO**: `organization_identity_providers.enabled = false`.
6. **All memberships deactivated**: `status = 'inactive'`.
7. **Export jobs cancelled**: Pending/failed export jobs set to cancelled.

### `enforce_org_not_archived` Trigger (verbatim)

```sql
CREATE OR REPLACE FUNCTION public.enforce_org_not_archived()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
BEGIN
  -- Determine org_id from the row being modified
  IF TG_OP = 'DELETE' THEN
    v_org_id := OLD.organization_id;
  ELSE
    v_org_id := NEW.organization_id;
  END IF;

  -- If no organization_id column, skip
  IF v_org_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Check if org is archived
  IF is_org_archived(v_org_id) THEN
    RAISE EXCEPTION 'Organization is archived. No modifications allowed.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$
```

### `is_org_archived` Helper (verbatim)

```sql
CREATE OR REPLACE FUNCTION public.is_org_archived(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM organization_governance
    WHERE organization_id = p_org_id AND archived_at IS NOT NULL
  );
$function$
```

### Tables with `enforce_org_not_archived` Trigger (25 tables)

```
calendar_events              organization_domains          projects
captures                     organization_identity_providers  target_date_funds
case_templates               organization_invites          team_memberships
conversations                organization_memberships      teams
coverage_settings            org_chart_node_links          themes
custom_notebooks             org_chart_node_members        topics
org_chart_nodes              portfolio_memberships         workflow_templates
                             portfolios                    workflows
                             project_assignments
                             project_deliverables
```

---

## SECTION 6 — Test Coverage

### 6.1 SQL Tests — State Machine (12 assertions)

**File**: `supabase/tests/governance-jobs-state-machine.sql`

| # | Assertion | Exact Query Approach | Coverage |
|---|-----------|---------------------|----------|
| 1 | Status CHECK rejects `'pending'` | INSERT with `status='pending'` → expects `check_violation` | Status constraint |
| 2 | Status CHECK accepts `'queued'` | INSERT with `status='queued'` → expects success | Status constraint |
| 3 | `claim_next_export_job` requires service_role | SET role=authenticated, call RPC → expects `raise_exception` | **Cross-tenant safety** |
| 4 | `claim_next_export_job` works for service_role | SET role=service_role, claim → asserts status=running | Claim mechanics |
| 5 | `complete_export_job` → succeeded | Call on running job → asserts status=succeeded, result_bytes, storage_path | State transition |
| 6 | `fail_export_job` → failed with retry | Call on running job → asserts status=failed, attempt_count=1, next_attempt_at set | **Max attempts / backoff** |
| 7 | `cancel_export_job` queued → cancelled | Call on queued job → asserts status=cancelled | **Cancel vs complete conflict** |
| 8 | `cancel_export_job` works on failed jobs | Call on failed job → asserts status=cancelled | **Cancel vs complete conflict** |
| 9 | Idempotency index prevents duplicates | Two INSERTs with same idempotency_key → expects `unique_violation` | Idempotency |
| 10 | Deletion columns exist on governance | Query information_schema for 4 columns → asserts count=4 | Schema validation |
| 11 | `claim_next_org_deletion` requires service_role | SET role=authenticated → expects `raise_exception` | **Cross-tenant safety** |
| 12 | `execute_org_deletion` requires service_role | SET role=authenticated → expects `raise_exception` | **Cross-tenant safety** |

**Coverage gaps noted**:
- **Stale lock release**: Not directly tested in state-machine file (tested conceptually via governance tests).
- **Max attempts exceeded**: Test 6 verifies attempt_count increments but does not test the `attempt_count < max_attempts` guard in `claim_next_export_job`.
- **Deletion idempotency**: `execute_org_deletion` has an `IF v_gov.deleted_at IS NOT NULL THEN RAISE EXCEPTION` guard but no test verifies this.
- **Cross-tenant download**: `get_export_download_url` authorization is not tested in SQL.

### 6.2 SQL Tests — Governance (16 assertions)

**File**: `supabase/tests/org-governance.sql`

| # | Assertion | Coverage |
|---|-----------|----------|
| 1 | `organization_governance` columns exist | Schema |
| 2 | Default retention_days = 365 | Defaults |
| 3 | Org admin can set retention via `set_org_governance` | Authorization |
| 4 | Org admin cannot toggle legal_hold | Authorization |
| 5 | Platform admin can toggle legal_hold | Authorization |
| 6 | Cannot schedule deletion under legal hold | Legal hold blocking |
| 7 | Schedule deletion succeeds after removing hold | State transition |
| 8 | `cancel_org_deletion` clears schedule | State transition |
| 9 | `archive_org` sets archived_at/by | State transition |
| 10 | `is_org_archived` returns true | Helper function |
| 11 | Regular member blocked from `set_org_governance` | Authorization |
| 12 | Non-platform-admin blocked from `archive_org` | Authorization |
| 13 | `request_org_export` creates queued job | Export creation (updated for `queued` status) |
| 14 | `apply_audit_log_retention` skips legal hold orgs | Legal hold + retention |
| 15 | `apply_audit_log_retention` deletes old entries | Retention enforcement |
| 16 | Audit log entries created for actions | Audit completeness |

### 6.2 Frontend Changes

**Files changed for Phase 16**:

| File | Key Phase 16 Additions |
|------|----------------------|
| `src/components/organization/OrgGovernanceSection.tsx` | Exports table, status pills, download, cancel, retry |
| `src/pages/AdminConsolePage.tsx` | Export jobs card, deletion schedule card |

**Key excerpts**:

#### Export Jobs UI States (`OrgGovernanceSection.tsx:43-49`)
```typescript
const STATUS_PILL: Record<ExportJob['status'], string> = {
  queued: 'bg-blue-100 text-blue-700',
  running: 'bg-indigo-100 text-indigo-700',
  succeeded: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}
```

#### Download Button Calling `get_export_download_url` (`OrgGovernanceSection.tsx:157-176`)
```typescript
const handleDownload = async (job: ExportJob) => {
  if (!job.storage_path) return
  setDownloadingJobId(job.id)
  try {
    const { data: urlData, error } = await supabase.rpc('get_export_download_url', { p_job_id: job.id })
    if (error) throw error
    const path = (urlData as any)?.storage_path || job.storage_path
    const { data: signedData, error: signErr } = await supabase.storage
      .from('org-exports')
      .createSignedUrl(path, 600) // 10 min expiry
    if (signErr) throw signErr
    if (signedData?.signedUrl) {
      window.open(signedData.signedUrl, '_blank')
    }
  } catch (err: any) {
    toast.error(err?.message || 'Failed to generate download link')
  } finally {
    setDownloadingJobId(null)
  }
}
```

#### Cancel/Retry Wiring (`OrgGovernanceSection.tsx:141-153, 342-363`)
```typescript
const cancelJobMutation = useMutation({
  mutationFn: async (jobId: string) => {
    const { error } = await supabase.rpc('cancel_export_job', { p_job_id: jobId })
    if (error) throw error
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['org-export-jobs', organizationId] })
    toast.success('Export cancelled')
  },
})

// Cancel button shown for queued/failed:
{(job.status === 'queued' || job.status === 'failed') && (
  <button onClick={() => cancelJobMutation.mutate(job.id)} ...>Cancel</button>
)}

// Retry button shown for failed (creates new job):
{job.status === 'failed' && (
  <button onClick={() => exportMutation.mutate()} ...>Retry</button>
)}
```

#### Auto-Refresh Logic (`OrgGovernanceSection.tsx:91-94`)
```typescript
refetchInterval: (query) => {
  const jobs = query.state.data as ExportJob[] | undefined
  return jobs?.some((j) => j.status === 'queued' || j.status === 'running') ? 5000 : false
},
```

Polls every 5 seconds when any job is in `queued` or `running` state. Stops polling when all jobs reach terminal states.

---

## SECTION 7 — Risk Checklist

### Can two workers claim the same export job?
**NO.** `claim_next_export_job` uses `FOR UPDATE SKIP LOCKED` in a CTE, ensuring the SELECT + UPDATE is atomic. Two concurrent workers will each get different jobs.

### Can a "cancelled" job be completed?
**NO.** `complete_export_job` checks `IF v_job.status != 'running'` and raises an exception. A cancelled job has `status='cancelled'`, so completion is rejected. Similarly, `cancel_export_job` only accepts `queued` or `failed` — a running job cannot be cancelled.

### Do "running" jobs ever get stuck forever? If no, what un-sticks them?
**YES (potential risk).** There is no stale lock release for export jobs. `release_stale_deletion_locks` only handles deletion locks. If a worker crashes while processing an export job, the job remains `status='running'` with `locked_at` set indefinitely. **Mitigation needed**: a `release_stale_export_locks` function or a check in the runner that resets jobs locked > N minutes.

### Is any export query missing an organization_id filter given service-role access?
**NO.** Every table query in `gatherExportData` explicitly filters by `orgId`: `.eq('organization_id', orgId)` or `.eq('id', orgId)` for the organizations table. Portfolios use a two-step join through teams. The Edge Function uses the service_role key but scopes all queries to the job's `organization_id`.

### Can a non-admin mint a download URL for another org?
**NO.** `get_export_download_url` checks `is_platform_admin() OR (org admin of the job's org)`. A non-admin user or admin of a different org will receive "Not authorized". The storage bucket is private, so direct access without a signed URL is impossible.

### Can deletion execute twice safely?
**YES.** `execute_org_deletion` checks `IF v_gov.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Org already deleted'`. A second execution attempt is rejected. The Edge Function catches this exception, releases the lock, and logs the failure.

---

## SECTION 8 — Commands Run + Results

### TypeScript Check
```bash
npx tsc --noEmit
# Result: Clean (no errors)
```

### Vite Build
```bash
npx vite build
# Result: Clean, 36.38s
```

### Tenant Lint
```bash
node scripts/frontend-tenant-lint.mjs
# Result: 38 total / 17 P0, delta +0 (at baseline)
```

### SQL Test Invocation
SQL tests were executed directly against the Supabase database via the SQL editor / `psql`:
```bash
# Executed via Supabase SQL editor or psql connection:
# File: supabase/tests/governance-jobs-state-machine.sql (12/12 PASS)
# File: supabase/tests/org-governance.sql (16/16 PASS)
```

### Edge Function Deployment
```bash
# Deployed via Supabase MCP deploy_edge_function tool
# export-jobs-runner: ACTIVE (id: 98362327-afb1-4df9-8c77-94658ea80885)
# org-deletion-runner: ACTIVE (id: 7e97c67e-e031-4e48-a535-9401fac3d2b1)
```

---

## MISSING Items

| Requested Item | Status | What Was Searched |
|----------------|--------|-------------------|
| Migration SQL source file | **NOT IN REPO** | `supabase/migrations/` directory — migration was applied via Supabase MCP `apply_migration`, not stored as a local file. The migration name `phase16_governance_jobs_state_machine` (version `20260224015108`) exists in the remote database but no corresponding `.sql` file was committed to the repo. |
| Storage policies for `org-exports` bucket | **NONE FOUND** | Queried `pg_policies` for `storage.objects` where policy references `org-exports`. No explicit policies exist — access is controlled by bucket being `private` + service_role for uploads + signed URLs for downloads. |
| `get_export_download_url` SQL test | **NOT TESTED** | No SQL assertion verifies the authorization check in `get_export_download_url` (cross-org download prevention). |
| Stale export lock release test | **NOT TESTED** | No SQL assertion tests stuck `running` export jobs. |
| Deletion idempotency test | **NOT TESTED** | `execute_org_deletion` has an idempotency guard (`deleted_at IS NOT NULL → exception`) but no SQL test verifies this path. |
| `max_attempts` guard test | **NOT TESTED** | `claim_next_export_job` checks `attempt_count < max_attempts` but no test sets `attempt_count = max_attempts` to verify the guard. |

---

## Appendix: GRANT Analysis

All 8 Phase 16 RPCs have default `EXECUTE` granted to `PUBLIC`, `anon`, `authenticated`, `postgres`, and `service_role`. The service_role-only RPCs (`claim_next_export_job`, `complete_export_job`, `fail_export_job`, `claim_next_org_deletion`, `execute_org_deletion`, `release_stale_deletion_locks`) enforce access via runtime JWT claim check:

```sql
IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'service_role required';
END IF;
```

**Note**: While the functions are callable by any role at the GRANT level, the JWT check inside the function body prevents unauthorized execution. A hardened approach would `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated` and only grant to `service_role`, but the current runtime check is functionally equivalent.
