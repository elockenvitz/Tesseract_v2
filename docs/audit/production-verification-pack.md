# Live production verification pack

> **Status note:** some findings below have been closed since this was
> written. See [`AUDIT-STATUS-2026-08-30.md`](./AUDIT-STATUS-2026-08-30.md) before acting on any of
> them. Nothing in this document has been edited — the note tracks status
> separately so the original assessment stands as written.

Companion to `docs/audit/platform-readiness-2026-08.md`. Settles the **[VERIFY]**
findings and confirms or refutes the **[CONFIRMED]** ones against the real database.

**Every statement here is `SELECT`.** No DDL, no DML, no grants, no policy changes.
Nothing reads portfolio, trade, research or message *contents*; where a count is
needed it is a count, never rows. Run as the SQL Editor's default role (`postgres`) —
`has_*_privilege()` needs superuser to answer on behalf of `anon` and `authenticated`.

**Order matters.** Block 0 is a five-second triage that tells you whether the rest is
urgent. Blocks 1–2 settle the two findings that gate everything else.

**Before pasting output anywhere:** query 3.2 returns function source. Scan it for
embedded literals before sharing — function bodies are the one place in this pack
where a secret could plausibly appear.

---

## Block 0 · Triage — is the boundary on at all?

### 0.1 Tables with RLS disabled

```sql
select c.relname                                              as table_name,
       has_table_privilege('anon',          c.oid, 'SELECT')  as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT')  as auth_select,
       has_table_privilege('authenticated', c.oid, 'UPDATE')  as auth_update
from   pg_class c
join   pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public'
  and  c.relkind in ('r','p')
  and  not c.relrowsecurity
order  by 1;
```

**Proves:** which tables have no row filtering whatsoever — policies are irrelevant on
these, because RLS is off.

- **SAFE:** zero rows. Or rows that are all pure reference data (`asset_classes`,
  `currencies`) with `auth_update = false`.
- **UNSAFE:** any row where `anon_select` or `auth_select` is `true` and the table
  holds tenant data. The report's 39 candidates include `assets`, `coverage`,
  `quick_thoughts`, `themes`, `conversation_messages`, `organization_invites`,
  `ai_usage_log`. **`conversation_messages` appearing here also settles P1-8.**

### 0.2 Census — RLS state, policy count and reachability for every table

```sql
select c.relname                                                    as table_name,
       c.relrowsecurity                                             as rls_on,
       c.relforcerowsecurity                                        as rls_forced,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname)  as policies,
       has_table_privilege('anon',          c.oid, 'SELECT')        as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT')        as auth_select
from   pg_class c
join   pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relkind in ('r','p')
order  by c.relrowsecurity, policies, c.relname;
```

**Proves:** the full tenant-boundary posture in one result, and gives you the baseline
to diff against the repo (Block 8).

- **SAFE:** `rls_on = true` and `policies >= 1` on every tenant table.
- **UNSAFE — two distinct failures, both at the top of this sort order:**
  - `rls_on = false` + any grant → **open table** (see 0.1).
  - `rls_on = true` + `policies = 0` → **deny-all**. Not a leak, but it silently
    returns zero rows, which is how a "feature is broken" ticket gets misdiagnosed.

### 0.3 Which schemas PostgREST actually exposes

```sql
select rolname, rolconfig
from   pg_roles
where  rolname in ('authenticator','anon','authenticated','service_role');
```

**Proves:** the value of `pgrst.db_schemas` — the set of schemas reachable over HTTP.
A permissive policy on a schema PostgREST does not expose is not remotely reachable.

- **SAFE:** `public` (and `graphql_public`/`storage` as expected), nothing else.
- **UNSAFE:** any additional schema you did not intend to publish.

---

## Block 1 · P0-1 — is `users.current_organization_id` client-writable?

**This is the single most important block.** If 1.2 returns `true`, the tenant
boundary is redirectable and every other org-scoped policy is downstream of a value
the client controls.

### 1.1 Does the column exist, and is it a plain writable column?

```sql
select column_name, data_type, is_nullable, is_generated, is_updatable
from   information_schema.columns
where  table_schema = 'public' and table_name = 'users'
order  by ordinal_position;
```

**Proves:** the shape of `users`, and confirms the column names the next query
depends on (`current_organization_id`, `coverage_admin`, `user_role`, `org_id`).
Metadata only — no row data.

- **Note:** if `current_organization_id` is absent, stop and re-derive; queries 1.2
  and 1.3 will error rather than mislead.
- **UNSAFE signal in its own right:** `org_id` **and** `current_organization_id` both
  present confirms P2-3's duplicate membership representation.

### 1.2 The decisive privilege check

```sql
select has_table_privilege ('authenticated','public.users','UPDATE')                            as auth_update_table,
       has_column_privilege('authenticated','public.users','current_organization_id','UPDATE')  as auth_update_org_pointer,
       has_column_privilege('authenticated','public.users','coverage_admin','UPDATE')           as auth_update_coverage_admin,
       has_column_privilege('authenticated','public.users','user_role','UPDATE')                as auth_update_user_role,
       has_table_privilege ('anon','public.users','SELECT')                                     as anon_select;
```

**Proves:** whether a browser session holding the anon key and a user JWT may write
the tenancy pointer and the privilege flags. `has_column_privilege` returns true if
*either* a column grant or a table-wide grant applies, so a `true` here is conclusive
regardless of how the grant was expressed.

- **SAFE:** `auth_update_org_pointer = false` **and** `auth_update_coverage_admin =
  false`. That means column-level grants exist and exclude them.
- **UNSAFE:** `auth_update_org_pointer = true`. **P0-1 is live.** Combined with the
  RLS check in 1.4, this is a one-request cross-tenant pivot.
- **Also UNSAFE:** `auth_update_user_role = true` or `auth_update_coverage_admin =
  true` — client-side privilege assignment (attack C).

### 1.3 Are there any column-level grants at all?

```sql
select a.attname                    as column_name,
       g.grantee::regrole::text     as grantee,
       g.privilege_type
from   pg_attribute a
join   pg_class     c on c.oid = a.attrelid
join   pg_namespace n on n.oid = c.relnamespace
cross  join lateral aclexplode(a.attacl) g
where  n.nspname = 'public' and c.relname = 'users'
  and  a.attnum > 0 and not a.attisdropped and a.attacl is not null
order  by 1, 2;
```

**Proves:** whether the narrowing the fix requires already partially exists.

- **SAFE:** rows listing an explicit safe-column allowlist for `authenticated`.
- **UNSAFE:** **zero rows** — no column-level grants anywhere, so table-level `UPDATE`
  covers every column including the tenancy pointer. This is what the repo predicts
  (no `GRANT UPDATE (col)` in 279 migrations).

### 1.4 RLS on `users` — which rows can a caller write?

```sql
select policyname, cmd, permissive, roles, qual, with_check
from   pg_policies
where  schemaname = 'public' and tablename = 'users'
order  by cmd, policyname;

select relrowsecurity as rls_on, relforcerowsecurity as rls_forced
from   pg_class where oid = 'public.users'::regclass;
```

**Proves:** the row scope of the write. Column scope (1.2) and row scope (here)
multiply: broad on both is the worst case.

- **SAFE:** an UPDATE policy whose `qual` **and** `with_check` are both
  `(id = auth.uid())`, plus `rls_on = true`.
- **UNSAFE (escalating):**
  - `with_check` is `null` or `true` while `qual` is `id = auth.uid()` → a user may
    edit their own row into *any* state, including pointing at another org. Sufficient
    for P0-1 on its own.
  - `qual` admits other users' rows (e.g. an org-admin branch) → an org admin can
    rewrite a colleague's `current_organization_id` or `coverage_admin`. This is what
    `OrganizationPage.tsx:2572` needs in order to work today.
  - `rls_on = false` → every authenticated caller can update every user row.

### 1.5 What constrains the column server-side?

```sql
select t.tgname, p.proname as function, pg_get_triggerdef(t.oid) as definition
from   pg_trigger t join pg_proc p on p.oid = t.tgfoid
where  t.tgrelid = 'public.users'::regclass and not t.tgisinternal;

select conname, pg_get_constraintdef(oid) as definition
from   pg_constraint where conrelid = 'public.users'::regclass;
```

**Proves:** whether a trigger or constraint independently enforces that
`current_organization_id` is an org the user actually belongs to — which would make
1.2 returning `true` survivable.

- **SAFE:** a `BEFORE UPDATE` trigger validating membership, or a FK/CHECK to that
  effect.
- **UNSAFE:** only `updated_at` housekeeping triggers, or none. Then `set_current_org`
  is advisory and bypassing it is a direct `PATCH`.

### 1.6 Does `current_org_id()` actually read that column?

```sql
select p.oid::regprocedure                as signature,
       pg_get_userbyid(p.proowner)        as owner,
       p.prosecdef                        as security_definer,
       p.proconfig                        as settings,
       pg_get_functiondef(p.oid)          as definition
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.proname = 'current_org_id' and p.prokind = 'f';
```

**Proves:** the actual tenancy derivation — the fact the repository cannot supply.

- **SAFE:** the body reads a **JWT claim**
  (`auth.jwt() -> 'app_metadata' ->> 'organization_id'` or
  `current_setting('request.jwt.claims')`). A claim is signed and a client cannot
  forge it — P0-1 collapses to a non-issue.
- **UNSAFE:** the body reads `users.current_organization_id`. **P0-1 stands, and its
  blast radius is every policy in Block 3's dependency counts.**
- **Also check:** `security_definer = true` with `settings` containing
  `search_path=public`. A `SECURITY DEFINER` helper with no pinned `search_path` is
  P2-1 at the most sensitive possible location.

---

## Block 2 · P0-2 — live permissive policies and their reachability

### 2.1 Every unconditionally permissive policy

```sql
select schemaname, tablename, policyname, cmd,
       array_to_string(roles, ',') as roles,
       qual, with_check
from   pg_policies
where  schemaname in ('public','storage')
  and  (qual = 'true' or (qual is null and with_check = 'true') or with_check = 'true')
order  by schemaname, tablename, cmd, policyname;
```

**Proves:** the live equivalent of `scripts/audit/policy-state.mjs` output. The report
predicts **88 policies across 44 tables** from migration replay.

- **SAFE:** only rows you can name a reason for — `notifications` INSERT restricted to
  `service_role`, pure reference tables.
- **UNSAFE:** any row on `tdf_*`, `portfolio_workflow_progress`,
  `portfolio_checklist_items`, `general_workflow_progress`, `general_checklist_items`,
  `workflow_portfolio_selections`, `allocation_*`, `coverage_history`,
  `pm_performance_snapshots`, `portfolio_team_history`, `decision_reviews`.
  `cmd` of `UPDATE`/`DELETE`/`ALL` is worse than `SELECT` — that is cross-tenant
  *mutation*.

### 2.2 Policies with no `TO` clause (apply to `public`, which includes `anon`)

```sql
select tablename, policyname, cmd, roles, qual, with_check,
       has_table_privilege('anon', format('%I.%I', schemaname, tablename)::regclass, 'SELECT') as anon_select,
       has_table_privilege('anon', format('%I.%I', schemaname, tablename)::regclass, 'INSERT') as anon_insert
from   pg_policies
where  schemaname = 'public' and roles @> '{public}'::name[]
order  by tablename, cmd;
```

**Proves:** whether the six no-`TO` policies the report identified are actually
reachable without a login. Policy role and table grant must *both* admit `anon`; this
checks both in one row.

- **SAFE:** `anon_select` and `anon_insert` both `false` on every row — the grant
  blocks what the policy would allow.
- **UNSAFE:** `anon_select = true` on `shared_charts`, `data_snapshots`,
  `smart_input_references` or `estimate_metrics` → **unauthenticated read**.
  `anon_insert = true` on `audit_events` or `activity_events` → **unauthenticated
  writes into the audit trail** (compounds P1-5).

### 2.3 The unauthenticated read surface, exhaustively

```sql
select c.relname as table_name
from   pg_class c join pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relkind in ('r','p','v','m')
  and  has_table_privilege('anon', c.oid, 'SELECT')
order  by 1;
```

**Proves:** everything `anon` may attempt to read, before RLS. Every entry is a table
whose policies are the *only* control.

- **SAFE:** a short, deliberate list.
- **UNSAFE:** effectively every table — the Supabase default
  (`ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated`) still in
  force. Cross-reference against 0.1 and 2.1.

### 2.4 Views — do the `org_*_v` views actually run as the invoker?

```sql
select c.relname                     as view_name,
       pg_get_userbyid(c.relowner)   as owner,
       (select option_value from pg_options_to_table(c.reloptions)
         where option_name = 'security_invoker')                as security_invoker,
       has_table_privilege('anon',          c.oid, 'SELECT')    as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT')    as auth_select
from   pg_class c join pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relkind = 'v'
order  by 1;
```

**Proves:** whether the org-scoped views are safe. `docs/tenant-lint-baselines.md`
names views as the **preferred** fix for unscoped queries and asserts "All views use
`SECURITY INVOKER`". If that is wrong, the recommended fix is a bypass.

- **SAFE:** `security_invoker = true` on `org_workflows_v`, `org_projects_v`,
  `org_themes_v`, `org_calendar_events_v`, `org_topics_v`, `org_captures_v`,
  `org_org_chart_nodes_v`, `organization_members_v`.
- **UNSAFE:** `security_invoker` null/false **and** `owner` is a privileged role — the
  view executes with the owner's rights and **bypasses RLS on its base tables**. That
  would be a P0 the repository could not see.

---

## Block 3 · Helper functions — existence, mode, ownership, reach

### 3.1 The tenant-authorization helper set

```sql
select p.proname,
       p.oid::regprocedure                                   as signature,
       pg_get_userbyid(p.proowner)                           as owner,
       p.prosecdef                                           as security_definer,
       case p.provolatile when 'i' then 'immutable'
                          when 's' then 'stable' else 'volatile' end as volatility,
       p.proconfig                                           as settings,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.prokind = 'f'
  and  p.proname in (
         'current_org_id','is_platform_admin','is_active_org_admin_of_current_org',
         'is_active_member_of_current_org','portfolio_in_current_org',
         'user_is_portfolio_member','user_has_live_portfolio_share',
         'user_has_collaborate_share','user_has_list_collaboration',
         'user_has_capability','user_has_template_access','user_has_workflow_access',
         'get_user_organization','is_portfolio_pm','set_current_org','resolve_entity_org')
order  by p.proname;
```

**Proves:** all 16 exist, and their security mode, owner, `search_path` and callable-by.

- **SAFE:** every one present; `security_definer = true` with
  `settings = {search_path=public}`; `volatility = stable`; `anon_exec = false`.
- **UNSAFE:**
  - **Missing rows** → policies referencing them would error at query time, so the
    absence itself is informative: whatever is missing is either differently named or
    lives in another schema. Re-derive before trusting Block 2's counts.
  - `security_definer = true` **and** `settings` is null → P2-1 at a tenancy helper.
  - `anon_exec = true` on `set_current_org` or any `is_*_admin` → unauthenticated
    probing of the authorization surface.
  - `volatility = volatile` on a policy helper → called per row; a correctness-neutral
    but significant performance finding at scale.

### 3.2 Bodies of the four that decide tenancy and privilege

```sql
select p.oid::regprocedure as signature, pg_get_functiondef(p.oid) as definition
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.prokind = 'f'
  and  p.proname in ('current_org_id','is_platform_admin',
                     'is_active_org_admin_of_current_org','is_active_member_of_current_org');
```

**Proves:** the actual authorization logic — the largest single blind spot in the
repository audit. *(Scan output for embedded literals before sharing.)*

- **SAFE:** `is_platform_admin()` reads a `platform_admins` table that no
  client-reachable policy permits writing; the org-admin check reads
  `organization_memberships` with both `status = 'active'` **and** an
  `organization_id = current_org_id()` predicate.
- **UNSAFE:** `is_platform_admin()` reads a boolean column on `users` (then 1.2's
  `auth_update_*` result becomes platform-admin self-promotion); or the org-admin
  check omits the status/org predicate.

### 3.3 Every `SECURITY DEFINER` function without a pinned `search_path`

```sql
select p.oid::regprocedure as signature,
       pg_get_userbyid(p.proowner) as owner,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
  and  (p.proconfig is null
        or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'))
order  by 1;
```

**Proves:** the live count for P2-1 (repo predicts 40 from migrations; live will differ
because ~half the schema is not in migrations).

- **SAFE:** zero rows, or rows with `auth_exec = false`.
- **UNSAFE:** any row owned by `postgres`/`supabase_admin` with `auth_exec = true` —
  the classic escalation shape. Prioritise those over the raw count.

---

## Block 4 · Client-callable RPCs

### 4.1 The security-sensitive RPC surface

```sql
select p.proname,
       p.oid::regprocedure                                   as signature,
       pg_get_userbyid(p.proowner)                           as owner,
       p.prosecdef                                           as security_definer,
       p.proconfig                                           as settings,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.prokind = 'f'
  and  p.proname in (
         -- membership & invites (attack H)
         'accept_org_invite','create_org_invite','auto_accept_pending_invites',
         'approve_org_join_request','bootstrap_organization','provision_client_org',
         'grant_temporary_org_membership','revoke_temporary_org_membership',
         'deactivate_org_member','reactivate_org_member',
         -- tenancy & impersonation (attack C)
         'set_current_org','morph_switch_org','morph_restore_org',
         'start_morph_session','end_morph_session',
         -- org lifecycle & identity
         'archive_org','schedule_org_deletion','cancel_org_deletion',
         'upsert_identity_provider','delete_identity_provider',
         'get_identity_provider_for_email','create_domain_verification','verify_domain',
         -- data egress & secrets
         'request_org_export','get_export_download_url','get_org_ai_config_for_resolution',
         'erase_user','erase_organization')
order  by p.proname;
```

**Proves:** existence, mode, owner, `search_path` and callable-by for the 28 RPCs that
gate privilege. 50 of the app's 93 RPCs are absent from the repo; these are the ones
whose absence matters.

- **SAFE:** all `security_definer = true`, `settings` includes `search_path`,
  `anon_exec = false`.
- **UNSAFE:** `anon_exec = true` on **any** of these. Particularly
  `get_export_download_url` (signed URL to a full org export),
  `get_org_ai_config_for_resolution` (returns a BYOK provider key by design — see
  `ai-chat/index.ts:310`), `grant_temporary_org_membership`, `create_org_invite`.

### 4.2 Bodies of the four invite/membership RPCs (attack H)

```sql
select p.oid::regprocedure as signature, pg_get_functiondef(p.oid) as definition
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.prokind = 'f'
  and  p.proname in ('accept_org_invite','create_org_invite',
                     'grant_temporary_org_membership','auto_accept_pending_invites');
```

**Proves:** whether the invite flow permits privilege escalation — the question the
repository cannot answer at all.

- **SAFE:** `accept_org_invite` matches the invite's target email against
  `auth.jwt() ->> 'email'` (not just the token); `create_org_invite` checks the caller
  admins **the org named in its argument**, not merely their current org; neither lets
  the caller choose the granted role beyond their own.
- **UNSAFE:** `accept_org_invite` accepts a token with no email/identity binding
  (invite tokens leak through mail forwarding); `create_org_invite` checks
  `is_active_org_admin_of_current_org()` while writing to `p_org_id` — the classic
  confused-deputy shape (**attack D**: authorization checked against one object,
  action performed on another).

### 4.3 The full unauthenticated RPC surface

```sql
select p.oid::regprocedure as signature, p.prosecdef as security_definer
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.prokind = 'f'
  and  has_function_privilege('anon', p.oid, 'EXECUTE')
order  by p.prosecdef desc, 1;
```

**Proves:** everything callable over HTTP with no login.

- **SAFE:** empty, or only deliberate pre-auth helpers such as
  `get_identity_provider_for_email` (SSO discovery, which is legitimately pre-auth).
- **UNSAFE:** any `security_definer = true` entry that mutates state. Sort order puts
  those first.

---

## Block 5 · Storage (P0-4)

### 5.1 Buckets

```sql
select id, name, public, file_size_limit, allowed_mime_types, created_at
from   storage.buckets order by id;
```

**Proves:** which buckets exist (repo accounts for `assets` and `org-exports`; the app
also uses `captures`, `thought-attachments`, `template-branding`) and whether any is
served publicly.

- **SAFE:** `public = false` on every bucket.
- **UNSAFE:** `public = true` on any of them — public buckets bypass RLS entirely and
  are readable by URL with no token.

### 5.2 Object policies, and whether org-prefix isolation exists

```sql
select policyname, cmd, array_to_string(roles, ',') as roles,
       (qual ilike '%foldername%'      or with_check ilike '%foldername%')      as uses_path_prefix,
       (qual ilike '%current_org_id%'  or with_check ilike '%current_org_id%')  as uses_org,
       qual, with_check
from   pg_policies
where  schemaname = 'storage' and tablename = 'objects'
order  by cmd, policyname;
```

**Proves:** whether the Phase-3 policy `(storage.foldername(name))[1] =
current_org_id()` — which `src/lib/storage/asset-paths.ts` documents as the tenant
boundary — actually exists.

- **SAFE:** every `assets` policy shows `uses_path_prefix = true` **and**
  `uses_org = true`, on SELECT, INSERT, UPDATE and DELETE.
- **UNSAFE:** a policy whose `qual` is just `bucket_id = 'assets'`. **P0-4 confirmed
  live** — cross-tenant read *and* write of uploaded models and documents.
- **Also check:** any bucket with **no** policy row at all. `org-exports` holds
  whole-organization export archives; if it has no policy and RLS is on, it is
  service-role only (safe); if RLS is off on `storage.objects`, it is not.

### 5.3 Has the backfill run? (counts only — no object names)

```sql
select bucket_id,
       count(*)                                                                   as objects,
       count(*) filter (
         where (storage.foldername(name))[1]
               ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       )                                                                          as org_prefixed,
       count(*) filter (where name like '\_unattributed/%')                       as quarantined
from   storage.objects
where  bucket_id in ('assets','captures','thought-attachments','template-branding','org-exports')
group  by bucket_id order by 1;
```

**Proves:** how much of `scripts/backfill-assets-bucket-org-scope.mjs` has been
applied — which determines whether the Phase-3 policy can be enabled safely.

- **SAFE to apply the policy:** `org_prefixed = objects` for `assets`.
- **NOT SAFE to apply yet:** `org_prefixed < objects`. Applying the policy now makes
  the remainder unreachable by their owners. Run the backfill dry-run first; the
  script refuses to guess an org, and that is correct.

---

## Block 6 · Edge functions — repo-provable vs deployment-only

**Nothing in this block is SQL.** Split so you know what is already settled.

| Finding | Provable from repo alone | Needs deployment/config check |
|---|---|---|
| **P0-3** `seed-pilot-data` has no auth check | **Yes — settled.** `index.ts:124-137` has no `Authorization` read, no `auth.getUser()`, no admin gate. Calls `auth.admin.listUsers()` (`:180`, `:524`) and `auth.admin.createUser()` (`:199`, `:217`). | Only *reachability*: is the function deployed, and is `verify_jwt` on? Neither changes the verdict — the anon key is a valid project JWT. |
| **P0-3** `auto-archive` accepts `retention_days` | **Yes — settled.** `index.ts:98` reads it from the POST body and `:104` from the query string, neither with a floor; `:151` computes the cutoff from it. | Deployed or not. |
| **P0-3** `holdings-sftp-sync`, `market-events`, `market-news` service-role, no auth | **Yes — settled.** Service-role client constructed at `:378`, `:61`, `:94`; no caller identity read in any of the three. | Deployed or not. |
| `ai-chat` / `attention` authenticate correctly | **Yes — settled.** Anon-key client + caller's `Authorization` header + `auth.getUser()` (`ai-chat:106-120`, `attention:1121-1140`). This is the correct pattern. | — |
| `holdings-api` verifies org ownership | **Yes — settled.** `index.ts:122-134` re-reads the portfolio and compares `organization_id` to the API key's org. | Needs `verify_jwt = false` to be callable by external custodians — **verify in the dashboard**. |
| `verify_jwt` per function | **No.** There is no `supabase/config.toml` in the repo. | **Dashboard only.** See checklist item 1. |
| Whether the five unauthenticated functions are deployed at all | **No.** | **Dashboard only.** A function in the repo but never deployed is not a live finding. |
| Whether provider keys are set in the client build | **No.** The *code path* exists (`browser-client.ts:46,327`); whether `VITE_ALPHA_VANTAGE_API_KEY` is populated in Netlify decides exposure. | **Netlify env + built bundle.** See checklist items 5–6. |
| `sso-token-exchange`, `calendar-sync`, `calendar-oauth-start` | **No — absent from the repo entirely.** | **Dashboard only.** Source must be retrieved and reviewed; `sso-token-exchange` is auth-critical. |

### 6.1 SQL that *does* bear on P0-3 — has `seed-pilot-data` been called unexpectedly?

```sql
select count(*)                                             as demo_users,
       count(distinct raw_app_meta_data ->> 'demo_org_id')  as distinct_demo_orgs,
       min(created_at)                                      as first_created,
       max(created_at)                                      as last_created
from   auth.users
where  jsonb_exists(raw_app_meta_data, 'is_demo_user');
```

**Proves:** whether demo users exist and in how many organizations. Counts and
timestamps only — no emails, no identifiers.

- **SAFE:** counts match the pilot orgs you deliberately seeded, and `last_created`
  matches a seeding session you remember.
- **UNSAFE:** `distinct_demo_orgs` exceeds the orgs you seeded, or `last_created` is a
  time nobody was working. **Treat as a potential incident**, not a config finding.

---

## Block 7 · `audit_events` (P1-5)

### 7.1 Policies, RLS, and whether the client can insert

```sql
select policyname, cmd, permissive, array_to_string(roles, ',') as roles, qual, with_check
from   pg_policies where schemaname = 'public' and tablename = 'audit_events'
order  by cmd, policyname;

select relrowsecurity as rls_on, relforcerowsecurity as rls_forced
from   pg_class where oid = 'public.audit_events'::regclass;

select has_table_privilege('authenticated','public.audit_events','INSERT') as auth_insert,
       has_table_privilege('authenticated','public.audit_events','UPDATE') as auth_update,
       has_table_privilege('authenticated','public.audit_events','DELETE') as auth_delete,
       has_table_privilege('anon',         'public.audit_events','INSERT') as anon_insert;
```

**Proves:** whether an authenticated client can write arbitrary audit rows — including
an `actor_id` that is not theirs.

- **SAFE:** INSERT policy restricted `TO service_role`, `auth_insert = false`, and
  UPDATE/DELETE policies `USING (false)`.
- **UNSAFE:** `auth_insert = true` with an INSERT policy of `WITH CHECK (true)` →
  **any user can forge audit entries attributing any action to any actor in any org.**
  The client-side `checksum` (`audit-service.ts:62`, computed by
  `src/lib/audit/checksum.ts`) does not help: the forger runs the same module.
- **Note:** `auth_update`/`auth_delete` returning `true` is *not* a finding on its own
  — the `USING (false)` policies block it. But if `rls_on = false`, they are live.

### 7.2 Is `actor_id` stamped server-side?

```sql
select t.tgname, p.proname as function, pg_get_triggerdef(t.oid) as definition
from   pg_trigger t join pg_proc p on p.oid = t.tgfoid
where  t.tgrelid = 'public.audit_events'::regclass and not t.tgisinternal;

select a.attname, pg_get_expr(d.adbin, d.adrelid) as column_default
from   pg_attribute a
left   join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where  a.attrelid = 'public.audit_events'::regclass
  and  a.attname in ('actor_id','org_id','recorded_at','checksum');
```

**Proves:** whether the server independently establishes the actor, or trusts the
client's claim.

- **SAFE:** a `BEFORE INSERT` trigger setting `actor_id := auth.uid()` and
  `org_id := current_org_id()`, or column defaults doing so. (`org_id` is
  `NOT NULL` per `20260201100000:72`, but NOT NULL only forces the client to supply
  *a* value — not the right one.)
- **UNSAFE:** no trigger and no default → the log records assertions, not events.

### 7.3 Does the SELECT policy reference a column that exists?

```sql
select attname from pg_attribute
where  attrelid = 'public.users'::regclass and attnum > 0 and not attisdropped
  and  attname in ('org_id','current_organization_id');
```

**Proves:** whether `users.org_id` — referenced by the `audit_events` SELECT policy in
`20260201100000:179` — is real, and whether it duplicates `current_organization_id`.

- **SAFE:** exactly one row.
- **UNSAFE (correctness, not security):** two rows → two org pointers on `users` that
  can disagree, and the audit log reads the one nothing else maintains. That would
  make audit visibility silently wrong.

---

## Block 8 · Replayer vs live — capture the mismatch

The migration replayer infers state by replaying `CREATE`/`DROP POLICY` in filename
order. It is right about what the *repository* says and cannot know what was applied
out-of-band. These three queries quantify the divergence.

### 8.1 Headline counts, to compare against the report

```sql
select count(*)                                                                as total_policies,
       count(*) filter (where qual = 'true'
                          or (qual is null and with_check = 'true'))           as permissive_policies,
       count(distinct tablename) filter (where qual = 'true'
                          or (qual is null and with_check = 'true'))           as permissive_tables,
       count(distinct tablename)                                               as tables_with_policies
from   pg_policies where schemaname = 'public';
```

**Proves:** the size of the drift. Report predicts **473 / 88 / 44**.

- **Live ≈ predicted:** the replayer models production well; the report's policy
  findings can be trusted as-is.
- **Live permissive < predicted:** some were fixed out-of-band. Good — but it means
  production diverges from the repo *in the safe direction*, and P0-5 is still true.
- **Live permissive > predicted:** **the more serious case.** Permissive policies were
  created outside migrations. The report's list is then a floor, not a ceiling, and
  2.1 is the authoritative inventory.

### 8.2 Objects that exist live but not in the repo

```sql
select 'table' as kind, c.relname as name
from   pg_class c join pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relkind in ('r','p')
union all
select 'function', p.proname
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.prokind = 'f'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
order  by 1, 2;
```

**Proves:** the live inventory, to diff against the repo. Generate the repo side with:

```bash
node scripts/audit/policy-state.mjs --json          # policies the repo knows about
grep -rhoE "\.from\('[a-z0-9_]+'\)" src --include=*.ts --include=*.tsx \
  | sed -E "s/\.from\('(.*)'\)/\1/" | sort -u        # tables the app queries
```

- **Expected:** ~134 tables and ~50 functions live that no migration creates. That is
  P0-5 measured rather than inferred, and it is the input to the `supabase db dump`
  baseline.

### 8.3 The one query to save as a durable baseline

```sql
select p.schemaname, p.tablename, p.policyname, p.cmd, p.permissive,
       array_to_string(p.roles, ',') as roles, p.qual, p.with_check
from   pg_policies p
where  p.schemaname in ('public','storage')
order  by p.schemaname, p.tablename, p.cmd, p.policyname;
```

**Proves:** nothing on its own — it is the **before** snapshot. Export to CSV and
commit it under `docs/audit/` so every later remediation PR can be diffed against a
known-good starting point, and so "did this migration also leave the old permissive
policy in place?" becomes checkable. That failure mode is exactly what
`20260815120000`'s verification section warns about: policies `OR` together, so
asserting the new policy exists passes even when the old one survives.

---

## Non-SQL checklist — Supabase and Netlify dashboards

Nine items. None is answerable from the database or the repository.

**Supabase**

1. **`verify_jwt` per edge function** (Edge Functions → each function → Details).
   Record it for all ten. Note it is *not* a fix for P0-3 — the anon key is a valid
   project JWT — but a function with `verify_jwt = false` and no internal check is
   reachable by literally anyone.
2. **Which edge functions are actually deployed**, and their last-deployed timestamp.
   A repo function never deployed is not a live finding. Conversely, list any deployed
   function *not* in the repo — `sso-token-exchange`, `calendar-sync` and
   `calendar-oauth-start` are known to be in this category, and `sso-token-exchange`
   should be retrieved and reviewed as auth-critical.
3. **Function secrets** (Settings → Edge Functions → Secrets). Confirm names only —
   never copy values. Expect `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `GOOGLE_AI_API_KEY`, `PERPLEXITY_API_KEY`, `FINNHUB_API_KEY`,
   `ALPHAVANTAGE_API_KEY`. Flag any secret whose purpose you cannot name.
4. **PITR and backups** (Settings → Database → Backups). Record: plan tier, PITR
   on/off, retention window, most recent successful backup. This settles P1-10, which
   the repo could only record as an absence.
5. **API settings** (Settings → API): exposed schemas, max rows, and whether the
   legacy JWT secret has ever been rotated. Also confirm whether the project uses
   legacy `anon`/`service_role` keys or the newer publishable/secret keys — it changes
   what "the anon key is a valid JWT" means for P0-3.
6. **Auth settings** (Authentication → Providers/URL Config): allowed redirect URLs
   (P1-3's `react-router-dom` open-redirect advisories are only exploitable against a
   permissive allowlist), email confirmation requirement, and whether signups are open
   or invite-only.
7. **Log retention and whether anyone reads them.** Edge function logs are where an
   unauthenticated `seed-pilot-data` call would appear. Check for invocations of the
   five unauthenticated functions from unexpected sources — this is the fastest
   available answer to "has P0-3 been exercised?"

**Netlify**

8. **Environment variables** (Site configuration → Environment variables). Confirm
   specifically whether `VITE_ALPHA_VANTAGE_API_KEY` and `VITE_FINNHUB_API_KEY` are
   set for the production context — that is what decides whether P1-2 is theoretical
   or live. Then confirm empirically:
   ```bash
   npm run build && grep -rE "[A-Z0-9]{16,}" dist/assets/*.js | head
   ```
   Also confirm `SUPABASE_SERVICE_ROLE_KEY` is scoped to the functions context, not
   exposed to the build.
9. **Scheduled-function reachability** — settles P2-11:
   ```bash
   curl -i https://<site>/.netlify/functions/ingest-benchmark-weights
   ```
   404 or 405 → Netlify is not routing it, P2-11 stays P2. **Anything that executes →
   promote to P0**: it holds the service-role key and issues `DELETE` against
   `portfolio_benchmark_weights` for every portfolio.

---

## Summary — the five results that change the plan

| Query | Result that changes everything |
|---|---|
| **1.2** `auth_update_org_pointer = true` | P0-1 live. The tenancy pointer is client-writable; the column-grant fix goes to the front of the queue. |
| **1.6** body reads a JWT claim | P0-1 collapses. The architecture is what ADR-001 says and §8's JWT migration is already done. |
| **2.4** `security_invoker` false on `org_*_v` | New P0. The documented preferred fix for unscoped queries is itself an RLS bypass. |
| **5.2** `assets` policy is `bucket_id = 'assets'` only | P0-4 live. But **do not apply the policy** until 5.3 shows `org_prefixed = objects`. |
| **8.1** live permissive **>** 88 | The report's policy list is a floor, not a ceiling. Query 2.1 becomes the authoritative inventory and Block 8.3's snapshot becomes mandatory before any remediation. |
