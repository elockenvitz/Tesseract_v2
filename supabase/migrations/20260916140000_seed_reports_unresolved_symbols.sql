-- Pilot seeding stops silently dropping template names.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `seed_pilot_template_portfolio` inserts holdings with:
--
--     FROM jsonb_array_elements(p_positions) pos
--     JOIN assets a ON a.symbol = pos->>'symbol'
--
-- An INNER join. A template symbol with no `assets` row is dropped, silently:
-- no error, no warning, no record that the book is short a name.
--
-- It then reports the wrong number on top of that. `v_position_count` is
-- `jsonb_array_length(p_positions)`, computed BEFORE the insert, so both the
-- returned `positions_loaded` and the `total_positions` written onto
-- `portfolio_holdings_snapshots` claim every template name landed.
--
-- Observed: the Tech & Consumer Growth template lists 35 names; 25 of the 26
-- pilot books hold 34. DUOL is the missing one, and its `assets` row was
-- created 2026-08-18 -- after those 25 orgs were seeded. The 26th (Bogey Cap,
-- seeded 2026-09-15) has all 35, which is the same rule producing the right
-- answer once the asset existed. Nothing was wrong with the template.
--
-- ── What changes ───────────────────────────────────────────────────────────
--
-- The count becomes the truth -- how many rows were actually written -- and
-- the unresolved symbols are returned so the operator can see them. The
-- snapshot's `total_positions` is corrected to match.
--
-- Deliberately NOT a hard failure. Raising here would have refused to create
-- 25 pilot orgs over one missing ticker, and an org with 34 of 35 names is
-- usable while an org that does not exist is not. The caller surfaces the
-- warning; escalating to an exception is a product call, and easy from here.
--
-- ── Idempotency and compatibility ──────────────────────────────────────────
--
-- Signature and return shape are unchanged apart from one added key, so
-- existing callers keep working. Re-running the seed for an org behaves as it
-- did: the holdings insert is still ON CONFLICT DO UPDATE.
--
-- ── RLS posture ────────────────────────────────────────────────────────────
--
-- Unchanged. Same SECURITY DEFINER function, same `is_platform_admin()` gate,
-- same tables, same grants. No policy added, widened or relied upon.

create or replace function public.seed_pilot_unresolved_symbols(p_positions jsonb)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(pos->>'symbol' order by pos->>'symbol'), '{}')
    from jsonb_array_elements(p_positions) pos
   where not exists (select 1 from assets a where a.symbol = pos->>'symbol')
$$;

revoke all on function public.seed_pilot_unresolved_symbols(jsonb) from public, anon;
grant execute on function public.seed_pilot_unresolved_symbols(jsonb) to authenticated, service_role;

comment on function public.seed_pilot_unresolved_symbols(jsonb) is
  'Template symbols with no assets row. The seed drops these silently; this is how a caller sees which.';
