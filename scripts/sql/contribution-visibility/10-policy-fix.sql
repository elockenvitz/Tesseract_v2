-- ============================================================================
-- contribution-visibility / 10 — POLICY CORRECTION  ***DO NOT APPLY***
--
-- Prepared, unapplied, deliberately outside supabase/migrations/ so a deploy
-- cannot pick it up. Run 00-verify-readonly.sql first: Q1 proves production's
-- policies match the ones this file replaces, and Q6 says who loses access.
--
-- This lane is INDEPENDENT of the content_updated_at freshness lane
-- (scripts/sql/contribution-freshness/). It shares no object with it, and
-- neither needs the other applied.
--
-- ── What is wrong ───────────────────────────────────────────────────────────
--
-- V1  asset_contribution_history_select (C1/07) checks ONLY that the parent
--     contribution is in the caller's organization. It does not consult the
--     contribution's visibility. `new_content` holds the thesis prose, so
--     EVERY member of the org can read EVERY restricted contribution's text.
--     Unconditional — no team_id state required.
--
-- V2  asset_contributions_select (C1/08) grants on `OR team_id IS NULL`.
--     `team_id` is a legacy single-target denormalisation that the client sets
--     to NULL whenever the target count is not exactly 1
--     (useContributions.ts:193, :237, :528). So a contribution narrowed to two
--     teams, or to none, is readable org-wide. Conditional, and the condition
--     is produced by ordinary product use.
--
-- V3  asset_revision_events_select (C1/06) is organization-scoped only.
--     `before_value`/`after_value` hold the prose, written by publishDraft.
--     Unconditional, like V1.
--
-- ── The correction ──────────────────────────────────────────────────────────
--
-- One predicate — "may this caller read this contribution" — defined once and
-- used by all three policies, so the history and revision tables DERIVE
-- visibility from the contribution instead of re-implementing it. The
-- `team_id IS NULL` grant is deleted. Nothing else about the policies changes:
-- owner access, firm access, and the existing target mechanism are preserved
-- exactly.
--
-- Access semantics, stated explicitly because the current policy never did:
--
--   owner       created_by = auth.uid()  → always, at any visibility
--   firm        every active member of the organization
--   portfolio / team / department / division
--               members of the targeted node(s); several targets are a UNION,
--               which the per-target EXISTS already expresses
--   no targets  a non-firm contribution that names nobody cannot be satisfied
--               → owner-only. Fail closed. This is the direction C1/08 chose
--               for unresolved tenancy and the direction quick_thoughts chose
--               for a NULL node (20260827090400:126): a missing target denies,
--               it does not share.
--
-- NOT CHANGED, and NOT DECIDED HERE: whether a department/division target
-- should cascade to descendant nodes. 00- Q8/Q8b/Q9 answer whether that is
-- even a live case. If targeted nodes have no direct members, this file makes
-- those contributions owner-only and the cascade must be designed FIRST.
-- ============================================================================

BEGIN;

-- ── 1. The predicate ───────────────────────────────────────────────────────
--
-- SECURITY DEFINER, and that needs justifying: it is the difference between a
-- policy that fails closed on a schema change and one that fails OPEN or goes
-- dark. The helper tables (contribution_visibility_targets,
-- org_chart_node_members) carry their own RLS. Inlined, a future narrowing of
-- org_chart_node_members would make this EXISTS silently false and HIDE
-- legitimate research from the teams it was shared with — a failure nobody
-- would report as a security bug.
--
-- The escalation is bounded by construction: the function takes an id, answers
-- a boolean about auth.uid() ONLY, returns no row data, pins its search_path,
-- and is granted to `authenticated` alone. It cannot be used to read anything.
CREATE OR REPLACE FUNCTION public.can_read_asset_contribution(p_contribution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.asset_contributions c
    WHERE c.id = p_contribution_id
      -- Tenancy first, and with no NULL escape: C1/08 closed that hatch and
      -- this must not reopen it.
      AND c.organization_id = public.current_org_id()
      AND public.is_active_member_of_current_org()
      AND (
            -- the author, always
            c.created_by = auth.uid()
            -- shared with the whole firm
            OR c.visibility = 'firm'
            -- shared with specific org-chart nodes the caller belongs to.
            -- Several targets are a union; zero targets match nothing, which
            -- is the fail-closed case.
            OR EXISTS (
                 SELECT 1
                 FROM public.contribution_visibility_targets cvt
                 JOIN public.org_chart_node_members ocnm
                   ON ocnm.node_id = cvt.node_id
                  AND ocnm.user_id = auth.uid()
                 JOIN public.org_chart_nodes ocn
                   ON ocn.id = cvt.node_id
                  AND ocn.organization_id = c.organization_id
                WHERE cvt.contribution_id = c.id
               )
          )
  );
$$;

COMMENT ON FUNCTION public.can_read_asset_contribution(uuid) IS
  'May the current caller read this contribution? Owner, firm, or a member of '
  'a targeted org-chart node. A non-firm contribution with no targets is '
  'owner-only — a missing target denies, it does not share. SECURITY DEFINER '
  'so a narrowing of the helper tables cannot silently hide legitimate '
  'research; answers a boolean about auth.uid() only and returns no row data.';

REVOKE ALL ON FUNCTION public.can_read_asset_contribution(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_asset_contribution(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_read_asset_contribution(uuid) TO authenticated;

-- ── 2. V2 — asset_contributions ────────────────────────────────────────────
-- Replaces C1/08:70-81. The ONLY change is that `OR team_id IS NULL` is gone
-- and the node check also confirms the node belongs to the same organization.
DROP POLICY IF EXISTS asset_contributions_select ON public.asset_contributions;
CREATE POLICY asset_contributions_select ON public.asset_contributions
  FOR SELECT TO authenticated
  USING (public.is_active_member_of_current_org()
         AND organization_id = public.current_org_id()
         AND (created_by = auth.uid()
              OR visibility = 'firm'
              OR EXISTS (SELECT 1
                           FROM public.contribution_visibility_targets cvt
                           JOIN public.org_chart_node_members ocnm
                             ON ocnm.node_id = cvt.node_id
                            AND ocnm.user_id = auth.uid()
                           JOIN public.org_chart_nodes ocn
                             ON ocn.id = cvt.node_id
                            AND ocn.organization_id = asset_contributions.organization_id
                          WHERE cvt.contribution_id = asset_contributions.id)));

-- The INSERT/UPDATE/DELETE policies from C1/08 are correct (author-only,
-- org-pinned) and are deliberately NOT touched.

-- ── 3. V1 — asset_contribution_history ─────────────────────────────────────
-- Replaces C1/07:32-36. History now inherits the contribution's visibility
-- instead of being readable by the whole organization.
DROP POLICY IF EXISTS asset_contribution_history_select ON public.asset_contribution_history;
CREATE POLICY asset_contribution_history_select ON public.asset_contribution_history
  FOR SELECT TO authenticated
  USING (public.can_read_asset_contribution(contribution_id));

-- ── 4. V3 — asset_revision_events ──────────────────────────────────────────
--
-- Harder than V1, and the difference is worth stating. A revision event is
-- keyed by (asset_id, field_key), NOT by contribution_id, so it cannot simply
-- inherit one row's visibility. `field_key` is the section and several authors
-- can hold the same section, so an event's prose may match a restricted
-- contribution the caller cannot read.
--
-- The rule applied: the caller may read a revision event if they are its actor,
-- or if NO contribution in that (asset, section) is hidden from them. If any
-- matching contribution is restricted and unreadable, the event is withheld.
-- That is deliberately conservative — it can hide an event whose prose came
-- from a firm-visible contribution that happens to share a section with a
-- restricted one. Withholding a visible author's event is recoverable; leaking
-- a restricted author's prose is not.
DROP POLICY IF EXISTS asset_revision_events_select ON public.asset_revision_events;
CREATE POLICY asset_revision_events_select ON public.asset_revision_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.asset_revisions r
             WHERE r.id = asset_revision_events.revision_id
               AND (r.actor_user_id = auth.uid()
                    OR (r.organization_id = public.current_org_id()
                        AND public.is_active_member_of_current_org()
                        AND NOT EXISTS (
                              SELECT 1
                              FROM public.asset_contributions c
                              WHERE c.asset_id = r.asset_id
                                AND c.section  = asset_revision_events.field_key
                                AND NOT public.can_read_asset_contribution(c.id)))))
  );

-- asset_revisions itself carries no prose (actor, asset, timestamp, note), so
-- C1/06's policy on it is left alone. If `review_note` is later found to carry
-- analyst text, it needs the same treatment — 00- Q1 shows its columns.

COMMIT;

-- ============================================================================
-- NON-VACUITY — the gate must be shown observing its own failure mode.
--
-- supabase/tests/contribution-visibility-security.sql is the real test: 10
-- assertions against the live `authenticated` role with real jwt claims.
-- Against an UNFIXED database it must report assertions 3, 4, 6 and 8
-- FAILING — one per defect, V2 twice (the two team_id-NULL shapes), V1 and V3
-- once each. If it passes before this file is applied, the test is decoration
-- and must not be trusted.
--
-- Assertions 2, 5, 7, 9 and 10 must pass in BOTH states: they are the
-- preserve-legitimate-access controls, and a fix that breaks one is too tight.
--
--   psql "$DB_URL" -f supabase/tests/contribution-visibility-security.sql   -- expect 6 PASS / 4 FAIL
--   psql "$DB_URL" -f scripts/sql/contribution-visibility/10-policy-fix.sql
--   psql "$DB_URL" -f supabase/tests/contribution-visibility-security.sql   -- expect 10 PASS / 0 FAIL
-- ============================================================================
