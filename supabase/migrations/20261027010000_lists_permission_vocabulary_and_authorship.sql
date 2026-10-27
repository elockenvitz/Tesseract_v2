-- =============================================================================
-- Lists: make the permission vocabulary honest, authorship mandatory, and the
-- grants explicit.
--
-- ⚠ NOT APPLIED. Authored 2026-10-27; applying it was refused by the tooling
-- in the session that wrote it, so production still has the pre-migration
-- shape. Nothing here is urgent — see "What this does not fix" below — but
-- until it runs, the schema says things that are not true.
--
-- Three small corrections to the same table family, deliberately in ONE
-- migration so list permissions are touched once rather than three times.
--
-- ── 1. 'admin' was never storable ────────────────────────────────────────
--
-- `asset_list_collaborations.permission` carries TWO check constraints:
--   asset_list_collaborations_permission_check : read | write | admin
--   valid_permission                           : read | write
-- Both must hold, so 'admin' can never be written. Production holds only
-- 'write'. Every policy's `permission = ANY(ARRAY['admin','write'])` has
-- therefore carried a branch that cannot match, and any UI offering an admin
-- tier would fail on insert.
--
-- Resolved by REMOVING 'admin' from the vocabulary, not by enabling it.
-- Enabling it would widen what a collaborator may do, which is a product
-- decision and not one a cleanup gets to make. If an admin tier is wanted
-- later it is a deliberate addition: re-add the value AND state what admin
-- may do that write may not.
--
-- ── 2. added_by is now required ──────────────────────────────────────────
--
-- The own-row policy from 20261027002812 needed an owner fallback for rows
-- with a NULL author, because `NULL = auth.uid()` is never true and such a
-- row would be deletable by nobody. All 34 rows in production already have an
-- author, and all five insert paths in the app set it, so the column becomes
-- NOT NULL and the fallback goes with it.
--
-- ── 3. anon is named out of it ───────────────────────────────────────────
--
-- Four policies were granted to `public`, which includes `anon`. Measured
-- first: anon already saw nothing, because every branch tests `auth.uid()`
-- and that is NULL for anon — including the SECURITY DEFINER helper
-- `user_has_list_collaboration`, which scopes on `user_id = auth.uid()`.
-- So this changes no behaviour. It removes a standing invitation to add a
-- branch that does NOT test auth.uid() and hand it to anonymous callers.
--
-- ── What this does not fix ───────────────────────────────────────────────
--
-- `asset_lists` has no organization term in any policy, and 64 of its 66 rows
-- have a NULL `organization_id`. Lists are a personal/sharing feature whose
-- org column is vestigial. That is coherent and was verified not to be a
-- cross-tenant leak; it is NOT addressed here, and anyone who later decides
-- lists ARE org-owned must add the scoping rather than assume it exists.
-- =============================================================================

-- ── 1. The vocabulary ────────────────────────────────────────────────────
ALTER TABLE public.asset_list_collaborations
  DROP CONSTRAINT IF EXISTS asset_list_collaborations_permission_check;
-- `valid_permission` (read | write) remains and is now the only word on it.

-- ── 2. Authorship ────────────────────────────────────────────────────────
ALTER TABLE public.asset_list_items
  ALTER COLUMN added_by SET NOT NULL;

DROP POLICY IF EXISTS "List items are removed by their author, or by anyone on a mutual list"
  ON public.asset_list_items;
DROP POLICY IF EXISTS "List item notes are edited by their author, or by anyone on a mutual list"
  ON public.asset_list_items;

CREATE POLICY "List items are removed by their author, or by anyone on a mutual list"
  ON public.asset_list_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.asset_lists l
       WHERE l.id = asset_list_items.list_id
         AND (
           l.created_by = auth.uid()
           OR EXISTS (
             SELECT 1
               FROM public.asset_list_collaborations c
              WHERE c.list_id = l.id
                AND c.user_id = auth.uid()
                AND c.permission = 'write'
           )
         )
         AND (l.list_type = 'mutual' OR asset_list_items.added_by = auth.uid())
    )
  );

CREATE POLICY "List item notes are edited by their author, or by anyone on a mutual list"
  ON public.asset_list_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.asset_lists l
       WHERE l.id = asset_list_items.list_id
         AND (
           l.created_by = auth.uid()
           OR EXISTS (
             SELECT 1
               FROM public.asset_list_collaborations c
              WHERE c.list_id = l.id
                AND c.user_id = auth.uid()
                AND c.permission = 'write'
           )
         )
         AND (l.list_type = 'mutual' OR asset_list_items.added_by = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.asset_lists l
       WHERE l.id = asset_list_items.list_id
         AND (
           l.created_by = auth.uid()
           OR EXISTS (
             SELECT 1
               FROM public.asset_list_collaborations c
              WHERE c.list_id = l.id
                AND c.user_id = auth.uid()
                AND c.permission = 'write'
           )
         )
         AND (l.list_type = 'mutual' OR asset_list_items.added_by = auth.uid())
    )
  );

-- The sibling policies on the same table, for the same reason.
DROP POLICY IF EXISTS "Users can read list items for accessible lists"
  ON public.asset_list_items;
CREATE POLICY "Users can read list items for accessible lists"
  ON public.asset_list_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.asset_lists l
       WHERE l.id = asset_list_items.list_id
         AND (
           l.created_by = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.asset_list_collaborations c
              WHERE c.list_id = l.id AND c.user_id = auth.uid()
           )
         )
    )
  );

DROP POLICY IF EXISTS "Users can add items to lists they have write access to"
  ON public.asset_list_items;
CREATE POLICY "Users can add items to lists they have write access to"
  ON public.asset_list_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.asset_lists l
       WHERE l.id = asset_list_items.list_id
         AND (
           l.created_by = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.asset_list_collaborations c
              WHERE c.list_id = l.id
                AND c.user_id = auth.uid()
                AND c.permission = 'write'
           )
         )
    )
  );

-- ── 3. The grants ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own or shared lists" ON public.asset_lists;
CREATE POLICY "Users can read own or shared lists"
  ON public.asset_lists
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid() OR user_has_list_collaboration(id));

DROP POLICY IF EXISTS "Simple ownership update access for asset lists" ON public.asset_lists;
CREATE POLICY "Simple ownership update access for asset lists"
  ON public.asset_lists
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "List owners can manage all collaboration records"
  ON public.asset_list_collaborations;
CREATE POLICY "List owners can manage all collaboration records"
  ON public.asset_list_collaborations
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.asset_lists l
       WHERE l.id = asset_list_collaborations.list_id AND l.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view their own collaborations"
  ON public.asset_list_collaborations;
CREATE POLICY "Users can view their own collaborations"
  ON public.asset_list_collaborations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
