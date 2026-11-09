-- has_unread_direct_messages(): one round trip for the header's unread badge.
--
-- ── What this replaces ────────────────────────────────────────────────────
--
-- `Header.tsx` maintained a single boolean badge by fetching the caller's rows
-- from `conversation_participants` and then issuing one `count` query per
-- conversation inside a `for` loop. Measured over the 169 days of current
-- statistics, to 2026-11-06 02:40:56Z:
--
--   conversation_messages count   1,308,978 calls   2,464.20 s
--   conversation_participants       245,884 calls      68.07 s
--
-- 1,554,862 queries and 42 minutes of database time, against a table holding
-- 123 rows. The ratio, 5.32 count queries per participant query, is the loop.
--
-- ── Why this is SECURITY INVOKER ──────────────────────────────────────────
--
-- Deliberately not DEFINER. The caller's own RLS stays in force on both
-- tables, so this function cannot read a row the caller could not already
-- read through PostgREST. It returns one boolean derived from those rows and
-- exposes nothing else. The `cp.user_id = auth.uid()` predicate is kept even
-- though RLS also constrains the read, because the existing client query has
-- it and this must not be broader: the SELECT policy on
-- `conversation_participants` is wider than "my own rows" (it also admits any
-- participant row of a non-group conversation), so relying on RLS alone here
-- would widen what feeds the badge.
--
-- ── Equivalence with the client logic it replaces ─────────────────────────
--
-- The loop it replaces was, per conversation:
--
--   .eq('conversation_id', conv.conversation_id)
--   .neq('user_id', user.id)
--   .gt('created_at', conv.last_read_at || '1970-01-01')
--
-- matched clause for clause below.
--
--   * `<>` not `IS DISTINCT FROM`. `conversation_messages.user_id` is
--     nullable. PostgREST's `.neq()` emits `user_id <> $1`, which is NULL for
--     a NULL author and therefore excludes that row. `IS DISTINCT FROM` would
--     return true and start counting authorless rows as unread. That is a
--     behaviour change, so it is not used.
--   * The 1970 epoch, not `-infinity`, because `|| '1970-01-01'` is what the
--     client sent. `-infinity` would be marginally safer (it could never hide
--     an unread message dated before 1970) but it is not what this replaces,
--     and there are no such rows.
--   * A NULL `created_at` is excluded either way: `NULL > x` is NULL.
--
-- `EXISTS` short-circuits on the first unread message, which is what the
-- loop's early `return true` did.
--
-- ── Privileges ────────────────────────────────────────────────────────────
--
-- Postgres grants EXECUTE to PUBLIC on a new function, so that is revoked
-- before `authenticated` is granted. `anon` is therefore not granted. Even if
-- it were, `auth.uid()` is NULL for an anonymous caller, so
-- `cp.user_id = NULL` matches nothing and the answer is false.
--
-- `search_path` is pinned empty and every object is schema-qualified.

create or replace function public.has_unread_direct_messages()
returns boolean
language sql
stable
security invoker
set search_path to ''
as $function$
  select exists (
    select 1
    from public.conversation_participants cp
    join public.conversation_messages cm
      on cm.conversation_id = cp.conversation_id
    where cp.user_id = auth.uid()
      and cm.user_id <> auth.uid()
      and cm.created_at > coalesce(cp.last_read_at, '1970-01-01T00:00:00Z'::timestamptz)
  );
$function$;

comment on function public.has_unread_direct_messages() is
  'True when the calling user has any direct message from someone else newer than their last_read_at. SECURITY INVOKER: the caller''s RLS on conversation_participants and conversation_messages applies. Replaces a 1+N client loop in Header.tsx.';

revoke all on function public.has_unread_direct_messages() from public;
grant execute on function public.has_unread_direct_messages() to authenticated;
