-- A layout template could describe its fields but not its sections.
--
-- `field_config` places each field into a section, with an order and a
-- span, so a template already carries which fields exist and how they are
-- laid out. But a section's own name, its order on the page, whether it is
-- hidden, and any section the user added existed ONLY in
-- `user_asset_layout_selections.section_overrides` — which is per asset.
--
-- So renaming "Thesis & Risks" on AAPL could never become part of a
-- template; it was stuck on AAPL forever. This column is the template's
-- half of that, holding the same shape as `section_overrides`:
--   [{ section_id, name_override?, is_hidden?, display_order?, is_added? }]
--
-- Nullable with no default and no backfill, deliberately: every existing
-- layout keeps reading as "this template says nothing about sections", and
-- the resolver treats null exactly as it treats an absent template layer.
-- Nothing reads this column until the client that writes it ships, so this
-- migration cannot change what any user currently sees.
--
-- RLS: none needed. This is a new column on an existing table whose row
-- policies are already scoped to the owner (`user_id = auth.uid()`) plus
-- `user_has_layout_access` for shared layouts. A column cannot be read
-- without row access, so it inherits that posture unchanged. The table is
-- per-user, not org-owned, so no cross-org isolation test applies.
--
-- Applied to production 2026-10-26.
alter table public.user_asset_page_layouts
  add column if not exists section_config jsonb;

comment on column public.user_asset_page_layouts.section_config is
  'Section-level layout for this template: name overrides, order, hidden flags and added sections. Same shape as user_asset_layout_selections.section_overrides, which takes precedence over this per asset. Null means the template says nothing about sections.';
