-- NEGATIVE FIXTURE: one unexpected policy on the assets bucket.
--
-- Applied on top of the production shape, so everything M1 expects is
-- present AND one thing it does not expect. This is the case the original
-- catalog sweep handled by dropping it — a name it had never seen, removed
-- by a script, on a security boundary.
--
-- The policy is permissive and unscoped on purpose. Permissive policies
-- combine with OR, so this one beside the hardened SELECT means every
-- authenticated user reads every organisation's objects. A migration that
-- "repairs" its way past this is worse than one that stops.
--
-- Expected: M1 raises State C and changes nothing.

\set ON_ERROR_STOP on

CREATE POLICY "legacy_wide_open_assets_read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'assets');
