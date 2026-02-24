# Phase 16 Assessment — Governance Jobs Actually Run

**Date**: 2026-02-23
**Branch**: `project-adjustment`
**Status**: Complete — all validation gates pass

---

## 1. Executive Summary

Phase 16 adds actual execution to the governance infrastructure built in Phase 13. Export jobs now run via Edge Functions with full state-machine tracking, and org deletion has a soft-delete pipeline with lock-based concurrency. Four sub-phases:

| Sub-phase | Scope | Status |
|-----------|-------|--------|
| **16A** | DB state machine + helpers (status CHECK, claim/complete/fail/cancel RPCs, deletion primitives, indexes) | Done |
| **16B** | Edge Functions (export-jobs-runner, org-deletion-runner) | Done |
| **16C** | Frontend UX (exports table in OrgGovernanceSection, AdminConsolePage updates) | Done |
| **16D** | SQL tests + frontend tests + build check + packet | Done |

---

## 2. Phase 16A — DB State Machine + Helpers

### 2.1 Status CHECK Migration

**Before**: `status IN ('pending','running','completed','failed','cancelled')`
**After**: `status IN ('queued','running','succeeded','failed','cancelled')`

Data migration: `pending → queued`, `completed → succeeded` (UPDATE before ALTER).

### 2.2 New Columns on `org_export_jobs` (14 added)

| Column | Type | Purpose |
|--------|------|---------|
| `idempotency_key` | text | Dedup active jobs (unique partial index) |
| `attempt_count` | int (default 0) | Retry tracking |
| `max_attempts` | int (default 3) | Retry cap |
| `next_attempt_at` | timestamptz | Backoff scheduling |
| `locked_at` | timestamptz | Worker lock timestamp |
| `locked_by` | text | Worker ID |
| `started_at` | timestamptz | First execution start |
| `finished_at` | timestamptz | Terminal state timestamp |
| `error_code` | text | Machine-readable error |
| `error_message` | text | Human-readable error |
| `result_url` | text | Signed download URL |
| `storage_path` | text | Storage bucket path |
| `result_expires_at` | timestamptz | Download link expiry |
| `result_bytes` | bigint | Artifact size |

### 2.3 New Columns on `organization_governance` (4 added)

| Column | Type | Purpose |
|--------|------|---------|
| `deleted_at` | timestamptz | Soft-delete timestamp |
| `deleted_by` | uuid | Who executed deletion |
| `deletion_locked_at` | timestamptz | Worker lock for deletion |
| `deletion_locked_by` | text | Worker ID for deletion |

### 2.4 Indexes

| Index | Columns / Condition |
|-------|---------------------|
| `idx_export_jobs_claim` | `(status, next_attempt_at)` WHERE `status IN ('queued','failed')` |
| `idx_export_jobs_org_created` | `(organization_id, created_at DESC)` |
| `idx_export_jobs_idempotency` | `(idempotency_key)` WHERE `idempotency_key IS NOT NULL AND status NOT IN ('succeeded','failed','cancelled')` |

### 2.5 RPCs (8 new)

| RPC | Access | Purpose |
|-----|--------|---------|
| `claim_next_export_job(p_worker_id)` | service_role | FOR UPDATE SKIP LOCKED claim of next eligible queued/failed job |
| `complete_export_job(p_job_id, p_storage_path, p_result_url, p_expires_at, p_bytes)` | service_role | Transition running → succeeded with artifact metadata |
| `fail_export_job(p_job_id, p_error_code, p_error_message, p_retry_in_seconds)` | service_role | Transition running → failed with exponential backoff (`300 * 2^(attempt-1)`, cap 3600s) |
| `cancel_export_job(p_job_id)` | authenticated | Transition queued/failed → cancelled |
| `claim_next_org_deletion(p_worker_id)` | service_role | Lock next org due for deletion (not already locked, not under legal hold) |
| `execute_org_deletion(p_org_id)` | service_role | Soft-delete: set deleted_at/by, deactivate memberships, disable domains/SSO/invites, cancel pending jobs, audit log |
| `release_stale_deletion_locks(p_stale_minutes)` | service_role | Clear locks older than N minutes |
| `get_export_download_url(p_job_id)` | authenticated | Returns storage_path for client-side signed URL generation |

All RPCs use `SECURITY DEFINER`, `SET search_path = 'public'`, and validate `current_setting('request.jwt.claim.role')` for service_role guards.

### 2.6 Storage

Created private bucket `org-exports` for export artifacts.

---

## 3. Phase 16B — Edge Functions

### 3.1 `export-jobs-runner`

**Slug**: `export-jobs-runner` | **verify_jwt**: true | **Status**: ACTIVE

Flow:
1. Claims up to 3 jobs via `claim_next_export_job`
2. For each job, gathers data from 14 tenant-scoped tables:
   - `organizations`, `organization_governance`, `organization_memberships`, `organization_invites`
   - `organization_domains`, `organization_identity_providers`
   - `teams`, `portfolios` (via teams), `workflows`, `projects`, `themes`, `topics`, `captures`, `calendar_events`
   - `organization_audit_log` (respects `retention_days_audit_log` cutoff)
3. Uploads JSON artifact to `org-exports/{org_id}/{job_id}.json`
4. Creates 7-day signed URL
5. Calls `complete_export_job` on success
6. Calls `fail_export_job` on error (with exponential backoff)

Worker ID: `export-jobs-runner-{uuid-prefix}`

### 3.2 `org-deletion-runner`

**Slug**: `org-deletion-runner` | **verify_jwt**: true | **Status**: ACTIVE

Flow:
1. Calls `release_stale_deletion_locks(30)` to clear stuck locks
2. Claims up to 5 orgs via `claim_next_org_deletion`
3. Calls `execute_org_deletion` for each
4. On failure: releases lock (sets `deletion_locked_at = NULL`), writes `org.deletion_failed` audit entry

Worker ID: `org-deletion-runner-{uuid-prefix}`

---

## 4. Phase 16C — Frontend UX

### 4.1 OrgGovernanceSection — Exports Table

**File**: `src/components/organization/OrgGovernanceSection.tsx`

Replaced the single "Request Export" button with a full exports section:

| Feature | Implementation |
|---------|----------------|
| **Exports query** | `useQuery` on `org_export_jobs` filtered by `organization_id`, ordered `created_at DESC`, limit 20 |
| **Auto-refresh** | `refetchInterval: 5000` when any job is `queued` or `running` |
| **Status pills** | Color-coded badges: blue (queued), indigo+spinner (running), green (succeeded), red (failed), gray (cancelled) |
| **Error tooltip** | AlertTriangle icon with `title={error_message}` on failed jobs |
| **Attempt display** | Shows `(attempt/max)` when `attempt_count > 1` |
| **Download button** | For succeeded + not-expired jobs; calls `get_export_download_url` RPC + `supabase.storage.createSignedUrl(path, 600)` |
| **Expired indicator** | "Expired" text when `result_expires_at < now()` |
| **Cancel button** | For queued/failed jobs; calls `cancel_export_job` RPC |
| **Retry button** | For failed jobs; calls `request_org_export` to create a new job |
| **Request Export** | Button in section header, creates new export job |

### 4.2 AdminConsolePage — Export Jobs + Deletion Schedule

**File**: `src/pages/AdminConsolePage.tsx`

Added to org detail view:

| Section | Content |
|---------|---------|
| **Export Jobs card** | Full table identical to OrgGovernanceSection (status, dates, size, attempts, actions) |
| **Deletion Schedule card** | Red-tinted card with formatted deletion date, legal hold warning, cancel button |

Both sections query from the admin's perspective (platform admin has RLS bypass via `is_platform_admin()`).

---

## 5. Files Changed

| File | Change |
|------|--------|
| `src/components/organization/OrgGovernanceSection.tsx` | Exports table with status pills, download, cancel, retry |
| `src/pages/AdminConsolePage.tsx` | Export jobs table + deletion schedule card in org detail |
| `supabase/tests/org-governance.sql` | Fix Test 13 status check (`pending` → `queued`) |
| `supabase/tests/governance-jobs-state-machine.sql` | **NEW** — 12 SQL assertions for state machine |
| Edge Function `export-jobs-runner` | **NEW** — tenant-scoped data export pipeline |
| Edge Function `org-deletion-runner` | **NEW** — soft-delete execution pipeline |
| Migration `phase16_governance_jobs_state_machine` | Status CHECK, 18 new columns, 8 RPCs, 3 indexes, storage bucket |

---

## 6. Tests

### 6.1 SQL Tests — State Machine (12 assertions)

| # | Assertion | Result |
|---|-----------|--------|
| 1 | Status CHECK rejects `'pending'` (invalid) | PASS |
| 2 | Status CHECK accepts `'queued'` (valid) | PASS |
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

### 6.2 Existing SQL Tests — Governance (16 assertions)

Test 13 updated for new status value (`queued` instead of `pending`). All 16/16 pass.

### 6.3 Frontend Tests

**File**: `src/lib/__tests__/org-domain-routing.test.ts` — **32/32 pass** (unchanged)

---

## 7. Validation Summary

| Check | Result |
|-------|--------|
| TypeScript (`tsc --noEmit`) | Clean |
| Build (`vite build`) | Clean, 36.38s |
| Tenant lint | 38 total / 17 P0, delta +0 (at baseline) |
| Frontend tests | 32/32 pass |
| SQL tests (state machine) | 12/12 pass |
| SQL tests (governance) | 16/16 pass |
| Edge Function `export-jobs-runner` | ACTIVE |
| Edge Function `org-deletion-runner` | ACTIVE |

---

## 8. Architecture Notes

### Claim Pattern (FOR UPDATE SKIP LOCKED)

Both `claim_next_export_job` and `claim_next_org_deletion` use the same concurrency-safe pattern:

```sql
SELECT id INTO v_job_id
FROM org_export_jobs
WHERE status IN ('queued', 'failed')
  AND (next_attempt_at IS NULL OR next_attempt_at <= now())
ORDER BY created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

This ensures multiple workers can run concurrently without double-claiming jobs.

### Exponential Backoff

`fail_export_job` calculates retry delay as `300 * 2^(attempt-1)` seconds, capped at 3600s (1 hour):

| Attempt | Delay |
|---------|-------|
| 1 | 5 min |
| 2 | 10 min |
| 3 | 20 min (but max_attempts=3, so this would be the final attempt) |

Override available via `p_retry_in_seconds` parameter.

### Soft Delete Pipeline

`execute_org_deletion` performs these steps atomically:
1. Sets `deleted_at = now()`, `deleted_by = caller`
2. Deactivates all memberships (`status = 'inactive'`)
3. Disables identity providers (`enabled = false`)
4. Cancels pending invites (`status = 'cancelled'`)
5. Sets unverified domains to `status = 'revoked'`
6. Cancels queued export jobs
7. Writes `org.deleted` audit log entry

Legal hold check prevents claiming orgs under hold.

---

## 9. Open Risks / Future Work

| Risk | Severity | Mitigation |
|------|----------|------------|
| Edge Functions require external scheduler (cron) | Medium | Functions are deployed and callable; cron trigger (pg_cron or external) needed for production scheduling |
| No hard data purge after soft delete | Low | Soft delete preserves data for recovery; hard purge is a future "data purge job" |
| Export artifact size unbounded | Low | For large orgs, JSON export could be large; future: streaming/chunked exports |
| Signed URLs expire after 10 min (download) / 7 days (result) | Low | Users can re-click Download for a fresh signed URL; result_expires_at tracks the 7-day window |
| `get_export_download_url` returns storage_path, not signed URL | Low | SQL functions can't generate signed URLs; client uses Supabase Storage SDK for signing |
| No notification when export completes | Low | Auto-refresh (5s) in the UI provides near-real-time status; push notifications deferred |
