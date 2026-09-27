-- Reconcile the `assets` storage policies — state-aware, never speculative.
--
-- ── What changed and why ───────────────────────────────────────────────────
--
-- The first version of this migration swept the catalog unconditionally: it
-- dropped every policy on storage.objects mentioning this bucket that was not
-- one of the four it was about to create. That is safe on a fresh database
-- and reckless on production, where the sweep is an irreversible DROP driven
-- by a LIKE match. A production preflight then showed the sweep would find
-- nothing to do — production already carries exactly the hardened four — so
-- the risk bought nothing at all.
--
-- So this recognises three states and refuses to guess between them.
--
--   State A — already hardened.
--     Bucket private, and the four hardened policies present with the
--     expected command, roles and predicates, and nothing else touching the
--     bucket. Nothing created, dropped or altered. This is production today,
--     which makes this a genuine no-op there with no production-only variant.
--
--   State B — the exact legacy state this repo's own history produces.
--     Precisely the four policies from 20251013115000 and nothing else. They
--     are replaced by the hardened four, and the bucket made private. This is
--     the fresh/reconstructed-database repair path.
--
--   State C — anything else. RAISE EXCEPTION.
--     A policy set nobody predicted is exactly the one that must not be
--     "repaired" by name matching. Permissive policies combine with OR, so a
--     surviving `USING (true)` sits beside a restrictive one and wins
--     silently — and the Allocation lane already proved five DROP-by-name
--     guesses can all be wrong.
--
-- Nothing is dropped until State B is positively identified: classification
-- runs first over the whole policy set, and every DROP lives inside that one
-- branch.
--
-- Rerunnable: a State B repair leaves the database in State A, so a second
-- run is a no-op. Explicit BEGIN/COMMIT because `psql -f` autocommits per
-- statement, and a half-swept bucket is not a predictable state.
--
-- ── On comparing predicates, not names ─────────────────────────────────────
--
-- Policy names are not a handle; two databases can carry the same name over
-- different predicates. Classification therefore compares command, roles AND
-- the deparsed predicate of every policy, normalised for whitespace,
-- parentheses and the casts Postgres adds when deparsing. The expected
-- strings are the deparsed forms read from the live catalog, because
-- deparsed text is what pg_policies returns.

BEGIN;

-- Normalise a deparsed predicate for comparison. Whitespace, parentheses and
-- redundant casts differ between how a policy is written and how Postgres
-- prints it back; none changes meaning.
CREATE OR REPLACE FUNCTION pg_temp.canon(expr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(expr, '')), '::(text|uuid)', '', 'g'),
           '[[:space:]()]', '', 'g'
         );
$fn$;

DO $reconcile$
DECLARE
  -- Expected HARDENED predicates, as the catalog deparses them.
  c_hard_read  CONSTANT text := '((bucket_id = ''assets''::text) AND ((storage.foldername(name))[1] = (current_org_id())::text))';
  c_hard_owned CONSTANT text := '((bucket_id = ''assets''::text) AND ((storage.foldername(name))[1] = (current_org_id())::text) AND (owner = auth.uid()))';

  -- Expected LEGACY predicates from 20251013115000.
  --
  -- The owner comparison is accepted in either casting. That migration wrote
  -- `auth.uid()::text = owner` against a text owner column; current Supabase
  -- types `owner` as uuid, so a database built today carries
  -- `auth.uid() = owner`. Both ARE the legacy state, and the normaliser drops
  -- the cast, so one expected string covers both.
  c_leg_bucket CONSTANT text := '(bucket_id = ''assets''::text)';
  c_leg_owned  CONSTANT text := '((bucket_id = ''assets''::text) AND (auth.uid() = owner))';

  v_total         int;
  v_hardened      int;
  v_legacy        int;
  v_bucket_exists boolean;
  v_bucket_public boolean;
  r               record;
  v_detail        text := '';
BEGIN
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'assets')
    INTO v_bucket_exists;

  IF NOT v_bucket_exists THEN
    RAISE EXCEPTION
      'Files V1 / assets reconcile: the `assets` bucket does not exist. '
      'Expected it from 20251013115000. Refusing to create a bucket as a '
      'side effect of a policy reconciliation.';
  END IF;

  SELECT public INTO v_bucket_public FROM storage.buckets WHERE id = 'assets';

  -- Every policy on storage.objects that talks about this bucket at all.
  SELECT count(*) INTO v_total
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%assets%';

  -- Exactly the hardened four: name, command, roles and predicate.
  SELECT count(*) INTO v_hardened
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND roles::text = '{authenticated}'
    AND (
      (policyname = 'assets: read within current org'
        AND cmd = 'SELECT' AND pg_temp.canon(qual) = pg_temp.canon(c_hard_read))
      OR (policyname = 'assets: upload within current org'
        AND cmd = 'INSERT' AND pg_temp.canon(with_check) = pg_temp.canon(c_hard_read))
      OR (policyname = 'assets: update own files within current org'
        AND cmd = 'UPDATE' AND pg_temp.canon(qual) = pg_temp.canon(c_hard_owned))
      OR (policyname = 'assets: delete own files within current org'
        AND cmd = 'DELETE' AND pg_temp.canon(qual) = pg_temp.canon(c_hard_owned))
    );

  -- Exactly the legacy four.
  SELECT count(*) INTO v_legacy
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND roles::text = '{authenticated}'
    AND (
      (policyname = 'Authenticated users can read files'
        AND cmd = 'SELECT' AND pg_temp.canon(qual) = pg_temp.canon(c_leg_bucket))
      OR (policyname = 'Authenticated users can upload files'
        AND cmd = 'INSERT' AND pg_temp.canon(with_check) = pg_temp.canon(c_leg_bucket))
      OR (policyname = 'Users can update their own files'
        AND cmd = 'UPDATE' AND pg_temp.canon(qual) = pg_temp.canon(c_leg_owned))
      OR (policyname = 'Users can delete their own files'
        AND cmd = 'DELETE' AND pg_temp.canon(qual) = pg_temp.canon(c_leg_owned))
    );

  -- ── State A ─────────────────────────────────────────────────────────────
  -- `v_total = 4` is what makes this safe: one extra permissive policy makes
  -- the count 5 and falls through to State C rather than being ignored.
  IF v_hardened = 4 AND v_total = 4 AND v_bucket_public IS FALSE THEN
    RAISE NOTICE
      'Files V1 / assets reconcile: State A — already hardened. Bucket '
      'private, exactly the four expected policies with the expected '
      'commands, roles and predicates. No changes made.';
    RETURN;
  END IF;

  -- ── State B ─────────────────────────────────────────────────────────────
  IF v_legacy = 4 AND v_total = 4 THEN
    RAISE NOTICE
      'Files V1 / assets reconcile: State B — exact legacy policy set found. '
      'Replacing it with the hardened four.';

    -- Refuse to strand objects. The hardened SELECT matches the first path
    -- segment against current_org_id(), so an object whose first segment is
    -- not an organisation uuid becomes unreadable to everyone the moment
    -- these land. `_unattributed` is the Phase 2 quarantine prefix, exempt.
    PERFORM 1
    FROM storage.objects
    WHERE bucket_id = 'assets'
      AND (storage.foldername(name))[1] <> '_unattributed'
      AND (storage.foldername(name))[1] !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION
        'Files V1 / assets reconcile: objects exist whose first path segment '
        'is neither an organisation uuid nor `_unattributed`. The hardened '
        'SELECT would make them unreadable to everyone. Refusing to strand '
        'them; re-path or quarantine them first.';
    END IF;

    DROP POLICY "Authenticated users can read files"   ON storage.objects;
    DROP POLICY "Authenticated users can upload files" ON storage.objects;
    DROP POLICY "Users can update their own files"     ON storage.objects;
    DROP POLICY "Users can delete their own files"     ON storage.objects;

    EXECUTE $p$
      CREATE POLICY "assets: read within current org"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'assets'
        AND (storage.foldername(name))[1] = current_org_id()::text
      )$p$;

    EXECUTE $p$
      CREATE POLICY "assets: upload within current org"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'assets'
        AND (storage.foldername(name))[1] = current_org_id()::text
      )$p$;

    EXECUTE $p$
      CREATE POLICY "assets: update own files within current org"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'assets'
        AND (storage.foldername(name))[1] = current_org_id()::text
        AND owner = auth.uid()
      )$p$;

    EXECUTE $p$
      CREATE POLICY "assets: delete own files within current org"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'assets'
        AND (storage.foldername(name))[1] = current_org_id()::text
        AND owner = auth.uid()
      )$p$;

    -- Preserve the private-bucket requirement. Touched only in this branch,
    -- and only when it is actually wrong.
    IF v_bucket_public IS DISTINCT FROM false THEN
      UPDATE storage.buckets SET public = false WHERE id = 'assets';
      RAISE NOTICE 'Files V1 / assets reconcile: bucket set private.';
    END IF;

    RETURN;
  END IF;

  -- ── State C ─────────────────────────────────────────────────────────────
  -- Report what was actually found. A bare "unexpected state" forces whoever
  -- hits this to run a query by hand, and they will run a different one.
  FOR r IN
    SELECT policyname, cmd, roles::text AS roles
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%assets%'
    ORDER BY policyname
  LOOP
    v_detail := v_detail || format('%s[%s %s] ', r.policyname, r.cmd, r.roles);
  END LOOP;

  RAISE EXCEPTION
    'Files V1 / assets reconcile: State C — unrecognised policy configuration, '
    'refusing to modify it. Found % assets-touching polic(ies); % match the '
    'hardened set exactly, % match the legacy set exactly; bucket public=%. '
    'Policies: %. Resolve by hand, or extend this migration to recognise the '
    'state deliberately — do not let a script guess at a security boundary.',
    v_total, v_hardened, v_legacy, coalesce(v_bucket_public::text, 'n/a'),
    coalesce(nullif(v_detail, ''), '(none)');
END $reconcile$;

COMMIT;
