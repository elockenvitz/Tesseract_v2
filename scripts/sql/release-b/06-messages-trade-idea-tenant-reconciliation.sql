-- =============================================================================
-- Security Release B · follow-up — restore 13 deterministic trade_idea messages
--
-- RUN ORDER: staging first, then production, by Main Control only.
-- SCOPE: `messages` only. No other table, policy or function is touched.
--
-- ── What went wrong ─────────────────────────────────────────────────────────
--
-- 02-messages-permanent.sql derived the tenant for a trade_idea message through
--
--     trade_queue_items -> portfolios -> teams -> teams.organization_id
--
-- On production 13 of the 17 live-parent trade_idea messages hang off
-- portfolios whose `team_id IS NULL`, so that join dropped them and they
-- quarantined to NULL. Every one of those portfolios has
-- `portfolios.organization_id` populated — and that is the column the product
-- already treats as authoritative: `portfolio_in_current_org()`, the predicate
-- guarding portfolio_team, reads `portfolios.organization_id` and nothing else.
--
-- So the rows were never ambiguous. The derivation asked the wrong table.
--
-- ── Why COALESCE is legitimate here, and in this order ──────────────────────
--
-- Both columns are real representations of the same tenant, and they agree:
-- verified read-only on production, of the 3 portfolios that have a team, ZERO
-- disagree with their team's organization_id. So this is not a guess between
-- two candidate answers; it is one answer reachable by two paths, one of which
-- is total and one of which is not.
--
-- Precedence is `portfolios.organization_id` FIRST because it is:
--   * always populated (0 NULL on production),
--   * the column RLS already enforces against, and
--   * independent of whether a portfolio has been placed in a team.
--
-- `teams.organization_id` is kept as the second branch rather than deleted, so
-- a portfolio that somehow lacks its own org still resolves the way it did
-- before this change. Nothing that resolved yesterday stops resolving.
--
-- ── What is deliberately NOT restored ───────────────────────────────────────
--
--   20 `asset`-context messages — assets are global; no tenant exists to find.
--    4 `trade_idea` messages    — their context_id is in no table at all
--                                 (trade_queue_items, pair_trades,
--                                 accepted_trades, simulations, assets all
--                                 miss). The parent was deleted. Guessing an
--                                 owner for an orphan is the thing the
--                                 quick_thoughts precedent exists to forbid.
--
-- Expected: 37 quarantined before -> 24 after. No other context_type changes.
--
-- ── Why the trigger is disabled around the backfill ─────────────────────────
--
-- `trg_messages_set_organization_id` is BEFORE INSERT **OR UPDATE**, so the
-- backfill's own UPDATE fires it, and the trigger overwrites whatever the SET
-- clause assigned with `COALESCE(v_ctx, current_org_id())`. Run as `postgres`
-- through the Management API there is no session org, so:
--
--   * with the OLD function, v_ctx is NULL for exactly these 13 rows (that is
--     the bug), current_org_id() is NULL too, and the NULL guard raises —
--     the backfill dies on its first row;
--   * with the NEW function, v_ctx resolves to the portfolio's org, which then
--     trips the cross-org guard because it differs from a NULL current_org_id().
--
-- Either way the statement aborts. So the function is replaced FIRST, the
-- trigger is disabled for the duration of the backfill only, and re-enabled
-- inside the same transaction. If this transaction rolls back, the trigger
-- comes back with it.
--
-- ── Known, out of scope, reported not fixed ─────────────────────────────────
--
-- The `portfolio` branch of messages_set_organization_id() has the SAME defect:
-- it resolves through `teams` only. Production has zero portfolio-context
-- messages today, so nothing is quarantined by it — but a portfolio without a
-- team would yield v_ctx = NULL, which also skips the cross-org posting guard
-- below it. That is a separate one-line change and is left for a reviewed
-- follow-up rather than folded into this reconciliation.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The trigger, so new messages use the same authoritative source
-- -----------------------------------------------------------------------------
-- Byte-for-byte the deployed function with ONE change: the two trade_idea
-- branches now read COALESCE(p.organization_id, tm.organization_id) and LEFT
-- JOIN teams, so a team-less portfolio resolves instead of falling through to
-- current_org_id(). Everything else — the theme/portfolio/workflow/
-- quick_thought branches, the current_org_id() fallback, the NULL guard and the
-- cross-org posting guard — is unchanged.

CREATE OR REPLACE FUNCTION public.messages_set_organization_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ctx uuid;
BEGIN
  SELECT CASE NEW.context_type
    WHEN 'theme'     THEN (SELECT t.organization_id FROM themes t WHERE t.id = NEW.context_id)
    WHEN 'portfolio' THEN (SELECT tm.organization_id FROM portfolios p
                             JOIN teams tm ON tm.id = p.team_id WHERE p.id = NEW.context_id)
    WHEN 'workflow'  THEN (SELECT w.organization_id FROM workflows w WHERE w.id = NEW.context_id)
    WHEN 'quick_thought' THEN (SELECT q.organization_id FROM quick_thoughts q WHERE q.id = NEW.context_id)
    -- portfolios.organization_id first: it is the column portfolio_in_current_org()
    -- enforces against, it is always populated, and it does not depend on the
    -- portfolio having been placed in a team. teams.organization_id is retained
    -- as a second branch so nothing that resolved before stops resolving; the
    -- two never disagree on production.
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
END $function$;

ALTER TABLE public.messages DISABLE TRIGGER trg_messages_set_organization_id;

-- -----------------------------------------------------------------------------
-- 2. Historical backfill — only rows with a live parent and an unambiguous org
-- -----------------------------------------------------------------------------
-- `organization_id IS NULL` keeps this idempotent and stops it touching any row
-- that already resolved. `p.organization_id IS NOT NULL` is what makes it a
-- derivation rather than a guess: a portfolio with no org of its own is left
-- quarantined.

UPDATE public.messages m
   SET organization_id = p.organization_id
  FROM public.trade_queue_items tq
  JOIN public.portfolios p ON p.id = tq.portfolio_id
 WHERE m.context_type   = 'trade_idea'
   AND m.context_id     = tq.id
   AND m.organization_id IS NULL
   AND p.organization_id IS NOT NULL;

UPDATE public.messages m
   SET organization_id = p.organization_id
  FROM public.pair_trades pt
  JOIN public.portfolios p ON p.id = pt.portfolio_id
 WHERE m.context_type   = 'trade_idea'
   AND m.context_id     = pt.id
   AND m.organization_id IS NULL
   AND p.organization_id IS NOT NULL;

ALTER TABLE public.messages ENABLE TRIGGER trg_messages_set_organization_id;

-- -----------------------------------------------------------------------------
-- 3. Prove the outcome rather than assume it
-- -----------------------------------------------------------------------------
-- Refuses to commit if a row resolved that should not have, or if any row that
-- still has a live parent and an available org is left behind.

DO $$
DECLARE
  v_still_recoverable int;
  v_orphans           int;
  v_asset             int;
  v_bad_context       int;
BEGIN
  SELECT count(*) INTO v_still_recoverable
    FROM public.messages m
    JOIN public.trade_queue_items tq ON tq.id = m.context_id
    JOIN public.portfolios p ON p.id = tq.portfolio_id
   WHERE m.context_type = 'trade_idea' AND m.organization_id IS NULL
     AND p.organization_id IS NOT NULL;

  IF v_still_recoverable > 0 THEN
    RAISE EXCEPTION 'reconciliation incomplete: % recoverable trade_idea message(s) are still quarantined', v_still_recoverable;
  END IF;

  SELECT count(*) INTO v_orphans
    FROM public.messages m
   WHERE m.context_type = 'trade_idea' AND m.organization_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.trade_queue_items tq WHERE tq.id = m.context_id)
     AND NOT EXISTS (SELECT 1 FROM public.pair_trades pt WHERE pt.id = m.context_id);

  SELECT count(*) INTO v_asset
    FROM public.messages WHERE context_type = 'asset' AND organization_id IS NULL;

  -- Nothing outside the two intended buckets may still be quarantined.
  SELECT count(*) INTO v_bad_context
    FROM public.messages
   WHERE organization_id IS NULL AND context_type NOT IN ('asset', 'trade_idea');

  IF v_bad_context > 0 THEN
    RAISE EXCEPTION 'unexpected: % quarantined message(s) outside asset/trade_idea', v_bad_context;
  END IF;

  RAISE NOTICE 'messages reconciled: % asset + % orphan trade_idea remain quarantined, by design.', v_asset, v_orphans;
END $$;

COMMIT;
