-- Ops client detail: metrics attributable to the org being VIEWED.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `OpsClientDetailPage` reported a brand-new pilot org as having 1 note and
-- 0 portfolios. Both were wrong, in opposite directions, from one cause:
-- the page reads tenant tables directly as the operator, so RLS resolves
-- them against the operator's OWN current org rather than the org on screen.
--
--   portfolios  the query says `organization_id = <viewed org>`, RLS says
--               `organization_id = current_org_id()`. The intersection with
--               any other org is empty, so a real portfolio read as zero.
--
--   asset_notes the query carried NO organization predicate at all — only
--               `created_by IN (member ids)`. The row it counted was an
--               eight-day-old note with `organization_id IS NULL`, created
--               before the org existed, surfaced by the "authors can view
--               their own unattributed notes" policy.
--
-- `OpsGuard` does not help: it calls `is_platform_admin()` in the browser
-- and decides whether to RENDER. It has never authorized data.
--
-- ── Why an RPC and not wider RLS ───────────────────────────────────────────
--
-- This follows `ops_quick_thought_activity` (20260827090300), the house
-- pattern for exactly this problem: SECURITY DEFINER, an internal
-- `is_platform_admin()` check that RAISEs, a pinned search_path, no PUBLIC
-- or anon EXECUTE, and AGGREGATES rather than rows.
--
-- The alternative — adding platform-admin SELECT policies to `asset_notes`
-- and friends — would hand ops staff the note and rating CONTENT of every
-- tenant in order to answer "how many". That is a far larger grant for the
-- same number, and it is not needed: the page renders counts.
--
-- ── Attribution rules, applied literally ───────────────────────────────────
--
--   * Membership is never attribution. "This user belongs to the org" says
--     nothing about where a row was written; that assumption is the bug.
--   * Every metric is filtered on the row's own `organization_id = p_org_id`.
--   * `organization_id IS NULL` counts toward NO org. Those rows are not
--     unassigned-to-this-org, they are unattributed everywhere, and an
--     equality predicate excludes them without special-casing.
--   * Where a table has no `organization_id`, org is derived through its
--     authoritative parent. None of the metrics here need that hop:
--     every table below carries the column. (`accepted_trades` and
--     `lab_variants` do not, and are out of scope — see the note at the end.)
--
-- Production coverage checked before writing this: organization_id is
-- populated on 56/58 asset_notes, 3463/3465 user_sessions, 18/20
-- quick_thoughts, 32/32 asset_contributions, 10/10 theme_notes. The gaps are
-- exactly the unattributed rows that should now stop counting.

BEGIN;

-- ── Engagement aggregates ──────────────────────────────────────────────────
--
-- One row. Counts only: no note bodies, no rating values, no titles. An ops
-- operator learns that a client wrote four notes, not what they said.
CREATE OR REPLACE FUNCTION public.ops_client_engagement(
  p_org_id uuid,
  p_since  timestamptz DEFAULT NULL
)
RETURNS TABLE (
  notes                bigint,
  ratings              bigint,
  ideas                bigint,
  trade_ideas          bigint,
  sessions             bigint,
  avg_duration_seconds integer,
  portfolio_count      bigint,
  active_portfolios    bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Authorization at the data layer, not in React. Same shape and same
  -- message as every other platform-admin RPC in this schema.
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin required';
  END IF;

  -- A NULL org would make every predicate below `= NULL`, which is never
  -- true — the function would return zeros and look like an inactive client
  -- rather than a programming error. Refuse instead.
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM asset_notes n
       WHERE n.organization_id = p_org_id
         AND (p_since IS NULL OR n.created_at >= p_since)),

    (SELECT count(*) FROM analyst_ratings r
       WHERE r.organization_id = p_org_id
         AND (p_since IS NULL OR r.updated_at >= p_since)),

    -- Quick thoughts split by kind, the same split the page shows. Archived
    -- excluded from `ideas` to match the existing call site's
    -- `excludeArchived: true`; trade ideas are counted regardless, as before.
    (SELECT count(*) FROM quick_thoughts q
       WHERE q.organization_id = p_org_id
         AND q.is_archived IS NOT TRUE
         AND (p_since IS NULL OR q.created_at >= p_since)),

    (SELECT count(*) FROM quick_thoughts q
       WHERE q.organization_id = p_org_id
         AND q.idea_type::text = 'trade_idea'
         AND (p_since IS NULL OR q.created_at >= p_since)),

    (SELECT count(*) FROM user_sessions s
       WHERE s.organization_id = p_org_id
         AND s.duration_seconds IS NOT NULL
         AND (p_since IS NULL OR s.started_at >= p_since)),

    -- Rounded here rather than in the client so both the average and the
    -- session count come from one filtered set and cannot disagree.
    (SELECT coalesce(round(avg(s.duration_seconds))::integer, 0)
       FROM user_sessions s
       WHERE s.organization_id = p_org_id
         AND s.duration_seconds IS NOT NULL
         AND (p_since IS NULL OR s.started_at >= p_since)),

    -- Portfolios are lifetime, not windowed: "this client has 1 portfolio"
    -- is a fact about the org, not about the last 30 days.
    (SELECT count(*) FROM portfolios p WHERE p.organization_id = p_org_id),

    (SELECT count(*) FROM portfolios p
       WHERE p.organization_id = p_org_id AND p.is_active IS TRUE);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_client_engagement(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_client_engagement(uuid, timestamptz) TO authenticated, service_role;

-- ── Minimal portfolio metadata ─────────────────────────────────────────────
--
-- The page lists portfolio name and active state, so a count alone will not
-- serve it. This returns the four columns it actually renders and nothing
-- else — no strategy, no benchmark, no AUM, no holdings.
--
-- Deliberately NOT a platform-admin SELECT policy on `portfolios`: that
-- would expose every column of every tenant's portfolios to satisfy one
-- panel that needs three.
CREATE OR REPLACE FUNCTION public.ops_client_portfolios(p_org_id uuid)
RETURNS TABLE (
  id         uuid,
  name       text,
  is_active  boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin required';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.is_active, p.created_at
  FROM portfolios p
  WHERE p.organization_id = p_org_id
  ORDER BY p.name;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_client_portfolios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_client_portfolios(uuid) TO authenticated, service_role;

-- ── Prove the negatives ────────────────────────────────────────────────────
--
-- A SECURITY DEFINER function that anon can execute is a hole with a
-- friendly name, and these two read every tenant's rows. Asserted here so
-- the grant cannot be widened later without this failing.
DO $check$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('ops_client_engagement', 'ops_client_portfolios')
    AND (
      -- EXECUTE to PUBLIC shows as a grantee-less entry in proacl.
      array_to_string(p.proacl, ',') LIKE '=X/%'
      OR array_to_string(p.proacl, ',') LIKE '%anon=X%'
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ops_client_* must not grant EXECUTE to PUBLIC or anon (% offending)', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('ops_client_engagement', 'ops_client_portfolios')
    AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=public' = ANY(p.proconfig)));

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ops_client_* must be SECURITY DEFINER with a pinned search_path (% offending)', v_bad;
  END IF;
END;
$check$;

COMMIT;

-- ── Deliberately out of scope ──────────────────────────────────────────────
--
-- `ops_quick_thought_activity` is NOT changed. Its remaining callers —
-- OpsDashboardPage and OpsMetricsPage — aggregate platform-wide across every
-- tenant on purpose, which is what that function does correctly. The
-- cross-org attribution bug existed only where it was used PER ORG, and
-- those four call sites in OpsClientDetailPage are superseded here. Changing
-- the shared function would have altered behaviour its other consumers rely
-- on to fix a caller-side mistake.
--
-- Also untouched, and still wrong on that page: the post-graduation artifact
-- block (themes, contributions, prompt history, lists, trade queue) and the
-- artifact-derived signals block (lab_variants, accepted_trades, comments).
-- They have the same defect. `user_quick_prompt_history` in particular has
-- NO organization_id and no authoritative parent carrying one, so it cannot
-- be attributed to an org at all without a schema change — and guessing from
-- membership is the rule this migration exists to enforce.
