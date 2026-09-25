-- NEGATIVE FIXTURE: a hardened policy whose NAME is right and whose
-- PREDICATE is not.
--
-- This is the case that defeats every name-based check, and the reason M1
-- compares deparsed predicates rather than counting names. The policy set
-- looks correct from `SELECT policyname` — all four expected names, nothing
-- extra — while the tenant boundary on SELECT has been removed entirely.
--
-- Applied on top of the production shape.
--
-- Expected: M1 raises State C. Specifically it must report `4` total
-- assets-touching policies but only `3` matching the hardened set, which is
-- the discrimination a count-of-names check cannot make.

\set ON_ERROR_STOP on

DROP POLICY "assets: read within current org" ON storage.objects;

-- Same name. No `current_org_id()` term: reads across every organisation.
CREATE POLICY "assets: read within current org"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'assets');
