# Phase 15 Assessment — SSO Production Hardening + Archived Org UX/Errors

**Date**: 2026-02-23
**Branch**: `project-adjustment`
**Status**: Complete — all validation gates pass

---

## 1. Executive Summary

Phase 15 hardens the SSO login flow introduced in Phase 14 and adds consistent archived-org UX across the frontend. Three sub-phases:

| Sub-phase | Scope | Status |
|-----------|-------|--------|
| **15A** | SSO operational hardening (login gating, OIDC security, audit logging) | Done |
| **15B** | Account linking + membership safety | Done |
| **15C** | Archived org UX + consistent error mapping | Done |

---

## 2. Phase 15A — SSO Operational Hardening

### 2.1 Login Gating Completeness

**Problem**: If a user never blurs the email field (autofill, paste, direct Enter), the SSO check may not fire before form submission.

**Fix** (`LoginForm.tsx`): Added inline SSO check in `onSubmit`:

```typescript
// Ensure SSO check has run (handles autofill/paste where blur never fires)
let effectiveSsoState = ssoState
if (ssoState === 'idle' || ssoState === 'checking') {
  const result = await checkSsoForEmail(data.email)
  setSsoResult(result)
  if (result.has_sso && result.sso_only) {
    effectiveSsoState = 'sso_required'
    setSsoState('sso_required')
  } else if (result.has_sso) {
    effectiveSsoState = 'sso_optional'
    setSsoState('sso_optional')
  } else {
    effectiveSsoState = 'no_sso'
    setSsoState('no_sso')
  }
}
if (effectiveSsoState === 'sso_required') {
  setError('This organization requires SSO sign-in...')
  return
}
```

### 2.2 OIDC Security — JWKS + Nonce + Claim Validation

**Edge Function `sso-token-exchange` v2** — complete rewrite with:

| Security measure | Implementation |
|-----------------|----------------|
| **JWKS verification** | `jose.createRemoteJWKSet(jwksUri)` + `jose.jwtVerify(idToken, JWKS, { issuer, audience })` |
| **Nonce (anti-replay)** | Generated client-side → stored in sessionStorage → sent in auth URL → validated in Edge Function against id_token `nonce` claim |
| **Issuer validation** | `iss` claim validated against OIDC discovery `issuer` field (via jose) |
| **Audience validation** | `aud` claim validated against `client_id` (via jose) |
| **Expiration** | `exp` claim validated automatically by jose |
| **email_verified** | Explicit check — rejects unverified email addresses (HTTP 403) |

**Nonce flow**:
1. `LoginForm` generates `crypto.randomUUID()` nonce, stores in `sessionStorage.sso_nonce`
2. Nonce included in OIDC authorization URL as `nonce` parameter
3. IdP includes nonce in id_token's `nonce` claim
4. `SsoCallbackPage` reads nonce from sessionStorage, sends to Edge Function
5. Edge Function validates `payload.nonce === nonce`

**JWKS key rotation**: `jose.createRemoteJWKSet` automatically refetches JWKS when a `kid` is not found, handling transparent key rotation.

### 2.3 Audit Logging

Three SSO audit events written to `organization_audit_log`:

| Action | When | actor_id | Key details |
|--------|------|----------|-------------|
| `sso.login_started` | Edge Function receives authorization code | null | `has_nonce` |
| `sso.login_succeeded` | User authenticated, magic link generated | user UUID | `email`, `provider_type`, `sso_sub`, `is_new_user` |
| `sso.login_failed` | Any failure in the SSO flow | null or user UUID | `reason` (e.g., `jwt_verification_failed`, `nonce_mismatch`, `email_not_verified`, `token_exchange_failed`) |

All audit writes are fire-and-forget (failures logged to console, don't block the flow).

---

## 3. Phase 15B — Account Linking + Membership Safety

### 3.1 Account Linking by Email

**Before**: `supabase.auth.admin.listUsers()` scanned all users (O(N)).

**After**: Efficient single-row lookup via `public.users` table:

```typescript
const { data: existingUser } = await supabase
  .from('users')
  .select('id')
  .eq('email', email)
  .maybeSingle();
```

If user exists: updates their auth metadata with SSO info (`sso_provider`, `sso_sub`, `sso_org_id`) via `admin.updateUser`.

If user doesn't exist: creates new auth user with `email_confirm: true` and SSO metadata. The `on_auth_user_created` trigger creates the corresponding `public.users` row.

### 3.2 Membership Safety

The Edge Function does **NOT** create org memberships. After sign-in, `routeOrgByEmail` handles org routing, which:
- Checks `onboarding_policy` (open / approval_required / invite_only)
- Creates membership only for `open` policy
- Creates access request for `approval_required`
- Blocks for `invite_only`

This ensures SSO login respects the org's configured onboarding policy.

---

## 4. Phase 15C — Archived Org UX + Consistent Errors

### 4.1 `useOrgWriteEnabled` Hook

New file: `src/hooks/useOrgWriteEnabled.ts`

```typescript
export function useOrgWriteEnabled() {
  const { isOrgArchived } = useOrganization()
  return {
    canWrite: !isOrgArchived,
    reason: isOrgArchived
      ? 'This organization is archived. All data is read-only.'
      : undefined,
  }
}
```

### 4.2 Error Mapper

New file: `src/lib/archived-org-errors.ts`

```typescript
export function isArchivedOrgError(error: unknown): boolean
export function mapMutationError(error: unknown): string
```

Detects the `enforce_org_not_archived` trigger error message pattern (`/organization is archived/i`) and maps it to a user-friendly string.

### 4.3 Applied to Components

| Component | Changes |
|-----------|---------|
| `OrgDomainsSection.tsx` | Add Domain button disabled, delete buttons disabled, error handler uses `mapMutationError` |
| `OrgIdentityProviderSection.tsx` | Save/Disconnect buttons disabled, error handlers use `mapMutationError` |
| `OrganizationPage.tsx` | Onboarding policy radios disabled, policy mutation error handler uses `mapMutationError` |

Pattern for future callsites:
```typescript
const { canWrite, reason: archivedReason } = useOrgWriteEnabled()
// On buttons: disabled={!canWrite} title={!canWrite ? archivedReason : undefined}
// On error handlers: toast.error(mapMutationError(err))
```

---

## 5. Edge Function — Full Source (v2)

**Slug**: `sso-token-exchange`
**verify_jwt**: false (pre-auth flow)
**Dependencies**: `jsr:@supabase/supabase-js@2`, `npm:jose@5`

Key flow:
1. Receive `{ code, code_verifier, redirect_uri, org_id, nonce }`
2. Audit: `sso.login_started`
3. Get provider config via `sso_get_provider_config` RPC
4. Fetch OIDC discovery document
5. Exchange authorization code for tokens at `token_endpoint`
6. **Verify id_token** via JWKS (`jose.jwtVerify` with issuer + audience)
7. **Validate nonce** against client-provided value
8. **Reject unverified emails** (`email_verified === false`)
9. Find existing user by email in `public.users` (O(1)) or create new auth user
10. Generate magic link via `admin.generateLink`
11. Audit: `sso.login_succeeded`
12. Return `{ method: 'redirect'|'verify_otp', action_link|token_hash }`

On any failure: Audit `sso.login_failed` with reason.

---

## 6. Files Changed

| File | Change |
|------|--------|
| `src/components/auth/LoginForm.tsx` | Nonce generation, submit-time SSO gating |
| `src/pages/auth/SsoCallbackPage.tsx` | Nonce passthrough to Edge Function |
| `src/hooks/useOrgWriteEnabled.ts` | **NEW** — archived org write guard hook |
| `src/lib/archived-org-errors.ts` | **NEW** — error mapper for trigger errors |
| `src/components/organization/OrgDomainsSection.tsx` | useOrgWriteEnabled + mapMutationError |
| `src/components/organization/OrgIdentityProviderSection.tsx` | useOrgWriteEnabled + mapMutationError |
| `src/pages/OrganizationPage.tsx` | useOrgWriteEnabled + mapMutationError |
| `src/lib/__tests__/org-domain-routing.test.ts` | 6 new tests (submit gating + error mapper) |
| Edge Function `sso-token-exchange` | v2: JWKS, nonce, audit, account linking |

---

## 7. Tests

### 7.1 SQL Tests (Inline, Self-Cleaning)

| # | Assertion | Result |
|---|-----------|--------|
| 1 | `organization_audit_log` accepts `sso.login_started` | PASS |
| 2 | `organization_audit_log` accepts `sso.login_succeeded` with actor_id | PASS |
| 3 | `organization_audit_log` accepts `sso.login_failed` with null actor | PASS |
| 4 | `is_org_archived()` returns false for active org | PASS |
| 5 | `enforce_org_not_archived` trigger blocks writes on archived org | PASS |

### 7.2 Frontend Tests

**File**: `src/lib/__tests__/org-domain-routing.test.ts` — **32/32 pass** (was 26)

New tests:
| # | Test | Suite |
|---|------|-------|
| 1 | Submit-time check returns sso_only=true → blocks password login | login submit gating |
| 2 | Submit-time check returns no SSO → allows password login | login submit gating |
| 3 | Submit-time check returns sso_only=false → allows password login | login submit gating |
| 4 | Detects archived org trigger error → maps to user-friendly message | archived-org error mapper |
| 5 | Passes through non-archived errors unchanged | archived-org error mapper |
| 6 | Handles null/undefined errors gracefully | archived-org error mapper |

---

## 8. Validation Summary

| Check | Result |
|-------|--------|
| TypeScript (`tsc --noEmit`) | Clean |
| Build (`vite build`) | Clean, 35.8s |
| Tenant lint | 38 total / 17 P0, delta +0 (at baseline) |
| Frontend tests | 32/32 pass |
| SQL tests | 5/5 pass |
| Edge Function deploy | v2 ACTIVE |

---

## 9. Open Risks / Future Work

| Risk | Severity | Mitigation |
|------|----------|------------|
| JWKS cache cold-starts on each Deno isolate | Low | jose `createRemoteJWKSet` has internal caching within isolate lifetime; JWKS fetched once per cold start |
| No refresh token rotation | Medium | Current flow uses magic-link sign-in; refresh token comes from Supabase Auth, not from IdP. Long-lived sessions should be reviewed. |
| `useOrgWriteEnabled` not yet applied to all mutation callsites | Low | Pattern is established in 3 key components; remaining callsites are protected by DB trigger |
| SSO audit log entries written via service_role (no RLS) | Low | Audit log is append-only; service_role is the correct access level for pre-auth operations |
| `public.users.email` lookup assumes email column matches auth.users email | Low | The `on_auth_user_created` trigger syncs email from auth.users; users cannot change email independently |
