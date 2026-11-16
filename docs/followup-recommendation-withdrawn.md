# Follow-up: `recommendation.withdrawn` lifecycle events

**Status:** approved, scoped, NOT implemented. Deliberately out of the Memory
Spine v1 release.
**Decided:** 2026-11-15, by the product owner.
**Scope discipline:** this is a separate change. Do not fold it into a release.

---

## The decision

> Analyst retractions should be preserved as `recommendation.withdrawn`
> lifecycle events, not `decision.recorded` PM rulings. Preserve actor,
> recommendation identity, status transition and any genuinely recorded
> rationale.

A withdrawal is an analyst retracting **their own** recommendation. It is not
a PM ruling on it. Recording it as `decision.recorded` would put a decision in
the record that nobody made, and would make "how many decisions did the PM
make" wrong in a way no reader could detect.

## Why it is a real gap and not a cosmetic one

`withdrawn` **is** in `RESOLVED_DECISION_REQUEST_STATUSES`:

```
accepted, accepted_with_modification, rejected, deferred, withdrawn
```

So the same act is handled two different ways depending on which code path a
user happens to travel:

| Path | Behaviour today |
|---|---|
| `updateDecisionRequest` (`decision-request-service.ts:250`) | status is resolved → **emits `decision.recorded`**, which is now the WRONG event per this decision |
| `TradeIdeaDetailModal.tsx` :4500, :6829, :7191 | writes `status`, `reviewed_at`, `reviewed_by` directly, bypassing the service → **emits nothing** |

One act, two paths, two answers, and **neither** is the answer the product
owner wants. That is the defect.

## Why it is not urgent

Measured read-only against production 2026-11-15:

```
withdrawn requests, total      29
withdrawn requests, in epoch    0
```

The Spine epoch is 2026-09-16 (`memory_events` migration). **Zero** withdrawals
have occurred since, so the modal path has never fired against a live Spine and
no history is missing today. Nothing needs backfilling, and the brief forbids a
backfill regardless.

This is why it was **not** pulled into the release: there is no verified
regression to prevent. The release ships without it, correctly.

## What to build

### 1. A new event type

`recommendation.withdrawn`, alongside the existing
`recommendation.submitted` / `decision.recorded` /
`decision.reverted` / `execution.recorded`.

Payload, per the decision — each of these four, no more:

| Field | Source | Note |
|---|---|---|
| actor | `reviewed_by` as written | the analyst, not a PM |
| recommendation identity | `decision_requests.id` | plus `proposal_id` where present |
| status transition | the `from` status and `withdrawn` | the `from` matters: withdrawing from `needs_discussion` is not the same act as from `pending` |
| rationale | **only if genuinely recorded** | see below |

**On rationale: do not synthesise one.** The three modal sites write no note.
Carry `decision_note` only when the user actually typed something, and omit the
field otherwise rather than writing a null or a boilerplate string. An absent
rationale is a fact; a manufactured one is a fabrication, and
`decision.recorded` already made this mistake once by nearly carrying
`'Self-proposed via Trade Lab Execute'` — a string the code wrote, not the user.

### 2. A stable dedupe key

Follow the pattern established for `decision.recorded` and **do not invent a
new format**:

```
recommendation.withdrawn:<drId>:<eventInstantToken(reviewed_at)>
```

`eventInstantToken` renders the instant as epoch milliseconds, which is what
makes the key reproducible from the canonical row in all three timestamp
spellings this stack produces (`…123Z` browser, `…123+00` Postgres,
`…123456+00:00` PostgREST). Keying on anything written by a *later* statement
is the exact defect fixed in `c8ae04e4`; do not repeat it.

No legacy key is needed: nothing has ever been written under any other shape.

### 3. Route both paths through one writer

The three `TradeIdeaDetailModal.tsx` sites must stop updating
`decision_requests` directly. Route them through `updateDecisionRequest`, and
have that function emit `recommendation.withdrawn` for `withdrawn` and
`decision.recorded` for the other four resolved statuses.

Fixing only the service would leave the modal silent; fixing only the modal
would leave two writers to keep in step. One writer, one decision about which
event a status implies.

### 4. Tests — both withdrawal paths, as the decision requires

Required cases:

1. `updateDecisionRequest(status: 'withdrawn')` emits
   **`recommendation.withdrawn`** and **not** `decision.recorded`.
2. Each modal path emits exactly one `recommendation.withdrawn`.
3. The event carries actor, decision-request id, and the `from` → `withdrawn`
   transition.
4. No rationale field when the user typed none; the rationale when they did.
5. The key is reproducible from the canonical row, in all three timestamp
   spellings.
6. A retried withdrawal lands once; two different requests land twice.
7. The four other resolved statuses still emit `decision.recorded` — the
   regression guard, so the change cannot silently reclassify PM rulings.
8. **Round-trip**: the key the writer emits equals the key a reconciler would
   rebuild from the row. This is the property that had no test before
   2026-11-15 and is the one the original defect violated.

**Non-vacuity is mandatory** (Standing Rule 3, and
`feedback_gate_must_cover_every_path`): inject into **each** path separately —
service and all three modal sites — and record which test caught which. An
injection into one path proves one path. The previous migration-compatibility
gate passed 16/16 against exactly this mistake.

## Out of scope

- No backfill. The 29 historical withdrawals stay as they are.
- No change to `RESOLVED_DECISION_REQUEST_STATUSES`. `withdrawn` remains a
  resolved status; what changes is which event a resolution implies.
- No new table, no migration. `memory_events` already holds arbitrary event
  types.
- No change to `decision.recorded` semantics for the other four statuses.

## RLS posture

Unchanged. `memory_events` already has RLS enabled with INSERT and SELECT
policies, grants `anon` nothing, and gives `authenticated` SELECT + INSERT
only. A new `event_type` value introduces no new data path, no new table and
no policy change — the row is written by the same writer, under the same
policy, with the same `organization_id` derivation. Nothing to widen.
