-- Close the default-privilege grants on the table 20261104140000 created.
--
-- ── Why a separate migration ──────────────────────────────────────────────
--
-- 20261104140000 is already applied to production. This is the follow-up that
-- the measurement immediately after it applied made necessary, kept separate
-- so the history shows what was wrong rather than quietly rewriting a file
-- that already ran.
--
-- ── The defect ────────────────────────────────────────────────────────────
--
-- Supabase sets ALTER DEFAULT PRIVILEGES so that every table created in
-- `public` is born holding the FULL privilege set for both `anon` and
-- `authenticated`. 20261104140000 ends with
--
--     grant select, insert, delete on public.theme_contribution_visibility_targets
--       to authenticated, tesseract_audience_writer;
--
-- which reads like a complete statement of who can do what and is purely
-- additive. Measured on production immediately after it applied, 2026-11-09:
--
--   anon           DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--   authenticated  DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--
-- Two separate problems, and the second is the worse one.
--
-- 1. `anon` held grants at all, which Standing Rule 5 forbids outright. No row
--    was actually reachable: RLS is enabled on the table and every policy is
--    TO authenticated or TO tesseract_audience_writer, so an anonymous caller
--    matches no policy and selects nothing. But an anon grant on an org-owned
--    table is not something to leave standing on the strength of RLS alone,
--    and the sibling migration revokes anon on `theme_contributions_v2` BY
--    NAME -- it simply could not know this table would need the same.
--
-- 2. TRUNCATE on `authenticated`. **TRUNCATE is not subject to row-level
--    security.** A policy set that correctly scopes every row to its own
--    organization does nothing to stop a caller who can empty the table and
--    remove every org's audience assignments in one statement. REFERENCES and
--    TRIGGER are likewise outside RLS. This is the part that a review of the
--    policies alone would never catch, because the policies are correct.
--
-- ── What is left ──────────────────────────────────────────────────────────
--
-- Exactly what the feature needs. No UPDATE for authenticated: an audience
-- change is delete-then-insert, and the absence of an UPDATE policy is
-- deliberate, so the grant should not imply otherwise.
revoke all on public.theme_contribution_visibility_targets from anon;

revoke all on public.theme_contribution_visibility_targets from authenticated;
grant select, insert, delete on public.theme_contribution_visibility_targets to authenticated;

-- The parent table: 20261104140000 revoked anon here by name and that worked,
-- but it re-granted only the four DML verbs and never removed the three
-- non-RLS-governed privileges the default grant had already given
-- `authenticated`.
revoke truncate, trigger, references on public.theme_contributions_v2 from authenticated;

-- Verify after running:
--   select grantee, string_agg(privilege_type, ',' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('theme_contribution_visibility_targets',
--                         'theme_contributions_v2')
--      and grantee in ('anon','authenticated','tesseract_audience_writer')
--    group by grantee;
--
--   expect NO anon row at all;
--   targets            authenticated = DELETE,INSERT,SELECT
--   theme_contributions_v2 authenticated = DELETE,INSERT,SELECT,UPDATE
