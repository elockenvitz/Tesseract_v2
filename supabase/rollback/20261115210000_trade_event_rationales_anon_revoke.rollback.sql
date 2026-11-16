-- Rollback for 20261115210000_trade_event_rationales_anon_revoke.sql
--
-- ── Why this file is NOT in supabase/migrations/ ─────────────────────────
--
-- Five `*.rollback.sql` files already sit in `supabase/migrations/`, where a
-- glob-ordered runner would apply them FORWARD as if they were migrations —
-- undoing the change immediately after making it. That is a known, recorded
-- hazard in this repo and this file declines to become the sixth instance.
-- The five existing ones are listed as an adjacent finding and are not moved
-- here, because moving them is a separate change.
--
-- Restores the pre-migration state exactly as measured on production
-- 2026-11-15: all eight policies TO PUBLIC, and `anon` holding
-- SELECT/INSERT/UPDATE/DELETE on both tables.
--
-- Only run this if the forward migration caused a problem. Note that it
-- restores a WEAKER posture by design — that is what a rollback is.

begin;

grant select, insert, update, delete on public.portfolio_trade_events to anon;
grant select, insert, update, delete on public.trade_event_rationales to anon;

alter policy trade_events_select on public.portfolio_trade_events to public;
alter policy trade_events_insert on public.portfolio_trade_events to public;
alter policy trade_events_update on public.portfolio_trade_events to public;
alter policy trade_events_delete on public.portfolio_trade_events to public;

alter policy rationales_select on public.trade_event_rationales to public;
alter policy rationales_insert on public.trade_event_rationales to public;
alter policy rationales_update on public.trade_event_rationales to public;
alter policy rationales_delete on public.trade_event_rationales to public;

commit;
