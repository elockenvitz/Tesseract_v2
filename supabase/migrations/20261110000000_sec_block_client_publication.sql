-- =============================================================================
-- Block writer-controlled publication on ai_column_library and rating_scales
--
-- THE DEFECT
--
--   Both tables decided who may READ a row from a column the WRITER controls,
--   and neither write rule constrained that column. So any authenticated user
--   could write a row of their own and then flip it into the branch that admits
--   everyone -- set is_system = true, or, on rating_scales, supply a NULL or
--   foreign organization_id. Both tables also carried an anon SELECT grant
--   under a `TO public` policy, so the published row was readable with no
--   session at all.
--
--   Measured against production before this migration
--   (supabase/tests/system-flag-publication.sql, 7 PASS / 8 FAIL):
--
--     a plain member inserted is_system = true            -> PUBLISHED
--     the owner flipped their existing row to is_system   -> PUBLISHED
--     an upsert flipped it                                -> PUBLISHED
--     an org admin inserted is_system = true              -> PUBLISHED
--     an org-owned tenant row was flipped in place        -> PUBLISHED
--     a client created a scale with organization_id NULL  -> WORLD-READABLE
--     an org-A admin wrote a scale into org B             -> ACCEPTED
--     anon, with no session at all, read                  -> 9 rows
--
--   No customer data had actually been published: all 8 publishable rows in
--   production are legitimate seeds (4 AI columns, 4 rating scales), every one
--   with organization_id NULL and user_id/created_by NULL, written by migrations
--   as the table owner. This closes a door that was standing open, rather than
--   cleaning up after a theft.
--
-- ── THE FIX, and why it is policy predicates rather than a CHECK ─────────────
--
--   A CHECK constraint applies to EVERY writer, the table owner included, so it
--   would have broken the two legitimate paths that must keep working:
--   `provision_client_org()` (platform-admin gated, SECURITY DEFINER) inserts a
--   default scale for each new client org, and migrations insert the system
--   seeds. RLS policies apply only to non-owner roles, so constraining the
--   policy's WITH CHECK stops clients and leaves the trusted paths untouched.
--   Assertion 15 of the suite is there to prove that distinction holds.
--
--   WITH CHECK validates the POST-image, so it covers INSERT, UPDATE and the
--   UPDATE half of an upsert in one statement. `is_system IS NOT TRUE` rather
--   than `= false` so that an explicit NULL is also refused the system branch
--   (a NULL does not satisfy `is_system = true` either, so such a row is not
--   published, but the write rule should not depend on that coincidence).
--
--   NARROWING, stated plainly: rating_scales writes now require
--   `organization_id = current_org_id()` on both the row being written and the
--   post-image. The old rule accepted any organization_id, including NULL,
--   whenever `created_by = auth.uid()` held. `created_by` is NULL on all 31
--   production rows and no client code writes this table at all (it is
--   read-only from the app; the only writers are the provisioning RPC and
--   migrations), so no existing row or code path loses access. A user who
--   creates a scale and then switches their current organization would no
--   longer be able to edit it, which is the correct tenant behaviour.
--
--   The `organization_id IS NULL` read branch is removed. It was exactly
--   redundant: all 4 rows it admitted also carry is_system = true, and
--   `is_system IS NOT TRUE AND organization_id IS NULL` matched 0 rows. It was
--   the branch that made an orphaned tenant row world-readable.
--
-- RLS POSTURE: NARROWED on both tables. Four policies replaced, all four now
-- `TO authenticated` instead of `TO public`; anon loses every grant on both
-- tables. Nothing is widened. No data is modified.
--
-- Rollback: 20261110000000_sec_block_client_publication.rollback.sql, which
-- restores the previous policies and grants EXACTLY, and therefore restores the
-- vulnerability. It exists for an incident, not for convenience.
-- =============================================================================

begin;

-- ── ai_column_library ───────────────────────────────────────────────────────
-- anon never needs this table: the app reads it only behind `enabled: !!user`.
revoke all on public.ai_column_library from anon;

drop policy if exists "Users can view system columns" on public.ai_column_library;
create policy "ai_column_library_select"
  on public.ai_column_library
  for select
  to authenticated
  using (
    is_system = true
    or user_id = auth.uid()
  );

drop policy if exists "Users can manage their own columns" on public.ai_column_library;
create policy "ai_column_library_own_write"
  on public.ai_column_library
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and is_system is not true
  );

-- ── rating_scales ───────────────────────────────────────────────────────────
revoke all on public.rating_scales from anon;

drop policy if exists "Users can view rating scales in current org" on public.rating_scales;
create policy "rating_scales_select"
  on public.rating_scales
  for select
  to authenticated
  using (
    is_system = true
    or (
      organization_id = current_org_id()
      and is_active_member_of_current_org()
    )
  );

drop policy if exists "Org admins can manage rating scales in current org" on public.rating_scales;
create policy "rating_scales_write"
  on public.rating_scales
  for all
  to authenticated
  using (
    organization_id = current_org_id()
    and (
      created_by = auth.uid()
      or is_active_org_admin_of_current_org()
    )
  )
  with check (
    organization_id = current_org_id()
    and (
      created_by = auth.uid()
      or is_active_org_admin_of_current_org()
    )
    and is_system is not true
  );

commit;
