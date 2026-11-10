-- =============================================================================
-- ROLLBACK for 20261110010000_fix_trade_delete_paths.sql
--
-- Applying this restores the DEFECTS: onboarding can no longer remove a
-- portfolio that has a trade sheet, and empty batches accumulate in the Trade
-- Book again. It exists for an incident, not for convenience.
--
-- Returns both tables to "RLS enabled, no DELETE policy", which is their
-- pre-fix state. Nothing else on either table is touched.
-- =============================================================================

begin;

drop policy if exists "trade_sheets_delete" on public.trade_sheets;
drop policy if exists "trade_batches_delete_empty_only" on public.trade_batches;

-- Dropped last: the policy above is its only consumer.
drop function if exists public.trade_batch_is_empty(uuid);

commit;
