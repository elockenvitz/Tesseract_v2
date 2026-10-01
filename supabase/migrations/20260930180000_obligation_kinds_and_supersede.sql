-- Obligations: a vocabulary for `kind`, and an atomic reschedule.
--
-- ── What is already right, and is not touched ────────────────────────────
--
-- `memory_obligations` and its two RPCs are well built and this migration
-- changes neither their shape nor their posture:
--
--   * `memory_obligations_open_uk` — unique (org, kind, subject_type,
--     subject_id, coalesce(owner_id, '000…')) WHERE cleared_at IS NULL —
--     already makes "at most one open obligation per thing per owner" a
--     database fact rather than a convention.
--   * `memory_obligations_open_ix` on (org, kind, due_at) WHERE cleared_at
--     IS NULL is exactly the index a "what is due and uncleared" query wants.
--   * `authenticated` holds SELECT and nothing else. All writes go through
--     two SECURITY DEFINER RPCs that check `is_member_of_org` themselves.
--     That is the correct posture and no grant is widened here.
--   * `raise_memory_obligation` is already idempotent (returns the existing
--     open row) and already writes an `obligation.raised` memory event;
--     `clear_memory_obligation` is already idempotent and writes
--     `obligation.cleared`. Part 10 of this slice needs no new events —
--     the vocabulary exists and the RPCs are the only writers.
--
-- Two things are added.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. A CHECK on `kind`
--
-- `kind` is free text today. Every reader selects by an exact kind string,
-- so a typo does not fail — it creates an obligation in a class nothing ever
-- queries. The row exists, the user is told their work was remembered, and
-- no surface will ever show it again. That is the worst available failure
-- for a feature whose entire promise is "we did not forget".
--
-- `memory_events` already constrains `event_type` this way for the same
-- reason. This is the same guard on the sibling table.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.memory_obligations
  drop constraint if exists memory_obligations_kind_ck;

alter table public.memory_obligations
  add constraint memory_obligations_kind_ck check (
    kind in (
      -- Existing, written by the Trade Book lifecycle sync.
      'trade_review',
      -- This slice: a user parked an idea until a date.
      'idea_revisit',
      -- This slice: a PM deferred a recommendation to a date.
      'decision_revisit'
    )
  );

comment on constraint memory_obligations_kind_ck on public.memory_obligations is
  'Obligation vocabulary. An unlisted kind is unreachable by every reader, so it is rejected rather than silently stored.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. supersede_memory_obligation — change the date, atomically
--
-- A user who snoozes to the 15th and then changes their mind to the 30th
-- needs the open obligation to move. Neither existing RPC can do it:
--
--   `raise_memory_obligation` finds the open row and returns it UNCHANGED,
--     so the due date silently stays at the 15th while the UI says the 30th.
--   clear-then-raise from the client is two round trips with no transaction.
--     If the clear lands and the raise does not — a dropped connection, a
--     closed tab — the obligation is gone and the user believes their work
--     is still being remembered. Silently losing the thing whose only job is
--     not to be forgotten is the one failure this feature cannot have.
--
-- So: one function, one transaction. The old obligation is CLEARED rather
-- than updated, because "they parked it until the 15th, then moved it to the
-- 30th" is two facts and the first one happened. Both are preserved — the
-- cleared row with its original due_at, and the two memory events the
-- underlying RPCs write. Nothing is rewritten to make the history look like
-- the user always meant the 30th.
--
-- SECURITY DEFINER, like its two callees, and it checks membership before
-- doing anything. It is implemented by calling them rather than by touching
-- the table, so the dedupe rule and the event writes have exactly one
-- definition.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.supersede_memory_obligation(
  p_org_id uuid,
  p_kind text,
  p_subject_type text,
  p_subject_id uuid,
  p_owner_id uuid,
  p_due_at timestamptz,
  p_source_type text,
  p_source_id uuid,
  p_provenance text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing uuid;
  v_new uuid;
begin
  if not (public.is_member_of_org(p_org_id) or auth.uid() is null) then
    raise exception 'supersede_memory_obligation: not a member of %', p_org_id;
  end if;

  select id into v_existing
    from memory_obligations
   where organization_id = p_org_id
     and kind = p_kind
     and subject_type = p_subject_type
     and subject_id = p_subject_id
     and coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and cleared_at is null
     for update;

  -- Nothing changed? Then nothing is superseded. Returning the existing row
  -- untouched keeps a repeated click, a double submit and a retry free of
  -- side effects — no churn of cleared/raised pairs in the timeline for a
  -- user who pressed the same button twice.
  if v_existing is not null then
    if (select due_at is not distinct from p_due_at
          from memory_obligations where id = v_existing) then
      return v_existing;
    end if;

    perform public.clear_memory_obligation(v_existing, p_provenance || ':superseded');
  end if;

  v_new := public.raise_memory_obligation(
    p_org_id, p_kind, p_subject_type, p_subject_id, p_owner_id,
    p_due_at, p_source_type, p_source_id, p_provenance
  );

  return v_new;
end;
$function$;

revoke all on function public.supersede_memory_obligation(uuid, text, text, uuid, uuid, timestamptz, text, uuid, text) from public;
grant execute on function public.supersede_memory_obligation(uuid, text, text, uuid, uuid, timestamptz, text, uuid, text) to authenticated;

comment on function public.supersede_memory_obligation(uuid, text, text, uuid, uuid, timestamptz, text, uuid, text) is
  'Move an open obligation to a new due date in one transaction: clears the old (preserving it) and raises the new. Returns the existing row unchanged when the due date has not moved.';
