# Production database access

**Status:** active policy. Written 2026-11-15 after a production incident.
**Audience:** anyone — human or agent — with the Supabase MCP server configured.

---

## 1. The rule

**The Supabase MCP SQL capability is production read-write access.** Treat it
that way regardless of what any tool name, tool description, summary, or local
memory index calls it. The only thing that makes it read-only is the
`--read-only` flag in `.mcp.json`, and the only thing that proves the flag is
there is running `npm run guard:mcp-readonly`.

There is exactly one production project: `wfcebeagznzgeuyysbnt`. There is no
staging database (see §6).

---

## 2. What happened

On 2026-11-15 an agent ran

```sql
create table public._claude_readonly_probe_20261115 (id int)
```

against production through `mcp__supabase__execute_sql`, intending to *test*
whether the connection was read-only. The call returned `[]`. There was no
prompt, no error, and no warning. The table really existed and had to be
dropped.

Three things went wrong, and each is a separate lesson.

**(a) The config had silently diverged from its own template.**
`.mcp.json.example`, committed to this repo, has always specified
`--read-only`. The working `.mcp.json` had dropped it. Because `.mcp.json` is
gitignored, nothing in CI could ever have noticed. Fixed by
`scripts/guard-mcp-readonly.mjs`, run from the pre-push hook — the only place
that runs on the machine holding the file.

**(b) A memory index line was read as if it were the memory.** The index said
read-only queries were available; the memory file it pointed at said the MCP
connection is read-write and only the raw Management API endpoint accepts
`read_only: true`. The one-line summary was acted on and the file was not
opened.

**(c) The absence of a prompt was read as permission.** It is not. See §4.

**Never test write protection by attempting a write.** §5 gives the read-only
way to establish the same fact in one query.

---

## 3. What `--read-only` actually does

Verified by reading `@supabase/mcp-server-supabase@0.17.0`, not by trusting
the flag's name. Two independent layers:

**Layer 1 — tools are withdrawn, not merely discouraged.** The toolset builder
is `t && yt.has(i) || (a[i] = bt[i])`, where `t` is the readOnly flag and `yt`
is every tool whose `annotations.readOnlyHint === false` and whose
`readOnlyBehavior` is not `"adapt"`. In read-only mode these are **never
registered**, so they cannot be called at all:

`apply_migration`, `deploy_edge_function`, `create_branch`, `merge_branch`,
`reset_branch`, `rebase_branch`, `delete_branch`, `create_project`,
`create_notebook`, `delete_notebook`

**Layer 2 — the transaction is read-only at the database.** `execute_sql`
survives, because its `readOnlyBehavior` is `"adapt"`. Its executor is
`executeSql(id, { query, read_only: o })` with the same flag. The Management
API then runs the statement inside a Postgres `READ ONLY` transaction, which
refuses writes with **SQLSTATE 25006** — in the database engine, below the
tool layer, where no tool configuration can reach.

Both layers are genuine enforcement.

### It is tool-level and transaction-level. It is NOT role-level.

This decides what `--read-only` does and does not protect, so it is stated
from measurement, not inference. Measured against production 2026-11-15,
read-only, on the connection the MCP server uses:

```
current_user                                       postgres
transaction_read_only                              off     (this session, pre-restart)
has_table_privilege(…, memory_events,     INSERT)  true
has_table_privilege(…, accepted_trades,   UPDATE)  true
has_table_privilege(…, decision_requests, DELETE)  true
has_schema_privilege(…, public, CREATE)            true
is_superuser                                       off
role memberships   anon, authenticated, authenticator, pg_create_subscription,
                   pg_monitor, pg_read_all_data, pg_signal_backend,
                   service_role, supabase_privileged_role,
                   tesseract_audience_writer
```

The role keeps **every** write privilege, can create objects in `public`, and
is a member of `service_role`, `supabase_privileged_role` and
`pg_read_all_data` — so it can `SET ROLE` to any of them, and its reads bypass
RLS entirely.

`--read-only` is therefore a **refusal to write inside that transaction**, not
a reduction of authority:

| Layer | Mechanism | What it stops |
|---|---|---|
| Tool | write tools are never registered | `apply_migration`, `deploy_edge_function`, branch tools |
| Transaction | Postgres `READ ONLY` transaction, SQLSTATE 25006 | writes issued through `execute_sql` |
| **Role** | **nothing** | **nothing — full privileges retained** |

Two consequences worth being explicit about:

1. **Any other path using the same token has full write authority.** The flag
   constrains this server's SQL calls; it does not constrain the token. The
   token is account-wide, so it also carries Management API authority for
   everything that is not SQL — project settings, secrets, function deploys.
2. **A read-only transaction is not a sandbox.** `pg_terminate_backend` and
   `pg_cancel_backend` both succeed inside one, because the role holds
   `pg_signal_backend`. Availability is not protected by it. Those stay on a
   keyword denylist.

A genuinely least-privilege setup needs a project-scoped token mapped to a
restricted role, which this Supabase plan does not issue (§7).

### Verifying it took effect after a restart

The flag is read when the MCP server **launches**, so the session that edits
`.mcp.json` keeps its old connection. Confirm after restarting the agent
session, with no write attempted:

1. `npm run guard:mcp-readonly` — the config on disk carries the flag.
2. `select current_setting('transaction_read_only')` — must read `on`. A
   session started before the fix reads `off`, which is how you tell the
   restart has not happened yet.
3. The write tools are absent from the toolset. `apply_migration` and
   `deploy_edge_function` should not be callable at all.

All three, together: 1 proves intent, 2 proves the transaction, 3 proves the
tool layer. Step 2 alone would not distinguish a stale session from a fixed
one.

---

## 4. What is NOT enforcement

These are the traps. Each one is something that looks like a safety guarantee
and is not.

| Looks like a guarantee | Why it is not |
|---|---|
| **The call succeeded silently, so it must have been safe** | Success is the *expected* result of a write on a read-write connection. Silence carries no information about permissions. |
| **A tool named `execute_sql` sounds like a query tool** | Its own annotations say `readOnlyHint: false`, `destructiveHint: true`. The name is the least reliable thing about it. |
| **The server has a destructive-SQL confirmation prompt** | It engages **only** if the MCP *client* advertises an `elicitation` capability with form support. Function `Q()` returns false otherwise and the call proceeds, logging `confirmation_decision route:"bypass"`. Most clients, including the one in this incident, do not advertise it. |
| **A destructive statement would have been caught** | The gate classifies only `DROP`, `DELETE`, `TRUNCATE` and `UPDATE` without `WHERE` as destructive. `CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY`, `GRANT`, `REVOKE` and `INSERT` are **`reason: "not_destructive"`** and run unprompted even with a confirming client. |
| **A memory index line, a summary, or a prior session's note** | A one-line pointer is not the fact. Open the file it points at. |
| **`read_only: true` as a tool argument** | `mcp__supabase__execute_sql` takes only `query` — the project is pinned by `--project-ref`. Passing `read_only` is rejected as an unrecognised key. Read-only is a *server launch* flag, never a per-call argument. |

The general form, and the thing worth remembering: **an interface label is a
claim about intent; enforcement is a property of the system underneath.** Only
the second one stops anything.

---

## 5. How to verify the connection, without writing

One query. It observes the enforcement directly and changes nothing:

```sql
select current_setting('transaction_read_only')  as transaction_read_only,
       current_setting('default_transaction_read_only') as default_read_only,
       current_user, session_user,
       pg_is_in_recovery() as is_replica;
```

- `transaction_read_only = off` → **this is a read-write connection to
  production.** Conclusive. Stop. Run `npm run guard:mcp-readonly`, fix
  `.mcp.json`, and restart the session so the server relaunches with the flag.
- `transaction_read_only = on` → the flag is in effect.

Be precise about what each direction proves. `off` is conclusive: the
connection is read-write, and that is the dangerous case, which is the one
worth detecting. `on` establishes that the flag reached the transaction, and
the flag is separately known to be enforced — writes under it were measured
returning **SQLSTATE 25006** on 2026-11-07 (`UPDATE`, `CREATE TABLE` and
`SELECT INTO` all refused, the same `CREATE TABLE` succeeding with the flag
absent). `on` by itself is *not* an independent proof of refusal, so do not
treat it as one; it is the setting agreeing with a boundary already
demonstrated elsewhere.

Known not to be blocked even inside a read-only transaction:
`pg_terminate_backend` and `pg_cancel_backend` both succeed. Read-only is not
a defence against those.

Measured on 2026-11-15, before the fix: `off`, `off`, `postgres`, `postgres`,
`false`. The owner role, read-write, on the primary.

Note that `.mcp.json` is read when the MCP server **launches**. Editing it does
not change the running session's connection. A session that started read-write
stays read-write until it is restarted.

---

## 6. Intentional writes and migrations

Routine discovery is read-only. Everything that writes goes somewhere else.

| Operation | Route |
|---|---|
| Reading schema, rows, policies, counts | MCP `execute_sql`, read-only |
| Applying a migration | **Not through MCP.** A reviewed migration file, merged to `main`, applied deliberately by the user. Never `supabase db push` — see `docs/decision-review-typed-subject-runbook.md`. |
| Deploying an Edge Function | The protected GitHub Actions workflow `deploy-edge-function.yml`, from merged `main` |
| Changing roles, grants or policies | A migration, reviewed, with the tenant-isolation test Standing Rule 5 requires |
| Any production DDL or DML | Explicit human approval, named and recorded, for that specific statement |

**There is no staging database.** The Supabase plan is free tier and the
available access token is account-wide, so a staging project cannot be
provisioned or isolated with the credentials on hand. Production is **not** a
substitute. Work that needs a database to execute against is blocked and
documented as blocked, not retargeted at production.

To obtain a write connection deliberately, add a *second*, differently named
MCP server entry without `--read-only`, use it, and remove it. Do not remove
the flag from the default entry: the guard exists to catch exactly that, and
a one-off need should not leave a permanent read-write connection behind.

---

## 7. Remaining administrative actions

Not doable with the credentials and plan currently available. Listed so they
are decisions rather than oversights.

1. **A restricted Postgres role for discovery.** The MCP server authenticates
   with an account-wide Supabase access token and lands on the `postgres`
   owner role. `--read-only` constrains the *transaction*, which is sufficient
   for SQL, but the token still carries full Management API authority for
   everything that is not SQL. A genuinely least-privilege setup needs a
   project-scoped token. Requires a Supabase plan that issues them.

2. **A staging project.** Blocked on the free plan (§6).

3. **Rotate the account-wide access token** and reissue it project-scoped.
   Deliberately **not** done autonomously — rotating it breaks every session
   and tool holding it. The user's call.

4. **An MCP client that advertises `elicitation`/form**, which would turn the
   server's confirmation prompts on for the statements it does classify as
   destructive. Worth having, but note §4: it would not have prompted on the
   `CREATE TABLE` that caused this incident.
