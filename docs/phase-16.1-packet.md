# Phase 16.1 — Governance Hardening Patch

**Date**: 2026-02-24
**Branch**: `project-adjustment`
**Status**: Complete — all validation gates pass

---

## 1. Executive Summary

Phase 16.1 is a **production hardening pass** (not feature work) on the governance infrastructure built in Phase 16. It addresses five gaps discovered during deep review:

| Sub-phase | Scope | Status |
|-----------|-------|--------|
| **16.1A** | Stale export lock recovery (`release_stale_export_locks` RPC + edge function update) | Done |
| **16.1B** | REVOKE EXECUTE from PUBLIC/anon on all 9 governance RPCs, GRANT to correct roles | Done |
| **16.1C** | 7 new SQL tests (stale lock, max_attempts, cross-org, deletion idempotency, cancel-vs-complete) | Done |
| **16.1D** | Local migration file `supabase/migrations/20260224000000_phase16_governance_jobs.sql` | Done |
| **16.1E** | `fail_export_job` max_attempts guard + `execute_org_deletion` trigger bypass | Done |

### Key Bug Fix: `execute_org_deletion` Trigger Conflict

The deep review revealed that `execute_org_deletion` was broken in practice. The function:
1. Set `archived_at = now()` on `organization_governance` (step 1)
2. Then tried to deactivate memberships (step 3)
3. But the `enforce_org_not_archived` trigger blocked step 3 because the org was now archived
4. Additionally, `prevent_last_org_admin_removal` blocked deactivating the last admin

**Fix**: Added a transaction-local session variable bypass (`app.executing_org_deletion`). The `execute_org_deletion` function sets this flag before performing cleanup, and both trigger functions check it. The flag is automatically cleared when the transaction ends.

---

## 2. Phase 16.1A — Stale Export Lock Recovery

### New RPC: `release_stale_export_locks`

```sql
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

  IF v_count > 0 THEN
    INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
    SELECT j.organization_id, NULL, 'export.stale_lock_released', 'org_export_job', j.id,
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
```

### Edge Function Update: `export-jobs-runner` v2

Added stale lock release call before job claiming:

```typescript
// 0. Release stale locks from crashed workers (Phase 16.1A)
const { data: released, error: releaseErr } = await supabase.rpc(
  'release_stale_export_locks',
  { p_max_age: '30 minutes' }
);
if (releaseErr) {
  console.error('Stale lock release error:', releaseErr);
  // Non-fatal: continue to claim jobs
} else if (released && released > 0) {
  console.log(`Released ${released} stale export lock(s)`);
}
```

---

## 3. Phase 16.1B — GRANT/REVOKE Hardening

### Service-role-only RPCs (7)

| RPC | Before | After |
|-----|--------|-------|
| `claim_next_export_job` | PUBLIC | service_role only |
| `complete_export_job` | PUBLIC | service_role only |
| `fail_export_job` | PUBLIC | service_role only |
| `claim_next_org_deletion` | PUBLIC | service_role only |
| `execute_org_deletion` | PUBLIC | service_role only |
| `release_stale_deletion_locks` | PUBLIC | service_role only |
| `release_stale_export_locks` | PUBLIC | service_role only |

### Authenticated RPCs (2)

| RPC | Before | After |
|-----|--------|-------|
| `cancel_export_job` | PUBLIC | authenticated + service_role |
| `get_export_download_url` | PUBLIC | authenticated + service_role |

Statement pattern for service-role RPCs:
```sql
REVOKE ALL ON FUNCTION <name>(<args>) FROM PUBLIC;
REVOKE ALL ON FUNCTION <name>(<args>) FROM anon;
REVOKE ALL ON FUNCTION <name>(<args>) FROM authenticated;
GRANT EXECUTE ON FUNCTION <name>(<args>) TO service_role;
```

Statement pattern for authenticated RPCs:
```sql
REVOKE ALL ON FUNCTION <name>(<args>) FROM PUBLIC;
REVOKE ALL ON FUNCTION <name>(<args>) FROM anon;
GRANT EXECUTE ON FUNCTION <name>(<args>) TO authenticated;
GRANT EXECUTE ON FUNCTION <name>(<args>) TO service_role;
```

---

## 4. Phase 16.1C — SQL Tests (7 new, 19 total)

**File**: `supabase/tests/governance-jobs-state-machine.sql`

### New Tests (13–19)

| # | Assertion | Result |
|---|-----------|--------|
| 13 | `release_stale_export_locks` recovers stuck jobs (status→failed, error_code=STALE_LOCK, locked_at=NULL, next_attempt_at set) | PASS |
| 14 | `claim_next_export_job` skips exhausted jobs (attempt_count >= max_attempts) | PASS |
| 15 | `fail_export_job` sets `next_attempt_at = NULL` when max_attempts exhausted | PASS |
| 16 | `get_export_download_url` blocks cross-org access (Org B admin → Org A job) | PASS |
| 17 | `execute_org_deletion` idempotency (second call raises 'Org already deleted') | PASS |
| 18 | `complete_export_job` rejects cancelled job (cancel-vs-complete conflict) | PASS |
| 19 | `release_stale_export_locks` requires service_role | PASS |

### Original Tests (1–12) — All Still Passing

| # | Assertion | Result |
|---|-----------|--------|
| 1 | Status CHECK rejects `'pending'` | PASS |
| 2 | Status CHECK accepts `'queued'` | PASS |
| 3 | `claim_next_export_job` requires service_role | PASS |
| 4 | `claim_next_export_job` claims job + sets status=running | PASS |
| 5 | `complete_export_job` → succeeded with metadata | PASS |
| 6 | `fail_export_job` → failed with retry metadata + attempt_count | PASS |
| 7 | `cancel_export_job` transitions queued → cancelled | PASS |
| 8 | `cancel_export_job` also works on failed jobs | PASS |
| 9 | Idempotency index prevents duplicate active jobs | PASS |
| 10 | Deletion columns exist on organization_governance | PASS |
| 11 | `claim_next_org_deletion` requires service_role | PASS |
| 12 | `execute_org_deletion` requires service_role | PASS |

---

## 5. Phase 16.1D — Migration File

**File**: `supabase/migrations/20260224000000_phase16_governance_jobs.sql`

Consolidated, idempotent migration containing all Phase 16 + 16.1 changes:
- Status CHECK migration (pending→queued, completed→succeeded)
- 14 new columns on `org_export_jobs`
- 4 new columns on `organization_governance`
- 3 indexes (claim, org_created, idempotency)
- Private `org-exports` storage bucket
- 11 RPCs (8 original + 1 new + 2 updated triggers)
- GRANT/REVOKE statements for all 9 governance RPCs

Uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotent replay.

---

## 6. Phase 16.1E — Safety Improvements

### `fail_export_job` — max_attempts Guard

**Before**: `next_attempt_at` was always set, even when `attempt_count >= max_attempts`.

**After**:
```sql
IF v_job.attempt_count < v_job.max_attempts THEN
  -- Calculate exponential backoff
  v_next_attempt := now() + v_retry_interval;
ELSE
  v_next_attempt := NULL;  -- No more retries
END IF;
```

### `execute_org_deletion` — Trigger Bypass + Step Reorder

**Problem**: The function set `archived_at` early, then tried to modify `organization_memberships`, `organization_domains`, `organization_invites`, and `organization_identity_providers` — all of which have the `enforce_org_not_archived` trigger. Additionally, `prevent_last_org_admin_removal` blocked deactivating the last admin.

**Fix**:
1. Added session variable bypass: `PERFORM set_config('app.executing_org_deletion', 'true', true);`
2. Both `enforce_org_not_archived` and `prevent_last_org_admin_removal` now check this flag and skip their checks when it's set
3. The flag is transaction-local (3rd arg `true` to `set_config`), so it auto-clears at transaction end
4. Reordered steps: all child table modifications happen before setting `archived_at + deleted_at`

Updated trigger functions:

**`enforce_org_not_archived`** (added at top):
```sql
IF current_setting('app.executing_org_deletion', true) = 'true' THEN
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END IF;
```

**`prevent_last_org_admin_removal`** (added at top):
```sql
IF current_setting('app.executing_org_deletion', true) = 'true' THEN
  RETURN NEW;
END IF;
```

---

## 7. Files Changed

| File | Change |
|------|--------|
| `supabase/tests/governance-jobs-state-machine.sql` | Expanded from 12 to 19 tests (7 new Phase 16.1 tests) |
| `supabase/migrations/20260224000000_phase16_governance_jobs.sql` | **NEW** — consolidated idempotent migration |
| Edge Function `export-jobs-runner` | v2 — added stale lock release call |

### Database Changes (applied via MCP migrations)

| Migration | Content |
|-----------|---------|
| `phase16_1_governance_hardening` | `release_stale_export_locks` RPC + `fail_export_job` fix + GRANT/REVOKE |
| `phase16_1b_fix_deletion_order` | `execute_org_deletion` step reorder |
| `phase16_1c_deletion_trigger_bypass` | Trigger bypass for `enforce_org_not_archived` + `prevent_last_org_admin_removal` + final `execute_org_deletion` |

---

## 8. Validation Summary

| Check | Result |
|-------|--------|
| TypeScript (`tsc --noEmit`) | Clean |
| Build (`vite build`) | Clean, 35.87s |
| SQL tests (state machine) | 19/19 pass |
| SQL tests (governance) | 16/16 pass (unchanged) |
| Frontend tests | 32/32 pass (unchanged) |
| Edge Function `export-jobs-runner` | ACTIVE (v2) |
| Edge Function `org-deletion-runner` | ACTIVE (unchanged) |

---

## 9. Risk Checklist

| Risk | Severity | Status |
|------|----------|--------|
| Stale export locks (stuck running jobs) | **Resolved** | `release_stale_export_locks` RPC + edge function call |
| PUBLIC GRANT on service-role RPCs | **Resolved** | All 9 RPCs now have explicit REVOKE/GRANT |
| `fail_export_job` schedules retry past max_attempts | **Resolved** | Guard: `attempt_count < max_attempts` |
| `execute_org_deletion` blocked by safety triggers | **Resolved** | Session variable bypass + step reorder |
| Cross-org export download | **Mitigated** | `get_export_download_url` checks org membership (Test 16 validates) |
| Cancel-vs-complete race | **Mitigated** | `complete_export_job` rejects non-running jobs (Test 18 validates) |
| Deletion idempotency | **Mitigated** | `execute_org_deletion` raises 'Org already deleted' (Test 17 validates) |
| No PII redaction in exports | Low | Deferred to Phase 17 |
| No external scheduler for Edge Functions | Medium | Functions deployed; pg_cron or external scheduler needed |
| Export artifact size unbounded | Low | Streaming/chunked exports deferred |

---

## 10. Defense-in-Depth Summary

All service-role RPCs now have **two layers** of access control:

1. **PostgreSQL GRANT**: Only `service_role` can call the function
2. **Runtime JWT check**: `current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'`

Authenticated RPCs (`cancel_export_job`, `get_export_download_url`) have:

1. **PostgreSQL GRANT**: Only `authenticated` + `service_role` can call
2. **Runtime authorization**: Function checks org membership / platform admin status
