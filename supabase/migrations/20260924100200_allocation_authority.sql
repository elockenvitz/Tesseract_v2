-- Allocation: who may read, participate, and publish.
--
-- Before this migration every allocation table except `allocation_periods` was
-- readable by any authenticated user in any of the 28 organisations, and the
-- official house view could be set by any of them. The write-own-row policies
-- on votes, comments and individual views look safe but are not tenant-safe:
-- they let a member of one firm author a row against another firm's period,
-- and every such row was then world-readable.
--
-- Two authorities, deliberately separate:
--
--   Investment authority — an active allocation-team ADMIN may set the
--   official view and author the periods it belongs to. This is the firm's
--   house view; publishing it is an investment act.
--
--   Administrative authority — an ORG_ADMIN appoints and manages the
--   allocation team. Appointing the investment authority is not the same as
--   being it, so ORG_ADMIN alone cannot touch an official view, and an
--   allocation-team admin cannot appoint anyone, themselves included, unless
--   they independently hold ORG_ADMIN.
--
-- Tenancy is normalised. Only `asset_classes` and `allocation_team_members`
-- carry `organization_id`; everything else proves its tenancy through
-- `period_id -> allocation_periods.organization_id`. Where a row also names an
-- asset class, writes additionally prove the asset class belongs to the same
-- organisation, so an Org A period cannot be paired with an Org B asset class.
--
-- `allocation_history` keeps SELECT only. Its rows are written by
-- `log_official_view_insert` / `log_official_view_change`, both SECURITY
-- DEFINER triggers on `official_allocation_views`, which bypass RLS — that is
-- why inserts work today with no INSERT policy, and why adding one would open
-- a direct write path to an audit trail rather than fix anything.

-- Wrapped in an explicit transaction, and this one matters most of the three.
-- The catalog sweep below drops every policy in the domain before recreating
-- the hardened set, so a runner that autocommits per statement would, on a
-- mid-file failure, leave ten tables with RLS enabled and no policies at all.
-- That denies everyone rather than leaking to anyone — but a firm's allocation
-- data being unreadable is not an acceptable resting state either.

BEGIN;

-- ── Helpers ────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER for one reason only: a policy on `allocation_team_members`
-- that asks whether the caller is a team member would recurse. These read that
-- table without RLS and answer a single boolean.
--
-- Neither takes a user id. The caller is always `auth.uid()`, so neither can
-- be asked about anybody else, and neither returns rows, so neither can be
-- used to read the membership table through the back door.

CREATE OR REPLACE FUNCTION public.is_allocation_team_member(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM allocation_team_members m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = target_organization_id
      AND m.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_allocation_team_admin(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM allocation_team_members m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = target_organization_id
      AND m.is_active = true
      AND m.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_allocation_team_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_allocation_team_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_allocation_team_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_allocation_team_admin(uuid) TO authenticated;

-- Tenancy of a row that owns a period reference. Not SECURITY DEFINER: it
-- reads `allocation_periods`, whose own policy is already correct, and there
-- is no recursion to escape.
CREATE OR REPLACE FUNCTION public.allocation_period_in_current_org(p_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM allocation_periods p
    WHERE p.id = p_period_id
      AND p.organization_id = current_org_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.allocation_asset_class_in_current_org(p_asset_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM asset_classes ac
    WHERE ac.id = p_asset_class_id
      AND ac.organization_id = current_org_id()
  );
$$;

REVOKE ALL ON FUNCTION public.allocation_period_in_current_org(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocation_asset_class_in_current_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocation_period_in_current_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocation_asset_class_in_current_org(uuid) TO authenticated;

-- Active ORG_ADMIN of a named organisation. Mirrors the predicate already used
-- by phase16 governance jobs; expressed once here so the team-membership
-- policy does not inline it.
CREATE OR REPLACE FUNCTION public.is_org_admin_of(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = target_organization_id
      AND om.is_org_admin = true
      AND om.status = 'active'
      AND (om.expires_at IS NULL OR om.expires_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_admin_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_admin_of(uuid) TO authenticated;

-- ── Clear the old policies ─────────────────────────────────────────────────
--
-- Dropped from the catalog rather than by name. Postgres combines permissive
-- policies with OR, so a `DROP POLICY IF EXISTS` naming a policy that does not
-- exist fails silently and leaves the old `USING (true)` in place beside the
-- new restrictive one — the table would look hardened and still be readable by
-- everyone. Five of the names in this domain are not what they appear to be
-- (`Users can view comments`, not `... all comments`; `Users can view history`,
-- not `... allocation history`), so naming them is exactly the wrong mechanism.
--
-- This drops whatever is actually there, then the rest of the file is the sole
-- source of policy on these tables.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'asset_classes', 'allocation_periods', 'official_allocation_views',
        'individual_allocation_views', 'allocation_votes', 'allocation_comments',
        'allocation_history', 'allocation_cell_notes', 'allocation_attachments',
        'allocation_team_members'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── asset_classes ──────────────────────────────────────────────────────────

CREATE POLICY "alloc: read asset classes in current org"
  ON asset_classes FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "alloc: team admin inserts asset classes"
  ON asset_classes FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
              AND is_allocation_team_admin(organization_id));

CREATE POLICY "alloc: team admin updates asset classes"
  ON asset_classes FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
         AND is_allocation_team_admin(organization_id))
  WITH CHECK (organization_id = current_org_id()
              AND is_allocation_team_admin(organization_id));

-- ── allocation_periods ─────────────────────────────────────────────────────
-- Tenant-safe already, but any org member could create or change a period.
-- Opening a house-view period is investment authority.

CREATE POLICY "alloc: read periods in current org"
  ON allocation_periods FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "alloc: team admin creates periods"
  ON allocation_periods FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
              AND is_allocation_team_admin(organization_id));

CREATE POLICY "alloc: team admin updates periods"
  ON allocation_periods FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
         AND is_allocation_team_admin(organization_id))
  WITH CHECK (organization_id = current_org_id()
              AND is_allocation_team_admin(organization_id));

-- No DELETE policy: none exists today and no product path deletes a period.

-- ── official_allocation_views ──────────────────────────────────────────────

CREATE POLICY "alloc: read official views in current org"
  ON official_allocation_views FOR SELECT TO authenticated
  USING (allocation_period_in_current_org(period_id));

CREATE POLICY "alloc: team admin publishes official views"
  ON official_allocation_views FOR INSERT TO authenticated
  WITH CHECK (allocation_period_in_current_org(period_id)
              AND allocation_asset_class_in_current_org(asset_class_id)
              AND is_allocation_team_admin(current_org_id()));

CREATE POLICY "alloc: team admin changes official views"
  ON official_allocation_views FOR UPDATE TO authenticated
  USING (allocation_period_in_current_org(period_id)
         AND is_allocation_team_admin(current_org_id()))
  WITH CHECK (allocation_period_in_current_org(period_id)
              AND allocation_asset_class_in_current_org(asset_class_id)
              AND is_allocation_team_admin(current_org_id()));

CREATE POLICY "alloc: team admin retracts official views"
  ON official_allocation_views FOR DELETE TO authenticated
  USING (allocation_period_in_current_org(period_id)
         AND is_allocation_team_admin(current_org_id()));

-- ── Participant tables: individual views, votes, comments ──────────────────
-- Authorship is unchanged — you may still only write your own row. What is
-- added is that the row must belong to your organisation's period.

CREATE POLICY "alloc: read individual views in current org"
  ON individual_allocation_views FOR SELECT TO authenticated
  USING (allocation_period_in_current_org(period_id));

CREATE POLICY "alloc: author own individual view"
  ON individual_allocation_views FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
              AND allocation_period_in_current_org(period_id)
              AND allocation_asset_class_in_current_org(asset_class_id));

CREATE POLICY "alloc: update own individual view"
  ON individual_allocation_views FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND allocation_period_in_current_org(period_id))
  WITH CHECK (user_id = auth.uid()
              AND allocation_period_in_current_org(period_id)
              AND allocation_asset_class_in_current_org(asset_class_id));

CREATE POLICY "alloc: delete own individual view"
  ON individual_allocation_views FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND allocation_period_in_current_org(period_id));

CREATE POLICY "alloc: read votes in current org"
  ON allocation_votes FOR SELECT TO authenticated
  USING (allocation_period_in_current_org(period_id));

CREATE POLICY "alloc: cast own vote"
  ON allocation_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
              AND allocation_period_in_current_org(period_id)
              AND allocation_asset_class_in_current_org(asset_class_id));

CREATE POLICY "alloc: change own vote"
  ON allocation_votes FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND allocation_period_in_current_org(period_id))
  WITH CHECK (user_id = auth.uid()
              AND allocation_period_in_current_org(period_id)
              AND allocation_asset_class_in_current_org(asset_class_id));

CREATE POLICY "alloc: withdraw own vote"
  ON allocation_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND allocation_period_in_current_org(period_id));

CREATE POLICY "alloc: read comments in current org"
  ON allocation_comments FOR SELECT TO authenticated
  USING (allocation_period_in_current_org(period_id));

-- `asset_class_id` is nullable here — a comment may be on the period itself.
CREATE POLICY "alloc: write own comment"
  ON allocation_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
              AND allocation_period_in_current_org(period_id)
              AND (asset_class_id IS NULL
                   OR allocation_asset_class_in_current_org(asset_class_id)));

CREATE POLICY "alloc: edit own comment"
  ON allocation_comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND allocation_period_in_current_org(period_id))
  WITH CHECK (user_id = auth.uid()
              AND allocation_period_in_current_org(period_id)
              AND (asset_class_id IS NULL
                   OR allocation_asset_class_in_current_org(asset_class_id)));

CREATE POLICY "alloc: delete own comment"
  ON allocation_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND allocation_period_in_current_org(period_id));

-- ── Notes and attachments: participation, not ratification ─────────────────

CREATE POLICY "alloc: read cell notes in current org"
  ON allocation_cell_notes FOR SELECT TO authenticated
  USING (allocation_period_in_current_org(period_id));

CREATE POLICY "alloc: team member writes cell notes"
  ON allocation_cell_notes FOR INSERT TO authenticated
  WITH CHECK (allocation_period_in_current_org(period_id)
              AND allocation_asset_class_in_current_org(asset_class_id)
              AND is_allocation_team_member(current_org_id()));

CREATE POLICY "alloc: team member edits cell notes"
  ON allocation_cell_notes FOR UPDATE TO authenticated
  USING (allocation_period_in_current_org(period_id)
         AND is_allocation_team_member(current_org_id()))
  WITH CHECK (allocation_period_in_current_org(period_id)
              AND allocation_asset_class_in_current_org(asset_class_id)
              AND is_allocation_team_member(current_org_id()));

CREATE POLICY "alloc: read attachments in current org"
  ON allocation_attachments FOR SELECT TO authenticated
  USING (allocation_period_in_current_org(period_id));

CREATE POLICY "alloc: team member adds attachments"
  ON allocation_attachments FOR INSERT TO authenticated
  WITH CHECK (allocation_period_in_current_org(period_id)
              AND is_allocation_team_member(current_org_id()));

CREATE POLICY "alloc: team member updates attachments"
  ON allocation_attachments FOR UPDATE TO authenticated
  USING (allocation_period_in_current_org(period_id)
         AND is_allocation_team_member(current_org_id()))
  WITH CHECK (allocation_period_in_current_org(period_id)
              AND is_allocation_team_member(current_org_id()));

CREATE POLICY "alloc: team member removes attachments"
  ON allocation_attachments FOR DELETE TO authenticated
  USING (allocation_period_in_current_org(period_id)
         AND is_allocation_team_member(current_org_id()));

-- ── allocation_history: read-only to clients ───────────────────────────────

CREATE POLICY "alloc: read history in current org"
  ON allocation_history FOR SELECT TO authenticated
  USING (allocation_period_in_current_org(period_id));

-- No INSERT/UPDATE/DELETE policy, deliberately. The two SECURITY DEFINER
-- triggers on `official_allocation_views` write these rows and are unaffected
-- by RLS; giving clients a direct path would make the trail forgeable.

-- ── allocation_team_members: ORG_ADMIN administers, and only ORG_ADMIN ──────
--
-- This is what breaks the bootstrap deadlock. The old policy required you to
-- already be an allocation-team admin to create one, against a table with no
-- rows, so nobody could ever be appointed.
--
-- `is_allocation_team_admin` is deliberately NOT used here. An allocation-team
-- admin holds investment authority, not the authority to appoint peers or
-- themselves; that separation is the point of the model.

CREATE POLICY "alloc: read team in current org"
  ON allocation_team_members FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "alloc: org admin appoints team"
  ON allocation_team_members FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
              AND is_org_admin_of(organization_id));

CREATE POLICY "alloc: org admin updates team"
  ON allocation_team_members FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
         AND is_org_admin_of(organization_id))
  WITH CHECK (organization_id = current_org_id()
              AND is_org_admin_of(organization_id));

CREATE POLICY "alloc: org admin removes team"
  ON allocation_team_members FOR DELETE TO authenticated
  USING (organization_id = current_org_id()
         AND is_org_admin_of(organization_id));

COMMIT;
