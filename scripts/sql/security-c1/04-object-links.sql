-- =============================================================================
-- C1/04 — object_links tenant boundary
--
-- Before: SELECT `USING (true)`; writes keyed on `created_by = auth.uid()`.
-- 25 rows on production, 100% visible to a user in no organization.
--
-- Why an explicit column and not EXISTS. object_links is polymorphic: both
-- endpoints are (type, id) pairs over 17 entity types, and **12 of the 25 rows
-- have a GLOBAL endpoint on one side** (`asset`). There is no single parent to
-- join to, and an asset endpoint contributes no tenant at all — so neither
-- endpoint alone determines the link's tenancy. The link needs to own it.
--
-- Backfill: 25/25 deterministically attributable, 0 ambiguous, 0 cross-org
-- conflicts, `created_by` populated on all 25. No quarantine bucket is needed,
-- which is a materially better position than the audit anticipated.
--
-- Forward: a BEFORE INSERT OR UPDATE trigger resolves both endpoints and
-- assigns the column. It is never caller-supplied — a supplied value is
-- overwritten, not validated, so a client cannot choose its own tenant even by
-- accident. Two tenant-owned endpoints in different orgs are refused outright.
--
-- The backfill is gated HARD: if any existing row is left unattributed the
-- migration raises and rolls back, because an unattributed link is invisible
-- under the new policy and a warning would ship that as success.
-- =============================================================================

BEGIN;

ALTER TABLE public.object_links ADD COLUMN IF NOT EXISTS organization_id uuid;

COMMENT ON COLUMN public.object_links.organization_id IS
  'Tenant owner. Assigned by object_links_set_organization_id(); never caller-supplied. '
  'Global endpoints (asset, user) contribute no tenant, which is why the link carries its own.';

-- -----------------------------------------------------------------------------
-- Endpoint resolver.
--
-- Returns the organization that owns one endpoint, or NULL if the endpoint type
-- is genuinely global. `is_global` distinguishes "global, contributes nothing"
-- from "unknown type, refuse" — collapsing those two is how an unresolvable
-- tenant-owned endpoint would quietly become a caller-org link.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.object_link_endpoint_org(
  p_type public.linkable_entity_type,
  p_id   uuid,
  OUT organization_id uuid,
  OUT is_global boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  is_global := false;

  CASE p_type
    -- Genuinely global: one shared row for every tenant.
    WHEN 'asset', 'user' THEN
      is_global := true;
      organization_id := NULL;

    WHEN 'asset_note'    THEN SELECT n.organization_id INTO organization_id FROM asset_notes n     WHERE n.id = p_id;
    WHEN 'theme_note'    THEN SELECT n.organization_id INTO organization_id FROM theme_notes n     WHERE n.id = p_id;
    WHEN 'portfolio_note'THEN SELECT n.organization_id INTO organization_id FROM portfolio_notes n WHERE n.id = p_id;
    WHEN 'portfolio'     THEN SELECT p.organization_id INTO organization_id FROM portfolios p      WHERE p.id = p_id;
    WHEN 'theme'         THEN SELECT t.organization_id INTO organization_id FROM themes t          WHERE t.id = p_id;
    WHEN 'workflow'      THEN SELECT w.organization_id INTO organization_id FROM workflows w       WHERE w.id = p_id;
    WHEN 'quick_thought' THEN SELECT q.organization_id INTO organization_id FROM quick_thoughts q  WHERE q.id = p_id;
    WHEN 'project'       THEN SELECT pr.organization_id INTO organization_id FROM projects pr      WHERE pr.id = p_id;
    WHEN 'calendar_event'THEN SELECT ce.organization_id INTO organization_id FROM calendar_events ce WHERE ce.id = p_id;

    -- trade_idea is two tables, exactly as messages_set_organization_id() has
    -- to treat it: a queue item, or a pair trade reached through its portfolio.
    -- trade_idea is two tables, and the queue-item branch has two candidate
    -- authorities. Production: 228 queue items, 8 with organization_id NULL —
    -- and all 8 also have portfolio_id NULL, so the portfolio fallback rescues
    -- none of them today. It is implemented anyway, because it is the correct
    -- forward rule and the 8 are not being migrated: a link against one is
    -- refused rather than guessed.
    --
    -- Where both authorities exist they must agree (production: 0 disagree).
    -- Disagreement is refused rather than resolved by precedence — picking a
    -- winner between two candidate answers is a guess wearing a rule's clothes.
    WHEN 'trade_idea' THEN
      DECLARE tq_org uuid; pf_org uuid; tq_found boolean := false;
      BEGIN
        SELECT tq.organization_id, true INTO tq_org, tq_found
          FROM trade_queue_items tq WHERE tq.id = p_id;

        IF tq_found THEN
          SELECT p.organization_id INTO pf_org
            FROM trade_queue_items tq JOIN portfolios p ON p.id = tq.portfolio_id
           WHERE tq.id = p_id;

          IF tq_org IS NOT NULL AND pf_org IS NOT NULL AND tq_org IS DISTINCT FROM pf_org THEN
            RAISE EXCEPTION
              'object_links: trade_idea % has conflicting organizations (item %, portfolio %)',
              p_id, tq_org, pf_org;
          END IF;
          organization_id := COALESCE(tq_org, pf_org);
        ELSE
          -- Not a queue item: a pair trade, reached through its portfolio.
          SELECT p.organization_id INTO organization_id
            FROM pair_trades pt JOIN portfolios p ON p.id = pt.portfolio_id WHERE pt.id = p_id;
        END IF;
      END;

    -- Portfolio-anchored objects with no organization column of their own.
    -- trade_idea_theses.portfolio_id is NULL on all 19 production rows, so the
    -- portfolio route resolves nothing. trade_queue_item_id is NOT NULL and is
    -- the real parent; portfolio_id stays as a second source so nothing that
    -- would resolve stops resolving.
    WHEN 'trade_idea_thesis' THEN
      SELECT tq.organization_id INTO organization_id
        FROM trade_idea_theses t JOIN trade_queue_items tq ON tq.id = t.trade_queue_item_id
       WHERE t.id = p_id;
      IF organization_id IS NULL THEN
        SELECT p.organization_id INTO organization_id
          FROM trade_idea_theses t JOIN portfolios p ON p.id = t.portfolio_id WHERE t.id = p_id;
      END IF;
    WHEN 'trade_sheet' THEN
      SELECT p.organization_id INTO organization_id
        FROM trade_sheets ts JOIN portfolios p ON p.id = ts.portfolio_id WHERE ts.id = p_id;
    WHEN 'trade_proposal' THEN
      SELECT p.organization_id INTO organization_id
        FROM trade_proposals tp JOIN portfolios p ON p.id = tp.portfolio_id WHERE tp.id = p_id;
    WHEN 'trade' THEN
      SELECT p.organization_id INTO organization_id
        FROM accepted_trades at2 JOIN portfolios p ON p.id = at2.portfolio_id WHERE at2.id = p_id;

    -- 'custom_note' has no table in this schema. Left deliberately unhandled so
    -- it lands in the refuse branch below rather than being assumed global.
    ELSE
      organization_id := NULL;
  END CASE;
END $function$;

-- -----------------------------------------------------------------------------
-- Backfill. Uses the same resolver, so the historical rows and every future row
-- are attributed by one piece of logic rather than two that can drift.
--
-- ORDER MATTERS: this runs BEFORE the trigger is created. The backfill is an
-- UPDATE, so with the trigger already installed every historical row would be
-- re-validated by the forward guard on its way to being attributed — and a row
-- the guard would refuse can then never be backfilled at all. Production has
-- exactly one such row (an asset_note -> trade_idea_thesis link), which is
-- attributable from its source and unattributable from its target.
-- -----------------------------------------------------------------------------
UPDATE public.object_links l
   SET organization_id = COALESCE(
         (SELECT organization_id FROM public.object_link_endpoint_org(l.source_type, l.source_id)),
         (SELECT organization_id FROM public.object_link_endpoint_org(l.target_type, l.target_id)))
 WHERE l.organization_id IS NULL;

-- -----------------------------------------------------------------------------
-- Assignment trigger.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.object_links_set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  src_org uuid; src_global boolean;
  tgt_org uuid; tgt_global boolean;
  resolved uuid;
BEGIN
  SELECT organization_id, is_global INTO src_org, src_global
    FROM public.object_link_endpoint_org(NEW.source_type, NEW.source_id);
  SELECT organization_id, is_global INTO tgt_org, tgt_global
    FROM public.object_link_endpoint_org(NEW.target_type, NEW.target_id);

  -- An endpoint that is neither global nor resolvable is a missing or unknown
  -- parent. Refusing is the same rule 07 established for owner-bearing message
  -- contexts: never fall back to the caller's org to cover an unresolved parent.
  IF NOT src_global AND src_org IS NULL THEN
    RAISE EXCEPTION 'object_links: source %/% has no resolvable organization',
      NEW.source_type, NEW.source_id;
  END IF;
  IF NOT tgt_global AND tgt_org IS NULL THEN
    RAISE EXCEPTION 'object_links: target %/% has no resolvable organization',
      NEW.target_type, NEW.target_id;
  END IF;

  -- Two tenant-owned endpoints must agree. This is the cross-tenant link.
  IF src_org IS NOT NULL AND tgt_org IS NOT NULL AND src_org IS DISTINCT FROM tgt_org THEN
    RAISE EXCEPTION 'object_links: endpoints belong to different organizations';
  END IF;

  resolved := COALESCE(src_org, tgt_org);

  -- Both endpoints global (asset <-> asset). Nothing in the data names a tenant,
  -- so the caller's active organization is the only honest answer — and if they
  -- have none, there is no answer and the link is refused.
  IF resolved IS NULL THEN
    resolved := public.current_org_id();
  END IF;
  IF resolved IS NULL THEN
    RAISE EXCEPTION 'object_links: no organization could be derived and the caller has no current org';
  END IF;

  -- A caller standing in org A may not create a link inside org B.
  IF public.current_org_id() IS NOT NULL AND resolved IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'object_links: endpoints belong to another organization';
  END IF;

  NEW.organization_id := resolved;   -- assigned, not validated: caller input is discarded
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS object_links_set_organization_id ON public.object_links;
CREATE TRIGGER object_links_set_organization_id
  BEFORE INSERT OR UPDATE ON public.object_links
  FOR EACH ROW EXECUTE FUNCTION public.object_links_set_organization_id();

CREATE INDEX IF NOT EXISTS idx_object_links_organization_id
  ON public.object_links (organization_id);

-- -----------------------------------------------------------------------------
-- Policies.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS object_links_select ON public.object_links;
DROP POLICY IF EXISTS object_links_insert ON public.object_links;
DROP POLICY IF EXISTS object_links_update ON public.object_links;
DROP POLICY IF EXISTS object_links_delete ON public.object_links;

CREATE POLICY object_links_select ON public.object_links
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

CREATE POLICY object_links_insert ON public.object_links
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.current_org_id());

CREATE POLICY object_links_update ON public.object_links
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND is_auto = false AND organization_id = public.current_org_id())
  WITH CHECK (created_by = auth.uid() AND is_auto = false AND organization_id = public.current_org_id());

CREATE POLICY object_links_delete ON public.object_links
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND organization_id = public.current_org_id());

DO $$
DECLARE unresolved int; total int; sample text;
BEGIN
  SELECT count(*) FILTER (WHERE organization_id IS NULL), count(*)
    INTO unresolved, total FROM public.object_links;

  -- HARD STOP, not a notice. The backfill is only trustworthy if it attributed
  -- EVERY existing row: a link left NULL is invisible under the new SELECT
  -- policy, so a warning here would ship silent data loss dressed as a clean
  -- run. The read-only 91 dry run is the preflight; this is the guarantee that
  -- reality did not move between the preflight and the write.
  IF unresolved > 0 THEN
    SELECT string_agg(format('%s(%s->%s)', id, source_type, target_type), ', ')
      INTO sample FROM (SELECT * FROM public.object_links
                         WHERE organization_id IS NULL LIMIT 10) x;
    RAISE EXCEPTION
      'C1/04: % of % object_links could not be attributed and would become invisible. First rows: %',
      unresolved, total, sample;
  END IF;

  RAISE NOTICE 'C1/04: all % object_links attributed', total;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='object_links' AND (qual='true' OR with_check='true')) THEN
    RAISE EXCEPTION 'C1/04: an unconditional policy remains';
  END IF;
END $$;

COMMIT;
