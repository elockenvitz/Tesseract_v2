# Isolated validation harness

A throwaway PostgreSQL database that reproduces the production objects a SQL
changeset touches, so a migration and its rollback can be exercised by real
authenticated users across two organizations before anyone proposes running
them against production.

Nothing here reads production. `00-harness.sql` is pure DDL — no rows, no
credentials, no connection strings.

## Why this exists alongside `docs/contribution-visibility-isolated-env.md`

That document describes the better procedure: `pg_dump --schema-only` from
production into a local database, which reproduces *everything* and cannot
drift. Use it when you have the production database password.

This harness is what can be built without one. The Supabase MCP tooling can
read the catalogue but cannot open a session connection, so the objects below
were transcribed from `pg_get_functiondef()` and `pg_get_expr()` rather than
dumped.

**It is a subset, and subsets drift.** A *failing* assertion here is always
worth believing. A *passing* one is only as good as the harness's fidelity to
production on the objects that assertion touches. Before trusting a green run
on a new changeset, confirm the objects it depends on are present and current —
`scripts/sql/*/10-*.sql` each open with a preconditions block that will fail
loudly if something is missing, which is the first line of defence.

The strongest fidelity check available: production's own
`scripts/sql/contribution-visibility/20-audience-management.sql` applies to
this harness cleanly, policies, role, trigger and RPC included.

## Running it

Needs the PostgreSQL 17 client *and server* binaries on PATH or at a known
location. No Docker required.

```bash
PG=/c/pgsql/bin                 # wherever initdb/pg_ctl/psql live
D=/tmp/tesseract-harness        # anywhere outside the repo
URL='postgresql://postgres@127.0.0.1:55432/postgres'

"$PG/initdb" -D "$D" -U postgres -A trust -E UTF8 --locale=C
"$PG/pg_ctl" -D "$D" -o "-p 55432 -c listen_addresses=127.0.0.1" -w start

"$PG/psql" "$URL" -v ON_ERROR_STOP=1 -f scripts/sql/isolated/00-harness.sql
```

`-A trust` is safe because the cluster listens only on loopback, holds no real
data, and is deleted afterwards. Do not reuse this cluster for anything else.

Then, for a changeset — baseline, migrate, re-run, roll back, re-run:

```bash
"$PG/psql" "$URL" -f supabase/tests/<suite>.sql                    # expect the pre-migration grid
"$PG/psql" "$URL" -v ON_ERROR_STOP=1 -f scripts/sql/<lane>/10-*.sql
"$PG/psql" "$URL" -f supabase/tests/<suite>.sql                    # expect all green
"$PG/psql" "$URL" -v ON_ERROR_STOP=1 -f scripts/sql/<lane>/90-rollback.sql
"$PG/psql" "$URL" -f supabase/tests/<suite>.sql                    # expect the pre-migration grid again
```

A suite that does not go red on the baseline is not testing what it claims.
Each suite states its expected pre- and post-migration grid in its header.

Tear down:

```bash
"$PG/pg_ctl" -D "$D" -m fast stop
rm -rf "$D"
```

## What the harness contains

Roles (`anon`, `authenticated`, `service_role`, `tesseract_audience_writer`),
`auth.users` with Supabase's `auth.uid()` reading `request.jwt.claims`, and the
`public` tables the current suites touch: identity and tenancy, the org chart,
contributions and visibility targets, workflows and stage deadlines, user asset
priorities and widgets, plus the list tables user teardown needs.

Function bodies copied verbatim from production: `current_org_id()`,
`is_active_member_of_current_org()`, `current_user_id()`,
`can_read_asset_contribution()`. `is_active_org_admin_of_current_org()` is a
deliberate stub returning false — the suites write their fixtures as `postgres`
and never exercise the admin path.

Grants include the ones a migration is expected to revoke, so the revocation
has something to act on.

## Adding a table

Copy its shape from the live catalogue rather than from `supabase/migrations/`,
which does not describe production (see `project_schema_drift` in the team
notes). Column types, NOT NULL, defaults, unique constraints and the policies
all matter — a harness that relaxes a constraint turns a real failure green.
