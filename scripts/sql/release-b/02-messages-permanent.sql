-- =============================================================================
-- Security Release B · Step 2 — messages PERMANENT authorization
--
-- STATUS: not executed anywhere. The backfill in §2 MUST be reviewed against
--         real row counts before this is run — see the quarantine note there.
-- RUN ORDER: after 01-messages-containment.sql, staging first.
--
-- ── The data model, as traced from every caller ──────────────────────────────
--
-- `messages` is NOT direct messaging. Direct messages live in `conversations` +
-- `conversation_messages` and are reached through `get_or_create_direct_
-- conversation()` and `mark_conversation_read()`. `messages` is a polymorphic
-- COMMENT table: a thread hangs off (context_type, context_id).
--
--   user_id      the AUTHOR. Confirmed by the two conditional policies already
--                on the table: INSERT WITH CHECK (auth.uid() = user_id) and
--                DELETE USING (auth.uid() = user_id). There is no recipient
--                column; the audience is "whoever can see the context".
--   context_type asset · portfolio · theme · note · field · trade_idea ·
--                workflow · quick_thought · simulation_share · decision_request
--   context_id   the id of that object
--   portfolio_id OPTIONAL annotation on trade_idea messages only ("which
--                portfolio am I talking about"), set from a picker in
--                TradeIdeaDetailModal. NOT an ownership key. Nullable.
--   is_read      a single SHARED boolean on the row, not per-recipient state.
--   is_pinned    shared thread state.
--
-- ── Why an explicit organization_id, and not an EXISTS join ──────────────────
--
-- The theme_assets analysis (docs/p0-unconditional-policy-findings.md §4.2)
-- chose an EXISTS join because `theme_assets.theme_id` is NOT NULL and
-- single-valued, so the join is total and unambiguous. Neither is true here.
-- `context_type` is polymorphic across ten types living in different tables, and
-- one of them — `asset` — is a GLOBAL table that confers no organization at all.
-- An EXISTS join would need a ten-branch CASE re-evaluated per row, and would
-- still have no answer for asset-context messages.
--
-- So: an explicit column, assigned server-side by trigger, never by the caller.
-- Same conclusion and same reasoning as object_links (§4.1).
--
-- ── Why there is no general UPDATE policy ────────────────────────────────────
--
-- The brief asked whether recipients need row UPDATE to mark a message read.
-- They do not, and no caller edits message content: across all 14 call sites the
-- only UPDATEs are `{is_read, read_at}` and `{is_pinned}`. So content, author and
-- context are immutable once sent — which is what the UI already implies — and
-- the two legitimate mutations go through narrow SECURITY DEFINER RPCs, matching
-- the existing `mark_conversation_read` / `mark_notification_read` idiom.
--
-- A reader who can acknowledge a message therefore cannot alter it. That is the
-- property the current `USING (true) WITH CHECK (true)` policy destroys.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The tenant column
-- -----------------------------------------------------------------------------

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES public.organizations(id);

COMMENT ON COLUMN public.messages.organization_id IS
  'Tenant authority. Assigned by messages_set_organization_id() from the message context; never accepted from the caller. NULL means quarantined — unreachable by any policy.';

-- -----------------------------------------------------------------------------
-- 2. Backfill — derive, never guess
-- -----------------------------------------------------------------------------
--
-- REVIEW BEFORE RUNNING. Following the quick_thoughts precedent
-- (project_quick_thoughts_tenant_isolation): rows whose context object no longer
-- exists, or whose context is global, resolve to NULL and are QUARANTINED rather
-- than guessed. `NULL = <uuid>` is NULL, not TRUE, so a quarantined row is
-- readable by nobody once the policies below are in place.
--
-- Export the quarantined rows to CSV before committing, per that precedent:
--   \copy (SELECT * FROM public.messages WHERE organization_id IS NULL)
--     TO 'messages-quarantine-<date>.csv' CSV HEADER
--
-- `asset`-context messages are the expected large quarantine bucket: assets are
-- global, so those rows genuinely have no tenant recorded anywhere. Decide with
-- Main Control whether to (a) leave them dark, or (b) derive their org from the
-- author's organization_membership. (b) is a guess about intent and is NOT done
-- here.

UPDATE public.messages m SET organization_id = t.organization_id
  FROM public.themes t
 WHERE m.context_type = 'theme' AND m.context_id = t.id
   AND m.organization_id IS NULL;

UPDATE public.messages m SET organization_id = tm.organization_id
  FROM public.portfolios p
  JOIN public.teams tm ON tm.id = p.team_id
 WHERE m.context_type = 'portfolio' AND m.context_id = p.id
   AND m.organization_id IS NULL;

UPDATE public.messages m SET organization_id = w.organization_id
  FROM public.workflows w
 WHERE m.context_type = 'workflow' AND m.context_id = w.id
   AND m.organization_id IS NULL;

UPDATE public.messages m SET organization_id = q.organization_id
  FROM public.quick_thoughts q
 WHERE m.context_type = 'quick_thought' AND m.context_id = q.id
   AND m.organization_id IS NULL;

-- trade_idea messages: the context is trade_queue_items or pair_trades, both of
-- which reach an org through portfolios -> teams.
UPDATE public.messages m SET organization_id = tm.organization_id
  FROM public.trade_queue_items tq
  JOIN public.portfolios p ON p.id = tq.portfolio_id
  JOIN public.teams tm ON tm.id = p.team_id
 WHERE m.context_type = 'trade_idea' AND m.context_id = tq.id
   AND m.organization_id IS NULL;

UPDATE public.messages m SET organization_id = tm.organization_id
  FROM public.pair_trades pt
  JOIN public.portfolios p ON p.id = pt.portfolio_id
  JOIN public.teams tm ON tm.id = p.team_id
 WHERE m.context_type = 'trade_idea' AND m.context_id = pt.id
   AND m.organization_id IS NULL;

-- Report the quarantine rather than hiding it in a row count.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE 'messages quarantine (organization_id IS NULL) by context_type:';
  FOR r IN
    SELECT context_type, count(*) AS n FROM public.messages
     WHERE organization_id IS NULL GROUP BY context_type ORDER BY n DESC
  LOOP
    RAISE NOTICE '  % : %', rpad(r.context_type, 20), r.n;
  END LOOP;
END $$;

-- NOT NULL is deliberately NOT applied. It cannot be, while quarantined rows
-- exist, and forcing it would mean deleting or guessing them. Apply it in a
-- follow-up once the quarantine is resolved with Main Control.

CREATE INDEX IF NOT EXISTS idx_messages_org_context
  ON public.messages(organization_id, context_type, context_id);

-- -----------------------------------------------------------------------------
-- 3. The caller must never choose the tenant
-- -----------------------------------------------------------------------------
--
-- `current_org_id()` proves where the caller is standing, not who owns the
-- referenced object, so it is used only as the fallback for context types that
-- confer no org of their own (`asset`, `field`, `note`). For every context type
-- that HAS an owner, the owner wins and a mismatch is rejected outright — a
-- comment thread that spans two tenants is never valid.

CREATE OR REPLACE FUNCTION public.messages_set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ctx uuid;
BEGIN
  SELECT CASE NEW.context_type
    WHEN 'theme'     THEN (SELECT t.organization_id FROM themes t WHERE t.id = NEW.context_id)
    WHEN 'portfolio' THEN (SELECT tm.organization_id FROM portfolios p
                             JOIN teams tm ON tm.id = p.team_id WHERE p.id = NEW.context_id)
    WHEN 'workflow'  THEN (SELECT w.organization_id FROM workflows w WHERE w.id = NEW.context_id)
    WHEN 'quick_thought' THEN (SELECT q.organization_id FROM quick_thoughts q WHERE q.id = NEW.context_id)
    WHEN 'trade_idea' THEN COALESCE(
        (SELECT tm.organization_id FROM trade_queue_items tq
           JOIN portfolios p ON p.id = tq.portfolio_id
           JOIN teams tm ON tm.id = p.team_id WHERE tq.id = NEW.context_id),
        (SELECT tm.organization_id FROM pair_trades pt
           JOIN portfolios p ON p.id = pt.portfolio_id
           JOIN teams tm ON tm.id = p.team_id WHERE pt.id = NEW.context_id))
    ELSE NULL
  END INTO v_ctx;

  -- Context types that confer no tenant (asset, field, note) fall back to the
  -- caller's current org. That is a real weakening and it is bounded: it applies
  -- only where no owner exists to consult.
  NEW.organization_id := COALESCE(v_ctx, public.current_org_id());

  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'messages: no organization could be derived for context %/% and the caller has no current org',
      NEW.context_type, NEW.context_id;
  END IF;

  -- A caller standing in org A must not post into org B's thread, even though
  -- the derived value would be correct.
  IF v_ctx IS NOT NULL AND v_ctx IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'messages: context %/% belongs to another organization',
      NEW.context_type, NEW.context_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_messages_set_organization_id ON public.messages;
CREATE TRIGGER trg_messages_set_organization_id
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_set_organization_id();

-- -----------------------------------------------------------------------------
-- 4. Policies
-- -----------------------------------------------------------------------------
--
-- Every predicate ANDs the org condition across the whole policy. None of them
-- OR it into a branch, and none of them is `TO public` — the omitted role on the
-- old UPDATE policy is what exposed this table to `anon` in the first place.

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND organization_id = public.current_org_id());

-- Author-only delete, org-scoped. Matches the policy this replaces, plus tenancy.
DROP POLICY IF EXISTS messages_delete ON public.messages;
CREATE POLICY messages_delete ON public.messages
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.current_org_id());

-- Deliberately NO UPDATE policy. Content, author and context are immutable once
-- sent. The two legitimate mutations are the RPCs below.

REVOKE ALL ON public.messages FROM anon;
REVOKE UPDATE ON public.messages FROM authenticated;

-- -----------------------------------------------------------------------------
-- 5. The narrow mutations
-- -----------------------------------------------------------------------------
--
-- SECURITY DEFINER so they can write columns no policy allows the caller to
-- write, and scoped internally so that is all they can write. `search_path` is
-- pinned on both: every existing SECURITY DEFINER function in this database
-- leaves it unpinned, which is a separate finding (see docs/security/release-b.md
-- §"Adjacent findings") and is not repeated here.

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_message_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'mark_messages_read: no session';
  END IF;

  UPDATE public.messages
     SET is_read = true, read_at = now()
   WHERE id = ANY(p_message_ids)
     AND organization_id = public.current_org_id();   -- the caller's own tenant only

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.set_message_pinned(p_message_id uuid, p_pinned boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'set_message_pinned: no session';
  END IF;

  UPDATE public.messages
     SET is_pinned = p_pinned
   WHERE id = p_message_id
     AND organization_id = public.current_org_id();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $$;

REVOKE ALL ON FUNCTION public.mark_messages_read(uuid[])        FROM public, anon;
REVOKE ALL ON FUNCTION public.set_message_pinned(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid[])        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_message_pinned(uuid, boolean) TO authenticated;

COMMIT;

-- =============================================================================
-- REQUIRED APPLICATION CHANGE — this migration alone will break two mutations.
--
-- `authenticated` no longer holds UPDATE on messages, so these three call sites
-- must move to the RPCs before or with this step. They are the ONLY UPDATEs to
-- this table in the codebase:
--
--   MessagingSection.tsx:401    .update({is_read, read_at}).in('id', ids)
--                               -> supabase.rpc('mark_messages_read', { p_message_ids: ids })
--   MessagingSection.tsx:384    .update({is_pinned}).eq('id', id)
--   TradeIdeaDiscussion.tsx:161 .update({is_pinned}).eq('id', id)
--   TradeIdeaDetailModal.tsx:1591 .update({is_pinned}).eq('id', id)
--                               -> supabase.rpc('set_message_pinned', { p_message_id, p_pinned })
--
-- Not made on this branch: it owns security source control, not product UI.
-- Sequence with Main Control.
-- =============================================================================
