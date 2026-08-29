-- =============================================================================
-- C1/06 — asset_revisions + asset_revision_events tenant boundary
--
-- Both are `SELECT USING (true)`. 13 revisions, 22 events, 100% visible to a
-- user in no organization. asset_revisions is in scope narrowly, as the parent
-- that makes the pair coherent — this is not a redesign of the revision system.
--
-- Why forward-only. Every revision is `view_scope_type = 'firm'` with
-- `view_scope_user_id` NULL, and there is no organization, portfolio, project
-- or note parent to derive from. The only remaining candidate is the actor's
-- membership, and **4 of the 6 actors belong to more than one organization**, so
-- that is not a derivation. The 35 historical rows keep organization_id NULL and
-- are reachable by their actor only.
--
-- The forward rule is deliberately NOT "the actor's org". It is
-- `current_org_id()` — the organization the caller is actively standing in,
-- which `users.current_organization_id` records and which is gated on an active,
-- unexpired membership. For a single-org user the two are the same; for a
-- multi-org user only the second is an answer.
-- =============================================================================

BEGIN;

ALTER TABLE public.asset_revisions       ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.asset_revision_events ADD COLUMN IF NOT EXISTS organization_id uuid;

COMMENT ON COLUMN public.asset_revisions.organization_id IS
  'Tenant owner, assigned from the caller''s active organization at insert. '
  'NULL on rows that predate C1: their tenant is not deterministically recoverable '
  '(4 of 6 historical actors are multi-org), so they are creator-only, not guessed.';

CREATE INDEX IF NOT EXISTS idx_asset_revisions_organization_id
  ON public.asset_revisions (organization_id);
CREATE INDEX IF NOT EXISTS idx_asset_revision_events_organization_id
  ON public.asset_revision_events (organization_id);

-- -----------------------------------------------------------------------------
-- The revision owns the tenant; the event inherits it from its parent.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asset_revisions_set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NULL THEN
    -- A quarantined historical row stays quarantined. Editing it must not be a
    -- back door that adopts it into whichever org the editor happens to be in.
    NEW.organization_id := NULL;
    RETURN NEW;
  END IF;

  NEW.organization_id := public.current_org_id();
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'asset_revisions: caller has no active organization';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.asset_revision_events_set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE parent_org uuid; parent_exists boolean;
BEGIN
  SELECT r.organization_id, true INTO parent_org, parent_exists
    FROM public.asset_revisions r WHERE r.id = NEW.revision_id;

  IF NOT COALESCE(parent_exists, false) THEN
    RAISE EXCEPTION 'asset_revision_events: revision % does not exist', NEW.revision_id;
  END IF;

  -- An event on a quarantined revision inherits the quarantine rather than
  -- acquiring a tenant its parent does not have.
  IF parent_org IS NULL THEN
    NEW.organization_id := NULL;
    RETURN NEW;
  END IF;

  IF parent_org IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'asset_revision_events: revision % belongs to another organization',
      NEW.revision_id;
  END IF;

  NEW.organization_id := parent_org;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS asset_revisions_set_organization_id ON public.asset_revisions;
CREATE TRIGGER asset_revisions_set_organization_id
  BEFORE INSERT OR UPDATE ON public.asset_revisions
  FOR EACH ROW EXECUTE FUNCTION public.asset_revisions_set_organization_id();

DROP TRIGGER IF EXISTS asset_revision_events_set_organization_id ON public.asset_revision_events;
CREATE TRIGGER asset_revision_events_set_organization_id
  BEFORE INSERT OR UPDATE ON public.asset_revision_events
  FOR EACH ROW EXECUTE FUNCTION public.asset_revision_events_set_organization_id();

-- -----------------------------------------------------------------------------
-- Policies.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read revisions" ON public.asset_revisions;
DROP POLICY IF EXISTS "Users can insert own revisions"         ON public.asset_revisions;
DROP POLICY IF EXISTS "Users can update own revisions"         ON public.asset_revisions;

-- Replay-safety: these files must be re-runnable against an already
-- remediated database, so the new policy names are dropped as well as the
-- old ones. Without this a second run fails on "policy already exists".
DROP POLICY IF EXISTS asset_revisions_select ON public.asset_revisions;
DROP POLICY IF EXISTS asset_revisions_insert ON public.asset_revisions;
DROP POLICY IF EXISTS asset_revisions_update ON public.asset_revisions;
DROP POLICY IF EXISTS asset_revision_events_select ON public.asset_revision_events;
DROP POLICY IF EXISTS asset_revision_events_insert ON public.asset_revision_events;
CREATE POLICY asset_revisions_select ON public.asset_revisions
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
         OR (organization_id IS NULL AND actor_user_id = auth.uid()));

CREATE POLICY asset_revisions_insert ON public.asset_revisions
  FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid() AND organization_id = public.current_org_id());

CREATE POLICY asset_revisions_update ON public.asset_revisions
  FOR UPDATE TO authenticated
  USING (actor_user_id = auth.uid()
         AND (organization_id = public.current_org_id() OR organization_id IS NULL))
  WITH CHECK (actor_user_id = auth.uid()
              AND (organization_id = public.current_org_id() OR organization_id IS NULL));

DROP POLICY IF EXISTS "Authenticated users can read revision events" ON public.asset_revision_events;
DROP POLICY IF EXISTS "Users can insert own revision events"         ON public.asset_revision_events;

CREATE POLICY asset_revision_events_select ON public.asset_revision_events
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
         OR (organization_id IS NULL
             AND EXISTS (SELECT 1 FROM public.asset_revisions r
                          WHERE r.id = asset_revision_events.revision_id
                            AND r.actor_user_id = auth.uid())));

-- The parent must be in the caller's org. The old policy checked only that the
-- parent's actor was the caller, which a multi-org actor satisfies in either org.
CREATE POLICY asset_revision_events_insert ON public.asset_revision_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.asset_revisions r
                       WHERE r.id = asset_revision_events.revision_id
                         AND r.actor_user_id = auth.uid()
                         AND r.organization_id = public.current_org_id()));

DO $$
DECLARE r_q int; e_q int;
BEGIN
  SELECT count(*) FILTER (WHERE organization_id IS NULL) INTO r_q FROM public.asset_revisions;
  SELECT count(*) FILTER (WHERE organization_id IS NULL) INTO e_q FROM public.asset_revision_events;
  RAISE NOTICE 'C1/06: % revisions and % events quarantined creator-only', r_q, e_q;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename IN ('asset_revisions','asset_revision_events')
              AND (qual='true' OR with_check='true')) THEN
    RAISE EXCEPTION 'C1/06: an unconditional policy remains';
  END IF;
END $$;

COMMIT;
