-- ============================================================================
-- contribution-visibility / 01 — PRE-APPROVAL CHECKLIST  (READ-ONLY)
--
-- Nine numbers to put in front of a go/no-go decision. Every statement is a
-- SELECT; nothing here writes. Run after 00-verify-readonly.sql, which proves
-- production's policies are the ones being replaced.
--
-- Fill in the right-hand column and attach it to the approval.
--
--   #  what                                                  expected        actual
--   1  restricted contributions readable org-wide today       > 0 = the leak  ____
--   2  …of those, how many have NO targets at all            these go        ____
--      (audience destroyed; owner-only after the fix)         owner-only
--   3  …how many have targets intact                          these keep     ____
--      (multi-target; restriction restored by the fix)         their audience
--   4  restricted contributions exposed via history           unconditional  ____
--   5  restricted contributions exposed via revision events   unconditional  ____
--   6  contributions that LOSE a reader because of the fix    the cost       ____
--   7  department/division targets whose node has no members  descent gap    ____
--   8  distinct users who lose access to something            who to tell    ____
--   9  orphaned revision events (prose, no contribution)      denied after   ____
-- ============================================================================

-- 1. The headline number. Restricted contributions the whole organization can
--    read right now, through the team_id-NULL branch.
SELECT count(*) AS n_1_exposed_now
FROM public.asset_contributions
WHERE coalesce(is_archived, false) = false
  AND visibility <> 'firm'
  AND team_id IS NULL;

-- 2 and 3. Split that by whether the audience still exists. The split matters
--    because the two halves get different outcomes from the same fix:
--      targets intact  → the restriction is RESTORED to the intended audience
--      no targets      → owner-only, because nothing records who it was for
SELECT CASE WHEN t.n > 0 THEN '3_targets_intact_restriction_restored'
            ELSE            '2_no_targets_becomes_owner_only' END AS bucket,
       count(*) AS contributions,
       count(DISTINCT ac.created_by) AS distinct_authors
FROM public.asset_contributions ac
CROSS JOIN LATERAL (
  SELECT count(*) AS n FROM public.contribution_visibility_targets v
   WHERE v.contribution_id = ac.id
) t
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND ac.team_id IS NULL
GROUP BY 1
ORDER BY 1;

-- 4. The unconditional path: restricted contributions whose prose is readable
--    org-wide through history, regardless of team_id.
SELECT count(DISTINCT ac.id) AS n_4_restricted_with_exposed_history,
       count(*)              AS history_rows_carrying_prose
FROM public.asset_contribution_history h
JOIN public.asset_contributions ac ON ac.id = h.contribution_id
WHERE ac.visibility <> 'firm'
  AND btrim(coalesce(h.new_content, '')) <> '';

-- 5. The other unconditional path: revision events, attributed through the
--    actor exactly as 10-'s policy does.
SELECT count(DISTINCT ac.id) AS n_5_restricted_with_exposed_revisions,
       count(*)              AS revision_events_carrying_prose
FROM public.asset_revision_events e
JOIN public.asset_revisions r      ON r.id = e.revision_id
JOIN public.asset_contributions ac ON ac.asset_id   = r.asset_id
                                 AND ac.section    = e.field_key
                                 AND ac.created_by = r.actor_user_id
WHERE e.category <> 'valuation_targets'
  AND ac.visibility <> 'firm'
  AND btrim(coalesce(e.after_value, '')) <> '';

-- 6 and 8. THE COST OF THE FIX, named. Contributions that at least one person
--    can read today and nobody but the author will read afterwards, with the
--    authors who need telling. This is the only query whose answer should
--    change a decision rather than confirm one.
SELECT ac.id, a.symbol, ac.section, ac.visibility,
       ac.created_by AS author, ac.updated_at,
       'no targets — audience not recorded' AS reason
FROM public.asset_contributions ac
JOIN public.assets a ON a.id = ac.asset_id
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND ac.team_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.contribution_visibility_targets v
                   WHERE v.contribution_id = ac.id)

UNION ALL

-- The second way to lose a reader: the targets survive, but the targeted node
-- has no direct members, so direct-membership matching reaches nobody. This is
-- the unimplemented-descent gap showing up as lost access.
SELECT ac.id, a.symbol, ac.section, ac.visibility,
       ac.created_by, ac.updated_at,
       'targeted node has no direct members — descent unimplemented'
FROM public.asset_contributions ac
JOIN public.assets a ON a.id = ac.asset_id
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND EXISTS (SELECT 1 FROM public.contribution_visibility_targets v
               WHERE v.contribution_id = ac.id)
  AND NOT EXISTS (
        SELECT 1
        FROM public.contribution_visibility_targets v
        JOIN public.org_chart_node_members m ON m.node_id = v.node_id
       WHERE v.contribution_id = ac.id)
ORDER BY 4, 2, 3;

SELECT count(DISTINCT author) AS n_8_authors_to_notify FROM (
  SELECT ac.created_by AS author
  FROM public.asset_contributions ac
  WHERE coalesce(ac.is_archived, false) = false
    AND ac.visibility <> 'firm'
    AND (ac.team_id IS NULL OR true)
    AND NOT EXISTS (
          SELECT 1
          FROM public.contribution_visibility_targets v
          JOIN public.org_chart_node_members m ON m.node_id = v.node_id
         WHERE v.contribution_id = ac.id)
) s;

-- 7. The descent gap, by node type. A targeted node type with few
--    direct-member nodes is the product question from
--    docs/contribution-visibility-assessment.md, in numbers.
SELECT n.node_type,
       count(DISTINCT t.contribution_id) AS contributions_targeting,
       count(DISTINCT t.node_id)         AS nodes_targeted,
       count(DISTINCT t.node_id) FILTER (
         WHERE EXISTS (SELECT 1 FROM public.org_chart_node_members m
                        WHERE m.node_id = t.node_id)) AS nodes_with_direct_members,
       count(DISTINCT t.node_id) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM public.org_chart_node_members m
                            WHERE m.node_id = t.node_id)) AS n_7_nodes_reaching_nobody
FROM public.contribution_visibility_targets t
JOIN public.org_chart_nodes n ON n.id = t.node_id
GROUP BY n.node_type
ORDER BY contributions_targeting DESC;

-- 9. Orphaned revision prose: an event in a contribution category whose
--    section has no contribution by that actor. After the fix these are
--    readable only by the actor. The prose stays in the table either way —
--    this counts what becomes unreadable, not what gets removed.
SELECT count(*) AS n_9_orphaned_revision_events
FROM public.asset_revision_events e
JOIN public.asset_revisions r ON r.id = e.revision_id
WHERE e.category <> 'valuation_targets'
  AND btrim(coalesce(e.after_value, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.asset_contributions c
                   WHERE c.asset_id   = r.asset_id
                     AND c.section    = e.field_key
                     AND c.created_by = r.actor_user_id);

-- ── The invariant 10- depends on, checked against real data ────────────────
-- Every contribution-category revision event whose section HAS a contribution
-- must have one by the ACTOR. A non-zero answer breaks the derivation in 10-
-- section 4 and must be understood before applying it.
SELECT count(*) AS invariant_violations_actor_is_not_author
FROM public.asset_revision_events e
JOIN public.asset_revisions r ON r.id = e.revision_id
WHERE e.category <> 'valuation_targets'
  AND EXISTS (SELECT 1 FROM public.asset_contributions c
               WHERE c.asset_id = r.asset_id AND c.section = e.field_key)
  AND NOT EXISTS (SELECT 1 FROM public.asset_contributions c
                   WHERE c.asset_id   = r.asset_id
                     AND c.section    = e.field_key
                     AND c.created_by = r.actor_user_id);
