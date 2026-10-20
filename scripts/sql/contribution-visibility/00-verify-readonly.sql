-- ============================================================================
-- contribution-visibility / 00 — READ-ONLY ASSESSMENT
--
-- NOTHING HERE WRITES. Every statement is a SELECT.
--
-- Three questions this has to answer before 10- can be applied:
--   (a) do production's policies match the ones in version control (C1/06,
--       C1/07, C1/08)? Migrations do not describe production in this repo.
--   (b) how many contributions are currently exposed beyond their stated
--       visibility, and through which of the three paths?
--   (c) will the fix REMOVE access somebody legitimately has today? It will,
--       for rows whose visibility targets were destroyed by the client bug
--       (V3 in docs/contribution-visibility-assessment.md). Q6 counts them.
--       That number decides whether the fix ships alone or with a remediation.
-- ============================================================================

-- Q1. Every policy on the four tables that can expose contribution prose.
--     Compare against C1/06, C1/07, C1/08 — drift here invalidates 10-.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('asset_contributions', 'contribution_visibility_targets',
                    'asset_contribution_history', 'asset_revisions',
                    'asset_revision_events', 'asset_field_history')
ORDER BY tablename, cmd, policyname;

-- Q2. Anything ELSE that can read contribution prose: views (a view runs with
--     its owner's rights unless security_invoker is set), SECURITY DEFINER
--     functions, and RPCs. This is the independent-exposure question.
SELECT c.relname AS object,
       c.relkind,                                  -- v = view, m = matview
       COALESCE((SELECT option_value
                   FROM pg_options_to_table(c.reloptions)
                  WHERE option_name = 'security_invoker'), 'false') AS security_invoker
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v','m')
  AND pg_get_viewdef(c.oid) ~* '(asset_contributions|asset_contribution_history|asset_revision_events)'
ORDER BY 1;

SELECT p.proname,
       p.prosecdef AS security_definer,
       pg_get_function_identity_arguments(p.oid) AS args,
       array(SELECT a.rolname FROM pg_roles a
              WHERE has_function_privilege(a.rolname, p.oid, 'EXECUTE')
                AND a.rolname IN ('anon','authenticated')) AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ~* '(asset_contributions|asset_contribution_history|asset_revision_events)'
ORDER BY p.prosecdef DESC, p.proname;

-- Q3. Table-level grants. A column-level or table-level grant to anon on any
--     of these would expose research without needing a policy at all.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated','PUBLIC')
  AND table_name IN ('asset_contributions','contribution_visibility_targets',
                     'asset_contribution_history','asset_revisions','asset_revision_events')
ORDER BY table_name, grantee, privilege_type;

-- Q4. V2 BLAST RADIUS — contributions whose stated visibility is narrower than
--     'firm' but which the `OR team_id IS NULL` branch makes org-readable.
SELECT ac.visibility,
       (ac.team_id IS NULL)                                        AS team_id_null,
       (SELECT count(*) FROM public.contribution_visibility_targets t
         WHERE t.contribution_id = ac.id)                          AS target_rows,
       count(*)                                                    AS contributions,
       round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 1) AS pct_of_all
FROM public.asset_contributions ac
WHERE coalesce(ac.is_archived, false) = false
GROUP BY 1, 2, 3
ORDER BY contributions DESC;

-- Q5. V2, stated as the single number that matters: restricted contributions
--     readable by the whole organization RIGHT NOW.
SELECT count(*) AS exposed_by_team_id_null
FROM public.asset_contributions ac
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND ac.team_id IS NULL;

-- Q6. WHAT THE FIX WILL TAKE AWAY. A non-firm contribution with ZERO target
--     rows cannot name anybody, so after 10- it is owner-only. Where the
--     targets were destroyed by the client bug rather than never set, somebody
--     could legitimately read it this morning and cannot this afternoon.
--     Do not apply 10- without deciding what happens to these.
SELECT ac.id, a.symbol, ac.section, ac.visibility, ac.created_by,
       ac.created_at, ac.updated_at
FROM public.asset_contributions ac
JOIN public.assets a ON a.id = ac.asset_id
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND ac.team_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.contribution_visibility_targets t
                   WHERE t.contribution_id = ac.id)
ORDER BY ac.updated_at DESC;

-- Q7. V1/V3 BLAST RADIUS — restricted contributions whose prose is readable
--     org-wide through the history and revision tables REGARDLESS of
--     team_id. These two paths need no precondition at all.
SELECT 'asset_contribution_history' AS path,
       count(DISTINCT h.contribution_id) AS restricted_contributions_exposed,
       count(*)                          AS rows_carrying_prose
FROM public.asset_contribution_history h
JOIN public.asset_contributions ac ON ac.id = h.contribution_id
WHERE ac.visibility <> 'firm'
  AND public.contribution_prose_identity_or_raw(h.new_content) <> ''
UNION ALL
SELECT 'asset_revision_events',
       count(DISTINCT ac.id),
       count(*)
FROM public.asset_revision_events e
JOIN public.asset_revisions r  ON r.id = e.revision_id
JOIN public.asset_contributions ac
     ON ac.asset_id = r.asset_id AND ac.section = e.field_key
WHERE ac.visibility <> 'firm'
  AND coalesce(e.after_value, '') <> '';

-- NOTE on Q7: `contribution_prose_identity_or_raw` does NOT exist — it is named
-- here deliberately so this query FAILS LOUDLY rather than silently reporting
-- zero if run before the helper exists. Replace with `btrim(coalesce(
-- h.new_content,''))` to run it standalone; the freshness lane's
-- `contribution_prose_identity` is NOT a dependency of this lane and must not
-- be installed to satisfy it.

-- Q8. THE OPEN DESIGN QUESTION — does a department/division target need to
--     cascade to descendant nodes?
--
--     If members are attached to leaf team nodes and a contribution targets
--     their DEPARTMENT, the membership EXISTS check finds nothing and the fix
--     makes it owner-only: legitimate access lost. If members are attached at
--     every level, no cascade is needed and the flat check is correct.
--     This cannot be decided from the repo. It must be read.
SELECT n.node_type,
       count(*)                                           AS nodes,
       count(*) FILTER (WHERE m.direct_members > 0)       AS nodes_with_direct_members,
       sum(m.direct_members)                              AS total_direct_memberships
FROM public.org_chart_nodes n
LEFT JOIN (SELECT node_id, count(*) AS direct_members
             FROM public.org_chart_node_members GROUP BY node_id) m
       ON m.node_id = n.id
GROUP BY n.node_type
ORDER BY nodes DESC;

-- Q8b. Which node types are actually being TARGETED by contributions, and do
--      those nodes have direct members? A targeted node type with no direct
--      memberships is the cascade problem, in production, with a count.
SELECT n.node_type,
       count(DISTINCT t.contribution_id)                  AS contributions_targeting,
       count(DISTINCT t.node_id)                          AS distinct_nodes_targeted,
       count(DISTINCT t.node_id) FILTER (
         WHERE EXISTS (SELECT 1 FROM public.org_chart_node_members m
                        WHERE m.node_id = t.node_id))     AS targeted_nodes_with_members
FROM public.contribution_visibility_targets t
JOIN public.org_chart_nodes n ON n.id = t.node_id
GROUP BY n.node_type
ORDER BY contributions_targeting DESC;

-- Q9. Does org_chart_nodes even have a hierarchy column? Decides whether a
--     cascade is expressible at all.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'org_chart_nodes'
ORDER BY ordinal_position;
