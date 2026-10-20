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
-- ── The hierarchy question, now answered — and NOT changed here ─────────────
--
-- `org_chart_nodes` has `parent_id` and five node types (division, department,
-- team, portfolio, custom — src/lib/org-graph.ts:11).
--
-- The picker builds its options by walking UP from the author's own direct
-- memberships (`traverseUp`, ContributionSection.tsx:781-794): "my department"
-- is the department ANCESTOR of a team the author belongs to, a node the
-- author is usually not a direct member of. So the UI offers a broad audience.
--
-- The policy, here and in C1/08, matches on DIRECT membership only. That is
-- the codebase's stated convention, and it was stated in a security change for
-- the same reason it is being kept in one:
--
--     "Node scope is direct membership, matching the established convention on
--      `layout_collaborations` rather than inventing subtree traversal inside a
--      security change. Whether a division-level post should reach its
--      sub-teams is a product question and is deliberately left open."
--                      — 20260827090400_quick_thoughts_tenant_rls.sql:52-56
--
-- So subtree descent is UNIMPLEMENTED BY DECISION, not by oversight, and this
-- file does not add it. The consequence has to be stated plainly: a
-- department- or division-targeted contribution reaches only the direct
-- members of that node, which is frequently nobody. 00- Q8b returns the count.
-- Where it is nobody, the contribution is owner-only — and under the CURRENT
-- policy a multi-target one of those is readable by the whole organization, so
-- this file replaces an over-share with an under-share for exactly those rows.
--
-- That is the correct direction for proprietary research and it is still a
-- product decision to confirm. The honest fix for the gap is in the PICKER,
-- not here: it should stop offering an audience the authorization model does
-- not deliver. That is a separate change.
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
-- ATTRIBUTION. A revision event has NO contribution_id. It carries
-- `field_key` (the section) and `category`, and hangs off `asset_revisions`,
-- which carries `asset_id` and `actor_user_id`. There is no migration for
-- either table in this repository — the shape above is read from
-- src/lib/revision-service.ts:14-20 and src/hooks/useAssetRevisions.ts:6-21,
-- and 00- Q1 must confirm it.
--
-- Despite the missing column, an event IS reliably attributable, through the
-- actor. `publishDraft` passes `actorUserId: user.id`
-- (useContributions.ts:424), and the author-only UPDATE policy means nobody
-- else can publish that contribution — so the actor IS the author. With
-- `unique_user_asset_section UNIQUE (created_by, asset_id, section)`, the
-- triple (r.asset_id, e.field_key, r.actor_user_id) identifies EXACTLY ONE
-- contribution row. No guessing, no "most recent wins".
--
-- THE INVARIANT THAT MAKES THIS SAFE, stated so it can be checked: actor ==
-- author. If any future path ever writes a revision event whose actor is not
-- the author of the matching contribution — a bulk tool, an admin action, a
-- server job — then both the actor branch below AND the derivation become
-- wrong, and that path would hand one analyst's prose to another. The test
-- asserts the invariant rather than assuming it.
--
-- Three cases, and the two that cannot be attributed are handled explicitly
-- rather than guessed:
--
--   category = 'valuation_targets'
--       Price-target events. `field_key` is 'price_target', which is not a
--       contribution section, so no contribution exists to derive from. These
--       are NOT contribution prose, and they are the only revision category
--       the Evolution Timeline renders (ThesisHistoryView.tsx:1058). Their
--       current organization-scoped visibility is PRESERVED — unchanged, not
--       widened. If price-target reasoning is later judged restricted, that is
--       its own change with its own evidence.
--
--   an attributable contribution exists
--       Derive from it. One row, via the triple above.
--
--   no contribution exists for a contribution-category event
--       ORPHANED PROSE: the contribution was deleted and its before/after text
--       outlived it. Nothing records who it was shared with, so it is denied
--       to everyone but the actor. This is a real residual — the prose is
--       still in the table, merely unreadable — and is documented as such.
-- ── Corrected after preflight A5. Two tightenings, both load-bearing ───────
--
-- (i) THE ATTRIBUTION JOIN WAS LOOSE. Production's uniqueness is
--     `unique_user_asset_section_org UNIQUE NULLS NOT DISTINCT
--      (created_by, asset_id, section, organization_id)` — FOUR columns, not
--     the three this policy originally matched on. An author who belongs to
--     two organizations can hold the same section on the same asset in each,
--     so (asset_id, section, created_by) resolves to a SET, not a row.
--
--     It did not widen anything, because `can_read_asset_contribution` itself
--     requires `c.organization_id = current_org_id()`, so a foreign-org row
--     returns false. But that is the authorization happening to be tight while
--     the attribution is loose — compensation, not design. Relax the helper's
--     org clause one day and the join silently becomes a cross-org path.
--     `c.organization_id = r.organization_id` makes the match exactly the
--     unique tuple, so the event is authorized by THE contribution it came
--     from and no other.
--
-- (ii) THE ORG CHECK MOVED TABLES, AND THAT WAS A WIDENING. C1/06 keys on the
--     EVENT's `organization_id`; this policy keyed on the REVISION's. Both
--     columns are nullable (A5). For a legacy row with event org NULL under a
--     revision org A, C1/06 grants the actor only — this policy would have
--     granted every org-A member who could read the contribution. Bounded, but
--     a widening that was neither intended nor stated. Requiring BOTH to match
--     keeps legacy null-org events exactly as conservative as they are today.
DROP POLICY IF EXISTS asset_revision_events_select ON public.asset_revision_events;
CREATE POLICY asset_revision_events_select ON public.asset_revision_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.asset_revisions r
       WHERE r.id = asset_revision_events.revision_id
         AND (
               -- The actor is the author of the prose in their own session.
               r.actor_user_id = auth.uid()
               OR (
                 -- (ii) both the event and its revision, so a NULL on either
                 -- fails closed to the actor-only branch above.
                 asset_revision_events.organization_id = public.current_org_id()
                 AND r.organization_id = public.current_org_id()
                 AND public.is_active_member_of_current_org()
                 AND CASE
                       WHEN asset_revision_events.category = 'valuation_targets'
                         THEN true          -- not contribution prose; unchanged
                       ELSE EXISTS (
                              SELECT 1
                              FROM public.asset_contributions c
                              WHERE c.asset_id         = r.asset_id
                                AND c.section          = asset_revision_events.field_key
                                AND c.created_by       = r.actor_user_id
                                -- (i) the fourth column of the unique tuple
                                AND c.organization_id  = r.organization_id
                                AND public.can_read_asset_contribution(c.id))
                     END
               )
             )
    )
  );

-- asset_revisions itself carries no prose (actor, asset, timestamps, scope,
-- and a `review_note` the actor writes about their own session), so C1/06's
-- policy on it is left alone. If `review_note` is found to quote analyst text,
-- it needs the same treatment — 00- Q1 shows its columns.

-- ── 5. Replies and reactions — found by preflight A3b/A3c ──────────────────
--
-- Neither table appears anywhere in the application; the replies feature is
-- not wired. Both are empty, so nothing is exposed today and this is
-- forward-looking hardening.
--
-- Their SELECT policies are
--     contribution_in_current_org(contribution_id) AND is_active_member_of_current_org()
-- which is an ORG-level predicate where a VISIBILITY-level one is required —
-- the same root cause as V1 and V3, on two more tables. `contribution_replies`
-- carries a `content text` column, so had it held rows this would have been a
-- fourth prose exposure path.
--
-- `contribution_in_current_org` is NOT the defect and is left untouched: it
-- answers exactly the question its name asks, and seven policies depend on it.
-- Only these two predicates change.
--
-- INSERT/UPDATE/DELETE are deliberately NOT changed here. Whether you may
-- *reply to* a contribution you cannot read is an authorization-to-write
-- question, separate from confidentiality — and the INSERT policies' own
-- `EXISTS (SELECT … FROM asset_contributions ac …)` is itself subject to
-- `asset_contributions_select`, so fixing V2 above should tighten them
-- automatically. That is a hypothesis about policy-expression RLS semantics,
-- asserted in the test suite rather than assumed here; if it fails, those
-- policies join a follow-up.
DROP POLICY IF EXISTS contribution_replies_select ON public.contribution_replies;
CREATE POLICY contribution_replies_select ON public.contribution_replies
  FOR SELECT TO authenticated
  USING (public.can_read_asset_contribution(contribution_id));

DROP POLICY IF EXISTS contribution_reactions_select ON public.contribution_reactions;
CREATE POLICY contribution_reactions_select ON public.contribution_reactions
  FOR SELECT TO authenticated
  USING (public.can_read_asset_contribution(contribution_id));

COMMIT;

-- ============================================================================
-- NON-VACUITY — the gate must be shown observing its own failure mode.
--
-- supabase/tests/contribution-visibility-security.sql is the real test: 14
-- assertions against the live `authenticated` and `anon` roles with real jwt
-- claims. Against an UNFIXED database it must report assertions 3, 4, 6, 8
-- and 13 FAILING — V2 twice (the two team_id-NULL shapes), V1, V3, and the
-- orphaned-prose case. If it passes before this file is applied, the test is
-- decoration and must not be trusted.
--
-- Nine assertions must pass in BOTH states: they are the
-- preserve-legitimate-access controls, and a fix that breaks one is too tight.
-- Assertion 12 pins the UNIMPLEMENTED subtree descent as a tested fact; if
-- descent is ever implemented, 12 must be deliberately inverted.
--
--   psql "$DB_URL" -f supabase/tests/contribution-visibility-security.sql   -- expect 9 PASS / 5 FAIL
--   psql "$DB_URL" -f scripts/sql/contribution-visibility/10-policy-fix.sql
--   psql "$DB_URL" -f supabase/tests/contribution-visibility-security.sql   -- expect 14 PASS / 0 FAIL
-- ============================================================================
