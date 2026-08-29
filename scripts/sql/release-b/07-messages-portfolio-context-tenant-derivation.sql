-- =============================================================================
-- Security follow-up 07 — portfolio-context message tenant derivation
--
-- STATUS: not executed anywhere. Staging synthetic validation plan in
--         docs/security/c1-checkpoint.md. Production remains read-only.
-- RUN ORDER: independent of 01-06. `messages` only. No policy is changed.
--
-- ── The defect, verified live on production 2026-08-28 ──────────────────────
--
-- The deployed `messages_set_organization_id()` resolves a portfolio-context
-- message like this:
--
--     WHEN 'portfolio' THEN (SELECT tm.organization_id FROM portfolios p
--                              JOIN teams tm ON tm.id = p.team_id
--                             WHERE p.id = NEW.context_id)
--
-- That is an INNER JOIN through `portfolios.team_id`. On production **33 of 36
-- portfolios have `team_id IS NULL`**, so for those the branch yields NULL.
-- This is the same defect that quarantined 13 trade_idea messages in Release B,
-- left in the one branch `06` did not touch.
--
-- Here it is worse than a quarantine, because of what happens next:
--
--     NEW.organization_id := COALESCE(v_ctx, public.current_org_id());
--     ...
--     IF v_ctx IS NOT NULL AND v_ctx IS DISTINCT FROM public.current_org_id()
--       THEN RAISE ... 'belongs to another organization';
--
-- With `v_ctx` NULL the row is stamped with the CALLER's org, and the cross-org
-- guard is skipped entirely — it only fires when `v_ctx IS NOT NULL`. So a user
-- in org A could post a portfolio-context message against org B's team-less
-- portfolio, and it would be stored as org A's and be readable in org A.
--
-- Currently LATENT: production holds 21 trade_idea, 20 asset and 3 theme
-- messages, and zero portfolio-context messages. It would fire on first use.
--
-- ── The fix, and the part that is not just a LEFT JOIN ──────────────────────
--
-- 1. The portfolio branch resolves the way the trade_idea branch already does:
--    LEFT JOIN teams, COALESCE(p.organization_id, tm.organization_id).
--    `portfolios.organization_id` is NOT NULL on production (36/36) and is the
--    column `portfolio_in_current_org()` already enforces against; `teams` is
--    kept as a second source so nothing that resolved before stops resolving.
--    Verified: 0 disagreements between the two on production.
--
-- 2. A context type that OWNS a tenant must never fall through to
--    `current_org_id()`. Falling back is only defensible where no owner exists
--    to consult (asset, field, note — the global context types). For theme,
--    portfolio, workflow, quick_thought and trade_idea, an unresolved parent
--    means "this parent is missing or unreadable", and the correct answer is to
--    refuse, not to guess the caller's org. That closes the guard-bypass above
--    for every owner-bearing branch at once, rather than only for portfolio.
--
-- 3. The strict rule is applied on INSERT, and on UPDATE only when the context
--    actually moves. Production still holds 4 trade_idea messages whose parent
--    row no longer exists (true orphans, deliberately quarantined by 06). The
--    trigger is BEFORE INSERT OR UPDATE, so an unconditional strict rule would
--    make any future UPDATE of those rows raise. Keeping the previous
--    organization_id when the context is unchanged means this cannot regress a
--    row that already exists.
--
-- Not changed: messages_select, any policy, any grant, the RPCs, or the
-- theme/workflow/quick_thought/trade_idea resolution logic.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.messages_set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ctx           uuid;
  v_owner_bearing boolean;
  v_context_moved boolean;
BEGIN
  -- Context types that carry a tenant of their own. For these, an unresolved
  -- parent is an error, never an invitation to use the caller's org.
  v_owner_bearing := NEW.context_type IN
    ('theme', 'portfolio', 'workflow', 'quick_thought', 'trade_idea');

  v_context_moved := (TG_OP = 'INSERT')
    OR (NEW.context_type IS DISTINCT FROM OLD.context_type)
    OR (NEW.context_id   IS DISTINCT FROM OLD.context_id);

  SELECT CASE NEW.context_type
    WHEN 'theme'     THEN (SELECT t.organization_id FROM themes t WHERE t.id = NEW.context_id)
    -- CHANGED: LEFT JOIN + COALESCE, so a team-less portfolio resolves through
    -- portfolios.organization_id instead of yielding NULL.
    WHEN 'portfolio' THEN (SELECT COALESCE(p.organization_id, tm.organization_id)
                             FROM portfolios p
                             LEFT JOIN teams tm ON tm.id = p.team_id
                            WHERE p.id = NEW.context_id)
    WHEN 'workflow'  THEN (SELECT w.organization_id FROM workflows w WHERE w.id = NEW.context_id)
    WHEN 'quick_thought' THEN (SELECT q.organization_id FROM quick_thoughts q WHERE q.id = NEW.context_id)
    WHEN 'trade_idea' THEN COALESCE(
        (SELECT COALESCE(p.organization_id, tm.organization_id)
           FROM trade_queue_items tq
           JOIN portfolios p ON p.id = tq.portfolio_id
           LEFT JOIN teams tm ON tm.id = p.team_id
          WHERE tq.id = NEW.context_id),
        (SELECT COALESCE(p.organization_id, tm.organization_id)
           FROM pair_trades pt
           JOIN portfolios p ON p.id = pt.portfolio_id
           LEFT JOIN teams tm ON tm.id = p.team_id
          WHERE pt.id = NEW.context_id))
    ELSE NULL
  END INTO v_ctx;

  -- An owner-bearing context that did not resolve is refused outright. This is
  -- the guard-bypass fix: previously such a row was silently stamped with
  -- current_org_id() and skipped the cross-org check below.
  IF v_owner_bearing AND v_ctx IS NULL AND v_context_moved THEN
    RAISE EXCEPTION
      'messages: context %/% has no resolvable organization; refusing to attribute it to the caller',
      NEW.context_type, NEW.context_id;
  END IF;

  IF v_ctx IS NOT NULL THEN
    NEW.organization_id := v_ctx;
  ELSIF TG_OP = 'UPDATE' AND NOT v_context_moved THEN
    -- Context unchanged and unresolvable (a pre-existing orphan). Preserve what
    -- the row already had rather than re-deriving it.
    NEW.organization_id := OLD.organization_id;
  ELSE
    -- Only the genuinely tenant-less context types reach here.
    NEW.organization_id := public.current_org_id();
  END IF;

  IF NEW.organization_id IS NULL AND v_context_moved THEN
    RAISE EXCEPTION
      'messages: no organization could be derived for context %/% and the caller has no current org',
      NEW.context_type, NEW.context_id;
  END IF;

  -- A caller standing in org A must not post into org B's thread. Now reached
  -- for every owner-bearing context, including a team-less portfolio.
  IF v_ctx IS NOT NULL AND v_ctx IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'messages: context %/% belongs to another organization',
      NEW.context_type, NEW.context_id;
  END IF;

  RETURN NEW;
END $function$;

-- -----------------------------------------------------------------------------
-- Prove the shape landed. No data assertion: production has zero
-- portfolio-context messages, so there is nothing to backfill or count.
-- -----------------------------------------------------------------------------
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'messages_set_organization_id';

  IF d !~ 'LEFT JOIN teams tm ON tm.id = p.team_id\s*WHERE p.id = NEW.context_id' THEN
    RAISE EXCEPTION 'portfolio branch did not take the LEFT JOIN form';
  END IF;
  IF d !~ 'refusing to attribute it to the caller' THEN
    RAISE EXCEPTION 'owner-bearing guard is missing';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='messages_set_organization_id') THEN
    RAISE EXCEPTION 'function lost SECURITY DEFINER';
  END IF;

  RAISE NOTICE 'messages_set_organization_id(): portfolio branch fixed, owner-bearing contexts can no longer fall back to the caller org.';
END $$;

COMMIT;

-- =============================================================================
-- ROLLBACK
--
-- Restore the previously deployed definition, verbatim, from production as read
-- on 2026-08-28. Rolling back reinstates the latent defect described above.
--
--   CREATE OR REPLACE FUNCTION public.messages_set_organization_id()
--   ... WHEN 'portfolio' THEN (SELECT tm.organization_id FROM portfolios p
--                                JOIN teams tm ON tm.id = p.team_id
--                               WHERE p.id = NEW.context_id) ...
--
-- The full prior body is recorded in the C1 checkpoint document rather than
-- inlined here, so that this file has exactly one definition of the function in
-- it and cannot be run in the wrong direction by accident.
-- =============================================================================
