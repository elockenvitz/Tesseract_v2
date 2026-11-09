-- Drop theme_discussions: a feature with no content and no way in.
--
-- The Theme page's Discussion tab was removed in b5a6b7cf when six peer
-- sections became three modes. The table was left on disk deliberately,
-- because deleting data is a separate decision from deleting a nav button.
-- This is that decision.
--
-- ── Measured in production before writing this ─────────────────────────────
--
--   theme_discussions                               0 rows
--   theme_activity WHERE activity_type =
--     'theme.discussion_posted'                     0 rows
--   inbound foreign keys referencing it             none
--   policies                                        4
--   triggers                                        2, both serving only
--                                                   this table
--
-- So nothing is lost and nothing else breaks. The two trigger functions go
-- with it: `pg_trigger` confirms neither is attached to any other relation,
-- and leaving a trigger function behind with no table is how a later reader
-- concludes the feature still exists.
--
-- `theme.discussion_posted` stays a member of the theme_activity
-- activity_type column's accepted values. Nothing will write it again, and
-- narrowing a column that an application still reads, to remove a value it
-- has zero rows of, buys nothing and can only fail.
--
-- ── Reversing this ─────────────────────────────────────────────────────────
--
-- The DOWN beside this file recreates the table, its indexes, its RLS and
-- both triggers exactly as production had them, captured from pg_policies
-- and information_schema rather than from an older migration, because
-- migrations in this repo do not describe production. It cannot bring rows
-- back; there were none.

begin;

drop trigger if exists trg_theme_activity_discussion_post on public.theme_discussions;
drop trigger if exists trg_theme_discussions_touch on public.theme_discussions;

drop table if exists public.theme_discussions;

-- After the table is gone these are unreachable. Dropped second so that a
-- partial run cannot leave a trigger pointing at a missing function.
drop function if exists public.theme_activity_log_discussion_post();
drop function if exists public.theme_discussions_touch();

commit;
