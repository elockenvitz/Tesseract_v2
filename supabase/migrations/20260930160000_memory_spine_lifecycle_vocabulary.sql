-- Memory Spine — Slice 1: lifecycle vocabulary
--
-- Four lifecycle moments currently leave no durable trail: a recommendation
-- reaching a PM, a PM resolving it, that resolution being undone, and a trade
-- becoming canonical. This admits the vocabulary for them.
--
-- This migration changes NOTHING except the event_type CHECK. No new columns,
-- no new tables, no new indexes, no policy changes. The foundation already
-- provides everything these events need:
--
--   * dedupe_key + memory_events_dedupe_uk  -> idempotency
--   * source_type/source_id                 -> provenance back to canonical rows
--   * related jsonb                         -> navigation between entities
--   * insert-only RLS, no UPDATE, no DELETE -> append-only, unchanged
--
-- RLS posture: UNCHANGED. memory_events keeps exactly its existing policy —
-- insert where is_member_of_org(organization_id) and actor_id = auth.uid(),
-- select for org members, and no UPDATE or DELETE policy for any client role.
-- Four new event types do not widen who can write or what they can write as.
-- Nothing here grants anything.
--
-- subject_type is NOT extended: all four events use subject kinds the existing
-- CHECK already permits (idea, decision, trade).

alter table public.memory_events
  drop constraint if exists memory_events_type_ck;

alter table public.memory_events
  add constraint memory_events_type_ck check (
    event_type in (
      -- existing, unchanged
      'thesis.reviewed',
      'decision.reviewed',
      'obligation.raised',
      'obligation.cleared',
      'rationale.captured',
      -- slice 1: canonical lifecycle
      'recommendation.submitted',
      'decision.recorded',
      'decision.reverted',
      'execution.recorded'
    )
  );

-- One event type carries the outcome as payload->>'status' rather than four
-- sibling types (decision.accepted / .rejected / .deferred / ...). The status
-- is a property of the decision, not a different kind of happening, and
-- decision_requests.status is already its canonical vocabulary; mirroring that
-- list into the type namespace would mean two places to change when a fifth
-- status appears, and a CHECK here that silently drifts from the one there.
comment on constraint memory_events_type_ck on public.memory_events is
  'Event vocabulary. decision.recorded carries the outcome in payload->>''status'' (accepted, accepted_with_modification, rejected, deferred) rather than splitting into one type per status.';
