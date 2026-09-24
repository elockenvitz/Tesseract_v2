-- Adversarial: assume the client is lying.
--
-- The cases in 10_ prove the policies do the right thing for honest callers.
-- These assume the opposite — that someone is sending whatever ids they like
-- straight at PostgREST — because every client gate in this repository is UX
-- and the database is the only thing actually standing there.
--
-- Each case names a real mistake in this domain's history: authority derived
-- from a caller-supplied organisation, tenancy inferred from one id while a
-- second id points somewhere else, and membership that was never checked for
-- being current.

\set ON_ERROR_STOP on
\i 00_harness.sql

BEGIN;

SELECT alloc_test.seed_fresh();
SELECT alloc_test.clear_team();
SELECT alloc_test.grant_team((SELECT u_teamadmin_a FROM alloc_test.ids),
                             (SELECT org_a FROM alloc_test.ids), 'admin');
SELECT alloc_test.grant_team((SELECT u_teamadmin_b FROM alloc_test.ids),
                             (SELECT org_b FROM alloc_test.ids), 'admin');

-- A1 ── Caller supplies another org's organization_id.
--       `asset_classes` takes it as a column, so a forged value is the obvious
--       attack. The policy checks it against `current_org_id()`, not against
--       what was sent.
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('A1 forged organization_id on insert refused',
  alloc_test.refused($q$
    INSERT INTO asset_classes (name, organization_id)
    SELECT 'Smuggled', org_b FROM alloc_test.ids
  $q$), true);

-- A1b ── And the same on update: relabelling an owned row into another org.
SELECT alloc_test.ok('A1b cannot move an asset class into another org',
  alloc_test.blocked($q$
    UPDATE asset_classes SET organization_id = (SELECT org_b FROM alloc_test.ids)
    WHERE id = (SELECT ac_a1 FROM alloc_test.ids)
  $q$), true);
-- And prove it by state, not only by the verb the database used to say no.
SELECT alloc_test.become_service();
SELECT alloc_test.eq('A1b the asset class still belongs to org A',
  (SELECT organization_id FROM asset_classes WHERE id = (SELECT ac_a1 FROM alloc_test.ids)),
  (SELECT org_a FROM alloc_test.ids));
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));

-- A2 ── Caller supplies another org's period_id.
--       Tenancy for official views is derived from the period, so pointing at
--       a foreign period is the way to test that derivation.
SELECT alloc_test.ok('A2 foreign period_id on insert refused',
  alloc_test.refused($q$
    INSERT INTO official_allocation_views (period_id, asset_class_id, view)
    SELECT period_b, ac_b1, 'overweight' FROM alloc_test.ids
  $q$), true);

-- A3 ── Own user_id combined with a foreign period.
--       The authorship check passes; the tenancy check must still fail. A
--       policy that only checked `user_id = auth.uid()` would let this land.
SELECT alloc_test.become((SELECT u_member_a FROM alloc_test.ids));
SELECT alloc_test.ok('A3 own user_id + foreign period refused (vote)',
  alloc_test.refused($q$
    INSERT INTO allocation_votes (period_id, asset_class_id, user_id, vote)
    SELECT period_b, ac_b1, u_member_a, 'agree' FROM alloc_test.ids
  $q$), true);
SELECT alloc_test.ok('A3b own user_id + foreign period refused (individual view)',
  alloc_test.refused($q$
    INSERT INTO individual_allocation_views (period_id, asset_class_id, user_id, view)
    SELECT period_b, ac_b1, u_member_a, 'overweight' FROM alloc_test.ids
  $q$), true);

-- A4 ── Current-org period paired with a foreign asset class.
--       Both ids are individually plausible — one is genuinely mine — and the
--       pair is what is wrong. This is why writes check both.
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('A4 own period + foreign asset class refused',
  alloc_test.refused($q$
    INSERT INTO official_allocation_views (period_id, asset_class_id, view)
    SELECT period_a, ac_b1, 'overweight' FROM alloc_test.ids
  $q$), true);
SELECT alloc_test.ok('A4b same pairing refused on a cell note',
  alloc_test.refused($q$
    INSERT INTO allocation_cell_notes (period_id, asset_class_id, view_type, thesis_notes)
    SELECT period_a, ac_b1, 'overweight', 'x' FROM alloc_test.ids
  $q$), true);

-- A5 ── Membership that exists but is not active.
--       Deactivation is how a firm removes someone's authority; if the policy
--       only checked for a row, revocation would do nothing.
SELECT alloc_test.grant_team((SELECT u_teamadmin_a FROM alloc_test.ids),
                             (SELECT org_a FROM alloc_test.ids), 'admin', false);
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('A5 deactivated team admin loses publish authority',
  alloc_test.blocked($q$
    UPDATE official_allocation_views SET view = 'underweight'
    WHERE period_id = (SELECT period_a FROM alloc_test.ids)
  $q$), true);
SELECT alloc_test.grant_team((SELECT u_teamadmin_a FROM alloc_test.ids),
                             (SELECT org_a FROM alloc_test.ids), 'admin', true);

-- A6 ── Org A team-admin membership used against Org B.
--       Authority is per-organisation. Before the tenant column existed,
--       membership was global and this succeeded.
SELECT alloc_test.become((SELECT u_teamadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('A6 org A team admin cannot publish in org B',
  alloc_test.blocked($q$
    UPDATE official_allocation_views SET view = 'overweight'
    WHERE period_id = (SELECT period_b FROM alloc_test.ids)
  $q$), true);
SELECT alloc_test.eq('A6b nor can they even see org B official views',
  (SELECT count(*) FROM official_allocation_views
    WHERE period_id = (SELECT period_b FROM alloc_test.ids)),
  0::bigint);

-- A7 ── Org A ORG_ADMIN authority used against Org B.
SELECT alloc_test.become((SELECT u_orgadmin_a FROM alloc_test.ids));
SELECT alloc_test.ok('A7 org A admin cannot appoint into org B',
  alloc_test.refused($q$
    INSERT INTO allocation_team_members (user_id, organization_id, role)
    SELECT u_member_a, org_b, 'admin' FROM alloc_test.ids
  $q$), true);
SELECT alloc_test.eq('A7b org A admin cannot see org B team',
  (SELECT count(*) FROM allocation_team_members
    WHERE organization_id = (SELECT org_b FROM alloc_test.ids)),
  0::bigint);

ROLLBACK;
