# Tesseract platform readiness audit

> **Status note:** some findings below have been closed since this was
> written. See [`AUDIT-STATUS-2026-08-30.md`](./AUDIT-STATUS-2026-08-30.md) before acting on any of
> them. Nothing in this document has been edited — the note tracks status
> separately so the original assessment stands as written.

**Branch:** `audit/platform-review` · **Baseline:** `32bf2b3` · **Date:** 2026-08-26
**Scope:** architecture, security, tenancy, production readiness — what is needed to move
from pilot software toward a production professional-investment platform.

This is an audit. No production behaviour was changed. No schema was altered. Two
existing guards were executed to establish their current state; nothing else ran.

---

## 0. Method, and the one limitation that shapes every finding

Everything below is derived from the repository at `32bf2b3`: 279 migration files,
1,272 TypeScript/TSX files (~258k lines), 10 Supabase edge functions, 3 Netlify
functions, 2 GitHub workflows, and the project's own `docs/`.

**No live database was queried.** `.mcp.json` is absent from this worktree, so there
is no Management API token and no way to read `pg_policies`, `pg_proc`,
`information_schema`, `storage.buckets` or the Supabase project settings.

That limitation is not incidental — it turns out to be the headline finding. The
repository does not describe the production database:

| | in repo | referenced by running code | gap |
|---|---|---|---|
| Tables | ~180 (via `CREATE`/`ALTER` in migrations) | 269 distinct `.from('…')` targets | **134 tables the app queries are created by no migration** |
| Client-callable RPCs | 43 of those called | 93 called via `.rpc('…')` | **50 RPCs are not in the repo** (48 application RPCs, plus `increment` and `jsonb_set`) |
| RLS policy helper functions | 7 of 14 | 14 used inside policy bodies | **7 missing, including all four that gate tenancy and admin** |

So for large parts of the security model the honest answer to "is this safe?" is
**"the repository cannot tell you."** Findings are therefore split into two kinds,
and each is labelled:

- **[CONFIRMED]** — provable from committed code. The defect is in a file you can open.
- **[VERIFY]** — a specific, high-probability hypothesis with an exact query or request
  that settles it in under a minute against production. These are not speculation;
  each names the artifact that would be checked.

Nothing is rated on a hunch. Where I could not establish something, it says so.

---

## 1. Executive summary

Tesseract is substantially better engineered than most software at this stage, and
substantially less safe than it needs to be before broad exposure. Those two
statements are both true and they are about different layers.

**What is genuinely good.** The signal card contract (`src/lib/signals/contract.ts`),
the trade-book commit model (`accepted_trades` and its org-scoped policies), the
holdings API's independent org verification, the discipline in
`netlify/functions/*.mjs` and the newer migrations, and the quality of the project's
own self-critical documentation (`docs/tenant-isolation-enumeration.md`,
`docs/tickets/guards-defeated-by-defaults.md`) are all above the bar. The team
already knows how this class of bug is produced and has written that down. That is
rare and it is the reason this audit could go deep quickly.

**What is not.** Four things, in order of severity.

1. **The tenant boundary is not where the architecture says it is.**
   ADR-001 records the decision as "RLS resolves the caller's active org from their
   JWT." The implementation resolves it from `users.current_organization_id` — a
   mutable column on a table the client writes to directly from five call sites, with
   no column-level grants anywhere in the repo. Postgres RLS is row-level. Any row a
   user may update, they may update *every column of*. This is the highest-value thing
   to verify in production and it is a single query. (P0-1)

2. **88 `USING (true)` RLS policies are still live** across 44 tables, including
   target-date-fund holdings and executed trades, portfolio and general workflow
   progress (full CRUD), allocation votes and history, coverage history, and PM
   performance snapshots. Six of them have no `TO` clause at all, so they apply to
   the `public` role, which includes `anon`. These were not missed by the team — the
   2026-04 and 2026-08 hardening migrations closed dozens of others correctly. These
   are the residue, and they are the tables nobody has revisited. (P0-2)

3. **Five service-role edge functions accept unauthenticated privileged commands.**
   `seed-pilot-data` creates auth users, enumerates every user in the project via
   `auth.admin.listUsers()`, and writes fabricated trades into an
   `organization_id` taken from the request body — with no `Authorization` check of
   any kind. `auto-archive` will archive every trade idea and trade plan in every
   organization if given `retention_days: 0`. Supabase's `verify_jwt` does not help
   here: the anon key is itself a valid project-signed JWT and is published in the
   client bundle. (P0-3)

4. **The `assets` storage bucket is flat and cross-tenant.** The only committed
   policy is `bucket_id = 'assets'` for all authenticated users, on read *and* write.
   `src/lib/storage/asset-paths.ts` documents the org-prefix convention and the
   Phase-2 backfill script exists — but the Phase-3 policy that would enforce it
   (`(storage.foldername(name))[1] = current_org_id()`) is in no migration. Uploaded
   models, documents and attachments are the most sensitive artifacts in the product.
   (P0-4)

**The structural problem underneath all four** is that the database has drifted away
from the repository, and the drift is concentrated in exactly the objects that
enforce security. `docs/CONTRIBUTING.md` states "`supabase/migrations/` is the source
of truth for schema." It is not, and the gap is 134 tables wide. A staging
environment cannot be rebuilt from this repo; a security review cannot be performed
against it; and a reviewer reading a PR has no way to see the policy their change
depends on.

**The good news is that the fix sequence is short and mostly mechanical.** Nothing
here requires re-architecting. The target models in §8–§11 are evolutions of what
exists, not replacements, and the work in §15 front-loads six items that are all
days rather than weeks.

**Recommendation:** do not expand user exposure beyond the current pilot cohort until
§19 is closed. Within the current cohort, P0-3 and P0-4 should be treated as live.

---

## 2. P0 findings — plausible exploitable isolation or security issues

### P0-1 · The active-organization pointer is a client-writable column **[VERIFY]**

**What.** Tenancy resolves through `current_org_id()`, used directly by 62 live policies and
indirectly by 47 more via `portfolio_in_current_org()`.
That function is not in the repository, but every consumer confirms it reads
`users.current_organization_id`: `OrganizationContext.tsx:147,240` calls
`set_current_org(p_org_id)` to change it, `ProtectedRoute.tsx:27` reads it from the
user profile, and `morph_switch_org` (`20260529120000`) writes it with
`UPDATE users SET current_organization_id = p_org_id WHERE id = auth.uid()`.

`set_current_org` validates membership — `OrganizationContext.tsx:118` says so
explicitly. But it is not the only write path. The client updates `users` directly:

| File | Column written |
|---|---|
| `src/pages/SettingsPage.tsx:149` | `timezone` |
| `src/hooks/useAuth.ts:115` | `email` |
| `src/components/onboarding/SetupWizard.tsx:499` | `user_type` |
| `src/hooks/usePilotProgress.ts:196` | `pilot_progress` |
| `src/pages/OrganizationPage.tsx:2572` | `coverage_admin` — **on another user's row** |

So a client-reachable UPDATE policy on `users` exists. There are **no column-level
grants anywhere in the 279 migrations** (`GRANT UPDATE (col) ON …` — zero matches).
RLS gates rows, not columns. Therefore any row that policy admits can have *every*
column rewritten by the client, including `current_organization_id`,
`coverage_admin`, and `user_role`.

**The attack (C, and by extension A, B, G).** An authenticated pilot user issues one
PostgREST request:

```
PATCH /rest/v1/users?id=eq.<self>
{ "current_organization_id": "<any other org uuid>" }
```

If it succeeds, `current_org_id()` now returns the other organization for that
session, and every one of the 80 correctly-written org-scoped policies faithfully
serves that organization's data. The tenant boundary is not breached — it is
*redirected*. Org UUIDs are not secret: they appear in `organization_memberships`
reads, in `theme_assets`, in export job rows, and in any URL that carries one.

The same request with `"coverage_admin": true` grants global coverage administration
(`docs/coverage/current_coverage_system.md` §1: "can manage all coverage assignments
everywhere").

**Why this is not already known-safe.** `morph_switch_org` exists *because* the
platform-admin morph flow needed a way to set this column without a membership check,
and it is carefully gated behind `is_platform_admin()` plus an active morph session.
That care is wasted if the column is writable directly.

**Verification — three queries, two minutes:**

```sql
-- 1. What can the client write to users?
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE tablename = 'users';

-- 2. Are there any column-level grants narrowing it?
SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_name = 'users' AND grantee IN ('authenticated','anon');

-- 3. What does the tenancy function actually read?
SELECT prosrc FROM pg_proc WHERE proname = 'current_org_id';
```

If (1) returns an UPDATE policy reachable by `authenticated` and (2) returns nothing,
this is live.

**Fix (short-term, hours).** Replace the broad UPDATE policy with column grants:

```sql
REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (timezone, email, user_type, pilot_progress, avatar_url, full_name)
  ON public.users TO authenticated;
```
and route `coverage_admin` through a `SECURITY DEFINER` RPC that checks org-admin
status. `current_organization_id` then has exactly one writer: `set_current_org`.

**Fix (correct, weeks — see §8).** Move the active org into a signed JWT claim, as
ADR-001 already decided. A column cannot be the tenant boundary because a column is
data and data is writable; a claim is signed by the auth server and is not.

**Affected:** `public.users`; `current_org_id()`; `set_current_org()`;
`morph_switch_org()`; the 62 policies using `current_org_id()` directly and the 47
using it via `portfolio_in_current_org()`;
`src/contexts/OrganizationContext.tsx`; `src/pages/OrganizationPage.tsx:2572`;
`docs/adr/001-multi-tenancy-via-postgres-rls.md`.

---

### P0-2 · 88 live `USING (true)` policies across 44 tables **[CONFIRMED]**

**What.** Replaying all 279 migrations in filename order and tracking every
`CREATE POLICY` / `DROP POLICY` pair leaves **473 live policies, of which 88 are
unconditionally permissive**. These are policies that survived — the 2026-04
`harden_holdings_rls`, `harden_analyst_data_rls` and `org_isolation_rls_hardening`
migrations correctly dropped many others, and those do not appear below.

The complete surviving set, grouped by what it exposes:

**Positions, trades and proposals — full CRUD, any authenticated user, any org:**
`tdf_holdings`, `tdf_holdings_snapshots`, `tdf_executed_trades`,
`tdf_trade_proposals`, `tdf_trade_proposal_items`, `tdf_glide_path_targets`,
`tdf_underlying_funds`, `target_date_funds`, `tdf_notes` (SELECT),
`tdf_comments` (SELECT) — all from `20251127000002_add_tdf_tables.sql`.

**Workflow and process state — full CRUD, any authenticated user, any org:**
`portfolio_workflow_progress`, `general_workflow_progress`, `general_checklist_items`,
`portfolio_checklist_items`, `workflow_portfolio_selections`, `asset_checklist_items`
(`20260221100000`, `20260327100000`, `20250916000000`). A user in Org A can **delete**
Org B's portfolio workflow progress.

**Allocation framework — read, and in three cases write:**
`allocation_periods` (SELECT/INSERT/UPDATE), `allocation_votes`, `allocation_history`,
`allocation_comments`, `official_allocation_views` (SELECT/INSERT/UPDATE),
`individual_allocation_views`, `asset_classes` (SELECT/INSERT/UPDATE)
(`20251127000001_add_allocation_framework.sql`).

**Who-covers-what and who-performs-how, cross-org read:**
`coverage_history` (`20251102000003`, policy literally named *"All authenticated users
can view coverage history"*), `portfolio_team_history` (`20251103000002`),
`pm_performance_snapshots` (`20260330100000`), `decision_reviews` (`20260424130000`),
`asset_field_history` (`20250830131725`), `theme_assets` (`20250830011323`),
`checklist_work_requests`, `stage_assignments`, `checklist_task_assignments`,
`checklist_item_comments`, `checklist_comment_mentions`,
`checklist_comment_references`, `asset_checklist_attachments`.

**No `TO` clause — six policies, applying to the `public` role, which includes `anon`:**

| Table | Cmd | Policy | Migration |
|---|---|---|---|
| `shared_charts` | SELECT | *"Anyone can view shared charts by token"* — the predicate is `true`, so the token is decorative | `20251215000001` |
| `data_snapshots` | SELECT | "Users can view snapshots" | `20251228000000` |
| `smart_input_references` | SELECT | "Users can view references" | `20251228000000` |
| `estimate_metrics` | SELECT | "Anyone can read estimate metrics" | `20260102100000` |
| `activity_events` | INSERT | `activity_events_insert` | `20260201200000` |
| `audit_events` | INSERT | "Service can insert audit events" — see P1-5 | `20260201100000` |

**Also permissive but excluded from the remediation above:** `notifications` INSERT
("System can create notifications", `20250827230714`) is `WITH CHECK (true)` by
design, because triggers and edge functions write notifications on a user's behalf.
It should be narrowed to `TO service_role` rather than org-scoped.

**Note on `coverage_history` specifically.** Even if the `coverage` table is now
org-scoped (`docs/coverage/current_coverage_system.md` §7 says it is; §9.5 of the
same document says it is not — see P2-6), `coverage_history` carries `asset_id`,
`old_user_id`, `new_user_id`, `old_analyst_name`, `new_analyst_name`, `changed_by`
and dates. It reconstructs the coverage map of every organization for any
authenticated user, and it does so from an audit table nobody thinks of as a read
surface.

**Attack.** This is attacks A and B in their simplest form: no ID guessing needed,
because the policies do not filter at all. `GET /rest/v1/tdf_holdings?select=*`
returns every organization's rows.

**Anon caveat.** Whether the four `public`-role policies are reachable by `anon`
depends on table-level grants, which are not in the repo. Supabase's standard project
bootstrap applies `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO
anon, authenticated, service_role`, so the default answer is yes. Verify with:

```sql
SELECT table_name, privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public'
  AND table_name IN ('shared_charts','data_snapshots','smart_input_references','estimate_metrics');
```

**Fix.** Three migrations, in this order, each independently shippable:

1. **The six `public`-role policies** — add `TO authenticated` and, for
   `shared_charts`, make the token actually load-bearing. `audit_events` and
   `activity_events` go to `service_role` (see P1-5). Half a day, zero data risk.
2. **The 14 TDF tables** — org-scope via the owning portfolio, the same shape
   `20260411100000` already used for `simulations`. These tables are demo-era and may
   have near-zero rows; check first, and if so the migration is trivial.
3. **Workflow/checklist/allocation** — these are the ones with real content. Follow
   the `asset_notes` pattern from `20260815120000`: state the exposure, quantify the
   blast radius, assert the *negative* (old policy is gone), record the applied date.

**Reusable rule to add to the boundary linter:** a `CREATE POLICY` whose `USING` or
`WITH CHECK` is `(true)` must carry an inline justification comment, and the count of
such policies is ratcheted — the same mechanism `baseline-ratchet.test.ts` already
applies to unscoped queries.

**Affected:** the 88 policies listed; migrations `20250916000000`, `20250830011323`,
`20250830131725`, `20251013000000`, `20251013100000`, `20251013120000`,
`20251102000003`, `20251103000002`, `20251127000001`, `20251127000002`,
`20251215000001`, `20251228000000`, `20260102100000`, `20260201100000`,
`20260201200000`, `20260221100000`, `20260327100000`, `20260330100000`,
`20260424130000`.

---

### P0-3 · Five service-role edge functions perform no authorization **[CONFIRMED]**

Supabase edge functions that construct a client with `SUPABASE_SERVICE_ROLE_KEY`
bypass RLS entirely. Five of the ten do so without checking who is calling.

| Function | Line | Authenticates caller? | What an anonymous caller gets |
|---|---|---|---|
| `seed-pilot-data` | `index.ts:130` | **No** | `auth.admin.createUser()`, `auth.admin.listUsers()`, writes to any `organization_id` in the body |
| `auto-archive` | `index.ts:75` | **No** | archives all trade ideas + trade plans, retention window from the request |
| `holdings-sftp-sync` | `index.ts:378` | **No** | reads and runs every `holdings_integration_configs` row across all orgs |
| `market-events` | `index.ts:61` | **No** | service-role writes of event data |
| `market-news` | `index.ts:94` | **No** | service-role writes of news data |

For contrast, `ai-chat` (`index.ts:106–120`) and `attention` (`index.ts:1121–1140`)
do it correctly: read the `Authorization` header, build an **anon-key** client with
that header, call `auth.getUser()`, and let RLS apply to everything downstream. That
is the pattern; three functions simply do not follow it.

**Why `verify_jwt` is not a mitigation.** Supabase's platform-level `verify_jwt` (the
default) accepts any JWT signed with the project's JWT secret — and the **anon key is
exactly such a JWT**, published in `dist/` in every deploy. So `verify_jwt = true`
raises the bar from "anyone" to "anyone who opened DevTools." There is no
`supabase/config.toml` in the repo, so even that setting is unverifiable.

**`seed-pilot-data` in detail — this is the worst of the five.**

```ts
// index.ts:124-137 — the entire authorization logic
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const admin = createClient(supabaseUrl, serviceRoleKey, {…})
  if (req.method === 'POST')   return await handleSeed(req, admin)
  if (req.method === 'DELETE') return await handleCleanup(req, admin)
```

`handleSeed` (`index.ts:160`) takes `{ organization_id, portfolio_id }` from the body,
calls `admin.auth.admin.listUsers()` — **which returns every user in the project,
across all 27 organizations, with emails and `app_metadata`** — and then
`admin.auth.admin.createUser()` to mint accounts inside the named organization,
followed by inserts into `trade_queue_items`, `decision_requests` and
`accepted_trades`.

Attack E, fully: an unauthenticated caller enumerates the entire user base, then
plants fabricated committed trades in a customer's book. Both the enumeration and the
forged trade records are meaningful harm on their own; together, in a product whose
central claim is `accepted_trades` as the canonical decision record (ADR-003), they
are worse.

**`auto-archive` in detail.** `runAutoArchive` (`index.ts:138`) computes
`cutoffDate = now − retentionDays` where `retentionDays` comes straight from the
request body (`index.ts:99`) with no floor. `POST {"retention_days": 0}` sets the
cutoff to now and archives every trade idea and trade plan whose timestamp precedes
it — in every organization. It is a soft archive, not a hard delete, so it is
recoverable; it is still an unauthenticated cross-tenant destructive write.

**Fix (hours, not days).** Two patterns cover all five:

- **Scheduled jobs** (`auto-archive`, `holdings-sftp-sync`, `market-events`,
  `market-news`): require a shared secret header, compared with a constant-time
  comparison, set as a function secret and known only to the scheduler.
  ```ts
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret)
    return new Response('Forbidden', { status: 403 })
  ```
  Also floor the inputs: `retentionDays = Math.max(30, Number(body.retention_days) || 90)`.

- **`seed-pilot-data`**: adopt the `ai-chat` pattern verbatim — anon client + user's
  `Authorization` header + `auth.getUser()` — then additionally require
  `is_platform_admin()`. It is an ops tool; it should require ops.

**Affected:** `supabase/functions/seed-pilot-data/index.ts`,
`supabase/functions/auto-archive/index.ts`,
`supabase/functions/holdings-sftp-sync/index.ts`,
`supabase/functions/market-events/index.ts`,
`supabase/functions/market-news/index.ts`. Also `supabase/config.toml` (missing).

---

### P0-4 · The `assets` storage bucket is flat and cross-tenant **[CONFIRMED]**

**What.** `20251013115000_create_assets_storage_bucket.sql` is the only migration that
policies this bucket:

```sql
CREATE POLICY "Authenticated users can read files" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'assets');
CREATE POLICY "Authenticated users can upload files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'assets');
```

No org predicate on read or write. Every authenticated user in every organization can
list, download and upload every object.

`src/lib/storage/asset-paths.ts` states the intended model clearly and correctly:

> Every object in this bucket lives under `<organization_id>/…`. That first segment is
> the tenant boundary: the storage RLS policy matches it against `current_org_id()`.

It does not. `scripts/backfill-assets-bucket-org-scope.mjs:1-8` describes itself as
"Phase 2 … so the Phase 3 policy (`(storage.foldername(name))[1] = current_org_id()`)
**can be applied**." Phase 3 exists in no migration. The path convention is enforced
client-side by `assetsPath()`; the policy that would make the convention load-bearing
was never written.

**Attack F, directly.** The bucket holds uploaded Excel models
(`ExcelModelUploader.tsx`, `asset_models`, `model_versions`), documents
(`DocumentLibrarySection.tsx`), and note attachments
(`FileAttachmentExtension.tsx`) — the highest-value research artifacts in the
product. `storage.objects` is listable, so an attacker does not need to guess paths:
they enumerate.

The upload half is equally bad and less obvious: any user can write into any
organization's prefix, which under the *future* Phase-3 policy would place
attacker-controlled files inside a customer's namespace and make them look native.

**Also unaccounted for.** `captures`, `thought-attachments` and `template-branding`
buckets are used from `src/` but created and policied by no migration at all.
`org-exports` (`20260224000000`) is created but has no `storage.objects` policy in
the repo — export archives of an entire organization's data.

**Fix.** This one is genuinely sequenced and the sequence matters — applying the
policy before the backfill cuts every user off from their own existing files. Phases
1 and 2 are done; the remaining work is:

1. Run `scripts/backfill-assets-bucket-org-scope.mjs` (dry run) against production,
   read the report, resolve the unattributable residue by hand as the script's header
   instructs.
2. Apply the Phase-3 policy for read, write, update and delete.
3. Audit `captures`, `thought-attachments`, `template-branding` and `org-exports` and
   bring each into a migration with an org-prefixed policy.

**Affected:** `storage.buckets` (`assets`, `captures`, `thought-attachments`,
`template-branding`, `org-exports`); `storage.objects` policies;
`supabase/migrations/20251013115000_create_assets_storage_bucket.sql`;
`src/lib/storage/asset-paths.ts`; `scripts/backfill-assets-bucket-org-scope.mjs`.

---

### P0-5 · The security-critical half of the schema is not in version control **[CONFIRMED]**

**What.** Measured above: 134 tables and 50 client-callable RPCs exist only in
production. The absences are not random — they cluster on exactly the objects that
enforce authorization.

**Missing policy helper functions** (7 of the 14 used in policy bodies), with the
number of policies that depend on each:

Counts are of **live** policies — computed by `scripts/audit/policy-state.mjs`,
so policies since dropped are excluded.

| Function | Live policies depending on it | In repo? |
|---|---|---|
| `current_org_id()` | 62 | **no** |
| `portfolio_in_current_org()` | 47 | yes (`20260411100000`) — but its body calls `current_org_id()` |
| `is_active_org_admin_of_current_org()` | 46 | **no** |
| `user_is_portfolio_member()` | 45 | yes (`20260201200000`) |
| `is_platform_admin()` | 19 | **no** |
| `get_user_organization()` | 6 | yes |
| `user_has_template_access()` | 5 | yes |
| `is_active_member_of_current_org()` | 4 | **no** |
| `user_has_capability()` | 4 | yes |
| `user_has_collaborate_share()` | 3 | **no** |
| `user_has_workflow_access()` | 3 | yes |
| `user_has_live_portfolio_share()` | 2 | **no** |
| `is_portfolio_pm()` | 2 | yes |
| `user_has_list_collaboration()` | 0 in migrations | **no** — used by the live `asset_lists` policy quoted in `docs/ORG_SCOPING_RLS_PLAN.md`, which is itself not in any migration |

Note the second row: `portfolio_in_current_org()` *is* in the repo, but it is a
one-line wrapper around `current_org_id()`, which is not. So 47 policies that look
reviewable are not.

**Missing tables**, selected for what they govern: `organizations`,
`organization_memberships`, `platform_admins`, `organization_domains`,
`organization_identity_providers`, `holdings_api_keys`, `note_collaborations`,
`portfolio_memberships`, `portfolio_holdings`, `conversations`,
`conversation_participants`, `messages`, `profiles`, `teams`, `team_memberships`,
`org_chart_nodes`, `org_chart_node_members`, `research_fields`,
`portfolio_universe_assets`, `portfolio_universe_filters`, `watchlist_items`,
`trade_batches`, `simulations`, `simulation_shares`.

**Missing RPCs**, the privilege-escalation surface in full: `accept_org_invite`,
`create_org_invite`, `auto_accept_pending_invites`, `approve_org_join_request`,
`bootstrap_organization`, `provision_client_org` *(partially present)*,
`grant_temporary_org_membership`, `revoke_temporary_org_membership`,
`deactivate_org_member`, `reactivate_org_member`, `set_current_org`,
`is_platform_admin`, `is_active_org_admin_of_current_org`, `archive_org`,
`schedule_org_deletion`, `cancel_org_deletion`, `upsert_identity_provider`,
`delete_identity_provider`, `get_identity_provider_for_email`,
`create_domain_verification`, `verify_domain`, `resolve_entity_org`.

Three client-invoked edge functions are also absent from `supabase/functions/`:
`calendar-oauth-start`, `calendar-sync`, and — notably — **`sso-token-exchange`**.

**Consequences, concretely.**

- **Attacks C, D and H are unauditable.** Whether `accept_org_invite` checks that the
  invite's target email matches the caller's; whether `create_org_invite` checks the
  caller is an admin *of the org named in the argument* rather than of their current
  org; whether `grant_temporary_org_membership` can be called by a non-admin — none of
  this can be answered from the repository. These are the four questions this audit
  was asked to answer and they are the ones it cannot.
- **`docs/CONTRIBUTING.md` §"Migrations & database changes" is inaccurate** where it
  says migrations are the source of truth, and
  `scripts/apply-migrations-to-staging.mjs` cannot bootstrap a working environment.
  Memory of prior sessions records staging as paused; this explains why rebuilding it
  is not a small task.
- **Code review cannot see the security context of a change.** A PR that adds a query
  against `organization_memberships` cannot be reviewed against its policy, because
  the policy is not in the repo.

**Fix.** One command, then a discipline change.

```bash
supabase db dump --db-url "$PROD_URL" --schema public --schema storage -f \
  supabase/migrations/00000000000000_baseline_production_schema.sql
```

Commit that as a baseline, then adopt the rule that production DDL is applied *from*
a migration file rather than transcribed into one afterwards. `supabase db diff`
against a shadow database in CI turns drift from an invisible condition into a failing
check. This is item 1 in §15 because six other findings depend on being able to see
what is actually deployed.

**Affected:** `supabase/migrations/` (all); `docs/CONTRIBUTING.md`;
`scripts/apply-migrations-to-staging.mjs`; `.github/workflows/ci.yml`.

---

### P0-6 · AI context retrieval inherits every RLS gap **[CONFIRMED, bounded]**

**What.** `ai-chat` builds model context from IDs supplied in the request body:

```ts
// index.ts:150-154
const tags = Array.isArray(body.tags) ? body.tags.filter(t => t && t.type && t.id) : …
// index.ts:189-201 — each tag is fetched, no independent authorization
const docs = await buildContextDocuments(supabase, tag, user.id, aiConfig);
```

`buildContextDocuments` (`index.ts:503`) and `buildContextPrompt` (`index.ts:606`)
query `assets`, `asset_contributions`, `price_targets` and `asset_notes` by that ID.
`executeResearchTool` (`index.ts:902`) does the same for `get_asset`,
`get_portfolio`, `search_assets` and the theme/notes tools.

**What is right.** All of it goes through the user-authenticated client
(`index.ts:116`), and the code says why (`index.ts:224-226`: "the model's tool calls
execute under that user's RLS — they can only see what they're already entitled to").
That is the correct design and it is the reason this is not a standalone P0.

**What is wrong.** No query in the context layer states an `organization_id` filter.
Its entire safety rests on the policies, and §P0-2 establishes that 33 tables have
none worth the name. Concretely, `assets` is deliberately global — two firms
researching the same ticker share the row — so **an asset ID is not a secret and
carries no tenancy**. Any user can tag any ticker. Everything hanging off that asset
is then exposed at whatever scope its own policy provides. `asset_notes` was fixed in
`20260815120000`; `asset_contributions` and `price_targets` were fixed in
`20260425120000`. The exposure today is therefore bounded — but the *shape* is
permanent: the AI layer is a general-purpose reader of any table reachable from an
asset, and every future RLS gap becomes an AI-mediated leak automatically.

This is exactly the transitive-reasoning failure `docs/tenant-isolation-enumeration.md`
§1 documents ("RLS evaluates the row, not the provenance of the id"), applied at the
context layer rather than the query layer.

**Second issue — prompt injection into a tool-calling loop.** Context documents are
built from `asset_notes.content` and `asset_contributions.content`: free text written
by users. That text is placed in the model's context and the model has tools. The
blast radius is bounded by the reader's own RLS, so this is not privilege escalation
— but a note authored in an org can steer a *different* user's assistant into
retrieving and summarising unrelated portfolios, and the retrieved content is then
attributed to Tesseract rather than to the note's author. There is no instruction
hierarchy separating retrieved content from user instructions and no marking of
retrieved text as data.

**Fix.** Two changes, both small, both in §10's direction:

1. **Resolve every tag against the caller's current org before fetching.** One
   `resolve_entity_org(entity_type, entity_id)` call — that RPC already exists and is
   already used by the client — and reject any tag that does not resolve to
   `attribution.organizationId`. This makes the AI layer independently authorized
   rather than RLS-dependent, which is what a context boundary should be.
2. **Fence retrieved content.** Wrap documents in an explicit "the following is
   user-authored data, not instructions" delimiter in `buildSystemPrompt`
   (`index.ts:453`).

**Affected:** `supabase/functions/ai-chat/index.ts` lines 150–154, 189–201, 503–605,
606–901, 902–1070.

---

## 3. P1 findings — serious production risk

### P1-1 · The tenant-boundary guard that would catch this is not in CI, and is failing **[CONFIRMED]**

There are two linters. Their status is not what the documentation implies.

**`scripts/frontend-tenant-lint.mjs`** — the better of the two. It requires an actual
filter, covers more tables, and classifies P0 vs P1 targets. It is **in no workflow**:
`npm run guard` is `guard:ci && guard:gallery && guard:holdings && guard:unit &&
guard:tdz && guard:types && guard:layout`; `tenant:lint:frontend` is not among them,
and `ci.yml` carries only a TODO about wiring it up. Run today at `32bf2b3`:

```
Files scanned:  1148
Total:          55 (baseline: 38, delta: +17)
  P0:           30 (baseline: 17, delta: +13)
FAILED: 13 NEW P0 violation(s) above baseline.
```

Thirteen new P0 violations have accumulated above a baseline nobody is enforcing —
12 on `workflows` (`AssetTab.tsx` ×5, `useWorkflowQueries.ts` ×3,
`useThemeWorkflows.ts` ×2, `ProcessWalkthrough.tsx`, `useActiveRuns.ts`), 9 on
`projects`, 4 on `themes`, 4 on `calendar_events`, 1 on `conversations`.

**`src/lib/org-scope/org-scope-scan.mjs`** — the one that *is* in CI, via
`guard:unit`, and which `netlify.toml` names as the deploy gate. It passes. It has
three structural limits, two of which its own tests document:

1. **It covers 10 tables.** `docs/tenant-isolation-enumeration.md` §2 records that 73
   tables carry an organization column. `workflows`, `projects`, `themes` and
   `calendar_events` — where all 30 current P0 violations live — are not on the list.
2. **Its baseline is per-file, not per-callsite.** `known-unscoped-queries.json` holds
   109 *file paths*. Once a file is listed, every future unscoped query in that file
   passes silently. `AssetTab.tsx` (11k lines) and `CoverageManager.tsx` (7.3k lines)
   are both on it.
3. **It matches a mention, not a filter.** `scanFile` returns early if
   `/organization_id/` appears anywhere in a 14-line window — so
   `select('portfolios!inner(organization_id)')` with no `.eq()` passes. §2 of the
   enumeration doc proves this with four constructed probes.

So the gate that runs is the weaker one, and the stronger one is red and unwired.
`netlify.toml`'s claim that the guard protects the tenant boundary is true of the
class of bug it was written for and not of the current violations.

**Fix.** Wire `tenant:lint:frontend` into `ci.yml` as a required check; re-baseline in
the open per §3.3 of the enumeration doc; then execute the scanner rewrite §3 of that
doc already scopes. The doc is right that the scanner fix comes before the sweep.

**Affected:** `.github/workflows/ci.yml`; `package.json` (`guard` script);
`scripts/frontend-tenant-lint.mjs`; `src/lib/org-scope/org-scope-scan.mjs`;
`src/lib/org-scope/known-unscoped-queries.json`;
`src/lib/org-scope/__tests__/baseline-ratchet.test.ts`; `netlify.toml`;
the 30 P0 call sites listed by `node scripts/frontend-tenant-lint.mjs --report`.

### P1-2 · Market-data provider API keys are shipped in the browser bundle **[CONFIRMED]**

`src/lib/financial-data/browser-client.ts:46` reads
`import.meta.env.VITE_ALPHA_VANTAGE_API_KEY`; line 327 reads
`VITE_FINNHUB_API_KEY`; `src/lib/financial-data/client.ts:36-38` does the same.
Everything prefixed `VITE_` is inlined into the published JavaScript by Vite. If
either key is set in Netlify's environment for production, it is extractable from
`dist/` by anyone who loads the site.

`.env.example` documents both as client-side variables, which suggests this is
intentional rather than accidental — but it means quota theft and provider-side
billing exposure, and for a paid tier it means an unbounded bill. Note the same file
already models the correct pattern for `market-news`: "These are set as Supabase
*function* secrets, not client env vars — they must never reach the browser bundle."

**Fix.** Move both behind the existing server-side proxies. `netlify/functions/quote.mjs`
and `supabase/functions/market-news` already demonstrate the shape. Delete the
`VITE_`-prefixed reads and the corresponding Netlify variables.

**Affected:** `src/lib/financial-data/browser-client.ts:46,327`;
`src/lib/financial-data/client.ts:36`; `.env.example`; Netlify environment variables.

### P1-3 · Eleven high/critical vulnerable production dependencies, no scanning **[CONFIRMED]**

`npm audit --production` at `32bf2b3`: 1 critical, 10 high, 3 moderate, 1 low across
357 production dependencies. No `.github/dependabot.yml`, no `npm audit` step in
`ci.yml`.

Ranked by reachability in *this* application:

| Package | Sev | Why it matters here |
|---|---|---|
| `xlsx@0.18.5` | high | **Prototype pollution (GHSA-4r6h-8v6p-xvw6) + ReDoS (GHSA-5pgg-2g8v-p4x9), `fixAvailable: false` on npm.** The app parses *user-uploaded* workbooks: `ExcelModelUploader.tsx`, `excelParser.ts`, `ExcelModelTemplateManager.tsx`, `CoverageManager.tsx`, plus `ingest-benchmark-weights.mjs` parsing a third-party issuer file. A malicious workbook is a supported input path. |
| `jspdf@≤4.2.0` | **critical** | 10 advisories incl. path traversal (GHSA-f8cm-6447-x5h2) and arbitrary JS execution via AcroForm injection (GHSA-pqxr-3g65-p328). Used by `UniversalNoteEditor.tsx` and `InvestmentCaseBuilder.tsx` to render user-authored content. |
| `react-router-dom@≤6.30.2` | high | Open redirect via `//`-prefixed and backslash paths (GHSA-2j2x-hqr9-3h42, GHSA-wrjc-x8rr-h8h6). Directly relevant to auth-callback redirects. |
| `lodash`, `underscore`, `ws`, `nanoid`, `linkify-it`, `@xmldom/xmldom` | high | Prototype pollution, DoS, uninitialized memory disclosure. |

**Fix.** `xlsx` first and specifically: SheetJS no longer publishes to npm, so the
remediation is `npm i https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz` (≥0.20.2)
— that is the vendor's documented path, not a workaround. Everything else has
`fixAvailable: true`; `jspdf@4.2.1` is flagged semver-major, so it needs a smoke test
of the two export surfaces. Then add Dependabot and a non-blocking `npm audit
--audit-level=high` job that becomes blocking once the backlog is at zero.

### P1-4 · No security headers of any kind **[CONFIRMED]**

There is no `public/_headers` file and no `[[headers]]` block in `netlify.toml`. The
site is served with no `Content-Security-Policy`, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` or
`Permissions-Policy`.

For an application that renders user-authored rich text (TipTap), uploaded document
content, and third-party article text extracted by `article-extract`, a CSP is the
control that contains an XSS rather than letting it reach the Supabase session in
`localStorage`. DOMPurify is a dependency, which helps, but is not a substitute.

**Fix.** Add `public/_headers` with a report-only CSP first (to find violations
without breaking the app), plus the four cheap headers immediately. Half a day.

### P1-5 · The audit log is written by the client and its tamper-check is client-side **[CONFIRMED]**

`audit_events` is described as "Immutable audit log for all meaningful changes across
the platform" (`20260201100000:205`). It is written from the browser —
`src/lib/audit/audit-service.ts:76` inserts rows directly, as does
`src/hooks/useUserAssetPagePreferences.ts:1521`.

Its INSERT policy is:

```sql
CREATE POLICY "Service can insert audit events" ON audit_events
  FOR INSERT WITH CHECK (true);
```

with no `TO` clause. Combined with the client write path, any caller can insert audit
rows with an arbitrary `actor_id`, `org_id`, `action_type` and `to_state`. The
`checksum` column intended as tamper detection is computed in
`audit-service.ts:60-73` on the client from the same values, so a forger computes a
valid checksum as a matter of course.

The UPDATE and DELETE policies (`USING (false)`) are correct, so the log is
append-only — but an append-only log of unauthenticated assertions records less than
it appears to.

The SELECT policy also references `users.org_id`, whereas the rest of the platform
uses `users.current_organization_id` and `organization_memberships` — two
representations of the same fact on the same table (see P2-3).

**Fix.** Audit writes belong on the server. Either database triggers on the tables
being audited (`accepted_trades`, `price_targets`, `coverage`, `decision_requests`),
or a `SECURITY DEFINER` RPC that stamps `actor_id := auth.uid()` and
`org_id := current_org_id()` itself and ignores whatever the client claims. Then
`WITH CHECK (false)` for `authenticated` on direct inserts. This is a prerequisite for
any compliance conversation.

### P1-6 · No timeouts, retries or input caps on provider calls **[CONFIRMED]**

`ai-chat` calls Anthropic (`index.ts:1116`, `1248`, `1333`), OpenAI, Google and
Perplexity with bare `fetch` — no `AbortController`, no timeout, no retry, no
backoff. A hung provider connection holds the edge-function invocation until the
platform's own timeout, and the user sees nothing.

Separately, the rate limiter (`resolveLimits`/`checkLimits`, `index.ts:377-451`)
enforces *daily requests*, *daily tokens*, *monthly budget* and
`max_tokens_per_request` — but `max_tokens_per_request` caps **output** only. Input is
capped only by the context builders' `MAX_CONTEXT_CHARS` (32k), which does not apply
to `body.conversationHistory` — accepted from the client at `index.ts:149` with no
length or size validation. A single request carrying a large fabricated history is
admitted, billed after the fact, and counted only once against the daily request
limit.

**Fix.** `AbortController` with a 60s timeout and one retry on 429/5xx with jitter;
validate `conversationHistory` (max turns, max total characters) before the provider
call; count estimated input tokens against the limit *before* dispatch rather than
after.

### P1-7 · Unauthenticated, unmetered proxy endpoints **[CONFIRMED]**

`yahoo-chart-proxy`, `fetch-url-metadata` (Supabase), and `quote.mjs`,
`article-extract.mjs` (Netlify) accept requests with no authentication and no rate
limiting. `article-extract` at least refuses private address ranges
(`isPublicHttpUrl`, lines 55-68) — good, and it is the only one that does. All four
serve `Access-Control-Allow-Origin: *`.

These are free bandwidth and free egress for anyone who finds them, and
`article-extract` is a general-purpose page fetcher running inside the deploy's
network. The SSRF guard makes it not a pivot; it remains an open proxy.

**Fix.** Require the caller's Supabase JWT (`auth.getUser()`) on
`yahoo-chart-proxy` and `fetch-url-metadata`; add a per-IP token bucket on the
Netlify pair; restrict `Access-Control-Allow-Origin` to the known deploy origins.

### P1-8 · Realtime subscription on `conversation_messages` has no filter **[VERIFY]**

`src/components/layout/Header.tsx:191-201` subscribes to `postgres_changes` for
`INSERT` on `public.conversation_messages` with **no `filter`**, on a channel named
`'header-messages'` — a constant, so every user in every organization shares it. The
comment above it notes that broadcast was considered "since RLS can prevent realtime
events from reaching the subscriber," which reads as an awareness that RLS
enforcement here was uncertain.

Supabase Realtime applies RLS to `postgres_changes` only when the table is in the
`supabase_realtime` publication *and* has RLS enabled. `conversation_messages` is one
of the 39 tables with no `ENABLE ROW LEVEL SECURITY` statement in any migration. If
RLS is off, every INSERT payload — including the message body — is delivered to every
subscribed client in every organization.

**Verify:**
```sql
SELECT relrowsecurity FROM pg_class WHERE relname = 'conversation_messages';
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```
**Fix regardless:** add `filter: 'conversation_id=in.(…)'` scoped to the user's
participations, and name the channel per user as `PilotActionDashboard.tsx:196`
already does correctly.

### P1-9 · The environment separation the process depends on cannot be rebuilt **[CONFIRMED]**

`docs/CONTRIBUTING.md` §5 makes staging the control for risky change: "target the
`staging` branch first… Staging has its own Supabase project with synthetic data…
The point is to verify destructive changes (schema migrations, data shape shifts,
large refactors) before they" reach pilots. `docs/ORG_SCOPING_RLS_PLAN.md` invokes the
same rule: "Steps 1–2 should run on staging first."

That control depends on staging having production's schema. Per P0-5 it cannot —
`apply-migrations-to-staging.mjs` replays 279 files that create neither
`organizations` nor `organization_memberships` nor `current_org_id()`. Prior session
notes record the staging project as paused and its host as non-resolving.

So the documented safety procedure for the highest-risk class of change is not
currently executable, and the RLS remediation this audit recommends is exactly that
class of change. **Restoring staging is a prerequisite for P0-2 and P0-4, not a
parallel nice-to-have** — which is why it is item 2 in §15, immediately after the
schema baseline that makes it possible.

### P1-10 · Backup, PITR and disaster recovery are undocumented **[CONFIRMED absence]**

Nothing in the repository references backup configuration, point-in-time recovery,
retention windows, or a restore procedure. There is no runbook, no RTO/RPO statement,
and no evidence a restore has ever been tested.

Supabase's paid tiers include PITR but it is opt-in per project. For a system holding
investment decision records that ADR-003 designates canonical, the current state is
that nobody can say from the repo what would be lost, or how long recovery would
take.

**Fix.** Confirm the plan tier and PITR setting; write `docs/runbooks/disaster-recovery.md`
stating RPO, RTO, restore steps and who executes them; perform one restore into a
scratch project and record the wall-clock time. A day.

---

## 4. P2 findings — important hardening and architecture debt

**P2-1 · 40 `SECURITY DEFINER` functions without `SET search_path`.** 91 of the 207
function declarations in migrations are `SECURITY DEFINER`; 40 omit `SET search_path`.
Supabase restricts `CREATE` on `public` for `authenticated`, so this is hardening
rather than a live hole — but it is the standard escalation primitive and the other 51
already do it. The list includes `user_is_portfolio_member` (45 live policies depend
on it), `is_portfolio_pm`, `user_has_workflow_access`, `create_trade_sheet`,
`create_trade_plan_from_view`, `carry_forward_holdings`, `save_asset_content` and
15 `notify_*` triggers. Fix: append `SET search_path = public` to each; mechanical,
one migration.

**P2-2 · `user_is_portfolio_member()` is membership-shaped, not org-shaped.** Defined
at `20260201200000_create_trade_labs_architecture.sql:516`, it checks
`portfolio_members` only, with no organization predicate — and it gates 45 live policies.
The SELECT policies that use it mostly pair it with `portfolio_in_current_org()`, so
reads are safe. Writes are not symmetric: `20260426030000` grants
`accepted_trades` INSERT/UPDATE/DELETE on
`user_is_portfolio_member(portfolio_id) OR (portfolio_in_current_org(...) AND is_active_org_admin...)`.
The first branch has no org check, so **write access is broader than read access** —
a user who is a `portfolio_members` row in another org's portfolio can commit a trade
into it while being unable to read it back. `20260815120000` already established the
right principle for this ("`created_by` matching is not [a reason to cross orgs]
either — the same person in two orgs should not carry notes between them"); it should
be applied here. Fix: `AND portfolio_in_current_org(portfolio_id)` on the write
policies.

**P2-3 · Three overlapping representations of membership.** `users.current_organization_id`
(tenancy pointer), `users.org_id` (referenced by the `audit_events` SELECT policy),
`organization_memberships` (the real membership table), plus `portfolio_team`,
`portfolio_members` and `portfolio_memberships` all appearing in code, and `teams` /
`team_memberships` / `org_chart_nodes` / `org_chart_node_members` as two parallel team
models. Each has consumers. Any authorization reasoning has to hold all of them in
mind at once, which is how the asymmetry in P2-2 arose. See §8 for the consolidation.

**P2-4 · No per-organization AI cost accounting.** `ai-chat` computes
`estimated_cost` correctly (`computeCost`, `index.ts:62`) and attributes rows to an
org (`resolveAttribution`, `index.ts:1414`), but `checkLimits` (`index.ts:429`)
evaluates limits from `getCurrentUsage(supabase, user.id)` — **per user only**. A
20-person organization has 20× the platform default budget and no org-level ceiling,
alert, or dashboard. `organization_ai_config` exists and holds BYOK settings; it does
not hold a budget. Fix: add `monthly_budget_usd` at the org level and check it
alongside the per-user limit.

**P2-5 · `PRICING` is a hardcoded table that will silently mis-bill.**
`index.ts:34-47` maps model IDs to prices; unknown models fall back to
`PROVIDER_DEFAULT_PRICING`. `useAIConfig.ts:76` warns that adding a model requires
editing it. The table already lists `claude-opus-4-7` and `claude-sonnet-4-6`, so it
has been maintained — but a model added on the provider side and selected via
`platform_ai_config.platform_model` produces silently wrong cost accounting rather
than an error. Fix: log a warning and flag the usage row when a model is missing from
`PRICING`.

**P2-6 · `docs/coverage/current_coverage_system.md` contradicts itself.** §2.1's
column table omits `organization_id`; line 104 lists it; §7 shows org-scoped policies
(`organization_id = current_org_id() AND is_active_member_of_current_org()`); §9.5
states "The `coverage` table has no `organization_id` column… This could leak data
across organizations." A document that says both cannot be used to decide anything.
Likewise `docs/ORG_SCOPING_RLS_PLAN.md` lists `asset_notes` as an open hole, which
`20260815120000` closed on 2026-08-16. Fix: date-stamp each section and mark the
resolved items, as `20260815120000` itself does so well.

**P2-7 · Four parallel market-data paths.** A clean `IFinancialDataProvider`
interface exists (`src/lib/financial-data/base-provider.ts:24-45`) with correct
normalized types. It is not the only path — see §12.

**P2-8 · Nine files over 4,900 lines.** `SimulationPage.tsx` (8,104),
`OrganizationPage.tsx` (7,920), `WorkflowsPage.tsx` (7,593),
`TradeIdeaDetailModal.tsx` (7,495), `CoverageManager.tsx` (7,347),
`ExcelModelTemplateManager.tsx` (7,082), `ResearchFieldsManager.tsx` (6,307),
`AssetTableView.tsx` (6,072), `MobileDashboard.tsx` (4,906). This is not a style
complaint: it interacts directly with P1-1, because the org-scope baseline is
per-file, so a 7,000-line file on the allowlist is 7,000 lines exempt from the tenant
guard forever. `CoverageManager.tsx` alone holds 8 unscoped `coverage` queries.

**P2-9 · No load testing and no rate limiting at the edge.** Nothing in the repo
performs load testing. Netlify functions and Supabase edge functions have no per-IP
or per-user throttle. Unknown behaviour under concurrent org-wide operations
(holdings upload, workflow universe evaluation, feed assembly).

**P2-10 · `permissions` on `holdings_api_keys` is read but never enforced.**
`holdings-api/index.ts:67` selects `permissions` from the key record and never
consults it. Every valid key has full upload rights. Also no rate limit and no
request-size cap on a public, key-authenticated endpoint. The org-ownership check
(`index.ts:122-134`) is correct and is the good part of this function.

**P2-11 · `ingest-benchmark-weights` performs unauthenticated service-role deletes.**
`netlify/functions/ingest-benchmark-weights.mjs:105` is `export const handler = async () => {…}`
with no auth check, holding `SUPABASE_SERVICE_ROLE_KEY`, and issues
`DELETE portfolio_benchmark_weights?portfolio_id=eq.<id>` per portfolio. It declares
`config = { schedule: '0 7 * * *' }`, and Netlify does not route scheduled functions
for on-demand HTTP invocation — which is why this is P2 rather than P0. **Verify**
with `curl -i https://<site>/.netlify/functions/ingest-benchmark-weights`; if it
returns anything other than 404, it is P0. Add a shared-secret check regardless: the
protection currently depends on a platform routing behaviour rather than on the code.

**P2-12 · `guard:layout` cannot run on Netlify and is not a deploy gate.**
`netlify.toml` documents this deliberately and routes the layout rules to a required
status check on main instead — sound reasoning, recorded honestly. Noted because it
means the deploy gate is narrower than `npm run guard` suggests, and because
`scripts/ci-integrity.mjs` asserts exactly three required check names, so adding
`tenant:lint:frontend` (P1-1) requires updating that assertion too.

---

## 5. P3 findings — future improvements

- **P3-1 · No structured server-side logging.** Edge functions use `console.error`.
  No request IDs, no correlation between a browser Sentry event and the edge
  invocation that caused it. Add a request ID header propagated from the client.
- **P3-2 · Sentry is client-only.** `src/main.tsx:30` initializes `@sentry/react`.
  Edge and Netlify functions report nowhere. Errors in `ai-chat`, `attention` and the
  ingestion path are invisible outside the Supabase dashboard.
- **P3-3 · Signal thresholds are compile-time constants.** `src/lib/signals/thresholds.ts`
  is excellent — every constant carries its reasoning. But `STALE_DAYS = 30`,
  `MOVE_PCT = 15`, `MATERIAL_WEIGHT_PCT = 5` are the same for every firm. Different
  desks have different definitions of material. §11 makes these skill parameters.
- **P3-4 · `price_history_cache` is keyed on `symbol`.** `docs/asset-universe.md` §5
  already establishes this is a correctness bug, not only a size one: a ticker change
  splits a company's series in two, and `assets` already carries `current_symbol` and
  `lifecycle_status` precisely because tickers move. Re-key on `asset_id` before
  volume arrives.
- **P3-5 · No SLO or uptime monitoring.** No synthetic checks, no alerting on
  availability. The two GitHub-issue alerts (red main, failed ingestion) are good and
  are the only alerting that exists.
- **P3-6 · `npm ci` is unusable.** `ingest.yml` records that the lockfile is not a
  valid `npm ci` input because of peer-dependency conflicts; every job uses
  `npm install --legacy-peer-deps`. Builds are therefore not reproducible from the
  lockfile.
- **P3-7 · No formal data-retention or deletion policy.** `erase-user` (six
  migrations, `20260814140000`–`20260814200000`) and `scripts/erase-organization.mjs`
  exist and are careful. There is no policy document stating what is retained, for how
  long, and what deletion guarantees are offered.

---

## 6. Existing architecture, in text

```
┌──────────────────────────────────────────────────────────────────────────┐
│ BROWSER — React 18 SPA, Vite, ~258k LOC, 1,272 files                     │
│   TanStack Query · Zustand · TipTap · Recharts / lightweight-charts      │
│                                                                          │
│   supabase-js (anon key, session in localStorage)                        │
│     ├── PostgREST ──────────────────► 269 tables queried directly        │
│     ├── Realtime (postgres_changes) ► 9 subscriptions, 1 unfiltered      │
│     ├── Storage ───────────────────► assets, captures, thought-          │
│     │                                 attachments, template-branding      │
│     └── Functions.invoke ──────────► 8 edge functions (3 not in repo)    │
│                                                                          │
│   Direct provider fetch (KEYS IN BUNDLE) ──► Alpha Vantage, Finnhub  ⚠️  │
│   Direct fetch ────────────────────────────► Yahoo (fundamentalData.ts)  │
│   fetch('/.netlify/functions/…') ──────────► quote, article-extract      │
└──────────────────────────────────────────────────────────────────────────┘
            │                                          │
            ▼                                          ▼
┌───────────────────────────────────┐   ┌──────────────────────────────────┐
│ NETLIFY                           │   │ SUPABASE EDGE (Deno)             │
│  Static SPA (8MB, 7GB heap build) │   │                                  │
│  build gate: guard:unit +         │   │  USER-AUTHED (correct):          │
│              guard:tdz + build    │   │   ai-chat      (1,564 ln)        │
│  ignore: netlify-should-build.mjs │   │   attention    (1,184 ln)        │
│                                   │   │                                  │
│  Functions:                       │   │  SERVICE-ROLE, NO AUTH:      ⚠️  │
│   quote.mjs        (open)      ⚠️ │   │   seed-pilot-data   (567 ln)     │
│   article-extract  (open, SSRF-   │   │   auto-archive      (388 ln)     │
│                     guarded)      │   │   holdings-sftp-sync(433 ln)     │
│   ingest-benchmark-weights        │   │   market-events     (254 ln)     │
│     (scheduled, service-role,     │   │   market-news       (609 ln)     │
│      no auth check)            ⚠️ │   │                                  │
└───────────────────────────────────┘   │  API-KEY AUTHED (correct):       │
                                        │   holdings-api      (260 ln)     │
┌───────────────────────────────────┐   │                                  │
│ GITHUB ACTIONS                    │   │  OPEN PROXIES:               ⚠️  │
│  ci.yml   — typecheck-cards,      │   │   yahoo-chart-proxy (189 ln)     │
│             test, layout          │   │   fetch-url-metadata(186 ln)     │
│             (tenant lint = TODO)⚠️│   │                                  │
│  ingest.yml — nightly, service-   │   │  NOT IN REPO:                ⚠️  │
│               role key            │   │   sso-token-exchange             │
└───────────────────────────────────┘   │   calendar-oauth-start           │
                                        │   calendar-sync                  │
                                        └──────────────────────────────────┘
                                                        │
                                                        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ POSTGRES (Supabase) — 423 MB, 27 organizations, ~180 tables in repo      │
│                       + 134 tables that are not                      ⚠️  │
│                                                                          │
│  TENANCY:  users.current_organization_id  ──► current_org_id()           │
│            (mutable column, client-writable)  (function NOT in repo) ⚠️  │
│                                                                          │
│  473 live policies · 88 of them USING(true) across 44 tables         ⚠️  │
│  91 SECURITY DEFINER functions · 40 without SET search_path          ⚠️  │
│                                                                          │
│  Policy helpers:  current_org_id ✗ (62)  is_active_org_admin_of_… ✗ (46) │
│                   is_platform_admin ✗ (19)  is_active_member_of_… ✗ (4)  │
│                   portfolio_in_current_org ✓ (47) — wraps current_org_id │
│                   user_is_portfolio_member ✓ (45) — no org predicate     │
│                                                                          │
│  Domain clusters:                                                        │
│    identity     users, organizations✗, organization_memberships✗,        │
│                 platform_admins✗, teams✗, org_chart_nodes✗               │
│    securities   assets (GLOBAL, no org — deliberate), price_history_     │
│                 cache (keyed on symbol), analyst_ratings, estimates      │
│    portfolios   portfolios, portfolio_holdings✗ (dated snapshots),       │
│                 portfolio_holdings_positions, portfolio_team,            │
│                 portfolio_benchmark_weights                              │
│    research     asset_contributions, asset_notes, price_targets,         │
│                 themes✗, quick_thoughts, coverage, coverage_history      │
│    decisions    trade_queue_items, decision_requests, simulations✗,      │
│                 trade_labs, accepted_trades (CANONICAL, ADR-003),        │
│                 trade_batches✗                                           │
│    process      workflows✗, workflow_stages✗, workflow_universe_rules,   │
│                 *_checklist_items, *_workflow_progress                   │
│    ai           platform_ai_config, organization_ai_config,              │
│                 user_ai_config, ai_usage_log, ai_conversations           │
│    audit        audit_events (CLIENT-WRITTEN ⚠️), organization_audit_log✗│
│                                                                          │
│  Storage: assets (FLAT, cross-tenant ⚠️), org-exports (no policy in      │
│           repo), captures✗, thought-attachments✗, template-branding✗     │
│                                                                          │
│  ✗ = referenced by running code, created by no migration                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Recommended target architecture

The target is the same architecture with three boundaries made real. Nothing below
requires replacing Supabase, Netlify, or the React client.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                                  │
│   No provider API keys. No direct third-party fetches.                   │
│   Session JWT carries a SIGNED org claim ─────────────────────┐          │
└───────────────────────────────────────────────────────────────┼──────────┘
                            │                                   │
        ┌───────────────────┴──────────────┐                    │
        ▼                                  ▼                    │
┌────────────────────┐        ┌─────────────────────────┐       │
│ PostgREST          │        │ EDGE / SERVERLESS       │       │
│  reads + simple    │        │  every function chooses │       │
│  writes, RLS only  │        │  ONE of two stances:    │       │
│                    │        │   (a) user-authed:      │       │
│  Boundary 1:       │        │       anon key + user   │       │
│  ORG CLAIM in JWT  │◄───────┤       JWT, RLS applies  │       │
│  not a table column│        │   (b) service-role:     │       │
└────────────────────┘        │       shared secret OR  │       │
        │                     │       platform-admin    │       │
        ▼                     │       check, mandatory  │       │
┌──────────────────────────┐  └─────────────────────────┘       │
│ POSTGRES                 │            │                       │
│  Boundary 2: EVERY table │            ▼                       │
│  either org-scoped with  │  ┌──────────────────────┐          │
│  a policy naming         │  │ CONTEXT SERVICE      │          │
│  current_org(), or on an │  │  Boundary 3:         │          │
│  explicit GLOBAL list    │  │  packets are built   │          │
│  (assets, currencies).   │  │  from an ORG + SUBJECT│─────────┘
│  Zero USING(true).       │  │  pair, never from a  │
│                          │  │  bare client-supplied│
│  Schema is in the repo.  │  │  id. Provenance and  │
│  CI diffs against it.    │  │  timestamps attached.│
└──────────────────────────┘  └──────────────────────┘
        │                                │
        ▼                                ▼
┌──────────────────────────┐  ┌──────────────────────┐
│ MARKET DATA GATEWAY      │  │ SKILL RUNNER         │
│  one interface, one      │  │  signal → context    │
│  cache, one place with   │  │  → skill → validated │
│  provider keys           │  │  structured result   │
│  (extends the existing   │  │  → tile → action     │
│   IFinancialDataProvider)│  └──────────────────────┘
└──────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ ASYNC TIER (when the workloads in §13 justify it — not yet)   │
│  job table + claim/complete RPCs (the pattern already exists  │
│  in 20260224000000_phase16_governance_jobs.sql) → workers     │
└──────────────────────────────────────────────────────────────┘
```

**The three boundaries, stated as invariants:**

1. **The active organization is signed, not stored.** It arrives in the JWT and no
   client write can change it. `set_current_org` becomes an auth-hook input rather
   than a table write.
2. **Every table is classified.** Org-scoped (policy names the org) or explicitly
   global (`assets`, `currencies`, `asset_classes` reference data). There is no third
   category, and `USING (true)` is not a classification.
3. **Context is authorized independently of RLS.** The AI layer resolves an
   `(org, subject)` pair and builds from that. RLS remains as defence in depth, not as
   the only defence.

---

## 8. Workspace / team target model

**The question asked:** can one application and one model serve an individual user, a
small team, and an enterprise workspace with governance?

**Answer: yes, and the existing model already reaches most of the way.** Do not build
a second product. The reason is that Tesseract's tenancy is already
organization-first — `organization_memberships` exists, `bootstrap_organization`
exists, `provision_client_org` exists, org-scoped policies exist on the core domain,
and there is no "personal, unowned" data class competing with it. The individual case
is a workspace of one, not a different shape.

### What already supports the progression

| Stage | Supported by |
|---|---|
| Individual → one-member workspace | `bootstrap_organization()`, `org_onboarding_status`, `SetupWizard.tsx` |
| Invite a teammate | `organization_invites`, `create_org_invite`, `accept_org_invite`, `auto_accept_pending_invites` (pilot invites never expire — `20260615220000`) |
| Multi-user team | `organization_memberships` with status, `portfolio_team`, `teams`/`team_memberships`, `org_chart_nodes`/`org_chart_node_members` |
| Enterprise governance | `organization_governance`, `organization_audit_log`, `org_export_jobs`, `organization_domains`, `organization_identity_providers`, `set_org_governance`, `schedule_org_deletion`, morph/impersonation with session records |

The governance layer (Phase 16) is more mature than the team layer beneath it —
domain verification, SSO provider registration, export jobs with a claim/complete
state machine, and scheduled org deletion all exist.

### What conflicts with it

1. **The org pointer is a mutable column** (P0-1). Everything above is undermined by
   it: invites, roles and governance all resolve through `current_org_id()`.
2. **Two team models.** `teams`/`team_memberships` and
   `org_chart_nodes`/`org_chart_node_members` both exist and both have consumers
   (12 and 22 client references respectively). Coverage administration is defined
   against `org_chart_node_members.is_coverage_admin`; other features use `teams`. An
   enterprise customer will ask which one their org chart is, and today there are two
   answers.
3. **Three portfolio-membership tables.** `portfolio_team` (39 refs),
   `portfolio_memberships`, `portfolio_members` (the table
   `user_is_portfolio_member` reads). A policy helper reading a different table than
   the UI writes is how P2-2's read/write asymmetry became invisible.
4. **`users.coverage_admin` is a global boolean.** Per
   `docs/coverage/current_coverage_system.md` §1 it means "can manage all coverage
   assignments everywhere" — a *platform*-wide flag on a *per-org* concern, writable
   from `OrganizationPage.tsx:2572`. In a multi-tenant product this is a cross-tenant
   privilege with a per-tenant UI.
5. **Roles are unmodelled.** There is no `role` enum in the repo. `users.user_role`
   (`investor`/`operations`/`support`/`compliance`) is a *persona*, not a permission.
   Actual authority is spread across `user_capabilities`, `coverage_admin`,
   `is_active_org_admin_of_current_org()`, `is_portfolio_pm()`, `platform_admins`, and
   per-object collaboration tables (`workflow_collaborations`, `note_collaborations`,
   `asset_list_collaborations`, `trade_lab_view_members`, `template_collaborations`).

### Expensive to reverse — decide these before more is built on them

| Decision | Why it is expensive later |
|---|---|
| **Org in a column vs. a JWT claim** | Changing it later means re-testing all ~100 dependent policies at once. Changing it now means changing one function and one login hook. **Most expensive item on this list.** |
| **`assets` global vs. per-org** | Already decided (global), correct, and load-bearing: `asset-paths.ts` exists *because* of it. Reversing would rewrite every research table's FK. Keep it. |
| **`accepted_trades` as canonical commit** | ADR-003, correct, and already relied on. Keep. |
| **Two team models** | Every new feature that picks one deepens the split. Cheapest to resolve now. |
| **Global `coverage_admin`** | Becomes a compliance finding the first time an enterprise customer reads it. |

### Target model

```
platform_admins                       ← Tesseract staff only; morph/support
   └── (no customer path to this)

organization                          ← the workspace. ONE per customer.
   │   plan, governance, domains, identity_providers, retention
   │
   ├── organization_membership         ← THE membership record
   │      user_id, organization_id, status, role, joined_at
   │      role ∈ {owner, admin, member, guest}    ← NEW: an actual enum
   │      status ∈ {invited, active, suspended, removed}
   │
   ├── team                            ← ONE team model (collapse the two)
   │      parent_team_id               ← hierarchy = the org chart
   │      └── team_membership(user_id, team_id, role, is_coverage_admin)
   │                                      ↑ coverage_admin becomes per-team,
   │                                        not a global flag on users
   │
   └── portfolio
          └── portfolio_membership     ← ONE table (collapse the three)
                 user_id, portfolio_id, role ∈ {pm, analyst, viewer}

CAPABILITY = f(org role, team role, portfolio role, object grant)
             resolved by ONE function, not five
```

**Progression under this model — no schema branch anywhere:**

- *Individual*: one `organization`, one `organization_membership` with `role='owner'`,
  one implicit team, one portfolio. Nothing is special-cased; the UI hides team
  management when `member_count = 1`.
- *Invites a teammate*: `organization_invites` row → `accept_org_invite` →
  `organization_membership(role='member')`. Team UI appears.
- *Multi-user team*: teams gain hierarchy; portfolio roles start mattering; coverage
  admin is delegated per team.
- *Enterprise*: `organization_governance` turns on domain-verified join, SSO,
  retention and export. Same tables throughout.

**Migration sequence (do not implement in this branch):**

1. Baseline the real schema (P0-5) — everything else is guesswork without it.
2. Add `organization_memberships.role` as an enum, backfilled from whatever
   `is_active_org_admin_of_current_org()` currently reads.
3. Collapse the three portfolio-membership tables behind a view, migrate readers to
   the view, then to the table. `user_is_portfolio_member` moves last.
4. Choose one team model. `org_chart_nodes` is the richer one (hierarchy, coverage
   admin, `coverage_admin_override` fences) — migrate `teams` into it.
5. Move `coverage_admin` from `users` to `team_membership`.
6. Introduce a single `user_capability(org, subject, action)` resolver and migrate
   policies to it one domain at a time.
7. Move the org into the JWT claim; `current_org_id()` reads the claim; delete the
   column's write paths.

Steps 2–5 are independent of each other and can run in parallel. Steps 6 and 7 are
sequential and last.

---

## 9. Coverage target model

**The requirement:** Ideas should operate across the user's relevant investment
universe, not merely current holdings.

### What exists today

| Concept | Where it lives | State |
|---|---|---|
| Portfolio holdings | `portfolio_holdings` (dated snapshots), `portfolio_holdings_positions`, `portfolio_holdings_snapshots` | Working. `docs/handoff.md` §5c warns the snapshot/current collapse is a *class* of bug. |
| Securities | `assets` (912 rows, all equities), `price_history_cache` (135 symbols) | Global by design and correct. See `docs/asset-universe.md`. |
| Analyst coverage | `coverage`, `coverage_history`, `coverage_requests`, `coverage_settings` | Rich (role, visibility, team, portfolio, lead flag, dates). `visibility` is **not enforced** for reads. |
| Team coverage | `coverage.team_id` → `org_chart_nodes` | Present, partly enforced |
| Watchlists | `asset_lists`, `asset_list_items`, `list_items`, `watchlist_items`, `asset_list_collaborations`, `asset_list_favorites`, `asset_list_groups` | **Four overlapping list concepts** |
| Themes | `themes`, `theme_assets`, `theme_asset_links` | Two link tables |
| Admin/pilot universe | `workflow_universe_rules` (10 rule types, JSONB config), `workflow_universe_overrides`, `workflow_portfolio_selections`, `portfolio_universe_assets`, `portfolio_universe_filters` | Powerful and workflow-bound |
| Exclusions | `workflow_universe_overrides`; `asset_followup_suppressions`; `rating_ev_suppressions` | Scattered, per-feature |
| Ideas universe selection | `src/lib/universeFilters.ts`, `universeAssetMatcher.ts`, `workflowScopePopulator.ts` | Client-side, workflow-scoped |

**The core problem is not capability — it is that universe selection is a property of
a workflow.** `workflow_universe_rules` is genuinely good: ten rule types (`index`,
`list`, `theme`, `portfolio`, `sector`, `market_cap`, `priority`, `stage`, `coverage`,
`custom_filter`), JSONB config, and `and`/`or` combination. But it hangs off
`workflow_id`, so a universe cannot be named, reused, shared, or asked about outside
the workflow that owns it. Ideas cannot say "run across my universe" because there is
no such object.

### Target conceptual model

One new first-class concept — **Universe** — generalising what
`workflow_universe_rules` already does, plus one derived table.

```
universe                                ← NAMED, REUSABLE, SHAREABLE
  id, organization_id, name, description
  owner_scope ∈ {user, team, organization, platform}
  owner_id                              ← user_id / team_id / org_id / null
  is_system                             ← Tesseract-authored (pilot defaults)
  │
  ├── universe_rule                     ← generalises workflow_universe_rules
  │     rule_type ∈ { holdings,         ← "what portfolio P holds as of D"
  │                   coverage_user,    ← "what analyst U covers"
  │                   coverage_team,    ← "what team T covers"
  │                   list,             ← a watchlist
  │                   theme,
  │                   index,            ← benchmark membership
  │                   sector, market_cap, priority, stage,
  │                   custom_filter }
  │     rule_config  jsonb              ← same shape as today
  │     combinator ∈ {and, or}
  │     effect ∈ {include, exclude}     ← NEW: exclusions are rules, not a
  │                                       separate mechanism
  │
  ├── universe_pin                      ← explicit include, always wins
  │     asset_id, reason, added_by
  │
  └── universe_exclusion                ← explicit exclude, beats every rule
        asset_id, reason, expires_at, added_by

universe_member                         ← MATERIALISED resolution
  universe_id, asset_id, organization_id,
  source ∈ {rule, pin}, source_rule_id,
  resolved_at
  UNIQUE(universe_id, asset_id)
```

**Resolution order, stated once so it is never ambiguous:**
`universe_exclusion` ▸ `universe_pin` ▸ `include` rules ▸ `exclude` rules.
An explicit exclusion beats an explicit pin — a compliance restriction must not be
overridable by a user's convenience pin.

**Why materialise.** Ideas needs to iterate a universe per user per refresh. Resolving
ten JSONB rules against `assets`, `coverage`, `portfolio_holdings` and
`theme_assets` on every read does not survive contact with the Russell 3000. Recompute
on rule change and on a nightly schedule; store `resolved_at` and surface staleness
the way the signal builders already surface `as_of_date`.

**How the five required scopes map:**

| Requirement | Universe |
|---|---|
| Holdings | `owner_scope=portfolio`, one `holdings` rule. System-created per portfolio. |
| Personal coverage | `owner_scope=user`, one `coverage_user` rule. System-created per analyst. |
| Team coverage | `owner_scope=team`, one `coverage_team` rule. |
| Watchlists | `owner_scope=user`, one `list` rule per watchlist. |
| Admin-controlled pilot coverage | `owner_scope=organization`, `is_system=true`. Editable only by org admins. **This is the one Ideas defaults to during a pilot.** |
| Future enterprise universes | `owner_scope=organization` with restriction rules; `effect=exclude` for restricted lists. |

**Tenancy.** `universe.organization_id NOT NULL`; `universe_member.organization_id`
denormalised so the hot path filters on one column; policies scope on
`organization_id = current_org()` plus owner-scope visibility. `assets` stays global —
the universe is the per-org object, the security is not.

**Migration sequence (do not implement here):**

1. Consolidate the four list concepts (`asset_lists`/`asset_list_items` is the
   healthiest; `list_items`, `watchlist_items`, `asset_list_groups` fold into it).
   Independent of everything else and useful on its own.
2. Consolidate `theme_assets` / `theme_asset_links`.
3. Create `universe` + `universe_rule` + `universe_pin` + `universe_exclusion`, with
   `workflow_universe_rules` copied in and left in place.
4. Add `universe_member` and the resolver; nightly + on-change recompute.
5. Point Ideas at a universe id, defaulting to the org's system universe.
6. Migrate `workflow.universe_id` to reference a `universe`; retire
   `workflow_universe_rules` and `workflow_universe_overrides`.
7. Fold the scattered suppressions (`asset_followup_suppressions`,
   `rating_ev_suppressions`) into `universe_exclusion` where they are universe-shaped.

Steps 1 and 2 can start immediately. Steps 3–5 need the schema baseline first.

---

## 10. LLM context architecture

### Should normalized Postgres remain the operational source of truth?

**Yes. Unambiguously, and do not denormalize for the model's benefit.**

The reasons are specific to this product, not general:

- The data that matters is **relational and mutable**: a thesis is edited, a target is
  revised, a position changes daily, coverage is handed over. A denormalized copy is
  wrong the moment the original changes, and in an investment product "wrong but
  confident" is the failure mode the whole signal-suppression design exists to
  prevent.
- **Tenant isolation is enforced in Postgres.** A vector store or document cache is a
  second place to get isolation right, and P0-2 demonstrates that getting it right in
  *one* place is already hard.
- **Provenance is the product.** Citations, `as_of_date`, "who said this and when" —
  the signal contract already treats these as first-class. A flattened copy loses the
  joins that make provenance computable.
- **Scale does not require it.** 423 MB total; 912 assets; 151 referenced by anything.
  This is not a corpus that needs a retrieval index.

What *is* needed is a **context service**: a layer between Postgres and the model that
assembles permission-checked, provenance-carrying packets. That is not
denormalization; it is a read model.

### Current state

`ai-chat` already does a primitive version — `buildContextDocuments` (`index.ts:503`)
returns titled documents with Anthropic citations enabled, and caps are deliberate
(`MAX_THESIS_CHARS`, `MAX_NOTES`, `MAX_CONTEXT_CHARS`, `index.ts:487-491`). What is
missing: independent authorization (P0-6), timestamps, provenance beyond a title,
versioning, caching, and a stable schema other callers could rely on.

### Target flow

```
    signal / user request
            │
            ▼
   ┌────────────────────────┐
   │ SUBJECT RESOLUTION     │  (org_id, subject_type, subject_id)
   │  resolve_entity_org()  │  ← REJECT if subject_org ≠ caller_org
   └────────────────────────┘     ← this is the fix for P0-6
            │
            ▼
   ┌────────────────────────┐
   │ PACKET ASSEMBLY        │  N independent, individually cacheable slices
   │  each slice:           │
   │   - a stable schema    │
   │   - as_of timestamp    │
   │   - source table + ids │
   │   - a content hash     │
   └────────────────────────┘
            │
            ▼
   ┌────────────────────────┐
   │ BUDGETING              │  drop lowest-value slices to fit the token
   │                        │  budget; RECORD what was dropped
   └────────────────────────┘     ← silence about omission is the bug
            │                        docs/handoff.md §4 names as a class
            ▼
   ┌────────────────────────┐
   │ SKILL EXECUTION        │  → structured result, schema-validated
   └────────────────────────┘
```

### Packet boundaries

Seven slices, each independently retrievable, cacheable and permission-checked. A
skill declares which it needs (§11).

| Slice | Contents | Source | Cache key |
|---|---|---|---|
| **asset** | symbol, name, sector, industry, type, lifecycle, current price + `as_of` | `assets`, `price_history_cache` | `asset:{id}:{price_as_of}` |
| **portfolio** | name, benchmark, holdings as of D with weights, sector breakdown, active weights | `portfolios`, `portfolio_holdings_positions`, `portfolio_benchmark_weights` | `pf:{id}:{snapshot_date}` |
| **coverage** | covering analysts, roles, lead, since-date, team | `coverage` | `cov:{asset}:{org}:{max_updated_at}` |
| **research** | thesis / business model / where-different / catalysts / risks, each with author + timestamp + version | `asset_contributions`, `asset_contribution_history` | `res:{asset}:{org}:{max_updated_at}` |
| **targets** | scenario ladder with probabilities, timeframes, reasoning, expiry, author | `price_targets`, `price_target_outcomes` | `tgt:{asset}:{org}:{max_updated_at}` |
| **decisions** | trade ideas, decision requests, accepted trades, rationales — with outcomes | `trade_queue_items`, `decision_requests`, `accepted_trades` | `dec:{asset}:{pf}:{max_updated_at}` |
| **history** | recent notes, quick thoughts, activity, prior AI conclusions on this subject | `asset_notes`, `quick_thoughts`, `audit_events` | `hist:{subject}:{org}:{max_created_at}` |

**Every slice carries, without exception:**
`as_of` (when the underlying data was true) · `retrieved_at` · `source_table` +
`source_ids` (so a citation resolves to a row) · `org_id` (so a packet cannot be
assembled from two tenants) · `content_hash` (cache validation and result
reproducibility) · `truncated: boolean` + `omitted_count`.

That last pair matters more than it looks. `docs/handoff.md` §4 and
`docs/tickets/suppression-is-silent-to-authors.md` both name silent omission as a
recurring defect class in this codebase. A packet that quietly dropped six of ten
notes and a model that then says "the notes do not mention X" is the same bug wearing
a new hat.

### Permission enforcement

Three layers, in order:

1. **Subject authorization** — resolve the subject's org, compare to the caller's,
   reject on mismatch. Independent of RLS.
2. **RLS** — every slice query runs on the user-authenticated client. Defence in
   depth, not the primary control.
3. **Slice-level policy** — a skill may only receive slices its definition declares
   (§11) and the caller's role permits. A `decisions` slice for a portfolio the user
   is not on is not assembled at all.

**Cache keys must include `org_id` and `user_id` where the slice is user-visible.**
A cache keyed on `asset_id` alone is a cross-tenant leak with a TTL — the same
transitive-reasoning error `docs/tenant-isolation-enumeration.md` §1 documents,
relocated to the cache layer. Worth stating explicitly in the implementation ticket
because it is exactly the kind of "the ids came from a scoped query" reasoning that
has produced four prior instances.

### Versioning

Version the packet schema (`packet_version: 3`) and store it on `ai_usage_log`
alongside the model, so a result can be explained later: which skill, which version,
which packet schema, which slices, which source rows, which model.

---

## 11. Skill architecture

### Where the current system already is

`src/lib/signals/contract.ts` is the strongest piece of architecture in the codebase
and it is most of the way to a skill system already:

- A discriminated union of signal types with per-member justifications for why each is
  distinct.
- `CardResult` is `card | suppression-with-reason` — a card that would display a
  contradiction is unrepresentable, not filtered later.
- Builders are pure functions from typed input to `CardResult`
  (`src/lib/signals/builders/`).
- Thresholds are centralised with reasoning attached
  (`src/lib/signals/thresholds.ts`).
- Suppression, dedupe, priority and staleness are separate, tested modules.

**What is missing to make these skills:** they are compile-time TypeScript in the
client bundle. They cannot be versioned independently, configured per organization,
executed server-side, audited, or authored by anyone outside a deploy.

### Target flow

```
   signal ──► required context ──► skill ──► structured result ──► tile ──► action
     │              │                │              │                        │
  detected      declared         versioned      schema-        allowed actions
  by a rule     slices           definition     validated      declared by the skill
  or a change   (§10)            + prompt       output         and re-checked at
                                                               execution time
```

The two additions to today's model are **(a)** the skill declares its context
requirements, so the context service can assemble exactly what is needed and refuse
what is not permitted; and **(b)** actions are declared and re-authorized, so a model
suggesting "trim 50bps" produces a *proposal object*, never a write.

### Canonical skill definition

```yaml
id: scenario_gap_review          # stable, referenced by results forever
version: 3                       # bumped on any behavioural change
name: "Scenario gap review"
purpose: >
  When price has moved materially against the analyst's scenario ladder,
  state the gap and what would have to be true to keep the base case.

# ── Trigger ────────────────────────────────────────────────────────────
triggers:
  signal_types: [scenario_gap, target_expired, no_target]
  manual: true                   # invocable from the asset page
  scheduled: null

# ── Context (names slices from §10; the runner assembles exactly these) ─
context:
  required: [asset, targets, research]
  optional: [coverage, decisions, history]
  budget_tokens: 12000
  freshness:
    asset.price: 15m             # past this, suppress rather than compute
    targets: 7d

# ── Model ──────────────────────────────────────────────────────────────
model:
  min_capability: reasoning      # NOT a model id — ids rot (see P2-5)
  preferred: claude-sonnet-4-6
  fallback: claude-haiku-4-5-20251001
  max_output_tokens: 1500
  temperature: 0.2

# ── Instructions ───────────────────────────────────────────────────────
instructions:
  system: |
    …stable, Tesseract-authored…
  customizable_sections:         # what an org may append, not replace
    - house_view
    - risk_language

# ── Output ─────────────────────────────────────────────────────────────
output_schema:                   # JSON Schema. Validated. Retry on failure.
  type: object
  required: [verdict, gap_pct, drivers, confidence]
  properties:
    verdict:    { enum: [thesis_intact, thesis_at_risk, thesis_broken] }
    gap_pct:    { type: number }
    drivers:    { type: array, items: { $ref: "#/$defs/driver" }, maxItems: 5 }
    confidence: { enum: [low, medium, high] }
    citations:  { type: array, items: { $ref: "#/$defs/citation" } }

# ── Actions the RESULT may offer. Re-authorized at execution. ──────────
actions:
  - id: revise_target
    requires_capability: edit_price_target
    writes: price_targets
  - id: open_decision_request
    requires_capability: create_decision_request
    writes: decision_requests
  - id: dismiss
    writes: attention_user_state

# ── Configuration an org or user may set ───────────────────────────────
parameters:
  gap_threshold_pct:   { type: number, default: 15,  min: 5,  max: 50 }
  stale_days:          { type: integer, default: 30, min: 7,  max: 180 }
  # defaults are today's src/lib/signals/thresholds.ts values

# ── Permissions ────────────────────────────────────────────────────────
permissions:
  min_org_role: member
  requires_subject_access: true  # caller must be able to read the subject

# ── Audit ──────────────────────────────────────────────────────────────
audit:
  owner: tesseract
  created: 2026-09-01
  changelog: "v3: added no_target trigger"
  log_level: full                # packet hashes + result + model + cost
```

### The three tiers, and where customization stops

| Tier | Who authors | What they may change | Storage |
|---|---|---|---|
| **Canonical** (Tesseract) | Tesseract | nothing — versioned, signed | repo + `platform_skills` |
| **Organization config** | org admin | `parameters` within min/max; `customizable_sections` text; enable/disable | `organization_skill_config` |
| **Organization skill** | org admin | full definition, but only from an approved context-slice list and an approved action list | `organization_skills` |
| **User config** | any member | `parameters` within the org's narrowed range; enable/disable for themselves | `user_skill_config` |

**The line that must not move: a customization may narrow, never widen.** A user
cannot grant themselves a context slice, an action, or a threshold outside the range
the org set, and an org cannot grant a slice the platform has not approved. Without
that rule the skill builder becomes a mechanism for arbitrary data access with a
friendly UI.

### Sequence

1. Extract the current builders behind a `SkillDefinition` interface — same code,
   declared metadata. No behaviour change.
2. Move `thresholds.ts` values into `parameters` with the current values as defaults.
3. Add `organization_skill_config` and `user_skill_config`; wire the UI.
4. Build the skill runner as a server-side function using the §10 context service.
5. Port one LLM-backed skill end to end and validate its output schema.
6. Then, and only then, consider an org-level skill builder.

---

## 12. Market-data architecture concerns

### The abstraction exists and is not the only path

`src/lib/financial-data/base-provider.ts:24-45` defines `IFinancialDataProvider` with
`getQuotes`, `getHistoricalData`, `getCompanyProfile`, and optional `getDividends`,
`getSplits`, `getEarnings`, `getNews`, `search`, plus `isHealthy()` and
`getRateLimit()`. `types.ts` defines normalized `Quote`, `HistoricalPrice`,
`CompanyProfile`, `Dividend`, `Split`, `Earnings`, `NewsItem`, `SearchResult`.
`ProviderManager` handles fallback and caching. This is a sound design and most of the
answer to "can this evolve to provider-neutral interfaces?" is *the interface is
already written*.

**But four paths reach market data and only one goes through it:**

| Path | File | Provider coupling |
|---|---|---|
| 1. The abstraction | `providers/alpha-vantage.ts`, `providers/yahoo-finance.ts`, `providers/iex-cloud.ts` | correct |
| 2. Browser direct | `browser-client.ts:290,327` — Alpha Vantage + Finnhub with keys in the bundle (P1-2) | **bypasses** |
| 3. Browser direct | `fundamentalData.ts` — 7 hardcoded `query1.finance.yahoo.com` URLs | **bypasses** |
| 4. Server proxies | `netlify/functions/quote.mjs`, `supabase/functions/yahoo-chart-proxy`, `market-news`, `market-events` | **bypasses** |

Path 4 exists for a documented and correct reason — `quote.mjs:1-12` records that
Supabase's egress is refused by Yahoo at the connection level, so the Netlify function
is the fix, not a duplication. The problem is not that the proxy exists; it is that
the proxy is reached by a raw `fetch` rather than by a provider implementation.

### Components with provider-shaped dependencies

Twenty files import `financial-data`; the ones that matter for a provider swap:
`src/components/charts/utils/dataAdapter.ts` (adapts provider output to chart series),
`src/components/charts/AdvancedChart.tsx`, `FinancialChart.tsx`,
`src/components/financial/StockQuote.tsx`, `FinancialNews.tsx`,
`src/hooks/useMarketData.ts`, `src/hooks/useAssetLiveWeights.ts`,
`src/lib/signals/instrument.ts`, `src/components/ideas/feed/FeedChart.tsx`.
`src/lib/chartData.ts` and `src/lib/fundamentalData.ts` are the two library modules
holding Yahoo-shaped assumptions directly.

### Seven capabilities, current coverage

| Capability | Today | Interface exists? | Gap |
|---|---|---|---|
| Security reference data | `assets`, manual + `classify-assets.mjs` | partial (`CompanyProfile`) | no bulk directory; 506/912 exchanges are `'Unknown'` |
| Quote | Yahoo chart via `quote.mjs`; Finnhub in browser | **yes** (`Quote`) | two unrouted paths |
| Price history | Yahoo per-symbol → `price_history_cache` | **yes** (`HistoricalPrice`) | per-symbol at ~10k symbols is the wrong shape (`docs/asset-universe.md` §3) |
| Fundamentals | `fundamentalData.ts`, Yahoo direct | partial | not routed through the interface |
| Corporate actions | Finnhub dividends in `market-events` | declared, unimplemented | splits are absent — and a split breaks a symbol-keyed history silently |
| Events | `market-events` (earnings, dividends, economic) | **no** | Finnhub-shaped, no normalized type |
| News | `market-news` (Finnhub + AlphaVantage + Yahoo RSS) | **yes** (`NewsItem`) | merge logic lives in the edge function, not a provider |

### Recommendation (do not implement in this branch)

1. **Make the interface the only path.** Add a `TesseractGatewayProvider` implementing
   `IFinancialDataProvider` whose transport is the server proxies. Delete paths 2 and
   3. This removes P1-2 as a side effect.
2. **Add two capabilities to the interface:** `getCorporateActions()` and
   `getEvents()`, with normalized types. Splits especially — P3-4's ticker-change bug
   and a missing split are the same failure.
3. **One cache, server-side.** `price_history_cache` plus per-symbol watermarks, as
   `docs/asset-universe.md` §5 specifies. The browser reads the cache, never a
   provider.
4. **Add a bulk EOD capability** (`getGroupedDaily(date)`) — the single change that
   makes the universe expansion tractable, per `docs/asset-universe.md` §3.
5. **Record provenance per datum.** `source`, `as_of`, `license_class`. The pilot
   prerequisite in `docs/handoff.md` §5b is a compliance question ("where do prices
   come from?") and the answer has to be per-number, not per-system.

Note that `docs/asset-universe.md` §8 asks three questions that gate this — bulk EOD
provider, Russell-as-universe vs Russell-as-index, and years of history. They remain
unanswered and they block steps 3–4.

---

## 13. Netlify / Supabase assessment

**Is Netlify + Supabase appropriate now? Yes.** The workload is a static SPA plus
PostgREST plus a handful of short server functions. There is no scaling argument for
leaving, and the two problems this audit found in the platform layer are
configuration and authorization, not capacity.

**What is fine today:**

- Static SPA hosting with the branch-preview opt-in (`netlify-should-build.mjs`) — a
  measured decision, well documented.
- The build gate running `guard:unit && guard:tdz` before `vite build`. The comment in
  `netlify.toml` explaining *why* (three merges published while main was red) is
  exactly the right artifact.
- PostgREST for reads and simple writes.
- Short synchronous functions: quote, article extraction, URL metadata, AI chat.
- Nightly ingestion on GitHub Actions with a service-role key rather than the
  management token — `ingest.yml` reasons about that distinction explicitly and gets
  it right.

**What needs preparation now (weeks, not months):**

| Workload | Why now |
|---|---|
| **Ingestion beyond ~1,000 symbols** | Per-symbol serial fetch already takes ~20 minutes for 132 symbols. At 10k it exceeds any function timeout. Needs the bulk EOD capability + a date-partitioned job. |
| **LLM execution for skills** | Per-request synchronous calls with no timeout (P1-6) will not survive multi-step skills. Needs a job record with status, so a slow skill is a pending tile rather than a hung request. |
| **Document processing** | `mammoth`, `xlsx`, `docx` all run **in the browser** today. Large files block the UI thread and P1-3 makes `xlsx` parsing of untrusted input a security question. Move server-side. |
| **Signal generation at org scale** | `attention/index.ts` is 1,184 lines of synchronous work per request. Fine per-user; not fine as a nightly sweep across 27 orgs. |
| **Notifications** | Currently `notify_*` trigger functions writing rows inside the transaction. A slow notification path becomes a slow write. |

**What should wait for scale:** portfolio reconciliation batches, filing ingestion,
a dedicated queue product (Postgres is the right queue until it isn't), and multi-region.

**The queue pattern already exists in this codebase and should be reused rather than
redesigned.** `20260224000000_phase16_governance_jobs.sql` implements
`org_export_jobs` with `claim_next_export_job(worker_id, limit)`,
`complete_export_job(...)`, `fail_export_job(...)`,
`release_stale_export_locks(interval)`, and `REVOKE ALL … FROM anon, authenticated`
on each. That is a correct job table with worker leasing and correct grants.
Generalize it to `background_jobs(job_type, payload, org_id, status, attempts,
locked_by, locked_until)` and drive it from a scheduled function.

**Specific Netlify/Supabase configuration gaps:**

- No `supabase/config.toml` — `verify_jwt` per function is dashboard-only state
  (contributes to P0-3 and P0-5).
- No `[[headers]]` block (P1-4).
- `NODE_OPTIONS=--max-old-space-size=7168` for an 8 MB bundle. It works, and it is
  close enough to the VM ceiling that the next large dependency is a build failure.
  Worth a bundle-splitting pass — `rollup-plugin-visualizer` is already a devDependency
  and `npm run analyze` already exists.
- Edge functions pin `@supabase/supabase-js@2` via esm.sh with no lock, so a minor
  release changes production without a deploy.

---

## 14. Affected tables, policies, files and functions — index

| # | Finding | Tables / policies | Files | Functions |
|---|---|---|---|---|
| P0-1 | Client-writable org pointer | `public.users`; 62 direct + 47 indirect `current_org_id()` policies | `src/contexts/OrganizationContext.tsx:147,240`; `src/pages/OrganizationPage.tsx:2572`; `src/hooks/useAuth.ts:115`; `src/pages/SettingsPage.tsx:149`; `src/hooks/usePilotProgress.ts:196`; `src/components/onboarding/SetupWizard.tsx:499`; `docs/adr/001-…md` | `current_org_id()`✗, `set_current_org()`✗, `morph_switch_org()` |
| P0-2 | 88 permissive policies | 33 tables — `tdf_*`×14, `portfolio_workflow_progress`, `general_workflow_progress`, `general_checklist_items`, `portfolio_checklist_items`, `workflow_portfolio_selections`, `asset_checklist_items`, `allocation_*`×4, `asset_classes`, `official_/individual_allocation_views`, `coverage_history`, `portfolio_team_history`, `pm_performance_snapshots`, `decision_reviews`, `asset_field_history`, `theme_assets`, `checklist_*`×4, `stage_assignments`, `shared_charts`, `data_snapshots`, `smart_input_references`, `estimate_metrics`, `activity_events`, `audit_events` | migrations `20250830011323`, `20250830131725`, `20250916000000`, `20251013000000`, `20251013100000`, `20251013120000`, `20251102000003`, `20251103000002`, `20251127000001`, `20251127000002`, `20251215000001`, `20251228000000`, `20260102100000`, `20260201100000`, `20260201200000`, `20260221100000`, `20260327100000`, `20260330100000`, `20260424130000` | — |
| P0-3 | Unauthenticated service-role | — | `supabase/functions/seed-pilot-data/index.ts:124-137,160,513`; `auto-archive/index.ts:67-99,138`; `holdings-sftp-sync/index.ts:371-379`; `market-events/index.ts:61`; `market-news/index.ts:94`; `supabase/config.toml` (missing) | `auth.admin.listUsers`, `auth.admin.createUser` |
| P0-4 | Flat storage bucket | `storage.objects` policies for `assets`; `storage.buckets`: `captures`✗, `thought-attachments`✗, `template-branding`✗, `org-exports` (no policy) | `supabase/migrations/20251013115000_create_assets_storage_bucket.sql`; `src/lib/storage/asset-paths.ts`; `scripts/backfill-assets-bucket-org-scope.mjs` | — |
| P0-5 | Schema not in VCS | 134 tables incl. `organizations`, `organization_memberships`, `platform_admins`, `holdings_api_keys`, `note_collaborations`, `portfolio_members`, `conversations`, `messages` | `supabase/migrations/*`; `docs/CONTRIBUTING.md`; `scripts/apply-migrations-to-staging.mjs`; `.github/workflows/ci.yml` | `current_org_id`, `is_active_org_admin_of_current_org`, `is_platform_admin`, `is_active_member_of_current_org`, `user_has_live_portfolio_share`, `user_has_collaborate_share`, `user_has_list_collaboration` + 50 RPCs + 3 edge functions |
| P0-6 | AI context inherits RLS gaps | `assets`, `asset_contributions`, `price_targets`, `asset_notes`, `portfolios`, `portfolio_holdings`, `themes` | `supabase/functions/ai-chat/index.ts:150,189-201,453,503,606,902` | `buildContextDocuments`, `buildContextPrompt`, `executeResearchTool`, `resolve_entity_org`✗ |
| P1-1 | Tenant guard unwired + red | 30 P0 violations across `workflows`, `projects`, `themes`, `calendar_events`, `conversations` | `.github/workflows/ci.yml`; `package.json`; `scripts/frontend-tenant-lint.mjs`; `src/lib/org-scope/org-scope-scan.mjs`; `known-unscoped-queries.json`; `baseline-ratchet.test.ts`; `scripts/ci-integrity.mjs`; `netlify.toml` | `scanFile` |
| P1-2 | Provider keys in bundle | — | `src/lib/financial-data/browser-client.ts:46,327`; `client.ts:36`; `.env.example` | — |
| P1-3 | Vulnerable dependencies | — | `package.json`; `src/utils/excelParser.ts`; `ExcelModelUploader.tsx`; `UniversalNoteEditor.tsx`; `InvestmentCaseBuilder.tsx`; `netlify/functions/ingest-benchmark-weights.mjs` | — |
| P1-4 | No security headers | — | `public/_headers` (missing); `netlify.toml` | — |
| P1-5 | Client-written audit log | `audit_events` — `"Service can insert audit events"` | `src/lib/audit/audit-service.ts:60-100`; `src/hooks/useUserAssetPagePreferences.ts:1521`; migration `20260201100000` | — |
| P1-6 | No timeouts / input caps | — | `supabase/functions/ai-chat/index.ts:149,377-451,1116,1248,1333` | `checkLimits`, `resolveLimits`, `callAnthropicWithLoop` |
| P1-7 | Open proxies | — | `supabase/functions/yahoo-chart-proxy/index.ts:55`; `fetch-url-metadata/index.ts:137`; `netlify/functions/quote.mjs`; `article-extract.mjs` | — |
| P1-8 | Unfiltered realtime | `conversation_messages` | `src/components/layout/Header.tsx:191-201` | — |
| P1-9 | Staging unrebuildable | — | `docs/CONTRIBUTING.md` §5; `scripts/apply-migrations-to-staging.mjs` | — |
| P1-10 | No DR documentation | — | `docs/runbooks/` (missing) | — |
| P2-1 | Missing `search_path` | — | 40 functions across the migration set | `user_is_portfolio_member`, `is_portfolio_pm`, `user_has_workflow_access`, `create_trade_sheet`, `create_trade_plan_from_view`, `carry_forward_holdings`, `save_asset_content`, `notify_*`×15, … |
| P2-2 | Write broader than read | `accepted_trades` INSERT/UPDATE/DELETE; `portfolio_members` | migration `20260426030000:18-40` | `user_is_portfolio_member()` |
| P2-10 | Unenforced API-key perms | `holdings_api_keys` | `supabase/functions/holdings-api/index.ts:67` | — |
| P2-11 | Unauth'd service-role delete | `portfolio_benchmark_weights` | `netlify/functions/ingest-benchmark-weights.mjs:105` | — |

`✗` = not present in the repository.

---

## 15. Recommended implementation sequence

Ordered by dependency, not by severity. Each step is independently shippable and
independently revertible.

**Phase 0 — See the system (2–4 days). Everything else depends on this.**

1. **Dump production DDL into a baseline migration** (P0-5). `supabase db dump
   --schema public --schema storage`. Commit. Correct `docs/CONTRIBUTING.md`.
2. **Answer the four verification questions** — the `users` UPDATE policy (P0-1), `anon`
   grants (P0-2), `conversation_messages` RLS (P1-8), and a `curl` at the scheduled
   Netlify function (P2-11). Under an hour, and it reclassifies four findings.
3. **Rebuild staging from the baseline** (P1-9). Without it, steps 6–8 have nowhere
   safe to run.

**Phase 1 — Close the confirmed holes (1 week).** Parallel with Phase 0 after step 1.

4. **Authorize the five edge functions** (P0-3). Shared-secret for the four scheduled
   ones with input floors; user-auth + platform-admin for `seed-pilot-data`. Add
   `supabase/config.toml`.
5. **Security headers** (P1-4) and **remove provider keys from the bundle** (P1-2).
6. **Fix the six `public`-role policies** (P0-2, tranche 1) — add `TO authenticated`
   (or `service_role`), make the `shared_charts` token load-bearing.

**Phase 2 — Close the tenancy holes (1–2 weeks). Needs staging.**

7. **Lock down `users`** (P0-1 short-term): revoke broad UPDATE, grant the six safe
   columns, move `coverage_admin` to an RPC.
8. **The remaining 84 permissive policies** (P0-2), in three tranches — TDF, then
   workflow/checklist, then allocation. Follow the `20260815120000` template: quantify
   the blast radius, assert the negative, record the applied date.
9. **Storage Phase 3** (P0-4): backfill dry-run → resolve residue → apply the
   org-prefix policy → bring the other four buckets into migrations.

**Phase 3 — Stop the regressions (1 week). Parallel with Phase 2.**

10. **Wire `tenant:lint:frontend` into CI** (P1-1), re-baseline in the open, update
    `ci-integrity.mjs`.
11. **Rewrite the org-scope scanner** per `docs/tenant-isolation-enumeration.md` §3 —
    derive tables from the schema (now possible, thanks to step 1), require a filter
    rather than a mention, probe it with the four constructed cases.
12. **Dependabot + `npm audit` job**; fix `xlsx` from the SheetJS CDN and `jspdf`
    (P1-3). Add `SET search_path` to the 40 functions (P2-1).

**Phase 4 — Make the guarantees real (2–4 weeks).**

13. **Server-side audit writes** (P1-5).
14. **AI hardening** (P0-6, P1-6): resolve tags against the caller's org; fence
    retrieved content; timeouts, retries, input caps; org-level cost ceilings (P2-4).
15. **Authorize the open proxies** (P1-7). **DR runbook + one tested restore** (P1-10).

**Phase 5 — Architecture (ongoing, only after Phases 0–3).**

16. Consolidate membership tables (§8 steps 2–5).
17. Org claim in the JWT (§8 step 7) — the permanent fix for P0-1.
18. Context service (§10) → skill runner (§11).
19. Market-data gateway (§12) → universe model (§9) → bulk EOD ingestion.

---

## 16. Proposed follow-up PRs

Each is narrowly scoped, independently reviewable, and independently revertible.

| PR | Title | Touches | Risk |
|---|---|---|---|
| 1 | `chore(db): baseline production schema as a migration` | one new migration; `docs/CONTRIBUTING.md` | none — additive |
| 2 | `docs(audit): record verification results for the four open questions` | this document | none |
| 3 | `fix(edge): require a shared secret on the four scheduled functions` | 4 edge functions; `supabase/config.toml` | low — scheduler must be updated in the same window |
| 4 | `fix(edge): seed-pilot-data requires an authenticated platform admin` | 1 edge function | low — ops UI must pass the header |
| 5 | `fix(security): add security headers` | `public/_headers`; `netlify.toml` | low — CSP report-only first |
| 6 | `fix(market-data): route Alpha Vantage and Finnhub through the server` | `browser-client.ts`, `client.ts`, `.env.example`, Netlify env | low |
| 7 | `fix(rls): scope the six public-role policies to authenticated/service_role` | 1 migration | low |
| 8 | `fix(users): column grants instead of a broad UPDATE policy` | 1 migration; `OrganizationPage.tsx` | **medium** — verify the five client writers on staging |
| 9 | `fix(rls): org-scope the TDF tables` | 1 migration | low — check row counts first |
| 10 | `fix(rls): org-scope workflow and checklist progress` | 1 migration | **medium** — real content; needs a blast-radius count |
| 11 | `fix(rls): org-scope the allocation framework` | 1 migration | **medium** — same |
| 12 | `fix(rls): org-scope coverage_history, team_history, pm snapshots` | 1 migration | low |
| 13 | `fix(storage): apply the org-prefix policy to the assets bucket` | 1 migration; backfill run | **high** — backfill first, staged, reversible |
| 14 | `fix(storage): bring captures, thought-attachments, template-branding, org-exports into migrations` | 1 migration | medium |
| 15 | `ci: make the frontend tenant lint a required check` | `ci.yml`; `package.json`; `ci-integrity.mjs`; baselines | low — re-baseline in the open |
| 16 | `fix(org-scope): derive the table list from the schema; require a filter` | `org-scope-scan.mjs`; tests; a generated artifact | medium — will surface new violations |
| 17 | `chore(deps): xlsx from the SheetJS CDN; jspdf 4.2.1; router; lodash; ws` | `package.json`; lockfile | medium — needs export smoke tests |
| 18 | `ci: add Dependabot and an npm audit job` | `.github/` | none |
| 19 | `fix(db): add SET search_path to 40 SECURITY DEFINER functions` | 1 migration | low — mechanical |
| 20 | `fix(rls): accepted_trades writes require the current org` | 1 migration | low |
| 21 | `fix(audit): write audit_events server-side` | 1 migration; `audit-service.ts` | medium |
| 22 | `fix(ai): authorize context tags against the caller's organization` | `ai-chat/index.ts` | medium |
| 23 | `fix(ai): timeouts, retries, and input caps on provider calls` | `ai-chat/index.ts` | low |
| 24 | `feat(ai): organization-level cost ceilings` | 1 migration; `ai-chat/index.ts`; settings UI | low |
| 25 | `fix(realtime): scope the conversation_messages subscription` | `Header.tsx` | low |
| 26 | `fix(edge): authenticate yahoo-chart-proxy and fetch-url-metadata` | 2 edge functions; callers | low |
| 27 | `docs(runbook): disaster recovery, with one tested restore` | `docs/runbooks/` | none |
| 28 | `docs: reconcile the coverage and org-scoping documents with reality` | 2 docs | none |

---

## 17. Workstreams that can run in parallel

Independent — different files, different tables, no shared state:

- **A · Platform security** (PRs 3, 4, 5, 26) — edge-function authorization and headers.
- **B · RLS remediation** (PRs 7, 9, 10, 11, 12, 19, 20) — one migration per tranche;
  after PR 1, each tranche touches a disjoint table set.
- **C · Guard restoration** (PRs 15, 16, 18) — CI and lint only.
- **D · Dependencies** (PR 17) — `package.json` only.
- **E · AI hardening** (PRs 22, 23, 24) — `ai-chat` only.
- **F · Documentation** (PRs 2, 27, 28) — docs only.
- **G · Market data** (PR 6) — `financial-data` only.

Streams A, C, D, F and G can start immediately. B and E need PR 1 first.

**Regarding the other Claude instances working on Ideas and Charts:** none of the
above touches `src/components/ideas/`, `src/hooks/ideas/`, `src/lib/ideas/`,
`src/components/charts/` or `src/lib/signals/`. The one contact point is PR 15 — if
the tenant lint becomes a required check and Ideas or Charts adds an unscoped query,
their PR blocks. That is the intended behaviour and worth telling them before it
lands, not after.

---

## 18. Workstreams that must be sequential

```
PR 1 (schema baseline)
  ├─► PR 2 (verification results)         ─► reclassifies P0-1, P0-2, P1-8, P2-11
  ├─► staging rebuild (P1-9)              ─► REQUIRED before PRs 8, 10, 11, 13
  └─► PR 16 (schema-derived table list)   ─► needs a readable schema

staging rebuild
  ├─► PR 8  (users column grants)         ─► five client writers must be verified
  ├─► PR 10 (workflow/checklist RLS)      ─► real content, hiding risk
  ├─► PR 11 (allocation RLS)              ─► same
  └─► PR 13 (storage policy)              ─► backfill MUST complete first

PR 13 storage:  dry run ─► resolve residue by hand ─► apply policy
                (the script's own header is explicit that guessing is worse
                 than not moving a file — do not shortcut this)

PR 15 (lint in CI) ─► PR 16 (scanner rewrite) ─► re-baseline
                      (fix the scanner before the sweep, per
                       docs/tenant-isolation-enumeration.md §3)

PR 8 (column grants) ─► §8 step 7 (JWT claim)
                        the short-term fix must be proven before the structural one

PR 1 ─► §10 context service ─► §11 skill runner ─► org-authored skills
PR 6 ─► §12 gateway ─► bulk EOD ─► §9 universe model ─► Ideas across the universe
```

**The two orderings that are non-negotiable:**

1. **Backfill before storage policy.** Applying `(storage.foldername(name))[1] =
   current_org_id()` to a flat bucket makes every existing object unreachable by its
   owner. The script exists, is dry-run by default, and refuses to guess. Use it.
2. **Scanner before sweep.** A one-time audit closes and the count starts climbing
   again — the project's own documentation records this happening four times.

---

## 19. What must be fixed before exposing Tesseract broadly

Non-negotiable, in order. Nothing here is architectural; all of it is days.

1. **P0-3 — Authorize the five service-role edge functions.** An unauthenticated
   caller can currently enumerate every user in the project and write fabricated
   trades into any organization. This is the shortest path from "public URL" to
   "customer incident" and the fix is a header check.
2. **P0-1 — Verify and lock down `users`.** Three queries to confirm; a column-grant
   migration to fix. If confirmed, every other tenancy control is decorative.
3. **P0-4 — Org-scope the `assets` bucket.** Uploaded models and documents are the
   most sensitive artifacts in the product and they are currently in a shared folder.
4. **P0-2 — At minimum: the six `public`-role policies, the TDF tables, and
   `coverage_history`.** The rest of the 88 can follow, but positions, executed trades
   and the cross-org coverage map cannot.
5. **P1-3 — `xlsx` and `jspdf`.** Both parse or render untrusted user input; both have
   published advisories; `xlsx` needs the vendor CDN because npm no longer carries a
   fixed build.
6. **P1-4 — Security headers.** A CSP is what stops an XSS in rich-text or document
   content from reaching the session token.
7. **P1-2 — Provider keys out of the bundle.** Quota theft and an uncapped bill.
8. **P1-1 — The tenant lint in CI.** Thirteen new P0 violations accumulated with the
   guard unwired. Broader exposure without it means the number keeps climbing and
   nobody sees it.
9. **P0-5 + P1-9 — Schema baseline and a working staging environment.** Not a security
   fix in itself, but the precondition for making any of the above safely, and the
   precondition for a customer security review — which an institutional buyer will
   ask for.
10. **P1-10 — A tested restore.** Before customer data is in the system, somebody
    needs to know how long recovery takes and that it works.

**Explicitly not blockers for broader exposure**, though they belong on the roadmap:
the universe model (§9), the skill architecture (§11), the market-data gateway (§12),
the membership-table consolidation (§8), and the async job tier (§13). All are
important. None of them is a reason to keep the product narrow, and none should be
allowed to delay items 1–10.

---

## Appendix — reproducing this audit

```bash
# Live permissive policies (replays all migrations in order, tracks DROP/CREATE)
node scripts/audit/policy-state.mjs          # the 88 survivors
node scripts/audit/policy-state.mjs --all    # all 473 live policies
node scripts/audit/policy-state.mjs --json   # machine-readable

# Tenant lint, current state
node scripts/frontend-tenant-lint.mjs --report
node src/lib/org-scope/org-scope-scan.mjs

# Dependency posture
npm audit --production

# Tables the client queries
grep -rhoE "\.from\('[a-z0-9_]+'\)" src --include=*.ts --include=*.tsx \
  | sed -E "s/\.from\('(.*)'\)/\1/" | sort -u

# RPCs the client calls
grep -rhoE "\.rpc\(\s*['\"][a-z0-9_]+['\"]" src supabase/functions \
  | sed -E "s/.*['\"]([a-z0-9_]+)['\"]/\1/" | sort -u
```

**Open verification queries** — these settle P0-1, P0-2, P1-8 and P2-11:

```sql
-- P0-1
SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename='users';
SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
  WHERE table_name='users' AND grantee IN ('authenticated','anon');
SELECT prosrc FROM pg_proc WHERE proname IN
  ('current_org_id','is_platform_admin','is_active_org_admin_of_current_org');

-- P0-2
SELECT table_name, privilege_type FROM information_schema.role_table_grants
  WHERE grantee='anon' AND table_schema='public';
SELECT tablename, policyname, cmd, roles FROM pg_policies
  WHERE schemaname='public' AND (qual='true' OR with_check='true') ORDER BY tablename;

-- P1-8
SELECT relname, relrowsecurity FROM pg_class WHERE relname='conversation_messages';
SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';

-- RLS coverage overall
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
```

```bash
# P2-11
curl -i https://<site>/.netlify/functions/ingest-benchmark-weights
# anything other than 404 promotes this to P0
```
