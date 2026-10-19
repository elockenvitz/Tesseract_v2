-- =============================================================================
-- global_search — tenant isolation
--
-- The global_search(text, integer) RPC was SECURITY DEFINER (owned by postgres)
-- with no organization predicate in its body, so it bypassed RLS and returned
-- matches from EVERY organization. An ordinary authenticated org-A user could
-- read org-B portfolios, themes, projects, asset lists, notebooks, TDFs, teams,
-- workflows, users, simulations and model files by name. EXECUTE was also held
-- by PUBLIC/anon, so it was reachable with the anon key.
--
-- Fix (smallest safe change): run the function with the CALLER's privileges so
-- each table's existing RLS enforces isolation — one source of truth, no
-- duplicated predicates. The signature, body, return shape, and (global)
-- asset-search behaviour are unchanged. assets has no organization_id and a
-- USING(true) SELECT policy, so it stays searchable to any authenticated user.
--
-- The only caller is the authenticated app (src/hooks/useObjectSearch.ts);
-- anonymous search is not a feature, so EXECUTE is narrowed to authenticated.
--
-- Verified on the r3 prod-schema replica with two synthetic orgs across all 11
-- access-controlled entity types (see supabase/tests/global-search-tenant-isolation.sql).
-- Rollback: 20261019150000_global_search_tenant_isolation_DOWN.sql.rollback
-- =============================================================================

alter function public.global_search(text, integer) security invoker;
alter function public.global_search(text, integer) set search_path = public, pg_temp;

revoke execute on function public.global_search(text, integer) from public;
revoke execute on function public.global_search(text, integer) from anon;
grant  execute on function public.global_search(text, integer) to authenticated;
