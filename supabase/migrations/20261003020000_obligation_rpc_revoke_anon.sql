-- Obligation RPCs: take EXECUTE away from `anon`.
--
-- ── The hole this closes ─────────────────────────────────────────────────
--
-- `20261002090000` DROPs and recreates `raise_memory_obligation`, and
-- `20260930180000` creates `supersede_memory_obligation`. Both then issue:
--
--     revoke all on function ... from public;
--     grant execute on function ... to authenticated, service_role;
--
-- and `20261002090000` states in a comment that "`anon` is deliberately
-- absent". It was not. `REVOKE ... FROM public` removes the PUBLIC grant; it
-- does NOT remove a grant held by `anon` as a role in its own right, and
-- Supabase's ALTER DEFAULT PRIVILEGES hands `anon` EXECUTE on every new
-- function in `public`. DROP discards the old ACL — including the
-- foundation's explicit `revoke ... from public, anon` — so the recreated
-- function came back reachable by `anon` while the sibling
-- `clear_memory_obligation`, which was never dropped, stayed correctly
-- revoked.
--
-- Why that is exploitable rather than merely untidy:
--
--   1. PostgREST publishes every function in `public` as an RPC endpoint
--      reachable with the publishable key, which ships in the browser bundle.
--   2. Both functions are SECURITY DEFINER, so the body runs as the owner —
--      the caller's lack of privilege on `memory_obligations`,
--      `memory_events` and `is_member_of_org` does not stop it.
--   3. The membership guard is `is_member_of_org(p_org_id) or auth.uid() is
--      null`. The `auth.uid() is null` arm exists so server-side and
--      migration contexts work. For an anonymous caller `auth.uid()` IS
--      null, so the guard passes for ANY `p_org_id`.
--
-- Net effect: an unauthenticated caller could insert obligations and memory
-- events into an arbitrary organisation. Verified against production with
-- `has_function_privilege('anon', oid, 'EXECUTE')` — true for both recreated
-- functions, false for the untouched `clear_memory_obligation`.
--
-- Tightening the `auth.uid() is null` arm is deliberately NOT attempted here:
-- it is load-bearing for service-role writes, and narrowing it is a larger
-- change than this fix needs. Removing anon's EXECUTE closes the reachable
-- path, which is the thing that is actually wrong.
--
-- Issued as its own migration rather than by editing the two already-applied
-- files, so the ledger and the repository keep saying the same thing.
--
-- RLS posture: UNCHANGED. No policy, table grant, column or constraint is
-- touched. This only removes a privilege that was never intended to exist.

revoke all on function public.raise_memory_obligation(
  uuid, text, text, uuid, uuid, timestamptz, text, uuid, text, text
) from anon;

revoke all on function public.supersede_memory_obligation(
  uuid, text, text, uuid, uuid, timestamptz, text, uuid, text, text
) from anon;

-- Belt and braces: the foundation already revoked this one and the live ACL
-- confirms it, but it costs nothing to state the invariant for all three in
-- one place.
revoke all on function public.clear_memory_obligation(uuid, text) from anon;
