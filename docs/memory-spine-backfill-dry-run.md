# Memory Spine — historical backfill dry run

**No backfill was run. Nothing was written. Every figure below is from
read-only queries against production on 2026-09-30.**

This exists to answer one question before anyone writes 203 rows into an
append-only table: *if we reconstructed the past from the canonical rows we
still have, how much of it would be true?*

---

## The short answer

**Do not backfill `recommendation.submitted` or `decision.recorded` as they
stand.** Executions and reverts are reconstructable faithfully; the other two
are not, and a backfill is the one kind of write that cannot be taken back.

| Event | Rows it would create | Verdict |
|---|---:|---|
| `execution.recorded` | 53 | Safe — every field is durably recorded |
| `decision.reverted` | 4 | Safe with one caveat (3 missing actors) |
| `decision.recorded` | 83 | **Unsafe** — 9 have no actor, 8 no timestamp |
| `recommendation.submitted` | 63 | **Unsafe** — 28 rows' earlier submissions are gone |
| **Total** | **203** | |

For scale: `memory_events` currently holds **3** rows.

---

## Why executions and reverts are safe

`accepted_trades` never loses the facts these events assert. All 53 rows have
`accepted_by`; all have `created_at`; all 53 resolve to an organisation
through their portfolio. There is no judgement call to make — the row says who
committed the trade and when, and the event would say exactly that.

The 4 reverts are nearly as clean: all 4 have `revert_reason` populated, which
is why `decision.reverted` points at that column with `source_field` instead
of copying it.

**Caveat:** 3 of the 4 reverted trades have no `reverted_by`. Those predate
the column being populated. A backfill must leave their actor null rather than
attributing the revert to whoever runs the script.

## Why decisions are not safe

**9 of 83 resolved requests have no `reviewed_by`.** There is no record of who
decided. A `decision.recorded` event's entire value is that it names an actor;
one that names the backfill operator is worse than no event, because it looks
like evidence.

**8 of 83 have no `reviewed_at`.** `occurred_at` would have to fall back to
`updated_at`, which is the time of the last edit of any kind — not the time of
the decision. For a bitemporal store this is the worst available error: it
would place decisions on the timeline at times they did not happen, and
`occurred_at` is what every reader orders by.

**And `decision_requests` is mutated in place.** A request that was accepted,
reverted, and accepted again holds only its current status. The backfill would
emit one event per request and record the *last* decision as the *only*
decision. The 4 reverted trades are direct evidence that this sequence has
occurred in production: those requests were reset to `pending` and in some
cases re-decided, and the intermediate states are gone.

## Why recommendations are not safe

**28 of 113 requests were edited after creation.** `ensureDecisionRequestForProposal`
updates an active request in place, so each of those 28 rows holds only the
final sizing. Every earlier submission — the thing a
`recommendation.submitted` event is supposed to capture — has been overwritten.

A backfill would emit one event per request carrying today's sizing, stamped
with `created_at`, asserting that the analyst submitted that number at that
time. For 28 rows that would be false. It would also silently compress a
history of revisions into a single clean submission, which is precisely the
story a PM would most want to see and precisely the one we cannot tell.

3 further rows have a proposal but no sizing at all, so their dedupe key would
degrade to `no-mode:no-weight:no-shares` — distinct rows colliding on one key.

## Dedupe keys hold under a backfill

This is the part that works, and it was designed for. Every key is derived
from canonical rows that still exist, not from a clock:

```
execution.recorded:<accepted_trade_id>
decision.reverted:<accepted_trade_id>
decision.recorded:<dr_id>:<status>:<accepted_trade_id|no-trade>
recommendation.submitted:<dr_id>:<proposal_id>:<mode>:<weight>:<shares>
```

So a backfill cannot duplicate an event the live writers have already
recorded, and a backfill that fails halfway can be re-run. It also means a
live event lost to a transient failure is recoverable later by the same
mechanism — the gap documented in `lifecycle-events.ts` is not permanent.

---

## Recommendation

1. **Backfill `execution.recorded` (53) and `decision.reverted` (4)** when
   someone wants history, leaving `reverted_by` null where it is null. 57 rows,
   all true.
2. **Do not backfill the other 146** until the question is reframed. The
   honest version is not "reconstruct what happened" but "record what the
   canonical rows still assert, and mark it as reconstructed" — which needs a
   provenance value (`backfill:2026-09-30`) that distinguishes an inferred
   event from an observed one, and a reader that treats the two differently.
3. **RLS blocks a client-side backfill regardless.** The insert policy requires
   `actor_id = auth.uid()`, so every row would be attributed to whoever ran it.
   Any backfill must run service-role, server-side, which is a separate
   decision from whether to run one at all.
