# Frontend Tenant Lint

## What it does

`scripts/frontend-tenant-lint.mjs` parses every `src/**/*.ts(x)` file and finds
reads of organization-owned tables that carry no organization filter. It fails
when one of them is not registered in `scripts/lib/tenant-allowlist.mjs`.

It is a bookkeeping gate, not the boundary. **The boundary is Postgres RLS.**
A green run means every unfiltered read is registered against a policy somebody
recorded, at a stated evidence level. It does not mean there are no unfiltered
reads: there are 196.

## Why the baselines are gone

The gate used to hold two numbers, `BASELINE_TOTAL = 38` and `BASELINE_P0 = 17`,
and compare counts. Measured on 2026-11-06, that was wrong four ways:

1. It could not say **which** findings were accepted. When the output read
   "+12 P0", nobody could tell which twelve, so answering "are we exposed?"
   meant adjudicating all 29 by hand.
2. The numbers were set on 2026-02-23 and never updated. By 2026-11-06 they
   were 1,568 commits stale, and 16 new violations had arrived across eleven
   commits without the gate naming one of them.
3. A count **cancels**. Fix one query, add a worse one, and the gate stays
   green.
4. The counts were wrong anyway. The scanner that produced them saw 53
   findings; parsing the same tree finds 196. 38 was never the number of
   unfiltered reads in this codebase.

## Why it parses instead of matching text

The old scanner was regexes over raw file text, and it was wrong in both
directions:

- It matched only the literal identifier `supabase`, so moving a query into a
  function that takes its client as a parameter made the query invisible. That
  happened: commit `75f3fcd7` moved `supabase.from('conversations')` into a seam
  where it is `client.from('conversations')`, and the reported P0 count fell
  from 30 to 29 with the query completely unchanged.
- It read a fixed 400-character window after `.from(` to look for filters, so a
  query with a wide select list had its own filter pushed out of the window,
  while a short query next to a filtered one could be satisfied by its
  **neighbour's** filter.
- `.eq('organization_id', x)` passed but `.in('organization_id', xs)` failed, so
  correct code was reported while the window problem let real gaps through.
- It treated a primary-key filter as proof of tenant isolation. Knowing a UUID
  is not an authorization.

None of those are fixable with a better regex: each needs to know where a call
chain begins and ends, which is a parse. The scanner uses the TypeScript
compiler already in the repository, syntax only — no type checker, because a
type-aware pass over 1,600 files would cost minutes and nothing here needs
types.

## The four kinds of finding

| Kind | Meaning |
|------|---------|
| `unscoped` | Nothing in the chain could bound tenancy |
| `pk-filtered` | `eq`/`in` on a primary key, and nothing about the organization |
| `fk-filtered` | `eq`/`in` on a foreign key, and nothing about the organization |
| `embed` | An organization-owned table pulled in through a PostgREST `select` |

`pk-filtered` and `fk-filtered` are findings, not passes. A `.eq('organization_id', …)`
or `.in('organization_id', …)` passes, and so does a write, whose `WITH CHECK`
clause is the boundary.

An `.or()` is **never** read as an organization filter: it is a disjunction, so
`organization_id.eq.X,is_public.eq.true` returns every public row in every
organization.

## The registry

`scripts/lib/tenant-allowlist.mjs` holds two things.

**`TABLE_POLICY`** — one entry per organization-owned table, carrying the
`SELECT` policy quoted from `pg_policies` and an `evidence` level. RLS is
defined per table, so that is where the reasoning belongs; a per-site paragraph
would be 137 restatements of the same policy.

- `probed` — the policy was read **and** exercised under RLS as two real
  non-platform-admin users in two different organizations, as a caller with no
  membership anywhere, and as `anon`.
- `policy` — the policy was read and carries a conjunctive organization term
  (or something narrower), but was not exercised. Weaker, and marked as such on
  purpose: this is the open half of the work.

**`SITES`** — the ratchet. One entry per `<file>::<table>::<kind>` holding how
many findings of that kind that file may hold. Keyed on file rather than line
number, because line numbers churn on every edit above them and a registry
re-approved after a reformat gets approved without being read.

**`REVIEWED_RPCS`** — an inventory, not a set of reviews. The scanner cannot see
whether a function is `SECURITY DEFINER` or what it checks, so nothing in it is
a claim that a function is safe. What it buys is that a new RPC name fails the
gate and gets looked at.

## How it fails

| Condition | Why it matters |
|---|---|
| A site is not in `SITES` | A new unfiltered read arrived unreviewed |
| A site holds more findings than registered | The count-cancelling hole the baselines had |
| A site holds fewer | Ground gained is held, like the type-error ceiling |
| A registered site no longer exists | The registry is describing code that is gone |
| An RPC name is outside the inventory | Server-side code this gate cannot see |
| A table in `SITES` has no `TABLE_POLICY` | Accepted with no policy behind it |
| A `TABLE_POLICY` entry quotes no policy | A waiver dressed as a review |
| A file cannot be parsed | A gate that calls an unreadable file clean can be switched off |

## Adding or changing an entry

1. Run `node scripts/frontend-tenant-lint.mjs` and read what it says.
2. Prefer fixing the query: `.eq('organization_id', orgId)`,
   `.in('organization_id', orgIds)`, or an org-scoped view.
3. If the read is legitimate, read the policy on that table in `pg_policies`,
   add or confirm its `TABLE_POLICY` entry, and register the site in `SITES`.
   An entry without a quoted policy is rejected.
4. `--emit` prints the `SITES` and RPC blocks as source for pasting. It emits
   counts and names only, never a policy or a reason — those are the parts a
   person has to write.

## Available org-scoped views

| View | Base table |
|------|-----------|
| `org_workflows_v` | `workflows` |
| `org_projects_v` | `projects` |
| `org_themes_v` | `themes` |
| `org_calendar_events_v` | `calendar_events` |
| `org_topics_v` | `topics` |
| `org_captures_v` | `captures` |
| `org_org_chart_nodes_v` | `org_chart_nodes` |
| `organization_members_v` | (composite) |

All use `SECURITY INVOKER`, so the base tables' RLS still applies.

**Limitation**: views do not support PostgREST embedded joins (for example
`creator:created_by(email)`). For a query with joins, add the explicit
organization filter instead.

## Commands

```bash
node scripts/frontend-tenant-lint.mjs          # full report
node scripts/frontend-tenant-lint.mjs --ci     # summary only
node scripts/frontend-tenant-lint.mjs --rpcs   # also list rpc names
node scripts/frontend-tenant-lint.mjs --emit   # registry blocks as source
```

Exit code 0 = every finding is registered, 1 = something is not.

The scanner's own regression tests are in
`src/lib/guards/__tests__/tenant-scan.test.ts`, and each one pins a specific
way the previous scanner could be walked past.

## What is deliberately not excused

The previous version skipped an entire **file** if the text
`useOrganizationData` or `useOrgQueryKey` appeared anywhere in it, on the theory
that the file used an org-scoped hook. One mention excused every query in the
file, including ones that never went near the hook. That is removed.
