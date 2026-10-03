-- Why the work was parked, in the user's own words.
--
-- ── The gap this closes ──────────────────────────────────────────────────
--
-- `memory_obligations` records THAT a person parked work and when they want
-- it back. It has never recorded why. So the resurfacing card can say "you
-- asked to revisit this" and never "you were waiting for the Q3 print" —
-- and the second sentence is the one that makes the feature worth opening.
--
-- Every other candidate for closing that gap required inventing something:
-- reading the thesis, watching a calendar, asking a model what the analyst
-- probably meant. This asks the analyst. The user supplies the truth, which
-- is the only way to have it without manufacturing it.
--
-- ── Naming ───────────────────────────────────────────────────────────────
--
-- `waiting_for`, not `reason` or `note`.
--
--   `provenance` on this table already means WHICH WRITER raised the row
--     ('ui:snooze-idea', 'job:trade-book-lifecycle'). A column called
--     `reason` beside it would read as a second machine field.
--   `note` invites it to become a general scratchpad. This is one specific
--     thing — the condition the person is waiting on — and the column name
--     is what keeps it that.
--   `waiting_for` cannot be misread in either direction, and it is the
--     literal question the UI asks.
--
-- ── What it is NOT ───────────────────────────────────────────────────────
--
-- NOT an evaluated condition. "Q3 earnings" here is a note a human wrote,
-- not a trigger: `asset_earnings_dates` holds zero rows, so the product has
-- no way to know whether Q3 earnings happened, and the card is forbidden
-- from implying it does. See the comment on the column.
--
-- NOT AI-written. Only the two RPCs below set it, and both take it from the
-- caller — which is a person typing in a dialog.

alter table public.memory_obligations
  add column if not exists waiting_for text;

comment on column public.memory_obligations.waiting_for is
  'What the person said they were waiting for, in their own words. USER-SUPPLIED INTENT, never an evaluated condition and never model-written: the product cannot tell whether the stated thing happened, and no reader may imply that it can. Null when they did not say.';

-- ─────────────────────────────────────────────────────────────────────────
-- raise_memory_obligation gains the note.
--
-- Added as a trailing parameter with a default so every existing caller —
-- the Trade Book lifecycle sync passes nine arguments — keeps compiling and
-- keeps working. A system-raised obligation has no `waiting_for` and should
-- not: nobody told it anything.
--
-- Idempotency is unchanged: an open obligation for the same
-- (org, kind, subject, owner) is still returned as-is rather than updated.
-- That is deliberate even now that there is a note to update — see
-- supersede below for why changing the note creates a new row instead.
--
-- ── DROP, not just CREATE OR REPLACE ─────────────────────────────────────
--
-- `CREATE OR REPLACE FUNCTION` with a DIFFERENT argument list OVERLOADS; it
-- does not replace. Without the drop below, applying this migration would
-- leave two `raise_memory_obligation` functions: the live 9-argument one and
-- this 10-argument one whose extra parameter has a default.
--
-- A call supplying exactly the original nine named arguments then matches
-- BOTH, and Postgres raises `42725 function ... is not unique`. That is not
-- hypothetical: `useTradeReviewObligations.ts` makes exactly that call, so
-- the Trade Book obligation sync would start failing the moment this
-- migration was applied — while the old app was still deployed, which is
-- precisely the window the rollout order depends on.
--
-- Dropped by EXACT typed signature, never by name. A bare
-- `drop function raise_memory_obligation` would itself fail with 42725 once
-- an overload exists, and would be a loaded gun if a future overload were
-- added.
--
-- Safe inside the migration's transaction: the drop and the create are
-- atomic, so no concurrent caller ever observes the gap.
--
-- ── Defaults are PRESERVED ───────────────────────────────────────────────
--
-- The live function defaults `p_owner_id` through `p_provenance`. The first
-- draft of this migration silently dropped those, narrowing the contract for
-- any caller that omitted an optional argument. They are restored verbatim
-- below so the only difference between the old function and the new one is
-- the added trailing parameter — which is what makes an old 9-argument
-- caller resolve cleanly against the new 10-argument function.
--
-- ── Grants must be re-issued ─────────────────────────────────────────────
--
-- `CREATE OR REPLACE` keeps a function's ACL; `DROP` discards it. The live
-- ACL is `authenticated=X, service_role=X` and NOT anon, and it is restored
-- explicitly after each create rather than inherited by accident.
-- ─────────────────────────────────────────────────────────────────────────

drop function if exists public.raise_memory_obligation(
  uuid, text, text, uuid, uuid, timestamptz, text, uuid, text
);

create or replace function public.raise_memory_obligation(
  p_org_id uuid,
  p_kind text,
  p_subject_type text,
  p_subject_id uuid,
  p_owner_id uuid default null,
  p_due_at timestamptz default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_provenance text default 'ui',
  p_waiting_for text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_existing uuid;
begin
  if not (public.is_member_of_org(p_org_id) or auth.uid() is null) then
    raise exception 'raise_memory_obligation: not a member of %', p_org_id;
  end if;

  select id into v_existing from memory_obligations
   where organization_id = p_org_id and kind = p_kind
     and subject_type = p_subject_type and subject_id = p_subject_id
     and coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and cleared_at is null;
  if v_existing is not null then return v_existing; end if;

  insert into memory_obligations
    (organization_id, kind, subject_type, subject_id, owner_id, due_at,
     source_type, source_id, provenance, waiting_for)
  values (p_org_id, p_kind, p_subject_type, p_subject_id, p_owner_id, p_due_at,
          p_source_type, p_source_id, p_provenance, nullif(btrim(p_waiting_for), ''))
  returning id into v_id;

  -- The event records that a note EXISTS, not what it says. memory_events
  -- connects truth rather than copying it, and the words live on the
  -- obligation — which is also the row that gets cleared, so the two cannot
  -- drift apart.
  insert into memory_events
    (organization_id, actor_id, event_type, subject_type, subject_id,
     related, source_type, source_id, provenance, payload, dedupe_key)
  values (p_org_id, auth.uid(), 'obligation.raised', 'obligation', v_id,
     jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id, 'owner_id', p_owner_id),
     'memory_obligations', v_id, p_provenance,
     jsonb_build_object(
       'kind', p_kind,
       'due_at', p_due_at,
       'has_waiting_for', nullif(btrim(p_waiting_for), '') is not null
     ),
     'obligation.raised:' || v_id::text);

  return v_id;
end;
$function$;

-- The live ACL, restored exactly. `anon` is deliberately absent.
revoke all on function public.raise_memory_obligation(
  uuid, text, text, uuid, uuid, timestamptz, text, uuid, text, text
) from public;
grant execute on function public.raise_memory_obligation(
  uuid, text, text, uuid, uuid, timestamptz, text, uuid, text, text
) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- supersede_memory_obligation: a changed REASON supersedes, like a changed
-- date.
--
-- "Parked until the 15th waiting for the print" and "parked until the 15th
-- waiting for the CFO search to conclude" are two different intentions that
-- happen to share a date. Updating the note in place would rewrite the
-- first one out of existence and leave the record saying the person always
-- meant the second.
--
-- So the comparison that decides "nothing changed" now covers both fields.
-- A repeated click with the same date AND the same words is still a no-op —
-- no churn of cleared/raised pairs in the timeline for somebody who pressed
-- the same button twice.
-- ─────────────────────────────────────────────────────────────────────────

-- Same overload hazard, same fix.
--
-- `20260930180000` introduces a 9-argument `supersede_memory_obligation`.
-- Both migrations are unapplied, so this overload would exist only inside
-- the bundle — but it would exist, and a 9-argument caller would hit the
-- same 42725. Dropped by exact signature for the same reasons as above.
--
-- Nothing calls the 9-argument form today; it is removed so it cannot
-- become the ambiguity somebody rediscovers later.
drop function if exists public.supersede_memory_obligation(
  uuid, text, text, uuid, uuid, timestamptz, text, uuid, text
);

create or replace function public.supersede_memory_obligation(
  p_org_id uuid,
  p_kind text,
  p_subject_type text,
  p_subject_id uuid,
  p_owner_id uuid default null,
  p_due_at timestamptz default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_provenance text default 'ui',
  p_waiting_for text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing uuid;
  v_same boolean;
  v_waiting text := nullif(btrim(p_waiting_for), '');
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

  if v_existing is not null then
    -- `is not distinct from` rather than `=`, so null-to-null counts as
    -- unchanged and null-to-text counts as changed. With `=` a user adding
    -- a reason to an existing snooze would get NULL, read as "not the
    -- same", and churn a cleared/raised pair on every single save.
    select (due_at is not distinct from p_due_at)
       and (waiting_for is not distinct from v_waiting)
      into v_same
      from memory_obligations where id = v_existing;

    if v_same then return v_existing; end if;

    perform public.clear_memory_obligation(v_existing, p_provenance || ':superseded');
  end if;

  return public.raise_memory_obligation(
    p_org_id, p_kind, p_subject_type, p_subject_id, p_owner_id,
    p_due_at, p_source_type, p_source_id, p_provenance, v_waiting
  );
end;
$function$;

revoke all on function public.supersede_memory_obligation(uuid, text, text, uuid, uuid, timestamptz, text, uuid, text, text) from public;
grant execute on function public.supersede_memory_obligation(uuid, text, text, uuid, uuid, timestamptz, text, uuid, text, text) to authenticated, service_role;

comment on function public.supersede_memory_obligation(uuid, text, text, uuid, uuid, timestamptz, text, uuid, text, text) is
  'Move an open obligation to a new due date or a new stated reason, in one transaction: clears the old (preserving it) and raises the new. Returns the existing row unchanged when neither has moved.';

-- RLS posture: UNCHANGED. `authenticated` still holds SELECT only on
-- memory_obligations; every write still goes through these SECURITY DEFINER
-- functions, each of which checks is_member_of_org itself. A new column does
-- not widen who can write or what they can write as. There is still no
-- UPDATE and no DELETE policy, so `waiting_for` is immutable from any client
-- once written — a changed reason supersedes rather than edits.
