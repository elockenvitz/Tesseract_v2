# Architecture Decision Records

Short, dated records of load-bearing architectural decisions. The
point is to capture **why** something is the way it is — so future
contributors (or future-you) don't undo a decision out of "this
seems weird, let me clean it up."

These are not how-tos. For "how does X work," read the code or
`docs/ARCHITECTURE.md`. For "why is X like this," read here.

## Index

| # | Title | Status |
|---|---|---|
| [001](001-multi-tenancy-via-postgres-rls.md) | Multi-tenancy via Postgres RLS | Accepted |
| [002](002-pilot-progress-keyed-per-organization.md) | Pilot progress keyed per organization | Accepted |
| [003](003-accepted-trades-is-the-canonical-commit-record.md) | `accepted_trades` is the canonical commit record | Accepted |

## Adding a new ADR

1. Pick the next number (`004`, `005`, …) — numbers never get reused
   even if an ADR is later marked Superseded.
2. Copy the structure of an existing ADR. The shape is:
   **Status**, **Context**, **Decision**, **Consequences**,
   **Alternatives considered**.
3. Keep it to ~1 page. The summary should fit in someone's head; if
   you need more, the *code* is the long form.
4. Update this index.

## When to write one

Write an ADR when a decision is:

- **Hard to reverse** — schema choices, multi-tenancy model, auth
  topology, the data flow for a core domain concept.
- **Counterintuitive** — anywhere a future reader might look at the
  code and say "this is weird, I'll change it" without realizing
  what would break.
- **Load-bearing** — if undoing it would cascade to many places.

Skip ADRs for ergonomics, formatting, tooling choices, or anything
small enough that the diff is self-explanatory.
