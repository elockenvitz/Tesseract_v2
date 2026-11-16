-- Remove `anon` from the trade-event rationale tables.
--
-- ── What this is, and what it is NOT ─────────────────────────────────────
--
-- This is a privilege-posture correction, not a vulnerability fix. There is
-- no effective anonymous-access path today, and that was established by
-- measurement rather than by reading the policies.
--
-- Measured against production 2026-11-15, from a connection carrying no JWT
-- (so `auth.uid()` is NULL, exactly as it is for `anon`):
--
--   auth.uid() is null                    -> true
--   current_org_id()                      -> NULL
--   is_active_org_admin_of_current_org()  -> false
--   user_is_portfolio_member(p.id, NULL)  -> false for ALL 37 portfolios
--   the full portfolio_trade_events
--     predicate, over all 37 portfolios   -> false
--
-- So both tables' policies already refuse an unauthenticated caller on every
-- verb, for every portfolio in production. Both tables also hold 0 rows.
--
-- What IS wrong is the privilege layer beneath the policies. Both tables
-- grant `anon` SELECT, INSERT, UPDATE and DELETE, and all eight policies are
-- declared `TO PUBLIC` (`polroles = '-'`), which includes `anon`. The denial
-- therefore rests entirely on the predicates evaluating false. That is one
-- layer where this codebase's standard is two: `memory_events`,
-- `memory_obligations` and `trade_proposal_versions` all grant `anon`
-- nothing, and that is the posture this restores.
--
-- Why it matters despite there being no exploit: a predicate is a runtime
-- evaluation and a grant is a static boundary. A future policy edit, a new
-- helper that returns true too eagerly, or a disjunct added for an admin case
-- would turn a posture problem into a real one with nothing underneath to
-- stop it. `anon` has no legitimate business with either table.
--
-- ── Order matters ────────────────────────────────────────────────────────
--
-- The policy role change is the fix; the REVOKE is defence in depth. Both
-- are applied, because either alone leaves a layer wrong:
--   * REVOKE alone leaves policies that would admit `anon` the moment a
--     grant reappeared (and Supabase re-grants liberally on new objects).
--   * TO authenticated alone leaves a grant that does nothing today but is
--     the wrong statement of intent.
--
-- ── NOT APPLIED ──────────────────────────────────────────────────────────
--
-- Authored, reviewed, and deliberately not applied. There is no staging
-- database (free plan, account-wide token), and production is not a
-- substitute. See docs/production-database-access.md.
--
-- Rollback: supabase/migrations/20261115210000_trade_event_rationales_anon_revoke.rollback.sql

begin;

-- ── portfolio_trade_events ───────────────────────────────────────────────

alter policy trade_events_select on public.portfolio_trade_events to authenticated;
alter policy trade_events_insert on public.portfolio_trade_events to authenticated;
alter policy trade_events_update on public.portfolio_trade_events to authenticated;
alter policy trade_events_delete on public.portfolio_trade_events to authenticated;

revoke all on public.portfolio_trade_events from anon;

-- ── trade_event_rationales ───────────────────────────────────────────────

alter policy rationales_select on public.trade_event_rationales to authenticated;
alter policy rationales_insert on public.trade_event_rationales to authenticated;
alter policy rationales_update on public.trade_event_rationales to authenticated;
alter policy rationales_delete on public.trade_event_rationales to authenticated;

revoke all on public.trade_event_rationales from anon;

-- `authenticated` keeps all four verbs on both tables; nothing a signed-in
-- member can do today changes. The policy predicates are untouched — this
-- migration changes WHO the policies apply to, never WHAT they permit.

-- ── Assertions, so a partial apply fails loudly rather than silently ─────

do $$
begin
  if has_table_privilege('anon', 'public.portfolio_trade_events', 'SELECT')
     or has_table_privilege('anon', 'public.trade_event_rationales', 'SELECT') then
    raise exception 'anon still holds SELECT after the revoke';
  end if;

  if exists (
    select 1 from pg_policy
    where polrelid in ('public.portfolio_trade_events'::regclass,
                       'public.trade_event_rationales'::regclass)
      and polroles = '{0}'   -- '{0}' is PUBLIC
  ) then
    raise exception 'a policy on these tables is still declared TO PUBLIC';
  end if;

  if not has_table_privilege('authenticated', 'public.trade_event_rationales', 'SELECT') then
    raise exception 'authenticated lost SELECT, which it must keep';
  end if;
end $$;

commit;
