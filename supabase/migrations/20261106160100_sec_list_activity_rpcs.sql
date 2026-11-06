-- ============================================================================
-- SECURITY: list-activity RPCs stop reading across organizations
-- ============================================================================
-- Group B of the cross-tenant RPC remediation. Prepared 2026-11-06.
-- APPLIED to production (wfcebeagznzgeuyysbnt) on 2026-11-06, ledger version
-- 20261106160100. The exploit below was re-confirmed live immediately before
-- the apply and denied immediately after: an outsider read a private list's
-- activity, swept all three lists holding activity, and enumerated lists by
-- forging p_user_id. All three return zero rows now.
--
-- THE CONFIRMED EXPLOIT
-- ---------------------
-- Both functions are SECURITY DEFINER with no caller check at all, and both
-- are callable by `authenticated` through PostgREST. Reproduced on production
-- inside an aborted transaction, as an ordinary user in organization B with no
-- membership or relationship in organization A:
--
--   select * from get_list_activity_counts('<org A user uuid>');
--     -> enumerated 4 of organization A's list uuids with per-list counts
--   select * from get_latest_list_activities(array[<those uuids>]);
--     -> returned organization A's activity rows, including actor_name
--        resolved to a real EMAIL ADDRESS and metadata holding tickers
--
-- The same rows read directly, under RLS, returned 0. So RLS is correct and
-- these two functions are the hole. Chained, they turn one user uuid into a
-- roster of another organization's lists, who touched them and when.
--
-- THE FIX
-- -------
-- Both become SECURITY INVOKER, so the caller's own RLS applies, and
-- get_list_activity_counts stops trusting its p_user_id argument.
--
-- WHY INVOKER IS SAFE HERE (verified against the live policies, not assumed)
--   asset_list_activity   SELECT  EXISTS (SELECT 1 FROM asset_lists l
--                                 WHERE l.id = asset_list_activity.list_id
--                                   AND (l.created_by = auth.uid()
--                                        OR EXISTS (SELECT 1 FROM
--                                             asset_list_collaborations c
--                                           WHERE c.list_id = l.id
--                                             AND c.user_id = auth.uid())))
--   asset_list_user_state SELECT  user_id = auth.uid()
--   users                 SELECT  own row, or a member of the current org
--
-- So after the change the counts function sees exactly the activity on lists
-- the caller owns or collaborates on, its unread watermark comes from its own
-- state row, and an actor outside the caller's organization no longer resolves
-- to a name or an email: the existing COALESCE in the body already degrades
-- that case to the literal 'Someone'. No new query, no policy change.
--
-- p_user_id IS KEPT IN THE SIGNATURE AND IGNORED
-- The frontend calls get_list_activity_counts({ p_user_id: userId }) from
-- src/hooks/lists/useListSurfaces.ts:236 with the id it just read from
-- supabase.auth.getUser(), which is always auth.uid() anyway. Dropping the
-- parameter would break that call during the window between the migration and
-- the deploy, so the parameter stays and the body uses auth.uid() instead.
-- A forged argument now changes nothing.
--
-- RLS POSTURE: no policy, grant or default privilege is changed by this file.
-- The EXECUTE grants are restated as they already are, so that a database
-- rebuilt from migrations cannot silently inherit PostgreSQL's default
-- PUBLIC grant.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_list_activity_counts(p_user_id uuid)
RETURNS TABLE(list_id uuid, update_count bigint, self_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- p_user_id is accepted for call compatibility and deliberately unused:
  -- identity comes from the session, never from the argument.
  SELECT
    a.list_id,
    COUNT(*) FILTER (WHERE a.actor_id IS DISTINCT FROM (SELECT auth.uid()))::bigint AS update_count,
    COUNT(*) FILTER (WHERE a.actor_id = (SELECT auth.uid()))::bigint AS self_count
  FROM public.asset_list_activity a
  LEFT JOIN public.asset_list_user_state s
    ON s.list_id = a.list_id AND s.user_id = (SELECT auth.uid())
  WHERE a.created_at > COALESCE(s.last_opened_at, '1970-01-01'::timestamptz)
  GROUP BY a.list_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_latest_list_activities(p_list_ids uuid[])
RETURNS TABLE(list_id uuid, activity_type text, actor_name text, metadata jsonb, created_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A forged list uuid is now simply invisible: RLS on asset_list_activity
  -- filters it out before DISTINCT ON runs.
  SELECT DISTINCT ON (a.list_id)
    a.list_id,
    a.activity_type::text,
    COALESCE(
      NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
      u.email,
      'Someone'
    ) as actor_name,
    a.metadata,
    a.created_at
  FROM public.asset_list_activity a
  LEFT JOIN public.users u ON u.id = a.actor_id
  WHERE a.list_id = ANY(p_list_ids)
  ORDER BY a.list_id, a.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_list_activity_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_latest_list_activities(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_list_activity_counts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_latest_list_activities(uuid[]) TO authenticated, service_role;
