-- =============================================================================
-- ROLLBACK for 20261110000000_sec_block_client_publication.sql
--
-- WARNING: this restores the vulnerability. The policies and grants below are
-- byte-for-byte the pre-fix production state, read from pg_policies and
-- aclexplode on 2026-11-10, which means applying this file makes it possible
-- again for any authenticated user to publish a row to unauthenticated readers
-- by setting is_system = true, and for an org admin to orphan or cross-plant a
-- rating scale.
--
-- It exists so an incident has a known-good exit, not for convenience. Prefer
-- fixing forward. If you apply it, re-run
-- supabase/tests/system-flag-publication.sql and expect 7 PASS / 8 FAIL again.
-- =============================================================================

begin;

-- ── ai_column_library ───────────────────────────────────────────────────────
drop policy if exists "ai_column_library_select" on public.ai_column_library;
create policy "Users can view system columns"
  on public.ai_column_library
  for select
  to public
  using (((is_system = true) or (user_id = auth.uid())));

drop policy if exists "ai_column_library_own_write" on public.ai_column_library;
create policy "Users can manage their own columns"
  on public.ai_column_library
  for all
  to public
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));

grant select, insert, update, delete on public.ai_column_library to anon;

-- ── rating_scales ───────────────────────────────────────────────────────────
drop policy if exists "rating_scales_select" on public.rating_scales;
create policy "Users can view rating scales in current org"
  on public.rating_scales
  for select
  to public
  using ((
    (is_system = true)
    or (organization_id is null)
    or ((organization_id = current_org_id()) and is_active_member_of_current_org())
  ));

-- NOTE: the original carried no WITH CHECK, so the INSERT/UPDATE post-image
-- check fell back to USING. Reproduced exactly, omission included, because that
-- fallback is part of what made the row writable in the first place.
drop policy if exists "rating_scales_write" on public.rating_scales;
create policy "Org admins can manage rating scales in current org"
  on public.rating_scales
  for all
  to public
  using ((
    (created_by = auth.uid())
    or ((organization_id = current_org_id()) and is_active_org_admin_of_current_org())
  ));

grant select, insert, update, delete on public.rating_scales to anon;

commit;
