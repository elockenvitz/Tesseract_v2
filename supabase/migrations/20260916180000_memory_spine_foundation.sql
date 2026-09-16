-- Memory Spine: the foundation only.
--
-- The product records what people DID and almost nothing about what they
-- CONCLUDED. Origin of intent is well captured -- `trade_queue_items.rationale`
-- is populated on 220 of 233 rows -- but every judgement made afterwards is
-- computed per render and forgotten on unmount. `decision_reviews` holds 6 rows
-- against 52 committed trades; `trade_event_rationales` holds 0;
-- `attention_user_state.last_viewed_at` has never been written.
--
-- These two tables are where a conclusion goes. Nothing is wired to them in
-- this migration: no producer, no consumer, no backfill. Schema and security
-- only, so the contract can be reviewed before anything depends on it.
--
-- ── The rule ───────────────────────────────────────────────────────────────
--
-- The Spine CONNECTS existing truth; it does not duplicate and compete with
-- it. Where content already has an authoritative home, the event carries a
-- REFERENCE to it (`source_type`, `source_id`, `source_field`) rather than a
-- copy. If a question can be answered by reading only `memory_events`, the
-- Spine has taken over something that belongs elsewhere.
--
-- The one deliberate exception is documented on `payload` below.
--
-- ── What stays authoritative ───────────────────────────────────────────────
--
--   decision_reviews         the review's content
--   accepted_trades.acceptance_note, trade_batches.description,
--   trade_queue_items.rationale/thesis_text   the rationale text
--   asset_contributions      thesis content and freshness
--   attention_user_state     snooze/dismiss suppression, and the view cursor
--   audit_events             field-level mutation (a different altitude:
--                            audit says a column changed, the Spine says a
--                            person concluded something)

-- ---------------------------------------------------------------------------
-- Membership helper
-- ---------------------------------------------------------------------------

-- Membership in a NAMED org, not the session's current one: a Spine row is
-- scoped by the org on the row itself, and a reader may legitimately hold
-- several. `is_active_member_of_current_org()` answers a different question.
create or replace function public.is_member_of_org(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_memberships m
     where m.organization_id = p_org_id
       and m.user_id = auth.uid()
       and coalesce(m.status, 'active') = 'active'
  );
$$;

revoke all on function public.is_member_of_org(uuid) from public, anon;
grant execute on function public.is_member_of_org(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- memory_events — what happened over time. Append-only.
-- ---------------------------------------------------------------------------

create table if not exists public.memory_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Null means a system writer. The `provenance` column then names the job,
  -- so "nobody did this" is never confused with "we lost who did".
  actor_id        uuid references public.users(id) on delete set null,

  event_type      text not null,
  subject_type    text not null,
  -- Deliberately no FK: the subject is polymorphic across trade_queue_items,
  -- decision_requests, accepted_trades, assets and portfolios. `subject_type`
  -- says which, and is constrained.
  subject_id      uuid not null,

  -- Secondary ids for querying ({asset_id, portfolio_id, decision_id, ...}).
  -- Never content.
  related         jsonb not null default '{}'::jsonb,

  -- Where the authoritative content lives. A reference, never a copy.
  source_type     text,
  source_id       uuid,
  source_field    text,

  -- Who or what wrote it: 'ui:outcomes', 'job:staleness-sweeper',
  -- 'backfill:2026-09'. Required, because an event whose origin is unknown
  -- cannot be trusted or re-run.
  provenance      text not null,

  /*
   * When it HAPPENED vs when we LEARNED it.
   *
   * This pair is what lets a backfilled row be honest. A row imported later
   * carries the original timestamp in `occurred_at` and the import time in
   * `recorded_at`; a reader can always tell the difference between "this
   * happened in April" and "we have known this since April". Without it a
   * backfill silently claims the Spine existed historically.
   */
  occurred_at     timestamptz not null default now(),
  recorded_at     timestamptz not null default now(),

  /*
   * The minimum semantic snapshot, and nothing more.
   *
   * `decision_reviews` is MUTABLE, so `source_id` alone cannot say what was
   * concluded at the time -- re-reading the row later gives the conclusion as
   * it stands now, which is not what the event recorded. So the payload keeps
   * the normalised verdict fields only (e.g. {"thesis_played_out": "yes"}),
   * enough to understand the conclusion at that moment.
   *
   * It does NOT hold prose. `process_note` and any free text stay in the
   * authoritative row, where they can be corrected. The snapshot answers
   * "what did they conclude then"; the source answers "what does the review
   * say now".
   */
  payload         jsonb not null default '{}'::jsonb,

  -- Per USER ACTION, not per calendar day: two genuine reviews of the same
  -- thesis on one afternoon are two events, and a day-granular key would
  -- silently swallow the second.
  dedupe_key      text,

  constraint memory_events_type_ck check (event_type in (
    'thesis.reviewed',
    'decision.reviewed',
    'obligation.raised',
    'obligation.cleared',
    'rationale.captured'
  )),
  constraint memory_events_subject_ck check (subject_type in (
    'asset', 'idea', 'decision', 'trade', 'batch', 'portfolio', 'obligation'
  )),
  -- A source reference is all-or-nothing; half of one points nowhere.
  constraint memory_events_source_ck check (
    (source_type is null and source_id is null)
    or (source_type is not null and source_id is not null)
  )
);

comment on table public.memory_events is
  'Append-only log of conclusions. References authoritative content rather than copying it; see source_type/source_id.';

create unique index if not exists memory_events_dedupe_uk
  on public.memory_events (organization_id, dedupe_key)
  where dedupe_key is not null;

-- The three reads V1 will make: recent events in an org, the history of one
-- subject, and everything referencing one authoritative row.
create index if not exists memory_events_org_time_ix
  on public.memory_events (organization_id, occurred_at desc);
create index if not exists memory_events_subject_ix
  on public.memory_events (organization_id, subject_type, subject_id, occurred_at desc);
create index if not exists memory_events_source_ix
  on public.memory_events (source_type, source_id)
  where source_type is not null;

-- ---------------------------------------------------------------------------
-- memory_obligations — what is owed now. Current state, not history.
-- ---------------------------------------------------------------------------

create table if not exists public.memory_obligations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null,
  subject_type    text not null,
  subject_id      uuid not null,
  owner_id        uuid references public.users(id) on delete set null,
  raised_at       timestamptz not null default now(),
  due_at          timestamptz,
  cleared_at      timestamptz,
  cleared_by      uuid references public.users(id) on delete set null,
  source_type     text,
  source_id       uuid,
  provenance      text not null,
  constraint memory_obligations_subject_ck check (subject_type in (
    'asset', 'idea', 'decision', 'trade', 'batch', 'portfolio'
  )),
  constraint memory_obligations_cleared_ck check (
    (cleared_at is null and cleared_by is null)
    or (cleared_at is not null)
  )
);

comment on table public.memory_obligations is
  'What is owed now. memory_events says what happened over time; this says what is still open.';

/*
 * One OPEN obligation per (kind, subject, owner) -- and only while open.
 *
 * A permanent key on (kind, subject) would prevent the obligation from ever
 * being raised again after it was cleared, which is wrong: a thesis reviewed
 * in March can go stale again in September. The partial predicate means
 * cleared rows never block a new one, and history accumulates as rows.
 *
 * `owner_id` is coalesced because NULL never equals NULL in a unique index,
 * so two unowned obligations of the same kind on the same subject would
 * otherwise both be allowed.
 */
create unique index if not exists memory_obligations_open_uk
  on public.memory_obligations (
    organization_id, kind, subject_type, subject_id,
    coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where cleared_at is null;

create index if not exists memory_obligations_open_ix
  on public.memory_obligations (organization_id, kind, due_at)
  where cleared_at is null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.memory_events      enable row level security;
alter table public.memory_obligations enable row level security;

-- Read: members of the org named on the row itself.
create policy memory_events_select on public.memory_events
  for select to authenticated
  using (public.is_member_of_org(organization_id));

/*
 * Insert: yourself, in your own org.
 *
 * `actor_id = auth.uid()` is not decoration -- without it a member could write
 * a conclusion attributed to a colleague, and the whole point of this table is
 * that it says who concluded something. System events (actor_id null) cannot
 * be written by a client at all; they go through service_role.
 */
create policy memory_events_insert on public.memory_events
  for insert to authenticated
  with check (
    public.is_member_of_org(organization_id)
    and actor_id = auth.uid()
  );

/*
 * No UPDATE policy and no DELETE policy, for any client role. Deliberate and
 * load-bearing: a log that can be rewritten is not a log. With RLS enabled and
 * no permissive policy, both are denied even though the grants below exist.
 * Corrections are new events.
 */

create policy memory_obligations_select on public.memory_obligations
  for select to authenticated
  using (public.is_member_of_org(organization_id));

/*
 * No client INSERT/UPDATE/DELETE on obligations either.
 *
 * Raising and clearing must each change the obligation AND emit its event, in
 * one transaction. A direct UPDATE could clear an obligation without recording
 * that anyone cleared it, and the two tables would disagree about what
 * happened. Both transitions go through the RPCs below.
 */

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.memory_events      from public, anon;
revoke all on public.memory_obligations from public, anon;

grant select, insert on public.memory_events to authenticated;
grant select              on public.memory_obligations to authenticated;
grant select, insert, update, delete on public.memory_events      to service_role;
grant select, insert, update, delete on public.memory_obligations to service_role;

-- ---------------------------------------------------------------------------
-- Obligation RPCs — the only way obligation state changes
-- ---------------------------------------------------------------------------

/*
 * Raise, and record that it was raised, atomically.
 *
 * Idempotent by the partial unique index: asking twice for an obligation that
 * is already open returns the existing row and emits no second event. That
 * matters because the intended producer is a sweep that runs on a schedule and
 * will ask every time it runs.
 */
create or replace function public.raise_memory_obligation(
  p_org_id       uuid,
  p_kind         text,
  p_subject_type text,
  p_subject_id   uuid,
  p_owner_id     uuid   default null,
  p_due_at       timestamptz default null,
  p_source_type  text   default null,
  p_source_id    uuid   default null,
  p_provenance   text   default 'ui'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_existing uuid;
begin
  if not (public.is_member_of_org(p_org_id) or auth.uid() is null) then
    raise exception 'raise_memory_obligation: not a member of %', p_org_id;
  end if;

  select id into v_existing
    from memory_obligations
   where organization_id = p_org_id
     and kind = p_kind
     and subject_type = p_subject_type
     and subject_id = p_subject_id
     and coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and cleared_at is null;

  -- Already owed. Say so; do not log it again.
  if v_existing is not null then
    return v_existing;
  end if;

  insert into memory_obligations
    (organization_id, kind, subject_type, subject_id, owner_id, due_at,
     source_type, source_id, provenance)
  values
    (p_org_id, p_kind, p_subject_type, p_subject_id, p_owner_id, p_due_at,
     p_source_type, p_source_id, p_provenance)
  returning id into v_id;

  insert into memory_events
    (organization_id, actor_id, event_type, subject_type, subject_id,
     related, source_type, source_id, provenance, payload, dedupe_key)
  values
    (p_org_id, auth.uid(), 'obligation.raised', 'obligation', v_id,
     jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id,
                        'owner_id', p_owner_id),
     'memory_obligations', v_id, p_provenance,
     jsonb_build_object('kind', p_kind, 'due_at', p_due_at),
     'obligation.raised:' || v_id::text);

  return v_id;
end;
$$;

/*
 * Clear, and record that it was cleared, atomically.
 *
 * Returns false when the obligation is already cleared rather than raising:
 * two people satisfying the same obligation at once is ordinary, and the
 * second one has not made an error.
 */
create or replace function public.clear_memory_obligation(
  p_obligation_id uuid,
  p_provenance    text default 'ui'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_kind text;
  v_cleared timestamptz;
begin
  select organization_id, kind, cleared_at
    into v_org, v_kind, v_cleared
    from memory_obligations
   where id = p_obligation_id
   for update;

  if v_org is null then
    raise exception 'clear_memory_obligation: no such obligation %', p_obligation_id;
  end if;
  if not (public.is_member_of_org(v_org) or auth.uid() is null) then
    raise exception 'clear_memory_obligation: not a member of %', v_org;
  end if;
  if v_cleared is not null then
    return false;
  end if;

  update memory_obligations
     set cleared_at = now(), cleared_by = auth.uid()
   where id = p_obligation_id;

  insert into memory_events
    (organization_id, actor_id, event_type, subject_type, subject_id,
     source_type, source_id, provenance, payload, dedupe_key)
  values
    (v_org, auth.uid(), 'obligation.cleared', 'obligation', p_obligation_id,
     'memory_obligations', p_obligation_id, p_provenance,
     jsonb_build_object('kind', v_kind),
     'obligation.cleared:' || p_obligation_id::text);

  return true;
end;
$$;

revoke all on function public.raise_memory_obligation(uuid, text, text, uuid, uuid, timestamptz, text, uuid, text) from public, anon;
revoke all on function public.clear_memory_obligation(uuid, text) from public, anon;
grant execute on function public.raise_memory_obligation(uuid, text, text, uuid, uuid, timestamptz, text, uuid, text) to authenticated, service_role;
grant execute on function public.clear_memory_obligation(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Narrow the grants Supabase hands out by default
-- ---------------------------------------------------------------------------
--
-- Supabase's default privileges grant ALL on new public tables to
-- `authenticated`, so revoking from `public, anon` above left update, delete
-- and truncate in place. RLS already denied them -- there is no permissive
-- UPDATE or DELETE policy -- but "append-only" should be true at the grant
-- level too, not only one layer deep. A permissive policy added by mistake
-- later would otherwise silently unlock rewriting the log.
revoke all on public.memory_events      from authenticated;
revoke all on public.memory_obligations from authenticated;
grant select, insert on public.memory_events      to authenticated;
grant select         on public.memory_obligations to authenticated;
