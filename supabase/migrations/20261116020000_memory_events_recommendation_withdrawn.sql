-- Admit `recommendation.withdrawn` to the memory_events vocabulary.
--
-- WHY THIS IS NEEDED
--
-- `memory_events_type_ck` is a CLOSED enumeration. Before this migration it
-- allowed nine values and `recommendation.withdrawn` was not one of them, so
-- the writer added in this same change fails the CHECK on every call. The
-- application's `emit()` never throws by design — a lost memory must not fail
-- a portfolio action that already succeeded — so the failure surfaces as a
-- console warning and a dropped event, not an error the user sees.
--
-- That means the feature is INERT until this is applied. The withdrawal still
-- happens; only its record is lost.
--
-- WHY THE CODE SHIPS ANYWAY
--
-- The alternative is not "no change". Before this change `withdrawn` was a
-- resolved status and so fell through `isResolvedDecisionRequestStatus` into
-- `recordDecisionRecorded` — writing a `decision.recorded` event for an act
-- no PM performed, and inflating any count of decisions the PM made in a way
-- no reader could detect. Routing withdrawal away from that writer stops the
-- WRONG event immediately, with no migration. A gap in history is strictly
-- better than a fabrication in it.
--
-- Production holds 29 historical withdrawals and ZERO inside the Spine epoch
-- (memory_events was created 2026-09-16), so no previously-captured history
-- is affected either way, and nothing here backfills.
--
-- SAFETY
--
-- Additive only: the new enumeration is the old nine plus one. No existing
-- row can violate it, so the constraint is replaced without validation risk
-- and without touching data. No table, column, policy or grant changes.
--
-- RLS POSTURE: unchanged. `memory_events` keeps RLS enabled with its existing
-- SELECT and INSERT policies, `anon` keeps no grant, and `authenticated`
-- keeps SELECT + INSERT only. A new permitted `event_type` VALUE introduces
-- no new data path: the row is written by the same writer, under the same
-- policy, with the same server-derived `organization_id`. There is nothing to
-- widen and nothing is widened.

begin;

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
      'recommendation.withdrawn',   -- added by this migration
      'decision.recorded',
      'decision.reverted',
      'execution.recorded'
    ])
  );

-- Prove the migration did what it claims, in the same transaction that made
-- the change. A migration that reports success without checking its own
-- postcondition is the defect class this repo's standing rules name.
do $$
declare
  def text;
begin
  select pg_get_constraintdef(con.oid) into def
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  where c.relname = 'memory_events' and con.conname = 'memory_events_type_ck';

  if def is null then
    raise exception 'memory_events_type_ck is missing after the migration';
  end if;

  -- The new value must be admitted.
  if def not like '%recommendation.withdrawn%' then
    raise exception 'memory_events_type_ck does not admit recommendation.withdrawn: %', def;
  end if;

  -- And every pre-existing value must survive. An "additive" change that
  -- quietly dropped one would break a writer that is live today.
  if def not like '%thesis.reviewed%'
     or def not like '%decision.reviewed%'
     or def not like '%obligation.raised%'
     or def not like '%obligation.cleared%'
     or def not like '%rationale.captured%'
     or def not like '%recommendation.submitted%'
     or def not like '%decision.recorded%'
     or def not like '%decision.reverted%'
     or def not like '%execution.recorded%' then
    raise exception 'memory_events_type_ck lost a previously allowed value: %', def;
  end if;

  -- The constraint must still REJECT something, or it is decoration.
  begin
    insert into public.memory_events
      (organization_id, actor_id, event_type, subject_type, subject_id, dedupe_key)
    values
      (gen_random_uuid(), gen_random_uuid(), 'not.a.real.event', 'decision',
       gen_random_uuid(), 'constraint-selftest');
    raise exception 'memory_events_type_ck accepted an invalid event_type';
  exception
    when check_violation then
      null;  -- expected: the constraint is live
  end;
end $$;

commit;
