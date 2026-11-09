-- `theme_research_fields` gets the two columns the field library needs.
--
-- ── Why ───────────────────────────────────────────────────────────────────
--
-- `theme_research_fields` is otherwise column-for-column `research_fields`
-- plus `placeholder`. It is missing exactly two:
--
--   category           what the field library groups a field under
--   suggested_section  where the library proposes to drop it
--
-- Both are read by `AssetPageFieldCustomizer`, which is the editor the Theme
-- page is being moved onto. Without them a theme's field library is one
-- undifferentiated list while the asset's is grouped, which is the difference
-- the parity work exists to remove.
--
-- Nullable with no default and no backfill, which is how `research_fields`
-- holds them: a field with no category falls into the library's
-- "Uncategorized" group, and that is the correct state for all 270 existing
-- theme fields until somebody categorises them. Adding a default would
-- invent a category for every one of them.
--
-- ── RLS posture ───────────────────────────────────────────────────────────
--
-- UNCHANGED by this migration. Two nullable columns on an existing table; no
-- policy, grant, view or function is touched. The table's existing policies
-- are org-scoped (`organization_id = current_org_id()`) and these columns are
-- covered by them like every other column.
--
-- Those policies have two defects, recorded here because the parity work is
-- about to make this table load-bearing for a new feature, and fixed in the
-- migration that adds the layout tables rather than silently here:
--
--   * they are `TO public`, not `TO authenticated` (Standing Rule 5)
--   * they do not check `is_active_member_of_current_org()`, so a removed
--     member whose JWT still names the org keeps reading and writing
--
-- No data is read, moved or deleted.

begin;

alter table public.theme_research_fields
  add column if not exists category text;

alter table public.theme_research_fields
  add column if not exists suggested_section text;

comment on column public.theme_research_fields.category is
  'Field-library grouping, as research_fields.category. Null means Uncategorized.';
comment on column public.theme_research_fields.suggested_section is
  'Section slug the field library proposes when adding this field, as research_fields.suggested_section.';

commit;
