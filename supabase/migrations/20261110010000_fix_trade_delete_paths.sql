-- =============================================================================
-- Two client delete paths that could never succeed
--
-- THE DEFECTS
--
--   Both tables have RLS enabled and policies for SELECT / INSERT / UPDATE, and
--   no policy for DELETE at all. RLS denies what no policy admits, so the delete
--   is refused; neither call site checks the error, so the failure is silent.
--
--   1. public.trade_sheets -- ONBOARDING CANNOT REMOVE A PORTFOLIO
--
--      ClientOnboardingWizard's "remove this portfolio" clears the four tables
--      can_discard_portfolio() treats as blockers, then calls discard_portfolio().
--      trade_sheets is one of the four (confirmed: the function body references
--      it), so for any portfolio that has a trade sheet the delete is refused,
--      the blocker survives, discard_portfolio() returns
--      { discarded: false, blockers: [...] }, and the portfolio stays in the
--      wizard. There is no in-app way out. This is on the pilot-onboarding path.
--
--   2. public.trade_batches -- EMPTY BATCHES POLLUTE THE TRADE BOOK
--
--      execute-sim-variants-service deletes the batch when every trade in it
--      failed to commit, "so it doesn't pollute the Trade Book history". That
--      delete has always been refused. Measured in production: 4 of 24 batches
--      have no accepted_trades rows -- precisely the pollution the code was
--      written to prevent.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
--   A DELETE policy on each, with the SAME predicate as the table's existing
--   SELECT policy. Nothing becomes visible or writable that was not already;
--   the only new capability is deleting a row the caller can already read and
--   update.
--
--   trade_batches gets one extra condition: the batch must be EMPTY. Deleting a
--   batch that holds committed trades would not destroy them -- the FK is
--   accepted_trades.batch_id ON DELETE SET NULL -- but it would silently detach
--   them from the grouped approval they were committed under, and grouped
--   approval is the batch's whole reason to exist. The one legitimate caller
--   only ever deletes an empty batch, so the policy says exactly that.
--
--   WHY THE EMPTINESS TEST NEEDS A SECURITY DEFINER HELPER, not an inline
--   EXISTS: a subquery inside a policy is evaluated under the CALLER's RLS on
--   the relation it reads. accepted_trades is visible only when
--   `portfolio_in_current_org(portfolio_id) AND (member OR org admin)`, while
--   portfolio membership itself carries no org condition. So a user who is a
--   member of a portfolio in org A but whose current organization is org B
--   passes the batch policy's member branch and CANNOT SEE that portfolio's
--   accepted_trades. An inline `NOT EXISTS` would read as TRUE for them and let
--   them delete a non-empty batch. The definer helper evaluates the same
--   question with RLS out of the way. Assertion 7 of the suite is that exact
--   user.
--
-- RLS POSTURE: this WIDENS access -- deliberately, and stated plainly. Each
-- table gains a DELETE policy where it had none. Both new policies are
-- `TO authenticated` (the pre-existing ones on these tables are `TO public`),
-- scoped to the same predicate as the table's own SELECT, and trade_batches is
-- additionally restricted to empty batches. No existing policy is loosened, no
-- grant is added, no data is modified.
--
-- Verification: supabase/tests/trade-delete-paths.sql -- 7 assertions covering
-- same-org allow, cross-org denial, same-org non-member denial, the non-empty
-- batch guard, and the transitive-RLS case above.
--
-- Rollback: 20261110010000_fix_trade_delete_paths.rollback.sql
-- =============================================================================

begin;

-- ── the emptiness oracle ────────────────────────────────────────────────────
-- STABLE SECURITY DEFINER so the test is not re-filtered by the caller's RLS on
-- accepted_trades. search_path is pinned; see the header for why inline EXISTS
-- is unsafe here.
create or replace function public.trade_batch_is_empty(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not exists (
    select 1 from accepted_trades t where t.batch_id = p_batch_id
  );
$$;

-- Every function created in `public` is born executable by anon, and REVOKE
-- FROM PUBLIC does not remove the role-level grant, so both revokes are needed.
revoke all on function public.trade_batch_is_empty(uuid) from public;
revoke all on function public.trade_batch_is_empty(uuid) from anon;
grant execute on function public.trade_batch_is_empty(uuid) to authenticated;

-- ── trade_sheets ────────────────────────────────────────────────────────────
-- Mirrors trade_sheets_select / _insert / _update exactly.
drop policy if exists "trade_sheets_delete" on public.trade_sheets;
create policy "trade_sheets_delete"
  on public.trade_sheets
  for delete
  to authenticated
  using (user_is_portfolio_member(portfolio_id));

-- ── trade_batches ───────────────────────────────────────────────────────────
-- Mirrors "Trade batches: members or org admins view", plus the empty-only guard.
drop policy if exists "trade_batches_delete_empty_only" on public.trade_batches;
create policy "trade_batches_delete_empty_only"
  on public.trade_batches
  for delete
  to authenticated
  using (
    (
      user_is_portfolio_member(portfolio_id)
      or (portfolio_in_current_org(portfolio_id) and is_active_org_admin_of_current_org())
    )
    and public.trade_batch_is_empty(id)
  );

commit;
