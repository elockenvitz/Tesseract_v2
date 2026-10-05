-- Record one onboarding mark without overwriting the other ones.
--
-- ── The defect ──────────────────────────────────────────────────────────
--
-- `users.pilot_progress` is a single JSONB column holding every mark for
-- every organization the user has ever been in, keyed `<stage>_at_<orgId>`.
-- The client wrote the WHOLE column on every mark, building the new document
-- from its own React Query snapshot:
--
--     .update({ pilot_progress: nextProgress })
--
-- Serialising those writes inside one tab was already done, and was never
-- enough: the snapshot is per-session. `pilot-progress` has
-- `staleTime: 60_000` and the app sets `refetchOnWindowFocus: false`, so a
-- backgrounded tab holds its picture of the column indefinitely. Its next
-- mark then writes that picture back and deletes everything recorded
-- anywhere else since.
--
-- Production, 2026-10-05, organization Quick Quest `e472e5b7`. Telemetry
-- proves six marks committed between 18:01:21 and 18:03:16 —
-- `tutorial_idea_id`, the three `pipeline_step_*`, `trade_book_unlocked`.
-- `trade_book_unlocked` then fired a SECOND time at 19:03:30 from another
-- session, an hour stale, and that write is the only Quick Quest key left on
-- the row. The September organizations' keys survived because they predated
-- the stale snapshot, which dates the base precisely.
--
-- The blast radius is the whole document, not one organization: a stale write
-- made while looking at org B erases org A's keys, `graduated_at_<orgA>`
-- included — and that flag gates pilot-seed suppression and the graduation
-- experience. A pilot could lose onboarding they finished days earlier in a
-- different workspace.
--
-- ── What this function guarantees ───────────────────────────────────────
--
-- One statement, so there is no read-modify-write window and no client
-- snapshot involved at all:
--
--   * `||` merges, so every other key survives — including other orgs'.
--   * `? p_key` makes it SET-ONCE. A key that already exists keeps its
--     original value, so a duplicate concurrent mark is idempotent and the
--     first timestamp is the one that stands. Sticky marks stay sticky.
--   * `where id = auth.uid()` — there is no user-id parameter, so this
--     cannot be pointed at another user's row. Isolation is structural
--     rather than policy-dependent.
--   * Returns the merged document, so the caller can replace its cache with
--     the authoritative value instead of guessing.
--
-- `p_value` is text because these keys hold two kinds of value: an ISO
-- timestamp for a stage mark, and a `trade_queue_items.id` for
-- `tutorial_idea_id_<orgId>`. Both are opaque to this function.
--
-- ── What it deliberately does NOT do ────────────────────────────────────
--
-- No key allowlist. Stage keys are plain strings precisely so the product can
-- add a stage without a migration, and encoding today's list here would
-- reintroduce that coupling. A user can therefore still write an arbitrary
-- key on their OWN row — exactly as the existing column grant already allows,
-- so this is unchanged residual risk, not new.
--
-- The direct UPDATE grant on `users.pilot_progress` stays. `OpsPilotPanel`
-- needs it to clear keys for a member, and revoking it would break that flow.
-- That path reads the row fresh immediately before writing, so it is not the
-- stale-snapshot defect; its narrow read-modify-write window is recorded as a
-- separate follow-up rather than widened into this migration.
--
-- Nothing is backfilled and no existing row is touched. The keys lost in
-- Quick Quest are not reconstructed here — that is disposable pilot data, and
-- inventing timestamps for marks would be worse than the gap.

CREATE OR REPLACE FUNCTION public.mark_pilot_progress(
  p_key   text,
  p_value text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.users
     SET pilot_progress =
           CASE
             -- Set-once: an existing key keeps the value it already has.
             WHEN COALESCE(pilot_progress, '{}'::jsonb) ? p_key
               THEN COALESCE(pilot_progress, '{}'::jsonb)
             ELSE COALESCE(pilot_progress, '{}'::jsonb)
                  || jsonb_build_object(p_key, p_value)
           END
   WHERE id = auth.uid()
     AND p_key IS NOT NULL
     AND p_key <> ''
     AND p_value IS NOT NULL
  RETURNING pilot_progress;
$function$;

COMMENT ON FUNCTION public.mark_pilot_progress(text, text) IS
  'Atomically merge one onboarding mark into users.pilot_progress for the '
  'calling user. Set-once: an existing key keeps its original value, so '
  'duplicate concurrent marks are idempotent. Replaces the client-side '
  'whole-column write, which erased marks made in other sessions and other '
  'organizations from a stale snapshot. Returns the merged document.';

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every new function in
-- `public` to `anon` as well as `authenticated`. This function is scoped by
-- `auth.uid()`, so for `anon` that is NULL and it writes nothing — but an
-- anonymous caller has no business reaching it, and leaving the grant in place
-- adds another `anon_security_definer_function_executable` advisory finding.
-- REVOKE FROM PUBLIC does not remove a grant `anon` holds in its own right,
-- so `anon` is named explicitly.
REVOKE ALL ON FUNCTION public.mark_pilot_progress(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_pilot_progress(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_pilot_progress(text, text) TO authenticated;
