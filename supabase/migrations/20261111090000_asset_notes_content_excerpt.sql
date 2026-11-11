-- A server-side excerpt for asset_notes, so a reader of note METADATA does not
-- have to transfer the whole body.
--
-- ── Why ──────────────────────────────────────────────────────────────────
--
-- `ai-chat`'s research tools list notes and print a short excerpt of each.
-- They selected `content` in full and truncated in JavaScript. One live note
-- (`0b23a36d-...`, "The new iPhone looks like trash") holds 2,020,708
-- characters, it belongs to the account that uses AI, and it is recent -- so
-- it landed in the top 5 of every AAPL lookup. Each lookup moved ~2 MB across
-- the wire to render 400 characters, inside a request a user is waiting on.
--
-- PostgREST does not allow an expression in `select`, so `substr(content,1,N)`
-- is not available to the client. A COMPUTED COLUMN is: a function whose only
-- argument is the table's own row type is exposed by PostgREST as a
-- selectable column on that table, evaluated per row it returns.
--
-- ── RLS posture ──────────────────────────────────────────────────────────
--
-- This widens NOTHING, and that is a property of when it runs, not of a
-- policy. A computed column is evaluated on rows the query already produced,
-- which are the rows `asset_notes`' existing RLS policies allowed. It adds no
-- policy, no grant on the table, and no new path to a row: a caller who
-- cannot select a note cannot select its excerpt either. `asset_notes` keeps
-- its 5 existing policies, untouched.
--
-- It is STABLE and PARALLEL SAFE, and deliberately NOT security definer --
-- it must run as the caller so it cannot become a way around the policies
-- that filter the rows feeding it.
--
-- Grants follow the standing rule rather than Supabase's default: every
-- function in `public` is created executable by PUBLIC (and therefore by
-- `anon`), and REVOKE FROM PUBLIC does not remove a grant held by the role
-- itself, so both revokes are required. `anon` has no business reading note
-- bodies in any length.

begin;

create or replace function public.content_excerpt(note public.asset_notes)
returns text
language sql
stable
parallel safe
set search_path to 'public'
as $$
  select left(coalesce(note.content, ''), 400);
$$;

comment on function public.content_excerpt(public.asset_notes) is
  'PostgREST computed column: first 400 chars of asset_notes.content, so note lists do not transfer whole bodies. Evaluated per row AFTER RLS filtering; grants no new access.';

revoke all on function public.content_excerpt(public.asset_notes) from public;
revoke all on function public.content_excerpt(public.asset_notes) from anon;
grant execute on function public.content_excerpt(public.asset_notes) to authenticated;
grant execute on function public.content_excerpt(public.asset_notes) to service_role;

commit;
