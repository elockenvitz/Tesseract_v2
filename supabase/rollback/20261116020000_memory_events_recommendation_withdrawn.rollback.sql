-- ROLLBACK for 20261116020000_memory_events_recommendation_withdrawn.sql
--
-- NOT a migration. This file lives in supabase/rollback/ precisely so no
-- forward-discovery path can apply it; see
-- src/lib/security/__tests__/migration-discovery-hygiene.test.ts.
--
-- READ THIS BEFORE RUNNING IT
--
-- Narrowing the enumeration will FAIL if any `recommendation.withdrawn` row
-- exists, because the new constraint is validated against existing data. That
-- is deliberate: silently deleting recorded history to make a constraint fit
-- would be rewriting decision history to suit the schema, which is the one
-- thing an append-only log must never do.
--
-- So if this fails, that is the correct outcome and the question is a product
-- one: those events are real withdrawals that really happened. Decide what
-- should become of them before narrowing anything. Do not add a DELETE here.
--
-- The query below reports the count first so the decision is informed.

begin;

do $$
declare
  n bigint;
begin
  select count(*) into n
  from public.memory_events
  where event_type = 'recommendation.withdrawn';

  if n > 0 then
    raise exception
      'Refusing to roll back: % recommendation.withdrawn event(s) exist. '
      'Narrowing the constraint would require deleting recorded history. '
      'Decide what should happen to those events first.', n;
  end if;
end $$;

alter table public.memory_events
  drop constraint if exists memory_events_type_ck;

alter table public.memory_events
  add constraint memory_events_type_ck check (
    event_type = any (array[
      'thesis.reviewed',
      'decision.reviewed',
      'obligation.raised',
      'obligation.cleared',
      'rationale.captured',
      'recommendation.submitted',
      'decision.recorded',
      'decision.reverted',
      'execution.recorded'
    ])
  );

do $$
declare
  def text;
begin
  select pg_get_constraintdef(con.oid) into def
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  where c.relname = 'memory_events' and con.conname = 'memory_events_type_ck';

  if def like '%recommendation.withdrawn%' then
    raise exception 'rollback did not remove recommendation.withdrawn: %', def;
  end if;
  if def not like '%decision.recorded%' then
    raise exception 'rollback lost a value it had to keep: %', def;
  end if;
end $$;

commit;
