# Tenant isolation enumeration

**Status:** one section written. The audit itself — all 286 RLS policy bodies,
the three column groups, the client-query intersection, the behavioural CI test
— is scoped and **not started**.

---

## 1. This class is actively generated, not legacy

The first thing to record, because it changes what the audit is for.

On 2026-08-16, fixing the `asset_lists` cross-org leak, I wrote a new query with
the identical defect:

```ts
// trade_queue_items — correctly scoped
.from('trade_queue_items')
.select('..., portfolios!inner(organization_id)')
.eq('portfolios.organization_id', currentOrgId)

// ...then, forty lines later, positions for those same portfolios
.from('portfolio_holdings_positions')
.select('portfolio_id, asset_id, weight_pct, date')
.in('portfolio_id', [...portfolioIds])   // <-- no org filter
```

Written fresh, that day, by the process that exists to remove this pattern. The
org-scope ratchet caught it before merge. It is instance four, and it was not
inherited from anyone — so an audit that treats this as a backlog of old
mistakes will close, and the count will start climbing again.

### Why it is easy to write

The reasoning feels airtight, and reads as *more* careful than a flat query:

> The portfolio ids came from a query I just org-filtered. Every id in that
> array belongs to the current org. Therefore every row I select using those
> ids belongs to the current org. Adding the filter again would be redundant.

Each sentence is true. The conclusion is true *about the ids*. And it is
reinforced by good instincts — not re-filtering looks like avoiding a redundant
predicate, and threading the scoped ids through looks like the careful version.

### Why it is wrong

**RLS evaluates the row, not the provenance of the id.**

Postgres applies the policy to each candidate row in
`portfolio_holdings_positions` on its own terms. It has no knowledge that the
`portfolio_id` values in your `IN (...)` list were themselves obtained from an
org-filtered query — that fact exists only in the client's control flow, which
the database never sees. The row is admitted if *its* policy passes, and if that
policy is ownership-shaped or absent, the `IN` list is the only thing standing
between the user and every other org's rows.

Three ways the argument then fails in practice:

1. **The safety is one refactor deep.** The guarantee lives in the coupling of
   two statements in one function. Extract the second query into a hook, accept
   `portfolioIds` as a parameter, and it is gone — with nothing at either site
   recording that it ever existed.

2. **It presumes the first query was scoped.** In `asset_lists` the first query
   *was* the leak: its policy was `created_by = auth.uid() OR
   user_has_list_collaboration(id)` — ownership, not organisation. Transitive
   reasoning propagates whatever scoping the source actually had, including
   none, and looks identical either way.

3. **It is invisible at the point of failure.** A flat unscoped query is
   recognisable on sight. A transitive one is a correct-looking query whose
   correctness lives elsewhere, so a reviewer reading the diff has nothing to
   object to.

### The rule

**State the org filter on every query against an org-scoped table, even when
you can prove it is redundant.** A redundant predicate costs an index lookup.
An inferred one costs a tenant boundary, and only the second failure is silent.

---

## 2. What the ratchet does and does not catch

Asked directly: does it catch transitive filters generally, or did it catch this
one because the table matched a rule?

**It caught this one because the table matched a rule.** `scanFile` in
`org-scope-scan.mjs` finds `.from('x')`, checks `x` against a hardcoded
ten-entry `ORG_SCOPED_TABLES`, and looks for the literal string
`organization_id` in the following 14 lines. It has no model of transitivity at
all — the instance above was caught only because that block mentioned
`organization_id` nowhere.

Probed against four constructed cases (`scanFile` called directly):

| Case | Result |
|---|---|
| A. `select`s `portfolios!inner(organization_id)` but never filters on it | **MISSED** |
| B. A *comment* mentioning `organization_id`, no filter | **MISSED** |
| C. Transitive filter, no mention of the column anywhere | CAUGHT |
| D. Any query against a table not in the ten-entry list | **MISSED** |

Case A is the sharpest: selecting the column satisfies the guard as completely
as filtering on it. Had I written the `!inner` join without the `.eq`, the
ratchet would have passed the exact bug it caught.

Case D is the widest: 73 tables carry an organization column and the list names
10 of them. `asset_models` — the table whose policy started this whole thread —
is not on it.

So: it will miss the next one on a different table, and it will miss this one if
written slightly differently. It is a tripwire on ten known paths, not a model
of tenant scoping. Rewriting it to distinguish a filter from a mention, and to
derive its table list from the live schema rather than a literal, is part of the
audit and is **not started**.
