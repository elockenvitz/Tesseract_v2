-- =============================================================================
-- Security C1 · §0 DISCOVERY — READ ONLY
--
-- Establishes the live facts C1 remediation depends on, for the seven scoped
-- tables plus the Release B message follow-up (`06-…​-reconciliation.sql`).
--
-- CONTAINS NO WRITES. Every statement is a SELECT. Safe to run on production.
--
-- ── Why this exists ─────────────────────────────────────────────────────────
--
-- Release B established, twice, that this repository does not describe the live
-- database: `analyst_performance_snapshots` carried a policy present in no
-- migration, and `04`'s fourth notification trigger chain
-- (asset_list_collaborations -> trigger_list_share_notification ->
-- create_list_share_notification) was invisible to a `notify_*` naming
-- heuristic and only appeared under live discovery. So nothing below is
-- inferred from migrations or from the committed inventory.
--
-- The governing question for every table is the one the C1 brief poses:
--
--   "What exact SQL predicate proves this row belongs to the current user's
--    organization?"
--
-- An FK to a scoped parent is NOT enforcement. §3 and §4 exist to find out
-- whether each candidate parent chain is actually TOTAL (join column NOT NULL,
-- parent row always present) — because a chain that is merely usually-populated
-- is what quarantined 13 messages in Release B: `portfolios.team_id` was NULL
-- for exactly the portfolios those messages hung off.
--
-- ── Usage ───────────────────────────────────────────────────────────────────
--
--   psql "$CONN" --no-psqlrc -f scripts/sql/security-c1/00-discovery.sql
--
-- Capture the whole output. Section 8 lists the specific answers that decide
-- whether the staging remediation may be promoted unchanged.
-- =============================================================================

\timing off
SET statement_timeout = '120s';
SET idle_in_transaction_session_timeout = '120s';

SELECT '=== 0. environment ===' AS section;
SELECT current_database()  AS db,
       current_user        AS connected_as,
       version()           AS server_version,
       now()               AS captured_at;

-- =============================================================================
-- 1. Do the tables exist, is RLS on, and is it FORCED?
-- =============================================================================
-- `relforcerowsecurity` matters: without FORCE, the table owner bypasses RLS.
-- That is normal, but it means an owner-connected probe proves nothing about
-- what an end user can see — which is why §2 of the C1 plan re-tests as
-- `authenticated` rather than trusting a policy read.

SELECT '=== 1. RLS state ===' AS section;
SELECT c.relname                       AS table_name,
       c.relrowsecurity                AS rls_enabled,
       c.relforcerowsecurity           AS rls_forced,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count,
       (SELECT reltuples::bigint FROM pg_class x WHERE x.oid = c.oid) AS est_rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('tdf_holdings','tdf_holdings_snapshots','scenarios',
                     'asset_field_history','asset_revision_events',
                     'object_links','theme_assets')
 ORDER BY c.relname;

-- Exact counts. `reltuples` above is an estimate and can be stale; the
-- assertions in the remediation need real numbers.
SELECT '=== 1b. exact row counts ===' AS section;
SELECT 'tdf_holdings'           AS table_name, count(*) FROM public.tdf_holdings
UNION ALL SELECT 'tdf_holdings_snapshots', count(*) FROM public.tdf_holdings_snapshots
UNION ALL SELECT 'scenarios',              count(*) FROM public.scenarios
UNION ALL SELECT 'asset_field_history',    count(*) FROM public.asset_field_history
UNION ALL SELECT 'asset_revision_events',  count(*) FROM public.asset_revision_events
UNION ALL SELECT 'object_links',           count(*) FROM public.object_links
UNION ALL SELECT 'theme_assets',           count(*) FROM public.theme_assets
 ORDER BY 1;

-- =============================================================================
-- 2. Every policy, in full — predicates included
-- =============================================================================
-- The committed inventory deliberately stores only hashes and a class, so the
-- actual predicate text has to come from here. `permissive` matters: PERMISSIVE
-- policies OR together, so one broad sibling defeats every scoped policy on the
-- same (table, command, role). That is the portfolio_team defect verbatim.

SELECT '=== 2. policies ===' AS section;
SELECT tablename, policyname, cmd, permissive,
       array_to_string(roles, ',') AS roles,
       qual        AS using_expr,
       with_check  AS with_check_expr
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('tdf_holdings','tdf_holdings_snapshots','scenarios',
                     'asset_field_history','asset_revision_events',
                     'object_links','theme_assets')
 ORDER BY tablename, cmd, policyname;

-- Sibling summary: any (table, cmd) with more than one PERMISSIVE policy needs
-- reading as a set, never one policy at a time.
SELECT '=== 2b. permissive sibling groups ===' AS section;
SELECT tablename, cmd, count(*) AS permissive_policies,
       array_agg(policyname ORDER BY policyname) AS policies
  FROM pg_policies
 WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
   AND tablename IN ('tdf_holdings','tdf_holdings_snapshots','scenarios',
                     'asset_field_history','asset_revision_events',
                     'object_links','theme_assets')
 GROUP BY tablename, cmd
HAVING count(*) > 1
 ORDER BY tablename, cmd;

-- =============================================================================
-- 3. Grants — including anon (Phase 9)
-- =============================================================================
-- A policy is only half the boundary; the grant is the other half. Release B
-- found `anon` holding full DML on every table it touched.

SELECT '=== 3. table grants ===' AS section;
SELECT table_name, grantee,
       string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND grantee IN ('anon','authenticated')
   AND table_name IN ('tdf_holdings','tdf_holdings_snapshots','scenarios',
                      'asset_field_history','asset_revision_events',
                      'object_links','theme_assets')
 GROUP BY table_name, grantee
 ORDER BY table_name, grantee;

-- =============================================================================
-- 4. Columns and tenant-authority candidates
-- =============================================================================
-- Nullability is the point. A join column that is NULLABLE cannot carry a TOTAL
-- ownership chain, and an EXISTS policy through it silently hides rows.

SELECT '=== 4. columns ===' AS section;
SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('tdf_holdings','tdf_holdings_snapshots','scenarios',
                      'asset_field_history','asset_revision_events',
                      'object_links','theme_assets')
 ORDER BY table_name, ordinal_position;

SELECT '=== 4b. foreign keys out of these tables ===' AS section;
SELECT c.conrelid::regclass AS from_table,
       a.attname            AS from_column,
       a.attnotnull         AS from_column_not_null,
       c.confrelid::regclass AS to_table,
       af.attname            AS to_column,
       c.confdeltype         AS on_delete
  FROM pg_constraint c
  JOIN unnest(c.conkey)  WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
  JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = k.attnum
  JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = fk.attnum
 WHERE c.contype = 'f'
   AND c.conrelid::regclass::text IN ('tdf_holdings','tdf_holdings_snapshots','scenarios',
                                      'asset_field_history','asset_revision_events',
                                      'object_links','theme_assets')
 ORDER BY 1, 2;

-- =============================================================================
-- 5. Is each candidate ownership chain actually TOTAL?
-- =============================================================================
-- This is the section that would have caught the Release B message defect
-- before it shipped. For every candidate path, count the rows that FAIL to
-- resolve. A non-zero "unresolved" count means an EXISTS policy through that
-- path would hide those rows from everyone.
--
-- Column names are assumed from the repository and MAY NOT MATCH production.
-- If any statement below errors with "column does not exist", that is itself a
-- finding: record it and correct the query rather than assuming the chain.

SELECT '=== 5. chain totality (tdf) ===' AS section;
SELECT 'tdf_holdings -> target_date_funds' AS chain,
       count(*) AS total,
       count(*) FILTER (WHERE h.fund_id IS NULL)                  AS null_parent_fk,
       count(*) FILTER (WHERE f.id IS NULL AND h.fund_id IS NOT NULL) AS dangling_parent,
       count(*) FILTER (WHERE f.organization_id IS NULL)          AS parent_without_org
  FROM public.tdf_holdings h
  LEFT JOIN public.target_date_funds f ON f.id = h.fund_id;

SELECT 'tdf_holdings_snapshots -> target_date_funds' AS chain,
       count(*) AS total,
       count(*) FILTER (WHERE s.fund_id IS NULL)                  AS null_parent_fk,
       count(*) FILTER (WHERE f.id IS NULL AND s.fund_id IS NOT NULL) AS dangling_parent,
       count(*) FILTER (WHERE f.organization_id IS NULL)          AS parent_without_org
  FROM public.tdf_holdings_snapshots s
  LEFT JOIN public.target_date_funds f ON f.id = s.fund_id;

SELECT '=== 5b. chain totality (theme_assets) ===' AS section;
SELECT 'theme_assets -> themes' AS chain,
       count(*) AS total,
       count(*) FILTER (WHERE ta.theme_id IS NULL)                    AS null_theme_id,
       count(*) FILTER (WHERE t.id IS NULL AND ta.theme_id IS NOT NULL) AS dangling_theme,
       count(*) FILTER (WHERE t.organization_id IS NULL)              AS theme_without_org
  FROM public.theme_assets ta
  LEFT JOIN public.themes t ON t.id = ta.theme_id;

SELECT '=== 5c. chain totality (scenarios) ===' AS section;
-- Scenario parentage is the open question: portfolio, asset, user, or other.
-- Report the distribution of whichever ownership columns exist so the authority
-- can be chosen from data rather than from a name.
SELECT 'scenarios column population' AS chain,
       count(*) AS total,
       count(*) FILTER (WHERE asset_id  IS NULL) AS null_asset_id,
       count(*) FILTER (WHERE user_id   IS NULL) AS null_user_id
  FROM public.scenarios;

SELECT '=== 5d. chain totality (history tables) ===' AS section;
-- Assets are GLOBAL, so asset_id -> assets -> organization is NOT a valid
-- tenant path. These counts are about finding what else could be authoritative.
SELECT 'asset_field_history' AS t,
       count(*) AS total,
       count(*) FILTER (WHERE user_id IS NULL) AS null_user_id
  FROM public.asset_field_history;

SELECT 'asset_revision_events' AS t,
       count(*) AS total,
       count(*) FILTER (WHERE user_id IS NULL) AS null_user_id
  FROM public.asset_revision_events;

SELECT '=== 5e. object_links endpoint shape ===' AS section;
SELECT source_type, target_type, count(*) AS links
  FROM public.object_links
 GROUP BY source_type, target_type
 ORDER BY links DESC;

-- =============================================================================
-- 6. Functions and triggers the fixes rely on or must not break
-- =============================================================================
-- Two Release B lessons are encoded here. First, SECURITY INVOKER functions run
-- as the caller and therefore break when a grant is revoked — that is what the
-- notifications step nearly did to asset edits. Second, an unpinned search_path
-- on a SECURITY DEFINER function is its own escalation surface.

SELECT '=== 6. tenancy helper functions ===' AS section;
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef                                AS security_definer,
       (p.proconfig IS NOT NULL AND EXISTS (
          SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search\_path=%')) AS search_path_pinned,
       pg_get_userbyid(p.proowner)                AS owner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('current_org_id','is_platform_admin','portfolio_in_current_org',
                     'messages_set_organization_id')
 ORDER BY p.proname;

SELECT '=== 6b. SECURITY INVOKER functions writing the seven tables ===' AS section;
-- Any row here is a function that will start failing if a grant is revoked, and
-- whose trigger would abort the user statement that fired it.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND NOT p.prosecdef
   AND p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(tdf_holdings|tdf_holdings_snapshots|scenarios|asset_field_history|asset_revision_events|object_links|theme_assets)\M'
 ORDER BY p.proname;

SELECT '=== 6c. triggers on the seven tables ===' AS section;
SELECT c.relname AS table_name, t.tgname AS trigger_name,
       pr.proname AS function_name, pr.prosecdef AS function_is_definer,
       t.tgenabled AS enabled
  FROM pg_trigger t
  JOIN pg_class c   ON c.oid = t.tgrelid
  JOIN pg_proc pr   ON pr.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname = 'public'
   AND c.relname IN ('tdf_holdings','tdf_holdings_snapshots','scenarios',
                     'asset_field_history','asset_revision_events',
                     'object_links','theme_assets')
 ORDER BY c.relname, t.tgname;

-- =============================================================================
-- 7. Release B message follow-up (`06`) preconditions
-- =============================================================================
-- The staging figures were 37 quarantined = 20 asset + 13 recoverable trade_idea
-- + 4 orphan trade_idea. Production must be measured, not assumed.

SELECT '=== 7. messages quarantine by context_type ===' AS section;
SELECT context_type, count(*) AS quarantined
  FROM public.messages
 WHERE organization_id IS NULL
 GROUP BY context_type
 ORDER BY quarantined DESC;

SELECT '=== 7b. trade_idea quarantine triage ===' AS section;
SELECT
  count(*) AS quarantined_trade_idea,
  count(*) FILTER (WHERE p.organization_id IS NOT NULL)                       AS recoverable_via_portfolio_org,
  count(*) FILTER (WHERE tq.id IS NULL AND pt.id IS NULL)                     AS true_orphans_no_parent,
  count(*) FILTER (WHERE p.id IS NOT NULL AND p.organization_id IS NULL)      AS parent_without_org
  FROM public.messages m
  LEFT JOIN public.trade_queue_items tq ON tq.id = m.context_id
  LEFT JOIN public.pair_trades       pt ON pt.id = m.context_id
  LEFT JOIN public.portfolios p
         ON p.id = COALESCE(tq.portfolio_id, pt.portfolio_id)
 WHERE m.context_type = 'trade_idea' AND m.organization_id IS NULL;

SELECT '=== 7c. do portfolios.organization_id and teams.organization_id ever disagree? ===' AS section;
-- `06` puts portfolios.organization_id FIRST and keeps teams.organization_id as
-- a fallback, on the basis that where both exist they agree. This is that check.
-- ANY non-zero value here invalidates the COALESCE precedence and must STOP the
-- follow-up.
SELECT count(*) FILTER (WHERE p.team_id IS NULL)                        AS portfolios_without_team,
       count(*) FILTER (WHERE p.organization_id IS NULL)                AS portfolios_without_org,
       count(*) FILTER (WHERE t.id IS NOT NULL
                          AND p.organization_id IS DISTINCT FROM t.organization_id) AS org_disagreements
  FROM public.portfolios p
  LEFT JOIN public.teams t ON t.id = p.team_id;

-- =============================================================================
-- 8. The answers that gate promotion
-- =============================================================================
-- Read these before promoting anything:
--
--   §2   Does any of the seven tables have a PERMISSIVE sibling that is
--        unconditional or auth-only? If yes, the scoped policy beside it is
--        inert and the table is open regardless of how it reads.
--
--   §3   Does `anon` hold any privilege on these tables? Phase 9 revokes them,
--        but only after confirming no pre-auth flow depends on them.
--
--   §4b  Is every candidate ownership FK NOT NULL? A nullable FK cannot carry a
--        total chain.
--
--   §5   Is any "unresolved / dangling / parent_without_org" count non-zero? If
--        so an EXISTS policy through that path hides those rows, and the design
--        must either pick a different authority or quarantine deliberately —
--        never backfill a guess.
--
--   §6b  Any SECURITY INVOKER function writing these tables will break when a
--        grant is revoked, and its trigger will abort the user's statement.
--
--   §7b  Do the production recoverable / orphan counts match staging's 13 / 4?
--        They are expected to differ; the assertions in `06` are written to be
--        count-independent, but the release note needs the real numbers.
--
--   §7c  `org_disagreements` MUST be 0. If it is not, stop the message
--        follow-up — the COALESCE precedence is no longer a derivation.
-- =============================================================================

SELECT '=== discovery complete ===' AS section;
