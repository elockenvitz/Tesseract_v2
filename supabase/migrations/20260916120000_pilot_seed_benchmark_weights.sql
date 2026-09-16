-- Pilot seeding gives the new portfolio its benchmark file.
--
-- ── The gap ────────────────────────────────────────────────────────────────
--
-- `seed_pilot_template_portfolio` creates the portfolio, its memberships, its
-- holdings snapshot and its holdings. It has never written a single row of
-- benchmark state. The portfolio therefore ends up carrying a `benchmark`
-- LABEL that points at nothing, and every surface that compares against the
-- index -- Portfolio's benchmark comparison, Active Weight, the Trade Lab and
-- Outcomes views -- has nothing to resolve.
--
-- The refresh job could not close it either: `capture-benchmark-weights.mjs`
-- selected its targets from `portfolio_benchmark_weights`, so a portfolio got
-- a snapshot only if it already had one. (That script is fixed alongside this
-- migration to target `portfolios.benchmark` as well, which is the half that
-- lets a new book start.) But a pilot should not have to wait for a nightly
-- job to be able to see its benchmark at all, so seeding does it directly.
--
-- ── What this writes ───────────────────────────────────────────────────────
--
-- The most recent snapshot of the requested index, copied to the new
-- portfolio: one `benchmark_weight_snapshots` row and its
-- `portfolio_benchmark_weights` rows. Copied, not invented -- the weights are
-- the canonical SPY-derived S&P 500 file the product already stores, and no
-- number is computed here. If no such file exists yet the seed simply writes
-- none, which is the honest outcome and leaves the nightly job to fill it.
--
-- ── Idempotency ────────────────────────────────────────────────────────────
--
-- Both inserts are ON CONFLICT DO NOTHING against the existing unique keys
-- (portfolio_id, source, as_of_date) and (portfolio_id, asset_id,
-- as_of_date), so re-running the seed for the same portfolio and day is a
-- no-op rather than a duplicate.
--
-- ── RLS posture ────────────────────────────────────────────────────────────
--
-- Unchanged. This function is already SECURITY DEFINER and already gated on
-- `is_platform_admin()`; it now writes two more tables that the same platform
-- admin can already write. No policy is added, widened or relied upon, and no
-- new table is introduced.

create or replace function public.seed_pilot_benchmark_weights(
  p_portfolio_id uuid,
  p_org_id       uuid,
  p_index_name   text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src_portfolio uuid;
  v_as_of         date;
  v_source        text;
  v_source_type   text;
  v_weight_sum    numeric;
  v_holdings      integer;
  v_rows          integer := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'seed_pilot_benchmark_weights: platform admin only';
  end if;

  -- The newest snapshot of this index anywhere, and the portfolio it belongs
  -- to. A benchmark file is stored per portfolio, so "the canonical file" is
  -- whichever portfolio most recently received it.
  select s.portfolio_id, s.as_of_date, s.source, s.source_type, s.weight_sum, s.holdings_count
    into v_src_portfolio, v_as_of, v_source, v_source_type, v_weight_sum, v_holdings
    from public.benchmark_weight_snapshots s
   where s.index_name = p_index_name
   order by s.as_of_date desc, s.fetched_at desc
   limit 1;

  -- No file for this index yet. Write nothing rather than fabricate one.
  if v_src_portfolio is null then
    return 0;
  end if;

  insert into public.benchmark_weight_snapshots
    (portfolio_id, index_name, source, source_type, as_of_date,
     weight_sum, holdings_count, fetched_at, organization_id)
  values
    (p_portfolio_id, p_index_name, v_source, v_source_type, v_as_of,
     v_weight_sum, v_holdings, now(), p_org_id)
  on conflict (portfolio_id, source, as_of_date) do nothing;

  insert into public.portfolio_benchmark_weights
    (portfolio_id, asset_id, weight, source, as_of_date)
  select p_portfolio_id, w.asset_id, w.weight, w.source, w.as_of_date
    from public.portfolio_benchmark_weights w
   where w.portfolio_id = v_src_portfolio
     and w.as_of_date   = v_as_of
  on conflict (portfolio_id, asset_id, as_of_date) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.seed_pilot_benchmark_weights(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.seed_pilot_benchmark_weights(uuid, uuid, text) to service_role;

comment on function public.seed_pilot_benchmark_weights(uuid, uuid, text) is
  'Copies the newest canonical snapshot of an index, and its weights, onto a '
  'portfolio that has none. Idempotent. Returns rows written. Platform admin only.';
