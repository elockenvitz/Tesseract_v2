# Database privilege audit — read-only

Performed 2026-10-01 against production, read-only. **No grant, policy,
function or row was modified.** No finding below was exploited; severity is
argued from schema and function source, not from an attempt.

Prompted by the previous slice's discovery that `trade_proposal_versions`
granted `TRUNCATE` to `anon` and `authenticated` — and `TRUNCATE` bypasses
RLS entirely.

---

## Headline

**No P0. Nothing here is exploitable today.** Two findings would become
exploitable on a schema change that a reasonable person might make without
noticing, which is what makes them worth fixing before broader release.

The single most important correction to the earlier assumption: the broad
`TRUNCATE` grant is not specific to `trade_proposal_versions`. It is on
**270 of 291 tables for `authenticated`** and **249 for `anon`**. That is
Supabase's default `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
authenticated`, not a Tesseract mistake — but it is still the posture we
ship with.

| Severity | Count | |
|---|---:|---|
| CRITICAL | 0 | — |
| HIGH | 2 | dead RLS-bypassing RPCs; blanket TRUNCATE/DELETE grants |
| MEDIUM | 3 | cross-tenant RPC writes, a `using(true)` policy, non-org-scoped policies |
| LOW | 2 | untidy `anon` EXECUTE on properly-guarded functions |

---

## HIGH-1 — Six `SECURITY DEFINER` RPCs, owned by `postgres`, callable by `anon`, with no authorization check

```
save_asset_content(p_asset_id uuid, p_table_name text, p_content text)
update_asset_content(p_asset_id, p_content_type, p_content, p_created_by, p_updated_by)
update_asset_content(p_table text, p_asset_id, p_content, p_updated_by)
update_asset_content(p_asset_id, p_table_name text, p_content, p_user_id)
update_asset_content_reliable(p_table_name text, p_asset_id, p_content, p_user_id)
update_current_content(p_table text, p_record_id, p_content, p_updated_by)
```

All `prosecdef = true`, all `proowner = postgres`, all
`has_function_privilege('anon', …, 'EXECUTE') = true`. Running as `postgres`
means every statement inside bypasses RLS. None contains an authorization
check — `save_asset_content` references `auth.uid()` only to populate
`created_by`, never to decide whether the caller may write.

Three of the six take a **table name from the caller** and interpolate it
into dynamic SQL.

**Why this is not CRITICAL, verified rather than assumed:**

- Injection is blocked. All use `format('… %I …', p_table_name)`, and `%I`
  quotes the identifier, so `'; DROP …` becomes a quoted table name that
  does not exist.
- The allow-listed variants name `asset_thesis`,
  `asset_where_different`, `asset_risks`. **None of those three tables
  exists.** Every call raises.
- `save_asset_content` has no allow-list, but its first statement is
  `SELECT * FROM %I WHERE asset_id = $1 AND is_current = true`. **No table
  in this database has `asset_id`, `content` and `is_current` together**, so
  every call errors before reaching a write.
- Its INSERT names eight columns (`asset_id, content, version, is_current,
  created_by, updated_by, created_at, updated_at`). **No table matches that
  shape either.** The write primitive has nowhere to land.
- **Zero callers in the application.** `grep` across `src/` returns nothing
  for all six.

**Why it is still HIGH:** this is a loaded weapon pointed at a wall. The
moment anyone creates a table with an `asset_id`/`content`/`is_current`
shape — a perfectly ordinary thing to do for versioned asset text, which is
exactly what these functions were written for — it becomes anonymously
writable through a path that bypasses RLS. Nothing in the schema would warn
anybody.

**Remediation (not applied):** `DROP FUNCTION` all six. They are dead code
with zero callers, so this is the rare security fix with no behavioural risk.
If any is to be kept, it needs `REVOKE EXECUTE … FROM anon`, a caller
authorization check, and a hard-coded table name rather than a parameter.

## HIGH-2 — Blanket `TRUNCATE` / `DELETE` / `UPDATE` to `anon` and `authenticated`

| Grantee | Tables granted | with TRUNCATE | with DELETE | with UPDATE |
|---|---:|---:|---:|---:|
| `anon` | 249 | 249 | 247 | 247 |
| `authenticated` | 291 | 270 | 285 | 283 |

RLS is **enabled on every one** (0 with RLS off), and only 3 tables have zero
policies — those deny everything, which is safe.

**TRUNCATE is not subject to RLS.** A role holding it can empty a table
regardless of every policy on it. The mitigating fact is reachability:
PostgREST exposes SELECT/INSERT/UPDATE/DELETE and RPC, and has no TRUNCATE
verb. Reaching it needs either a direct Postgres connection as
`anon`/`authenticated` (requires the database password, which the browser
does not have) or a `SECURITY DEFINER` function that issues TRUNCATE — none
exists (checked: no `prosrc` in `public` matches `truncate` except the
guarded ones reviewed below).

So: **not exploitable through the product's actual attack surface**, and
unchanged from Supabase's own default. Worth tightening to
`GRANT SELECT, INSERT, UPDATE, DELETE` before broader release so that the
RLS-bypassing verb is simply absent.

DELETE and UPDATE grants are neutralised by RLS wherever no permissive
policy admits the role — see MEDIUM-2 for the exception.

## MEDIUM-1 — `SECURITY DEFINER` content RPCs write across tenants

`update_asset_content_reliable` and `update_current_content` allow-list their
table names correctly, but perform **no ownership or org check** on
`p_asset_id`. Running as `postgres` they bypass RLS, so any caller who knows
an asset id could write that asset's research content in any organisation.

Currently inert for the same reason as HIGH-1 (the target tables do not
exist). Listed separately because the defect is different: HIGH-1 is "no
allow-list", this is "no authorization", and fixing one does not fix the
other.

## MEDIUM-2 — `theme_workflow_progress` has a `using(true)` policy for `public`

```
policy "Service role can manage theme workflow progress"
  for ALL to public using (true) with check (true)
```

The name says service role; the grant says `public`, which includes `anon`.
A policy that always passes is the whole of its protection.

Not exploitable: **`anon` holds no table privilege on it** (verified: `(none)`),
and RLS without a grant is still a denial. The table also holds 0 rows. One
`GRANT` away from being an open table, in either direction.

## MEDIUM-3 — Policies scoped to "is authenticated" rather than to an organisation

```
asset_earnings_dates         ALL to public using (auth.role() = 'authenticated')
portfolio_universe_assets    ALL to public using (auth.role() = 'authenticated')
portfolio_universe_filters   ALL to public using (auth.role() = 'authenticated')
```

Any authenticated user in any of the 28 organisations can read and write
every row in these tables. This is a genuine cross-tenant hole, not a latent
one — it is live today.

Impact is currently near-nil only because the tables are nearly empty:
`asset_earnings_dates` 0 rows, `portfolio_universe_assets` 0 rows,
`portfolio_universe_filters` 1 row. They should be org-scoped before anything
populates them; `asset_earnings_dates` in particular is the table a future
earnings-calendar feature would fill.

## LOW-1 — `anon` holds EXECUTE on correctly-guarded admin functions

`grant_temporary_org_membership` and `seed_pilot_template_portfolio` are both
`anon`-executable and both are properly defended:

- `grant_temporary_org_membership` requires the caller to be in
  `platform_admins`; `auth.uid()` is NULL for `anon`, so it raises.
- `seed_pilot_template_portfolio` requires `is_platform_admin()`.

No exposure. `REVOKE EXECUTE … FROM anon` would make the intent legible.

## LOW-2 — `erase_user_personal_data` is `anon`-executable

Also properly defended: it demands either `service_role` or an active
org-admin of the subject's organisation, and its dynamic SQL uses
`format(%I)` over a hard-coded array with per-table column verification.
This is the best-written `SECURITY DEFINER` function in the schema. Only the
`anon` grant is untidy.

---

## Correctly-posed controls, for contrast

Worth recording so a future audit does not re-litigate them:

- `memory_obligations` — `authenticated` holds **SELECT only**; all writes go
  through two `SECURITY DEFINER` RPCs that each check `is_member_of_org`.
- `memory_events` — insert-only, `actor_id = auth.uid()` enforced in the
  policy, no UPDATE or DELETE policy for any client role.
- `decision_requests` — `portfolio_in_current_org(portfolio_id)` plus
  portfolio-team membership.

These are the pattern the MEDIUM-3 tables should follow.

---

## Method

```sql
-- grants
select table_name, grantee, string_agg(distinct privilege_type, ',')
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
group by table_name, grantee;

-- RLS state and policy counts
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='r';

-- permissive policies admitting anon/public
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname='public' and ('anon' = any(roles) or 'public' = any(roles));

-- SECURITY DEFINER functions reachable by anon/authenticated
select p.proname, pg_get_userbyid(p.proowner), p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE'),
       has_function_privilege('authenticated', p.oid, 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prosecdef;
```

Not covered, and worth a second pass: storage bucket policies, sequence
privileges, `auth` and `storage` schema grants, edge-function service-role
usage, and whether any view is defined `SECURITY DEFINER` (Postgres 15+
`security_invoker` defaults).
