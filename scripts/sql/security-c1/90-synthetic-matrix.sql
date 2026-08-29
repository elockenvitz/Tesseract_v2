-- =============================================================================
-- C1/90 — synthetic policy matrix, STAGING ONLY
--
-- Runs against a staging database with 01-11 applied. Staging holds no real
-- rows in any C1 table, so every fixture here is synthetic and nothing can
-- collide with, or be contaminated by, production data.
--
-- Method, unchanged from the 07 suite: one transaction, fixtures created as
-- postgres, each assertion executed under a real role via `set_config('role',…)`
-- with `request.jwt.claims` so auth.uid() and current_org_id() resolve exactly
-- as they do for a live caller. The suite ends in a deliberate RAISE, so every
-- fixture rolls back and the assertion table travels out in the error message.
--
-- Three identities, because one is not enough to test tenancy:
--   U1  member of org A only          — the ordinary same-org caller
--   U2  member of org A AND org B     — the multi-org user whose membership
--                                       cannot identify a row's tenant, which
--                                       is why every derivation in C1 uses
--                                       current_org_id() rather than membership
--   U3  member of no organization     — the unaffiliated authenticated user
--                                       that saw 100% of all seven tables
-- =============================================================================

-- ── Assertion plumbing ──────────────────────────────────────────────────────
CREATE TEMP TABLE c1_results (
  seq int, area text, test text, expected text, actual text, pass boolean);
GRANT ALL ON c1_results TO authenticated, service_role, anon;

CREATE FUNCTION pg_temp.c1_eq(seq int, area text, test text, expected anyelement, actual anyelement)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO c1_results VALUES (seq, area, test, expected::text, actual::text, expected = actual);
END $fn$;

-- Executes a statement and records whether it was refused, so a write test says
-- what actually happened rather than aborting the suite.
CREATE FUNCTION pg_temp.c1_try(seq int, area text, test text, should_fail boolean, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  INSERT INTO c1_results VALUES (seq, area, test,
    CASE WHEN should_fail THEN 'REFUSED' ELSE 'accepted' END, 'accepted', NOT should_fail);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO c1_results VALUES (seq, area, test,
    CASE WHEN should_fail THEN 'REFUSED' ELSE 'accepted' END,
    'refused: ' || left(SQLERRM, 70), should_fail);
END $fn$;

CREATE FUNCTION pg_temp.c1_as(uid uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
END $fn$;

CREATE FUNCTION pg_temp.c1_root() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $fn$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO public.organizations (id, name, slug) VALUES
  ('aaaa0000-0000-4000-8000-000000000001', 'C1 Org A', 'c1-org-a'),
  ('bbbb0000-0000-4000-8000-000000000002', 'C1 Org B', 'c1-org-b');

INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES
  ('11110000-0000-4000-8000-000000000001', false, false),   -- U1  org A
  ('22220000-0000-4000-8000-000000000002', false, false),   -- U2  org A + org B
  ('33330000-0000-4000-8000-000000000003', false, false);   -- U3  no org

-- A trigger on auth.users provisions public.users, so this sets the one field
-- that matters: the organization each identity is actively standing in.
INSERT INTO public.users (id, current_organization_id) VALUES
  ('11110000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001'),
  ('22220000-0000-4000-8000-000000000002', 'bbbb0000-0000-4000-8000-000000000002'),
  ('33330000-0000-4000-8000-000000000003', NULL)
ON CONFLICT (id) DO UPDATE SET current_organization_id = EXCLUDED.current_organization_id;

INSERT INTO public.organization_memberships (organization_id, user_id, status) VALUES
  ('aaaa0000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001', 'active'),
  ('aaaa0000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000002', 'active'),
  ('bbbb0000-0000-4000-8000-000000000002', '22220000-0000-4000-8000-000000000002', 'active');

INSERT INTO public.themes (id, name, organization_id, created_by) VALUES
  ('7e000000-0000-4000-8000-00000000000a', 'C1 Theme A', 'aaaa0000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001'),
  ('7e000000-0000-4000-8000-00000000000b', 'C1 Theme B', 'bbbb0000-0000-4000-8000-000000000002', '22220000-0000-4000-8000-000000000002');

INSERT INTO public.workflows (id, name, organization_id, created_by) VALUES
  ('c0000000-0000-4000-8000-00000000000a', 'C1 Workflow A', 'aaaa0000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-00000000000b', 'C1 Workflow B', 'bbbb0000-0000-4000-8000-000000000002', '22220000-0000-4000-8000-000000000002');

INSERT INTO public.target_date_funds (id, name, target_year, organization_id) VALUES
  ('fd000000-0000-4000-8000-00000000000a', 'C1 Fund A', 2055, 'aaaa0000-0000-4000-8000-000000000001'),
  ('fd000000-0000-4000-8000-00000000000b', 'C1 Fund B', 2056, 'bbbb0000-0000-4000-8000-000000000002');

INSERT INTO public.tdf_holdings_snapshots (id, tdf_id, snapshot_date) VALUES
  ('5a000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-00000000000a', '2026-08-01'),
  ('5a000000-0000-4000-8000-00000000000b', 'fd000000-0000-4000-8000-00000000000b', '2026-08-01');

-- tdf_holdings.underlying_fund_id points at tdf_underlying_funds, which is a
-- global catalogue of the funds a TDF can hold — the tenant lives on the
-- snapshot's parent TDF, which is exactly why the EXISTS chain goes that way.
INSERT INTO public.tdf_underlying_funds (id, name) VALUES
  ('11f00000-0000-4000-8000-00000000000f', 'C1 Underlying Fund'),
  -- A second one: (snapshot_id, underlying_fund_id) is unique, so the
  -- legitimate-insert test needs a pair the fixtures have not already used.
  ('22f00000-0000-4000-8000-00000000000f', 'C1 Underlying Fund 2');

-- ── Assertions ──────────────────────────────────────────────────────────────
DO $matrix$
DECLARE
  ORG_A CONSTANT uuid := 'aaaa0000-0000-4000-8000-000000000001';
  ORG_B CONSTANT uuid := 'bbbb0000-0000-4000-8000-000000000002';
  U1    CONSTANT uuid := '11110000-0000-4000-8000-000000000001';
  U2    CONSTANT uuid := '22220000-0000-4000-8000-000000000002';
  U3    CONSTANT uuid := '33330000-0000-4000-8000-000000000003';
  THEME_A CONSTANT uuid := '7e000000-0000-4000-8000-00000000000a';
  THEME_B CONSTANT uuid := '7e000000-0000-4000-8000-00000000000b';
  WF_A  CONSTANT uuid := 'c0000000-0000-4000-8000-00000000000a';
  SNAP_A CONSTANT uuid := '5a000000-0000-4000-8000-00000000000a';
  SNAP_B CONSTANT uuid := '5a000000-0000-4000-8000-00000000000b';
  asset_1 uuid;
  asset_2 uuid;
  contrib_a uuid;
  contrib_b uuid;
  rev_a uuid;
  rev_b uuid;
  scen_default uuid;
  scen_a uuid;
  scen_legacy uuid;
  link_a uuid;
  n int;
BEGIN
  SELECT id INTO asset_1 FROM public.assets ORDER BY symbol LIMIT 1;
  SELECT id INTO asset_2 FROM public.assets ORDER BY symbol OFFSET 1 LIMIT 1;

  -- ---- fixtures that must be authored by a real caller (triggers assign org) --
  PERFORM pg_temp.c1_as(U1);
  INSERT INTO public.asset_contributions (asset_id, section, content, created_by, visibility)
    VALUES (asset_1, 'thesis', 'ORG-A-SECRET-THESIS margin inflection', U1, 'firm')
    RETURNING id INTO contrib_a;
  INSERT INTO public.asset_revisions (asset_id, view_scope_type, actor_user_id, revision_note)
    VALUES (asset_1, 'firm', U1, 'ORG-A revision note') RETURNING id INTO rev_a;
  INSERT INTO public.asset_revision_events (revision_id, category, field_key)
    VALUES (rev_a, 'thesis', 'thesis');
  INSERT INTO public.theme_assets (theme_id, asset_id, added_by) VALUES (THEME_A, asset_1, U1);
  INSERT INTO public.scenarios (asset_id, name, is_default, created_by)
    VALUES (asset_1, 'C1 Custom A', false, U1) RETURNING id INTO scen_a;
  INSERT INTO public.tdf_holdings (snapshot_id, underlying_fund_id, weight)
    VALUES (SNAP_A, '11f00000-0000-4000-8000-00000000000f', 10);

  PERFORM pg_temp.c1_as(U2);   -- U2 is standing in org B
  INSERT INTO public.asset_contributions (asset_id, section, content, created_by, visibility)
    VALUES (asset_1, 'thesis', 'ORG-B-SECRET-THESIS margin inflection', U2, 'firm')
    RETURNING id INTO contrib_b;
  INSERT INTO public.asset_revisions (asset_id, view_scope_type, actor_user_id, revision_note)
    VALUES (asset_2, 'firm', U2, 'ORG-B revision note') RETURNING id INTO rev_b;
  INSERT INTO public.theme_assets (theme_id, asset_id, added_by) VALUES (THEME_B, asset_2, U2);
  INSERT INTO public.tdf_holdings (snapshot_id, underlying_fund_id, weight)
    VALUES (SNAP_B, '11f00000-0000-4000-8000-00000000000f', 20);

  PERFORM pg_temp.c1_root();

  -- NOTE ON THE object_links ENDPOINTS USED BELOW.
  --
  -- Production's most common link shape is asset_note -> asset, and the natural
  -- fixture would be an asset_note. Staging cannot host one: it is missing
  -- `organization_id` on asset_notes, theme_notes, portfolio_notes and
  -- trade_queue_items, all of which production has. That is pre-existing
  -- staging drift (the same drift that leaves assets 10 columns short), not
  -- something this release introduces.
  --
  -- `theme` is used instead. It exercises the identical resolver paths — a
  -- tenant-owning endpoint on one side, the global `asset` on the other — so
  -- every branch of the trigger is covered. What it does NOT cover is the
  -- specific asset_note/theme_note/trade_idea lookups, which are therefore
  -- verified against production read-only instead (see 91-prod-endpoint-dryrun.sql).

  -- Rows that only exist historically: a global default scenario, and the two
  -- quarantine shapes C1 deliberately refuses to attribute. The triggers are
  -- disabled for exactly these inserts because their whole purpose is to make
  -- an unattributed row impossible going forward.
  --
  -- The tenancy CHECK has to come off for the legacy insert too, and that is
  -- itself a result: 05 ran against a staging table with zero rows, so it
  -- exempted nothing, and the constraint correctly refuses to let a NEW
  -- unattributed custom scenario be created. Production's copy of the
  -- constraint carries an exemption for the one real legacy row, so the
  -- constraint is re-created here in exactly that shape — which means the
  -- assertions below run against the production-shaped rule, not a relaxed one.
  ALTER TABLE public.scenarios DISABLE TRIGGER scenarios_set_organization_id;
  ALTER TABLE public.scenarios DROP CONSTRAINT scenarios_tenancy_check;
  INSERT INTO public.scenarios (asset_id, name, is_default, created_by, organization_id)
    VALUES (asset_1, 'C1 Global Default', true, NULL, NULL) RETURNING id INTO scen_default;
  INSERT INTO public.scenarios (asset_id, name, is_default, created_by, organization_id)
    VALUES (asset_1, 'C1 Legacy Custom', false, U2, NULL) RETURNING id INTO scen_legacy;
  EXECUTE format(
    'ALTER TABLE public.scenarios ADD CONSTRAINT scenarios_tenancy_check CHECK (
       (is_default IS TRUE AND organization_id IS NULL) OR
       (is_default IS NOT TRUE AND organization_id IS NOT NULL) OR
       (id = ANY (%L::uuid[])))', ARRAY[scen_legacy]);
  ALTER TABLE public.scenarios ENABLE TRIGGER scenarios_set_organization_id;

  -- ==========================================================================
  -- 1. assets — global reference stays global, proprietary columns are gone
  -- ==========================================================================
  PERFORM pg_temp.c1_as(U3);   -- unaffiliated: the identity that saw everything
  EXECUTE 'SELECT count(*) FROM public.assets' INTO n;
  PERFORM pg_temp.c1_eq(1, 'assets', 'global reference readable by unaffiliated user', true, n > 0);
  PERFORM pg_temp.c1_try(2, 'assets', 'SELECT thesis column', true,
    'SELECT thesis FROM public.assets LIMIT 1');
  PERFORM pg_temp.c1_try(3, 'assets', 'SELECT * (expands to restricted columns)', true,
    'SELECT * FROM public.assets LIMIT 1');
  PERFORM pg_temp.c1_try(4, 'assets', 'useExploreSearch-shaped ILIKE over thesis', true,
    'SELECT id FROM public.assets WHERE thesis ILIKE ''%margin%''');
  PERFORM pg_temp.c1_try(5, 'assets', 'SELECT reference columns', false,
    'SELECT id, symbol, company_name, sector FROM public.assets LIMIT 1');
  PERFORM pg_temp.c1_try(6, 'assets', 'UPDATE process_stage', true,
    format('UPDATE public.assets SET process_stage = ''review'' WHERE id = %L', asset_1));

  -- ==========================================================================
  -- 2. asset_contributions — the org-scoped research model
  -- ==========================================================================
  PERFORM pg_temp.c1_as(U1);
  EXECUTE 'SELECT count(*) FROM public.asset_contributions' INTO n;
  PERFORM pg_temp.c1_eq(10, 'asset_contributions', 'org A sees only its own contribution', 1, n);
  EXECUTE format('SELECT count(*) FROM public.asset_contributions WHERE id = %L', contrib_b) INTO n;
  PERFORM pg_temp.c1_eq(11, 'asset_contributions', 'org A cannot read org B contribution', 0, n);

  -- The replacement for the cross-tenant thesis search: the same ILIKE, now
  -- against the org-scoped table.
  EXECUTE 'SELECT count(*) FROM public.asset_contributions WHERE content ILIKE ''%SECRET-THESIS%''' INTO n;
  PERFORM pg_temp.c1_eq(12, 'asset_contributions', 'research search returns only own org', 1, n);

  PERFORM pg_temp.c1_as(U3);
  EXECUTE 'SELECT count(*) FROM public.asset_contributions WHERE content ILIKE ''%SECRET-THESIS%''' INTO n;
  PERFORM pg_temp.c1_eq(13, 'asset_contributions', 'unaffiliated user research search', 0, n);

  PERFORM pg_temp.c1_as(U1);
  -- An UPDATE or DELETE that a USING clause filters out affects zero rows and
  -- returns success — RLS hides rows, it does not raise. So the assertion has
  -- to be about the row's state afterwards, which is the stronger claim: not
  -- "the statement errored" but "the foreign row is untouched".
  EXECUTE format('UPDATE public.asset_contributions SET content = ''hijack'' WHERE id = %L', contrib_b);
  EXECUTE format('DELETE FROM public.asset_contributions WHERE id = %L', contrib_b);
  PERFORM pg_temp.c1_root();
  EXECUTE format('SELECT count(*) FROM public.asset_contributions WHERE id = %L AND content LIKE ''ORG-B-SECRET%%''', contrib_b) INTO n;
  PERFORM pg_temp.c1_eq(14, 'asset_contributions', 'org B contribution survived org A UPDATE + DELETE unchanged', 1, n);
  EXECUTE 'SELECT count(*) FROM public.asset_contributions WHERE content = ''hijack''' INTO n;
  PERFORM pg_temp.c1_eq(15, 'asset_contributions', 'no contribution anywhere was overwritten', 0, n);
  PERFORM pg_temp.c1_as(U1);
  PERFORM pg_temp.c1_try(16, 'asset_contributions', 'UPDATE own contribution', false,
    format('UPDATE public.asset_contributions SET content = ''revised'' WHERE id = %L', contrib_a));
  -- Tenancy is assigned, not accepted: a caller-supplied foreign org is discarded.
  EXECUTE format('UPDATE public.asset_contributions SET organization_id = %L WHERE id = %L', ORG_B, contrib_a);
  EXECUTE format('SELECT count(*) FROM public.asset_contributions WHERE id = %L AND organization_id = %L', contrib_a, ORG_A) INTO n;
  PERFORM pg_temp.c1_eq(17, 'asset_contributions', 'caller-supplied foreign organization_id is overwritten', 1, n);

  -- ==========================================================================
  -- 3. asset_contribution_history — the history of the above
  -- ==========================================================================
  PERFORM pg_temp.c1_root();
  EXECUTE 'SELECT count(*) FROM public.asset_contribution_history' INTO n;
  PERFORM pg_temp.c1_eq(20, 'asset_contribution_history', 'history rows exist to test against', true, n > 0);

  PERFORM pg_temp.c1_as(U1);
  EXECUTE format('SELECT count(*) FROM public.asset_contribution_history h WHERE h.contribution_id = %L', contrib_a) INTO n;
  PERFORM pg_temp.c1_eq(21, 'asset_contribution_history', 'own-org history readable', true, n > 0);
  EXECUTE format('SELECT count(*) FROM public.asset_contribution_history h WHERE h.contribution_id = %L', contrib_b) INTO n;
  PERFORM pg_temp.c1_eq(22, 'asset_contribution_history', 'foreign-org history denied', 0, n);
  EXECUTE 'SELECT count(*) FROM public.asset_contribution_history WHERE new_content ILIKE ''%ORG-B-SECRET%''' INTO n;
  PERFORM pg_temp.c1_eq(23, 'asset_contribution_history', 'cross-org history search denied', 0, n);

  PERFORM pg_temp.c1_as(U3);
  EXECUTE 'SELECT count(*) FROM public.asset_contribution_history' INTO n;
  PERFORM pg_temp.c1_eq(24, 'asset_contribution_history', 'unaffiliated user sees nothing', 0, n);

  -- ==========================================================================
  -- 4. tdf_holdings / snapshots
  -- ==========================================================================
  PERFORM pg_temp.c1_as(U1);
  EXECUTE 'SELECT count(*) FROM public.tdf_holdings' INTO n;
  PERFORM pg_temp.c1_eq(30, 'tdf_holdings', 'same-org read', 1, n);
  EXECUTE 'SELECT count(*) FROM public.tdf_holdings_snapshots' INTO n;
  PERFORM pg_temp.c1_eq(31, 'tdf_holdings_snapshots', 'same-org read', 1, n);
  PERFORM pg_temp.c1_try(32, 'tdf_holdings', 'INSERT into foreign fund snapshot', true,
    format('INSERT INTO public.tdf_holdings (snapshot_id, underlying_fund_id, weight) VALUES (%L, %L, 5)',
           SNAP_B, '11f00000-0000-4000-8000-00000000000f'));
  PERFORM pg_temp.c1_try(33, 'tdf_holdings', 'INSERT into own fund snapshot', false,
    format('INSERT INTO public.tdf_holdings (snapshot_id, underlying_fund_id, weight) VALUES (%L, %L, 7)',
           SNAP_A, '22f00000-0000-4000-8000-00000000000f'));
  PERFORM pg_temp.c1_try(34, 'tdf_holdings', 'UPDATE moving row into foreign snapshot (WITH CHECK)', true,
    format('UPDATE public.tdf_holdings SET snapshot_id = %L WHERE snapshot_id = %L', SNAP_B, SNAP_A));
  PERFORM pg_temp.c1_try(35, 'tdf_holdings_snapshots', 'DELETE foreign snapshot', false,
    format('DELETE FROM public.tdf_holdings_snapshots WHERE id = %L', SNAP_B));
  EXECUTE format('SELECT count(*) FROM public.tdf_holdings_snapshots s WHERE s.id = %L', SNAP_B) INTO n;
  PERFORM pg_temp.c1_root();
  EXECUTE format('SELECT count(*) FROM public.tdf_holdings_snapshots s WHERE s.id = %L', SNAP_B) INTO n;
  PERFORM pg_temp.c1_eq(36, 'tdf_holdings_snapshots', 'foreign snapshot survived the DELETE attempt', 1, n);

  PERFORM pg_temp.c1_as(U3);
  EXECUTE 'SELECT count(*) FROM public.tdf_holdings' INTO n;
  PERFORM pg_temp.c1_eq(37, 'tdf_holdings', 'unaffiliated user sees nothing (was 672/672)', 0, n);

  -- ==========================================================================
  -- 5. theme_assets
  -- ==========================================================================
  PERFORM pg_temp.c1_as(U1);
  EXECUTE 'SELECT count(*) FROM public.theme_assets' INTO n;
  PERFORM pg_temp.c1_eq(40, 'theme_assets', 'same-org read', 1, n);
  -- The named defect: added_by = auth.uid() is satisfied, the theme is org B's.
  PERFORM pg_temp.c1_try(41, 'theme_assets', 'INSERT into foreign theme with added_by = self', true,
    format('INSERT INTO public.theme_assets (theme_id, asset_id, added_by) VALUES (%L, %L, %L)',
           THEME_B, asset_2, U1));
  PERFORM pg_temp.c1_try(42, 'theme_assets', 'INSERT into own theme', false,
    format('INSERT INTO public.theme_assets (theme_id, asset_id, added_by) VALUES (%L, %L, %L)',
           THEME_A, asset_2, U1));
  PERFORM pg_temp.c1_try(43, 'theme_assets', 'DELETE own theme membership', false,
    format('DELETE FROM public.theme_assets WHERE theme_id = %L AND asset_id = %L', THEME_A, asset_2));
  PERFORM pg_temp.c1_as(U3);
  EXECUTE 'SELECT count(*) FROM public.theme_assets' INTO n;
  PERFORM pg_temp.c1_eq(44, 'theme_assets', 'unaffiliated user sees nothing', 0, n);

  -- ==========================================================================
  -- 6. object_links — polymorphic, global and tenant endpoints
  -- ==========================================================================
  PERFORM pg_temp.c1_as(U1);
  -- tenant <-> global: an org-owned theme referencing a global asset
  PERFORM pg_temp.c1_try(50, 'object_links', 'same-org tenant<->global link', false,
    format('INSERT INTO public.object_links (source_type, source_id, target_type, target_id, link_type, is_auto, created_by)
            VALUES (''theme'', %L, ''asset'', %L, ''references'', false, %L)', THEME_A, asset_1, U1));
  SELECT id INTO link_a FROM public.object_links LIMIT 1;
  EXECUTE format('SELECT count(*) FROM public.object_links WHERE id = %L AND organization_id = %L', link_a, ORG_A) INTO n;
  PERFORM pg_temp.c1_eq(51, 'object_links', 'trigger derived org from the tenant endpoint', 1, n);
  -- A caller-chosen organization must not survive.
  PERFORM pg_temp.c1_try(52, 'object_links', 'INSERT with caller-supplied foreign organization_id', false,
    format('INSERT INTO public.object_links (source_type, source_id, target_type, target_id, link_type, is_auto, created_by, organization_id)
            VALUES (''theme'', %L, ''asset'', %L, ''supports'', false, %L, %L)', THEME_A, asset_2, U1, ORG_B));
  EXECUTE format('SELECT count(*) FROM public.object_links WHERE organization_id = %L', ORG_B) INTO n;
  PERFORM pg_temp.c1_eq(53, 'object_links', 'no link was stored under the foreign org', 0, n);
  -- foreign tenant endpoint: org B's theme
  PERFORM pg_temp.c1_try(54, 'object_links', 'link to foreign tenant endpoint', true,
    format('INSERT INTO public.object_links (source_type, source_id, target_type, target_id, link_type, is_auto, created_by)
            VALUES (''theme'', %L, ''asset'', %L, ''references'', false, %L)', THEME_B, asset_1, U1));
  PERFORM pg_temp.c1_as(U3);
  EXECUTE 'SELECT count(*) FROM public.object_links' INTO n;
  PERFORM pg_temp.c1_eq(55, 'object_links', 'unaffiliated user sees nothing (was 25/25)', 0, n);
  PERFORM pg_temp.c1_as(U2);   -- standing in org B
  EXECUTE 'SELECT count(*) FROM public.object_links' INTO n;
  PERFORM pg_temp.c1_eq(56, 'object_links', 'multi-org user in org B cannot see org A links', 0, n);

  -- ==========================================================================
  -- 7. scenarios — global defaults vs tenant custom vs legacy quarantine
  -- ==========================================================================
  PERFORM pg_temp.c1_as(U1);
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE id = %L', scen_default) INTO n;
  PERFORM pg_temp.c1_eq(60, 'scenarios', 'global default readable', 1, n);
  PERFORM pg_temp.c1_as(U3);
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE id = %L', scen_default) INTO n;
  PERFORM pg_temp.c1_eq(61, 'scenarios', 'global default readable even with no org', 1, n);
  -- The live defect was an UPDATE policy reading
  -- `(auth.uid() = created_by) OR (is_default = true)`. Again the proof is the
  -- row's state, not an exception: under the old policy this rename SUCCEEDED.
  EXECUTE format('UPDATE public.scenarios SET name = ''hijacked'' WHERE id = %L', scen_default);
  PERFORM pg_temp.c1_root();
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE id = %L AND name = ''C1 Global Default''', scen_default) INTO n;
  PERFORM pg_temp.c1_eq(62, 'scenarios', 'global default unchanged after an ordinary user renamed it', 1, n);
  PERFORM pg_temp.c1_as(U3);
  PERFORM pg_temp.c1_try(63, 'scenarios', 'DELETE a global default', false,
    format('DELETE FROM public.scenarios WHERE id = %L', scen_default));
  PERFORM pg_temp.c1_root();
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE id = %L', scen_default) INTO n;
  PERFORM pg_temp.c1_eq(64, 'scenarios', 'global default survived the DELETE attempt', 1, n);

  PERFORM pg_temp.c1_as(U1);
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE id = %L', scen_a) INTO n;
  PERFORM pg_temp.c1_eq(65, 'scenarios', 'own custom scenario readable', 1, n);
  PERFORM pg_temp.c1_try(66, 'scenarios', 'UPDATE own custom scenario', false,
    format('UPDATE public.scenarios SET name = ''C1 Custom A v2'' WHERE id = %L', scen_a));
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE id = %L', scen_legacy) INTO n;
  PERFORM pg_temp.c1_eq(67, 'scenarios', 'quarantined legacy row hidden from non-creator', 0, n);

  PERFORM pg_temp.c1_as(U2);
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE id = %L', scen_a) INTO n;
  PERFORM pg_temp.c1_eq(68, 'scenarios', 'org B user cannot read org A custom scenario', 0, n);
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE id = %L', scen_legacy) INTO n;
  PERFORM pg_temp.c1_eq(69, 'scenarios', 'quarantined legacy row visible to its creator only', 1, n);
  -- Case vs Price / scenario ladder shape: defaults plus the caller's own.
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE asset_id = %L', asset_1) INTO n;
  PERFORM pg_temp.c1_eq(70, 'scenarios', 'Case-vs-Price load for org B: 1 default + 1 legacy own', 2, n);

  -- ==========================================================================
  -- 8. asset_revisions / asset_revision_events
  -- ==========================================================================
  PERFORM pg_temp.c1_as(U1);
  EXECUTE 'SELECT count(*) FROM public.asset_revisions' INTO n;
  PERFORM pg_temp.c1_eq(80, 'asset_revisions', 'same-org read', 1, n);
  EXECUTE format('SELECT count(*) FROM public.asset_revisions WHERE id = %L', rev_b) INTO n;
  PERFORM pg_temp.c1_eq(81, 'asset_revisions', 'foreign-org revision denied', 0, n);
  EXECUTE 'SELECT count(*) FROM public.asset_revision_events' INTO n;
  PERFORM pg_temp.c1_eq(82, 'asset_revision_events', 'same-org read', 1, n);
  -- The multi-org case the forward model exists for: U2 is the actor on rev_b
  -- and a member of org A, but is standing in org B.
  PERFORM pg_temp.c1_as(U2);
  PERFORM pg_temp.c1_try(83, 'asset_revision_events', 'multi-org actor inserting against a foreign-org revision', true,
    format('INSERT INTO public.asset_revision_events (revision_id, category, field_key) VALUES (%L, ''thesis'', ''thesis'')', rev_a));
  PERFORM pg_temp.c1_try(84, 'asset_revision_events', 'insert against own-org revision', false,
    format('INSERT INTO public.asset_revision_events (revision_id, category, field_key) VALUES (%L, ''thesis'', ''thesis'')', rev_b));
  PERFORM pg_temp.c1_as(U3);
  EXECUTE 'SELECT count(*) FROM public.asset_revisions' INTO n;
  PERFORM pg_temp.c1_eq(85, 'asset_revisions', 'unaffiliated user sees nothing (was 13/13)', 0, n);
  EXECUTE 'SELECT count(*) FROM public.asset_revision_events' INTO n;
  PERFORM pg_temp.c1_eq(86, 'asset_revision_events', 'unaffiliated user sees nothing (was 22/22)', 0, n);

  -- ==========================================================================
  -- 9. asset_field_history — system history stays, research history is creator-only
  -- ==========================================================================
  PERFORM pg_temp.c1_root();
  INSERT INTO public.asset_field_history (asset_id, field_name, old_value, new_value, changed_by)
    VALUES (asset_1, 'process_stage', 'research', 'analysis', NULL),
           (asset_1, 'thesis', 'old prose', 'ORG-A private prose', U1);

  PERFORM pg_temp.c1_as(U2);
  EXECUTE 'SELECT count(*) FROM public.asset_field_history WHERE field_name = ''process_stage''' INTO n;
  PERFORM pg_temp.c1_eq(90, 'asset_field_history', 'system/workflow history stays readable', 1, n);
  EXECUTE 'SELECT count(*) FROM public.asset_field_history WHERE field_name = ''thesis''' INTO n;
  PERFORM pg_temp.c1_eq(91, 'asset_field_history', 'research history hidden from non-author', 0, n);
  PERFORM pg_temp.c1_as(U1);
  EXECUTE 'SELECT count(*) FROM public.asset_field_history WHERE field_name = ''thesis''' INTO n;
  PERFORM pg_temp.c1_eq(92, 'asset_field_history', 'research history visible to its author', 1, n);
  PERFORM pg_temp.c1_try(93, 'asset_field_history', 'forge a history row directly', true,
    format('INSERT INTO public.asset_field_history (asset_id, field_name, new_value, changed_by) VALUES (%L, ''thesis'', ''forged'', %L)', asset_1, U1));

  -- ==========================================================================
  -- 9b. asset_workflow_progress / _priorities (08b)
  --
  -- These are 09's migration targets, so their boundary matters as much as the
  -- source's. The pre-C1 policy was `assets.created_by = auth.uid()` plus, for
  -- progress, an `is_public` branch that crossed organizations outright.
  -- ==========================================================================
  PERFORM pg_temp.c1_root();
  INSERT INTO public.asset_workflow_progress (asset_id, workflow_id, current_stage_key, is_started)
    VALUES (asset_1, WF_A, 'analysis', true),
           (asset_2, 'c0000000-0000-4000-8000-00000000000b', 'review', true);
  INSERT INTO public.asset_workflow_priorities (asset_id, workflow_id, priority)
    VALUES (asset_1, WF_A, 'high'),
           (asset_2, 'c0000000-0000-4000-8000-00000000000b', 'critical');
  -- Org A's workflow is public: under the old policy this made its progress
  -- readable from every organization.
  UPDATE public.workflows SET is_public = true WHERE id = WF_A;

  PERFORM pg_temp.c1_as(U1);
  EXECUTE 'SELECT count(*) FROM public.asset_workflow_progress' INTO n;
  PERFORM pg_temp.c1_eq(94, 'asset_workflow_progress', 'same-org read', 1, n);
  EXECUTE 'SELECT count(*) FROM public.asset_workflow_priorities' INTO n;
  PERFORM pg_temp.c1_eq(95, 'asset_workflow_priorities', 'same-org read (the universe priority rule)', 1, n);
  PERFORM pg_temp.c1_try(96, 'asset_workflow_progress', 'INSERT against a foreign-org workflow', true,
    format('INSERT INTO public.asset_workflow_progress (asset_id, workflow_id, current_stage_key, is_started) VALUES (%L, %L, ''x'', true)',
           asset_1, 'c0000000-0000-4000-8000-00000000000b'));

  PERFORM pg_temp.c1_as(U2);   -- standing in org B
  EXECUTE 'SELECT count(*) FROM public.asset_workflow_progress' INTO n;
  PERFORM pg_temp.c1_eq(97, 'asset_workflow_progress', 'org B cannot see org A progress on a PUBLIC workflow', 1, n);
  PERFORM pg_temp.c1_as(U3);
  EXECUTE 'SELECT count(*) FROM public.asset_workflow_progress' INTO n;
  PERFORM pg_temp.c1_eq(98, 'asset_workflow_progress', 'unaffiliated user sees nothing', 0, n);
  EXECUTE 'SELECT count(*) FROM public.asset_workflow_priorities' INTO n;
  PERFORM pg_temp.c1_eq(99, 'asset_workflow_priorities', 'unaffiliated user sees nothing', 0, n);

  -- ==========================================================================
  -- 10. anon
  -- ==========================================================================
  PERFORM set_config('role', 'anon', true);
  PERFORM pg_temp.c1_try(100, 'anon', 'SELECT asset_contributions', true,
    'SELECT count(*) FROM public.asset_contributions');
  PERFORM pg_temp.c1_try(101, 'anon', 'SELECT tdf_holdings', true,
    'SELECT count(*) FROM public.tdf_holdings');
  PERFORM pg_temp.c1_try(102, 'anon', 'SELECT assets', true,
    'SELECT count(*) FROM public.assets');

  PERFORM pg_temp.c1_root();
END $matrix$;

-- ── Report and roll back ────────────────────────────────────────────────────
DO $report$
DECLARE body text; failed int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT pass), count(*) INTO failed, total FROM c1_results;
  SELECT string_agg(format('  %s %3s [%s] %s%s        want: %s | got: %s',
                           CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,
                           seq, area, test, chr(10), expected, actual),
                    chr(10) ORDER BY seq)
    INTO body FROM c1_results;
  RAISE EXCEPTION E'\n=== C1 SYNTHETIC POLICY MATRIX ===\n%\n\n  %/% failed. Rolled back; no fixture persisted.\n',
    body, failed, total;
END $report$;
