# Decision memory, part 2 — verify and consolidate existing durable state

**Status:** audit, plus one isolated bug fix implemented (Phase 4).
**Branch:** `audit/decision-memory`
**Date:** 2026-08-28
**Predecessor:** `docs/decision-memory-architecture.md`
**Live inspection:** production `wfcebeagznzgeuyysbnt`, read-only (`SELECT` only, Management API)

---

## 0. Headline

`attention_user_state` **can be the canonical personal attention-state
projection** — answer **B**, with a bounded, purely additive forward migration.
`feed_dispositions` is **no longer needed** and should not be built.

Three facts from production make this cheap rather than risky:

1. **All three tables are empty.** `attention_user_state` 0 rows,
   `asset_followup_suppressions` 0 rows, `rating_ev_suppressions` 1 row. There is
   nothing to migrate and no compatibility burden.
2. **The write verbs already exist and are already correct.** Seven
   `SECURITY DEFINER` RPCs that derive `user_id` from `auth.uid()` and upsert on
   `ON CONFLICT (user_id, attention_id)` — the exact key shape the feed needs,
   including `unsnooze` and `undismiss`.
3. **The namespace is already opaque.** `attention_id` is `text`, holding a
   SHA-256 hash. Adding a second namespace cannot collide with the first, and
   the attention pipeline looks up by exact key, so extra rows are inert.

---

## 1. Live schema and RLS of the three durable suppression tables

Captured read-only from production, 2026-08-28. **None of these has a migration
in the repo**; this is the first written record of their real shape.

### 1.1 `attention_user_state`

```
id                      uuid  NOT NULL  default gen_random_uuid()
user_id                 uuid  NOT NULL  → auth.users(id) ON DELETE CASCADE
attention_id            text  NOT NULL
read_state              attention_read_state NOT NULL default 'unread'
last_viewed_at          timestamptz
snoozed_until           timestamptz
dismissed_at            timestamptz
personal_rank_override  numeric
created_at              timestamptz NOT NULL default now()
updated_at              timestamptz NOT NULL default now()
dismiss_reason          text   CHECK IN (duplicate, incorrect_signal,
                                         not_my_responsibility, no_longer_relevant)
dismiss_note            text
```

| Property | Finding |
|---|---|
| PK / unique | `PRIMARY KEY (id)`, **`UNIQUE (user_id, attention_id)`** |
| Indexes | 5 — the unique pair, a redundant duplicate of it (`idx_attention_user_state_user_attention`), plus partial indexes on `(user_id, dismissed_at) WHERE NOT NULL`, `(user_id, snoozed_until) WHERE NOT NULL`, `(user_id, read_state)` |
| `organization_id` | **absent** |
| User identity | `auth.uid()`, inside the RPCs. Column has no default. |
| RLS | **enabled**, not forced |
| Policies | 4, one per verb, all `auth.uid() = user_id`, INSERT and UPDATE both carry `WITH CHECK` |
| Grants | `anon`, `authenticated`, `postgres`, `service_role` — **all with full DML** |
| Trigger | `update_attention_user_state_updated_at` (BEFORE UPDATE) |
| TTL | `snoozed_until` is bounded; **`dismissed_at` is permanent** — a timestamp of the act, with no expiry |
| Rows | **0** |

### 1.2 `asset_followup_suppressions`

```
id                uuid NOT NULL default gen_random_uuid()
user_id           uuid NOT NULL  → auth.users(id) ON DELETE CASCADE
asset_id          uuid NOT NULL  → assets(id)     ON DELETE CASCADE
view_user_id      uuid           → auth.users(id) ON DELETE CASCADE
suppressed_until  timestamptz NOT NULL
created_at        timestamptz default now()
updated_at        timestamptz default now()
followup_type     text
```

| Property | Finding |
|---|---|
| PK / unique | `PRIMARY KEY (id)` only — **no unique constraint on the logical key** |
| Indexes | `idx_followup_suppressions_lookup (user_id, asset_id, view_user_id, followup_type)` — a plain index, not unique |
| `organization_id` | absent |
| RLS | enabled; one `FOR ALL` policy, `user_id = auth.uid()` with matching `WITH CHECK` |
| Grants | all four roles, full DML |
| TTL | `suppressed_until`, always `now() + 24h` from the client |
| Rows | **0** |

**Defect:** the logical key is unconstrained, and all three consuming hooks do a
read-then-insert-or-update round trip (`useActionLoopItems.ts:379-401`,
`useActionLoopCards.ts:238-260`, `useActionLoopFollowups.ts:165-187`). Two
concurrent dismissals — two tabs, a double tap — insert two rows. `maybeSingle()`
on the next read then **throws**, because it returns an error on multiple rows.
The suppression stops working and the error surfaces as a failed query. Latent
today only because the table is empty.

### 1.3 `rating_ev_suppressions`

```
id                  uuid NOT NULL default gen_random_uuid()
user_id             uuid NOT NULL → auth.users(id)
asset_id            uuid NOT NULL → assets(id) ON DELETE CASCADE
suppressed_until    timestamptz NOT NULL
created_at          timestamptz default now()
view_scope_type     text NOT NULL default 'user'
view_scope_user_id  uuid → auth.users(id)
CHECK ((view_scope_type='firm' AND view_scope_user_id IS NULL)
    OR (view_scope_type='user' AND view_scope_user_id IS NOT NULL))
```

| Property | Finding |
|---|---|
| PK / unique | `PRIMARY KEY (id)`, plus **two partial unique indexes** — `(user_id, asset_id, view_scope_type) WHERE view_scope_user_id IS NULL` and `(user_id, asset_id, view_scope_type, view_scope_user_id) WHERE NOT NULL`. Correctly NULL-aware; the best-constrained of the three. |
| `organization_id` | absent |
| RLS | enabled; one `FOR ALL`, `user_id = auth.uid()` + `WITH CHECK` |
| Grants | all four roles, full DML |
| TTL | `suppressed_until`, `now() + 24h` |
| Rows | **1** |

**Finding — `view_scope_type = 'firm'` is a promise RLS does not keep.** The
read path can query for a firm-scoped row, but RLS restricts every read to
`user_id = auth.uid()`, so a "firm" suppression would only ever be visible to
the person who created it. It is also unreachable: `canSuppress` requires
`scope.type === 'user' && scope.userId === user.id` and the mutation hardcodes
`view_scope_type: 'user'` (`useRatingDivergence.ts:143,174`). Dead branch, and a
trap — it reads like shared state and could never be.

### 1.4 Cross-cutting security findings

| # | Finding | Severity |
|---|---|---|
| S1 | **`anon` holds full `SELECT/INSERT/UPDATE/DELETE/TRUNCATE` on all three tables.** RLS blocks it in practice (`auth.uid()` is NULL for anon, so `user_id = auth.uid()` is never true), but this is the exact grant pattern the Quick Thoughts tenant work removed on 2026-08-27. Defence-in-depth debt. | Medium |
| S2 | **All policies are `TO public`, not `TO authenticated`.** Same class as S1. | Low |
| S3 | **All 7 attention RPCs are `SECURITY DEFINER` with no pinned `search_path`.** The repo's own `schema-baseline.mjs` tracks `search_path_pinned` as a security property, so this is a known standard being missed. | Medium |
| S4 | **All 7 RPCs are `EXECUTE`-granted to `anon`.** They insert `auth.uid()` into a `NOT NULL` column, so an anonymous call fails — the grant is pointless rather than exploitable, but it should not be there. | Low |
| S5 | **No `organization_id` on any of the three.** A user in two pilot orgs shares one suppression namespace across both. | Medium |
| S6 | Cross-user access: **not possible.** Every policy compares to `auth.uid()`, every write derives it, and no RPC accepts a caller-supplied user id. This half is genuinely correct. | — |
| S7 | Cross-org access: **not applicable today** (no org column), which is also why S5 matters. | — |

**On "do writes derive `auth.uid()` rather than trust caller input":** the RPCs
do — `INSERT INTO attention_user_state (user_id, ...) VALUES (auth.uid(), ...)`.
The two suppression tables are written by **direct client inserts** that pass
`user_id: user.id` from the session. RLS `WITH CHECK` makes a forged id fail, so
it is safe, but the value is caller-supplied and only rejected at the boundary.
The RPC pattern is strictly better and is what a consolidated write path should
use.

---

## 2. Can `attention_user_state` be canonical? — **B**

**B: it can satisfy the requirement with a bounded forward migration.** Not A,
because four fields are genuinely missing. Not C, and C is not close.

| Requirement | Present? | Gap |
|---|---|---|
| Subject identity | ✅ `attention_id text`, opaque, unique per user | none — holds `signal:<type>:<subjectKey>` as a second namespace |
| Signal / card type | ❌ | add `signal_type text`, or carry it inside the key |
| `snoozed_until` | ✅ | none |
| `dismissed_until` | ⚠️ `dismissed_at` is the *act*, permanent | add `dismissed_until timestamptz`; leave `dismissed_at` meaning what it means |
| Acknowledged / read | ✅ `read_state` enum | none |
| Current disposition | ❌ | add `disposition_key text` + `intent text` |
| Timestamps | ✅ `created_at`, `updated_at` + trigger | none |
| User identity | ✅ `auth.uid()` via RPC, RLS on all four verbs | none |
| Organization boundary | ❌ | add `org_id uuid`, trigger-stamped |

### Why C is wrong

- **The key shape is already exactly right.** `UNIQUE (user_id, attention_id)`
  over an opaque `text` key is precisely `(user_id, dispositionKey)`. The feed's
  `dispositionKey(type, subject)` is already a string.
- **Namespacing cannot collide.** `attention_id` currently holds a 32-char hex
  hash; feed rows would hold `signal:<type>:<subject>`. Disjoint by shape.
- **The attention pipeline is unaffected.** `computeAttention` builds
  `stateMap` and looks up `stateMap.get(item.attention_id)`
  (`useAttention.ts:1403`) — an exact-match lookup. Rows in another namespace
  are never found and never filter anything. *(It does fetch them —
  `.eq('user_id', userId)` with no key filter — so add a namespace predicate to
  keep the payload honest. Correctness is unaffected either way.)*
- **The name is more accurate than `feed_dispositions`.** The decided product
  semantics say snooze/dismiss/acknowledge *are* personal attention state.
  `attention_user_state` says that; `feed_dispositions` says less.
- **Zero rows.** Additive columns and a new RPC carry no backfill and no
  reinterpretation of existing data.

### The one thing that must not go in it

`disposition_key` is the key `judgment-policy` classifies to derive the quiet
window. It is **not** the investment judgment. The judgment stays in
`audit_events`. Keeping `intent` on the row (`triage | feed_quality | judgment`)
makes that boundary queryable rather than conventional.

---

## 3. Are the three systems duplication?

| Table | Classification | Recommendation |
|---|---|---|
| `attention_user_state` | **(1) generic feed attention state** | **Becomes canonical.** It is already the general case; the feed is the caller it was missing. |
| `asset_followup_suppressions` | **(2) domain-specific workflow suppression** | **Keep separate.** Its key carries a `view_user_id` dimension — *whose* action loop you are looking at — that the feed has no concept of, and `followup_type` names action-loop item types, not signal types. Fix its missing unique constraint; do not fold it in for neatness. |
| `rating_ev_suppressions` | **(2) domain-specific**, with a **(3) legacy-duplication** wart | **Keep separate**, and delete the dead `firm` branch or implement it honestly. The `view_scope_type` column encodes a shared-scope idea that RLS contradicts. |

This follows the instruction not to merge domain semantics for architectural
neatness. The action loop's 24-hour, per-type, per-view suppression is a
different concept from "this card is not for me right now", and collapsing them
would lose the `view_user_id` dimension for nothing.

---

## 4. Workflow identity defect — **fixed in this branch**

### What was actually wrong

Larger than the audit reported. Three distinct defects at one seam:

1. **Collision (reported).** `dispositionEntityFor` special-cased only
   `surface === 'desk'`. Workflow cards fell through to `card.entity.id`, so two
   distinct queue items on AAPL shared one key. Answering either suppressed both
   for 30 days.
2. **Vocabulary mismatch (new).** The write key uses the card type from
   `ATTENTION_TYPE[a.attention_type]` (`action_required → project_overdue`); the
   read key used the ranker's own `source_type` mapping
   (`trade_queue_item → recommendation`). For any item where the two disagreed,
   the lookup **never matched** and the answer suppressed nothing at all.
3. **Missing key (new).** The ranker passed `a.context?.asset_id`. For an
   attention item with no linked asset that is `undefined`, so `judgmentFor`
   returned `null` and the write went somewhere nothing ever read.
4. **Bypass (new).** `applyFeedback` called
   `recordDisposition(userId, card.type, card.entity.id, …)` — reaching past the
   identity rule entirely. "Not useful" on one post hid every post on that name
   for 180 days, the longest window the surface can apply.

### The fix

Modelled directly on the existing `ideaCardType` / `ideaCardId` precedent, which
solved this same problem for posts and documented why.

- **`legacy-kinds.ts`** — export `attentionCardType(attentionType)` and
  `attentionCardId(attentionId)`; `buildAttentionCard` now uses both. One
  vocabulary, owned by the builder.
- **`dispositions.ts`** — the identity rule restated as what it always meant:
  ```ts
  const INSTANCE_SURFACES: ReadonlySet<string> = new Set(['desk', 'workflow'])
  return INSTANCE_SURFACES.has(card.surface) ? card.id : card.entity.id
  ```
  The question is not which accent rail the card wears; it is whether the card is
  **one artefact somebody created** (`desk`, `workflow` — subject is the card) or
  **a claim the data will make again tomorrow** (`risk`, `research`, `market` —
  subject is the entity). Both instance families already namespace their ids
  (`idea:…`, `attention:…`), so the id is a stable identity, not an incidental
  string.
- **`MobileDashboard.tsx`** — the attention branch passes
  `attentionCardId(a.attention_id)` and `attentionCardType(a.attention_type)`, so
  read and write produce the same string by construction. `applyFeedback` uses
  `dispositionEntityFor(card)`.

Deliberately **not** done: adding a `subject` field to `contract.ts`. That is the
cleaner long-term shape and it touches a file the parallel lanes share.

### Tests — 7 added, all passing

In `src/lib/signals/__tests__/feed-triage.test.ts`:

1. `does not let one AAPL workflow card suppress another` — the reported bug.
2. `keeps the same workflow card suppressed` — the same card still resolves to
   the same key on rebuild, and `acknowledgmentFor` still suppresses.
3. `keeps different assets independent`.
4. `keys a workflow item with no linked asset on the item, not on nothing` —
   defect 3.
5. `leaves asset-level machine findings keyed on the asset` — the regression
   guard: `research`, `market` and `risk` cards all still key on the entity, and
   a recurrence under a new `dedupeKey` is still suppressed.
6. `agrees with the card the builder actually emits` — pins builder and ranker to
   one vocabulary, the invariant defect 2 broke.
7. `falls back rather than inventing a type`.

```
✓ src/lib/signals/__tests__/feed-triage.test.ts (15 tests)
src/lib/signals + src/components/mobile: 396 passed (was 389)
```

Four test files fail to collect on `Missing Supabase environment variables` —
**pre-existing**, verified by running the same suite against a clean tree
(4 failed / 389 passed both before and after). `npm run typecheck` reports no
errors in any touched file.

### One accepted consequence

Existing `localStorage` dispositions on workflow cards were keyed on the asset
and are now orphaned. Affected users see those cards once more. That is the
correct outcome — they were over-suppressed — and the records expire on their own.

---

## 5. TTL divergence — every action where the two clocks disagree

### 5.1 The measured divergence

The durable side is worse than the audit reported. `acknowledge_attention` sets
only `read_state`, and **the attention filter never reads `read_state`** — it
checks `dismissed_at` and `snoozed_until` only (`useAttention.ts:1402-1407`).
`read_state` is selected, merged onto the item (`:1416`), and then read by
nothing. So:

> **`acknowledge_attention` is durably recorded and behaviourally inert.** The
> item stays in the queue. The comment at the call site — *"a card the reader has
> answered should not be waiting on them there either"* — describes an effect
> that does not occur.

| UI action | Card | Local (`judgment-policy`) | Durable write | Durable effect | Divergence |
|---|---|---|---|---|---|
| **Answered** | decision_required | `settled`, 30d quiet, **`resolves: true`** | `acknowledge_attention` | **none** | Local does all the work; durable is a no-op |
| **Done** | action_required | `settled`, 30d quiet, **`resolves: true`** | `acknowledge_attention` | **none** | Same |
| **Defer** | both | `needs_review`, **3d** quiet | `acknowledge_attention` | **none** | Feed re-asks on day 4; the queue never stopped asking |
| **Not mine** | both | `not_applicable`, **180d** quiet | `snooze_attention(+168h)` | 7d hidden | **173 days** |
| **In progress** | both | `action_needed`, 7d quiet, not suppressed | *(nothing)* | — | Durable side never learns |
| Snooze (overflow) | any | `feed_snoozed`, 7d | *(nothing)* | — | Local-only |
| Dismiss (overflow) | any | `feed_dismissed`, 30d | *(nothing)* | — | Local-only |
| "Not useful" | any | `rejected`, 180d retention | `pilot_telemetry_events` | none | Suppression is local-only |

### 5.2 The canonical policy table

One clock. `judgment-policy.ts` is the authority — it is pure, tested, and already
the only place the windows are written down. The durable row stores
`quiet_until` as an **absolute timestamp computed from it**, so the two cannot
drift: there is one number, written once.

| Judgment key | Personal attention consequence | Durable TTL | Audit consequence | Shared workflow consequence |
|---|---|---|---|---|
| `feed_snoozed` | hidden | `snoozed_until = +7d` | none | none |
| `feed_dismissed` | hidden | `dismissed_until = +30d` | none | none |
| `not_now` | hidden | `snoozed_until = +14d` | `record_judgment` | none |
| `defer` | hidden | `snoozed_until = +3d` | `record_judgment` | none |
| `in_progress` | visible, penalty 0.35 | `+7d`, **not** suppressing | `record_judgment` | none |
| `not_mine` / `owned_elsewhere` / `no_longer_covered` | hidden | `dismissed_until = +180d` | `record_judgment` | none — the gap is real and belongs to someone else |
| `answered` / `done` | hidden | `dismissed_until = +30d` | `record_judgment` | **must resolve the source object** — see §8 |
| `not_price_driven` / `legacy_position` | hidden, scoped by `RESOLUTION_SCOPE` | `+180d` | `record_judgment` | none |
| `scenario_thesis_intact`, `target_still_valid`, … | hidden | `+30d` | `record_judgment` | none |
| `scenario_cases_outdated`, `target_revise`, … | visible, penalty 0.35 | `+7d`, not suppressing | `record_judgment` | none |
| `feed_not_useful` / `feed_wrong_person` | hidden | `dismissed_until = +180d` | none (`intent: feed_quality`) | none |

**Two changes this table implies**, both to be made when the read path lands, not
now:

- `resolves: true` comes off `answered` and `done`. A personal record must not
  claim a shared resolution (§8).
- `not_mine` becomes one number. Whether it is 7 or 180 days is a product call;
  180 is the current documented intent (*"the surface should act like it heard
  it"*), and 7 was never chosen — it is a hardcoded `24 * 7` at a call site.

---

## 6. The future read path

```
useFeedDispositions(userId, orgId)
  → ['feed-dispositions', userId, orgId]
  → select attention_id, signal_type, disposition_key, intent,
           snoozed_until, dismissed_until, read_state, updated_at
      from attention_user_state
     where user_id = auth.uid()
       and attention_id like 'signal:%'
       and (snoozed_until > now() or dismissed_until > now())
  → shape into the existing DispositionMap
  → judgment-policy.acknowledgmentFor
  → feed-priority.priorityFor          (unchanged)
```

| Concern | Design |
|---|---|
| **Initial query** | One round trip, bounded by the `> now()` predicate. Served by the existing partial indexes on `(user_id, snoozed_until)`. |
| **Cache shape** | The current `DispositionMap` — `Record<dispositionKey, Disposition>`. Source changes; shape does not, so `rankInputFor`, `judgmentFor` and `priorityFor` need no edit. |
| **Optimistic updates** | `setQueryData` on the key at the moment of the tap, before the RPC. `MobileDashboard`'s snapshot-per-mount rule stays — its reasoning is about scroll stability, not about storage. |
| **Same-tab invalidation** | `invalidateQueries` in the RPC's `onSuccess`, exactly as the six existing attention mutations already do. |
| **Cross-tab** | One `storage`-event listener calling `invalidateQueries`. The pattern already exists at `PilotOutcomesGetStarted.tsx:96`. Optional; 60s `staleTime` bounds divergence without it. |
| **Cross-device** | `refetchOnMount: true` (the app default) plus 60s `staleTime`. Opening the feed on the other device refetches. |
| **Offline** | `localStorage` stays as read-through cache and fallback. Local write is synchronous and still decides what the reader is told; a failed RPC leaves the row flagged for replay. |
| **Realtime** | **Not recommended.** One writer per row; the only gain is converging the user's own tabs a few seconds sooner, which `storage` events already do for free. |

---

## 7. Transition strategy — simpler than the audit proposed

The audit assumed a new table and therefore a dual-read plus a lazy upload.
`attention_user_state` being **empty** removes most of that.

1. **Additive migration.** New nullable columns, one new RPC, tighten grants. No
   backfill; no existing row to reinterpret.
2. **Dual-write behind a flag.** Every decision writes `localStorage` (as today)
   and the RPC. No read change. Watch the RPC success rate.
3. **Read flips to the server**, with `localStorage` as fallback when the query
   has not resolved or the device is offline. **Server wins on conflict.**
4. **Lazy one-time upload**, guarded by a version flag in `localStorage` —
   ≤400 records, one batched RPC call, once per browser. Optional: without it,
   users re-answer a handful of cards once. Cheap enough to keep.
5. **Age out.** Local records expire on their own; the longest window is 180
   days. Remove the local read path after a release plus 180 days.

**No bulk migration job.** Nothing to migrate server-side, and the client state is
bounded, TTL'd and user-reconstructible.

---

## 8. Shared workflow model — classification, and one flagged conflation

### 8.1 Which attention sources are genuinely shared

| Source | Shared object? | Attention is |
|---|---|---|
| `decision_request` | **yes** — others wait on the answer | personal |
| `trade_queue_item` | **yes** | personal |
| `project_deliverable` | **yes** — assigned work | personal |
| `project` (stale / blocked) | **yes** | personal |
| `list_suggestion` | **yes** — somebody proposed it | personal |
| `coverage` (neglected) | org data, but the prompt is addressed to one analyst | personal |
| `personal_task` | no | personal |
| `notification` | no | personal |
| `earnings_upcoming` | no — machine finding | personal |

### 8.2 The conflation — **flagged, not changed**

One tap on **"Done"** or **"Answered"** currently produces up to **four** effects,
and the one that matters is missing:

| # | Effect | Correct? |
|---|---|---|
| 1 | Local disposition, `settled`, 30d, `resolves: true` | personal attention — correct, except `resolves` |
| 2 | `acknowledge_attention` → `read_state` | **inert** (§5.1) |
| 3 | `audit_events` `record_judgment` **against the asset**, when the card has one | **category error** — "Done" on a project deliverable is filed as an investment judgment about AAPL, with `judgment_key: 'done'` |
| 4 | Private `quick_thoughts` note | benign |
| — | **Resolve the shared object** | **does not happen** |

> **"Done" does not mark anything done.** The deliverable stays open, the decision
> stays pending, and every other person waiting on it still sees it. The reader
> has cleared their own screen and been told, by a button labelled *Done*, that
> they finished something.

The real resolution verbs exist — `markDeliverableDoneMutation`,
`approveTradeIdeaMutation`, `rejectTradeIdeaMutation`,
`deferTradeIdeaMutation` — and `buildAttentionCard` already accepts a `can`
capability object to gate them. Its own comment records the gap: *"The desktop
attention surface wires all of them; the mobile feed wires none, and gets the
generic 'Resolve'."*

**Recommendation (not implemented):** on a workflow card the reader is authorised
to resolve, "Done" must call the resolution mutation and the personal
suppression, as two explicit effects; where they are not authorised, the verb
should not say "Done" — it should say what it does, which is "Clear from my
queue". Effect 3 should be dropped for `intent: 'triage'` keys regardless.

---

## 9. Security requirements for the consolidated table

Additive, and mostly closing gaps that already exist:

| # | Requirement |
|---|---|
| 1 | `org_id uuid`, stamped by a `BEFORE INSERT` trigger from `users.current_organization_id`. Never accepted from the client — the `quick_thoughts` rule. |
| 2 | Extend RLS to require `org_id` be one the caller is a member of, not merely their current org (which a user can change). |
| 3 | New writes go through a `SECURITY DEFINER` RPC that derives `auth.uid()`. No direct client insert of `user_id`. |
| 4 | **Pin `search_path`** on the new RPC, and retrofit it onto the seven existing ones (S3). |
| 5 | `REVOKE ALL ON attention_user_state FROM anon`; `GRANT` to `authenticated` only (S1). Same for the two suppression tables. |
| 6 | Re-declare the four policies `TO authenticated` (S2). |
| 7 | `REVOKE EXECUTE … FROM anon` on all attention RPCs (S4). |
| 8 | Add a unique constraint to `asset_followup_suppressions` on its logical key, and convert the three read-then-write hooks to upserts (§1.2). |
| 9 | No admin read path. A platform admin has no business knowing which cards an analyst snoozed. |
| 10 | `attention_user_state` is already in the `erase_user_personal_data` list; confirm it stays as columns are added. |

---

## 10. Exact V1

**Scope:** make the mobile signal feed read and write personal attention state
from `attention_user_state`. Nothing else.

**Migration** — one file, additive:

```sql
alter table attention_user_state
  add column if not exists org_id           uuid,
  add column if not exists signal_type      text,
  add column if not exists disposition_key  text,
  add column if not exists intent           text,
  add column if not exists dismissed_until  timestamptz;

-- org stamped from the session, never from the caller
create trigger attention_user_state_stamp_org
  before insert on attention_user_state
  for each row execute function stamp_current_org();

create index if not exists idx_aus_signal_live
  on attention_user_state (user_id, org_id, dismissed_until, snoozed_until)
  where attention_id like 'signal:%';

create or replace function set_feed_disposition(
  p_key text, p_signal_type text, p_disposition_key text,
  p_intent text, p_snoozed_until timestamptz, p_dismissed_until timestamptz
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$ … $$;

revoke all on attention_user_state from anon;
revoke execute on function set_feed_disposition(...) from anon;
```

**Client**

| File | Change |
|---|---|
| `src/lib/signals/disposition-sync.ts` *(new)* | `syncDisposition()` → RPC; `fetchDispositions()` → query. `judgment-log`'s failure discipline: errors swallowed, never blocks the UI. |
| `src/hooks/mobile/useFeedDispositions.ts` *(new)* | TanStack query returning the existing `DispositionMap`. |
| `src/lib/signals/dispositions.ts` | `recordDisposition` keeps its synchronous local write and boolean; gains a sync call. |
| `src/lib/signals/feed-triage.ts` | one line |
| `src/lib/signals/judgment-log.ts` | one line; `SignalJudgmentResult` gains a sync field |
| `src/components/mobile/MobileDashboard.tsx` | `loadDispositions` → `useFeedDispositions` (3 sites) |
| `src/hooks/useAttention.ts` | narrow the state fetch with `not.like('attention_id','signal:%')` |
| `src/lib/signals/judgment-policy.ts` | `resolves: false` on `answered` / `done`; single `not_mine` window |

**Unchanged:** `feed-priority.ts`, `lib/audit/*`, `feed-rotation`,
`feed-telemetry`, `feed-session`, `suppression`, and the two domain-specific
suppression tables.

**Sequence:** migration → dual-write behind a flag → observe → read flip + lazy
upload → flag on → drop the local read path after 180 days.

**Explicitly out of V1:** impressions; realtime; the shared-workflow "Done" fix
(§8.2); consolidating the desktop `localStorage` stores; the
`asset_followup_suppressions` unique constraint (independent, ship separately).

---

## 11. Return summary

| # | Item | Answer |
|---|---|---|
| 1 | Live schema / RLS | §1. All three: RLS on, `auth.uid()` policies correct, `WITH CHECK` present, **no org column**, **`anon` fully granted**, **RPC `search_path` unpinned**, effectively **empty** |
| 2 | Can `attention_user_state` be canonical? | **Yes — B.** 5 additive columns, 1 RPC, 1 index |
| 3 | Is `feed_dispositions` still needed? | **No.** Do not build it |
| 4 | Classification | `attention_user_state` = generic (canonical); the other two = domain-specific, keep separate |
| 5 | Workflow identity bug | **Fixed + 7 tests.** Was 4 defects, not 1 |
| 6 | TTL divergence | §5. Worst case 173 days; `acknowledge_attention` is inert |
| 7 | Read/write path | §6. One query, optimistic write via RPC, no realtime |
| 8 | localStorage transition | §7. Simpler than proposed — empty table, no bulk job |
| 9 | Personal vs shared | §8. **"Done" resolves nothing shared** — flagged, unchanged |
| 10 | Security | §9. 10 requirements, 6 closing pre-existing gaps |
| 11 | V1 plan | §10 |
| 12 | Migrations | One additive migration. Two independent ones recommended separately (unique constraint; grant/`search_path` hardening) |
| 13 | Tests | 7 added, 15/15 in file, 396 passing in scope, typecheck clean |
| 14 | Files touched | §12 |

---

## 12. Files touched in this pass

**Implemented (Phase 4 fix)**

- `src/lib/signals/builders/legacy-kinds.ts` — export `attentionCardType` / `attentionCardId`; use both in `buildAttentionCard`
- `src/lib/signals/dispositions.ts` — `INSTANCE_SURFACES` covers `desk` + `workflow`; rule restated
- `src/components/mobile/MobileDashboard.tsx` — attention branch passes the shared id + type; `applyFeedback` uses `dispositionEntityFor`
- `src/lib/signals/__tests__/feed-triage.test.ts` — 7 tests

**Documentation**

- `docs/decision-memory-consolidation.md` — this file

**Not touched:** no migration written, no SQL run against any database, no
production change. Live inspection was `SELECT`-only via the Management API.
Nothing merged, nothing deployed.
