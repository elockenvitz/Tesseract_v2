# ADR-003 — `accepted_trades` is the canonical commit record

**Status**: Accepted — 2026-03
**Last reviewed**: 2026-05

## Context

Tesseract's domain model has many objects that look "trade-shaped":

- **Trade ideas** — research proposals, not yet decisions
- **Recommendations** — formal proposals to a PM
- **Trade Lab variants** — what-if sizing scenarios
- **Trade Sheets** — bundles of proposed trades for review
- **Trade Batches** — grouped commitments with optional approval
- **Decision requests** — "PM please decide on this"
- **Accepted trades** — actual committed trade decisions

Earlier in the product's life, several of these objects acted as
"committed trade" representations depending on which surface the
user came from. A trade accepted via the Decision Inbox would
update one table; the same trade pushed from Trade Lab would update
a different one. The "what is a committed trade" question had
multiple correct answers depending on context.

That ambiguity caused real bugs:

- Trade Book showed counts that didn't match the Decision History
  (different sources for "did this trade happen").
- Outcomes attribution missed trades because some commit paths
  didn't fire the same triggers.
- Reconciliation logic had to walk multiple object types to
  reconstruct "what trades has this org executed."

## Decision

**`accepted_trades` is the single source of truth for committed
trades. No other object represents a committed trade.**

This is enforced as a load-bearing invariant:

- Every commit path — Decision Inbox accept, Trade Lab execute,
  Trade Batch approval, ops admin override — writes to
  `accepted_trades` (and only `accepted_trades` as the commit
  record).
- `decision_requests.accepted_trade_id` is the FK from a decision
  back to the trade it produced.
- `trade_batches.id` is the FK on `accepted_trades` linking grouped
  commits.
- **Trade Plans** (an earlier abstraction) are removed from the UI.
  Their DB tables remain for historical data but are dead code.
- **Trade Sheets** are now snapshot-only artifacts — they record
  what was proposed at a moment in time but have no commit side
  effects. They don't resolve decisions.

The `accepted_trades.source` enum (`decision_inbox` |
`trade_lab_execute` | `trade_batch` | `manual_admin` | ...) records
*how* the trade was committed, so reconciliation can still slice by
origin without inferring it from other tables.

## Consequences

**Good:**

- Every read of "what trades happened" goes through one table.
  Counts match. Reconciliation is one query.
- Outcomes attribution is correct by construction — every committed
  trade has the same triggers fire.
- Adding a new commit path (e.g. a future API integration) means
  "write to `accepted_trades` with the right source enum" — no
  parallel record-keeping to maintain.
- Auditors and downstream analytics can trust a single table as
  ground truth.

**Bad:**

- `accepted_trades` is now load-bearing — schema changes need to
  consider all the surfaces writing to it. Mitigated by a single
  `accepted-trade-service.ts` that all commit paths go through.
- The dead Trade Plans tables still exist in the schema. We chose
  not to drop them for safety reasons (historical data, plus
  irreversibility of `DROP TABLE`). They're flagged in the schema
  as deprecated.
- `trade_batches.source_type` was a lossy rollup of per-trade
  sources and **should not be read in UI** — per-trade
  `accepted_trades.source` is canonical. This trap caught us once
  and is now documented inline.

## Alternatives considered

- **Trade Plans as the canonical commit record.** This was the
  earlier model. Failed because some commit paths (e.g. ad-hoc
  inbox accepts) didn't naturally fit a "plan" shape and ended up
  writing to other tables anyway.
- **A polymorphic "committed_object" join.** Considered briefly.
  Rejected because the polymorphism would push the ambiguity into
  queries rather than removing it — every read would have to
  resolve which underlying table the row points to.
- **Drop the dead Trade Plans tables now.** Rejected because (a)
  historical data has reporting value, and (b) dropping a table is
  irreversible. They're cheaper to leave in place than to remove
  prematurely.

## Related

- `src/lib/services/accepted-trade-service.ts`
- `src/pages/TradeBookPage.tsx`
- Memory notes: `project_trade_flow_architecture.md`,
  `project_trade_book.md`, `project_trade_book_source_truth.md`
