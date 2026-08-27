-- ============================================================================
-- quick_thoughts — Stage A/3: an authorized path for cross-org Ops reads
-- ============================================================================
--
-- ── Why this has to exist before the policies change ──────────────────────
--
-- The Operations Portal reads quick_thoughts across every tenant on purpose:
-- client engagement, the pilot funnel, the top-users leaderboard. Today those
-- reads run as a plain `authenticated` user and succeed only because the
-- SELECT policy on quick_thoughts is `TO public` with no organization
-- predicate — the same permissiveness this work exists to remove.
--
-- `OpsGuard` does call `is_platform_admin()`, but in the browser. It decides
-- whether to render the page; it does not authorize the data. Every ops query
-- underneath is an ordinary PostgREST call. So the portal is gated by a React
-- component, and the database is gated by nothing.
--
-- Tightening the policies without this would silently break Ops: the queries
-- would still return 200, just with the caller's own organization in them. A
-- leaderboard that quietly counts one tenant is worse than one that errors.
--
-- The fix is not to keep normal RLS loose. It is to give the intentional
-- cross-org read its own explicitly authorized door, and this is that door —
-- built on the mechanism the codebase already uses for exactly this: the
-- `platform_admins` table and `is_platform_admin()`, which already gate 19
-- other RPCs with the same `RAISE EXCEPTION 'Platform admin required'` shape.
--
-- ── Shape ─────────────────────────────────────────────────────────────────
--
-- One function, because every ops call site reduces to the same question:
-- how many quick_thoughts did each of these authors write, optionally since a
-- date, optionally of one idea_type, optionally excluding archived. Callers
-- that want a total sum the rows; callers that want distinct authors count
-- them. That covers the engagement counts, the funnel signals, the metrics
-- page and the leaderboard without inventing four near-identical RPCs.
--
-- Returns author ids, counts, and each author's earliest matching timestamp.
-- No `content`, ever — an Ops aggregate has no business carrying another
-- tenant's research prose across the wire.
--
-- `first_created_at` exists for the activation-rate / time-to-value metric on
-- OpsMetricsPage, which needs each user's FIRST action date. That call site
-- read quick_thoughts through a dynamic `supabase.from(table)` inside a loop
-- over a table list — a shape no scanner matches, so it would have survived
-- this whole change and then quietly reported time-to-value for one tenant.
-- Returning the aggregate here is what lets that loop stop touching the table.

DROP FUNCTION IF EXISTS public.ops_quick_thought_activity(UUID[], TIMESTAMPTZ, TEXT, BOOLEAN);

CREATE FUNCTION public.ops_quick_thought_activity(
  p_user_ids         UUID[]      DEFAULT NULL,
  p_since            TIMESTAMPTZ DEFAULT NULL,
  p_idea_type        TEXT        DEFAULT NULL,
  p_exclude_archived BOOLEAN     DEFAULT FALSE
)
RETURNS TABLE (created_by UUID, thought_count BIGINT, first_created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin required';
  END IF;

  RETURN QUERY
  SELECT q.created_by, count(*)::BIGINT, min(q.created_at)
  FROM public.quick_thoughts q
  WHERE (p_user_ids IS NULL OR q.created_by = ANY (p_user_ids))
    AND (p_since IS NULL OR q.created_at >= p_since)
    AND (p_idea_type IS NULL OR q.idea_type::TEXT = p_idea_type)
    AND (NOT p_exclude_archived OR q.is_archived IS NOT TRUE)
  GROUP BY q.created_by;
END;
$$;

-- `authenticated` may call it; the gate is inside, so an ordinary user gets
-- 'Platform admin required' rather than a silently empty result. `anon` has no
-- business here at all.
REVOKE ALL ON FUNCTION public.ops_quick_thought_activity(UUID[], TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_quick_thought_activity(UUID[], TIMESTAMPTZ, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_quick_thought_activity(UUID[], TIMESTAMPTZ, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_quick_thought_activity(UUID[], TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.ops_quick_thought_activity(UUID[], TIMESTAMPTZ, TEXT, BOOLEAN) IS
  'Platform-admin-only cross-tenant quick_thoughts activity counts. Authorized by is_platform_admin(); returns author ids and counts, never content.';
