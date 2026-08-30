# Decision memory and cross-device state — audit and architecture

**Status:** audit only. Nothing in this pass changes behaviour.
**Branch:** `audit/decision-memory` (worktree `C:\dev\tesseract-decision-memory`)
**Date:** 2026-08-28
**Parallel lanes not touched:** `feat/desktop-ideas-redesign`, `feat/readthrough-intelligence`

---

## 0. The finding in one paragraph

Tesseract already has three durable, per-user, cross-device disposition systems in
production — `attention_user_state`, `asset_followup_suppressions`,
`rating_ev_suppressions` — and a durable, immutable judgment record in
`audit_events` that the signal feed already writes to. The signal feed then
ignores all four and reconstructs "what has this person decided" from
`localStorage`. The gap is not missing infrastructure. It is a missing **read
path**, plus one narrow write gap for the card types the `audit_events`
`entity_type` CHECK cannot represent. The smallest correct V1 is a per-user
current-state projection table plus a query hook, not a new subsystem.

---

## 1. Current decision / disposition state map

### 1.1 The signal feed (mobile + `MobileDashboard`)

| Action | Written by | Authoritative store | Local? | DB? | What the feed reads | Survives logout | Cross-device | Org-scoped | Audit trail |
|---|---|---|---|---|---|---|---|---|---|
| **Snooze** (overflow menu) | `feed-triage.recordTriage` | `localStorage` | yes | no | localStorage | yes (same browser) | **no** | no | no *(deliberate)* |
| **Dismiss** (overflow menu) | `feed-triage.recordTriage` | `localStorage` | yes | no | localStorage | yes (same browser) | **no** | no | no *(deliberate)* |
| **Verdict / judgment** (VerdictBar) | `judgment-log.recordSignalJudgment` | **split** | yes | partial | **localStorage only** | yes | **no** | audit row: yes / local: no | yes, asset cards only |
| **Feed feedback** ("Not useful", "Wrong person") | `MobileDashboard.applyFeedback` | `localStorage` + `pilot_telemetry_events` | yes | telemetry only | localStorage | yes | **no** | telemetry: yes | no |
| **Judgment note** | `judgment-thought.writeJudgmentThought` | `quick_thoughts` | no | yes | n/a (not a feed input) | yes | yes | yes (trigger-stamped) | n/a |
| **Attention ack / snooze** (attention cards only) | `useAttention.acknowledge` / `snoozeFor` | `attention_user_state` | no | yes | attention pipeline | yes | **yes** | no (user-only) | yes, via RPC |
| **Seen / rotation** | `feed-rotation.markSeen` | `localStorage` | yes | no | localStorage | yes | no | no | no |
| **Interest vector** | `feed-telemetry` | `localStorage` | yes | no | localStorage | yes | no | no | no |
| **Mid-feed resume** | `feed-session` | `sessionStorage` | yes | no | sessionStorage | no | no | no | no |
| **Suppression log** (data quality) | `suppression.logSuppression` | `localStorage` | yes | no | ops view only | yes | no | no | no |

The read path for every feed suppression decision is a single line:

```ts
// MobileDashboard.tsx:1308
const d = dispositions[`${type}:${entityId}`]
```

`dispositions` is `loadDispositions(userId)` — a `localStorage` map, snapshotted
once per mount (`MobileDashboard.tsx:293-294`). Ranking then applies
`judgment-policy.acknowledgmentFor` (`feed-priority.ts:402`). **There is exactly
one gate and it is fed entirely from the browser.**

### 1.2 Other surfaces (desktop)

| Surface | Mechanism | Store | Cross-device | Notes |
|---|---|---|---|---|
| Dashboard / Asset / Portfolio intel dismiss | `engine/decisionEngine/dismissals.ts` | `localStorage` `tesseract.dismissedIntelItems.<userId>` | no | **Permanent** — no TTL, no expiry, no way back |
| Attention feed snooze | `lib/attention-feed/snooze.ts` | `localStorage` `tesseract.attentionFeedSnooze` | no | **No user key at all** — two users on one browser share snoozes |
| Attention items ack/snooze/dismiss | `useAttention` → RPCs | `attention_user_state` | **yes** | Fully durable, already correct |
| Asset action loop follow-ups | `useActionLoopItems` / `useActionLoopCards` / `useActionLoopFollowups` | `asset_followup_suppressions` | **yes** | Per-user, per-asset, per-type, `suppressed_until` |
| Rating/EV divergence | `useRatingDivergence` | `rating_ev_suppressions` | **yes** | Same shape |
| Decision inbox watermark | `DecisionInboxPanel` | `localStorage` | no | Read-watermark only |
| Band collapse / density / theme | various | `localStorage` | no | Correctly local — presentation, not decision |

### 1.3 What is already durable and already correct

**Shared workflow resolution is already cross-device and needs nothing built.**
The feed recomputes eligibility from live data on every load — `judgment-policy`'s
header states this explicitly: *"eligibility is recomputed from live data every
time the feed is built, so a name whose cases were updated stops producing a card
on its own. Judgment state can only ever suppress a card that the data still says
is real — it can never keep one alive."*

That is the correct design and this audit does not propose changing it. When a PM
resolves a decision request, updates a target, or reassigns coverage, the card
stops being generated for everyone, on every device, immediately. **No disposition
record is or should be involved.**

---

## 2. Duplicated state findings

### 2.1 The headline: durable judgment rows exist and nothing reads them back

`recordSignalJudgment` (`judgment-log.ts:107`) writes a complete, queryable,
immutable record to `audit_events` for every asset-entity card:

```
entity_type='asset', entity_id=<asset uuid>, action_type='record_judgment'
metadata.judgment_key, judgment_label, judgment_question, judgment_intent,
         feed_disposition, signal_type, card_surface, suppressed_until
```

That is **every field the feed's read path needs** — `signal_type` + `entity_id`
is `dispositionKey`, `judgment_key` is `Disposition.key`, `occurred_at` is
`Disposition.at`. The suppression decision could be reconstructed today for asset
cards with one query. It is not. The local map is read instead, and the audit row
is write-only.

**What prevents `audit_events` alone from becoming the source of truth:**

1. **Entity-type CHECK.** `valid_entity_type` admits `asset` but not `market` or
   `project`. Cards with `entity.kind` of `market` (3 builders) or `project`
   (2 builders, including every attention card without a linked asset) write **no
   durable row at all** — `recordSignalJudgment` returns `durable: 'skipped'`.
2. **UUID requirement.** `entity_id` is `uuid NOT NULL`; a market card's id is a
   ticker string. Same outcome.
3. **Key mismatch on desk cards.** `dispositionEntityFor` keys a post's
   disposition on `card.id` (`idea:<type>:<id>`), while the audit row names
   `card.entity` (the asset). The suppression key is therefore **absent from the
   durable row** and cannot be reconstructed. This is right for the audit's
   purposes and fatal for event-sourcing the feed.
4. **Triage writes no row on purpose.** `feed-triage`'s header is explicit that
   snooze/dismiss must not enter the research record: *"'Not now' is not a
   decision about the investment — it is a statement about a screen — and filing
   it in the research record would put housekeeping in the audit trail."* This is
   correct and should be preserved. It also means `audit_events` can never be the
   complete disposition store.
5. **Feed-feedback dismissals write to `pilot_telemetry_events`,** not
   `audit_events` (`feed-feedback-log.ts`), while the suppression they cause is
   local-only.
6. **Read shape.** Reconstructing current state from an append-only log means
   "latest row per `(actor, signal_type, entity)`" — a `DISTINCT ON`, which
   PostgREST cannot express. It needs a view or RPC, and the fold grows without
   bound because an audit log under ADR 0001 can never expire rows.

### 2.2 Live divergence: attention cards write both stores, with different windows

`MobileDashboard.tsx:3115-3119` — answering an attention card runs `applyVerdict`
(local disposition) **and** an attention RPC:

```ts
if (o.disposition === 'settled')  acknowledge(a.attention_id)          // durable
if (o.disposition === 'rejected') snoozeFor(a.attention_id, 24 * 7)    // durable, 7d
```

The two stores then disagree about how long the answer lasts:

| Tap | Local `judgment-policy` window | Durable attention state | Divergence |
|---|---|---|---|
| `not_mine` | 180 days quiet | `snoozeFor` 7 days | **173 days** |
| `defer` | 3 days quiet | `acknowledge` (clears the queue) | feed re-asks on day 4; queue never does |
| `done` / `answered` | 30 days, `resolves: true` | `acknowledge` | feed treats a workflow ack as resolution |
| `in_progress` | 7 days, not suppressed | *(nothing written)* | durable side never learns |

This is two rules over one surface disagreeing about how long an answer lasts —
precisely the failure mode `feed-triage`'s header says must not exist, now
existing across the local/durable boundary instead of within the local one.

### 2.3 A present bug: attention cards collide on the asset key

`dispositionEntityFor` special-cases only `surface === 'desk'`. Attention cards
carry `surface: 'workflow'` and, when an asset is linked,
`entity: { kind: 'asset', id: asset.id }`. So the disposition is keyed
`awaiting_review:<assetId>` — **answering one pending decision about AAPL
suppresses every `awaiting_review` card about AAPL for that user for 30 days.**
This is the same defect the desk special-case was written to fix, in a family it
does not cover. The correctly-unique key already exists on the card
(`attention:<attention_id>`, `legacy-kinds.ts:1103`) and is discarded.

*(Flagged for the owning lane. Not fixed in this pass.)*

### 2.4 Three durable suppression tables with three shapes

| Table | Key | Window | Reason captured |
|---|---|---|---|
| `attention_user_state` | `(user_id, attention_id)` hash | `snoozed_until` + `dismissed_at` | via `dismiss_attention_with_reason` |
| `asset_followup_suppressions` | `(user_id, asset_id, followup_type, view_user_id)` | `suppressed_until` (fixed 24h) | none |
| `rating_ev_suppressions` | same family | `suppressed_until` | none |

Each was built for one surface. None is org-stamped. A fourth in the same family
is the cheap move; a fifth incompatible one is not.

`attention_user_state` is the closest existing analogue and worth studying before
designing anything: its `attention_id` is
`SHA256(source_type:source_id:attention_type:reason_code)[:32]` — a deterministic
content-addressed key for items that have no row of their own. That is exactly the
problem `dispositionKey(type, entityId)` solves for signal cards, already solved
durably, one layer over.

### 2.5 Two local stores that are outright defective

- `lib/attention-feed/snooze.ts` — **no user key**. `tesseract.attentionFeedSnooze`
  is global to the browser. A shared machine, a kiosk, or a demo account and a
  real account on one laptop all bleed snoozes across users.
- `engine/decisionEngine/dismissals.ts` — **no expiry**. A dismissal is permanent
  and irreversible from the UI (`resetDismissals` is exported and never called).
  ADR 0001 calls a dismissal "a decision that something did not warrant action,
  which is as much a record as acting on it" — and it is stored where a cache
  clear destroys it.

### 2.6 ADR 0001 conflict

ADR 0001 names *"resolved signals — a dismissed card is a decision that something
did not warrant action"* as part of the decision record, which is append-only and
never deleted. Today that record is a `localStorage` map capped at 400 entries,
trimmed by recency, dropped on read once `until` passes, and destroyed by a cache
clear. The audit trail satisfies the ADR for asset-card *judgments*; nothing
satisfies it for triage, feedback dismissals, or non-asset cards.

---

## 3. The canonical decision-state model

### 3.1 Three concepts, currently conflated into one `DispositionKind`

| Concept | Question it answers | Scope | Lifetime | Store |
|---|---|---|---|---|
| **A. Attention state** | "Should this be on *my* screen right now?" | user × item | bounded, expires | projection table |
| **B. Investment judgment** | "What did this person conclude about this position?" | user-authored, org-visible | permanent | `audit_events` (+ `quick_thoughts`) |
| **C. Workflow resolution** | "Is the underlying thing done?" | org / team | until the object changes | the source object itself |

The codebase already draws A/B correctly in prose (`dispositions.ts`,
`judgment-policy.ts` and `feed-triage.ts` all argue it at length) and then stores
A and B in the same `localStorage` record under a shared `kind` field. C is
correctly derived and must stay that way.

### 3.2 The states a card can be in

Not `hidden: boolean`. Six distinguishable states, all already implied by existing
code:

```
active          — no record, or the quiet has run out
snoozed_until   — bounded; the reader deferred, and made no claim about the finding
dismissed_until — bounded and longer; the reader does not want it, and still made no claim
acknowledged    — the reader answered; the issue is explicitly still open
                  (action_needed / needs_review). Suppressed for the quiet window,
                  penalised after it.
resolved        — the answer closed the question this signal asks
                  (judgment-policy.resolves, narrowed by RESOLUTION_SCOPE)
rejected        — the card should not have been raised for this name (feed quality)
```

`needs_followup` is deliberately **not** a state here — see §9. "Judgment recorded"
is not a state either; it is the *cause* of `acknowledged` / `resolved`, and its
record lives in B.

`judgment-policy`'s `POLICY` table already produces exactly this from a semantic
key, via `(category, resolves, quietDays, penalty)`. **No new vocabulary is
needed.** The canonical record is:

```
(user_id, org_id, signal_type, subject_key)   -- identity
judgment_key                                   -- the semantic answer; policy derives the rest
kind                                           -- legacy compat; feed mechanism only
intent           'judgment' | 'feed_quality' | 'triage'
question, label, card_type, schema_version     -- interpretability
decided_at, quiet_until
audit_event_id                                 -- nullable link to the durable judgment
```

`subject_key`, not `entity_id`, because the thing a disposition is *about* is
already not always the entity (`dispositionEntityFor`). Naming it honestly makes
the desk-post rule and the attention-card fix (§2.3) expressible instead of
accidental.

### 3.3 Event-sourced, current-state, or hybrid?

**Recommendation: hybrid — a current-state projection plus the existing audit trail.**

- Not **pure event-sourcing from `audit_events`**: blocked by all six items in
  §2.1, needs a `DISTINCT ON` view, grows unboundedly, and would force
  housekeeping into the research record.
- Not **separate event types per action**: snooze, dismiss, judgment and
  resolution do not need four tables. They need one row whose `judgment_key` and
  `intent` distinguish them, because `judgment-policy` already classifies all of
  them from a single key.
- Not **current-state only**: that loses history and breaks ADR 0001.

The hybrid yields a property worth stating plainly: **the presence of an
`audit_events` row is the boundary between attention management and investment
judgment.** Triage writes the projection and no audit row. A verdict writes both.
Anyone reading the research record back sees only judgments; anyone reading the
feed sees both. The separation is enforced by the schema rather than by
discipline.

---

## 4. User vs org semantics

### 4.1 The rules

| Situation | Who stops seeing it | Where it is written |
|---|---|---|
| Analyst A dismisses a card | **A only.** B still sees it. | projection row, `user_id = A` |
| Analyst A snoozes | A only | projection row |
| Analyst A records "thesis intact" | A only stops being asked | projection (A) + `audit_events` (org-visible) |
| Analyst A says "not my coverage" | A only. The gap is real; it belongs to someone else. | projection. `no_longer_covered` is already `resolves: false` — correct. |
| PM resolves a team workflow | **everyone**, immediately | the **source object** (`decision_requests`, `project_deliverables`, `trade_queue_items`) — never a disposition |
| PM sets a target / updates cases | everyone | the source object; the card stops being generated |

### 4.2 The one place the boundary is currently crossed

`judgment-policy.RESOLUTION_SCOPE` and `resolves: true` on `answered` / `done`
(§2.2) let a **personal** record claim a **shared** resolution. `not_price_driven`
and `legacy_position` are defensible — they resolve *that signal for that reader*,
and `RESOLUTION_SCOPE` already narrows them. `answered` / `done` on an attention
card are not: they describe a workflow item other people are also waiting on.

**Rule to adopt:** a resolution other users should observe must mutate the shared
object. The disposition row may record that this user *believes* it resolved, and
the feed may suppress for that user, but it must never be the only place the
resolution exists. Today `acknowledge(a.attention_id)` is doing that shared write —
but only for attention cards, only on mobile, and only for `settled`.

### 4.3 Org scoping

Attention state is **user-specific, not org-shared**, but it must still be
**org-stamped**, for three reasons this codebase already knows:

- `erase_user_personal_data` enumerates tables by user column and needs this one
  listed, alongside `attention_user_state` and `asset_followup_suppressions`.
- The same user belongs to multiple pilot orgs, and a disposition made in one must
  not suppress a card in another. `useDerivedInsights` already scopes every query
  by `currentOrgId` for exactly this reason.
- Measurement is per organisation; an ungrouped count is wrong.

Stamp `org_id` via a `BEFORE INSERT` trigger from `users.current_organization_id`,
following `quick_thoughts` — `judgment-thought.ts` states why the client must not
pass it: *"passing it here would be a second source of truth for tenancy."*

---

## 5. Cross-device model

### 5.1 Read path

One React Query key, one query, one round trip:

```
['feed-dispositions', userId, orgId]
  → select * from feed_dispositions
    where user_id = auth.uid() and org_id = <current> and quiet_until > now()
  staleTime: 60_000
```

Bounded by construction: `quiet_until > now()` plus the existing 400-record
discipline. The result is shaped into the *same* `DispositionMap`
`MobileDashboard` already consumes, so `rankInputFor` and `judgmentFor` need no
change — this is a change of **source**, not of shape.

The existing snapshot-once-per-mount behaviour (`MobileDashboard.tsx:293`) stays.
Its reasoning — *"a disposition applied mid-scroll would delete the card under the
reader's thumb"* — is unaffected by where the data comes from.

### 5.2 Write path

Optimistic, non-blocking, honestly reported:

1. Write `localStorage` first, synchronously. `recordDisposition` already returns
   a boolean and callers already surface it. **This does not change.**
2. `queryClient.setQueryData` for the disposition key, so the card leaves the feed
   at the same moment it does today.
3. Fire the upsert. On success, invalidate. On failure, leave the local record
   flagged `pending_sync` and let the next successful read reconcile.

The reader is told what happened based on the **local** write, exactly as
`judgment-log`'s header argues: *"a failed server write must not block triage.
Someone working through a feed on a train should not be stopped by a dropped
request."*

### 5.3 Invalidation and multi-tab

- **Invalidation:** on successful upsert, and on `orgId` change. The app's
  `QueryClient` sets `refetchOnWindowFocus: false` (`App.tsx:31`), so a 60s
  `staleTime` plus `refetchOnMount: true` is what carries it — returning to the
  feed refetches.
- **Multi-tab:** the `storage` event is already used once in this codebase
  (`PilotOutcomesGetStarted.tsx:96`). One listener on the disposition key calling
  `queryClient.invalidateQueries` gives cross-tab convergence with no new
  machinery. Optional for V1; the 60s staleTime already bounds divergence.
- **Realtime:** **not recommended.** Per-user state has exactly one writer, and
  the value realtime adds here is converging two of that user's own tabs a few
  seconds sooner. `storage` events do that for free within a browser; across
  devices, refetch-on-mount is the honest granularity. The attention system's own
  TODO list has wanted realtime since it was written and has never needed it.

### 5.4 Offline

`localStorage` remains the read-through cache and the offline fallback. The feed
must open and be usable with no network — it does today, and that must not
regress. `useOfflineNotes` is the existing precedent for a pending-write queue if
one is ever needed; for V1 a failed write is retried on the next action in the
same session, because a lost snooze costs one repeated card on a second device.

### 5.5 Reconciliation

Server wins on conflict, with one exception: a local record newer than the server
record and flagged `pending_sync` is replayed before being overwritten. Merge is
per-key, not whole-map, so a stale tab cannot resurrect dispositions it never knew
about. `quiet_until` is absolute (`timestamptz`), never a duration, so clock skew
between devices cannot extend or shorten a snooze.

---

## 6. localStorage transition

**Recommendation: dual-read, one-time lazy upload, no migration job.**

1. **Ship the table and the write path first.** Every new decision goes to both
   stores; nothing is read from the server yet. Zero risk.
2. **Dual-read.** The disposition map becomes `local ∪ server`, server winning on
   key collision. The feed behaves identically for someone who never leaves one
   browser, and correctly for someone who does.
3. **Lazy upload on first read.** On the first successful server read after the
   feature lands, upload any local key the server does not have. Bounded to 400
   records, one batch upsert, once per browser, guarded by a version flag in
   `localStorage`. Roughly two hours of work, and it preserves state people have
   already expressed.
4. **Let the local store expire.** `loadDispositions` already drops records once
   `until` passes; the longest window is 180 days. After a release plus 180 days,
   drop the local read and keep it as cache only.

A batch migration job is **not** justified: the state is bounded, TTL'd, and
entirely reconstructible by the user taking the action again. The lazy upload
exists only so nobody's answers visibly evaporate on release day.

`feed-rotation` (seen), `feed-telemetry` (interest), `feed-session` (resume) and
`suppression` (the data-quality log) **stay local.** They are presentation state,
they must not cost a round trip on open, and losing them costs one repeated
ordering. Their own headers already argue this and the arguments still hold.

---

## 7. Tenant / security model

Non-negotiable, and all of it standard for this codebase:

| Requirement | Mechanism |
|---|---|
| User identity | `user_id uuid NOT NULL DEFAULT auth.uid()`; RLS `USING (user_id = auth.uid())` on **all four** verbs |
| No cross-user mutation | `WITH CHECK (user_id = auth.uid())` on INSERT and UPDATE — not just `USING` |
| Org boundary | `org_id NOT NULL`, stamped by a `BEFORE INSERT` trigger from `users.current_organization_id`; never accepted from the client |
| No cross-org read | RLS also requires the row's `org_id` to be one the caller is a member of, via the existing membership predicate — not `current_organization_id` alone, which a user can change |
| Entity identity | `subject_key text NOT NULL` — an opaque feed key, deliberately **not** a foreign key. It legitimately holds asset UUIDs, tickers, post ids and attention hashes. Constrain shape and length; do not reference. |
| Admin behaviour | **None.** No admin read, no admin write, no impersonation path. A platform admin has no business knowing which cards an analyst snoozed, and the audit trail already carries everything a legitimate investigation needs. |
| Audit trail | Unchanged: `audit_events` for judgments, nothing for triage. The projection is derived and carries no independent authority. |
| Erasure | Add to the `erase_user_personal_data` table list (`<table>:user_id`), alongside `attention_user_state` and `asset_followup_suppressions`. |
| Grants | `TO authenticated` only; `REVOKE ALL FROM anon`. The Quick Thoughts tenant work established this pattern on 2026-08-27 and it should be the default for every new user-scoped table. |

**Verify against production before writing any SQL.** Migrations do not describe
production in this project, and `attention_user_state`,
`asset_followup_suppressions` and `rating_ev_suppressions` have **no migration in
the repo at all** — the shapes recorded above are read from application code and
`docs/ATTENTION_SYSTEM.md`, not from the database. Confirm the live shape, RLS and
grants of all three before modelling a fourth on them.

---

## 8. Relationship to judgment history

The target narrative — *"I showed Eric this. He reviewed it. He dismissed it for
30 days. It resurfaced. He changed his thesis."* — needs five facts, and four of
them already have durable homes:

| Fact | Home | Exists today? |
|---|---|---|
| "We showed it" | impression telemetry | **no** — `feed-telemetry` is local-only; `useFeedDwell` tracks but does not persist |
| "He reviewed it" | dwell / open | **no** — same |
| "He dismissed it for 30 days" | projection row, plus `audit_events` for judgments | partial — the projection is the V1 gap |
| "It resurfaced" | **derived** — `quiet_until` passed and the condition still fires | yes; needs no storage |
| "He changed his thesis" | `audit_events` + `quick_thoughts` + the thesis object | yes |

**The separation to hold:** the projection row answers *"is this on his screen"*.
`audit_events` answers *"what did he conclude"*. A dismissal is a fact about
attention; it becomes a fact about the investment only when the reader chose a
semantic key that says so. `judgment_intent` (`'judgment' | 'feed_quality'`) is
already recorded on the audit row for exactly this reason. Extend it with
`'triage'` — or, better, let triage continue to write no audit row at all, which
is the cleaner statement of the same rule.

**The trap to avoid:** letting `quiet_until` become the thesis review date. A card
returning after 30 days is the feed re-asking. It is not the firm deciding to
re-underwrite, and if the two ever share a field, the resurfacing policy becomes
un-tunable without editing the investment record.

Impressions ("we showed it") are the one genuinely missing fact and are **out of
scope for V1.** They are a volume problem — every card, every scroll — with a
different storage profile (append-only, batched, sampled) and they belong with
`feed-telemetry`, not with disposition state.

---

## 9. Action Engine boundary

**The test:** *if the user would expect to find it in a list later, it is an
Action Engine object. If they would only notice its absence, it is attention
state.*

| Interaction | Owner | Why |
|---|---|---|
| Dismiss | **Attention state** | No artefact expected. Nobody looks for a list of things they dismissed. |
| Snooze ("for a week") | **Attention state** | A duration with no reason. Bounded, self-expiring, no follow-up implied. |
| "Revisit after earnings" | **Action Engine** (`personal_tasks`) | Has a date, a reason and an expectation. The user will go looking for it. A suppression that silently expires loses the intent. |
| "Needs work" / `action_needed` | **Both, at the boundary** | The *judgment* is investment record (`audit_events`); the quiet window is attention state; **offering** to create a task is Action Engine. Never create one implicitly. |
| Due date / follow-up | **Action Engine** | Already `personal_tasks` and `project_deliverables`, already collected by `useAttention` |
| "Thesis broken" | **Investment judgment** | `audit_events` + `quick_thoughts` + eventually the thesis object |
| Resolved workflow | **Source object** | `decision_requests`, `project_deliverables` — never a disposition |

Concretely: `feed_snoozed` and `feed_dismissed` stay where `feed-triage` put them
and should never grow a due date. The moment a user wants to say *why* they are
deferring, or *when* to come back, that is a task — and the Action Engine already
has the table, the collector and the surface.

`judgment-policy`'s `nextAction` ids (`set_target`, `open_cases`, `open_coverage`,
`update_thesis`) and `feed-actions`' `FeedActionKey` are already one shared
vocabulary. That is the seam the Action Engine should attach to when progressive
disclosure lands — not a second mapping.

---

## 10. Cross-device walkthroughs

| # | Scenario | Behaviour under the proposed model |
|---|---|---|
| 1 | Dismiss on desktop → open mobile | Desktop: local write, optimistic cache set, upsert. Mobile: `['feed-dispositions']` fetch on mount returns the row, `quiet_until` 30 days out, card absent. |
| 2 | Snooze on mobile → open desktop | Same path inverted. Desktop's `refetchOnMount` picks it up; no realtime needed. |
| 3 | Snooze expires | No job, no scheduler. `quiet_until > now()` stops matching, and the card is generated again **only if the underlying condition still fires** — the existing "judgment can suppress but never keep alive" invariant. The `penalty` term keeps it below never-seen cards. |
| 4 | Judgment recorded on phone | Local write → UI confirms. `audit_events` row (asset cards) → org-visible judgment. Projection upsert → cross-device suppression. `quick_thoughts` row → findable prose. Four writes, one tap, three already implemented. |
| 5 | Judgment changed | The projection **upserts** — one current row per key. `audit_events` **appends** — both answers survive, in order, each against the question it answered. This is precisely why the split exists: the feed needs "what is true now"; the record needs "what did they say when". |
| 6 | Two analysts, same signal, different actions | Two rows, different `user_id`. A's dismissal is invisible to B. Both judgments appear in the asset's audit history with distinct actors — which is the interesting artefact, not a conflict. |
| 7 | PM resolves a shared workflow | Mutates the source object. The collector stops emitting; the card vanishes for **everyone** on their next load. No disposition row is written by anyone. |
| 8 | Logout / login | The projection is keyed on `auth.uid()` and survives. `localStorage` also survives on that browser, but is now only a cache. Logging in on a fresh device reconstructs the full picture from the server. **This is the specific failure being fixed.** |
| 9 | Two browser tabs | Tab A upserts and invalidates its own cache. Tab B converges within `staleTime` (60s) on any refetch, or immediately with the optional `storage` listener. Worst case: one stale card in the other tab for a minute. |
| 10 | Offline action, later reconnect | Local write succeeds → UI confirms → card leaves the feed. Upsert fails → record flagged `pending_sync`. The next successful read replays it before merging. If the browser closes first, the action is lost only on other devices — the local store still honours it, so the user never sees the card they dismissed. The failure mode is one repeated card on a second device, never a wrong suppression. |

---

## 11. Smallest V1

**One table, one hook, one dual-read. No new subsystem, no realtime, no migration job.**

**Canonical source of truth**
- Attention state → `feed_dispositions` (new projection table)
- Investment judgment → `audit_events` (unchanged)
- Workflow resolution → the source object (unchanged)

**Server representation**

```
feed_dispositions
  user_id        uuid not null default auth.uid()
  org_id         uuid not null              -- trigger-stamped
  signal_type    text not null
  subject_key    text not null              -- from dispositionEntityFor
  judgment_key   text not null
  kind           text not null              -- settled | flagged | rejected
  intent         text not null default 'judgment'  -- judgment | feed_quality | triage
  label, question, card_type  text
  schema_version int  not null default 3
  decided_at     timestamptz not null default now()
  quiet_until    timestamptz not null
  audit_event_id uuid                       -- nullable link to the durable judgment
  primary key (user_id, signal_type, subject_key)
  index on (user_id, org_id, quiet_until)
```

One row per key, upserted. `judgment-policy` derives `category`, `resolves`,
`quietDays` and `penalty` from `judgment_key` **on the client, unchanged** — the
policy stays pure, testable, and out of SQL.

**Read path** — `useFeedDispositions(userId, orgId)` returns the existing
`DispositionMap` shape. `MobileDashboard` swaps `loadDispositions(...)` for the
hook. `rankInputFor`, `judgmentFor`, `acknowledgmentFor` and `priorityFor` are
untouched.

**Write path** — `recordDisposition` keeps its synchronous local write and its
boolean. A new `syncDisposition` fires the upsert. `recordTriage`,
`recordSignalJudgment` and `applyFeedback` each gain one line.

**Cache / invalidation** — TanStack Query, 60s `staleTime`, invalidate on upsert
and on org change. Optional `storage` listener for multi-tab.

**localStorage transition** — dual-read, lazy one-time upload, expire naturally (§6).

**Security** — RLS on all four verbs, `WITH CHECK` on writes, trigger-stamped
`org_id`, `TO authenticated`, `anon` revoked, added to the erasure list, no admin
path (§7).

**Rollout**

1. Verify the live shapes of the three existing suppression tables. Nothing is
   written until this is done.
2. Migration: table, RLS, trigger, grants, erasure-list entry. Staging first.
3. Write path behind a flag, dual-write only. No read change. Ship and watch the
   write success rate.
4. Dual-read plus lazy upload behind the same flag. Ship to pilot.
5. Flag on for everyone. The local store is demoted to a cache.
6. Only then: consolidate `attention-feed/snooze.ts` and
   `decisionEngine/dismissals.ts` onto the same table, and fix the missing user
   key in the former.

**Deliberately not in V1:** impressions / "we showed it"; realtime; a
pending-write queue; migrating the desktop stores; widening the `audit_events`
entity CHECK; consolidating `attention_user_state`. Each is separately
shippable and none blocks cross-device memory.

---

## 12. Implementation sequence

| # | Step | Depends on | Notes |
|---|---|---|---|
| 1 | Verify live schema / RLS / grants of `attention_user_state`, `asset_followup_suppressions`, `rating_ev_suppressions` | — | **Blocking.** No repo migrations exist for any of them. |
| 2 | Decide `answered` / `done` shared-resolution semantics (§4.2) | — | Product decision, not a code change. Blocks step 6. |
| 3 | Migration: `feed_dispositions` + RLS + org trigger + grants + erasure list | 1 | Staging first. |
| 4 | `lib/signals/disposition-sync.ts` — upsert and fetch, mirroring `judgment-log`'s failure discipline | 3 | Errors swallowed; never blocks the UI. |
| 5 | Dual-write behind a flag: `recordTriage`, `recordSignalJudgment`, `applyFeedback` | 4 | No read change. Observe write success rate. |
| 6 | `useFeedDispositions` + dual-read + lazy upload | 5, 2 | `MobileDashboard` swaps one line. |
| 7 | Multi-tab `storage` listener | 6 | Optional. |
| 8 | Fix the attention-card key collision (§2.3) | — | Independent; belongs to the feed lane. |
| 9 | Reconcile attention ack/snooze windows with `judgment-policy` (§2.2) | 2 | Independent. |
| 10 | Consolidate the desktop stores; fix `attentionFeedSnooze`'s missing user key | 6 | Separate lane. |

---

## 13. Files and modules likely involved later

**Would change**

- `src/lib/signals/dispositions.ts` — load/record become cache plus sync
- `src/lib/signals/feed-triage.ts` — one line
- `src/lib/signals/judgment-log.ts` — one line; `SignalJudgmentResult` gains a sync field
- `src/components/mobile/MobileDashboard.tsx` — `loadDispositions` → `useFeedDispositions` (:293, :408, :450); `applyFeedback` (:397)
- `src/hooks/mobile/useDerivedInsights.ts` — `judgmentTouches(loadDispositions(...))` (:151) reads the cache instead

**New**

- `src/lib/signals/disposition-sync.ts`
- `src/hooks/mobile/useFeedDispositions.ts`
- `supabase/migrations/<ts>_feed_dispositions.sql`

**Would not change** — this is what keeps V1 small

- `src/lib/signals/judgment-policy.ts` — stays pure, stays client-side
- `src/lib/signals/feed-priority.ts` — reads a `JudgmentRecord` and does not care where it came from
- `src/lib/audit/*` — unchanged
- `src/lib/signals/feed-rotation.ts`, `feed-telemetry.ts`, `feed-session.ts`, `suppression.ts` — stay local

**Later phases**

- `src/lib/attention-feed/snooze.ts`, `src/engine/decisionEngine/dismissals.ts`
- `src/hooks/useAttention.ts`, `useAttentionFeed.ts`, `useDashboardFeed.ts`
- `src/features/assets/actionLoop/useActionLoopItems.ts`, `src/hooks/useActionLoopCards.ts`, `useActionLoopFollowups.ts`, `useRatingDivergence.ts`
- `src/lib/signals/builders/legacy-kinds.ts` (attention card key)
- `supabase/migrations/*_erase_user_personal_data*.sql` (erasure list)

---

## 14. Files touched in this pass

`docs/decision-memory-architecture.md` — this file. Nothing else. No code, no SQL,
no schema change, no deploy.
