# Phase 14 Assessment Packet

**Date**: 2026-02-23
**Scope**: SSO Login Gating + OIDC Sign-In + Archived Org Read-Only
**Branch**: `project-adjustment`

---

## 1. Executive Snapshot

| Goal | Status | Key Artifact |
|------|--------|-------------|
| A) SSO discovery + SSO-only gating in Login UI | Done | `LoginForm.tsx` wires `checkSsoForEmail` on email blur, shows 3 states |
| B) Real OIDC sign-in (minimum viable) | Done | Edge Function `sso-token-exchange`, PKCE flow, `/auth/sso/callback` page |
| C) Archived orgs read-only | Done | `enforce_org_not_archived()` trigger on 25 tables, frontend banner |

### Validation Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Clean |
| `npx vite build` | Clean (37s) |
| Tenant lint | 38 total / 17 P0, delta +0 |
| Frontend tests | 26/26 pass (org-domain-routing), 642/644 total (2 pre-existing failures in dashboardStacks) |
| SQL tests | 12/12 pass |
| RLS enabled | All Phase 14 tables confirmed |

---

## 2. Database Schema Changes

### 2A. `organization_identity_providers` — New Column

```sql
ALTER TABLE organization_identity_providers
  ADD COLUMN IF NOT EXISTS client_secret_encrypted text;
```

- Stores PGP-encrypted client secret for confidential OIDC clients
- NULL for public (PKCE-only) clients
- Encrypted via `extensions.pgp_sym_encrypt(secret, jwt_secret)`

### 2B. Triggers — `enforce_org_not_archived`

Applied to 25 tenant-scoped tables:

| Table | Insert | Update | Delete |
|-------|--------|--------|--------|
| calendar_events | Y | Y | Y |
| captures | Y | Y | Y |
| case_templates | Y | Y | Y |
| conversations | Y | Y | Y |
| coverage_settings | Y | Y | Y |
| custom_notebooks | Y | Y | Y |
| org_chart_node_links | Y | Y | Y |
| org_chart_node_members | Y | Y | Y |
| org_chart_nodes | Y | Y | Y |
| organization_domains | Y | Y | Y |
| organization_identity_providers | Y | Y | Y |
| organization_invites | Y | Y | Y |
| organization_memberships | Y | Y | Y |
| portfolio_memberships | Y | Y | Y |
| portfolios | Y | Y | Y |
| project_assignments | Y | Y | Y |
| project_deliverables | Y | Y | Y |
| projects | Y | Y | Y |
| target_date_funds | Y | Y | Y |
| team_memberships | Y | Y | Y |
| teams | Y | Y | Y |
| themes | Y | Y | Y |
| topics | Y | Y | Y |
| workflow_templates | Y | Y | Y |
| workflows | Y | Y | Y |

---

## 3. RPC Signatures (Verbatim from DB)

### 3A. `enforce_org_not_archived()` — Trigger Function

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

### 3B. `sso_get_provider_config(uuid)` — Service-Role Only

```sql
CREATE OR REPLACE FUNCTION public.sso_get_provider_config(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_provider RECORD;
  v_secret text;
BEGIN
  SELECT * INTO v_provider
  FROM organization_identity_providers
  WHERE organization_id = p_org_id AND enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no_provider');
  END IF;

  -- Decrypt client secret if present
  IF v_provider.client_secret_encrypted IS NOT NULL THEN
    BEGIN
      v_secret := extensions.pgp_sym_decrypt(
        v_provider.client_secret_encrypted::bytea,
        current_setting('app.settings.jwt_secret', true)
      );
    EXCEPTION WHEN OTHERS THEN
      v_secret := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', v_provider.organization_id,
    'provider_type', v_provider.provider_type,
    'discovery_url', v_provider.discovery_url,
    'client_id', v_provider.client_id,
    'client_secret', v_secret,
    'sso_only', v_provider.sso_only
  );
END;
$function$
```

**Grants**: `REVOKE ALL FROM public, authenticated, anon; GRANT EXECUTE TO service_role;`

### 3C. `upsert_identity_provider` — Updated with `p_client_secret`

```sql
CREATE OR REPLACE FUNCTION public.upsert_identity_provider(
  p_organization_id uuid,
  p_discovery_url text,
  p_client_id text,
  p_sso_only boolean DEFAULT false,
  p_enabled boolean DEFAULT true,
  p_client_secret text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_admin boolean;
  v_has_verified_domain boolean;
  v_provider_id uuid;
  v_is_update boolean := false;
BEGIN
  -- Admin check
  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = p_organization_id
      AND user_id = v_caller_uid
      AND is_org_admin = true AND status = 'active'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized — must be org admin';
  END IF;

  -- SSO-only requires verified domain
  IF p_sso_only AND p_enabled THEN
    SELECT EXISTS (
      SELECT 1 FROM organization_domains
      WHERE organization_id = p_organization_id AND status = 'verified'
    ) INTO v_has_verified_domain;
    IF NOT v_has_verified_domain THEN
      RAISE EXCEPTION 'Cannot enable SSO-only without at least one verified domain';
    END IF;
  END IF;

  SELECT id INTO v_provider_id
  FROM organization_identity_providers
  WHERE organization_id = p_organization_id;

  IF v_provider_id IS NOT NULL THEN
    v_is_update := true;
    UPDATE organization_identity_providers
    SET discovery_url = p_discovery_url,
        client_id = p_client_id,
        sso_only = p_sso_only,
        enabled = p_enabled,
        client_secret_encrypted = CASE
          WHEN p_client_secret IS NOT NULL
            THEN extensions.pgp_sym_encrypt(p_client_secret,
              current_setting('app.settings.jwt_secret', true))
          ELSE client_secret_encrypted
        END,
        updated_at = now()
    WHERE id = v_provider_id;
  ELSE
    INSERT INTO organization_identity_providers (
      organization_id, discovery_url, client_id, sso_only, enabled, created_by,
      client_secret_encrypted
    ) VALUES (
      p_organization_id, p_discovery_url, p_client_id, p_sso_only, p_enabled, v_caller_uid,
      CASE WHEN p_client_secret IS NOT NULL
        THEN extensions.pgp_sym_encrypt(p_client_secret,
          current_setting('app.settings.jwt_secret', true))
        ELSE NULL
      END
    ) RETURNING id INTO v_provider_id;
  END IF;

  -- Audit log
  INSERT INTO organization_audit_log (organization_id, actor_id, action,
    target_type, target_id, details)
  VALUES (p_organization_id, v_caller_uid,
    CASE WHEN v_is_update THEN 'sso.config_updated' ELSE 'sso.config_created' END,
    'identity_provider', v_provider_id,
    jsonb_build_object('discovery_url', p_discovery_url,
      'sso_only', p_sso_only, 'enabled', p_enabled));

  RETURN jsonb_build_object('provider_id', v_provider_id, 'updated', v_is_update);
END;
$function$
```

### 3D. `is_org_archived(uuid)` — Helper (from Phase 13B)

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

---

## 4. Frontend: SSO Login Flow (Phase 14A)

### 4A. `LoginForm.tsx` — SSO Discovery on Email Blur

**State machine**: `idle` → `checking` → `no_sso` | `sso_optional` | `sso_required`

```tsx
// Key logic: on email blur, check SSO
const handleSsoCheck = useCallback(async (email: string) => {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  if (domain === lastCheckedDomain.current) return
  lastCheckedDomain.current = domain
  setSsoState('checking')

  const result = await checkSsoForEmail(email)
  setSsoResult(result)

  if (!result.has_sso) setSsoState('no_sso')
  else if (result.sso_only) setSsoState('sso_required')
  else setSsoState('sso_optional')
}, [])
```

**Three UI states**:

| State | Password Field | SSO Button | Banner |
|-------|---------------|------------|--------|
| `no_sso` / `idle` | Visible | Hidden | None |
| `sso_optional` | Visible | Visible (outline) | None |
| `sso_required` | Hidden | Visible (primary) | "{org} requires SSO" |

**SSO button action**: Fetches OIDC discovery document, builds authorization URL with PKCE (`code_challenge_method=S256`), stores `state` + `code_verifier` in `sessionStorage`, redirects to IdP.

### 4B. `SsoCallbackPage.tsx` — OIDC Callback Handler

Route: `/auth/sso/callback`

1. Validates `state` parameter against `sessionStorage`
2. Sends `code` + `code_verifier` + `org_id` to `sso-token-exchange` Edge Function
3. Handles 3 response methods from Edge Function:
   - `method: 'redirect'` → follows `action_link` (magic link URL)
   - `method: 'verify_otp'` → calls `supabase.auth.verifyOtp()` with token hash
   - Direct `access_token` → calls `supabase.auth.setSession()`
4. On error: shows error screen with "Back to Login" button

### 4C. Route Registration (`App.tsx`)

```tsx
<Route path="/auth/sso/callback" element={<SsoCallbackPage />} />
```

---

## 5. Edge Function: `sso-token-exchange`

**Deployed**: `verify_jwt: false` (pre-auth, no Supabase JWT available)

**Flow**:
1. Receives `{ code, code_verifier, redirect_uri, org_id }`
2. Calls `sso_get_provider_config(org_id)` via service_role client (decrypts client_secret)
3. Fetches OIDC discovery document → extracts `token_endpoint`
4. Exchanges authorization code for tokens (sends `client_id`, optional `client_secret`, optional `code_verifier`)
5. Decodes `id_token` to extract `email`, `sub`, `name`
6. Uses Supabase Admin API to find or create user
7. Generates magic link via `admin.generateLink()` → returns action URL or token hash

**Security notes**:
- `sso_get_provider_config` is only callable by `service_role` (not authenticated/anon)
- Client secret never exposed to frontend
- PKCE prevents authorization code interception
- State parameter prevents CSRF
- Edge Function has no JWT verification (intentional — called before auth)

---

## 6. Archived Org Read-Only (Phase 14C)

### 6A. Trigger-Based Approach

Rather than modifying 200+ individual RLS policies, a single trigger function `enforce_org_not_archived()` is applied to 25 key tenant-scoped tables. The trigger fires `BEFORE INSERT OR UPDATE OR DELETE` and raises an exception if `is_org_archived(organization_id)` returns true.

**Advantages over RLS approach**:
- Single function, applied to N tables via a loop
- Works for all operations (INSERT/UPDATE/DELETE) uniformly
- Cannot be bypassed by SECURITY DEFINER RPCs that bypass RLS
- Easy to extend: just add new table names to the array

**Tables covered**: calendar_events, captures, case_templates, conversations, coverage_settings, custom_notebooks, org_chart_node_links, org_chart_node_members, org_chart_nodes, organization_domains, organization_identity_providers, organization_invites, organization_memberships, portfolio_memberships, portfolios, project_assignments, project_deliverables, projects, target_date_funds, team_memberships, teams, themes, topics, workflow_templates, workflows

### 6B. Frontend Banner

`Layout.tsx` reads `isOrgArchived` from `OrganizationContext` (which queries `organization_governance.archived_at`). When true, renders a sticky amber banner:

> "This organization is archived. All data is read-only. Contact a platform administrator to restore."

The `org-archived-status` query key is included in `ORG_SCOPED_QUERY_PREFIXES` for proper cache invalidation on org switch.

### 6C. IdP Settings — Client Secret Field

`OrgIdentityProviderSection.tsx` now includes:
- Password input for client secret (optional)
- Placeholder shows "leave blank to keep existing" on update
- Helper text: "Required for confidential clients. Not needed for PKCE-only (public) clients."
- Secret is cleared from UI state after successful save

---

## 7. SQL Tests (12 Assertions)

| # | Assertion | Result |
|---|-----------|--------|
| 1 | `client_secret_encrypted` column exists on `organization_identity_providers` | PASS |
| 2 | `sso_get_provider_config` function exists | PASS |
| 3 | `enforce_org_not_archived` function exists | PASS |
| 4 | Trigger exists on `teams` table | PASS |
| 5 | Trigger exists on `projects` table | PASS |
| 6 | INSERT into teams succeeds when org is NOT archived | PASS |
| 7 | Organization can be archived (governance update) | PASS |
| 8 | INSERT into teams BLOCKED when org IS archived | PASS |
| 9 | UPDATE on teams BLOCKED when org IS archived | PASS |
| 10 | DELETE on teams BLOCKED when org IS archived | PASS |
| 11 | At least 25 tables have the archived-org trigger | PASS (25) |
| 12 | Unarchiving restores write access | PASS |

---

## 8. Frontend Tests (26 assertions in org-domain-routing.test.ts)

| Suite | Count | Notes |
|-------|-------|-------|
| extractDomain | 8 | Pure function, unchanged |
| routeOrgByEmail | 9 | Existing tests, unchanged |
| checkSsoForEmail (existing) | 4 | Existing tests, unchanged |
| checkSsoForEmail — login UI states (NEW) | 3 | sso_only=true, sso_only=false, no match |
| org-switch cache invalidation | 2 | org-domains + org-archived-status keys |

---

## 9. Files Changed / Created

| File | Action | Purpose |
|------|--------|---------|
| `src/components/auth/LoginForm.tsx` | Modified | SSO discovery on email blur, 3-state UI |
| `src/pages/auth/SsoCallbackPage.tsx` | Created | OIDC callback handler |
| `src/App.tsx` | Modified | Added `/auth/sso/callback` route |
| `src/components/organization/OrgIdentityProviderSection.tsx` | Modified | Client secret field |
| `src/contexts/OrganizationContext.tsx` | Modified | `isOrgArchived` flag + query |
| `src/components/layout/Layout.tsx` | Modified | Archived org banner |
| `src/lib/__tests__/org-domain-routing.test.ts` | Modified | 5 new test assertions |
| Edge Function: `sso-token-exchange` | Deployed | OIDC code exchange |

**Migrations applied**:
1. `phase14_sso_oidc_flow` — column, functions, triggers
2. `phase14_fix_upsert_idp_overload` — fix overload, update original function
3. `phase14_fix_archived_trigger_errcode` — use P0001 instead of P0004

---

## 10. Open Risks / Known Limitations

| Risk | Severity | Notes |
|------|----------|-------|
| OIDC id_token not cryptographically verified in Edge Function | Medium | JWT payload is decoded but signature not validated against JWKS. Acceptable for MVP since token comes directly from token endpoint over TLS. Production should validate via JWKS. |
| `listUsers()` in Edge Function is O(N) for user lookup | Low | Should use `getUserByEmail()` or DB query for production. Current approach works for small user counts. |
| Edge Function `verify_jwt: false` | Medium | Intentional (pre-auth flow), but means any caller can invoke it. Rate limiting via Supabase Edge runtime is the defense. |
| User-scoped tables (assets, notes, etc.) not covered by archived trigger | Low | Only org-scoped tables with `organization_id` column are covered. User-owned entities (assets, notes) that don't have direct org_id column are not blocked. These are read-only by convention in the UI. |
| PKCE code_verifier stored in sessionStorage | Low | Standard practice for SPAs. Cleared after use. |
| Magic link fallback for session creation | Low | Edge Function uses `admin.generateLink()` to create auth sessions, which generates a one-time URL. This is a workaround for missing `admin.createSession()` API. |
