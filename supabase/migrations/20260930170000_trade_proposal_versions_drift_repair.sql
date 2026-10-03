-- Schema drift repair: trade_proposal_versions
--
-- This table EXISTS IN PRODUCTION and has no DDL anywhere in this repository.
-- It was created outside the migration ledger. Nothing in the ledger describes
-- its columns, its indexes, its constraints, or its RLS, which means every
-- migration written since has been written against an incomplete picture of
-- the schema.
--
-- This file does not change production. It writes down what is already there,
-- verified read-only against the live database on 2026-09-30, so that the
-- NEXT migration (which does change it) has an honest starting point and so a
-- fresh environment built from this ledger matches production.
--
-- Everything here is IF NOT EXISTS / guarded. Applied against production it is
-- a no-op; applied against a fresh database it reproduces the live shape.
--
-- Live row count at the time of writing: 0.
--
-- ─────────────────────────────────────────────────────────────────────────
-- RLS POSTURE AS FOUND — stated prominently because it is wrong, and the
-- next migration fixes it. Recording it here first so the repair is a
-- reviewable diff rather than an unexplained new policy set.
--
--   1. `anon` holds INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES and
--      TRIGGER on this table. RLS is enabled and every policy is `to
--      authenticated`, so an anonymous SELECT/INSERT/UPDATE/DELETE is denied
--      by having no policy to satisfy — but the grants should never have been
--      there, and TRUNCATE is not subject to RLS at all.
--
--   2. `authenticated` and `anon` both hold TRUNCATE. TRUNCATE BYPASSES ROW
--      LEVEL SECURITY ENTIRELY. Any signed-in user can therefore empty this
--      table. It holds zero rows today, which is the only reason this is not
--      currently a live data-loss hole; it stops being harmless the moment
--      the next migration makes it the canonical record of what was
--      recommended.
--
--   3. `authenticated` holds UPDATE and DELETE. RLS currently blocks both by
--      having no such policy, so append-only holds by omission rather than by
--      intent — one permissive policy added later silently makes history
--      editable.
--
--   4. The SELECT policy requires the reader to be the proposal's own author
--      (`p.user_id = auth.uid()`) or a member of the proposal's LAB portfolio.
--      Neither is the right test for a PM reading what was recommended to
--      them: a PM who is not on the analyst's lab cannot read the version at
--      all. This table is also not org-scoped — it has no organization_id and
--      does not go through `portfolio_in_current_org`, unlike
--      `decision_requests`.
--
--   5. The INSERT policy requires `p.user_id = auth.uid()`, so only a
--      proposal's author can version it.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.trade_proposal_versions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null
    references public.trade_proposals(id) on delete cascade,
  version_number integer not null default 1,
  weight numeric,
  shares integer,
  sizing_mode text,
  sizing_context jsonb default '{}'::jsonb,
  notes text,
  trigger_event text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  portfolio_id uuid references public.portfolios(id),
  constraint trade_proposal_versions_proposal_id_version_number_key
    unique (proposal_id, version_number)
);

create index if not exists idx_trade_proposal_versions_proposal
  on public.trade_proposal_versions (proposal_id);

alter table public.trade_proposal_versions enable row level security;

-- The policies as they exist live. Reproduced verbatim so a fresh database
-- matches production; both are replaced by the next migration.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'trade_proposal_versions'
      and policyname = 'Users can view versions of accessible proposals'
  ) then
    create policy "Users can view versions of accessible proposals"
      on public.trade_proposal_versions
      for select to authenticated
      using (
        exists (
          select 1 from public.trade_proposals p
          where p.id = trade_proposal_versions.proposal_id
            and (
              p.user_id = auth.uid()
              or exists (
                select 1
                from public.trade_labs tl
                join public.portfolio_memberships pm on pm.portfolio_id = tl.portfolio_id
                where tl.id = p.lab_id and pm.user_id = auth.uid()
              )
            )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'trade_proposal_versions'
      and policyname = 'Users can create versions for their proposals'
  ) then
    create policy "Users can create versions for their proposals"
      on public.trade_proposal_versions
      for insert to authenticated
      with check (
        exists (
          select 1 from public.trade_proposals p
          where p.id = trade_proposal_versions.proposal_id
            and p.user_id = auth.uid()
        )
      );
  end if;
end $$;

comment on table public.trade_proposal_versions is
  'Immutable versions of a submitted recommendation. Created outside the migration ledger; its DDL was reconstructed from the live database on 2026-09-30.';
