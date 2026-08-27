-- ============================================================================
-- quick_thoughts — Stage C: tenant-aware policies, and anon loses the table
-- ============================================================================
--
-- APPLY LAST. This is the enforcement step of a three-stage rollout. Stage A
-- (20260827090100-090300) prepared the data, the write boundary and the Ops
-- RPC; Stage B ships the frontend that uses them. Landing this migration
-- before that frontend is deployed silently narrows the Operations Portal to
-- one tenant. See the rollout notes in the PR.
--
-- ── What was wrong ────────────────────────────────────────────────────────
--
-- All six policies were `TO public`, which in PostgREST terms means anon as
-- well as authenticated. Combined with `visibility = 'public'` as the entire
-- predicate of one of them, and a full grant to anon, the public thoughts in
-- this table were readable by anyone holding the publishable key. That is not
-- a tenant bug; that is the open internet.
--
-- The team policy was subtler and worse in a way: it joined
-- project_assignments to project_assignments and never once mentioned an
-- organization. Two people sharing any project — including a project belonging
-- to a different tenant — could read each other's team thoughts.
--
-- No policy referenced `organization_id` at all, despite the column existing
-- since 20260605120000.
--
-- ── The model ─────────────────────────────────────────────────────────────
--
-- Every policy below is `TO authenticated` and every one of them carries
--
--     organization_id = current_org_id()
--
-- which does three jobs at once. It scopes the row to the caller's tenant; it
-- denies the quarantined legacy rows, because `NULL = <uuid>` is NULL and NULL
-- is not TRUE; and it inherits the P0 hardening in `current_org_id()`, which
-- returns NULL unless the caller holds an active, unexpired membership of the
-- org they claim to be standing in. A user who is offboarded mid-session stops
-- reading the moment their membership goes.
--
-- The four visibility tiers are nested scopes within one workspace. None of
-- them has ever meant the public internet, and no publishing feature exists:
--
--   private        the author, inside their own tenant
--   team           a project relationship in the same org, or the named team
--   organization   a named division / department / team node
--   public         the whole workspace — the widest tier, still authenticated
--
-- `organization` gets a SELECT policy here for the first time. The mounted
-- capture UI has always been able to write that value, but nothing could ever
-- read it back, so those thoughts were silently visible only to their author.
-- Production holds zero of them, so this exposes no existing row; it stops the
-- picker from quietly discarding what the user asked for. Node scope is direct
-- membership, matching the established convention on `layout_collaborations`
-- rather than inventing subtree traversal inside a security change. Whether a
-- division-level post should reach its sub-teams is a product question and is
-- deliberately left open.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT set. The table owner is
-- `postgres`, and both `postgres` and `service_role` carry the `BYPASSRLS`
-- role attribute, which always wins — including over FORCE. Setting it here
-- would change no access path while implying the owner path is constrained.
-- The boundary is these policies plus the grant revocation below, and the fact
-- that BYPASSRLS lives only on credentials the browser never holds.

-- ── SELECT ───────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own thoughts"    ON public.quick_thoughts;
DROP POLICY IF EXISTS "Users can view public thoughts" ON public.quick_thoughts;
DROP POLICY IF EXISTS "Users can view team thoughts"   ON public.quick_thoughts;

-- private: the author, in the tenant that owns the row.
CREATE POLICY "quick_thoughts_select_own"
  ON public.quick_thoughts FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    AND organization_id = public.current_org_id()
  );

-- public: everyone in the workspace that owns the row.
CREATE POLICY "quick_thoughts_select_workspace"
  ON public.quick_thoughts FOR SELECT TO authenticated
  USING (
    visibility = 'public'::thought_visibility
    AND organization_id = public.current_org_id()
  );

-- team: a shared project inside the same organization, or the named team.
CREATE POLICY "quick_thoughts_select_team"
  ON public.quick_thoughts FOR SELECT TO authenticated
  USING (
    visibility = 'team'::thought_visibility
    AND organization_id = public.current_org_id()
    AND CASE
      WHEN visibility_team_id IS NOT NULL THEN
        EXISTS (
          SELECT 1
          FROM public.team_memberships tm
          JOIN public.teams t ON t.id = tm.team_id
          WHERE tm.team_id = quick_thoughts.visibility_team_id
            AND tm.user_id = auth.uid()
            AND t.organization_id = quick_thoughts.organization_id
        )
      ELSE
        EXISTS (
          SELECT 1
          FROM public.project_assignments pa_self
          JOIN public.project_assignments pa_author
            ON pa_author.project_id = pa_self.project_id
          JOIN public.projects p
            ON p.id = pa_self.project_id
          WHERE pa_self.assigned_to = auth.uid()
            AND pa_author.assigned_to = quick_thoughts.created_by
            -- the shared project must belong to the same tenant as the row;
            -- its absence is what made the old policy cross-org
            AND p.organization_id = quick_thoughts.organization_id
        )
    END
  );

-- organization: a named org-chart node in the same organization.
CREATE POLICY "quick_thoughts_select_org_node"
  ON public.quick_thoughts FOR SELECT TO authenticated
  USING (
    visibility = 'organization'::thought_visibility
    AND organization_id = public.current_org_id()
    AND visibility_org_node_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.org_chart_node_members m
      JOIN public.org_chart_nodes n ON n.id = m.node_id
      WHERE m.node_id = quick_thoughts.visibility_org_node_id
        AND m.user_id = auth.uid()
        AND n.organization_id = quick_thoughts.organization_id
    )
  );

-- ── INSERT / UPDATE / DELETE ─────────────────────────────────────────────────
--
-- The write triggers (20260827090200) already derive and pin organization_id.
-- These policies are the second lock: a WITH CHECK on both INSERT and UPDATE,
-- so a row can never come to rest outside the caller's tenant even if a
-- trigger were dropped. The old UPDATE policy had no WITH CHECK at all, which
-- is why organization_id was mutable.

DROP POLICY IF EXISTS "Users can create thoughts"     ON public.quick_thoughts;
DROP POLICY IF EXISTS "Users can update own thoughts" ON public.quick_thoughts;
DROP POLICY IF EXISTS "Users can delete own thoughts" ON public.quick_thoughts;

CREATE POLICY "quick_thoughts_insert_own"
  ON public.quick_thoughts FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id = public.current_org_id()
  );

CREATE POLICY "quick_thoughts_update_own"
  ON public.quick_thoughts FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND organization_id = public.current_org_id()
  )
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id = public.current_org_id()
  );

CREATE POLICY "quick_thoughts_delete_own"
  ON public.quick_thoughts FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    AND organization_id = public.current_org_id()
  );

-- ── Grants ───────────────────────────────────────────────────────────────────
--
-- anon held SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER.
-- It needs none of them: there is no unauthenticated surface that reads or
-- writes research notes. authenticated keeps the four DML verbs and loses
-- TRUNCATE / REFERENCES / TRIGGER, which no application path uses and which
-- have no business being reachable from a browser.

REVOKE ALL ON public.quick_thoughts FROM anon;
REVOKE ALL ON public.quick_thoughts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_thoughts TO authenticated;
