-- =============================================================================
-- portfolio_trade_events / trade_event_rationales — anonymous access denial
--
-- WHAT THIS IS FOR
--
-- Both tables grant `anon` SELECT, INSERT, UPDATE and DELETE, and all eight
-- of their policies are declared `TO PUBLIC` (`polroles = '{0}'`), which
-- includes `anon`. So nothing in the privilege layer stops an unauthenticated
-- caller; the denial rests entirely on the policy predicates evaluating
-- false.
--
-- `npm run guard:policies` passes on both tables and is right to: the
-- predicates call `user_is_portfolio_member()`, which it recognises as an
-- auth helper. But that gate says so itself —
--
--   "STATIC ONLY ... does not establish effective authorization — a
--    caller-free branch joining another table, a SECURITY DEFINER read path,
--    and an unsound auth helper all pass this gate. Cross-org and anon
--    denial are proven only by the role-context suites in supabase/tests/."
--
-- This is that suite.
--
-- ── PART A: measured, read-only, no fixtures. EXECUTED 2026-11-15. ───────
--
-- Part A needs no fixtures and no transaction, because the MCP connection
-- carries no JWT — so `auth.uid()` is already NULL there, exactly as it is
-- for `anon`. The full predicate can be evaluated as an unauthenticated
-- caller would see it, by reading only.
--
-- Executed against production 2026-11-15. Results:
--
--   auth.uid() is null                              -> true
--   current_org_id()                                -> NULL
--   is_active_org_admin_of_current_org()            -> false
--   portfolio_in_current_org(p.id), any of 37       -> false
--   user_is_portfolio_member(p.id, NULL), any of 37 -> false
--   the FULL portfolio_trade_events predicate,
--     over all 37 production portfolios             -> false
--
-- CONCLUSION: there is no effective anonymous-access path today. Both
-- tables also hold 0 rows. This is a privilege-POSTURE gap, not an exposure.
--
-- Part A is the half that can be re-run at any time, by anyone, against a
-- read-only connection. Run it first; if any of it comes back true, stop.

select 'auth_uid_is_null' as assertion, (auth.uid() is null)::text as observed, 'true' as expected
union all
select 'current_org_id_is_null', (public.current_org_id() is null)::text, 'true'
union all
select 'org_admin_false', coalesce(public.is_active_org_admin_of_current_org()::text,'null'), 'false'
union all
select 'no_portfolio_membership_for_anon',
       coalesce(bool_or(public.user_is_portfolio_member(p.id, null))::text,'null'), 'false'
from public.portfolios p
union all
select 'full_pte_predicate_false_for_anon',
       coalesce(bool_or(public.user_is_portfolio_member(p.id)
         or (public.portfolio_in_current_org(p.id)
             and public.is_active_org_admin_of_current_org()))::text,'null'), 'false'
from public.portfolios p;

-- ── PART B: behavioural role-context denial. NOT EXECUTED. ──────────────
--
-- Part B needs two real users, an organization, a portfolio, a membership and
-- a trade event, so it needs a write transaction. It is NOT executed here.
--
-- BLOCKER, precisely: there is no staging database. The Supabase plan is free
-- tier and the only credential available is an account-wide access token, so
-- a staging project cannot be provisioned or isolated. Production is not a
-- substitute — and the governing instruction for this pass is read-only
-- production metadata with no production modification, which a BEGIN … ROLLBACK
-- fixture suite does not satisfy even though nothing commits.
--
-- To execute, set SECURITY_SUPABASE_REF and SECURITY_SUPABASE_TOKEN against a
-- NON-PRODUCTION project and run:
--
--   node scripts/security-suite.mjs trade-event-rationales-anon-denial
--
-- Wrap the whole of Part B in BEGIN … ROLLBACK. Nothing may commit: 196
-- unindexed foreign keys make deleting a test user take about 75 seconds, so
-- a rolled-back transaction is both safer and far faster than teardown.
--
-- The assertions, in the order they should run:
--
--   B1  as `anon`: SELECT from trade_event_rationales returns 0 rows, even
--       though a rationale row exists for a portfolio the fixture member can
--       see. Proves the SELECT policy, not the empty table — so B1 is only
--       meaningful with the fixture row present.
--   B2  as `anon`: INSERT into trade_event_rationales is refused. Expect a
--       WITH CHECK violation, not a privilege error, pre-migration; after
--       20261115210000 expect 42501 instead, and BOTH are passes. The test
--       must assert "refused", never a specific SQLSTATE, or the migration
--       itself breaks it.
--   B3  as `anon`: UPDATE and DELETE each affect 0 rows.
--   B4  as the fixture MEMBER (authenticated): SELECT returns exactly the
--       one row, INSERT succeeds, UPDATE affects 1. This is the assertion
--       that stops the suite passing by denying everyone — a denial-only
--       suite reads green on a dead end.
--   B5  as an authenticated NON-member in another organization: 0 rows, and
--       INSERT refused. Cross-org, distinct from anon.
--   B6  as a REMOVED member (membership deleted inside the transaction):
--       0 rows. Standing Rule 5 requires removed-member denial explicitly,
--       because a stale membership row is the common failure.
--
--   Non-vacuity for B1–B3 and B5–B6: widen the four SELECT/INSERT policies
--   to USING (true) / WITH CHECK (true) inside the same transaction and
--   confirm each flips to a failure. That is the real failure shape — a
--   policy loosened by a later migration — and it must be shown, not
--   assumed.
--
-- ── PART C: posture, AFTER 20261115210000 is applied. NOT YET TRUE. ─────
--
-- These assert the end state the migration creates. They FAIL against
-- production today, which is correct and is why they are documented here
-- rather than wired into a passing gate. Measured today: 8 policies TO
-- PUBLIC, anon holds SELECT on both tables.
--
--   C1  has_table_privilege('anon', 'public.portfolio_trade_events', 'SELECT')
--         -> false          (today: true)
--   C2  has_table_privilege('anon', 'public.trade_event_rationales', 'SELECT')
--         -> false          (today: true)
--   C3  count of policies on the two tables with polroles = '{0}'::oid[]
--         -> 0              (today: 8)
--   C4  has_table_privilege('authenticated', 'public.trade_event_rationales',
--         'SELECT') -> true (today: true — must not change)
--
-- The same four are asserted inside the migration's own DO block, so a
-- partial apply raises rather than silently half-landing. All four were
-- confirmed to report today's pre-migration state correctly, which is what
-- makes them non-vacuous rather than decorative.
