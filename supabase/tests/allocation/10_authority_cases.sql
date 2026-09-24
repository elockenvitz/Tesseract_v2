-- The eighteen authority and isolation cases.
--
-- Every case flips into a real `authenticated` principal first, so what is
-- being tested is the policy, not the helper it calls. Run after the three
-- allocation migrations, with 00_harness.sql loaded.
--
-- The distinction the whole model turns on is cases 5 vs 6 and 16 vs 17: an
-- ORG_ADMIN appoints the investment authority and is not it; an
-- allocation-team admin holds investment authority and cannot appoint.

\set ON_ERROR_STOP on
\i 00_harness.sql

BEGIN;

SELECT alloc_test.seed_fresh();
SELECT alloc_test.clear_team();
SELECT alloc_test.grant_team((SELECT u_teamadmin_a FROM alloc_test.ids),
                             (SELECT org_a FROM alloc_test.ids), 'admin');
SELECT alloc_test.grant_team((SELECT u_teamadmin_b FROM alloc_test.ids),
                             (SELECT org_b FROM alloc_test.ids), 'admin');
SELECT alloc_test.grant_team((SELECT u_inactive_a FROM alloc_test.ids),
                             (SELECT org_a FROM alloc_test.ids), 'admin', false);

-- 1 ── Org A cannot read Org B asset classes.
SELECT alloc_test.become((SELECT u_member_a FROM alloc_test.ids));
SELECT alloc_test.eq('1  org A sees only its own asset classes',
  (SELECT count(*) FROM asset_classes WHERE organization_id = (SELECT org_b FROM alloc_test.ids)),
  0::bigint);

-- 2 ── Org A cannot read Org B official views.
SELECT alloc_test.eq('2  org A sees only its own official views',
  (SELECT count(*) FROM official_allocation_views
    WHERE period_id = (SELECT period_b FROM alloc_test.ids)),
  0::bigint);
SELECT alloc_test.eq('2b org A does see its own official view',
  (SELECT count(*) FROM official_allocation_views
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)),
  1::bigint);

-- 3 ── Ordinary member cannot publish.
SELECT alloc_test.ok('3  ordinary member cannot publish',
  alloc_test.refused($q$
    INSERT INTO official_allocation_views (period_id, asset_class_id, view)
    SELECT period_a, ac_a1, 'strong_overweight' FROM alloc_test.ids
    ON CONFLICT (period_id, asset_class_id)
    DO UPDATE SET view = 'strong_overweight'
  $q$), true);

-- 4 ── Generic INVESTMENT membership alone grants nothing. Same shape as a
--      plain member: the product has no INVESTMENT grant, which is the point.
SELECT alloc_test.become((SELECT u_invest_a FROM alloc_test.ids));
SELECT alloc_test.ok('4  investment member cannot publish',
  alloc_test.refused($q$
    UPDATE official_allocation_views SET view = 'strong_overweight'
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)
  $q$)
  OR alloc_test.affected($q$
    UPDATE official_allocation_views SET view = 'strong_overweight'
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)
  $q$) = 0, true);

-- 5 ── ORG_ADMIN who is not a team admin cannot publish. The heart of it.
SELECT alloc_test.become((SELECT u_orgadmin_a FROM alloc_test.ids));
SELECT alloc_test.eq('5  org admin cannot publish',
  alloc_test.affected($q$
    UPDATE official_allocation_views SET view = 'strong_overweight'
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)
  $q$), 0::bigint);

-- 6 ── Active team admin can publish for their own org.
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
SELECT alloc_test.eq('6  team admin publishes own org',
  alloc_test.affected($q$
    UPDATE official_allocation_views SET view = 'strong_overweight'
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)
  $q$), 1::bigint);

-- 7 ── Team admin cannot publish into another org.
SELECT alloc_test.eq('7  team admin cannot publish into org B',
  alloc_test.affected($q$
    UPDATE official_allocation_views SET view = 'strong_overweight'
    WHERE period_id = (SELECT period_b FROM alloc_test.ids)
  $q$), 0::bigint);

-- 8 ── ORG_ADMIN can bootstrap team membership.
SELECT alloc_test.become((SELECT u_orgadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('8  org admin appoints a team member',
  alloc_test.refused($q$
    INSERT INTO allocation_team_members (user_id, organization_id, role)
    SELECT u_member_a, org_a, 'member' FROM alloc_test.ids
  $q$), false);

-- 9 ── A newly bootstrapped team admin can then publish.
SELECT alloc_test.become((SELECT u_orgadmin_a FROM alloc_test.ids));
UPDATE allocation_team_members SET role = 'admin'
 WHERE user_id = (SELECT u_member_a FROM alloc_test.ids)
   AND organization_id = (SELECT org_a FROM alloc_test.ids);
SELECT alloc_test.become((SELECT u_member_a FROM alloc_test.ids));
SELECT alloc_test.eq('9  bootstrapped admin can publish',
  alloc_test.affected($q$
    UPDATE official_allocation_views SET view = 'market_weight'
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)
  $q$), 1::bigint);

-- 10 ── Org A user cannot author a vote or comment against an Org B period.
SELECT alloc_test.become((SELECT u_member_a FROM alloc_test.ids));
SELECT alloc_test.ok('10 vote against foreign period refused',
  alloc_test.refused($q$
    INSERT INTO allocation_votes (period_id, asset_class_id, user_id, vote)
    SELECT period_b, ac_b1, u_member_a, 'agree' FROM alloc_test.ids
  $q$), true);
SELECT alloc_test.ok('10b comment against foreign period refused',
  alloc_test.refused($q$
    INSERT INTO allocation_comments (period_id, user_id, content)
    SELECT period_b, u_member_a, 'hello' FROM alloc_test.ids
  $q$), true);

-- 11 ── An inactive team admin is rejected.
SELECT alloc_test.become((SELECT u_inactive_a FROM alloc_test.ids));
SELECT alloc_test.eq('11 inactive team admin cannot publish',
  alloc_test.affected($q$
    UPDATE official_allocation_views SET view = 'underweight'
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)
  $q$), 0::bigint);

-- 12 ── An Org A period cannot be paired with an Org B asset class.
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('12 own period + foreign asset class refused',
  alloc_test.refused($q$
    INSERT INTO official_allocation_views (period_id, asset_class_id, view)
    SELECT period_a, ac_b1, 'overweight' FROM alloc_test.ids
  $q$), true);

-- 13 ── Ordinary member cannot create or update a period.
SELECT alloc_test.become((SELECT u_member_a FROM alloc_test.ids));
SELECT alloc_test.become_service();
DELETE FROM allocation_team_members WHERE user_id = (SELECT u_member_a FROM alloc_test.ids);
SELECT alloc_test.become((SELECT u_member_a FROM alloc_test.ids));
SELECT alloc_test.ok('13 ordinary member cannot create a period',
  alloc_test.refused($q$
    INSERT INTO allocation_periods (name, start_date, end_date, organization_id)
    SELECT 'sneaky', '2026-04-01', '2026-06-30', org_a FROM alloc_test.ids
  $q$), true);
SELECT alloc_test.eq('13b ordinary member cannot update a period',
  alloc_test.affected($q$
    UPDATE allocation_periods SET name = 'renamed'
    WHERE id = (SELECT period_a FROM alloc_test.ids)
  $q$), 0::bigint);

-- 14 ── Team admin can create and update their own org's period.
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('14 team admin creates a period',
  alloc_test.refused($q$
    INSERT INTO allocation_periods (name, start_date, end_date, organization_id)
    SELECT 'Q2 A', '2026-04-01', '2026-06-30', org_a FROM alloc_test.ids
  $q$), false);
SELECT alloc_test.eq('14b team admin updates a period',
  alloc_test.affected($q$
    UPDATE allocation_periods SET name = 'Q1 A (revised)'
    WHERE id = (SELECT period_a FROM alloc_test.ids)
  $q$), 1::bigint);

-- 15 ── ORG_ADMIN alone cannot create or update a period.
SELECT alloc_test.become((SELECT u_orgadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('15 org admin cannot create a period',
  alloc_test.refused($q$
    INSERT INTO allocation_periods (name, start_date, end_date, organization_id)
    SELECT 'admin period', '2026-07-01', '2026-09-30', org_a FROM alloc_test.ids
  $q$), true);

-- 16 ── A team admin cannot manage team membership.
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('16 team admin cannot appoint a peer',
  alloc_test.refused($q$
    INSERT INTO allocation_team_members (user_id, organization_id, role)
    SELECT u_invest_a, org_a, 'admin' FROM alloc_test.ids
  $q$), true);
SELECT alloc_test.eq('16b team admin cannot promote themselves elsewhere',
  alloc_test.affected($q$
    UPDATE allocation_team_members SET role = 'admin'
    WHERE user_id = (SELECT u_inactive_a FROM alloc_test.ids)
  $q$), 0::bigint);

-- 17 ── ORG_ADMIN can create the first team admin from an empty team.
--       This is the bootstrap the old self-referential policy made impossible.
SELECT alloc_test.clear_team();
SELECT alloc_test.become((SELECT u_orgadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('17 org admin bootstraps first admin into an empty team',
  alloc_test.refused($q$
    INSERT INTO allocation_team_members (user_id, organization_id, role)
    SELECT u_teamadmin_a, org_a, 'admin' FROM alloc_test.ids
  $q$), false);

-- 18 ── History is written by the trigger, and is not directly writable.
SELECT alloc_test.become_service();
SELECT count(*) AS before_count FROM allocation_history \gset
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
UPDATE official_allocation_views SET view = 'strong_underweight'
 WHERE period_id = (SELECT period_a FROM alloc_test.ids);
SELECT alloc_test.eq('18 trigger recorded the change',
  (SELECT count(*) FROM allocation_history
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)
      AND new_view = 'strong_underweight'),
  1::bigint);
SELECT alloc_test.ok('18b history is not directly writable',
  alloc_test.refused($q$
    INSERT INTO allocation_history (period_id, asset_class_id, new_view)
    SELECT period_a, ac_a1, 'overweight' FROM alloc_test.ids
  $q$), true);

ROLLBACK;
