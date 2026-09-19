-- Does the Memory Spine hold its contract?
--
--     psql "$DATABASE_URL" -f scripts/verify-memory-spine.sql
--
-- Seeds a throwaway org and always raises, so the probe rolls back and nothing
-- survives. A pass is:
--
--     ERROR:  ROLLBACK_OK: all 7 schema cases passed
--
-- which is a deliberate error and the only success condition. Any other
-- message names the assertion that broke.
--
-- Why a probe rather than a unit test: the contract is in Postgres -- partial
-- unique indexes, CHECK constraints, and two RPCs that must change state and
-- emit an event in one transaction. A TypeScript test can assert the shape of
-- the migration text but not that the database refused a second open
-- obligation.

do $$
declare
  v_admin uuid; v_org uuid; v_subj uuid := gen_random_uuid();
  v_ob1 uuid; v_ob2 uuid; v_ob3 uuid; v_cleared boolean;
  v_events int; fails text[] := '{}';
begin
  -- `is_member_of_org` reads auth.uid(); borrow a real identity for this
  -- transaction only. Everything rolls back.
  select user_id into v_admin from platform_admins limit 1;
  if v_admin is null then raise exception 'no platform admin to impersonate'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into organizations (name, slug, settings)
  values ('ZZ_spine_probe','zz-spine-probe','{}'::jsonb) returning id into v_org;
  insert into organization_memberships (organization_id, user_id, role, status)
  values (v_org, v_admin, 'member', 'active');

  -- 1. Raising creates the obligation AND exactly one event, atomically.
  v_ob1 := public.raise_memory_obligation(v_org,'thesis_stale','asset',v_subj,v_admin,null,null,null,'test');
  select count(*) into v_events from memory_events
   where subject_id = v_ob1 and event_type = 'obligation.raised';
  if v_events <> 1 then fails := fails || ('raise events='||v_events); end if;

  -- 2. Idempotent. The producer is a scheduled sweep; it will ask every run.
  v_ob2 := public.raise_memory_obligation(v_org,'thesis_stale','asset',v_subj,v_admin,null,null,null,'test');
  if v_ob2 <> v_ob1 then fails := fails || 'second raise made a new obligation'; end if;
  select count(*) into v_events from memory_events where subject_id = v_ob1;
  if v_events <> 1 then fails := fails || ('duplicate raise logged '||v_events); end if;

  -- 3. Clearing writes the state AND the event. Neither without the other.
  v_cleared := public.clear_memory_obligation(v_ob1,'test');
  if not v_cleared then fails := fails || 'clear returned false'; end if;
  if not exists (select 1 from memory_obligations
      where id=v_ob1 and cleared_at is not null and cleared_by = v_admin) then
    fails := fails || 'cleared_at/by not set'; end if;
  if not exists (select 1 from memory_events
      where subject_id=v_ob1 and event_type='obligation.cleared') then
    fails := fails || 'no cleared event'; end if;

  -- 4. Two people satisfying the same obligation at once is ordinary; the
  --    second has not made an error, and must not log a second clearing.
  if public.clear_memory_obligation(v_ob1,'test') then fails := fails || 'second clear returned true'; end if;
  select count(*) into v_events from memory_events
   where subject_id=v_ob1 and event_type='obligation.cleared';
  if v_events <> 1 then fails := fails || ('duplicate clear logged '||v_events); end if;

  -- 5. A thesis reviewed in March can go stale again in September. The unique
  --    index must be partial, or it would forbid that forever.
  v_ob3 := public.raise_memory_obligation(v_org,'thesis_stale','asset',v_subj,v_admin,null,null,null,'test');
  if v_ob3 = v_ob1 then fails := fails || 're-raise returned the cleared row'; end if;

  -- 6. ...but only one OPEN at a time.
  begin
    insert into memory_obligations (organization_id,kind,subject_type,subject_id,owner_id,provenance)
    values (v_org,'thesis_stale','asset',v_subj,v_admin,'test');
    fails := fails || 'partial unique index did not block a second open obligation';
  exception when unique_violation then null; end;

  -- 7. Constraints: the event vocabulary, all-or-nothing source references,
  --    and per-org dedupe.
  begin
    insert into memory_events (organization_id,event_type,subject_type,subject_id,provenance)
    values (v_org,'not.a.type','asset',v_subj,'test');
    fails := fails || 'event_type check missing';
  exception when check_violation then null; end;
  begin
    insert into memory_events (organization_id,event_type,subject_type,subject_id,provenance,source_type)
    values (v_org,'thesis.reviewed','asset',v_subj,'test','decision_reviews');
    fails := fails || 'half a source reference was allowed';
  exception when check_violation then null; end;
  begin
    insert into memory_events (organization_id,event_type,subject_type,subject_id,provenance,dedupe_key)
    values (v_org,'thesis.reviewed','asset',v_subj,'test','k1');
    insert into memory_events (organization_id,event_type,subject_type,subject_id,provenance,dedupe_key)
    values (v_org,'thesis.reviewed','asset',v_subj,'test','k1');
    fails := fails || 'dedupe_key not unique per org';
  exception when unique_violation then null; end;

  if array_length(fails,1) is not null then
    raise exception 'SPINE SCHEMA FAILED: %', array_to_string(fails,' | ');
  end if;
  raise exception 'ROLLBACK_OK: all 7 schema cases passed';
end $$;
