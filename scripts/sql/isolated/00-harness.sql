-- Isolated validation harness.
--
-- Reproduces the production objects these two changesets touch, read out of
-- the live catalogue rather than invented: every function body and every
-- policy expression below was copied from pg_get_functiondef / pg_get_expr on
-- production. No production data is present and none is reachable from here.
--
-- Not a substitute for the documented pg_dump procedure — it is the subset
-- needed to execute the two suites, which is what can be built without
-- production database credentials.

\set ON_ERROR_STOP on

-- ── Roles ───────────────────────────────────────────────────────────────────
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','tesseract_audience_writer'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;
END $$;

GRANT tesseract_audience_writer TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── auth ────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

-- Supabase's auth.uid(): the caller's id out of the request's JWT claims.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

-- ── public: identity and tenancy ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_organization_id uuid
);

-- Production creates the public.users row from a trigger on auth.users; the
-- suites rely on it (they INSERT into auth.users then UPDATE users).
CREATE OR REPLACE FUNCTION public._mirror_auth_user() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.users(id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mirror_auth_user ON auth.users;
CREATE TRIGGER mirror_auth_user AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._mirror_auth_user();

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE
);

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text,
  company_name text
);

-- Cleanup targets referenced by both suites' teardown.
CREATE TABLE IF NOT EXISTS public.asset_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.list_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid REFERENCES public.asset_lists(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- ── identity helpers (verbatim from production) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT u.current_organization_id
  FROM users u
  WHERE u.id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.user_id = u.id
        AND om.organization_id = u.current_organization_id
        AND om.status = 'active'
        AND (om.expires_at IS NULL OR om.expires_at > now())
    );
$$;

CREATE OR REPLACE FUNCTION public.is_active_member_of_current_org() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = current_org_id()
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','pg_temp' AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_active_org_admin_of_current_org() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT false;   -- not exercised by these suites; fixtures are written as postgres
$$;

-- ── org chart ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_chart_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.org_chart_nodes(id) ON DELETE CASCADE,
  node_type text NOT NULL,
  name text NOT NULL,
  color text,
  is_active boolean DEFAULT true,
  sort_order integer
);

CREATE TABLE IF NOT EXISTS public.org_chart_node_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES public.org_chart_nodes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
);

-- ── contributions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  section text NOT NULL,
  content text,
  created_by uuid REFERENCES public.users(id),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  visibility text DEFAULT 'firm',
  team_id uuid,
  attachments jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_user_asset_section_org
    UNIQUE NULLS NOT DISTINCT (created_by, asset_id, section, organization_id)
);

CREATE TABLE IF NOT EXISTS public.contribution_visibility_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES public.asset_contributions(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.org_chart_nodes(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (contribution_id, node_id)
);

-- ── workflows and stage deadlines ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id),
  is_public boolean DEFAULT false,
  scope_type text NOT NULL DEFAULT 'asset',
  color text DEFAULT '#3b82f6'
);

CREATE TABLE IF NOT EXISTS public.asset_stage_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id),
  workflow_id uuid REFERENCES public.workflows(id),
  stage_id text NOT NULL,
  deadline_date date NOT NULL,
  notes text,
  set_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (asset_id, workflow_id, stage_id)
);

CREATE TABLE IF NOT EXISTS public.user_asset_priorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  priority text NOT NULL,
  reason text,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT user_asset_priorities_asset_id_user_id_key UNIQUE (asset_id, user_id),
  CONSTRAINT user_asset_priorities_org_asset_user_key UNIQUE (organization_id, asset_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.user_asset_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  widget_type text NOT NULL,
  title text NOT NULL,
  is_archived boolean DEFAULT false,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT user_asset_widgets_user_id_asset_id_title_key UNIQUE (user_id, asset_id, title),
  CONSTRAINT user_asset_widgets_org_user_asset_title_key UNIQUE (organization_id, user_id, asset_id, title)
);

CREATE TABLE IF NOT EXISTS public.user_asset_widget_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id uuid NOT NULL REFERENCES public.user_asset_widgets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content text,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  UNIQUE (widget_id, user_id)
);

-- ── the read predicate, verbatim from production ────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_asset_contribution(p_contribution_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.asset_contributions c
    WHERE c.id = p_contribution_id
      AND c.organization_id = public.current_org_id()
      AND public.is_active_member_of_current_org()
      AND (
            c.created_by = auth.uid()
            OR c.visibility = 'firm'
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
$function$;

-- ── RLS, as production has it ───────────────────────────────────────────────
ALTER TABLE public.asset_contributions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contribution_visibility_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_chart_nodes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_chart_node_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_stage_deadlines           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_asset_priorities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_asset_widgets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows                       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_contributions_select ON public.asset_contributions;
CREATE POLICY asset_contributions_select ON public.asset_contributions
  FOR SELECT TO authenticated
  USING (
    is_active_member_of_current_org()
    AND organization_id = current_org_id()
    AND (
      created_by = auth.uid()
      OR visibility = 'firm'
      OR EXISTS (
        SELECT 1
        FROM contribution_visibility_targets cvt
        JOIN org_chart_node_members ocnm
          ON ocnm.node_id = cvt.node_id AND ocnm.user_id = auth.uid()
        JOIN org_chart_nodes ocn
          ON ocn.id = cvt.node_id AND ocn.organization_id = asset_contributions.organization_id
        WHERE cvt.contribution_id = asset_contributions.id
      )
    )
  );

DROP POLICY IF EXISTS asset_contributions_insert ON public.asset_contributions;
CREATE POLICY asset_contributions_insert ON public.asset_contributions
  FOR INSERT TO authenticated
  WITH CHECK ((created_by = auth.uid()) AND (organization_id = current_org_id()));

DROP POLICY IF EXISTS asset_contributions_update ON public.asset_contributions;
CREATE POLICY asset_contributions_update ON public.asset_contributions
  FOR UPDATE TO authenticated
  USING ((created_by = auth.uid()) AND (organization_id = current_org_id()))
  WITH CHECK ((created_by = auth.uid()) AND (organization_id = current_org_id()));

DROP POLICY IF EXISTS contribution_visibility_targets_select ON public.contribution_visibility_targets;
CREATE POLICY contribution_visibility_targets_select ON public.contribution_visibility_targets
  FOR SELECT TO authenticated
  USING (is_active_member_of_current_org() AND (organization_id = current_org_id()));

DROP POLICY IF EXISTS "Users can view org chart nodes in current org" ON public.org_chart_nodes;
CREATE POLICY "Users can view org chart nodes in current org" ON public.org_chart_nodes
  FOR SELECT USING (organization_id = current_org_id());

DROP POLICY IF EXISTS "Users can view node members in current org" ON public.org_chart_node_members;
CREATE POLICY "Users can view node members in current org" ON public.org_chart_node_members
  FOR SELECT USING (node_id IN (SELECT id FROM org_chart_nodes WHERE organization_id = current_org_id()));

-- workflows: org scope AND access, which the deadline predicate reads through
DROP POLICY IF EXISTS workflows_select ON public.workflows;
CREATE POLICY workflows_select ON public.workflows
  FOR SELECT USING ((organization_id = current_org_id())
                    AND ((is_public = true) OR (created_by = auth.uid())));

-- the two permissive deadline policies, pre-migration
DROP POLICY IF EXISTS "Users can view asset stage deadlines" ON public.asset_stage_deadlines;
CREATE POLICY "Users can view asset stage deadlines" ON public.asset_stage_deadlines
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can insert asset stage deadlines" ON public.asset_stage_deadlines;
CREATE POLICY "Users can insert asset stage deadlines" ON public.asset_stage_deadlines
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS user_asset_priorities_select ON public.user_asset_priorities;
CREATE POLICY user_asset_priorities_select ON public.user_asset_priorities
  FOR SELECT TO authenticated USING (organization_id = current_org_id());
DROP POLICY IF EXISTS user_asset_priorities_insert ON public.user_asset_priorities;
CREATE POLICY user_asset_priorities_insert ON public.user_asset_priorities
  FOR INSERT TO authenticated
  WITH CHECK ((organization_id = current_org_id()) AND (user_id = auth.uid()));

DROP POLICY IF EXISTS user_asset_widgets_select ON public.user_asset_widgets;
CREATE POLICY user_asset_widgets_select ON public.user_asset_widgets
  FOR SELECT TO authenticated USING (organization_id = current_org_id());
DROP POLICY IF EXISTS user_asset_widgets_insert ON public.user_asset_widgets;
CREATE POLICY user_asset_widgets_insert ON public.user_asset_widgets
  FOR INSERT TO authenticated
  WITH CHECK ((organization_id = current_org_id()) AND (user_id = auth.uid()));

-- ── grants, including the ones the migration revokes ────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.asset_stage_deadlines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.asset_contributions, public.contribution_visibility_targets,
  public.org_chart_nodes, public.org_chart_node_members,
  public.user_asset_priorities, public.user_asset_widgets,
  public.user_asset_widget_values, public.workflows,
  public.assets, public.organizations, public.organization_memberships,
  public.users, public.asset_lists, public.list_statuses
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id(), public.is_active_member_of_current_org(),
  public.current_user_id(), public.can_read_asset_contribution(uuid) TO authenticated;
