# Memory Spine — what Tesseract already remembers, and what it forgets

Trace and architecture only. No code changed, no migration written.
Evidence: repo at `origin/main` (`2c33c7f5`) plus read-only queries against the
live project `wfcebeagznzgeuyysbnt`, 2026-09-30.

---

## 0. The finding in one paragraph

Tesseract records **what people did** in volume and almost nothing about **what
they concluded**. Ideas, recommendations, decisions and trades all exist as
single mutable rows that are `UPDATE`d in place; there is no history table, no
version row and no history trigger on any of them. The one durable trace is an
application-level, opt-in, fire-and-forget `audit_events` row, which covers the
idea half of the workflow and has **zero rows** for recommendations, decisions
or executions. The schema for remembering *why* largely exists — and is almost
entirely unwritten.

The sharpest consequence: **the Decision Inbox renders the investment case from
a live join on `trade_queue_items`, not from the submission snapshot.** Editing
an idea's thesis today silently rewrites what a past, already-decided
recommendation appears to have said.

---

## 1. The canonical flow, as built

```
  CREATE                DEVELOP                 RECOMMEND            DECIDE              EXECUTE / OUTCOME
  trade_queue_items ──► trade_queue_items ────► trade_proposals ───► decision_requests ─► accepted_trades
  (9 paths, 3 broken)   (UPDATE in place)       (UPDATE in place)    (UPDATE in place)    portfolio_trade_events
         │                      │                      │                    │                    │
         ▼                      ▼                      ▼                    ▼                    ▼
   audit_events            audit_events           trade_events         (nothing)          (nothing)
   'create' 27%            'move_stage' 329       3 of 13 types                           decision_price_
   of ideas                'update' 9% of ideas   ever written                            snapshots (12)
```

### Where ideas come from

Nine write paths to `trade_queue_items`. Only two go through
`trade-idea-service.ts`, despite its header claiming to be "THE ONLY WAY to
mutate trade ideas".

| Path | Audit? | Initial stage | Live rows |
|---|---|---|---|
| Quick capture (`QuickTradeIdeaCapture`) | yes (`create` + `attach`) | `exploring` | majority |
| `createTradeIdea` service | yes | `exploring` | some |
| `createPairTrade` service | yes (pair + legs) | `exploring` | few |
| Counter-view promotion | yes (**twice** — double `create` event) | `exploring` | 3 |
| Trade Lab Execute (`ensureTradeQueueItem`) | **no** | **`ready_to_recommend`** | some |
| Pilot onboarding wizard | **no** | mixed | silently writes nothing (bad column) |
| `seed-pilot-data` / SQL seeders | **no** | mixed | many |
| Quick-thought promotion (single) | **no** | — | **0 — has never worked** |
| Quick-thought promotion (pair) | **no** | — | **0 — has never worked** |
| `AddPairTradeModal` | **no** | **omits `stage`** | would now fail NOT NULL |

Three creation paths are broken against the live schema. The quick-thought
promotions reference a `content` column and an `origin_id` column that do not
exist, and write `origin_type = 'quick_thought'`, which is not a member of the
live enum. Confirmed empirically: zero `quick_thoughts` rows carry
`promoted_to_trade_idea_id`. **No idea has ever entered Tesseract that way.**

Trade Lab Execute is the only path that creates an idea directly at
`ready_to_recommend`, bypassing the `missingForStage` gate — so an idea can
reach the final stage with a placeholder rationale and no thesis.

### What development records

| Action | History? | Before/after? | Provenance? |
|---|---|---|---|
| Stage change | audit event only | **yes** (the one place) | `ui_source` only |
| Thesis edit | **none** | **no** — see below | none |
| Rationale edit | none | accidentally yes | none |
| Price target / sizing / conviction / stop / take | **none** | **no** | none |
| Bull/bear/catalyst/risk argument | rows accumulate, each mutable + hard-deletable | **no** | none |
| Portfolio association | **none** | no | none |
| Model / simulation work | **none** | no | lab id only |
| Assumptions | **the concept does not exist** | — | — |

`trade_queue_items` carries exactly three triggers — `set_organization_id`,
`updated_at`, `stage_changed_at`. **No history trigger, no audit trigger.**

The `from_state` on an idea edit is hardcoded to `{rationale: …}` regardless of
which field changed, and `to_state` uses camelCase keys that do not match
column names. So this is not merely missing history, it is *misleading*
history:

```
changed_fields: ["thesis_text"]
from_state:     {"rationale": "Memory prices will only go up"}   ← wrong field
to_state:       {"thesisText": "Test"}                           ← wrong key
```

### What recommendation records

`submitRecommendation` writes `trade_proposals` (UPDATE in place on resubmit),
`decision_requests`, a `trade_events` row, and a notification. **No
`audit_events` row** — and `audit_events.entity_type` does not even permit a
proposal or decision entity, so adding one needs a migration.

`decision_requests.submission_snapshot` is populated on 70 of 113 rows. Its
keys:

```
action, symbol, company_name, portfolio_name, weight, shares,
sizing_mode, notes, proposal_type, requester_name, requester_email,
submitted_at, sizing_context
```

**It snapshots the ask, not the thinking.** No thesis, no rationale, no
conviction, no target, no evidence.

### The live-join leak

```
decision-request-service.ts  DECISION_REQUEST_SELECT
  embeds trade_queue_item:trade_queue_item_id (rationale, thesis_text, conviction, action)
      ↓ evaluated at READ time, against the current row
DecisionInbox.tsx:586-589    rationale / thesisText / conviction / action
DecisionInbox.tsx:707,:884   contextText = group.thesisText || group.rationale
```

Sizing is frozen (`snapshot?.weight ?? request.sizing_weight`). The investment
case is not. The same join feeds the resolved tabs, `useDecisionAccountability`,
Trade Book and the `decision_story_payload` RPC — so editing a thesis rewrites
the apparent reasoning of decisions already made.

### What decision records

Every decision field is `UPDATE`d in place on one `decision_requests` row.
There is no decision event, no history table and no audit trigger.

- **Accept** — `accepted_trades` row; `acceptance_note` is a genuine
  point-in-time copy, but via a fallback chain (PM note → DR context note →
  thesis → rationale → NULL) with no column saying which it was.
  `createAcceptedTrade` is called without target/delta shares or weights, so
  six sizing columns land NULL and `price_at_acceptance` is **NULL for every
  inbox accept**.
- **Accept with modification** — the status records *that* it was modified; the
  **magnitude is never stored**.
- **Reject** — the only path that writes `trade_idea_portfolios.decision_reason`.
- **Defer** — writes `deferred_until` and a `deferred_trigger` jsonb
  (`{"type":"price_level","condition":"above","price":180}`). **Nothing
  evaluates either.**
- **Revert** — resets the DR to pending and **nulls `decision_note`**,
  destroying the stated reason.
- **Trade Lab execute** — overwrites any PM note with
  `'Accepted via Trade Lab Execute'`, and may fabricate a DR that is already
  `accepted` with a NULL snapshot.

Consequence, stated plainly: **Tesseract cannot answer "why did we make this
decision?" from durable data.** It can recover the sizing submitted, who, when,
the cached price that day, and one free-text string of ambiguous provenance
that a later revert or Trade Lab execute may erase.

### What outcome records

No `outcomes` table. "Outcome" is four overlapping mutable representations
(`trade_queue_items.outcome`, `trade_idea_portfolios.decision_outcome`,
`decision_requests.status`, `decision_reviews`). Attribution partly works —
`portfolio_trade_events.linked_trade_idea_id` → price history — but breaks for
inbox accepts (no event row, no entry price), falls back to fuzzy
`portfolio:asset` matching, and cannot apportion P&L across batches.

**Price at recommendation is captured nowhere. Benchmark level at decision is
captured nowhere.**

### How work comes back

Eleven of fourteen resurfacing producers fire on a current-state predicate plus
an elapsed-time threshold against `updated_at`, at seven independently chosen
thresholds (2d, 5/10d, 7d, 7/14d, 14d, 21d, 90/135/180d). **There is no
distinction between abandoned and deliberately parked.**

Three exceptions, all recent, all already on the Memory Spine tables:
`researchChangedSinceView` (view cursor), `thesisChangedAfterCommit`
(`memory_events`), `tradeReviewOwed` (`memory_obligations`).

---

## 2. Workflow P0 / P1

**No P0.** Core workflows complete on both desktop and mobile. Mobile idea
progression is genuine — `MobilePipeline` opens the shared
`TradeIdeaDetailModal`, and every mutation and permission check is identical on
a phone, including submitting and withdrawing a recommendation.

| | Issue | Phase |
|---|---|---|
| **P1-1** | **"Snooze Idea" is a lie.** The UI promises "Hides this idea until the date you choose" and labels the field "Resurface Date"; `revisit_at` is written, audited, and **read by nothing**. The write also bumps `updated_at`, resetting the staleness clock that would otherwise have returned it. *Live: 0 rows have `revisit_at` — latent, not yet realised.* | MEMORY / RETURN |
| **P1-2** | **Deferring a recommendation archives it permanently.** `deferred_until` + `deferred_trigger` are durable and displayed, but `collectDecisionRequests` excludes `deferred` and no job re-activates on date or trigger. *Live: 0 deferred rows — latent.* | FOLLOW-UP |
| **P1-3** | **Three of five Submit Recommendation paths are silent on success *and* failure.** One applies an optimistic update then silently reverts on error — the user watches their recommendation appear and vanish with no message. | ACTION / COMPLETION |
| **P1-4** | **Engine dismissals are browser-local** (`localStorage`). Dismissing on a laptop does not dismiss on a phone; a cleared cache replays everything. Two surfaces, two stores, two retention rules, one conceptual decision. | MEMORY |
| **P1-5** | **The idea → recommendation → decision chain is invisible on mobile.** `DecisionTimeline` is mounted in `AssetTab` only; Outcomes is read-only on mobile. | RETURN |
| **P1-6** | **Dismissal is permanent even when the finding gets materially worse.** `isDismissPermanent()` returns hardcoded `true`; the warning sentence `DISMISS_RESURFACE_NOTE` exists and no component renders it. | MEMORY |

**Does any of this have to precede Memory Spine work?** No — none of it blocks
schema work, and P1-1/P1-2 are latent (zero affected rows today). But P1-1 and
P1-2 are *exactly* the semantics the Spine needs (a durable, honoured "I parked
this until X"), so fixing them is naturally the same slice as giving
obligations a producer. Do them together, not before.

---

## 3. Memory inventory — current state vs historical fact

| Object | Represents | Mutable | Historical | Actor | Time | Provenance | Rows | Spine use |
|---|---|---|---|---|---|---|---|---|
| `trade_queue_items` | the idea, now | **yes** | no | `created_by` | `created_at`/`updated_at` | `origin_*` (good) | 235 | subject |
| `trade_idea_theses` | bull/bear/catalyst/risk | **yes**, hard-deletable | no | `created_by` | both | no | 19 | subject |
| `trade_idea_portfolios` | per-portfolio decision track | **yes** | no | none | both | no | 37 | subject |
| `trade_proposals` | the recommendation | **yes** | no | `user_id` | both | no | 54 | subject |
| `trade_proposal_versions` | proposal history | — | **yes** | `created_by` | `created_at` | `trigger_event` | **0** (exists; writer unreachable) | **high** |
| `decision_requests` | the ask + the decision | **yes** | partial¹ | `requested_by`/`reviewed_by` | both | `submission_snapshot` | 113 | subject |
| `accepted_trades` | the commitment | **yes** | no | `accepted_by` | both | `acceptance_note` | 53 | subject |
| `decision_price_snapshots` | price at outcome | upsert | **yes** | `created_by` | `snapshot_at` | `price_source` | 12 | **high** |
| `decision_reviews` | retrospective verdict | **yes** (upsert) | no | `reviewed_by` | both | no | 7 | source |
| `trade_event_rationales` | structured "why" | yes (v1 only) | **designed yes** | `authored_by` | both | `linked_object_refs` | **0** | **high** |
| `trade_events` | idea-scoped log | **append-only** | **yes** | `actor_id` | `created_at` | `metadata` | 100 (3 of 13 types) | precedent |
| `audit_events` | field mutation | **append-only** | **yes** | `actor_id` | bitemporal | `metadata` | 3,012² | **backfill source** |
| `portfolio_trade_events` | holdings movement | yes | **yes** | — | both | `linked_trade_idea_id` | 54 | **high** |
| `asset_field_history` | asset field before/after | append | **yes** | `changed_by` | `changed_at` | — | 1,066 | source |
| `note_versions` | note history | append | **yes** | `created_by` | `created_at` | `version_reason` | 121 | source |
| `attention_user_state` | snooze / dismiss / view cursor | yes | no | per-user | both | reason | 5 | source |
| **`memory_events`** | **the spine** | **append-only enforced** | **yes** | `actor_id` | **bitemporal** | **pointers + `dedupe_key`** | **3** | **the spine** |
| **`memory_obligations`** | **"waiting for X"** | RPC-only | raise/clear evented | `owner_id`/`cleared_by` | `raised_at`/`due_at`/`cleared_at` | yes | **0** | **the spine** |

¹ resolved DRs accumulate as new rows; an *active* DR is updated in place.
² 2,233 of which (74%) are Trade Lab variant create/delete noise; **0** concern
decisions, recommendations or executions.

---

## 4. History already preserved vs already lost

**Preserved and trustworthy**

- Stage transitions — 329 `move_stage` rows, all with `from_state`, `to_state`
  and actor. The single best history in the product.
- Idea birth — `created_at`, `created_by`, and a genuinely good provenance
  triple (`origin_type`, `origin_entity_type`, `origin_entity_id`,
  `origin_metadata`).
- Outcome transitions — 22 `set_outcome` rows including the revert clear.
- Asset research field edits — 1,066 before/after rows, trigger-backed.
- Note content — 121 versions.
- Holdings movement — 54 `portfolio_trade_events` with before/after quantities,
  market values and weights.

**Lost permanently, every time**

- Any previous thesis, rationale, conviction, price target, sizing, stop, take
  or horizon on an idea. Overwritten with no trace.
- Any edited or deleted bull/bear/catalyst/risk argument — a removed bear case
  is irrecoverable.
- The reasoning attached to a recommendation (never captured at all).
- A decision note erased by revert or overwritten by Trade Lab execute.
- The magnitude of an `accepted_with_modification`.
- Price at recommendation; benchmark level at decision.
- Why anyone stopped working on anything.

---

## 5. Derived vs must-capture

**Derive — do not duplicate.** Current stage, current weight, current price,
current holdings, current assignee, linked-research counts, days-since-X, any
staleness threshold. All are a query away, and copying them into the Spine is
precisely the failure the existing migration warns against.

**Capture or lose forever.**

1. The thesis text *as it stood* when a recommendation was submitted.
2. The reason a decision was made, as a structured field rather than a
   fallback-chain string.
3. The assumptions a decision rested on.
4. The size actually asked for vs the size granted (the delta, not the label).
5. Price and benchmark level at recommendation and at decision.
6. What a person was waiting for when they stopped.
7. The before-value of any belief field at the moment it changed.
8. What evidence prompted a change.

---

## 6. Memory Spine Lite — it already exists; wire it

`supabase/migrations/20260916180000_memory_spine_foundation.sql` is applied and
correct. **Do not design a new one.**

```
memory_events
  id · organization_id · actor_id
  event_type · subject_type · subject_id · related jsonb
  source_type · source_id · source_field      ← pointers, not copies
  provenance (free text, e.g. 'ui:outcomes')
  occurred_at · recorded_at                   ← bitemporal
  payload jsonb · dedupe_key                  ← idempotent backfill
```

Verified live: RLS on, **zero UPDATE policies, zero DELETE policies**, grants
narrowed. Append-only is enforced by the database, not by convention.

Its own stated rule is the right one and should be preserved verbatim:

> The Spine CONNECTS existing truth; it does not duplicate and compete with it.
> If a question can be answered by reading only `memory_events`, the Spine has
> taken over something that belongs elsewhere.

**Why `memory_events` and not `trade_events`** (the other append-only
candidate): `trade_events` is idea-scoped only, is **not org-scoped**, has no
provenance pointers, no bitemporality and no dedupe key. It is a useful
precedent — an abandoned 30%-wired event log — not the spine.

**What must change:** the `event_type` CHECK admits five values
(`thesis.reviewed`, `decision.reviewed`, `obligation.raised`,
`obligation.cleared`, `rationale.captured`). Extending the vocabulary is a
one-line migration. Note `rationale.captured` already exists in the constraint
**and has no writer** — a slot deliberately left open.

---

## 7. Minimum event vocabulary

Derived from actions that exist today, not from ontology. Thirteen types.

| Event | Source action | Already has history? | New event needed? | Backfillable |
|---|---|---|---|---|
| `idea.created` | 9 creation paths | row columns only | yes | **235** |
| `idea.stage_changed` | `moveTradeIdea` | `audit_events` | yes (normalise) | **329** |
| `idea.belief_changed` | thesis/conviction/target/sizing edit | **no** | **yes — the critical one** | 0 |
| `research.linked` | `object_links` on an idea | row only | yes | 12 |
| `recommendation.submitted` | `submitRecommendation` | `trade_events` partial | yes | **113** |
| `recommendation.withdrawn` | modal withdraw ×3 | `trade_events` | yes | 10 |
| `decision.recorded` | accept / modify / reject / defer | **no** | **yes** | **75** |
| `decision.reverted` | `revertAcceptedTrade` | `audit_events` partial | yes | 4 |
| `trade.executed` | `createAcceptedTrade` | row only | yes | **49** |
| `portfolio.position_changed` | `portfolio_trade_events` | **yes** | reference only | 54 |
| `outcome.recorded` | `moveTradeIdea` outcome | `audit_events` | yes | **22** |
| `decision.reviewed` | `useDecisionReview` | **already wired** | — | 7 |
| `obligation.raised` / `.cleared` | `memory_obligations` RPCs | **already wired** | — | 0 |

**~900 events are backfillable today** from durable rows, with no new capture.
That is an entity timeline on day one.

Deliberately **excluded**: `work.snoozed` and `work.resurfaced` until P1-1/P1-2
are fixed (the underlying state is written but never honoured — recording it
would memorialise a lie); `assumption.*` until the object exists;
`portfolio.weight_changed` (derivable); anything AI-generated.

---

## 8. The three magic candidates — what each actually requires

### 1. Forgotten work + what happened since
> "You stopped researching CRWD 47 days ago while waiting for NRR evidence.
> Today's filing contains the metric you were waiting for."

Needs: (a) a durable record that work *stopped* — distinguishable from neglect;
(b) what was being waited for, as structured data; (c) a timestamp to measure
"since"; (d) evidence arrival that can be matched to (b).

**Status: closest to possible.** `memory_obligations` is the right shape and
has zero rows. (a) and (b) need a producer plus an honest snooze (P1-1).
(d) needs evidence arrival to be evented. **No new table.**

### 2. Reason-for-decision changed
> "One reason you increased AAPL no longer holds. Services growth was expected
> >14%; latest result is 11.2%."

Needs a decision to have recorded, at decision time, a **list of discrete
reasons**, each with an optional **measurable claim** (metric, comparator,
threshold). Then "no longer holds" is a comparison, not an inference.

**Status: blocked.** Decisions capture one ambiguous free-text string.
`trade_event_rationales` is the designed home — `reason_for_action`, `why_now`,
`what_changed`, `thesis_context`, `catalyst_trigger`, `sizing_logic`,
`risk_context`, `divergence_from_plan`, `linked_object_refs`, versioned — and
holds **0 rows**. It is prose, not claims, so a measurable threshold needs one
new structure.

**Where AI may and may not act:** an LLM may *propose* "this sentence contains
the claim: services growth > 14%" and may *explain* a divergence in prose. It
must never decide that a reason existed, nor that it has been invalidated. The
claim is confirmed by a human at capture; the comparison is arithmetic.

### 3. Thesis / reality divergence
> "Your thesis assumed gross margin >75%. Management now guides ~73%."

Needs a first-class **assumption**: subject, metric, comparator, value, who
asserted it, when, current status, and what would falsify it.

**Status: blocked hardest.** No assumption concept exists anywhere — confirmed
by grep across `src/` and all migrations. The nearest analogue,
`trade_idea_theses.direction='context'`, is free text with no truth value and
no review state. And because thesis text is unversioned, there is no record of
what was assumed at any past moment even in prose.

**Human vs AI:** a human must *establish* an assumption (it is a commitment).
AI may suggest candidates from thesis prose, and may match incoming data to an
existing assumption. AI must not create, invalidate or silently revise one.

---

## 9. Missing product semantics, ranked

**HIGH — required for the first three candidates**

1. **Recommendation snapshots the thinking.** Extend `submission_snapshot` (or
   write a `recommendation.submitted` event payload) with thesis, conviction,
   target and evidence refs at submit time. Removes the live-join leak.
2. **Structured decision reasons.** Give `trade_event_rationales` a producer,
   or carry reasons in the `decision.recorded` payload. One free-text field is
   not a reason.
3. **First-class assumption object.** Subject, metric, comparator, value,
   asserted_by, asserted_at, status, falsifier.
4. **Durable, honoured "waiting for X".** A producer for `memory_obligations`,
   plus fixing P1-1/P1-2 so a parked thing actually returns.
5. **Belief-change events with real before/after.** Today's `from_state` is
   hardcoded to `rationale` and is actively wrong.

**MEDIUM — useful soon**

6. Price and benchmark at recommendation and decision (`price_at_acceptance` is
   NULL for every inbox accept; benchmark level is captured nowhere).
7. Modification magnitude on `accepted_with_modification`.
8. Evidence → belief provenance: which note or filing caused a change.
9. Revert must not destroy `decision_note`.
10. One resurfacing vocabulary (five stores exist today).
11. View cursors beyond the two desktop surfaces.

**LOW — later sophistication**

12. Versioned thesis documents.
13. Per-argument lifecycle on `trade_idea_theses`.
14. Cross-idea thematic memory.
15. Team-level belief aggregation.

---

## 10. Implementation slices

Each is independently testable, locally committable, and useful alone.

**Slice 1 — backfill the spine from what already exists.**
Widen the `event_type` CHECK; write an idempotent backfill (keyed on
`dedupe_key`) producing ~900 events from `audit_events`, `trade_queue_items`,
`decision_requests`, `accepted_trades`, `portfolio_trade_events`,
`decision_price_snapshots`. No product code touched. Proves the schema against
real history and gives an immediate timeline.
*Test: event counts per type match the source queries; re-running changes nothing.*

**Slice 2 — canonical writers at the moments that have none.**
Emit `recommendation.submitted`, `decision.recorded`, `trade.executed`,
`decision.reverted` at their existing service call sites. These are the four
moments with zero audit coverage today.
*Test: each service path writes exactly one event; a revert does not erase.*

**Slice 3 — snapshot the thinking at submission.**
Extend the submission payload with thesis, conviction, target and evidence
refs. Switch the Decision Inbox's context text to read the snapshot, falling
back to the live join only when absent. **Closes the live-join leak.**
*Test: edit a thesis after submitting; the pending and resolved cards do not change.*

**Slice 4 — obligations get a producer, and snooze stops lying.**
Raise an obligation when a user parks work with a reason; honour `revisit_at`
and `decision_requests.deferred_until`/`deferred_trigger`. Delivers **candidate
1** end to end.
*Test: a parked idea returns on its date with its reason attached.*

**Slice 5 — entity timeline query.**
One RPC: everything known about a subject, chronologically, org-scoped,
RLS-respecting, with pointers resolved. The read side the first feed candidate
needs.
*Test: a known idea's timeline matches hand-assembled truth.*

**Slice 6 — structured reasons, then assumptions.**
Reasons on `decision.recorded` (candidate 2), then the assumption object
(candidate 3). Last, because both are new product semantics rather than wiring,
and both should be designed against a working timeline.

**Sequence rationale:** 1–2 make history real, 3 stops ongoing loss, 4 delivers
a candidate, 5 makes it queryable, 6 adds genuinely new semantics. Slices 1–3
write no new product concept at all.

---

## 11. Corrections to assumptions worth recording

- `trade_proposal_versions` **does exist** in the live database (0 rows) despite
  no migration creating it. Live-DB drift; its only writer is unreachable code.
- `attention_user_state` likewise exists live (12 columns) with **no DDL in the
  repo**.
- `trade_queue_items.status = 'deciding'` still occurs on **15 live rows**, so
  the "Ready for Decision" banner gated on it is *not* dead.
- `process_all_expired_price_targets` is genuinely never scheduled — `pg_cron`
  is installed with five jobs and none is this one. Price-target expiry
  notifications do not fire.
- `revisit_at` and `decision_requests.status='deferred'` each have **0 live
  rows**, so P1-1 and P1-2 are latent defects, not active data loss — they will
  bite the first user who trusts the UI.
