-- =============================================================================
-- asset_list_items — enforce the own-row rule the product already states
--
-- The DELETE and UPDATE policies admitted the list owner and ANY write/admin
-- collaborator for ANY row. They referred neither to who added the row nor to
-- the parent list's `list_type`, so they were strictly broader than the rule
-- the product enforces in `src/lib/lists/list-permissions.ts`:
--
--   list_type = 'mutual'        -> any write-access user may remove any row
--   list_type = 'collaborative' -> only `added_by = auth.uid()` may remove it,
--                                  and that applies to the list OWNER too
--
-- Measured against production BEFORE this change, with a forged JWT: a
-- collaborator holding permission = 'write' on a collaborative list both
-- UPDATEd and DELETEd a row added by another member (update=1 delete=1). The
-- UI hides those controls, which is not enforcement — PostgREST accepted the
-- call. Proof and the 16 after-assertions live in
-- `supabase/tests/list-items-own-row-authorization.sql`.
--
-- This NARROWS both policies. Nothing is widened. The only respect in which
-- it is broader than `list-permissions.ts` is the NULL-author fallback below,
-- which is called out because CLAUDE.md requires saying so prominently.
--
-- ── The NULL `added_by` fallback ─────────────────────────────────────────
--
-- `added_by` is nullable with no default. Under a bare `added_by = auth.uid()`
-- test, a row with a NULL author is deletable by NOBODY, ever, because
-- `NULL = uuid` is never true. Production holds 0 such rows out of 34 today,
-- but the column permits them, so the list OWNER is given that row. The
-- product rule would deny the owner too; an unremovable row is the worse
-- outcome. Making `added_by` NOT NULL would remove the need for this and is
-- recorded as a follow-up rather than bundled here.
--
-- ── RLS posture ──────────────────────────────────────────────────────────
--
-- `asset_list_items` is reachable only by `authenticated`; anon holds nothing
-- here. SELECT and INSERT are unchanged by this migration. Note that none of
-- this table's policies carry an organization term — access derives entirely
-- from the parent list's `created_by` and its collaboration rows. That is a
-- separate question from this one and is left as recorded.
-- =============================================================================

DROP POLICY IF EXISTS "Users can delete items from lists they have write access to"
  ON public.asset_list_items;
DROP POLICY IF EXISTS "Users can update items in lists they have write access to"
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
         -- Write access to the parent list, exactly as before.
         AND (
           l.created_by = auth.uid()
           OR EXISTS (
             SELECT 1
               FROM public.asset_list_collaborations c
              WHERE c.list_id = l.id
                AND c.user_id = auth.uid()
                AND c.permission = ANY (ARRAY['admin'::text, 'write'::text])
           )
         )
         -- ...and, on a collaborative list, the row must be yours.
         AND (
           l.list_type = 'mutual'
           OR asset_list_items.added_by = auth.uid()
           OR (asset_list_items.added_by IS NULL AND l.created_by = auth.uid())
         )
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
                AND c.permission = ANY (ARRAY['admin'::text, 'write'::text])
           )
         )
         AND (
           l.list_type = 'mutual'
           OR asset_list_items.added_by = auth.uid()
           OR (asset_list_items.added_by IS NULL AND l.created_by = auth.uid())
         )
    )
  )
  -- The same test on the NEW row, so an edit cannot move a row into a list the
  -- caller may not write, nor hand its authorship to someone else.
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
                AND c.permission = ANY (ARRAY['admin'::text, 'write'::text])
           )
         )
         AND (
           l.list_type = 'mutual'
           OR asset_list_items.added_by = auth.uid()
           OR (asset_list_items.added_by IS NULL AND l.created_by = auth.uid())
         )
    )
  );
