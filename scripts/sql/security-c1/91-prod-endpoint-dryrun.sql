-- =============================================================================
-- C1/91 — object_links endpoint resolver, production READ-ONLY dry run
--
-- Every statement is a SELECT. Safe to run against production; it is executed
-- through scripts/sql/security-c1/mgmt-query.mjs, which wraps the batch in
-- SET TRANSACTION READ ONLY.
--
-- Why this exists. The synthetic matrix (90) proves the object_links trigger on
-- staging, but only through `theme` endpoints: staging is missing
-- `organization_id` on asset_notes, theme_notes, portfolio_notes and
-- trade_queue_items, which production has. Those four are precisely the
-- endpoint types production actually uses, so the branches that matter most
-- are the ones staging cannot exercise.
--
-- Rather than assume they work, the resolver's logic is replayed here as a pure
-- SELECT over the real 25 rows. This answers the only question the backfill
-- depends on: does every existing link resolve to exactly one organization,
-- with no cross-org pair?
-- =============================================================================

WITH endpoint AS (
  SELECT l.id,
         l.source_type::text AS s_type, l.target_type::text AS t_type,
         -- Source side
         CASE l.source_type::text
           WHEN 'asset'          THEN NULL
           WHEN 'user'           THEN NULL
           WHEN 'asset_note'     THEN (SELECT n.organization_id FROM asset_notes n     WHERE n.id = l.source_id)
           WHEN 'theme_note'     THEN (SELECT n.organization_id FROM theme_notes n     WHERE n.id = l.source_id)
           WHEN 'portfolio_note' THEN (SELECT n.organization_id FROM portfolio_notes n WHERE n.id = l.source_id)
           WHEN 'portfolio'      THEN (SELECT p.organization_id FROM portfolios p      WHERE p.id = l.source_id)
           WHEN 'theme'          THEN (SELECT t.organization_id FROM themes t          WHERE t.id = l.source_id)
           WHEN 'workflow'       THEN (SELECT w.organization_id FROM workflows w       WHERE w.id = l.source_id)
           WHEN 'quick_thought'  THEN (SELECT q.organization_id FROM quick_thoughts q  WHERE q.id = l.source_id)
           WHEN 'project'        THEN (SELECT pr.organization_id FROM projects pr      WHERE pr.id = l.source_id)
           WHEN 'calendar_event' THEN (SELECT ce.organization_id FROM calendar_events ce WHERE ce.id = l.source_id)
           WHEN 'trade_idea'     THEN COALESCE(
                (SELECT tq.organization_id FROM trade_queue_items tq WHERE tq.id = l.source_id),
                (SELECT p.organization_id FROM pair_trades pt JOIN portfolios p ON p.id = pt.portfolio_id WHERE pt.id = l.source_id))
           WHEN 'trade_idea_thesis' THEN COALESCE(
                (SELECT tq.organization_id FROM trade_idea_theses t JOIN trade_queue_items tq ON tq.id = t.trade_queue_item_id WHERE t.id = l.source_id),
                (SELECT p.organization_id FROM trade_idea_theses t JOIN portfolios p ON p.id = t.portfolio_id WHERE t.id = l.source_id))
           WHEN 'trade_sheet'    THEN (SELECT p.organization_id FROM trade_sheets ts JOIN portfolios p ON p.id = ts.portfolio_id WHERE ts.id = l.source_id)
           WHEN 'trade_proposal' THEN (SELECT p.organization_id FROM trade_proposals tp JOIN portfolios p ON p.id = tp.portfolio_id WHERE tp.id = l.source_id)
           WHEN 'trade'          THEN (SELECT p.organization_id FROM accepted_trades a JOIN portfolios p ON p.id = a.portfolio_id WHERE a.id = l.source_id)
           ELSE NULL
         END AS s_org,
         (l.source_type::text IN ('asset','user')) AS s_global,
         -- Target side, identical mapping
         CASE l.target_type::text
           WHEN 'asset'          THEN NULL
           WHEN 'user'           THEN NULL
           WHEN 'asset_note'     THEN (SELECT n.organization_id FROM asset_notes n     WHERE n.id = l.target_id)
           WHEN 'theme_note'     THEN (SELECT n.organization_id FROM theme_notes n     WHERE n.id = l.target_id)
           WHEN 'portfolio_note' THEN (SELECT n.organization_id FROM portfolio_notes n WHERE n.id = l.target_id)
           WHEN 'portfolio'      THEN (SELECT p.organization_id FROM portfolios p      WHERE p.id = l.target_id)
           WHEN 'theme'          THEN (SELECT t.organization_id FROM themes t          WHERE t.id = l.target_id)
           WHEN 'workflow'       THEN (SELECT w.organization_id FROM workflows w       WHERE w.id = l.target_id)
           WHEN 'quick_thought'  THEN (SELECT q.organization_id FROM quick_thoughts q  WHERE q.id = l.target_id)
           WHEN 'project'        THEN (SELECT pr.organization_id FROM projects pr      WHERE pr.id = l.target_id)
           WHEN 'calendar_event' THEN (SELECT ce.organization_id FROM calendar_events ce WHERE ce.id = l.target_id)
           WHEN 'trade_idea'     THEN COALESCE(
                (SELECT tq.organization_id FROM trade_queue_items tq WHERE tq.id = l.target_id),
                (SELECT p.organization_id FROM pair_trades pt JOIN portfolios p ON p.id = pt.portfolio_id WHERE pt.id = l.target_id))
           WHEN 'trade_idea_thesis' THEN COALESCE(
                (SELECT tq.organization_id FROM trade_idea_theses t JOIN trade_queue_items tq ON tq.id = t.trade_queue_item_id WHERE t.id = l.target_id),
                (SELECT p.organization_id FROM trade_idea_theses t JOIN portfolios p ON p.id = t.portfolio_id WHERE t.id = l.target_id))
           WHEN 'trade_sheet'    THEN (SELECT p.organization_id FROM trade_sheets ts JOIN portfolios p ON p.id = ts.portfolio_id WHERE ts.id = l.target_id)
           WHEN 'trade_proposal' THEN (SELECT p.organization_id FROM trade_proposals tp JOIN portfolios p ON p.id = tp.portfolio_id WHERE tp.id = l.target_id)
           WHEN 'trade'          THEN (SELECT p.organization_id FROM accepted_trades a JOIN portfolios p ON p.id = a.portfolio_id WHERE a.id = l.target_id)
           ELSE NULL
         END AS t_org,
         (l.target_type::text IN ('asset','user')) AS t_global
    FROM object_links l
)
SELECT count(*)                                                              AS total,
       count(*) FILTER (WHERE COALESCE(s_org, t_org) IS NOT NULL)            AS resolvable,
       count(*) FILTER (WHERE COALESCE(s_org, t_org) IS NULL)                AS unresolvable,
       count(*) FILTER (WHERE s_org IS NOT NULL AND t_org IS NOT NULL
                          AND s_org IS DISTINCT FROM t_org)                  AS cross_org_conflict,
       count(*) FILTER (WHERE NOT s_global AND s_org IS NULL)                AS source_would_refuse,
       count(*) FILTER (WHERE NOT t_global AND t_org IS NULL)                AS target_would_refuse,
       count(DISTINCT COALESCE(s_org, t_org))                                AS distinct_orgs
  FROM endpoint;
