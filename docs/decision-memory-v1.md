# Decision memory V1 — final design + local implementation

**Status:** design finalised; the schema-free half implemented in this worktree.
**Branch:** `audit/decision-memory`
**Date:** 2026-08-28
**Predecessors:** `docs/decision-memory-architecture.md`, `docs/decision-memory-consolidation.md`

**Freeze respected:** no deploy, no merge, no SQL executed, no migration file
written. `audit_events` is not treated as trusted infrastructure — the only
change made to it is to **stop** writing a class of row.

---

## 1. Final personal attention-state model

**Canonical store:** `attention_user_state`. `feed_dispositions` is not created.

**Canonical key:** `attention_id text`, holding two disjoint namespaces:

```
<32-hex sha256>              existing attention items
signal:<cardType>:<subject>  feed cards
```

where `cardType` and `subject` come from the builder-owned identity pair — the
`ideaCardType`/`ideaCardId` shape, now matched by `attentionCardType`/
`attentionCardId`, and selected by `dispositionEntityFor`:

| Card family | Surface | Subject | Why |
|---|---|---|---|
| Post | `desk` | `ideaCardId(type, id)` | one artefact somebody wrote once |
| Workflow item | `workflow` | `attentionCardId(attention_id)` | one queue item, created once |
| Machine finding | `risk` / `research` / `market` | `entity.id` | a claim the data will make again tomorrow |

The rule is stated in `dispositions.ts` as **artefact vs. recurring claim**, not
as a list of surfaces, so the next card family is classified rather than
defaulted.

**State fields:** `snoozed_until`, `dismissed_until` *(new)*, `read_state`,
plus `signal_type`, `disposition_key`, `intent` *(new)* so
`judgment-policy` remains the semantic authority on the client.

**Ownership:** user-specific, always. A dismissal by Analyst A is one row keyed
on A's `user_id` and can never affect B's feed — RLS makes it unreadable, and
the key space has no shared namespace.

---

## 2. Action → attention state → TTL → judgment → shared object

The single authority is `judgment-policy.POLICY`. Durable and local windows are
now derived from it by `quietMsFor` / `quietHoursFor` / `quietUntil`, so there
is one number per action.

| Action / key | Attention state | TTL | Audit / judgment effect | Shared-object effect |
|---|---|---|---|---|
| `feed_snoozed` (Snooze) | hidden | **7d** | none | none |
| `feed_dismissed` (Dismiss) | hidden | **30d** | none | none |
| `reviewed` (Reviewed) | hidden | **30d** | **none** — `intent: attention` | **none** |
| `in_progress` | visible, penalty 0.35 | 7d, non-suppressing | none — `intent: attention` | none |
| `defer` | hidden | 3d | none — `intent: attention` | none |
| `not_mine` | hidden | **180d** | none — `intent: attention` | none |
| `owned_elsewhere` / `no_longer_covered` | hidden | 180d | `record_judgment` | none |
| `not_price_driven` / `legacy_position` | hidden, scoped by `RESOLUTION_SCOPE` | 180d | `record_judgment` | none |
| `scenario_thesis_intact`, `target_still_valid`, … | hidden | 30d | `record_judgment` | none |
| `scenario_cases_outdated`, `target_revise`, … | visible, penalty 0.35 | 7d, non-suppressing | `record_judgment` | none |
| `not_now` | hidden | 14d | `record_judgment` | none |
| `feed_not_useful` / `feed_wrong_person` | hidden | 180d | telemetry only, `intent: feed_quality` | none |
| **`mark_done`** (capability-gated) | may clear | — | none | **`project_deliverables.completed = true`** |
| **`approve`** (capability-gated) | may clear | — | none | **`trade_queue_items.status = 'approved'`** |
| **`reject`** (capability-gated) | may clear | — | none | **`trade_queue_items.status = 'rejected'`** |
| `answered`, `done` | *retained, no longer written* | 30d | — | — |

Three rows changed meaning: `answered`/`done` lost `resolves: true`, `not_mine`'s
durable window went from a hardcoded 7 days to the policy's 180, and every
`intent: attention` key stopped producing a judgment row.

---

## 3. Impact of `not_mine` = 180 days

`judgment-policy` already said 180. The divergence was entirely in hardcoded
call-site constants:

| Site | Before | After |
|---|---|---|
| Attention verdict, `rejected` branch | `snoozeFor(id, 24 * 7)` → **7d** | `snoozeFor(id, quietHoursFor(o.key))` → **180d** |
| Attention card `onSnooze` | `snoozeFor(id, 24)` → **1d** | `quietHoursFor(TRIAGE_JUDGMENT.snooze.key)` → **7d** |
| Attention card `onDismiss` | `acknowledge(id)` → **no effect** | `quietHoursFor(TRIAGE_JUDGMENT.dismiss.key)` → **30d** |
| Local disposition | 180d | unchanged |

`not_mine` stays user-specific, non-permanent and attention-only: it writes a
row keyed on the user, it expires, and it produces no shared mutation. It has no
audit effect either — it is an answer about *routing on this reader's screen*.

*(`no_longer_covered` and `owned_elsewhere` keep their judgment rows: those are
statements about who covers the name, which is investment-process information.
`not_mine` on a workflow card is a statement about a task queue.)*

A key with no classified window returns **0**, and a zero-length snooze is not
sent — an action that silently does nothing is worse than one that admits it.

---

## 4. Every Done / Answered / Complete / Resolve action, classified

| # | Surface | Label | Underlying object | Real mutation | Exists? | Mobile calls it | Desktop calls it | Shared | Audit write today | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Mobile attention VerdictBar (`decision_required`) | **Answered** | `decision_requests` | status update | in `TradeIdeaDetailModal` only | ❌ | ❌ | yes | **`record_judgment` on the asset** | **B** |
| 2 | Mobile attention VerdictBar (other) | **Done** | `project_deliverables` / `trade_queue_items` | `markDeliverableDone` etc. | ✅ | ❌ | ✅ | yes | **`record_judgment` on the asset** | **B** |
| 3 | `buildAttentionCard` primary, no `can` | **Resolve** | — | none; navigates + `markRead` | n/a | ✅ | n/a | no | none | **B** |
| 4 | `buildAttentionCard` primary, `can.markDone` | **Mark done** | `project_deliverables` | `markDeliverableDone` | ✅ | ❌ (no `can`) | ✅ | **yes** | none | **A** |
| 5 | `buildAttentionCard` primary, `can.approve` | **Approve** | `trade_queue_items` | `approveTradeIdea` | ✅ | ❌ (no `can`) | ✅ | **yes** | none | **A** |
| 6 | `buildAttentionCard` menu, `can.reject` | **Decline** | `trade_queue_items` | `rejectTradeIdea` | ✅ | ❌ | ✅ | **yes** | none | **A** |
| 7 | `attention-feed/adapters` overflow | **Mark done** | `project_deliverables` | `MARK_DELIVERABLE_DONE` intent | ✅ | n/a (desktop) | ✅ | **yes** | none | **A** |
| 8 | `buildAttentionCard` menu, `can.defer` | **Defer a day** | `trade_queue_items.revisit_at` | `deferTradeIdea` | ✅ | ❌ | ✅ | **yes — shared defer** | none | **A**, mislabelled |
| 9 | Command centre task list | complete | `personal_tasks.completed` | `useCommandCenter:663` | ✅ | — | ✅ | no — private object | none | **A** (private) |
| 10 | Checklist status chip | "Done" | `asset_checklist_items` | status display, not an action | n/a | — | — | — | none | not an action |

**Findings**

- **Rows 1–2 are the defect.** Two completion verbs, no completion mutation on
  the calling surface, and a fabricated investment judgment as a side effect.
- **Row 3** was a weaker version of the same lie: a completion word over a
  navigation.
- **Rows 4–8 are correct and were never wired on mobile** — `buildAttentionCard`
  has accepted a `can` capability since it was written and the mobile feed has
  never passed one.
- **Row 8 is genuinely mislabelled**: "Defer a day" writes `revisit_at` on the
  shared `trade_queue_items` row, so one analyst's defer moves the item for
  everyone. It belongs in class A, and its label should say so. **Flagged, not
  changed** — it is a shared-workflow semantic and out of scope.
- No card in the codebase is class **C** or **D**. Investment judgments already
  have their own explicit vocabulary on the research cards, and nothing is
  ambiguous enough to need hiding.

---

## 5. Corrected Done semantics

```
TRUE SHARED RESOLUTION  (class A — capability-gated)
  Done / Mark done / Approve / Decline
    → authorized shared mutation on the underlying object
    → personal attention state may update as a consequence
    → NO investment-judgment row
    → a workflow-completion audit row later, once audit_events is trusted

PERSONAL ACKNOWLEDGEMENT  (class B)
  Reviewed
    → personal attention state ONLY
    → no shared mutation, no judgment row, no quick thought

INVESTMENT JUDGMENT  (class C)
  Thesis intact / Cases outdated / Not price driven / No longer covered
    → durable attributed judgment (audit_events)
    → personal attention consequence from judgment-policy
```

The three are never combined implicitly. The gate is `intent`, which is now a
three-member union on `VerdictOption` and is read in exactly one place —
`recordSignalJudgment` returns `skipped` for `intent: 'attention'` before it
reaches `audit_events`.

**What one tap produced before vs. now**, on "Done" on an overdue deliverable:

| Effect | Before | Now |
|---|---|---|
| Local suppression, 30d | ✅ | ✅ (as `reviewed`) |
| `acknowledge_attention` | ✅ but **inert** | replaced by a real 30d snooze |
| `audit_events` `judgment_key: 'done'` on AAPL | ✅ **fabricated** | **removed** |
| Private `quick_thoughts` note on AAPL | ✅ | **removed** |
| Resolve the shared object | ❌ | ❌ — and the button no longer claims to |

---

## 6. Renamed actions

| Was | Now | Reason |
|---|---|---|
| `answered` / **"Answered"** | `reviewed` / **"Reviewed"** | no resolution mutation on this surface |
| `done` / **"Done"** | `reviewed` / **"Reviewed"** | same |
| **"Resolve"** (fallback primary) | **"Review"** (`open_item`) | it navigates; it does not resolve |

`answered` and `done` remain **classified** in `POLICY` — stored records carry
them, and an unclassified key silently stops suppressing — but nothing writes
them. They now carry `resolves: false`, so no stored record claims a shared
resolution either.

Unchanged: **Mark done**, **Approve**, **Decline** keep their words, because
they are gated on `can` and the surface that passes `can` performs the mutation.

---

## 7. Acknowledge behaviour — **option A**, bounded

`acknowledge_attention` sets `read_state`; `computeAttention` filters on
`dismissed_at` and `snoozed_until` only (`useAttention.ts:1402-1407`).
`read_state` is selected, merged onto the item (`:1416`) and **read by nothing**.
The action was behaviourally meaningless.

**Recommendation: A — remove from the active queue, for a bounded window,
derived from `judgment-policy`.** Not permanent, and not a demotion: the
attention pipeline has no penalty term to demote with, so B is not implementable
without new ranking machinery, and C leaves the reader clearing the same list
every morning.

**Exact durations**, all from the existing table rather than newly invented:

| Action | Window | Why this number |
|---|---|---|
| Reviewed | **30 days** | `reviewed` is `confirmed`; it matches Dismiss, and it is the window `answered`/`done` already carried |
| Snooze | **7 days** | the button says "Snooze for a week" |
| Dismiss | **30 days** | `feed_dismissed` |
| Defer | **3 days** | `defer`; explicitly the weakest |
| Not mine | **180 days** | product decision, §3 |

Implemented via the existing `snooze_attention` RPC — no schema change. Because
`snoozed_until` is what the attention filter already reads, the item leaves the
queue and comes back on its own, which is what makes the action honest.

`acknowledge_attention` is left in place and simply no longer called from the
feed. Whether to retire it is a separate decision; `read_state` may still be
wanted for an unread badge.

---

## 8. `attention_user_state` schema delta (designed, **not executed**)

```sql
-- Additive only. Zero rows in production, so no backfill and nothing reinterpreted.
alter table attention_user_state
  add column if not exists signal_type     text,
  add column if not exists disposition_key text,
  add column if not exists intent          text
    check (intent in ('judgment','feed_quality','attention','triage')),
  add column if not exists dismissed_until timestamptz;
  -- org_id: see §8.1. Deferred pending the decision recorded there.

comment on column attention_user_state.dismissed_at is
  'When the reader dismissed it. Permanent for attention items.';
comment on column attention_user_state.dismissed_until is
  'Bounded dismissal for feed cards. dismissed_at stays the act; this is the expiry.';

create index if not exists idx_aus_signal_live
  on attention_user_state (user_id, dismissed_until, snoozed_until)
  where attention_id like 'signal:%';

create or replace function set_feed_disposition(
  p_key             text,
  p_signal_type     text,
  p_disposition_key text,
  p_intent          text,
  p_snoozed_until   timestamptz,
  p_dismissed_until timestamptz
) returns void
language plpgsql
security definer
set search_path = public, pg_temp        -- see §9
as $$
begin
  if p_key is null or p_key not like 'signal:%' then
    raise exception 'set_feed_disposition: key must be namespaced';
  end if;
  insert into attention_user_state (
    user_id, attention_id, signal_type, disposition_key, intent,
    snoozed_until, dismissed_until
  ) values (
    auth.uid(), p_key, p_signal_type, p_disposition_key, p_intent,
    p_snoozed_until, p_dismissed_until
  )
  on conflict (user_id, attention_id) do update set
    signal_type     = excluded.signal_type,
    disposition_key = excluded.disposition_key,
    intent          = excluded.intent,
    snoozed_until   = excluded.snoozed_until,
    dismissed_until = excluded.dismissed_until,
    updated_at      = now();
end;
$$;
```

`user_id` is derived from `auth.uid()` and is not a parameter. The namespace
guard stops this RPC being used to write attention-item rows.

Also required (independent, ship separately):

```sql
-- The read-then-write race in the three action-loop hooks.
create unique index concurrently asset_followup_suppressions_key
  on asset_followup_suppressions (user_id, asset_id, followup_type, view_user_id)
  where view_user_id is not null;
create unique index concurrently asset_followup_suppressions_key_null
  on asset_followup_suppressions (user_id, asset_id, followup_type)
  where view_user_id is null;
```

### 8.1 Is `organization_id` needed? — **analysed, and the answer is no for V1**

The consolidation doc recommended adding it. Examined against the actual
threat model, it is not justified here:

**Against adding it**

- **Ownership is sufficient for authorization.** Every row is
  `user_id = auth.uid()`, on all four verbs, with `WITH CHECK`. There is no read
  path, no aggregate and no admin view. `org_id` would add no access control
  that ownership does not already provide.
- **The subject carries its own tenancy.** `signal:<type>:<subject>` is derived
  from a card the feed only built because org-scoped queries returned the
  underlying row. A user cannot obtain a subject key for an org they cannot see,
  so a cross-org key is unreachable rather than merely unauthorized.
- **The blast radius of a leak is one bit.** The worst case is that a user in two
  orgs sees a card suppressed in the wrong one — a card they are entitled to see
  either way. No data crosses a boundary; only the reader's own screen state does.
- **It is not free.** `org_id NOT NULL` needs a trigger reading
  `users.current_organization_id`, and the P0 work has already established that
  this column is user-mutable and validated separately. A tenancy column whose
  value is derived from something the user can change is weaker than no column
  and looks stronger.

**For adding it**

- Defence in depth, and consistency with `quick_thoughts`.
- Per-org measurement of suppression rates.

**Decision: defer.** Add `org_id` **nullable, unenforced, populated for
analytics** if and when suppression rates need per-org measurement. Do not gate
V1 on it, and do not make it `NOT NULL` until the `current_organization_id`
question is settled by the P0 work. Recorded here so the omission is a decision
rather than an oversight.

*(Note this differs from the consolidation doc's recommendation. The earlier one
was reasoning from consistency; this one is reasoning from what the column would
actually defend against.)*

---

## 9. RPC / `search_path` security delta (designed, **not executed**)

All seven existing attention RPCs are `SECURITY DEFINER` with **no pinned
`search_path`** and are `EXECUTE`-granted to `anon`.

```sql
alter function acknowledge_attention(text)                    set search_path = public, pg_temp;
alter function dismiss_attention(text)                        set search_path = public, pg_temp;
alter function dismiss_attention_with_reason(text,text,text)  set search_path = public, pg_temp;
alter function mark_attention_read(text)                      set search_path = public, pg_temp;
alter function snooze_attention(text,timestamptz)             set search_path = public, pg_temp;
alter function undismiss_attention(text)                      set search_path = public, pg_temp;
alter function unsnooze_attention(text)                       set search_path = public, pg_temp;

revoke execute on function acknowledge_attention(text) from anon;   -- ×7
revoke all on attention_user_state         from anon;
revoke all on asset_followup_suppressions  from anon;
revoke all on rating_ev_suppressions       from anon;

-- Re-declare the four attention_user_state policies TO authenticated,
-- preserving auth.uid() = user_id on USING and WITH CHECK for every verb.
```

**Do not fold this into the P0 hotfix.** It is a distinct hardening change to a
different subsystem, it touches grants and function definitions, and bundling it
would make the P0 change harder to review and harder to roll back. It needs
Main Control's explicit approval as its own migration.

Priority: the unpinned `search_path` on seven `SECURITY DEFINER` functions is
the sharpest item — the repo's own `schema-baseline.mjs` already tracks
`search_path_pinned` as a security property, so this is a known standard being
missed rather than a new requirement.

---

## 10. Identity fix — preserved, and re-proved

All five invariants from Phase 5 hold, each with a test:

| Invariant | Test | Result |
|---|---|---|
| Distinct workflow cards on one asset stay independent | `does not let one AAPL workflow card suppress another` | ✅ |
| Mismatched `source_type`/`attention_type` no longer breaks suppression | `agrees with the card the builder actually emits` | ✅ |
| Cards with no linked asset get a stable identity | `keys a workflow item with no linked asset on the item, not on nothing` | ✅ |
| `applyFeedback` follows canonical identity | uses `dispositionEntityFor` (`MobileDashboard.tsx`) | ✅ |
| Post feedback cannot suppress all posts on an asset | `keys a post on the post, so one answer cannot silence a colleague` | ✅ |
| **Asset-level machine findings unchanged** | `leaves asset-level machine findings keyed on the asset` | ✅ |

---

## 11. V1 implementation sequence, after the P0 freeze

**Already done in this worktree (no schema, no deploy):**

0. One policy clock; `Reviewed` semantics; fabricated judgment write removed;
   identity fix. See §12.

**After the freeze lifts, in order:**

1. **Hardening migration** (§9) — grants, `search_path`, policies `TO
   authenticated`. Separate PR, Main Control approval, staging first.
   *Independent of everything below.*
2. **`asset_followup_suppressions` unique indexes** (§8) + convert the three
   action-loop hooks to upserts. Independent.
3. **Additive migration** (§8) — 4 columns, 1 RPC, 1 index. Staging first.
4. **`disposition-sync.ts`** — `syncDisposition()` / `fetchDispositions()`,
   errors swallowed, never blocking the UI.
5. **Dual-write behind a flag.** `recordTriage`, `recordSignalJudgment`,
   `applyFeedback` each gain one call. No read change. Observe RPC success rate.
6. **`useFeedDispositions`** + read flip, `localStorage` as fallback, server wins
   on conflict.
7. **Lazy one-time upload** of still-valid local records, guarded by a version
   flag. ≤400 rows, one batched call, once per browser.
8. **Narrow the attention state fetch** with `not.like('attention_id','signal:%')`.
9. **Flag on for everyone**; local store demoted to cache.
10. **Remove the local read path** after a release + 180 days.

**Deliberately still out of scope:** wiring `can` on mobile so the real
resolution verbs appear (§4 rows 4–8); relabelling the shared "Defer a day"
(§4 row 8); impressions; realtime; consolidating the desktop `localStorage`
stores; any use of `audit_events` as trusted infrastructure.

---

## 12. Files touched

**This pass**

| File | Change |
|---|---|
| `src/lib/signals/judgment-policy.ts` | `quietMsFor` / `quietHoursFor` / `quietUntil` — the one clock. `reviewed` classified; `answered`/`done` retained with `resolves: false`. |
| `src/components/mobile/MobileDashboard.tsx` | Reviewed replaces Done/Answered, `intent: 'attention'`; snooze/dismiss/verdict windows derived from policy; `acknowledge` dropped; quick thought gated to `intent: 'judgment'`. |
| `src/lib/signals/judgment-log.ts` | `intent` union widened; `attention` returns `durable: 'skipped'` before reaching `audit_events`. |
| `src/components/signals/VerdictBar.tsx` | `intent` union widened, documented. |
| `src/lib/signals/builders/legacy-kinds.ts` | `Resolve` fallback → `Review` (`open_item`); `Mark done` / `Approve` unchanged. |
| `src/lib/signals/__tests__/feed-triage.test.ts` | +7 tests (policy clock, Done semantics). |
| `docs/decision-memory-v1.md` | this file |

**Previous pass, preserved:** `legacy-kinds.ts` (`attentionCardType` /
`attentionCardId`), `dispositions.ts` (`INSTANCE_SURFACES`),
`MobileDashboard.tsx` (identity), `feed-triage.test.ts` (+7 identity tests).

**Not touched:** no migration file, no SQL run, `feed-priority.ts`,
`lib/audit/*`, the two domain-specific suppression tables, all desktop surfaces.

---

## 13. Tests

```
src/lib/signals/__tests__/feed-triage.test.ts        22 passed
src/lib/signals + src/components/mobile + signals   644 passed
```

14 tests added across the two passes:

**Identity (7)** — workflow cards independent on one asset · same card stays
suppressed · assets independent · no-asset items get a stable key · machine
findings still key on the entity · builder/ranker vocabulary agreement · unknown
type falls back.

**Policy clock and Done semantics (7)** — `not_mine` is 180 days in both units ·
triage windows match the button labels · unclassified keys return 0 · derived
windows agree with what `acknowledgmentFor` enforces · `reviewed`/`answered`/
`done` all `resolves: false` · `reviewed` still buys 30 days · **no completion
verb without the capability to complete** (`Review` without `can`, `Mark done`
with it).

4 test files fail to collect on `Missing Supabase environment variables` —
**pre-existing**, verified against a clean tree (4 failed / 389 passed before any
change). `npm run typecheck` reports no errors in any touched file.
