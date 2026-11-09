-- P3 remediation 4 of 4: any authenticated user could rewrite the earnings
-- calendar that every tenant reads.
--
-- ── What was wrong, measured on production 2026-11-09 ─────────────────────
--
--   "Users can manage earnings dates"   ALL     TO PUBLIC  USING (auth.role() = 'authenticated')
--   "Users can view all earnings dates" SELECT  TO PUBLIC  USING (true)
--
-- The ALL policy governs INSERT, UPDATE and DELETE, and `auth.role() =
-- 'authenticated'` proves only that a session exists. Impersonating a real
-- member of one organization, in a rolled-back transaction:
--
--   insert into asset_earnings_dates (asset_id, earnings_date, earnings_quarter, earnings_year)
--     values ('<any asset>', '2099-01-01', 'Q1', 2099);    ->  SUCCEEDED
--
-- `assets` is a global table and so is this calendar, so a single bad or
-- malicious row is read by all 24 organizations. The table holds 0 rows today.
--
-- ── Intended access, established before changing it ───────────────────────
--
-- Reads are intentional and must be preserved. Earnings dates are published
-- by the issuer -- public market data, no tenant dimension -- and three call
-- sites read them:
--
--   src/hooks/useAssetEvents.ts:27     per-asset event strip
--   src/hooks/useAttention.ts:1271     attention signals
--   src/hooks/useCommandCenter.ts:355  upcoming-earnings list
--
-- All three are `select` only. Writes have NO caller at all: grepping src,
-- supabase/functions, scripts and .github finds zero insert, update, upsert or
-- delete against this table anywhere in the repository. The codebase already
-- documents the table as empty with no ingestion, in three places
-- (src/lib/memory/what-changed.ts:23, ready-to-revisit.ts:118,
-- deferral-semantics.ts:30).
--
-- So dropping the write policy cannot break ingestion, because there is none
-- to break. When ingestion does land it must come through a service path, the
-- way the price cache already does -- see the price_history_cache lane, where
-- the proxy is the sole writer and authenticated/anon get 42501.
--
-- ── The fix ───────────────────────────────────────────────────────────────
--
-- Drop the write policy. With RLS enabled and no permissive policy for
-- INSERT, UPDATE or DELETE, those verbs are denied for every role that does
-- not bypass RLS. service_role bypasses RLS, so a future ingestion job keeps
-- working with no policy of its own.
--
-- The SELECT policy is rebuilt TO authenticated rather than TO PUBLIC. anon
-- has no grant on this table today -- measured: `select count(*) from
-- asset_earnings_dates` as anon returns 42501, not 0 -- so `USING (true)` is
-- not currently reachable without an account. Naming authenticated means a
-- future grant cannot silently publish the calendar to the browser bundle's
-- anon key.
--
-- The authenticated INSERT/UPDATE/DELETE/TRUNCATE grants are deliberately
-- LEFT IN PLACE here: table-privilege cleanup across the database is P3-2,
-- and mixing one table's grants into this migration would make neither change
-- independently reviewable. RLS denies the writes meanwhile. TRUNCATE is the
-- exception worth naming, because it is NOT governed by RLS at all -- an
-- authenticated caller holding TRUNCATE can still empty this table after this
-- migration. That is precisely P3-2's subject and it is listed as the open
-- item at the foot of this file.

begin;

drop policy if exists "Users can manage earnings dates" on public.asset_earnings_dates;

drop policy if exists "Users can view all earnings dates" on public.asset_earnings_dates;

create policy "asset_earnings_dates_select"
  on public.asset_earnings_dates
  for select
  to authenticated
  using (true);

comment on table public.asset_earnings_dates is
  'Global earnings calendar. Public market data, no tenant dimension: readable by every authenticated user by design. Writes are denied by the absence of any INSERT/UPDATE/DELETE policy; ingestion must run as service_role, which bypasses RLS. Do not add a write policy for authenticated - see 20261109190003.';

commit;

-- ── Still open after this migration, by design ────────────────────────────
--
-- `authenticated` retains the raw TRUNCATE, REFERENCES, TRIGGER and MAINTAIN
-- privileges on this table (Supabase's ALTER DEFAULT PRIVILEGES grants them on
-- everything created in `public`). TRUNCATE ignores RLS, so it is the one that
-- matters. Revoking it belongs to P3-2, which does the same sweep across all
-- applicable tables in one reviewable change.
--
-- Verify after running, as an ordinary authenticated member:
--   select count(*) from asset_earnings_dates;   -- succeeds (0 rows today)
--   insert into asset_earnings_dates (asset_id, earnings_date, earnings_quarter, earnings_year)
--     values ('<any asset>', '2099-01-01', 'Q1', 2099);   -- 42501
