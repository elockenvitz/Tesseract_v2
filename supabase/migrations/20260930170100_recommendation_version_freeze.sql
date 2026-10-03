-- Freeze what a recommendation said at the moment it was submitted.
--
-- ── The defect ───────────────────────────────────────────────────────────
--
-- Every surface that renders a historical recommendation — Decision Inbox,
-- Outcomes, Trade Book, the decision-story RPC — reads the investment case by
-- joining to CURRENT `trade_queue_items` and `trade_idea_theses`. Those rows
-- are mutable. Edit an idea's thesis today and a decision made six weeks ago
-- silently re-renders as though the PM had been reading today's reasoning.
--
-- `decision_requests.submission_snapshot` already freezes part of this, and
-- examining its live contents shows exactly how much: across 70 populated
-- rows the keys are action, symbol, company_name, portfolio_name, weight,
-- shares, sizing_mode, sizing_context, notes, proposal_type, requester_name,
-- requester_email, submitted_at, baseline_weight, proposal_created_at. Sizing
-- and identity are frozen. Not one reasoning field is.
--
-- ── Why a version row and not a bigger snapshot ──────────────────────────
--
-- `submission_snapshot` cannot be the answer, and the reason is structural
-- rather than aesthetic: `ensureDecisionRequestForProposal` UPDATES the
-- active decision request in place when an analyst resubmits, overwriting the
-- snapshot column. A record that the resubmission path destroys cannot be the
-- record of what the first submission said.
--
-- So the canonical object is an append-only row, and this expands the table
-- that already exists for the purpose rather than introducing a second one.
-- `submission_snapshot` stays exactly as it is — it is the only history the
-- 70 pre-version rows have — and becomes a read fallback, not a source of
-- truth.
--
-- ── Expand only ──────────────────────────────────────────────────────────
--
-- Every column added is nullable with no default backfill, so existing rows
-- (there are zero) and any in-flight writer keep working. No column is
-- dropped, renamed, or retyped. There is no contract step here; retiring
-- `submission_snapshot` is a later decision that needs a backfill story this
-- slice deliberately does not have.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Identity and tenancy
-- ─────────────────────────────────────────────────────────────────────────

alter table public.trade_proposal_versions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists trade_queue_item_id uuid references public.trade_queue_items(id) on delete set null,
  add column if not exists asset_id uuid references public.assets(id) on delete set null,
  add column if not exists submitted_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. The recommendation itself
--
-- `action` is deliberately TEXT and not the `trade_action` enum that
-- `trade_queue_items.action` uses. A frozen record must survive the
-- vocabulary it was written in: if a value is later removed from or renamed
-- in that enum, a historical row typed against it either blocks the change or
-- is rewritten by it. The same reasoning applies to `idea_stage`, which
-- mirrors the `stage` enum.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.trade_proposal_versions
  add column if not exists action text,
  add column if not exists idea_stage text;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. The investment thinking that accompanied it
--
-- These are the fields whose later mutation rewrites history. Each is a copy
-- of a specific column on `trade_queue_items` as it read at submission; the
-- source of each is recorded in `captured_from` below.
--
-- Only fields that exist today. Catalysts and risks are NOT columns: they
-- are `direction` values on `trade_idea_theses`, whose enum is
-- bull | bear | catalyst | risk | context. They are therefore frozen by the
-- `theses` array below rather than by columns of their own.
-- `trade_queue_items.catalyst_clarity` is a 1-5 maturity rating, not a list
-- of catalysts, and is not captured.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.trade_proposal_versions
  add column if not exists thesis_text text,
  add column if not exists rationale text,
  add column if not exists conviction text,
  add column if not exists target_price numeric,
  add column if not exists stop_loss numeric,
  add column if not exists take_profit numeric,
  add column if not exists time_horizon text;

-- The bull and bear cases are rows in `trade_idea_theses`, variable in number
-- and independently editable, so they freeze as an ordered array rather than
-- as columns:
--   [{ id, direction, rationale, conviction, created_at, author_name }]
alter table public.trade_proposal_versions
  add column if not exists theses jsonb not null default '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Provenance
--
-- A frozen copy with no stated origin is indistinguishable from an assertion
-- nobody can check. `captured_from` records, per captured field, the table
-- and column it was read from plus the row id — enough to re-derive what has
-- since changed, and enough for a reader to say "this came from the idea's
-- thesis_text" rather than presenting it as free-standing truth.
--
--   { "thesis_text":  {"table":"trade_queue_items","id":"…","field":"thesis_text"},
--     "theses":       {"table":"trade_idea_theses","ids":["…"]},
--     "captured_at":  "2026-09-30T…" }
-- ─────────────────────────────────────────────────────────────────────────

alter table public.trade_proposal_versions
  add column if not exists captured_from jsonb not null default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Idempotency
--
-- Same contract as the Memory Spine's `dedupe_key`, and for the same reason:
-- a client that loses the response to a submission will retry, and a retry
-- must not mint a second version of an unchanged recommendation. Derived from
-- content, never from a clock. Partial unique index so pre-existing rows and
-- any non-submission snapshot (`trigger_event` other than 'submission') are
-- unconstrained.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.trade_proposal_versions
  add column if not exists dedupe_key text;

create unique index if not exists trade_proposal_versions_dedupe_uk
  on public.trade_proposal_versions (proposal_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists idx_trade_proposal_versions_tqi
  on public.trade_proposal_versions (trade_queue_item_id, created_at desc);

create index if not exists idx_trade_proposal_versions_org
  on public.trade_proposal_versions (organization_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. The decision → version pointer
--
-- A decision must name the exact version it was deciding on. Resolving it
-- later as "the latest version of this proposal" is the bug restated: a
-- revision submitted after the decision would retroactively become the thing
-- the PM approved.
--
-- Nullable, and permanently so. The 113 existing requests have no version and
-- never will; a NOT NULL here would either block the migration or require
-- inventing versions for them, which is precisely what must not happen.
-- Null means "submitted before versions existed" and the read paths treat it
-- as exactly that.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.decision_requests
  add column if not exists proposal_version_id uuid
    references public.trade_proposal_versions(id) on delete set null;

create index if not exists idx_decision_requests_proposal_version
  on public.decision_requests (proposal_version_id)
  where proposal_version_id is not null;

comment on column public.decision_requests.proposal_version_id is
  'The immutable recommendation version this request was raised on. NULL for requests predating versioning — read submission_snapshot, and do not substitute current idea state.';

-- ─────────────────────────────────────────────────────────────────────────
-- 7. RLS repair
--
-- The posture found live is documented in full in the drift-repair migration
-- that precedes this one. Four things are wrong and all four are fixed here.
-- This table is about to become the record of what was recommended, so these
-- stop being latent problems.
-- ─────────────────────────────────────────────────────────────────────────

-- (a) `anon` had INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES and
--     TRIGGER. RLS denied the DML for want of a policy, but TRUNCATE is not
--     subject to RLS and the grants should never have existed.
revoke all on public.trade_proposal_versions from anon;

-- (b) TRUNCATE BYPASSES ROW LEVEL SECURITY. Held by `authenticated`, it let
--     any signed-in user empty the table regardless of every policy below.
--     Harmless at zero rows; not harmless once this table is history.
--     UPDATE and DELETE go with it: append-only should be enforced by the
--     absence of the privilege, not only by the absence of a policy.
revoke all on public.trade_proposal_versions from authenticated;
grant select, insert on public.trade_proposal_versions to authenticated;

-- (c) Readership was "the proposal's author, or a member of the proposal's
--     lab portfolio" — which excludes the PM the recommendation was sent to
--     whenever they are not on the analyst's lab. The correct test is the one
--     `decision_requests` already uses: the portfolio is in the caller's
--     organisation, and the caller is on that portfolio's team.
--
--     `user_is_portfolio_member` is OR'd in for one reason: a frozen version
--     is EMBEDDED in the accepted-trade read (`accepted-trade-service.ts`
--     selects `proposal_version:proposal_version_id(...)`), and
--     `accepted_trades` is gated on `user_is_portfolio_member`, which reads
--     `portfolio_memberships` — a different table from `portfolio_team`.
--     Without this branch a reader authorised to see the trade would get the
--     trade with a silently null recommendation, which is the one failure
--     mode a frozen record exists to prevent. It widens nothing: every user
--     it admits can already read the accepted trade the version hangs off.
--
--     This is SELECT only. The INSERT policy below stays on `portfolio_team`,
--     matching `decision_requests_insert` — submitting a recommendation also
--     writes a decision request, so a membership-only user cannot submit
--     either way, and loosening the write would create a new inconsistency
--     rather than remove one.
--
--     Consolidating the two membership tables is deliberately NOT attempted
--     here. See the backlog item; this migration only stops the split from
--     costing a reader their history.
drop policy if exists "Users can view versions of accessible proposals" on public.trade_proposal_versions;
drop policy if exists trade_proposal_versions_select on public.trade_proposal_versions;

create policy trade_proposal_versions_select
  on public.trade_proposal_versions
  for select to authenticated
  using (
    public.portfolio_in_current_org(portfolio_id)
    and (
      created_by = auth.uid()
      or public.user_is_portfolio_member(portfolio_id)
      or exists (
        select 1 from public.portfolio_team pt
        where pt.portfolio_id = trade_proposal_versions.portfolio_id
          and pt.user_id = auth.uid()
      )
    )
  );

-- (d) Insert was restricted to the proposal's author. Submission is performed
--     by the person recommending, who must be on the portfolio team, and the
--     row must be attributed to them — `created_by = auth.uid()` makes
--     authorship unforgeable the same way `memory_events` does.
drop policy if exists "Users can create versions for their proposals" on public.trade_proposal_versions;
drop policy if exists trade_proposal_versions_insert on public.trade_proposal_versions;

create policy trade_proposal_versions_insert
  on public.trade_proposal_versions
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.portfolio_in_current_org(portfolio_id)
    and exists (
      select 1 from public.portfolio_team pt
      where pt.portfolio_id = trade_proposal_versions.portfolio_id
        and pt.user_id = auth.uid()
    )
  );

-- No UPDATE policy and no DELETE policy, for any client role. Together with
-- the revoked privileges above, a submitted recommendation cannot be edited
-- or removed by any client. That is the whole point of the table.

comment on table public.trade_proposal_versions is
  'Append-only record of what a recommendation said when it was submitted, including the investment thinking that accompanied it. Read this for historical recommendation content; never substitute current trade_queue_items / trade_idea_theses state.';
