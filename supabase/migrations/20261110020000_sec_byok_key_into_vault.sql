-- Move the organization BYOK provider key out of a readable column and into
-- Supabase Vault, and close the two paths that handed it to the browser.
--
-- ── What was wrong ────────────────────────────────────────────────────────
--
-- TWO exposures, the second far wider than the first.
--
-- 1. `organization_ai_config.byok_api_key` was a plain text column covered by
--    the table's SELECT policy, and `authenticated` holds SELECT on the
--    table. Measured live on 2026-11-09 as an org admin with a real
--    auth.uid(): `select byok_api_key from organization_ai_config` returned
--    the full 108-character `sk-ant-` value.
--
-- 2. `get_org_ai_config_for_resolution(uuid)` is SECURITY DEFINER, RETURNS
--    `byok_api_key`, and `authenticated` held EXECUTE on it. Its only gate is
--    "active member of the requested org", NOT admin. Measured live the same
--    day as a user whose membership role is literally 'member':
--
--        NONADMIN_can_read_key_via_rpc  true
--        key_length_seen                108
--
--    So every ordinary user of a pilot tenant could read their firm's
--    provider key with one `supabase.rpc()` call from the devtools console.
--    This is the real hole; the admin table read was the narrow one.
--
-- The comment in src/hooks/useAIConfig.ts claimed the key is "never shipped to
-- the browser, even for admins". That was true of the app's own query path and
-- false of the database underneath it.
--
-- ── The fix ───────────────────────────────────────────────────────────────
--
-- The key stops being a column. It lives in `vault.secrets`, encrypted, in a
-- schema no browser role can reach: measured, `anon` and `authenticated` have
-- neither USAGE on schema `vault` nor SELECT on `vault.secrets`, while
-- `postgres` and `service_role` have both. `organization_ai_config` keeps only
-- a `byok_secret_id` pointer, which is useless to a client.
--
-- Three functions replace one, split by who is allowed to do what:
--
--   set_org_ai_api_key(text)     admin writes a key, never reads one back
--   clear_org_ai_api_key()       admin removes it
--   resolve_org_ai_config(uuid)  service_role ONLY, the edge function's path
--
-- `resolve_org_ai_config` is the only function in this file that returns a
-- key, and the authorization for it is the EXECUTE grant: `service_role` and
-- nothing else. There is no JWT on that path to check, which is exactly why it
-- must not be reachable by one. The edge function authorizes the user and
-- derives the organization from trusted server-side data BEFORE it constructs
-- a service_role client, per Standing Rule 6.
--
-- Note the asymmetry that makes this work: a SECURITY DEFINER function owned
-- by `postgres` can call `vault.create_secret` (EXECUTE: true for postgres,
-- false for authenticated), so an admin can SET a key through a function that
-- never returns one. Write without read.
--
-- ── RLS posture ───────────────────────────────────────────────────────────
--
-- This NARROWS access. Nothing is widened.
--   - the plaintext column is dropped, so there is nothing left to read
--   - the member-readable resolution RPC is dropped outright
--   - its replacement is granted to `service_role` only
--   - the four `organization_ai_config` policies move from TO PUBLIC (which
--     includes anon) to TO authenticated, predicates unchanged
--   - `anon` loses its table grants on organization_ai_config
--
-- ── The existing key is compromised ───────────────────────────────────────
--
-- It is migrated into Vault so the pilot keeps working, NOT because it is
-- safe. It was readable by every member of the org for the life of the
-- feature. Rotation procedure is in docs/byok-key-rotation-runbook.md and must
-- be done at the Anthropic console; no migration can do it.

begin;

-- ── 1. the pointer column ────────────────────────────────────────────────

alter table public.organization_ai_config
  add column if not exists byok_secret_id uuid;

comment on column public.organization_ai_config.byok_secret_id is
  'Pointer into vault.secrets for this org''s provider API key. Useless to a client: no browser role can read the vault schema. Written only by set_org_ai_api_key(), read only by resolve_org_ai_config() under service_role.';

-- ── 2. migrate every existing plaintext key into the vault ───────────────
--
-- Named `org_ai_key:<organization_id>` so a re-key updates in place and the
-- name stays stable and unique. A row whose key is already in the vault (a
-- re-run) is left alone.

do $$
declare
  r record;
  v_name text;
  v_id   uuid;
begin
  for r in
    select organization_id, byok_api_key
      from public.organization_ai_config
     where byok_api_key is not null
       and length(byok_api_key) > 0
       and byok_secret_id is null
  loop
    v_name := 'org_ai_key:' || r.organization_id::text;

    select id into v_id from vault.secrets where name = v_name;

    if v_id is null then
      v_id := vault.create_secret(
        r.byok_api_key,
        v_name,
        'Provider API key for organization ' || r.organization_id::text
      );
    else
      perform vault.update_secret(v_id, r.byok_api_key);
    end if;

    update public.organization_ai_config
       set byok_secret_id = v_id
     where organization_id = r.organization_id;

    raise notice 'migrated org % into vault secret %', r.organization_id, v_id;
  end loop;
end $$;

-- ── 3. the leaking function goes first, before the column it reads ───────

drop function if exists public.get_org_ai_config_for_resolution(uuid);

-- ── 4. drop the plaintext column ─────────────────────────────────────────

alter table public.organization_ai_config
  drop column if exists byok_api_key;

-- ── 5. admin writes a key. No return path for the value. ─────────────────

create or replace function public.set_org_ai_api_key(p_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org  uuid;
  v_name text;
  v_id   uuid;
  v_key  text;
begin
  v_org := current_org_id();
  if v_org is null then
    raise exception 'No active organization';
  end if;

  if not is_active_org_admin_of_current_org() then
    raise exception 'Only an organization admin can configure the AI provider key';
  end if;

  v_key := btrim(coalesce(p_key, ''));

  -- HTTP headers must be Latin-1, so a smart quote or zero-width space
  -- smuggled in by a copy/paste makes the provider fetch throw before it
  -- sends. Refusing it here gives the admin a sentence they can act on
  -- instead of a provider error days later.
  if v_key = '' then
    raise exception 'API key is empty';
  end if;
  if v_key ~ '[^\x20-\x7E]' then
    raise exception 'API key contains invisible or non-ASCII characters. Re-copy it directly from the provider console.';
  end if;
  if length(v_key) < 20 or length(v_key) > 512 then
    raise exception 'API key length is implausible (% characters)', length(v_key);
  end if;

  insert into public.organization_ai_config (organization_id)
  values (v_org)
  on conflict (organization_id) do nothing;

  select byok_secret_id into v_id
    from public.organization_ai_config
   where organization_id = v_org;

  v_name := 'org_ai_key:' || v_org::text;

  if v_id is null then
    select id into v_id from vault.secrets where name = v_name;
  end if;

  if v_id is null then
    v_id := vault.create_secret(
      v_key, v_name, 'Provider API key for organization ' || v_org::text
    );
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  update public.organization_ai_config
     set byok_secret_id = v_id,
         updated_at     = now()
   where organization_id = v_org;
end;
$$;

revoke all on function public.set_org_ai_api_key(text) from public;
revoke all on function public.set_org_ai_api_key(text) from anon;
grant execute on function public.set_org_ai_api_key(text) to authenticated;

comment on function public.set_org_ai_api_key(text) is
  'Store the calling admin''s organization provider API key in Vault. Write-only: there is no companion function that returns the value to a browser role.';

-- ── 6. admin removes a key ───────────────────────────────────────────────

create or replace function public.clear_org_ai_api_key()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  v_org := current_org_id();
  if v_org is null then
    raise exception 'No active organization';
  end if;

  if not is_active_org_admin_of_current_org() then
    raise exception 'Only an organization admin can remove the AI provider key';
  end if;

  select byok_secret_id into v_id
    from public.organization_ai_config
   where organization_id = v_org;

  update public.organization_ai_config
     set byok_secret_id = null,
         byok_enabled   = false,
         updated_at     = now()
   where organization_id = v_org;

  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
end;
$$;

revoke all on function public.clear_org_ai_api_key() from public;
revoke all on function public.clear_org_ai_api_key() from anon;
grant execute on function public.clear_org_ai_api_key() to authenticated;

-- ── 7. the edge function's resolution path. service_role ONLY. ───────────
--
-- No auth.uid() check, deliberately: service_role carries no user identity,
-- so a uid test here would make the function unusable by its only legitimate
-- caller while adding nothing. The authorization IS the grant. Which is why
-- the revokes below are not optional, and why `authenticated` must never be
-- granted EXECUTE on this.

create or replace function public.resolve_org_ai_config(p_org_id uuid)
returns table (
  byok_provider text,
  byok_api_key  text,
  byok_model    text,
  byok_enabled  boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_org_id is null then
    return;
  end if;

  return query
  select
    c.byok_provider,
    s.decrypted_secret,
    c.byok_model,
    c.byok_enabled
  from public.organization_ai_config c
  left join vault.decrypted_secrets s on s.id = c.byok_secret_id
  where c.organization_id = p_org_id;
end;
$$;

-- Supabase creates every function in `public` executable by anon, and a
-- REVOKE FROM PUBLIC does not remove a grant held by the role itself. Both
-- revokes are required.
revoke all on function public.resolve_org_ai_config(uuid) from public;
revoke all on function public.resolve_org_ai_config(uuid) from anon;
revoke all on function public.resolve_org_ai_config(uuid) from authenticated;
grant execute on function public.resolve_org_ai_config(uuid) to service_role;

comment on function public.resolve_org_ai_config(uuid) is
  'Resolve one organization''s provider config INCLUDING the decrypted key. Granted to service_role only. The caller must authorize the user and derive p_org_id from server-side data before constructing a service_role client.';

-- ── 8. the safe summary RPC keeps working, now off the pointer ───────────

create or replace function public.get_org_ai_config_summary()
returns table (
  organization_id uuid,
  byok_provider   text,
  byok_model      text,
  byok_enabled    boolean,
  is_configured   boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Caller must be an active member of their current org. If not, return
  -- nothing, which is the same shape as "no config".
  if not is_active_member_of_current_org() then
    return;
  end if;

  return query
  select
    c.organization_id,
    c.byok_provider,
    c.byok_model,
    c.byok_enabled,
    (c.byok_secret_id is not null) as is_configured
  from public.organization_ai_config c
  where c.organization_id = current_org_id();
end;
$$;

revoke all on function public.get_org_ai_config_summary() from public;
revoke all on function public.get_org_ai_config_summary() from anon;
grant execute on function public.get_org_ai_config_summary() to authenticated;

-- ── 9. the table's own posture, while we are here ────────────────────────
--
-- Same table, same vulnerability class. The four policies were created with
-- no role, which is TO PUBLIC and therefore includes anon. The predicates
-- already deny anon (is_active_org_admin_of_current_org() is false without a
-- uid), so this changes no decision; it removes the shape that makes a
-- reviewer check. Grants to anon go with it.

drop policy if exists "Org admins can view ai config"   on public.organization_ai_config;
drop policy if exists "Org admins can insert ai config" on public.organization_ai_config;
drop policy if exists "Org admins can update ai config" on public.organization_ai_config;
drop policy if exists "Org admins can delete ai config" on public.organization_ai_config;

create policy "organization_ai_config_select" on public.organization_ai_config
  for select to authenticated
  using (is_active_org_admin_of_current_org() and organization_id = current_org_id());

create policy "organization_ai_config_insert" on public.organization_ai_config
  for insert to authenticated
  with check (is_active_org_admin_of_current_org() and organization_id = current_org_id());

create policy "organization_ai_config_update" on public.organization_ai_config
  for update to authenticated
  using (is_active_org_admin_of_current_org() and organization_id = current_org_id())
  with check (is_active_org_admin_of_current_org() and organization_id = current_org_id());

create policy "organization_ai_config_delete" on public.organization_ai_config
  for delete to authenticated
  using (is_active_org_admin_of_current_org() and organization_id = current_org_id());

revoke all on table public.organization_ai_config from anon;

commit;
