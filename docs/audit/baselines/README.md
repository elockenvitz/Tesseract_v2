# Security baselines

Two artifacts, deliberately separated. One is version controlled, one must
never be.

| | Raw schema snapshot | Sanitized inventory |
|---|---|---|
| What | full `pg_dump --schema-only` of production | catalog metadata + hashes |
| Where | `%USERPROFILE%\.tesseract\schema-baselines\` | `docs/audit/baselines/production-security-inventory.json` |
| Committed | **never** | not on `main` — see below |
| Answers | *what exactly changed* | *did anything change* |

The split exists because those two questions have different blast radii. A
drift check needs to know that policy *X* on table *Y* is no longer what it was.
It does not need the predicate, and a repository is the wrong place to publish
the complete expression of every tenant boundary in the product.

---

## The raw snapshot — local only

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out   = "$env:USERPROFILE\.tesseract\schema-baselines\prod-schema-$stamp.sql"

pg_dump $env:PROD_DB_URL --schema-only --schema=public --schema=storage `
  --no-owner --quote-all-identifiers -f $out
```

`--no-acl` is **not** passed, on purpose: grants are the substance of migration
`20260826100100`, and a dump without privileges cannot validate it.

**Scan it before you use it:**

```powershell
node scripts/audit/scan-dump-secrets.mjs $out
```

Exit 0 means no credential pattern matched. Exit 1 means review each finding
before going further — `assigned-secret` and `opaque-blob` are wide on purpose
and will produce false positives. The scanner never prints a matched value, so
its output is safe to paste into a ticket.

A schema dump *should* contain no credentials. It can anyway: function bodies,
column `DEFAULT`s and `COMMENT`s are all places a key has historically been
parked, and a schema dump copies them verbatim.

Restrict the folder once:

```powershell
icacls "$env:USERPROFILE\.tesseract\schema-baselines" /inheritance:r `
  /grant:r "$($env:USERNAME):(OI)(CI)F"
```

The repository root is `.gitignore`d against `*.sql` and `*.dump` so a dump
written there by accident cannot be committed. That is a backstop, not the
plan — write dumps to the path above.

---

## The sanitized inventory — generated, not on `main`

The inventory is a *production-specific* baseline: it enumerates every table,
policy, function and trigger the production database holds. Sanitized as it is
— no bodies, no predicates, no data — that is still a complete map of the
security surface, and it is not carried on `main`. Generate it when you need
it; keep the capture and its diffs with the audit that motivated them.

```bash
node scripts/audit/schema-baseline.mjs                      # production
node scripts/audit/schema-baseline.mjs --project-ref=<ref>  # another project
node scripts/audit/schema-baseline.mjs --summary            # counts only
```

Read-only: every statement is a `SELECT` and the runner refuses anything else.
Credentials resolve from `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF`, or
fall back to `.mcp.json` in the repository root — the same pattern
`scripts/apply-migrations-to-staging.mjs` already uses. `.mcp.json` is
gitignored; do not copy it into a worktree that lacks it, use the env vars.

### What it records

Per **table** — RLS enabled, RLS forced, policy count, and the privilege sets
held by `anon` and `authenticated`.

Per **policy** — table, name, command, roles, permissive flag, whether the
predicate is unconditionally `true`, a truncated SHA-256 of the `USING` and
`WITH CHECK` expressions, and (from `schema_version` 2) a **class** for each:
`UNCONDITIONAL`, `AUTH_ONLY`, `SCOPED`, `DENY`, `EMPTY` or `UNKNOWN`.

The class exists because a hash cannot answer the only question that matters —
*does this predicate constrain the caller?* — and `portfolio_team` shipped a
policy pair where one member was `portfolio_in_current_org(portfolio_id)` and
the other was `auth.uid() IS NOT NULL`. Neither is `true`, both hash to
something opaque, and together they were readable by every authenticated user.
`AUTH_ONLY` names that shape without disclosing any predicate: it says a policy
proves only that someone is logged in, and nothing about which columns, tables
or helpers it mentions. The predicate text is read in memory by
`scripts/audit/schema-baseline.mjs` and dropped before the file is written.

Per **function** — name, identity arguments, owner, `SECURITY DEFINER`,
whether `search_path` is pinned, volatility, `EXECUTE` for `anon` and
`authenticated`, and a hash of the definition.

Per **trigger** — schema, table, name, function, enabled flag, hash of the
definition. Plus storage buckets and aggregate counts.

### What it does not record

No function bodies. No policy expressions. No column defaults. No application
data of any kind. The hashes make change visible; the local snapshot explains
it.

### Reading a diff

A changed `body_hash` on a function, or a changed `qual_hash` on a policy, is
the signal. Open the current local snapshot and the previous one to see what
moved. `captured_at` is the only field expected to change on every run.

---

## Why this exists

`docs/audit/platform-readiness-2026-08.md` §P0-5 found that the repository
describes roughly half the production schema, so a code reviewer cannot see the
policy their change depends on and CI cannot detect a policy edited in the
dashboard. An inventory does not fix the drift, but it makes drift *visible*,
which is the precondition for fixing it.

Regenerate after any migration that touches policies, grants or functions, and
diff it against the previous capture before you call the migration done.
