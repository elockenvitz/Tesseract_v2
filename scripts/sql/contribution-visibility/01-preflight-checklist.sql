-- ============================================================================
-- contribution-visibility / 01 — PRE-APPROVAL CHECKLIST  (READ-ONLY)
--
-- Every statement is a SELECT. Nothing here writes. Run after
-- 00-verify-readonly.sql. Self-contained: no helper functions, no dependency
-- on the contribution-freshness lane.
--
-- ── EVERY COUNT IS GROUPED BY ORGANIZATION, AND THAT IS NOT COSMETIC ───────
--
-- The Supabase SQL Editor runs as an owner role that BYPASSES RLS, so an
-- ungrouped count here silently merges every tenant in the database —
-- including the pilot and demo organizations, whose research corpus is known
-- to be junk. "47 exposed contributions" could be 47 in one real firm or two
-- each across twenty-four test tenants, and those are different decisions.
--
-- So each query returns one row per organization. Read the rows for the
-- organizations that matter and ignore the rest; the totals are deliberately
-- not computed, because a total is the number that misleads.
-- ============================================================================

-- Name the organizations once, so every result below can be read without
-- cross-referencing uuids.
SELECT id AS organization_id, name, slug
FROM public.organizations
ORDER BY name;

-- ---------------------------------------------------------------------------
-- 1. THE HEADLINE. Restricted contributions the whole organization can read
--    right now, through the team_id-NULL branch.
-- ---------------------------------------------------------------------------
SELECT o.name AS organization,
       count(*) AS n_1_exposed_now
FROM public.asset_contributions ac
JOIN public.organizations o ON o.id = ac.organization_id
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND ac.team_id IS NULL
GROUP BY o.name
ORDER BY n_1_exposed_now DESC;

-- ---------------------------------------------------------------------------
-- 2 and 3. Split by whether the audience still exists, because the two halves
--    get different outcomes from the same fix:
--       targets intact  → the restriction is RESTORED to its intended audience
--       no targets      → owner-only; nothing records who it was for
-- ---------------------------------------------------------------------------
SELECT o.name AS organization,
       CASE WHEN t.n > 0 THEN '3_targets_intact_restriction_restored'
            ELSE            '2_no_targets_becomes_owner_only' END AS bucket,
       count(*)                      AS contributions,
       count(DISTINCT ac.created_by) AS distinct_authors
FROM public.asset_contributions ac
JOIN public.organizations o ON o.id = ac.organization_id
CROSS JOIN LATERAL (
  SELECT count(*) AS n FROM public.contribution_visibility_targets v
   WHERE v.contribution_id = ac.id
) t
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND ac.team_id IS NULL
GROUP BY o.name, 2
ORDER BY o.name, 2;

-- ---------------------------------------------------------------------------
-- 4. UNCONDITIONAL PATH ONE: restricted prose readable org-wide through
--    history, regardless of team_id. (asset_contribution_history has no
--    organization of its own; it takes the parent contribution's.)
-- ---------------------------------------------------------------------------
SELECT o.name AS organization,
       count(DISTINCT ac.id) AS n_4_restricted_with_exposed_history,
       count(*)              AS history_rows_carrying_prose
FROM public.asset_contribution_history h
JOIN public.asset_contributions ac ON ac.id = h.contribution_id
JOIN public.organizations o ON o.id = ac.organization_id
WHERE ac.visibility <> 'firm'
  AND btrim(coalesce(h.new_content, '')) <> ''
GROUP BY o.name
ORDER BY n_4_restricted_with_exposed_history DESC;

-- ---------------------------------------------------------------------------
-- 5. UNCONDITIONAL PATH TWO: revision events, attributed through the ACTOR
--    exactly as 10- section 4 does.
-- ---------------------------------------------------------------------------
SELECT o.name AS organization,
       count(DISTINCT ac.id) AS n_5_restricted_with_exposed_revisions,
       count(*)              AS revision_events_carrying_prose
FROM public.asset_revision_events e
JOIN public.asset_revisions r      ON r.id = e.revision_id
JOIN public.asset_contributions ac ON ac.asset_id    = r.asset_id
                                  AND ac.section     = e.field_key
                                  AND ac.created_by  = r.actor_user_id
JOIN public.organizations o ON o.id = ac.organization_id
WHERE e.category <> 'valuation_targets'
  AND ac.visibility <> 'firm'
  AND btrim(coalesce(e.after_value, '')) <> ''
GROUP BY o.name
ORDER BY n_5_restricted_with_exposed_revisions DESC;

-- ---------------------------------------------------------------------------
-- 6. THE COST, SUMMARISED. Contributions at least one person can read today
--    and only the author will read afterwards. This is operational impact,
--    not a security signal — see docs/contribution-visibility-gate.md.
-- ---------------------------------------------------------------------------
WITH losing AS (
  SELECT ac.id, ac.organization_id, ac.created_by,
         CASE WHEN NOT EXISTS (SELECT 1 FROM public.contribution_visibility_targets v
                                WHERE v.contribution_id = ac.id)
              THEN 'a_audience_destroyed'
              ELSE 'b_targets_intact_but_node_has_no_direct_members' END AS reason
  FROM public.asset_contributions ac
  WHERE coalesce(ac.is_archived, false) = false
    AND ac.visibility <> 'firm'
    AND NOT EXISTS (
          SELECT 1
          FROM public.contribution_visibility_targets v
          JOIN public.org_chart_node_members m ON m.node_id = v.node_id
         WHERE v.contribution_id = ac.id)
)
SELECT o.name AS organization,
       l.reason,
       count(*)                     AS n_6_contributions_losing_a_reader,
       count(DISTINCT l.created_by) AS n_8_authors_to_notify
FROM losing l
JOIN public.organizations o ON o.id = l.organization_id
GROUP BY o.name, l.reason
ORDER BY o.name, l.reason;

-- ---------------------------------------------------------------------------
-- 6b. THE SAME ROWS, ITEMISED — the notification list. Only run for the
--     organizations that matter; it is one row per contribution.
--     Add:  AND o.slug = '<slug>'
-- ---------------------------------------------------------------------------
SELECT o.name AS organization, a.symbol, ac.section, ac.visibility,
       ac.created_by AS author, ac.updated_at,
       CASE WHEN NOT EXISTS (SELECT 1 FROM public.contribution_visibility_targets v
                              WHERE v.contribution_id = ac.id)
            THEN 'audience destroyed — not recorded anywhere'
            ELSE 'targeted node has no direct members' END AS reason
FROM public.asset_contributions ac
JOIN public.assets a        ON a.id = ac.asset_id
JOIN public.organizations o ON o.id = ac.organization_id
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND NOT EXISTS (
        SELECT 1
        FROM public.contribution_visibility_targets v
        JOIN public.org_chart_node_members m ON m.node_id = v.node_id
       WHERE v.contribution_id = ac.id)
ORDER BY o.name, a.symbol, ac.section;

-- ---------------------------------------------------------------------------
-- 7. The descent gap in numbers. Expected to be large; it is context for
--    reading 6, not a stop condition.
-- ---------------------------------------------------------------------------
SELECT o.name AS organization,
       n.node_type,
       count(DISTINCT t.contribution_id) AS contributions_targeting,
       count(DISTINCT t.node_id)         AS nodes_targeted,
       count(DISTINCT t.node_id) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM public.org_chart_node_members m
                            WHERE m.node_id = t.node_id)) AS n_7_nodes_reaching_nobody
FROM public.contribution_visibility_targets t
JOIN public.org_chart_nodes n ON n.id = t.node_id
JOIN public.organizations o   ON o.id = n.organization_id
GROUP BY o.name, n.node_type
ORDER BY o.name, contributions_targeting DESC;

-- ---------------------------------------------------------------------------
-- 9. Orphaned revision prose — retained for audit integrity, access denied
--    after the fix. Counted, never deleted.
-- ---------------------------------------------------------------------------
SELECT o.name AS organization,
       count(*) AS n_9_orphaned_revision_events
FROM public.asset_revision_events e
JOIN public.asset_revisions r ON r.id = e.revision_id
JOIN public.organizations o   ON o.id = r.organization_id
WHERE e.category <> 'valuation_targets'
  AND btrim(coalesce(e.after_value, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.asset_contributions c
                   WHERE c.asset_id   = r.asset_id
                     AND c.section    = e.field_key
                     AND c.created_by = r.actor_user_id)
GROUP BY o.name
ORDER BY n_9_orphaned_revision_events DESC;

-- ===========================================================================
-- THE INVARIANT. 10- section 4 derives a revision event's visibility from the
-- contribution authored by that event's ACTOR. If any event's section has a
-- contribution but none by the actor, that derivation is unsound and the
-- policy would hand one analyst's prose to another.
--
-- A NON-ZERO ANSWER IN ANY ORGANIZATION IS A HARD STOP.
-- ===========================================================================
SELECT coalesce(o.name, '(no organization)') AS organization,
       count(*) AS invariant_violations_actor_is_not_author
FROM public.asset_revision_events e
JOIN public.asset_revisions r ON r.id = e.revision_id
LEFT JOIN public.organizations o ON o.id = r.organization_id
WHERE e.category <> 'valuation_targets'
  AND EXISTS (SELECT 1 FROM public.asset_contributions c
               WHERE c.asset_id = r.asset_id AND c.section = e.field_key)
  AND NOT EXISTS (SELECT 1 FROM public.asset_contributions c
                   WHERE c.asset_id   = r.asset_id
                     AND c.section    = e.field_key
                     AND c.created_by = r.actor_user_id)
GROUP BY 1
ORDER BY 2 DESC;
