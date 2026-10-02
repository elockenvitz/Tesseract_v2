# Decision execution truth — Slice 1

**The invariant:** Tesseract may claim execution, completion or reconciliation
only when canonical execution evidence proves it happened. A decision that was
accepted but not executed must survive as exactly that.

Implemented on `fix/decision-execution-truth`, from the audit commit `084c651c`.
Memory Spine V1 remains frozen at `0d70fdf1`.

---

## The root cause

`finalizeTradeForHoldingsSource` ran its completion stamp unconditionally.

```
acceptFromInboxToAcceptedTrade  → passes sizing_input only, no share columns
createAcceptedTrade             → inserts them as NULL
finalizeTradeForHoldingsSource  → manual_eod, so apply
applyTradeToHoldings            → rpc(p_target_shares: null, p_delta_shares: null,
                                      p_price: price_at_acceptance || 0)
apply_trade_to_holdings         → :91-97  no share info → RETURN {applied:false}
                                  :113    price guard — NEVER REACHED
client                          → :989    applied:false → plain return, no throw
finalize                        → stamps complete / matched / timestamps anyway
createAcceptedTrade             → emits execution.recorded, append-only
```

The price guard added in `20260913120000` never fires for an Inbox accept,
because the no-share branch returns first. The failure the guard was written
to catch is routed around it.

Three non-executions were all recorded as executed-and-reconciled:

1. **No share sizing** — every Decision Inbox accept, plus Trade Book
   corrections and ad-hoc entry. `applied:false`, no throw.
2. **A refused price** — raises, was caught by the outer handler, left
   `not_started`: truthful by accident and invisible to the PM.
3. **A failed evidence-row insert** — caught, ignored, completion proceeded.

`reconciliation_status='matched'` was the worse half. `computeReconciliation`
skips trades with no share columns, so nothing downstream would ever revisit
a stamp it did not earn.

## What changed

`finalizeTradeForHoldingsSource` now returns
`{ trade, executionProven }`. `executionProven` is true only when the apply
reported it moved shares, and it gates both the completion stamp and the
`execution.recorded` memory event.

| Condition | execution_status | reconciliation | execution.recorded |
|---|---|---|---|
| Apply moved shares | `complete` + timestamps | `matched` | emitted |
| Apply returned `applied:false` | `not_started` | untouched (`pending`) | **not** emitted |
| Apply raised (price refused) | `not_started` + reason | untouched | **not** emitted |
| `live_feed` portfolio | `not_started` | untouched | **not** emitted |
| Evidence row failed, shares moved | `complete` + note | `matched` | emitted |

Two writes became one: the outcome picks a payload, and a single `.update()`
applies it. That also kept the repo-wide type ceiling flat at 8662 — a second
`.update()` call site would have added one more instance of this file's
pre-existing untyped-client error.

## The state machine, in columns that already exist

No migration. All four required states are expressible today:

- **A — decision recorded**: the `accepted_trades` row exists, `is_active`.
- **B — execution not yet proven**: `not_started` / `pending`. These are the
  insert defaults, and `tradeLifecyclePhase` already renders them as
  **"Queued · Waiting on trader"**.
- **C — execution completed**: `complete` / `matched` — now only on proof.
- **D — execution failed or blocked**: `not_started` / `pending` with the
  reason on `execution_note`, the column `updateExecutionStatus` already uses
  for execution commentary.

### Why there is no `'failed'` status, and no migration

B and D are distinguished only by `execution_note`. A first-class `'failed'`
value would be clearer, and was considered and rejected for this slice.

**No migration is needed, because nothing writes `'failed'`.** Verified
across the whole tree:

- `ExecutionStatus` (`src/types/trading.ts:1151`) is
  `'not_started' | 'in_progress' | 'complete' | 'cancelled'`. It does not
  include `'failed'`, so `updateExecutionStatus` — the only writer taking a
  status as an argument — cannot be called with it without a compile error.
- The only literal writes are `'not_started'` and `'complete'`, both in
  `finalizeTradeForHoldingsSource`.
- `ExecutionStatusDropdown`'s `TRANSITIONS` table offers only `in_progress`,
  `complete` and `cancelled`.
- Both `as ExecutionStatus` casts in the tree are read-side, narrowing a
  database string for display.
- No migration, trigger, RPC or edge function writes the column;
  `seed-pilot-data` writes the literal `'not_started'`.

The one thing that reads as though `'failed'` existed is a
`case 'failed': return 'missed'` arm in `useOutcomes.mapExecStatus` — dead
defensive code, left alone because removing it is unrelated to this fix.

What is enforced instead is the ordering rule, as a test
(`execution-truth.test.ts`, "execution_status values the database will
accept"): the TypeScript union must equal the production CHECK set, so
adding `'failed'` to the union fails the build and the migration cannot be
forgotten. Whenever a first-class failed state is actually wanted the
sequence is: widen the CHECK in production, then the union, then write the
value — in that order, in separate releases.

For reference, that widening would be:

```sql
ALTER TABLE accepted_trades DROP CONSTRAINT accepted_trades_execution_status_check;
ALTER TABLE accepted_trades ADD  CONSTRAINT accepted_trades_execution_status_check
  CHECK (execution_status IN ('not_started','in_progress','complete','cancelled','failed'));
```

It is not written as a migration file here. The constraint lives in
production, verified live on 2026-10-02 as
`accepted_trades_execution_status_check`, and no migration in this repo
defines it — so a migration adding `'failed'` would widen a constraint for a
value no code produces, in a branch whose remit is to stop the system making
claims it cannot support.

## Decisions this slice had to make

**Unsized acceptance is allowed.** Evidence: the Trade Lab execute path
already refuses a variant with no sizing (`execute-sim-variants-service.ts:898`,
"No sizing entered"), and the Inbox path has no such guard and never parses
the string. Rather than add a refusal at the Inbox — which would be a workflow
change, and would discard a PM decision the system simply cannot act on yet —
the accept is recorded and the execution stays honestly pending. That is state
B, and it is the foundation the later execution-staging slice needs.

**A decision does not fail for want of a price.** Price is required by the
holdings math (the position's value and the cash leg both depend on it), not
by the decision. So a refused price leaves the decision intact and the
execution pending, with the reason recorded.

**Revert now distinguishes the two realities.** `reverseTradeOnHoldings` ran
for any non-`live_feed` portfolio regardless of whether the accept had applied
anything. Reversing an accept that never executed would subtract a position
the portfolio never gained. It is now gated on
`execution_status === 'complete'`.

## Memory Spine

`execution.recorded` is gated on `executionProven`. Nothing else about the
Spine changed: the writer, its dedupe key
(`execution.recorded:<acceptedTradeId>`, so a retry still collapses to one
event) and `decision.recorded` are untouched. `decision.recorded` is emitted
from `updateDecisionRequest` / `markDRAccepted`, independent of execution, and
still fires for an accepted decision whose execution is pending.

**Cutoff: execution event semantics become reliable from this release
forward.** Historical `execution.recorded` events for trades that never
executed are left exactly as they are — not deleted, not rewritten, not
backfilled. They are a historical limitation, consistent with V1's own
decision not to backfill (of 203 reconstructable events only 57 would have
been true).

## Known gaps, not addressed here

- **`live_feed` fills emit no execution event.** Previously one was emitted
  falsely at accept time; now none is emitted at all. Nothing marks the later
  fill, because `updateExecutionStatus` — the manual trader workflow — does
  not write a memory event. There are zero `live_feed` portfolios in
  production. Wiring that belongs with the trader workflow, not here.
- **A PM can still mark a `manual_eod` trade complete by hand** via
  `updateExecutionStatus`, with no holdings movement, and revert would then
  reverse a position that never moved. Pre-existing; the dropdown is gated on
  `holdingsSource !== 'paper'`.
- **`seed-pilot-data` inserts `accepted_trades` directly**, bypassing
  `finalizeTradeForHoldingsSource` entirely, and writes `source: 'trade_lab'`
  — a value the table's CHECK constraint (`inbox|simulation|adhoc`) does not
  allow.
- **The two Outcomes surfaces disagree.** Decision Accountability derives
  execution from `portfolio_trade_events` and was already honest; the simpler
  Outcomes feed derives it from `execution_status`. Both now read correctly
  because the field they disagree about is finally truthful, but the
  duplication remains.
