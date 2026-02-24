# Phase 13A/13B Assessment Packet

Generated from live database introspection + source file reads, 2026-02-23.

---

## 1) EXECUTIVE SNAPSHOT

- **13A**: Per-org OIDC identity provider table (`organization_identity_providers`) with admin-only CRUD RPCs and pre-auth SSO discovery RPC.
- **13A**: `OrgIdentityProviderSection.tsx` settings card in Org Settings tab — discovery URL, client ID, enable/disable, SSO-only toggle with verified-domain gate.
- **13A**: `checkSsoForEmail()` utility in `org-domain-routing.ts` wraps `get_identity_provider_for_email` RPC (callable by anon). Returns SSO config + onboarding policy.
- **13A**: `checkSsoForEmail` is **NOT YET wired into the login page UI** — the function exists but LoginPage/LoginForm do not call it. SSO-only enforcement at the login form level is not yet implemented.
- **13B**: `organization_governance` table (retention, legal hold, archive, scheduled deletion) with platform-admin-gated RPCs.
- **13B**: `org_export_jobs` table for async data export requests with status workflow (pending → running → completed/failed/cancelled).
- **13B**: `OrgGovernanceSection.tsx` in Org Settings — retention days (org admin editable), legal hold (read-only), archive/deletion status, export button.
- **13B**: `AdminConsolePage.tsx` governance card — legal hold toggle, archive, schedule/cancel deletion, export — all platform-admin-only.
- **Tests**: 13 SQL assertions (SSO) + 16 SQL assertions (governance) + 22 frontend unit tests for routing/SSO. All passing.
- **Build**: `tsc --noEmit` clean, `vite build` clean, tenant lint at baseline (38 total, 17 P0, delta +0).

---

## 2) DB SCHEMA — PHASE 13A SSO

### Table: `organization_identity_providers`

```
Column             | Type                     | Default            | Nullable
-------------------|--------------------------|--------------------|--------
id                 | uuid                     | gen_random_uuid()  | NO
organization_id    | uuid                     | (none)             | NO
provider_type      | text                     | 'oidc'             | NO
issuer             | text                     | (none)             | YES
discovery_url      | text                     | (none)             | NO
client_id          | text                     | (none)             | NO
enabled            | boolean                  | true               | NO
sso_only           | boolean                  | false              | NO
created_by         | uuid                     | (none)             | YES
created_at         | timestamp with time zone | now()              | NO
updated_at         | timestamp with time zone | now()              | NO
```

**Constraints:**
```sql
PRIMARY KEY (id)
FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
FOREIGN KEY (created_by) REFERENCES auth.users(id)
CHECK (provider_type = 'oidc')
```

**Indexes:**
```sql
CREATE UNIQUE INDEX organization_identity_providers_pkey ON ... USING btree (id);
CREATE UNIQUE INDEX idx_org_idp_org_unique ON ... USING btree (organization_id);  -- one IdP per org
CREATE INDEX idx_org_idp_enabled ON ... USING btree (organization_id) WHERE (enabled = true);
```

**RLS:** Enabled (`relrowsecurity = true`).

### RLS Policies on `organization_identity_providers`

```sql
-- SELECT: active org admin of current org only
CREATE POLICY org_idp_select ON organization_identity_providers FOR SELECT
  USING (
    organization_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM organization_memberships
      WHERE organization_memberships.organization_id = organization_identity_providers.organization_id
        AND organization_memberships.user_id = auth.uid()
        AND organization_memberships.is_org_admin = true
        AND organization_memberships.status = 'active'
    )
  );

-- INSERT, UPDATE, DELETE: all blocked (mutations go through SECURITY DEFINER RPCs)
CREATE POLICY org_idp_insert ON organization_identity_providers FOR INSERT WITH CHECK (false);
CREATE POLICY org_idp_update ON organization_identity_providers FOR UPDATE USING (false);
CREATE POLICY org_idp_delete ON organization_identity_providers FOR DELETE USING (false);
```

### RPC: `upsert_identity_provider`

```sql
CREATE OR REPLACE FUNCTION public.upsert_identity_provider(
  p_organization_id uuid,
  p_discovery_url text,
  p_client_id text,
  p_sso_only boolean DEFAULT false,
  p_enabled boolean DEFAULT true
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_admin boolean;
  v_has_verified_domain boolean;
  v_provider_id uuid;
  v_is_update boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = p_organization_id
      AND user_id = v_caller_uid
      AND is_org_admin = true
      AND status = 'active'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized — must be org admin';
  END IF;

  IF p_sso_only AND p_enabled THEN
    SELECT EXISTS (
      SELECT 1 FROM organization_domains
      WHERE organization_id = p_organization_id
        AND status = 'verified'
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
        updated_at = now()
    WHERE id = v_provider_id;
  ELSE
    INSERT INTO organization_identity_providers (
      organization_id, discovery_url, client_id, sso_only, enabled, created_by
    ) VALUES (
      p_organization_id, p_discovery_url, p_client_id, p_sso_only, p_enabled, v_caller_uid
    ) RETURNING id INTO v_provider_id;
  END IF;

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (
    p_organization_id, v_caller_uid,
    CASE WHEN v_is_update THEN 'sso.config_updated' ELSE 'sso.config_created' END,
    'identity_provider', v_provider_id,
    jsonb_build_object('discovery_url', p_discovery_url, 'sso_only', p_sso_only, 'enabled', p_enabled)
  );

  RETURN jsonb_build_object('provider_id', v_provider_id, 'updated', v_is_update);
END;
$function$;
```

### RPC: `delete_identity_provider`

```sql
CREATE OR REPLACE FUNCTION public.delete_identity_provider(p_provider_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_org_id uuid;
  v_is_admin boolean;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM organization_identity_providers WHERE id = p_provider_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Identity provider not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = v_org_id AND user_id = v_caller_uid
      AND is_org_admin = true AND status = 'active'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized — must be org admin';
  END IF;

  DELETE FROM organization_identity_providers WHERE id = p_provider_id;

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org_id, v_caller_uid, 'sso.config_deleted', 'identity_provider', p_provider_id,
    jsonb_build_object('deleted', true));
END;
$function$;
```

### RPC: `get_identity_provider_for_email`

```sql
CREATE OR REPLACE FUNCTION public.get_identity_provider_for_email(p_email text)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_domain text;
  v_org_id uuid;
  v_org_name text;
  v_policy text;
  v_provider RECORD;
BEGIN
  v_domain := lower(split_part(p_email, '@', 2));
  IF v_domain = '' OR v_domain IS NULL THEN
    RETURN jsonb_build_object('has_sso', false, 'reason', 'invalid_email');
  END IF;

  SELECT od.organization_id INTO v_org_id
  FROM organization_domains od
  WHERE od.domain = v_domain AND od.status = 'verified'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('has_sso', false, 'reason', 'no_domain_match');
  END IF;

  SELECT name, onboarding_policy INTO v_org_name, v_policy
  FROM organizations WHERE id = v_org_id;

  SELECT * INTO v_provider
  FROM organization_identity_providers
  WHERE organization_id = v_org_id AND enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_sso', false,
      'org_id', v_org_id,
      'org_name', v_org_name,
      'onboarding_policy', v_policy,
      'reason', 'no_provider'
    );
  END IF;

  RETURN jsonb_build_object(
    'has_sso', true,
    'org_id', v_org_id,
    'org_name', v_org_name,
    'sso_only', v_provider.sso_only,
    'discovery_url', v_provider.discovery_url,
    'client_id', v_provider.client_id,
    'provider_type', v_provider.provider_type,
    'onboarding_policy', v_policy
  );
END;
$function$;
```

**GRANTs:** All three RPCs have `EXECUTE` granted to `PUBLIC`, `anon`, `authenticated`, `service_role`. `upsert` and `delete` enforce admin checks internally. `get_identity_provider_for_email` is intentionally callable by `anon` (pre-auth SSO discovery).

### Helper functions used (NOT modified in Phase 13, pre-existing)

- `current_org_id()` — returns UUID from `request.jwt.claims->>'current_organization_id'`
- `auth.uid()` — Supabase built-in, returns UUID from JWT `sub` claim
- `is_platform_admin()` — checks `platform_admins` table for `auth.uid()`

---

## 3) DB SCHEMA — PHASE 13B GOVERNANCE

### Table: `organization_governance`

```
Column                     | Type                     | Default  | Nullable
---------------------------|--------------------------|----------|--------
organization_id            | uuid                     | (none)   | NO
retention_days_audit_log   | integer                  | 365      | NO
legal_hold                 | boolean                  | false    | NO
deletion_scheduled_at      | timestamp with time zone | (none)   | YES
archived_at                | timestamp with time zone | (none)   | YES
archived_by                | uuid                     | (none)   | YES
created_at                 | timestamp with time zone | now()    | NO
updated_at                 | timestamp with time zone | now()    | NO
```

**Constraints:**
```sql
PRIMARY KEY (organization_id)
FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
FOREIGN KEY (archived_by) REFERENCES auth.users(id)
CHECK ((retention_days_audit_log >= 30) AND (retention_days_audit_log <= 3650))
```

**Indexes:**
```sql
CREATE UNIQUE INDEX organization_governance_pkey ON ... USING btree (organization_id);
```

**RLS:** Enabled.

### RLS Policies on `organization_governance`

```sql
-- SELECT for org admins within their current org
CREATE POLICY gov_select ON organization_governance FOR SELECT
  USING (
    organization_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM organization_memberships
      WHERE organization_memberships.organization_id = organization_governance.organization_id
        AND organization_memberships.user_id = auth.uid()
        AND organization_memberships.is_org_admin = true
        AND organization_memberships.status = 'active'
    )
  );

-- SELECT bypass for platform admins (any org)
CREATE POLICY gov_select_platform ON organization_governance FOR SELECT
  USING (is_platform_admin());

-- INSERT, UPDATE, DELETE: blocked (mutations via SECURITY DEFINER RPCs)
CREATE POLICY gov_insert ON organization_governance FOR INSERT WITH CHECK (false);
CREATE POLICY gov_update ON organization_governance FOR UPDATE USING (false);
CREATE POLICY gov_delete ON organization_governance FOR DELETE USING (false);
```

### Table: `org_export_jobs`

```
Column           | Type                     | Default            | Nullable
-----------------|--------------------------|--------------------|--------
id               | uuid                     | gen_random_uuid()  | NO
organization_id  | uuid                     | (none)             | NO
requested_by     | uuid                     | (none)             | NO
status           | text                     | 'pending'          | NO
scope            | text                     | 'metadata_only'    | NO
file_path        | text                     | (none)             | YES
error            | text                     | (none)             | YES
created_at       | timestamp with time zone | now()              | NO
updated_at       | timestamp with time zone | now()              | NO
completed_at     | timestamp with time zone | (none)             | YES
```

**Constraints:**
```sql
PRIMARY KEY (id)
FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
FOREIGN KEY (requested_by) REFERENCES auth.users(id)
CHECK (status = ANY (ARRAY['pending','running','completed','failed','cancelled']))
CHECK (scope = ANY (ARRAY['metadata_only','full']))
```

**Indexes:**
```sql
CREATE UNIQUE INDEX org_export_jobs_pkey ON ... USING btree (id);
CREATE INDEX idx_export_jobs_org ON ... USING btree (organization_id);
```

**RLS:** Enabled.

### RLS Policies on `org_export_jobs`

```sql
-- SELECT for org admins within current org
CREATE POLICY export_select ON org_export_jobs FOR SELECT
  USING (
    organization_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM organization_memberships
      WHERE organization_memberships.organization_id = org_export_jobs.organization_id
        AND organization_memberships.user_id = auth.uid()
        AND organization_memberships.is_org_admin = true
        AND organization_memberships.status = 'active'
    )
  );

-- SELECT bypass for platform admins
CREATE POLICY export_select_platform ON org_export_jobs FOR SELECT
  USING (is_platform_admin());

-- INSERT, UPDATE: blocked (mutations via SECURITY DEFINER RPCs)
CREATE POLICY export_insert ON org_export_jobs FOR INSERT WITH CHECK (false);
CREATE POLICY export_update ON org_export_jobs FOR UPDATE USING (false);
```

### Helper: `is_org_archived`

```sql
CREATE OR REPLACE FUNCTION public.is_org_archived(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM organization_governance
    WHERE organization_id = p_org_id AND archived_at IS NOT NULL
  );
$function$;
```

### RPC: `set_org_governance`

```sql
CREATE OR REPLACE FUNCTION public.set_org_governance(
  p_org_id uuid,
  p_retention_days integer DEFAULT NULL,
  p_legal_hold boolean DEFAULT NULL
) RETURNS jsonb
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

  -- Legal hold changes require platform admin
  IF p_legal_hold IS NOT NULL AND NOT v_is_platform THEN
    RAISE EXCEPTION 'Legal hold can only be toggled by platform admin';
  END IF;

  -- Upsert governance row
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
```

### RPC: `schedule_org_deletion`

```sql
CREATE OR REPLACE FUNCTION public.schedule_org_deletion(
  p_org_id uuid,
  p_at timestamp with time zone
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_hold boolean;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin required';
  END IF;

  SELECT legal_hold INTO v_hold FROM organization_governance WHERE organization_id = p_org_id;
  IF v_hold IS TRUE THEN
    RAISE EXCEPTION 'Cannot schedule deletion — org is under legal hold';
  END IF;

  INSERT INTO organization_governance (organization_id, deletion_scheduled_at)
  VALUES (p_org_id, p_at)
  ON CONFLICT (organization_id) DO UPDATE
  SET deletion_scheduled_at = p_at, updated_at = now();

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details)
  VALUES (p_org_id, v_caller, 'org.deletion_scheduled', 'organization',
    jsonb_build_object('scheduled_at', p_at));
END;
$function$;
```

### RPC: `cancel_org_deletion`

```sql
CREATE OR REPLACE FUNCTION public.cancel_org_deletion(p_org_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin required';
  END IF;

  UPDATE organization_governance SET deletion_scheduled_at = NULL, updated_at = now()
  WHERE organization_id = p_org_id;

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details)
  VALUES (p_org_id, v_caller, 'org.deletion_cancelled', 'organization', '{}'::jsonb);
END;
$function$;
```

### RPC: `archive_org`

```sql
CREATE OR REPLACE FUNCTION public.archive_org(p_org_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin required';
  END IF;

  INSERT INTO organization_governance (organization_id, archived_at, archived_by)
  VALUES (p_org_id, now(), v_caller)
  ON CONFLICT (organization_id) DO UPDATE
  SET archived_at = now(), archived_by = v_caller, updated_at = now();

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details)
  VALUES (p_org_id, v_caller, 'org.archived', 'organization', '{}'::jsonb);
END;
$function$;
```

### RPC: `request_org_export`

```sql
CREATE OR REPLACE FUNCTION public.request_org_export(
  p_org_id uuid,
  p_scope text DEFAULT 'metadata_only'
) RETURNS uuid
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
```

### RPC: `apply_audit_log_retention`

```sql
CREATE OR REPLACE FUNCTION public.apply_audit_log_retention()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_deleted_total int := 0;
  v_org RECORD;
  v_deleted int;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin required';
  END IF;

  FOR v_org IN
    SELECT g.organization_id, g.retention_days_audit_log
    FROM organization_governance g
    WHERE g.legal_hold = false
      AND g.retention_days_audit_log IS NOT NULL
  LOOP
    DELETE FROM organization_audit_log
    WHERE organization_id = v_org.organization_id
      AND created_at < now() - (v_org.retention_days_audit_log || ' days')::interval;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_deleted_total := v_deleted_total + v_deleted;
  END LOOP;

  IF v_deleted_total > 0 THEN
    INSERT INTO organization_audit_log (
      organization_id, actor_id, action, target_type, details
    )
    SELECT organization_id, v_caller, 'retention.applied', 'organization',
      jsonb_build_object('deleted_count', v_deleted_total)
    FROM organization_governance
    WHERE legal_hold = false
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object('deleted_total', v_deleted_total);
END;
$function$;
```

---

## 4) RPC SIGNATURES + RETURN SHAPES

### Phase 13A

| RPC | Params | Returns | Success Payload | Error Messages |
|-----|--------|---------|-----------------|----------------|
| `upsert_identity_provider` | `p_organization_id uuid, p_discovery_url text, p_client_id text, p_sso_only bool DEFAULT false, p_enabled bool DEFAULT true` | `jsonb` | `{"provider_id": "uuid", "updated": true/false}` | `'Not authorized — must be org admin'`, `'Cannot enable SSO-only without at least one verified domain'` |
| `delete_identity_provider` | `p_provider_id uuid` | `void` | (no return) | `'Identity provider not found'`, `'Not authorized — must be org admin'` |
| `get_identity_provider_for_email` | `p_email text` | `jsonb` | SSO found: `{"has_sso": true, "org_id": "uuid", "org_name": "Acme", "sso_only": true, "discovery_url": "https://...", "client_id": "client-123", "provider_type": "oidc", "onboarding_policy": "open"}` / No SSO: `{"has_sso": false, "org_id": "uuid", "org_name": "Acme", "onboarding_policy": "open", "reason": "no_provider"}` / No domain: `{"has_sso": false, "reason": "no_domain_match"}` | (never throws — returns fallback jsonb) |

### Phase 13B

| RPC | Params | Returns | Success Payload | Error Messages |
|-----|--------|---------|-----------------|----------------|
| `set_org_governance` | `p_org_id uuid, p_retention_days int DEFAULT NULL, p_legal_hold bool DEFAULT NULL` | `jsonb` | `{"retention_days_audit_log": 180, "legal_hold": false, "archived_at": null, "deletion_scheduled_at": null}` | `'Not authorized'`, `'Legal hold can only be toggled by platform admin'` |
| `schedule_org_deletion` | `p_org_id uuid, p_at timestamptz` | `void` | (no return) | `'Platform admin required'`, `'Cannot schedule deletion — org is under legal hold'` |
| `cancel_org_deletion` | `p_org_id uuid` | `void` | (no return) | `'Platform admin required'` |
| `archive_org` | `p_org_id uuid` | `void` | (no return) | `'Platform admin required'` |
| `request_org_export` | `p_org_id uuid, p_scope text DEFAULT 'metadata_only'` | `uuid` | Returns the `job_id` UUID | `'Not authorized'` |
| `apply_audit_log_retention` | (none) | `jsonb` | `{"deleted_total": 42}` | `'Platform admin required'` |
| `is_org_archived` | `p_org_id uuid` | `boolean` | `true` / `false` | (never throws) |

**Note:** All error messages use plain `RAISE EXCEPTION` (no custom ERRCODE). This was a deliberate decision because P-class ERRCODEs (P0004) are not catchable in `DO` blocks via the Supabase SQL execution context.

---

## 5) FRONTEND — SSO ROUTING + LOGIN FLOW

### `checkSsoForEmail()` — `src/lib/org-domain-routing.ts:79-90`

```typescript
export async function checkSsoForEmail(email: string): Promise<SsoCheckResult> {
  const fallback: SsoCheckResult = { has_sso: false, reason: 'error' }
  try {
    const { data, error } = await supabase.rpc('get_identity_provider_for_email', {
      p_email: email,
    })
    if (error || !data) return fallback
    return data as SsoCheckResult
  } catch {
    return fallback
  }
}
```

### `SsoCheckResult` type — `src/types/organization.ts:221-231`

```typescript
export interface SsoCheckResult {
  has_sso: boolean
  org_id?: string
  org_name?: string
  sso_only?: boolean
  discovery_url?: string
  client_id?: string
  provider_type?: string
  onboarding_policy?: OnboardingPolicy
  reason?: string
}
```

### Where `checkSsoForEmail` is called

**NOT FOUND** in the login flow. Searched:
- `src/pages/auth/LoginPage.tsx` — no references to `checkSso`, `sso`, `SSO`, or `identity_provider`
- `src/components/auth/LoginForm.tsx` — no references
- `src/hooks/useAuth.ts` — imports `routeOrgByEmail` but NOT `checkSsoForEmail`

**Conclusion:** `checkSsoForEmail` exists as a utility function + RPC but is not yet wired into the login UI. The login form currently shows password-only for all users regardless of SSO configuration.

### Post-login org routing — `src/hooks/useAuth.ts:96-114`

```typescript
// Route org by email domain if user has no current org set
if (!userData.current_organization_id && !orgRouteAttemptedRef.current) {
  orgRouteAttemptedRef.current = true
  const { profile, routeResult } = await routeOrgByEmail(session.user.email!, session.user.id)
  if (profile) {
    userData = { ...userData, ...profile }
  }
  // Attach route metadata for downstream screens (blocked/pending)
  userData._routeAction = routeResult.action
  userData._routeOrgName = routeResult.org_name
  // Dispatch auto-join event for toast
  if (routeResult.action === 'auto_join' && routeResult.org_name) {
    window.dispatchEvent(new CustomEvent('org-auto-joined', {
      detail: { orgName: routeResult.org_name },
    }))
  }
}
```

### `routeOrgByEmail` — `src/lib/org-domain-routing.ts:31-72`

Decision logic:
- Calls `route_org_for_email` RPC → returns `{org_id, org_name, action, reason}`
- `action = 'switch' | 'auto_join'` → calls `set_current_org` RPC → re-fetches profile → returns `{profile, routeResult}`
- `action = 'request_created' | 'blocked'` → does NOT call `set_current_org` → returns `{profile: null, routeResult}`
- On any error → returns `{profile: null, routeResult: {action: 'blocked', reason: 'error'}}`

### ProtectedRoute interception — `src/components/ProtectedRoute.tsx:47-105`

```typescript
const routeAction = (user as any)?._routeAction as string | undefined
const routeOrgName = (user as any)?._routeOrgName as string | undefined
const hasOrg = !!(user as any)?.current_organization_id

// Blocked screen — invite_only org, user has no org
if (routeAction === 'blocked' && !hasOrg) {
  // Renders: Lock icon, "Access Required", org name, "Contact admin", Sign Out button
}

// Pending screen — approval_required org, request submitted
if (routeAction === 'request_created' && !hasOrg) {
  // Renders: Clock icon, "Request Sent", org name, "Pending admin approval", Sign Out button
}
```

### UI behavior per case

| Case | Behavior |
|------|----------|
| **(a) No SSO configured** | Login form renders normally (password only). `checkSsoForEmail` is not called. |
| **(b) SSO available but optional** | **NOT IMPLEMENTED in login UI.** The RPC returns `{has_sso: true, sso_only: false}` but the login page never checks it. Users always see password form. |
| **(c) SSO required (password disabled)** | **NOT ENFORCED at login form level.** The RPC returns `{has_sso: true, sso_only: true}` but the login page doesn't call it. Password form still renders. Backend-side SSO-only enforcement is config-only (no password-blocking middleware exists). |
| **(d) Multiple orgs match same domain** | `get_identity_provider_for_email` uses `LIMIT 1` on domain match → returns the first match only. No multi-org disambiguation. |

---

## 6) FRONTEND — GOVERNANCE UI SURFACES

### `OrgGovernanceSection.tsx` (Org Settings tab, org admin only)

**Controls:**
| Control | RPC Called | Editable By |
|---------|-----------|-------------|
| Audit log retention days (number input, 30-3650, Save button) | `set_org_governance(p_org_id, p_retention_days)` | Org admin |
| Legal hold status (read-only badge: Active/Inactive) | — (display only) | Read-only for org admin. Platform admin toggles via Admin Console. |
| Archive status (read-only amber banner if archived) | — (display only) | Read-only |
| Deletion scheduled status (read-only red banner if set) | — (display only) | Read-only |
| Request Export button | `request_org_export(p_org_id, 'metadata_only')` | Org admin |

**Query key:** `['org-governance', organizationId]` → reads `organization_governance` via `.select('*').eq('organization_id', ...).maybeSingle()`.

### `AdminConsolePage.tsx` Governance Card (platform admin only)

**Gating:** The entire page is gated by `is_platform_admin()` RPC check. The governance card appears in the org detail view.

**Actions:**
| Action | RPC Called | UI Element |
|--------|-----------|------------|
| Toggle legal hold | `set_org_governance(p_org_id, p_legal_hold: bool)` | Button: "Enable Legal Hold" / "Remove Legal Hold" |
| Archive org | `archive_org(p_org_id)` | Button → confirmation modal |
| Schedule deletion | `schedule_org_deletion(p_org_id, p_at)` | Button → modal with days input → computes timestamp |
| Cancel deletion | `cancel_org_deletion(p_org_id)` | Button (shown only when deletion is scheduled) |
| Request export | `request_org_export(p_org_id, 'metadata_only')` | Button |

**Mutation hooks (verbatim from AdminConsolePage.tsx:244-310):**

```typescript
const toggleLegalHoldMutation = useMutation({
  mutationFn: async ({ orgId, hold }: { orgId: string; hold: boolean }) => {
    const { data, error } = await supabase.rpc('set_org_governance', {
      p_org_id: orgId, p_legal_hold: hold,
    })
    if (error) throw error; return data
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['admin-console-governance', selectedOrgId] })
    toast.success(`Legal hold ${governance?.legal_hold ? 'removed' : 'enabled'}`)
  },
})

const archiveOrgMutation = useMutation({
  mutationFn: async (orgId: string) => {
    const { error } = await supabase.rpc('archive_org', { p_org_id: orgId })
    if (error) throw error
  },
  // ...invalidates ['admin-console-governance', selectedOrgId]
})

const scheduleDeletionMutation = useMutation({
  mutationFn: async ({ orgId, days }: { orgId: string; days: number }) => {
    const at = new Date(Date.now() + days * 86400000).toISOString()
    const { error } = await supabase.rpc('schedule_org_deletion', { p_org_id: orgId, p_at: at })
    if (error) throw error
  },
})

const cancelDeletionMutation = useMutation({
  mutationFn: async (orgId: string) => {
    const { error } = await supabase.rpc('cancel_org_deletion', { p_org_id: orgId })
    if (error) throw error
  },
})

const requestExportMutation = useMutation({
  mutationFn: async (orgId: string) => {
    const { data, error } = await supabase.rpc('request_org_export', {
      p_org_id: orgId, p_scope: 'metadata_only',
    })
    if (error) throw error; return data
  },
})
```

---

## 7) TESTS & VALIDATION ARTIFACTS

### `supabase/tests/org-sso-routing.sql` — 13 assertions

1. `organization_identity_providers` table has expected columns
2. SSO-only requires verified domain (blocked without one)
3. Admin can create IdP (upsert returns provider_id)
4. Admin can update IdP (upsert returns updated=true)
5. Non-admin blocked from upsert
6. Admin can delete IdP
7. Non-admin blocked from delete
8. `get_identity_provider_for_email` returns SSO config for matching domain
9. `get_identity_provider_for_email` returns `sso_only` flag
10. `get_identity_provider_for_email` returns `has_sso=false` for unknown domain
11. `get_identity_provider_for_email` includes `onboarding_policy` in response
12. `get_identity_provider_for_email` returns `has_sso=false` + reason for invite_only org without IdP
13. Audit log entries created for SSO config create/update/delete

**Edge cases covered:** SSO-only + no verified domain blocked; non-admin CRUD blocked; domain lookup miss; onboarding policy passthrough.

### `supabase/tests/org-governance.sql` — 16 assertions

1. `organization_governance` table has 6 expected columns
2. Default `retention_days_audit_log` = 365
3. Org admin can set retention via `set_org_governance`
4. Org admin CANNOT toggle `legal_hold` (platform admin only)
5. Platform admin CAN toggle `legal_hold`
6. Cannot schedule deletion when under legal hold
7. Remove legal hold → schedule deletion succeeds
8. `cancel_org_deletion` clears schedule
9. `archive_org` sets `archived_at` + `archived_by`
10. `is_org_archived` returns true for archived org
11. Regular member blocked from `set_org_governance`
12. Non-platform-admin blocked from `archive_org`
13. `request_org_export` creates job with `status='pending'`, returns UUID
14. `apply_audit_log_retention` skips orgs under legal hold
15. `apply_audit_log_retention` deletes old entries when no legal hold
16. Audit log entries for: `governance.updated`, `legal_hold.toggled`, `org.archived`, `org.deletion_scheduled`, `org.deletion_cancelled`, `export.requested`

**Edge cases covered:** Legal hold blocks deletion; retention range CHECK (30-3650); legal hold blocks audit purge; platform vs org admin separation.

### Frontend unit tests — `src/lib/__tests__/org-domain-routing.test.ts` — 22 tests

**`extractDomain` (8 tests):** Standard email, lowercase, multiple @, no @, no dot, empty, @ at position 0, subdomains.

**`routeOrgByEmail` (9 tests):** RPC error fallback, null result fallback, set_current_org error, action=switch path, action=auto_join path, action=request_created (no set_current_org), action=blocked (no set_current_org), null profile refetch, unexpected exception.

**`checkSsoForEmail` (4 tests):** SSO config returned (has_sso=true, fields verified), no provider (has_sso=false), RPC error fallback, network exception fallback.

**`org-switch cache invalidation` (1 test):** Structural assertion that `'organization-domains'` is in `ORG_SCOPED_QUERY_PREFIXES`.

### Other passing test files

- `src/hooks/useOrgQueryKey.test.ts` — 5 tests
- `src/lib/org-switch-perf.test.ts` — 8 tests

**Total: 35 frontend tests, all passing.**

### Build validation

- `npx tsc --noEmit` — clean (0 errors)
- `npx vite build` — clean (28s)
- `node scripts/frontend-tenant-lint.mjs` — 38 total / 17 P0, delta +0 (at baseline)

---

## 8) OPEN QUESTIONS / RISKS (ranked)

| # | Severity | Issue |
|---|----------|-------|
| 1 | **Critical** | **SSO-only mode is not enforced at the login form.** `checkSsoForEmail` exists but is never called by `LoginPage.tsx` or `LoginForm.tsx`. Users in SSO-only orgs can still log in with password. The RPC + types are ready; the login UI integration is missing. |
| 2 | **High** | **No actual OIDC redirect flow implemented.** The system stores discovery URL + client ID but there is no Supabase Auth provider integration or OIDC redirect handler. The SSO config is "settings-only" — no user can actually authenticate via SSO yet. This requires Supabase Auth custom provider setup or an Edge Function to initiate the OIDC flow. |
| 3 | **High** | **`archive_org` does not enforce read-only on the archived org.** `is_org_archived()` helper exists but no RLS policy or RPC checks it to block writes. An archived org's data can still be modified via normal RPCs. Need to add `is_org_archived` checks to mutation RPCs or RLS policies. |
| 4 | **High** | **No unarchive/restore RPC.** `archive_org` sets `archived_at` but there's no corresponding `unarchive_org` to clear it. Platform admins have no way to restore an archived org except direct SQL. |
| 5 | **Medium** | **`schedule_org_deletion` doesn't actually delete.** It sets a `deletion_scheduled_at` timestamp but there's no cron job, Edge Function, or background process that executes the deletion when the timestamp is reached. This is a scheduling placeholder only. |
| 6 | **Medium** | **Export jobs are created but never fulfilled.** `request_org_export` creates a `pending` job row but there's no worker/Edge Function to generate the export file and transition the job to `completed`. The `file_path` column will remain null. |
| 7 | **Medium** | **Multiple orgs sharing the same domain returns first match only.** `get_identity_provider_for_email` uses `LIMIT 1` on domain match. If two orgs verify the same domain (which the unique constraint on `organization_domains` may prevent per-org but not cross-org), the user gets whichever org was inserted first. No disambiguation UI. |
| 8 | **Low** | **`upsert_identity_provider` and `delete_identity_provider` are granted to `anon`.** While the functions internally check `auth.uid()` for admin status, the `EXECUTE` grant to `anon` means unauthenticated callers can invoke them (they'll get a null `auth.uid()` and fail the admin check). Tightening the grant to `authenticated` only would be defense-in-depth. |
| 9 | **Low** | **No SCIM / user provisioning integration.** SSO config is login-only. There's no automatic user sync, deprovisioning, or group mapping from the IdP. This is expected for a first phase but should be flagged for enterprise customers. |
| 10 | **Low** | **No IdP-initiated login support.** Only SP-initiated flow is designed (user enters email → check domain → redirect). IdP-initiated SAML/OIDC callbacks would need a dedicated endpoint. |
