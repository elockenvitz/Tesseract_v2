-- ===========================================================================
-- Atomic organization delete — rehearsal, authorization and rollback proof.
--
-- Applies 20261011140000 and exercises it inside a transaction that CANNOT
-- commit: the final statement raises deliberately.
--
-- Everything is proved on a SYNTHETIC organization created inside this
-- transaction, so no real tenant is touched even transiently.
--
-- ── How the failure is injected, and why it changed ──────────────────────
--
-- An earlier version of this script injected the failure using the coverage
-- notification bug (a 2-asset coverage change for a non-actor threw on
-- `notifications.context_id`). That bug is now fixed in production, so the
-- fixture stopped failing and A4 would have passed vacuously — an assertion
-- that "memberships survived" is trivially true if the delete never
-- endangered them.
--
-- The failure is now injected by a table created inside this transaction with
-- an `ON DELETE NO ACTION` foreign key to `organizations`. It depends on no
-- app table, no trigger and no other lane's bug, and it cannot silently stop
-- reproducing. The app's own `decision_reviews` and `messages` were rejected
-- as injections: both stamp `organization_id` from a trigger, so the row would
-- not reliably land in the fixture's organization.
--
-- ACTOR      fa46cffc-dafb-4071-a3ea-5536240d462e  elockenvitz@gmail.com
--            (in platform_admins, so is_platform_admin() passes)
-- NON-ADMIN  65f2323e-27e9-4ff4-b132-2a834430d322  colin.e.knox@gmail.com
--            (not in platform_admins)
-- MEMBER     edcae6bc-3a38-4b7c-a843-63ee5fccb7ae  jefflockenvitz@gmail.com
-- ===========================================================================
begin;

create temp table olog (seq serial, line text) on commit drop;

-- ---------------------------------------------------------------------------
-- THE FIX UNDER TEST (identical to the migration)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_organization(p_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform admin may delete an organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM organizations WHERE id = p_organization_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Organization % does not exist', p_organization_id
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM organizations WHERE id = p_organization_id;

  RETURN p_organization_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_organization(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Fixture: a synthetic org with one membership, plus a NO ACTION referent
-- that will refuse the delete. Both the table and the org roll back.
-- ---------------------------------------------------------------------------
create table public._orgdel_blocker (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete no action
);

create temp table fixture (org_id uuid) on commit drop;

do $setup$
declare v_org uuid;
begin
  insert into organizations (name, slug)
  values ('ZZ Rehearsal Org (rolled back)', 'zz-rehearsal-org-rolled-back')
  returning id into v_org;
  insert into fixture values (v_org);

  insert into organization_memberships (user_id, organization_id, status)
  values ('edcae6bc-3a38-4b7c-a843-63ee5fccb7ae', v_org, 'active');

  insert into public._orgdel_blocker (organization_id) values (v_org);

  insert into olog(line) values
    ('--    fixture org ' || v_org || ': 1 membership, 1 NO ACTION referent');
end $setup$;

-- ---------------------------------------------------------------------------
-- A1. AUTHORIZATION PRESERVED: a non-platform-admin is refused.
-- ---------------------------------------------------------------------------
do $a1$
declare refused boolean := false; code text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"65f2323e-27e9-4ff4-b132-2a834430d322","role":"authenticated"}', true);
  begin
    perform public.delete_organization((select org_id from fixture));
  exception when insufficient_privilege then
    refused := true; code := sqlstate;
  end;
  if not refused then
    raise exception 'FAIL A1: a non-platform-admin deleted an organization';
  end if;
  insert into olog(line) values
    ('OK A1  non-platform-admin refused (' || code || ') — authorization not widened');
end $a1$;

-- ---------------------------------------------------------------------------
-- A2. The org is still intact after the refused attempt.
-- ---------------------------------------------------------------------------
do $a2$
declare n_org int; n_mem int;
begin
  select count(*) into n_org from organizations where id=(select org_id from fixture);
  select count(*) into n_mem from organization_memberships
   where organization_id=(select org_id from fixture);
  if n_org <> 1 or n_mem <> 1 then
    raise exception 'FAIL A2: refused call still changed state (org=%, memberships=%)', n_org, n_mem;
  end if;
  insert into olog(line) values ('OK A2  refused call changed nothing');
end $a2$;

-- ---------------------------------------------------------------------------
-- A3. A missing organization is reported, not silently ignored.
-- ---------------------------------------------------------------------------
do $a3$
declare raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  begin
    perform public.delete_organization('00000000-0000-0000-0000-000000000000');
  exception when no_data_found or sqlstate 'P0002' then
    raised := true;
  end;
  if not raised then
    raise exception 'FAIL A3: deleting a non-existent organization reported success';
  end if;
  insert into olog(line) values ('OK A3  missing organization raises instead of silently passing');
end $a3$;

-- ---------------------------------------------------------------------------
-- A4. ROLLBACK ON FAILURE — the whole point. The delete is refused, and the
--     membership MUST survive.
-- ---------------------------------------------------------------------------
do $a4$
declare failed boolean := false; code text; n_org int; n_mem int; n_block int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  begin
    perform public.delete_organization((select org_id from fixture));
  exception when foreign_key_violation then
    failed := true; code := sqlstate;
  end;

  if not failed then
    raise exception
      'FAIL A4: the delete SUCCEEDED, so this fixture no longer reproduces the failure mode';
  end if;

  select count(*) into n_org   from organizations where id=(select org_id from fixture);
  select count(*) into n_mem   from organization_memberships
   where organization_id=(select org_id from fixture);
  select count(*) into n_block from public._orgdel_blocker
   where organization_id=(select org_id from fixture);

  if n_mem <> 1 then
    raise exception 'FAIL A4: membership did NOT survive the failed delete (% left)', n_mem;
  end if;
  if n_org <> 1 or n_block <> 1 then
    raise exception 'FAIL A4: partial damage (org=%, referents=%)', n_org, n_block;
  end if;

  insert into olog(line) values
    ('OK A4  delete refused (' || code || ') and rolled back cleanly: org=1 membership=1 referent=1');
end $a4$;

-- ---------------------------------------------------------------------------
-- A5. NON-VACUITY: the OLD two-statement client path, on the same fixture,
--     destroys the membership and leaves the organization standing. Without
--     this, A4 proves nothing.
-- ---------------------------------------------------------------------------
do $a5$
declare failed boolean := false; n_org int; n_mem int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);

  -- Statement 1, as the old client did it, in its own subtransaction so it
  -- survives statement 2's failure — PostgREST's behaviour.
  begin
    delete from organization_memberships
     where organization_id=(select org_id from fixture);
  exception when others then null;
  end;

  -- Statement 2 fails, exactly as it does in production.
  begin
    delete from organizations where id=(select org_id from fixture);
  exception when others then failed := true;
  end;

  select count(*) into n_org from organizations where id=(select org_id from fixture);
  select count(*) into n_mem from organization_memberships
   where organization_id=(select org_id from fixture);

  if not failed then
    raise exception 'FAIL A5: statement 2 succeeded, fixture no longer reproduces';
  end if;
  if n_mem <> 0 or n_org <> 1 then
    raise exception
      'FAIL A5: expected the old path to strand the org (org=1, memberships=0) but got org=%, memberships=%',
      n_org, n_mem;
  end if;
  insert into olog(line) values
    ('OK A5  the OLD path leaves org=1 membership=0 — the shell this change prevents');
end $a5$;

-- ---------------------------------------------------------------------------
-- A6. SUCCESS PATH: with the blocker removed, the RPC deletes the
--     organization and its memberships cascade — no explicit membership
--     delete anywhere.
-- ---------------------------------------------------------------------------
do $a6$
declare n_org int; n_mem int; returned uuid;
begin
  -- Restore a membership, then remove the NO ACTION referent. This is fixture
  -- teardown, not part of what A6 asserts.
  insert into organization_memberships (user_id, organization_id, status)
  values ('edcae6bc-3a38-4b7c-a843-63ee5fccb7ae', (select org_id from fixture), 'active');
  delete from public._orgdel_blocker where organization_id=(select org_id from fixture);

  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  select public.delete_organization((select org_id from fixture)) into returned;

  select count(*) into n_org from organizations where id=(select org_id from fixture);
  select count(*) into n_mem from organization_memberships
   where organization_id=(select org_id from fixture);

  if returned is distinct from (select org_id from fixture) then
    raise exception 'FAIL A6: returned %, expected the deleted org id', returned;
  end if;
  if n_org <> 0 then raise exception 'FAIL A6: organization survived the delete'; end if;
  if n_mem <> 0 then
    raise exception 'FAIL A6: % membership(s) left behind — cascade did not fire', n_mem;
  end if;
  insert into olog(line) values
    ('OK A6  success path: organization deleted and memberships cascaded, no explicit delete');
end $a6$;

-- ---------------------------------------------------------------------------
-- A7. anon cannot execute the function at all.
-- ---------------------------------------------------------------------------
do $a7$
declare has_exec boolean;
begin
  select has_function_privilege('anon', 'public.delete_organization(uuid)', 'EXECUTE')
    into has_exec;
  if has_exec then raise exception 'FAIL A7: anon can execute delete_organization'; end if;
  select has_function_privilege('authenticated', 'public.delete_organization(uuid)', 'EXECUTE')
    into has_exec;
  if not has_exec then
    raise exception 'FAIL A7: authenticated cannot execute delete_organization';
  end if;
  insert into olog(line) values ('OK A7  anon has no EXECUTE; authenticated does');
end $a7$;

-- ---------------------------------------------------------------------------
-- FINAL: abort. This transaction cannot commit, and the blocker table and the
-- synthetic organization go with it.
-- ---------------------------------------------------------------------------
do $z$
declare report text;
begin
  select string_agg(line, E'\n' order by seq) into report from olog;
  raise exception E'ORG DELETE REHEARSAL COMPLETE — ROLLING BACK\n%\n(nothing committed)', report;
end $z$;
