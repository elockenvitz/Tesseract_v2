# Proposed migrations — NOT APPLIED, NOT ON THE MIGRATION PATH

SQL in this directory is a **proposal awaiting approval**. It is deliberately
**not** under `supabase/migrations/`, so that no tooling, no `supabase db
push`, and no CI step can pick it up and apply it.

Moving a file from here into `supabase/migrations/` is the act that proposes
applying it, and that move needs explicit approval. Until then these are
documents that happen to be valid SQL.

Each file states, at the top:

- what it changes,
- whether it can fail on existing data,
- whether it is reversible, and
- what has to be true before it runs.

See the plan that accompanies them:
[`../chart-annotation-persistence-plan.md`](../chart-annotation-persistence-plan.md).

A note on why this directory exists at all: this repository has a documented
history of migrations that were written, merged, and then assumed to be live.
Merging `main` does not deploy a migration here. Keeping an unapplied
migration out of the applied path makes the distinction structural rather than
a thing to remember.
