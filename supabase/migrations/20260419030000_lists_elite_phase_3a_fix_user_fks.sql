-- ══════════════════════════════════════════════════════════════════════
-- Lists Elite · Phase 3A fix · user FKs must reference public.users
-- ══════════════════════════════════════════════════════════════════════
-- The Phase 1/3A migrations mistakenly pointed the new user-referencing
-- FKs (assignee_id, list_statuses.created_by, list_tags.created_by,
-- list_item_tags.created_by) at auth.users. PostgREST embedded selects
-- only resolve through public-schema relationships, and the existing
-- convention in this codebase (e.g. asset_list_items.added_by) already
-- targets public.users. Re-point all new FKs to match.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE asset_list_items
  DROP CONSTRAINT asset_list_items_assignee_id_fkey,
  ADD CONSTRAINT asset_list_items_assignee_id_fkey
    FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE list_statuses
  DROP CONSTRAINT list_statuses_created_by_fkey,
  ADD CONSTRAINT list_statuses_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE list_tags
  DROP CONSTRAINT list_tags_created_by_fkey,
  ADD CONSTRAINT list_tags_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE list_item_tags
  DROP CONSTRAINT list_item_tags_created_by_fkey,
  ADD CONSTRAINT list_item_tags_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
