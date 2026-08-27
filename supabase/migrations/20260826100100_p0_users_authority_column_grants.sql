-- ============================================================================
-- P0 — Layer B: remove direct client control of authority-bearing user columns
-- ============================================================================
--
-- `authenticated` and `anon` held table-wide INSERT and UPDATE on
-- `public.users`. RLS restricts which ROWS you may write; Postgres has no
-- column-level RLS, so `Users can update their own profile`
-- (USING/WITH CHECK `auth.uid() = id`) let a user write ANY column of their
-- own row — `current_organization_id` among them. Column grants are the only
-- mechanism that can express "your row, but not that field".
--
-- The INSERT grant mattered just as much and is easy to miss: `Users can
-- insert their own profile` has WITH CHECK `auth.uid() = id` and no column
-- restriction either, so a freshly signed-up account could have created its
-- own profile row with `current_organization_id` already pointing at a victim
-- organization — the same bypass through a different door.
--
-- WHAT THE CLIENT ACTUALLY WRITES
--
-- Every write to `public.users` in the application was inventoried before this
-- allowlist was drawn:
--
--   src/hooks/useAuth.ts:78            INSERT  profile bootstrap
--   src/contexts/AuthContext.tsx:48    INSERT  profile bootstrap
--   src/hooks/useAuth.ts:266           UPSERT  id, email, first_name, last_name
--   src/hooks/useAuth.ts:116           UPDATE  email          (sync from session)
--   src/components/onboarding/SetupWizard.tsx:500
--                                      UPDATE  user_type
--   src/hooks/usePilotProgress.ts:197  UPDATE  pilot_progress
--   src/pages/ops/OpsPilotPanel.tsx:154 UPDATE pilot_progress
--   src/pages/SettingsPage.tsx:149     UPDATE  timezone
--   src/pages/OrganizationPage.tsx:2573 UPDATE coverage_admin  (org admin flow)
--
-- Nothing writes `current_organization_id` directly. Every organization switch
-- already routes through `set_current_org()` / `morph_switch_org()` /
-- `morph_restore_org()`, which are SECURITY DEFINER, owned by `postgres`, and
-- therefore unaffected by grants made to `authenticated`. Revoking the column
-- costs the application nothing.
--
-- THE ALLOWLIST, AND THE TWO JUDGEMENT CALLS
--
-- Granted:   first_name, last_name, timezone, user_type, email,
--            pilot_progress, coverage_admin
-- Withheld:  current_organization_id, is_active, is_pilot_user, id,
--            created_at, updated_at
--            (full_name is GENERATED ALWAYS and is not writable at all)
--
--   * `coverage_admin` is authority-bearing and stays granted, because
--     `OrganizationPage` administers it directly through the existing
--     `Org admins can update coverage_admin for org members` policy. Removing
--     the grant would break that flow; the policy only constrains rows, so it
--     cannot stop a user setting the flag on their OWN row. Layer C closes
--     that specific hole with a trigger rather than by breaking the admin UI.
--
--   * `email` stays granted because `useAuth` syncs it from the authenticated
--     session. Nothing authorises on `public.users.email` — invite matching
--     reads `auth.users.email` — so a forged value is a display-level lie, not
--     an escalation. Noted as residual risk rather than fixed here; moving it
--     behind an RPC is out of scope for a P0 with minimal blast radius.
--
-- `updated_at` is deliberately absent: the BEFORE UPDATE trigger
-- `update_users_updated_at` sets it, and no client sends it.
--
-- `anon` loses write access entirely. There is no legitimate unauthenticated
-- write to a user profile; the signup path runs authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Revoke the table-wide grants. DELETE goes too: `users` has no DELETE policy,
-- so the privilege was already inert, and leaving it is an invitation for a
-- future permissive policy to become a deletion primitive.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.users FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon;

-- ----------------------------------------------------------------------------
-- Re-grant the safe columns only. Row-level authorisation is unchanged and
-- still comes from the existing policies on `public.users`.
-- ----------------------------------------------------------------------------
GRANT INSERT (id, email, first_name, last_name, timezone, user_type)
  ON public.users TO authenticated;

GRANT UPDATE (first_name, last_name, timezone, user_type, email,
              pilot_progress, coverage_admin)
  ON public.users TO authenticated;
