-- Simulation provenance: the before/after numbers for b9020934.
--
-- READ-ONLY. No INSERT, no UPDATE, no DELETE, no DDL. Safe to run against
-- production, and meant to be: this is the acceptance check for a fix whose
-- effect is only observable after a real Trade Lab Execute.
--
-- ── What it is checking ──────────────────────────────────────────────────
--
-- `accepted_trades.lab_variant_id` is the only record of which simulated
-- line produced a committed trade. Three write paths set it and then
-- hard-deleted the `lab_variants` row they had just pointed at, against an
-- `ON DELETE SET NULL` foreign key, so the link was erased by the same
-- operation that wrote it. The fix archives the variant
-- (`visibility_tier = 'archive'`) instead of deleting it.
--
-- ── How to use it ────────────────────────────────────────────────────────
--
--   1. Run it BEFORE the frontend deploy and keep the output.
--   2. Deploy, then perform one Trade Lab Execute of one variant.
--   3. Run it again.
--
-- PASS requires all four of these, together:
--
--   accepted_trades_total                     rises by 1
--   accepted_trades_with_lab_variant_id       rises by 1   <- was 0
--   lab_variants_archived                     rises by 1   <- was 0
--   lab_variants_total                        rises by 1   <- must NEVER fall
--
-- The last line is the one that cannot be satisfied by the old behaviour. A
-- hard delete keeps `lab_variants_total` flat or lowers it and leaves
-- `lab_variants_archived` at zero, so a run that shows the link appearing
-- while the total did not rise means something other than this fix did it.
--
-- `lab_variants_trashed` is reported to keep the two kinds of removal
-- distinct: 'trash' is the user removing a line they did not take, which is
-- still a hard delete by design because nothing points at it.
--
-- ── Baseline, production (wfcebeagznzgeuyysbnt), 2026-11-15 ─────────────
--
--   accepted_trades_total                        53
--   accepted_trades_simulation                   10
--   accepted_trades_simulation_in_epoch          10
--   accepted_trades_with_lab_variant_id           0
--   accepted_trades_simulation_with_variant       0
--   lab_variants_total                           21
--   lab_variants_active                          21
--   lab_variants_archived                         0
--   lab_variants_trashed                          0
--   lab_variants_soft_deleted                     0
--
-- The epoch row matters. A coverage figure is meaningless until the
-- denominator starts at the writer's creation date, and the Memory Spine
-- number in this same release collapsed from 1.8% to 50% once that was
-- applied. Here it does not help: all three `lab_variant_id` writes were
-- introduced on 2026-03-20 (commit 640b3503) and every simulation trade in
-- production postdates that, so the rate is a flat 0 of 10 with no excuse.
--
-- Per-organization counts are deliberately NOT grouped here. This runs
-- through the Management API, which bypasses RLS and merges every pilot
-- organization, so a grouped figure would invite reading one tenant's number
-- as the product's. The question being asked is whether the link survives an
-- execute at all, which is not a per-tenant question.

with trades as (
  select * from public.accepted_trades
), variants as (
  select * from public.lab_variants
)
select
  'accepted_trades_total'                     as metric,
  (select count(*) from trades)::int          as value
union all select
  'accepted_trades_simulation',
  (select count(*) from trades where source = 'simulation')::int
union all select
  -- Writer epoch: 2026-03-20, commit 640b3503.
  'accepted_trades_simulation_in_epoch',
  (select count(*) from trades
    where source = 'simulation' and created_at >= '2026-03-20T00:00:00Z')::int
union all select
  'accepted_trades_with_lab_variant_id',
  (select count(lab_variant_id) from trades)::int
union all select
  'accepted_trades_simulation_with_variant',
  (select count(lab_variant_id) from trades where source = 'simulation')::int
union all select
  'lab_variants_total',
  (select count(*) from variants)::int
union all select
  'lab_variants_active',
  (select count(*) from variants where visibility_tier = 'active')::int
union all select
  'lab_variants_archived',
  (select count(*) from variants where visibility_tier = 'archive')::int
union all select
  'lab_variants_trashed',
  (select count(*) from variants where visibility_tier = 'trash')::int
union all select
  'lab_variants_soft_deleted',
  (select count(*) from variants where deleted_at is not null)::int
order by metric;
