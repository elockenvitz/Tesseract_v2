# UX Regression & New Feature Test Plan — Phases 1–16

**Version**: 1.0
**Date**: 2026-02-23
**Scope**: Multi-org, tenant isolation, onboarding, domain routing, SSO/OIDC, governance exports/deletion/archiving, admin console, linter enforcement, deep-link safety, org switch without reload
**Author**: QA Lead (generated)

---

## 1 Executive Map

| # | Feature Area | Phases | Primary Journeys | Risk | Page / Component | Backend Dependency |
|---|---|---|---|---|---|---|
| 1 | **Org Context & Switching** | 1–4, 14 | Switch org, cache clear, no stale flash | **P0** | `Header.tsx`, `OrganizationContext.tsx` | `set_current_org` RPC, `users.current_organization_id` |
| 2 | **Org-Scoped Query Keys** | 2–4 | Every data page loads correct org data | **P0** | `useOrgQueryKey.ts`, all pages | 89 cache prefixes, `org:<id>` suffix |
| 3 | **Setup Wizard (Zero-Org)** | 3–5 | First login → create org → seed → invite | **P0** | `SetupWizard.tsx`, `ProtectedRoute.tsx` | `organizations`, `teams`, `organization_invites` |
| 4 | **Domain Verification** | 6–7 | Add domain → verify → routing active | P1 | `OrgDomainsSection.tsx` | `organization_domains`, `create_domain_verification` RPC |
| 5 | **Email Domain Routing** | 7–8 | Login → auto-route/join/request/block | **P0** | `useAuth.ts`, `org-domain-routing.ts` | `route_org_for_email` RPC |
| 6 | **Onboarding Policy** | 7–8 | open / approval_required / invite_only | **P0** | `ProtectedRoute.tsx`, `OrganizationPage.tsx` | `organizations.onboarding_policy`, `route_org_for_email` |
| 7 | **Org Invites** | 5–8 | Send invite → accept → membership | P1 | `OrganizationPage.tsx` (People tab) | `organization_invites`, `accept_org_invite` RPC |
| 8 | **SSO/OIDC Config** | 13A | Configure IdP, toggle SSO-only | P1 | `OrgIdentityProviderSection.tsx` | `organization_identity_providers`, `upsert_identity_provider` RPC |
| 9 | **SSO Login Gating** | 14A, 15A | Email → SSO check → password/SSO/both | **P0** | `LoginForm.tsx` | `get_identity_provider_for_email` RPC |
| 10 | **OIDC Redirect Flow** | 14A, 15A | Start SSO → IdP → callback → session | **P0** | `LoginForm.tsx`, `SsoCallbackPage.tsx` | `sso-token-exchange` Edge Function |
| 11 | **Archived Org Read-Only** | 14B, 15B–C | All writes blocked + banner + error UX | **P0** | `Layout.tsx`, `useOrgWriteEnabled.ts`, `archived-org-errors.ts` | `enforce_org_not_archived` trigger (25 tables) |
| 12 | **Governance — Retention** | 13B | Set audit log retention 30–3650d | P2 | `OrgGovernanceSection.tsx` | `set_org_governance` RPC |
| 13 | **Governance — Legal Hold** | 13B | Platform admin toggle, blocks deletion | P1 | `AdminConsolePage.tsx`, `OrgGovernanceSection.tsx` | `organization_governance.legal_hold` |
| 14 | **Governance — Archive Org** | 13B, 14B | Platform admin archives → writes blocked | **P0** | `AdminConsolePage.tsx` | `archive_org` RPC, `enforce_org_not_archived` trigger |
| 15 | **Governance — Deletion Schedule** | 16A | Schedule → lock → execute soft-delete | **P0** | `AdminConsolePage.tsx` | `schedule_org_deletion`, `execute_org_deletion` RPCs |
| 16 | **Governance — Export Jobs** | 16A–C | Request → claim → run → download | **P0** | `OrgGovernanceSection.tsx`, `AdminConsolePage.tsx` | `org_export_jobs`, `export-jobs-runner` Edge Function |
| 17 | **Stale Lock Recovery** | 16.1A | Stuck running jobs auto-recover | P1 | — (backend only, UI shows failed status) | `release_stale_export_locks` RPC |
| 18 | **GRANT/REVOKE Hardening** | 16.1B | Anon cannot call service-role RPCs | P1 | — (backend only) | 7 RPCs revoked from public/anon |
| 19 | **Deep-Link Safety** | 8–10 | Open entity in wrong org → banner → switch | **P0** | `useEntityOrgResolver.ts`, `OrgSwitchBanner.tsx` | `resolve_entity_org` RPC |
| 20 | **People Lifecycle** | 5–8 | Suspend/reactivate, last-admin guard | P1 | `OrganizationPage.tsx` (People tab) | `organization_memberships`, triggers |
| 21 | **Temporary Access** | 16 | Grant/revoke temp membership | P1 | `AdminConsolePage.tsx` | `grant_temporary_org_membership`, `revoke_temporary_org_membership` RPCs |
| 22 | **Admin Console** | 13B, 16 | Platform admin org management | P1 | `AdminConsolePage.tsx` | Multiple RPCs, `is_platform_admin()` |
| 23 | **Tenant Lint** | 16 | No cross-org data leaks | **P0** | All pages (lint baseline: 38 violations) | RLS, org-scoped views |
| 24 | **CSV Export Safety** | 15–16 | Formula injection prevention | P2 | `csv-sanitize.ts`, `AuditExplorerPage.tsx` | — |
| 25 | **Org Switch Perf** | 14–16 | ≤25 requests, ≤2MB, ≤3s latency | P1 | `org-switch-perf.ts` | All org-scoped queries |

---

## 2 UX Journeys to Test

### 2.1 Setup Wizard — First-Time User (Zero-Org Gate)

**Persona**: New user, no organization
**Preconditions**: Fresh signup, `current_organization_id = null`, no memberships

| # | Step | Expected UI State | Backend Calls |
|---|---|---|---|
| 1 | Sign up with email + password | Redirect to `/setup` (ProtectedRoute gate) | `auth.signUp`, upsert `users` |
| 2 | Step 1 (Profile): Confirm name/email, select role | Role selector: Investor / Operations / Compliance | — |
| 3 | Click Continue | Advances to Step 2 | Upsert `user_onboarding_status`, `user_profile_extended` |
| 4 | Step 2 (Teams & Access): Browse org chart | Empty state — "No organization yet" or org chart | Query `org_org_chart_nodes_v`, `portfolios` |
| 5 | Step 3 (Your Focus): Role-specific inputs | Investor: style, horizon, sectors; Ops: workflow types; Compliance: areas | — |
| 6 | Step 4 (Data & Tools): Market data provider | Provider selector, data requirements checkboxes | — |
| 7 | Step 5 (Review): Summary card | All choices shown, Complete button enabled | — |
| 8 | Click Complete | Spinner → redirect to Dashboard | Upsert `user_onboarding_status.wizard_completed`, update `users.user_type` |

**Query cache**: All `user-onboarding-status` queries invalidated on complete.
**Failure modes**:
- Network failure on Step 3 save → error toast, form state preserved, retry possible
- Closing browser mid-wizard → resumes at last saved step on next login
- Directly navigating to `/dashboard` → ProtectedRoute redirects back to `/setup`

**Acceptance**: Pass if user completes wizard without error and lands on Dashboard with correct `user_type`.

---

### 2.2 Setup Wizard — Platform Admin Creates New Org

**Persona**: Platform Admin (existing user, `is_platform_admin() = true`)
**Preconditions**: User already has ≥1 org, is platform admin

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Open Header org switcher dropdown | Dropdown lists all orgs + "Create Organization" button at bottom | — |
| 2 | Click "Create Organization" | SetupWizard modal opens over current page | — |
| 3 | Enter org name + slug | Slug auto-generated from name, editable | — |
| 4 | Add teams (at least 1) | Team list with name, description, color fields | — |
| 5 | Add email invites per team | Email input, sends invites on completion | — |
| 6 | Click Create | Spinner → org created → auto-switch to new org | Insert `organizations`, `teams`, `organization_invites`, call `set_current_org` |

**Query cache**: Full org-scoped cache clear on switch (89 prefixes removed).
**Failure modes**:
- Duplicate slug → server error, toast, slug field highlighted
- Invalid email in invite → client-side validation, red outline

**Acceptance**: Pass if new org appears in switcher, user is auto-switched, and Dashboard loads for new org.

---

### 2.3 Email Domain Routing — Open Policy

**Persona**: New user signing up with a domain-verified org (onboarding_policy = `open`)
**Preconditions**: Org "AcmeFund" has verified domain `acme.com`, policy = open

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Sign up with `user@acme.com` | Standard signup form | `auth.signUp`, upsert `users` |
| 2 | Auth resolves, `useAuth` fires `routeOrgByEmail` | Brief loading state | `route_org_for_email` RPC → `{action: 'auto_join', org_id: X}` |
| 3 | RPC returns `auto_join` | — (transparent) | `set_current_org(X)`, re-fetch user profile |
| 4 | User profile updates with `current_organization_id` | ProtectedRoute passes, proceeds to Dashboard or `/setup` | `users` table read |
| 5 | `org-auto-joined` custom event fires | Toast or banner: "You've been added to AcmeFund" | — |

**Query cache**: `user-organizations` query invalidated.
**Failure modes**:
- `route_org_for_email` RPC fails → user has no org → zero-org gate → SetupWizard
- Domain unverified (status=pending) → no route match → user gets zero-org gate

**Acceptance**: Pass if user auto-joins org without manual action and sees correct org in Header.

---

### 2.4 Email Domain Routing — Approval Required

**Persona**: New user, domain-verified org with `onboarding_policy = approval_required`
**Preconditions**: Org "SecureFund" has verified domain `secure.com`, policy = approval_required

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Sign up with `user@secure.com` | Standard signup | `auth.signUp` |
| 2 | `routeOrgByEmail` fires | — | `route_org_for_email` → `{action: 'request_created', org_name: 'SecureFund'}` |
| 3 | ProtectedRoute detects `_routeAction = 'request_created'` | **Amber "Request Sent" screen**: "Your request to join SecureFund has been submitted and is pending admin approval." + Sign Out button | — |
| 4 | User cannot proceed to Dashboard | Only Sign Out is available | — |
| 5 | Org admin approves request | — (separate admin flow) | Update access request status |
| 6 | User signs in again | `routeOrgByEmail` → `{action: 'switch'}` → proceeds to Dashboard | `set_current_org`, user profile update |

**Failure modes**:
- User refreshes while pending → same "Request Sent" screen
- Admin rejects → user sees "Access Required" on next login (assumption: rejection changes to `blocked`)

**Acceptance**: Pass if user is blocked with correct amber screen and can proceed only after admin approval.

---

### 2.5 Email Domain Routing — Invite Only

**Persona**: New user, domain-verified org with `onboarding_policy = invite_only`
**Preconditions**: Org "PrivateFund" has verified domain `private.com`, policy = invite_only

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Sign up with `user@private.com` | Standard signup | `auth.signUp` |
| 2 | `routeOrgByEmail` fires | — | `route_org_for_email` → `{action: 'blocked', org_name: 'PrivateFund'}` |
| 3 | ProtectedRoute detects `_routeAction = 'blocked'` | **Red "Access Required" screen**: "This organization requires an invitation to join. Contact your organization administrator to request access." + Sign Out button | — |
| 4 | User cannot proceed | Only Sign Out available | — |

**Failure modes**:
- User with an existing invite for this org → should route to `switch` or `auto_join` instead of `blocked`

**Acceptance**: Pass if user sees red block screen with correct copy.

---

### 2.6 Org Switching (No Reload)

**Persona**: Org Member with 2+ orgs
**Preconditions**: User is member of OrgA (current) and OrgB, both active

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Click Header org switcher | Dropdown shows OrgA (Active badge) and OrgB | Query `user-organizations` |
| 2 | Click OrgB | Brief loading indicator (no page reload) | `set_current_org(OrgB)` RPC |
| 3 | RPC succeeds | — | Validate membership server-side |
| 4 | Cache clear fires | All 89 org-scoped query prefixes removed from QueryClient | `queryClient.removeQueries()` |
| 5 | User profile re-fetched | `current_organization_id` updated in cache + localStorage | `users` table SELECT |
| 6 | SessionStorage cleared | `tesseract_tab_states` removed, URL params replaced | — |
| 7 | `org-switched` event dispatched | `useAuth` re-reads localStorage cache | — |
| 8 | Current page remounts with OrgB data | All data reflects OrgB. No stale OrgA data visible at any point. | All org-scoped queries refetch |
| 9 | Org switcher shows OrgB as Active | Active badge moves to OrgB | — |

**Query cache behavior**:
- Removed: all 89 `ORG_SCOPED_QUERY_PREFIXES` (organizations, teams, portfolios, workflows, projects, themes, calendar-events, etc.)
- Preserved: non-org data (user auth, app settings)
- Refetched on mount: whichever page components are currently rendered

**Failure modes**:
- `set_current_org` fails (e.g., membership revoked between load and click) → error toast, remain on OrgA
- Stale data flash: old OrgA data briefly visible → **must not happen** (cache is removed before refetch)
- Rapid double-click on different orgs → second call should win (or queue)
- Switching while a mutation is in-flight → mutation should fail gracefully, not corrupt data

**Acceptance**: Pass if switch completes without reload, no stale data flash, all visible data matches OrgB, perf within budget (≤25 requests, ≤2MB, ≤3s).

---

### 2.7 SSO Login — No SSO Configured

**Persona**: Existing user, org has no IdP
**Preconditions**: No row in `organization_identity_providers` for user's org

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Navigate to `/login` | Email + password fields visible | — |
| 2 | Enter email, blur/tab out | SSO check fires (brief) | `get_identity_provider_for_email` → `{has_sso: false}` |
| 3 | ssoState = `no_sso` | Password field remains visible, no SSO button | — |
| 4 | Enter password, submit | Standard auth flow | `auth.signInWithPassword` |

**Acceptance**: Pass if no SSO UI elements appear, login works normally.

---

### 2.8 SSO Login — SSO Optional

**Persona**: Existing user, org has SSO with `sso_only = false`
**Preconditions**: IdP configured, enabled, sso_only=false

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Enter email on `/login`, blur | SSO check fires | `get_identity_provider_for_email` → `{has_sso: true, sso_only: false, discovery_url, client_id, org_id, org_name}` |
| 2 | ssoState = `sso_optional` | **Both** password field AND SSO button visible | — |
| 3a | (Path A) Enter password, submit | Standard password auth | `auth.signInWithPassword` |
| 3b | (Path B) Click "Sign in with SSO" | PKCE flow starts | Generate code_verifier, compute SHA-256 challenge, store state/nonce/verifier in sessionStorage |
| 4b | Redirect to IdP auth URL | Browser navigates to IdP login page | — |
| 5b | Authenticate at IdP | IdP redirects to `/auth/sso/callback?code=...&state=...` | — |
| 6b | SsoCallbackPage loads | "Completing SSO sign-in..." spinner | Validate state, send code+verifier to `sso-token-exchange` |
| 7b | Edge Function returns session | Session set via magic link / verifyOtp / setSession | Token exchange, JWKS verification, nonce check |
| 8b | Redirect to Dashboard | Authenticated, org routed | `routeOrgByEmail` if needed |

**Failure modes**:
- SSO check network error → graceful fallback to password-only (no SSO button)
- State mismatch on callback → "Invalid state parameter. This may be a CSRF attack." error
- Missing PKCE verifier (cleared sessionStorage) → "Missing PKCE verifier" error
- IdP returns error → display `error_description` with back-to-login link
- Token exchange fails → error with retry link

**Acceptance**: Pass if both auth paths work, PKCE parameters are correct, and errors show appropriate messages.

---

### 2.9 SSO Login — SSO Required

**Persona**: Existing user, org has SSO with `sso_only = true`
**Preconditions**: IdP configured, enabled, sso_only=true, org has verified domain

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Enter email on `/login`, blur | SSO check fires | `get_identity_provider_for_email` → `{has_sso: true, sso_only: true, ...}` |
| 2 | ssoState = `sso_required` | Password field **hidden**, SSO button is primary, banner: "Your organization requires SSO sign-in" | — |
| 3 | Click "Sign in with SSO" | PKCE flow (same as 2.8 Path B) | — |
| 4 | (Edge case) User tries form submit with password (e.g., autofill + Enter) | Submit-time SSO check blocks submission, shows error: "Your organization requires SSO" | `checkSsoForEmail` called on submit |

**Failure modes**:
- Autofill populates password before blur → submit-time check catches it (Phase 15A fix)
- SSO button clicked but IdP is down → IdP error page (outside our control), user can navigate back

**Acceptance**: Pass if password entry is blocked, only SSO flow is possible, submit-time check catches autofill.

---

### 2.10 OIDC Callback — All Response Methods

**Persona**: Any SSO user
**Preconditions**: SSO flow initiated, IdP returned authorization code

| # | Scenario | SsoCallbackPage Behavior | Backend |
|---|---|---|---|
| 1 | Edge Function returns `{method: 'redirect', action_link: '...'}` | `window.location.href = action_link` (magic link redirect) | `sso-token-exchange` |
| 2 | Edge Function returns `{method: 'verify_otp', token_hash: '...'}` | `supabase.auth.verifyOtp({token_hash, type: 'magiclink'})` → session set | — |
| 3 | Edge Function returns `{access_token, refresh_token}` | `supabase.auth.setSession({access_token, refresh_token})` | — |
| 4 | Edge Function returns error | Red error box with message + "Back to Login" button | — |

**Acceptance**: Pass if all three response methods establish a valid session.

---

### 2.11 Archived Org — Read-Only Enforcement

**Persona**: Org Member in an archived org
**Preconditions**: `organization_governance.archived_at IS NOT NULL` for current org

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Login / switch to archived org | **Amber banner** at top of Layout: "This organization is archived. All data is read-only." (Archive icon) | `organization_governance` query, `isOrgArchived = true` |
| 2 | Navigate to any data page (Projects, Workflows, etc.) | Data loads and displays correctly (read-only) | Normal SELECT queries succeed |
| 3 | Attempt any create/edit action | Button disabled OR mutation fires → trigger blocks → `mapMutationError` returns user-friendly message | `enforce_org_not_archived` trigger raises exception |
| 4 | Visit Organization Settings | Domain section: all buttons disabled. SSO section: all buttons disabled. Governance: retention input disabled. | `useOrgWriteEnabled` → `{canWrite: false}` |

**Pages to verify write-blocking on (all 25 triggered tables)**:

| Page/Component | Write Action | Expected |
|---|---|---|
| Projects page | Create project | Button disabled or error toast |
| Workflows page | Create workflow | Button disabled or error toast |
| Themes page | Create theme | Button disabled or error toast |
| Calendar page | Create event | Button disabled or error toast |
| Notes page | Create note | Button disabled or error toast |
| Conversations (DM) | Send message | Button disabled or error toast |
| Organization > Teams | Add team | Button disabled or error toast |
| Organization > People | Invite user | Button disabled or error toast |
| Organization > People | Suspend member | Button disabled or error toast |
| Organization > Settings > Domains | Add/verify domain | Button disabled or error toast |
| Organization > Settings > SSO | Update IdP | Button disabled or error toast |
| Coverage settings | Update settings | Button disabled or error toast |
| Trade Lab | Create variant | Error toast (trigger block) |
| TDF page | Create TDF | Button disabled or error toast |
| Asset Allocation | Create period | Button disabled or error toast |
| Org Chart | Add/edit nodes | Button disabled or error toast |

**Failure modes**:
- Client-side gate missed, mutation fires → trigger blocks → `isArchivedOrgError(error)` detects → `mapMutationError` returns "This organization is archived. Changes cannot be saved."
- Banner not showing → check `organization_governance` query and `isOrgArchived` flag

**Acceptance**: Pass if no write succeeds on any of the 25 tables, banner is visible on all pages, and error messages are user-friendly.

---

### 2.12 Governance — Request Data Export (Org Admin)

**Persona**: Org Admin
**Preconditions**: Current org is active (not archived for writes to governance)

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Navigate to Organization > Settings > Governance | Governance section loads with retention, legal hold, export jobs | Query `organization_governance`, `org_export_jobs` |
| 2 | Click "Request Export" button | Scope selector (metadata_only / full), confirm button | — |
| 3 | Select scope, confirm | New job row appears in table with status **queued** (blue pill) | `request_org_export(org_id, scope)` RPC |
| 4 | Wait for runner to claim | Status changes to **running** (indigo pill + spinner) | `export-jobs-runner` calls `claim_next_export_job` |
| 5 | Runner completes | Status changes to **succeeded** (green pill), Download button appears | `complete_export_job` RPC, file in `org-exports` bucket |
| 6 | Click Download | Browser downloads JSON file (10-min signed URL) | `get_export_download_url` RPC → `createSignedUrl` |
| 7 | Wait past expiry (7 days) | Download button hidden, "Expired" label shown | `result_expires_at` check |

**Auto-refresh**: Table polls every 5s when any job is queued/running (`refetchInterval: 5000`).

**Failure modes**:
- Runner crashes mid-job → job stays "running" → after 30min stale lock recovery transitions to "failed" with error_code=STALE_LOCK → retry button appears
- Network error on download → toast error
- Export for different org → RLS blocks access (get_export_download_url checks membership)

**Acceptance**: Pass if full lifecycle (queued → running → succeeded → download) completes, auto-refresh works, and expired exports are correctly gated.

---

### 2.13 Governance — Cancel Export Job

**Persona**: Org Admin
**Preconditions**: Export job in queued or failed state

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Locate queued/failed job in export table | Cancel button visible | — |
| 2 | Click Cancel | Confirmation prompt (assumption) | — |
| 3 | Confirm | Status changes to **cancelled** (gray pill), cancel button hidden | `cancel_export_job(job_id)` RPC |
| 4 | Attempt to cancel a running job | Cancel button should be **hidden** for running jobs | — |

**Failure modes**:
- Race condition: job claimed between page load and cancel click → RPC fails (status no longer queued) → error toast
- Complete-vs-cancel race: `complete_export_job` rejects if already cancelled (Phase 16.1 test)

**Acceptance**: Pass if cancel works on queued/failed, is hidden on running, and races produce clear errors.

---

### 2.14 Governance — Retry Failed Export

**Persona**: Org Admin
**Preconditions**: Export job in failed state, `attempt_count < max_attempts`

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Locate failed job | Red pill, error tooltip with `error_message`, Retry button, attempt counter | — |
| 2 | Click Retry | New export job created (or existing re-queued, assumption: new request) | `request_org_export` RPC |
| 3 | When `attempt_count >= max_attempts` | Retry button hidden, "Max retries exceeded" label | `fail_export_job` sets `next_attempt_at = NULL` |

**Acceptance**: Pass if retry creates new job, and exhausted jobs show no retry option.

---

### 2.15 Governance — Schedule Org Deletion (Platform Admin)

**Persona**: Platform Admin
**Preconditions**: Target org is not under legal hold, not already deleted

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Open Admin Console, select target org | Org detail view with governance card | Query `organizations`, `organization_governance` |
| 2 | Click "Schedule Deletion" | Red confirmation modal with days-from-now input (1–365) | — |
| 3 | Enter days, confirm | Governance card shows red "Deletion Scheduled" badge with date | `schedule_org_deletion(org_id, iso_datetime)` RPC |
| 4 | Click "Cancel Deletion" | Badge removed | `cancel_org_deletion(org_id)` RPC |
| 5 | Attempt schedule while legal hold active | Should fail with clear error | RPC checks `legal_hold` flag |

**Deletion execution** (when `deletion_scheduled_at <= now()`):
- `org-deletion-runner` claims org via `claim_next_org_deletion`
- Executes `execute_org_deletion`: archive → deactivate members → delete domains → disable SSO → cancel invites → cancel exports → audit log entry
- Session variable `app.executing_org_deletion='true'` bypasses triggers during pipeline

**Failure modes**:
- Runner crashes → stale deletion lock → `release_stale_deletion_locks(30)` clears on next run
- Double execution → `execute_org_deletion` checks `deleted_at` → raises "Org already deleted"

**Acceptance**: Pass if scheduling/cancelling works, legal hold blocks scheduling, and execution completes all 7 pipeline steps.

---

### 2.16 Governance — Legal Hold Toggle (Platform Admin)

**Persona**: Platform Admin
**Preconditions**: Admin Console, target org selected

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Click "Enable Legal Hold" | Amber "Legal Hold" badge appears on governance card | `set_org_governance(org_id, p_legal_hold: true)` |
| 2 | Attempt to schedule deletion | Error: deletion blocked by legal hold | `schedule_org_deletion` checks `legal_hold` |
| 3 | Attempt `apply_audit_log_retention` | Org skipped (retention not applied) | RPC skips orgs with `legal_hold = true` |
| 4 | Click "Remove Legal Hold" | Badge disappears | `set_org_governance(org_id, p_legal_hold: false)` |

**Org Admin view**: Governance section shows "Legal Hold" badge as read-only (no toggle).

**Acceptance**: Pass if legal hold blocks deletion + retention, and org admin sees read-only status.

---

### 2.17 Governance — Archive Org (Platform Admin)

**Persona**: Platform Admin
**Preconditions**: Admin Console, target org selected, not already archived

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Click "Archive" button | Amber confirmation modal: "This will make the organization read-only. Can be restored later." | — |
| 2 | Confirm | Governance card shows "Archived" badge | `archive_org(org_id)` RPC |
| 3 | Switch to the archived org (as a member) | Amber banner in Layout, all writes blocked | `isOrgArchived = true` |

**Note**: No `unarchive_org` RPC exists (known limitation). Restoration requires manual DB update.

**Acceptance**: Pass if archiving triggers read-only behavior across all pages.

---

### 2.18 People Lifecycle — Suspend/Reactivate Member

**Persona**: Org Admin
**Preconditions**: Organization > People tab, target member is active

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Click Suspend on a member row | Modal opens: reason input field (required) | — |
| 2 | Enter reason, confirm | Member status changes to "inactive", suspension reason visible | Update `organization_memberships`: status='inactive', suspended_at, suspended_by, suspension_reason |
| 3 | Click Reactivate on suspended member | Confirmation prompt | — |
| 4 | Confirm | Status returns to "active" | Update `organization_memberships`: status='active', clear suspension fields |

**Failure modes**:
- Attempt to suspend self → **"Cannot self-deactivate"** guard (assumption: client-side or RPC check)
- Attempt to suspend last admin → **"Cannot remove last admin"** guard (`prevent_last_org_admin_removal` trigger)
- Suspended user tries to login → `route_org_for_email` should not route to this org (membership inactive)

**Acceptance**: Pass if suspend/reactivate works, self-deactivation blocked, last-admin guard enforced.

---

### 2.19 People Lifecycle — Org Admin Toggle

**Persona**: Org Admin
**Preconditions**: Organization > People tab

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Click admin toggle (crown icon) on a regular member | Confirmation prompt | — |
| 2 | Confirm | Crown icon fills, member is now org admin | Update `organization_memberships.is_org_admin = true` |
| 3 | Click admin toggle on an existing admin | Confirmation prompt | — |
| 4 | Confirm | Crown icon unfills | Update `organization_memberships.is_org_admin = false` |

**Failure modes**:
- Revoking admin from last admin → trigger blocks → error toast

**Acceptance**: Pass if toggle works bidirectionally, last-admin revocation blocked.

---

### 2.20 Temporary Access — Grant & Revoke (Platform Admin)

**Persona**: Platform Admin
**Preconditions**: Admin Console, target org selected

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | In Temporary Access section, enter User ID + Duration (minutes) | Input fields visible | — |
| 2 | Click Grant | New row in temporary grants list with user + expiry datetime | `grant_temporary_org_membership(org_id, user_id, duration_minutes)` RPC |
| 3 | Temp user logs in | Can access org data (routes normally) | `organization_memberships.expires_at` set |
| 4 | Click Revoke on temp grant | Confirmation prompt | — |
| 5 | Confirm | Grant row removed | `revoke_temporary_org_membership(org_id, user_id, reason)` RPC |
| 6 | Temp user tries to access after expiry | Membership expired, no access | RLS checks `expires_at` (assumption) |

**Failure modes**:
- Invalid user ID → RPC error, toast
- Duration = 0 or negative → validation error (assumption: client-side)

**Acceptance**: Pass if grant creates expiring membership, revoke removes it, and expired memberships deny access.

---

### 2.21 Org Invites — Send & Accept

**Persona**: Org Admin (sender), New User (recipient)
**Preconditions**: Organization > People tab

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Admin enters email in invite field | Email input with Send button | — |
| 2 | Click Send | Invite appears in "Pending Invites" list with status: pending/sent | Insert `organization_invites` |
| 3 | Recipient signs up with invited email | `routeOrgByEmail` detects pending invite | `route_org_for_email` returns `auto_join` or `switch` |
| 4 | Invite status updates to accepted | Invite row shows "accepted" with timestamp | `accept_org_invite` RPC (assumption: called during routing) |

**Failure modes**:
- Duplicate invite to same email → error toast or upsert
- Invite expired → recipient gets zero-org gate (not auto-joined)
- Org archived → invite send blocked by trigger

**Acceptance**: Pass if invite lifecycle completes, recipient auto-joins.

---

### 2.22 Requests Tab — Join Org Approve/Reject

**Persona**: Org Admin
**Preconditions**: Organization > Requests tab, pending access requests exist (from `approval_required` routing)

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Open Requests tab | List of pending requests with requester name/email, reason, date | Query access requests |
| 2 | Click Approve on a request | Confirmation dialog | — |
| 3 | Confirm | Request status = approved, membership created | Update request, insert `organization_memberships` |
| 4 | Click Reject on a request | Confirmation dialog with optional reason | — |
| 5 | Confirm | Request status = rejected | Update request status |
| 6 | Approved user logs in | Routes to org successfully | `route_org_for_email` → `switch` |

**Acceptance**: Pass if approve creates membership, reject blocks access, and user routes correctly after.

---

### 2.23 Domain Verification — Full Flow

**Persona**: Org Admin
**Preconditions**: Organization > Settings > Domains section

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Enter domain (e.g., `firm.com`) and click Add | Domain appears with status "pending", token displayed with copy button, Verify button | `create_domain_verification(domain)` RPC → generates token |
| 2 | Copy token, add DNS TXT record (or use quick-verify) | — | — |
| 3 | Click Verify | Status changes to "verified" (green checkmark + date) | `verify_domain(token)` RPC |
| 4 | New users with `@firm.com` are now routed | — | `route_org_for_email` matches domain |
| 5 | Click Delete on verified domain | Confirmation → domain removed | DELETE on `organization_domains` |

**Failure modes**:
- Duplicate domain → RPC error (unique constraint)
- Archived org → Add/Verify/Delete buttons disabled (`useOrgWriteEnabled`)
- Verify with wrong token → RPC returns error

**Acceptance**: Pass if full lifecycle works, routing activates after verification, archived state blocks all actions.

---

### 2.24 SSO/OIDC Configuration

**Persona**: Org Admin
**Preconditions**: Organization > Settings, org has verified domain (required for SSO-only)

| # | Step | Expected UI State | Backend |
|---|---|---|---|
| 1 | Navigate to SSO section | Form with Discovery URL, Client ID, Client Secret, Enable SSO toggle, SSO-only toggle | Query `organization_identity_providers` |
| 2 | Enter Discovery URL + Client ID | Save button enables (hasChanges detection) | — |
| 3 | Optionally enter Client Secret | Password field, shows •••• after save | — |
| 4 | Toggle Enable SSO on | — | — |
| 5 | Click Save | Success toast, form resets to saved state | `upsert_identity_provider` RPC (encrypts client secret via PGP) |
| 6 | Toggle SSO-only on (requires verified domain) | If no verified domain: error/warning (assumption) | `upsert_identity_provider` checks `organization_domains` |
| 7 | Click Disconnect | Red confirmation modal | — |
| 8 | Confirm disconnect | IdP removed, SSO disabled | `delete_identity_provider` RPC |

**Failure modes**:
- Save without required fields → client-side validation
- SSO-only without verified domain → RPC error
- Archived org → all fields disabled

**Acceptance**: Pass if IdP can be created/updated/deleted, SSO-only gated on verified domain.

---

## 3 Cross-Org / Tenant Boundary UX Tests

### 3.1 Deep-Link to Entity in Different Org

For each entity type, test opening a direct URL while signed into a different org:

| Entity Type | URL Pattern | Expected Behavior | Component |
|---|---|---|---|
| Workflow | `/workflows/:id` | OrgSwitchBanner: "This workflow belongs to {OrgB}. Switch to view." | `WorkflowsPage.tsx` + `useEntityOrgResolver` |
| Project | `/projects/:id` | OrgSwitchBanner with "This project" label | `ProjectDetailTab.tsx` + `useEntityOrgResolver` |
| Conversation | `/messages/:id` | OrgSwitchBanner with "This conversation" label | `DirectMessaging.tsx` + `useEntityOrgResolver` |
| Theme | `/themes/:id` | OrgSwitchBanner (assumption: if entity resolver is wired) | `ThemesListPage.tsx` |
| Calendar Event | `/calendar?event=:id` | OrgSwitchBanner (assumption) | `CalendarPage.tsx` |
| Capture | `/captures/:id` | OrgSwitchBanner (assumption) | Capture viewer |
| Portfolio | `/portfolios/:id` | OrgSwitchBanner (assumption) | Portfolio page |
| Note | `/notes/:id` | OrgSwitchBanner (assumption) | `NotesListPage.tsx` |

**For each row, test**:

| # | Step | Expected |
|---|---|---|
| 1 | Open URL while in OrgA, entity belongs to OrgB | Query returns 0 rows → `shouldResolve = true` |
| 2 | `resolve_entity_org` RPC fires | Returns OrgB id |
| 3 | OrgSwitchBanner renders | Amber banner with org name + Switch button |
| 4 | Click Switch | `switchOrg(OrgB.id)` → full cache clear → page reloads with OrgB data |
| 5 | Entity now visible | Correct data displayed |

**Edge cases**:
- Entity doesn't exist in any org → `resolve_entity_org` returns null → show "Not Found" (not a switch banner)
- User is not a member of the entity's org → switch attempt fails → error toast, remain on current org
- User has no membership in OrgB → cannot switch, banner should say "You don't have access" (assumption)

---

### 3.2 OrgSwitchBanner Behavior Matrix

| Scenario | Banner Shown? | Switch Possible? | Expected UI |
|---|---|---|---|
| Entity in current org | No | N/A | Normal page load |
| Entity in different org (user is member) | Yes | Yes | Amber banner + Switch button |
| Entity in different org (user is NOT member) | Yes (assumption) | No | Banner + "Request Access" or "Contact Admin" |
| Entity doesn't exist | No | N/A | "Not Found" empty state |
| Entity org is archived | Yes | Yes | Switch works, then archived banner appears |

---

### 3.3 Auto-Routing on Login by Email Domain

| Scenario | Email Domain | Org Domain Status | Onboarding Policy | Expected Action |
|---|---|---|---|---|
| Verified domain, open policy | `@firm.com` | verified | open | `auto_join` → auto-switch |
| Verified domain, approval | `@firm.com` | verified | approval_required | `request_created` → pending screen |
| Verified domain, invite only | `@firm.com` | verified | invite_only | `blocked` → blocked screen |
| Pending domain | `@firm.com` | pending | any | No match → zero-org gate |
| No matching domain | `@random.com` | — | — | No match → zero-org gate |
| Multiple orgs match domain | `@firm.com` | verified (2 orgs) | — | First match or priority logic (assumption) |
| User already has membership | `@firm.com` | verified | any | `switch` → set as current org |

---

### 3.4 Cache Invalidation Correctness on Org Switch

**All 89 org-scoped query prefixes must be removed**. Verify no stale data by:

| Test | Method | Pass Criteria |
|---|---|---|
| Projects list after switch | Navigate to Projects page | Shows OrgB projects, zero OrgA projects visible |
| Workflows list after switch | Navigate to Workflows page | Shows OrgB workflows |
| Themes list after switch | Navigate to Themes page | Shows OrgB themes |
| Calendar events after switch | Navigate to Calendar page | Shows OrgB events |
| Teams in org page | Navigate to Organization > Teams | Shows OrgB teams |
| Members in org page | Navigate to Organization > People | Shows OrgB members |
| Portfolios | Navigate to any portfolio view | Shows OrgB portfolios |
| Conversations | Open direct messages | Shows OrgB conversations |
| Notifications | Check notification dropdown | Shows OrgB notifications |
| Coverage settings | Open coverage page | Shows OrgB settings |
| Org chart | Open Organization > Portfolios | Shows OrgB chart |

**Method**: Switch from OrgA (has data) to OrgB (different data). Verify no OrgA data appears on any page. Use browser DevTools Network tab to confirm fresh requests are made (no cache hits).

---

### 3.5 Org Switch Without Reload — No Stale Flash

| # | Step | Expected |
|---|---|---|
| 1 | Be on Projects page in OrgA (5 visible projects) | OrgA data displayed |
| 2 | Open org switcher, click OrgB | Cache cleared BEFORE any component refetch |
| 3 | Observe screen during transition | Brief loading state (skeleton or spinner) — **never** shows OrgA projects |
| 4 | OrgB data loads | OrgB projects displayed (3 projects, different from OrgA) |

**Critical check**: At no point during step 3 should OrgA data be visible. The `removeQueries` call happens before `org-switched` event triggers refetches.

---

## 4 Identity & Access UX Tests

### 4.1 Setup Wizard Flows

| Scenario | Trigger | Expected Flow |
|---|---|---|
| First-ever login, 0 orgs | ProtectedRoute: no `current_organization_id` | Redirect to `/setup`, complete 5-step wizard |
| First login after domain auto-join | `routeOrgByEmail` → `auto_join` | Skip wizard if org already has onboarding data; otherwise start wizard in org context |
| Platform admin creates new org | Header dropdown > Create Organization | SetupWizard modal (org name, teams, invites) → auto-switch |
| Return to wizard after browser close | Refresh during wizard | Resume at last saved step via `user_onboarding_status` |
| Skip all optional steps | Click Skip on steps 2–4 | Proceed to Review, marked as skipped in `user_onboarding_status` |

---

### 4.2 Org Switcher Dropdown States

| State | UI | Actions Available |
|---|---|---|
| Single org, regular user | Org name displayed (no dropdown arrow) | None |
| Multiple orgs, regular user | Dropdown with all orgs, Active badge on current | Click to switch |
| Multiple orgs, platform admin | Dropdown with all orgs + "Create Organization" button | Switch + Create |
| Archived org in list | Org name + small archive indicator (assumption) | Can switch to it (will see archived banner) |
| During switch | Loading indicator | Clicks disabled |

---

### 4.3 Domain Verification + Routing Outcomes

| Domain State | Login with matching email | Expected Outcome |
|---|---|---|
| Verified, open | `user@domain.com` | `auto_join` or `switch` |
| Verified, approval_required | `user@domain.com` | `request_created` → pending screen |
| Verified, invite_only | `user@domain.com` | `blocked` → block screen |
| Pending (not verified) | `user@domain.com` | No match → zero-org gate |
| Deleted domain | `user@domain.com` | No match → zero-org gate |
| Two orgs claim same domain (both verified) | `user@domain.com` | First match wins (assumption) |

---

### 4.4 Onboarding Policy UI

**Location**: Organization > Settings (assumption: policy selector for org admins)

| Policy | Behavior for new users with matching domain | UI Indicator |
|---|---|---|
| `open` | Auto-join, immediate access | Green badge |
| `approval_required` | Join request created, pending admin approval | Amber badge |
| `invite_only` | Blocked unless explicitly invited | Red badge |

**Test**: Change policy from open → invite_only, then have a new user sign up with matching domain. Verify they see the "Access Required" block screen.

---

### 4.5 People Lifecycle — Full Matrix

| Action | Actor | Target | Guard | Expected |
|---|---|---|---|---|
| Suspend | Org Admin | Regular member | — | Status → inactive, reason captured |
| Suspend | Org Admin | Self | Cannot self-deactivate | Error, no change |
| Suspend | Org Admin | Last admin | `prevent_last_org_admin_removal` | Error, no change |
| Reactivate | Org Admin | Suspended member | — | Status → active |
| Revoke admin | Org Admin | Non-last admin | — | `is_org_admin = false` |
| Revoke admin | Org Admin | Last admin | Trigger guard | Error, no change |
| Promote to admin | Org Admin | Regular member | — | `is_org_admin = true` |

---

### 4.6 SSO Gating in LoginForm — Edge Cases

| Scenario | Email State | ssoState | UI |
|---|---|---|---|
| No email entered | empty | `idle` | Password field visible, no SSO |
| Email entered, checking | `user@firm.com` | `checking` | Brief spinner near email field |
| SSO check returns no SSO | `user@nosso.com` | `no_sso` | Password only |
| SSO check returns optional | `user@sso.com` | `sso_optional` | Password + SSO button |
| SSO check returns required | `user@sso-only.com` | `sso_required` | Password hidden, SSO button only, banner |
| Paste email (no blur) + submit | `user@sso-only.com` | `idle` → submit-time check | Submit triggers SSO check, blocks if required |
| Autofill email + password + submit | `user@sso-only.com` | `idle` → submit-time check | Submit triggers SSO check, blocks if required |
| SSO check network error | `user@down.com` | `idle` (fallback) | Password-only fallback, no SSO button |
| Change email from SSO → non-SSO | blur | `no_sso` | SSO button disappears, password field reappears |

---

### 4.7 OIDC Redirect Flow — Full Chain

```
LoginForm → checkSsoForEmail → store state/nonce/verifier in sessionStorage
→ fetch discovery document → build auth URL → redirect to IdP
→ IdP authenticates → redirect to /auth/sso/callback?code=...&state=...
→ SsoCallbackPage validates state → sends to sso-token-exchange Edge Function
→ Edge Function: exchange code → JWKS verify → nonce check → email_verified
→ find/create user → generate magic link / session
→ SsoCallbackPage: set session → routeOrgByEmail → Dashboard
```

**Validation checkpoints**:

| Checkpoint | What's Checked | Failure Response |
|---|---|---|
| State parameter | `callback.state === sessionStorage.sso_state` | "Invalid state parameter. This may be a CSRF attack." |
| PKCE verifier | `sessionStorage.sso_code_verifier` exists | "Missing PKCE verifier" |
| Token exchange | Edge Function returns success | Show `error_description` + back-to-login link |
| JWKS verification | `jose.jwtVerify(idToken, JWKS, {issuer, audience})` | Exchange fails, error returned |
| Nonce | id_token.nonce === stored nonce | Exchange fails, anti-replay error |
| email_verified | `id_token.email_verified === true` | HTTP 403, "Email not verified" |
| Issuer | `id_token.iss === expected_issuer` | Verification fails |
| Audience | `id_token.aud === client_id` | Verification fails |

---

### 4.8 Error UX Consistency

All user-facing errors should follow consistent patterns:

| Error Source | Detection | User Message | Component |
|---|---|---|---|
| Archived org write | `isArchivedOrgError(error)` regex | "This organization is archived. Changes cannot be saved." | `mapMutationError` in `archived-org-errors.ts` |
| RLS denial | HTTP 403 or empty result | Context-dependent (e.g., "You don't have access") | Per-component |
| SSO state mismatch | State param comparison | "Invalid state parameter. This may be a CSRF attack." | `SsoCallbackPage.tsx` |
| SSO missing verifier | sessionStorage check | "Missing PKCE verifier" | `SsoCallbackPage.tsx` |
| SSO exchange failure | Edge Function error | Error message from response + back-to-login | `SsoCallbackPage.tsx` |
| Network failure | Catch block | Toast with retry option | Per-component |
| Org blocked | `_routeAction = 'blocked'` | "This organization requires an invitation to join." | `ProtectedRoute.tsx` |
| Org request pending | `_routeAction = 'request_created'` | "Your request to join has been submitted and is pending admin approval." | `ProtectedRoute.tsx` |

---

## 5 Governance UX Tests

### 5.1 OrgGovernanceSection — Full Feature Matrix

**Location**: `OrganizationPage.tsx` > Settings tab > `OrgGovernanceSection.tsx`

| Feature | Control | State | Expected UI |
|---|---|---|---|
| Retention days | Number input (30–3650) | Editable | Save button appears only when value changed |
| Retention days | Save | Submitted | `set_org_governance(org_id, retention_days)` → success toast |
| Retention days | Invalid value (29 or 3651) | Validation | Input rejected or clamped (assumption: HTML min/max) |
| Legal hold | Badge | Active | Amber badge: "Legal Hold Active" (read-only for org admin) |
| Legal hold | Badge | Inactive | No badge |
| Archived status | Badge | Archived | Amber warning: org is archived |
| Deletion scheduled | Badge | Scheduled | Red warning with date, Cancel button (if platform admin) |
| Export jobs | Table | Empty | "No exports yet" placeholder |
| Export jobs | Table | Has jobs | Rows with status pills, timestamps, actions |

### 5.2 Export Jobs Table — Status States

| Status | Pill Color | Spinner | Actions Available |
|---|---|---|---|
| `queued` | Blue (`bg-blue-100 text-blue-700`) | No | Cancel |
| `running` | Indigo (`bg-indigo-100 text-indigo-700`) | Yes | None (cancel hidden) |
| `succeeded` | Green (`bg-green-100 text-green-700`) | No | Download (if not expired) |
| `failed` | Red (`bg-red-100 text-red-700`) | No | Retry, Cancel |
| `cancelled` | Gray (`bg-gray-100 text-gray-500`) | No | None |

**Additional columns**: Attempt counter (e.g., "2/3"), error message tooltip on failed, file size on succeeded, timestamps.

### 5.3 Export Auto-Refresh & Polling

| Condition | refetchInterval | Expected |
|---|---|---|
| All jobs terminal (succeeded/failed/cancelled) | Off (normal stale time) | No polling |
| Any job queued or running | 5000ms | Table updates every 5s |
| Job transitions from running → succeeded | Polling stops after next cycle | Download button appears |

**Perf budget**: Polling must not cause visible jank. Each poll is a single lightweight SELECT.

### 5.4 Export Download Signed URL

| # | Step | Expected |
|---|---|---|
| 1 | Click Download on succeeded job | Calls `get_export_download_url(job_id)` RPC |
| 2 | RPC returns `storage_path` | Client calls `supabase.storage.createSignedUrl(path, 600)` (10 min) |
| 3 | Signed URL obtained | Opens in new browser tab/window |
| 4 | Click Download on expired job (past `result_expires_at`) | Download button hidden, "Expired" shown |

### 5.5 AdminConsolePage Governance Cards

| Card | Content | Actions |
|---|---|---|
| **Summary** | Total / Active / Suspended / Pending Invites counts | — |
| **Governance** | Badges: Legal Hold, Archived, Deletion Scheduled | Enable/Remove Legal Hold, Archive, Schedule/Cancel Deletion, Request Export |
| **Export Jobs** | Same table as OrgGovernanceSection | Download, Cancel, Retry |
| **Temporary Access** | List of grants with expiry | Grant (input: user ID + duration), Revoke |
| **Members** | Table with name, email, status, role, admin badge, temp expiry | CSV export |
| **Pending Invites** | Table with email, status, date | — |

### 5.6 Archived Org — Write-Disabled UX Across All Pages

**Trigger**: `organization_governance.archived_at IS NOT NULL`

**UI manifestation at each level**:

1. **Layout level**: Amber sticky banner: "This organization is archived. All data is read-only."
2. **Component level**: `useOrgWriteEnabled()` → `canWrite: false` → buttons disabled with tooltip
3. **Mutation level**: If client gate is missed, trigger raises → `mapMutationError` → user-friendly toast

**Pages to verify** (comprehensive, grouped by triggered table):

| Triggered Table | Pages/Components Affected | Write Actions to Verify Disabled |
|---|---|---|
| `workflows` | WorkflowsPage | Create, edit, delete workflow |
| `projects` | ProjectsPage | Create, edit, archive project |
| `themes` | ThemesListPage | Create, edit theme |
| `conversations` | DirectMessaging | Send message, create conversation |
| `calendar_events` | CalendarPage | Create, edit, delete event |
| `topics` | Various | Create topic |
| `captures` | QuickThoughtCapture | Create capture |
| `teams` | Organization > Teams | Create, edit, delete team |
| `portfolios` | Organization > Portfolios | Create, edit, delete portfolio |
| `team_memberships` | Organization > Teams | Add/remove team member |
| `portfolio_memberships` | Organization > Portfolios | Add/remove portfolio member |
| `organization_domains` | Organization > Settings > Domains | Add, verify, delete domain |
| `organization_identity_providers` | Organization > Settings > SSO | Create, update, delete IdP |
| `organization_invites` | Organization > People | Send invite |
| `organization_memberships` | Organization > People | Suspend, reactivate, admin toggle |
| `project_assignments` | ProjectsPage | Assign member |
| `custom_notebooks` | Notes system | Create notebook |
| `coverage_settings` | Coverage page | Update settings |
| `org_chart_nodes` | Organization > Portfolios | Add/edit/delete node |
| `org_chart_node_members` | Organization > Portfolios | Add/remove node member |
| `org_chart_node_links` | Organization > Portfolios | Link/unlink node |
| `target_date_funds` | TDFListPage | Create/edit TDF |
| `case_templates` | Templates | Create/edit template |
| `workflow_templates` | Templates | Create/edit workflow template |

---

## 6 Performance / Resilience UX Tests

### 6.1 Org Switch Performance Budgets

**Instrumentation**: `org-switch-perf.ts` patches `globalThis.fetch`

| Metric | Budget | How to Observe |
|---|---|---|
| Supabase request count | ≤ 25 | `orgSwitchPerf.report().requestCount` |
| Total bytes transferred | ≤ 2 MB | `orgSwitchPerf.report().totalBytes` |
| Max single-request latency | ≤ 3000 ms | `orgSwitchPerf.report().maxLatencyMs` |
| Total switch duration | Qualitative: < 3s perceived | `orgSwitchPerf.report().durationMs` |

**Test procedure**:
1. Open browser DevTools console
2. Call `orgSwitchPerf.start()` (or import if not global)
3. Switch org via Header dropdown
4. Call `orgSwitchPerf.stop()` and `orgSwitchPerf.report()`
5. Verify all metrics within budget
6. Call `orgSwitchPerf.assertWithinBudget()` — should not throw

### 6.2 Stress Cases

| Scenario | Setup | Expected Behavior |
|---|---|---|
| **500 members** | Org with 500 active members | People tab loads with pagination (PAGE_SIZE=25), no timeout |
| **200 export jobs** | Org with 200 historical exports | Governance table shows recent 20 (query limited), scroll or pagination |
| **Rapid org switching** | Click 5 different orgs in quick succession | Last switch wins, no race conditions, no stale data |
| **Simultaneous mutations** | Two browser tabs, same user, different mutations | RLS prevents conflicts, optimistic updates don't corrupt |
| **Large org chart** | 50+ nodes, deep nesting | Renders without lag, expand/collapse smooth |
| **Bulk invite** | Send 50 invites at once | All invites created, no timeout (assumption: sequential) |

### 6.3 Offline / Slow Network

| Scenario | Expected UX |
|---|---|
| Network drops during org switch | Error toast: "Failed to switch organization", remain on current org |
| Network drops during export request | Error toast, job not created (no dangling state) |
| Slow network (3G) during SSO callback | "Completing SSO sign-in..." spinner stays visible, no timeout until 30s |
| Network drops during data page load | React Query retry logic (3 retries), then error state with retry button |
| Network drops during mutation | Error toast via `mapMutationError`, no data corruption |
| Offline indicator | No explicit offline banner (assumption); React Query suspends retries |

---

## 7 "Do Not Miss" Checklist (P0)

### Authentication & Identity
- [ ] **Zero-org gate**: New user with no org → redirected to `/setup`, cannot access any data page
- [ ] **Blocked user screen**: `invite_only` org → "Access Required" red screen, only Sign Out available
- [ ] **Pending request screen**: `approval_required` org → "Request Sent" amber screen, only Sign Out available
- [ ] **SSO-required blocks password**: `sso_only=true` → password field hidden, SSO button only
- [ ] **SSO submit-time check**: Autofilled password + Enter on SSO-required org → blocked with error
- [ ] **OIDC callback validates state**: Mismatched state → "Invalid state parameter" error
- [ ] **OIDC callback validates PKCE**: Missing verifier → "Missing PKCE verifier" error
- [ ] **SSO token exchange JWKS verification**: Invalid token → exchange fails, error shown

### Org Switching & Cache
- [ ] **Switch without reload**: No full page refresh, SPA transition only
- [ ] **No stale data flash**: During switch, old org data never visible (cache cleared first)
- [ ] **All org-scoped queries refetch**: Projects, workflows, themes, calendar, teams, people — all show new org data
- [ ] **SessionStorage cleared**: Tab states reset on switch
- [ ] **Perf budget**: ≤25 requests, ≤2MB, ≤3s on switch

### Deep-Link Safety
- [ ] **OrgSwitchBanner appears**: Navigate to entity URL in wrong org → amber banner with Switch button
- [ ] **Switch from banner works**: Click Switch → org changes → entity loads correctly
- [ ] **Non-existent entity**: No banner, shows "Not Found" or empty state
- [ ] **Non-member org entity**: Banner shown but switch fails gracefully (no silent error)

### Archived Org
- [ ] **Amber banner visible**: On every page when org is archived
- [ ] **All 25 triggered tables block writes**: No write succeeds on any archived org table
- [ ] **Error message is user-friendly**: "This organization is archived. Changes cannot be saved." (not raw SQL error)
- [ ] **Client-side gates work**: Buttons disabled via `useOrgWriteEnabled` before mutation fires

### Governance
- [ ] **Export lifecycle completes**: queued → running → succeeded → download works
- [ ] **Export polling activates**: Table auto-refreshes while jobs are active
- [ ] **Cancel works on queued/failed**: Job transitions to cancelled
- [ ] **Download signed URL works**: File downloads from private `org-exports` bucket
- [ ] **Stale lock recovery**: Running job stuck >30min → transitions to failed on next runner cycle
- [ ] **Deletion scheduling**: Platform admin can schedule, cancel; legal hold blocks scheduling
- [ ] **Deletion execution**: All 7 pipeline steps complete (archive, deactivate, domains, SSO, invites, exports, audit)

### People Lifecycle
- [ ] **Cannot suspend self**: Self-deactivation blocked with clear error
- [ ] **Cannot remove last admin**: Trigger prevents removing/suspending/demoting last org admin
- [ ] **Suspend captures reason**: Reason modal required, stored in `suspension_reason`
- [ ] **Reactivate clears suspension**: Status returns to active, suspension fields cleared

### Admin Console
- [ ] **Platform admin gate**: Non-platform-admin cannot access Admin Console
- [ ] **Legal hold toggle**: Enable/disable works, blocks/unblocks deletion scheduling
- [ ] **Archive from console**: Triggers read-only enforcement across entire org
- [ ] **Temp access grant/revoke**: Creates/removes time-limited membership
- [ ] **Cross-org export download blocked**: Org B admin cannot download Org A's export (RLS)

### Tenant Isolation (Lint Baseline)
- [ ] **No cross-org data leaks**: Every data page shows only current org's data
- [ ] **Org-scoped query keys**: All queries include `org:<id>` suffix
- [ ] **RLS enforcement**: Direct Supabase queries respect `current_org_id()` filter
- [ ] **CSV export sanitization**: Formula injection prevented via `csvSanitizeCell`

---

## Appendix A: Component/File Reference

| Component | File Path | Purpose |
|---|---|---|
| OrganizationContext | `src/contexts/OrganizationContext.tsx` | Org state, switching, cache management |
| Header | `src/components/layout/Header.tsx` | Org switcher, navigation, notifications |
| Layout | `src/components/layout/Layout.tsx` | Archived org banner, tab management |
| ProtectedRoute | `src/components/ProtectedRoute.tsx` | Auth + onboarding + routing gates |
| LoginForm | `src/components/auth/LoginForm.tsx` | SSO gating, PKCE initiation |
| SsoCallbackPage | `src/pages/auth/SsoCallbackPage.tsx` | OIDC callback handling |
| SetupWizard | `src/components/onboarding/SetupWizard.tsx` | 5-step onboarding wizard |
| AdminConsolePage | `src/pages/AdminConsolePage.tsx` | Platform admin org management |
| OrganizationPage | `src/pages/OrganizationPage.tsx` | Org settings (7 tabs) |
| OrgDomainsSection | `src/components/organization/OrgDomainsSection.tsx` | Domain verification |
| OrgIdentityProviderSection | `src/components/organization/OrgIdentityProviderSection.tsx` | SSO/OIDC config |
| OrgGovernanceSection | `src/components/organization/OrgGovernanceSection.tsx` | Retention, exports, legal hold |
| OrgBadge | `src/components/common/OrgBadge.tsx` | Inline org indicator |
| OrgSwitchBanner | `src/components/common/OrgSwitchBanner.tsx` | Cross-org deep-link banner |
| useOrgQueryKey | `src/hooks/useOrgQueryKey.ts` | Org-scoped cache keys |
| useOrgWriteEnabled | `src/hooks/useOrgWriteEnabled.ts` | Archived write gate |
| useEntityOrgResolver | `src/hooks/useEntityOrgResolver.ts` | Deep-link org resolution |
| useOrganizationData | `src/hooks/useOrganizationData.ts` | Consolidated org queries |
| org-domain-routing | `src/lib/org-domain-routing.ts` | Email routing + SSO check |
| org-switch-perf | `src/lib/org-switch-perf.ts` | Switch performance monitoring |
| archived-org-errors | `src/lib/archived-org-errors.ts` | Error detection + mapping |
| csv-sanitize | `src/lib/csv-sanitize.ts` | Formula injection prevention |

## Appendix B: RPC Reference

| RPC | Caller | Purpose |
|---|---|---|
| `set_current_org(p_org_id)` | Authenticated | Switch active org |
| `route_org_for_email(p_email)` | Authenticated | Domain-based org routing |
| `get_identity_provider_for_email(p_email)` | Public (anon) | SSO discovery by email |
| `upsert_identity_provider(...)` | Org Admin | Create/update OIDC IdP |
| `delete_identity_provider(p_provider_id)` | Org Admin | Remove IdP |
| `sso_get_provider_config(p_org_id)` | Service Role | Decrypt IdP config for token exchange |
| `create_domain_verification(p_domain)` | Org Admin | Start domain verification |
| `verify_domain(p_token)` | Org Admin | Complete domain verification |
| `set_org_governance(...)` | Org/Platform Admin | Retention + legal hold |
| `archive_org(p_org_id)` | Platform Admin | Archive org |
| `schedule_org_deletion(p_org_id, p_at)` | Platform Admin | Schedule soft deletion |
| `cancel_org_deletion(p_org_id)` | Platform Admin | Cancel scheduled deletion |
| `execute_org_deletion(p_org_id)` | Service Role | Execute 7-step soft deletion |
| `request_org_export(p_org_id, p_scope)` | Org/Platform Admin | Queue export job |
| `claim_next_export_job(p_worker_id, p_limit)` | Service Role | Claim queued exports |
| `complete_export_job(...)` | Service Role | Mark export succeeded |
| `fail_export_job(...)` | Service Role | Mark export failed + backoff |
| `cancel_export_job(p_job_id)` | Authenticated | Cancel queued/failed export |
| `get_export_download_url(p_job_id)` | Authenticated | Get storage path for download |
| `release_stale_export_locks(p_max_age)` | Service Role | Recover stuck export jobs |
| `claim_next_org_deletion(p_worker_id, p_limit)` | Service Role | Claim scheduled deletions |
| `release_stale_deletion_locks(p_stale_minutes)` | Service Role | Recover stuck deletion jobs |
| `grant_temporary_org_membership(...)` | Platform Admin | Time-limited access grant |
| `revoke_temporary_org_membership(...)` | Platform Admin | Revoke temp access |
| `resolve_entity_org(p_entity_type, p_entity_id)` | Authenticated | Find entity's org for deep-link |
| `accept_org_invite(...)` | Authenticated | Accept org membership invite |
| `apply_audit_log_retention()` | Platform Admin | Purge old audit entries |
| `is_platform_admin()` | Authenticated | Check platform admin status |
| `is_org_archived(p_org_id)` | Internal | Check archived flag |

## Appendix C: Assumptions Made

1. **Self-deactivation guard**: Assumed client-side or RPC check prevents user from suspending themselves. Verify in OrgPeopleTab logic.
2. **OrgSwitchBanner for non-members**: Assumed banner shows "no access" variant if user isn't a member of the target org. Verify `useEntityOrgResolver` behavior.
3. **Multiple orgs claiming same domain**: Assumed first match wins in `route_org_for_email`. Verify RPC logic.
4. **Retry button on failed exports**: Assumed clicking Retry fires a new `request_org_export` rather than re-queuing the existing job. Verify in `OrgGovernanceSection`.
5. **Invite expiry handling**: Assumed expired invites are treated as "no invite" by routing logic. Verify `route_org_for_email` behavior.
6. **Temp membership expiry enforcement**: Assumed RLS checks `expires_at` to deny access after expiry. Verify in membership RLS policies.
7. **Unarchive capability**: No `unarchive_org` RPC exists. Restoration requires direct DB update (known limitation).
8. **Cancel confirmation**: Assumed cancel export shows confirmation dialog. Verify in UI.
9. **SSO-only requires verified domain**: Assumed `upsert_identity_provider` checks `organization_domains` for verified domain when `sso_only=true`. Verify in RPC.
10. **Policy selector in settings**: Assumed onboarding policy (`open`/`approval_required`/`invite_only`) is editable in org settings. Verify in OrganizationPage Settings tab.

---

*End of Test Plan*
