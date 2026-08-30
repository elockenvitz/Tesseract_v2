# Shared action semantics — audit and product contract

**Status:** audit only. No code, no SQL, no RPC, no `audit_events`, no deploy, no merge.
**Branch:** `audit/decision-memory`
**Date:** 2026-08-28
**Predecessors:** `decision-memory-architecture.md`, `decision-memory-consolidation.md`, `decision-memory-v1.md`

**Confirmed decisions carried in:** no `org_id` on `attention_user_state` for V1
(ownership via `auth.uid()` is the authority); `Defer` is shared-workflow
language and its shared mutation must not be converted to a personal one.

---

## 0. Headline

`Defer a day` is not the worst case. **`AttentionCard`'s "Defer" control is a
shared mutation for one row type and a personal snooze for every other, with an
identical label, an identical menu, and an identical confirmation toast.**

```ts
// AttentionCard.tsx:510-531
// For trade items, use onDefer; for others, use onSnooze
if (item.source_type === 'trade_queue_item' && onDefer) {
  await onDefer(item.source_id, hours)      // SHARED: trade_queue_items.revisit_at
  setResolutionMessage(hours >= 24 ? 'Deferred' : `Deferred ${hours}h`)
} else if (onSnooze) {
  await onSnooze(item.attention_id, hours)  // PERSONAL: localStorage
  setResolutionMessage(hours >= 24 ? 'Deferred' : `Deferred ${hours}h`)
}
```

Same button, same `4 hours / Tomorrow / Next week` menu, same word back. Whether
the analyst just moved a deadline for the whole desk or hid a row on their own
laptop is decided by `source_type`, which is invisible. This is a stronger
version of the defect already fixed on mobile: there, one control claimed the
wrong class; here, one control **is** both classes and never says which.

Second finding: **"Defer" means personal in six places and shared in three**, and
the word carries no information about which. The vocabulary is the problem, not
any single label.

---

## 1. Every shared-workflow-language action found

`P` = personal · `S` = shared · `S/P` = both, selected at runtime

| # | Label | Component | Mutation | Object | Class | Capability check | Others observe | Judgment written | Personal state changes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Defer** → 4h / Tomorrow / Next week | `attention/AttentionCard.tsx:505` | `deferTradeIdea` **or** `snoozeItem` | `trade_queue_items.revisit_at` **or** `localStorage` | **S/P** | none — branches on `source_type` | **sometimes** | no | sometimes |
| 2 | **Defer a day** | `builders/legacy-kinds.ts:1231` | `deferTradeIdea` | `trade_queue_items.revisit_at` | **S** | `can.defer` | **yes** | no | no |
| 3 | **Defer** (overflow) | `attention-feed/adapters.ts:139,259` | intent `SNOOZE` → `snoozeItem` | `localStorage` (**no user key**) | **P** | none | no | no | yes |
| 4 | **Defer 1d** | `dashboard/mapGdeToDashboardItems.ts:428` | `snoozeItem` | `localStorage` (**no user key**) | **P** | none | no | no | yes |
| 5 | **Later today / Tomorrow / Next week** | `DecisionSystem`, `FocusStack`, `HeroDecisionCard`, `RankedDecisionList` | `useDashboardFeed.handleSnooze` → `snoozeItem` | `localStorage` (**no user key**) | **P** | none | no | no | yes |
| 6 | **Defer until:** Tomorrow / 1w / 2w / End of month / price / earnings / event | `trading/DecisionInbox.tsx:1323,2018` | `updateDecisionRequest` | `decision_requests.status='deferred'` + `deferred_until` | **S** | PM/admin via `portfolio_team` | **yes** | no | no |
| 7 | **Defer** (VerdictBar) | `MobileDashboard.tsx:3173,3187` | `recordDisposition` + `snooze_attention` | personal projection | **P** | none needed | no | no (`intent: attention`) | yes |
| 8 | **Done** | `attention/AttentionCard.tsx:644` | `markDeliverableDone` | `project_deliverables.completed` | **S** | `source_type` + handler present | **yes** | no | no |
| 9 | **Mark done** | `builders/legacy-kinds.ts:1199` | `markDeliverableDone` | `project_deliverables` | **S** | `can.markDone` | **yes** | no | no |
| 10 | **Mark done** (overflow) | `attention-feed/adapters.ts:266` | intent `MARK_DELIVERABLE_DONE` | `project_deliverables` | **S** | `feedType === 'deliverable'` | **yes** | no | no |
| 11 | **Approve** / **Confirm approve** | `attention/AttentionCard.tsx:730` | `approveTradeIdea` | `trade_queue_items.status='approved'` | **S** | `isTradeItem` + handler | **yes** | no | no |
| 12 | **Approve** | `builders/legacy-kinds.ts:1197` | `approveTradeIdea` | `trade_queue_items` | **S** | `can.approve` | **yes** | no | no |
| 13 | **Decline** | `builders/legacy-kinds.ts:1211` | `rejectTradeIdea` | `trade_queue_items.status='rejected'` | **S** | `can.reject` | **yes** | no | no |
| 14 | **Reject** | `attention/AttentionCard.tsx:~742` | `rejectTradeIdea` | `trade_queue_items` | **S** | `isTradeItem` + handler | **yes** | no | no |
| 15 | **Review** *(was Resolve)* | `builders/legacy-kinds.ts:1200` | navigate + `markRead` | none | **P** | fallback when no `can` | no | no | read only |
| 16 | **Reviewed** *(was Done/Answered)* | `MobileDashboard.tsx:3160` | `recordDisposition` + `snooze_attention` | personal projection | **P** | none needed | no | no (`intent: attention`) | yes |
| 17 | **Set Revisit Date** | `ideas/CardActions.tsx:171` | `onSetRevisit` — **no consumer passes it** | none | **dead** | — | — | — | — |
| 18 | **Revisit** | `trading/DecisionInbox.tsx:2044` | section heading for the defer picker | (row 6) | **S** | — | yes | no | no |
| 19 | **Revisit** | `thoughts/QuickThoughtCapture.tsx:104` | thought *category*, not an action | `quick_thoughts` | n/a | — | — | — | — |
| 20 | **Follow Up** | `ui/checklist/types.ts:144` | `RequestType` on a work request | `checklist_work_requests` | **S** | checklist perms | **yes** | no | no |
| 21 | **Resolve** | `ops/OpsSupportPage.tsx:200` | `updateBugStatus` | `bug_reports.status` | **S** | ops-only page | **yes** | no | no |
| 22 | **Complete** | `ExecutionStatusDropdown`, `AcceptedTradeBadge`, `TradeJournalTab` | execution status | `accepted_trades` | **S** | trade perms | **yes** | no | no |
| 23 | **Complete** / **Done** | `ProcessWalkthrough:431`, `checklist/types.ts:158` | status *display*, not actions | — | n/a | — | — | — | — |

**Rows 8–14 and 20–22 are correct.** Shared word, shared mutation, others
observe it, no hidden side effect. They are the model the rest should match.

---

## 2. Current semantics, summarised

**"Defer" carries no meaning today.** Nine controls use the word or its presets:

- **Personal** (rows 3, 4, 5, 7) — four surfaces
- **Shared** (rows 2, 6) — two surfaces
- **Both, chosen at runtime** (row 1) — one surface

Three of the four personal ones write `lib/attention-feed/snooze.ts`, which has
**no user key** — `tesseract.attentionFeedSnooze` is global to the browser, so on
a shared machine one analyst's "Defer" hides rows for the next person who logs
in. That is a pre-existing defect already recorded in
`decision-memory-architecture.md` §2.5; it matters more here because four
"Defer" controls route into it.

**"Done" is now honest everywhere.** Desktop (rows 8–10) mutates
`project_deliverables`; mobile no longer offers the word. No remaining control
labelled Done/Complete/Approve/Decline lacks a real mutation.

**No shared action writes an investment judgment.** The single case that did —
mobile's Done/Answered writing `record_judgment` against the linked asset — was
removed in the V1 pass. Every row above is clean on that column.

---

## 3. Misleading labels

| # | Label | Why it misleads | Recommended |
|---|---|---|---|
| 1 | **Defer** (`AttentionCard`) | **Two semantic classes behind one control.** The analyst cannot tell whether they moved a team deadline or hid a row. | **Split the control by class** — see §5 |
| 2 | **Defer a day** | Shared mutation, but "a day" reads like a personal snooze preset, and the sibling menu item is "Snooze for a week" | **Reschedule to tomorrow** |
| 3 | **Defer** (adapters overflow) | Personal snooze wearing shared-workflow language | **Snooze** |
| 4 | **Defer 1d** | Same | **Snooze 1d** |
| 5 | **Later today / Tomorrow / Next week** | Bare durations under a personal snooze; ambiguous rather than wrong | Keep the presets, label the control **Snooze** |
| 7 | **Defer** (VerdictBar) | Personal, but the word now reads shared given rows 2 and 6 | **Not now** |
| 15 | **Review** | correct as of the V1 pass | keep |
| 17 | **Set Revisit Date** | promises scheduling; **no consumer passes `onSetRevisit`**, so the menu item never renders | delete the dead prop, or wire it |

The rule applied throughout: **a personal-sounding label may never sit over a
shared mutation, and a shared-sounding label may never sit over a personal one.**
Both directions are violations; four of the six offenders are the second kind.

---

## 4. Multi-effect audit

| Action | Effects | Verdict |
|---|---|---|
| **Defer** (`AttentionCard`, row 1) | one class **or** the other, chosen by `source_type` | **SPLIT** — not multi-effect but *polymorphic*, which is worse: the user cannot predict which they get |
| **Reviewed** (mobile, row 16) | personal projection + durable `snooze_attention`, one window from `judgment-policy` | **KEEP** — two stores, one intent, one clock |
| **Snooze / Dismiss** (mobile attention card) | personal projection + `snooze_attention` | **KEEP** — same |
| **Defer** (VerdictBar, row 7) | personal projection + `snooze_attention` | **KEEP**, rename per §3 |
| **Done / Approve / Decline** (desktop, rows 8–14) | shared mutation + query invalidation only | **KEEP** — genuinely single-class |
| **Defer until** (`DecisionInbox`, row 6) | `decision_requests.status='deferred'` → **also counts as "Passed" in `useOutcomes:171`** | **NEEDS PRODUCT DECISION** — deferring a decision is recorded as an outcome against the idea. Intended? A deferral is not a pass. |
| **Set Revisit Date** (row 17) | none | **REMOVE** — dead prop |
| Mobile `applyVerdict` on a **research** card | local + `audit_events` + `quick_thoughts` | **KEEP** — three effects, each explicitly intended and documented; this is a real investment judgment |

### The one remaining implicit multi-effect

**Row 6 → `useOutcomes`.** `DecisionInbox`'s Defer writes
`decision_requests.status = 'deferred'`, and `useOutcomes.ts:171` counts
`rejected`/`deferred` requests together as **Passed** ideas. So "move this to
next week" is silently recorded as "the desk passed on this idea", and it will
appear in outcome attribution as a decision not to act.

That is a shared mutation producing a **second, unstated shared consequence** in
a different subsystem. Flagged as **NEEDS PRODUCT DECISION** — it is outcome
accounting, outside Decision Memory's boundary, and not something to change here.

### Latent trap, for whoever wires `can` on mobile

`buildAttentionCard` declares `approve`, `mark_done`, `reject` and `defer`
through `actions(...)` directly, **bypassing `feedActionIsRoutable`**. None of
those ids exists in `FeedActionKey` or `SURFACE_HANDLED`, so the moment a mobile
caller passes `can`, those buttons render and do nothing — the exact dead-end the
routability guard exists to prevent. Today it is unreachable because mobile
passes no `can` at all. **Wiring `can` on mobile must land together with handlers
for these four ids.**

---

## 5. Recommendation for `Defer a day` — and for row 1

### `Defer a day` → **"Reschedule to tomorrow"**

Of the three candidates:

| Candidate | Assessment |
|---|---|
| *Defer until tomorrow* | Accurate, but keeps "Defer", the word this audit shows carries no meaning in this product |
| *Move to tomorrow* | Clear and shared-sounding, but "move" suggests reordering a queue rather than changing a date |
| **Reschedule to tomorrow** | **Recommended.** "Reschedule" is unambiguously shared-workflow language — you cannot reschedule something only for yourself — it names the field being written (`revisit_at`), and it cannot be confused with the sibling "Snooze for a week" |

Reserving **Reschedule** as the shared verb and **Snooze** as the personal one
gives the two classes different words, which is what the vocabulary currently
lacks. "Defer" is then retired from new UI entirely; row 6's "Defer until:" may
keep its wording since it is already correct and widely used, or migrate to
"Reschedule until:" for consistency.

### Row 1 → **split the control**

Renaming is not enough where one control is both classes. The fix:

- `source_type === 'trade_queue_item'` **and** `onDefer` present →
  **"Reschedule"**, with the shared consequence stated (`"Moves this for
  everyone"`), and the toast **"Rescheduled for the desk"**.
- everything else → **"Snooze"**, toast **"Snoozed"**.

Same menu of durations, two labels, two messages. The branch already exists at
`AttentionCard.tsx:510`; only the strings and the confirmation differ.

---

## 6. Personal follow-up vs shared defer — the contract

**Both are needed, and they are different objects.** Confirmed by the code: rows
3–5 and 7 exist because people want to clear their own screen, and rows 2 and 6
exist because a PM genuinely needs to move a team deadline. Neither substitutes
for the other.

| | **Personal: "show me this later"** | **Shared: "move this item later"** |
|---|---|---|
| Question answered | "not on my screen right now" | "the team's deadline has moved" |
| Scope | one user | everyone who sees the object |
| Store | `attention_user_state.snoozed_until` (per V1) | the object's own date column |
| Who may do it | anyone who can see the card | whoever is authorised on the object |
| Expiry | bounded, from `judgment-policy` | whatever date was chosen |
| Reversible by | the same user, silently | anyone authorised; visible to all |
| Words | **Snooze**, **Not now**, **Dismiss**, **Reviewed**, **Not mine** | **Reschedule**, **Defer until**, **Complete**, **Approve**, **Decline** |
| Requires a reason | no | often — a date, and sometimes a trigger |
| Audit trail | none | belongs in the object's history |

**Contract rules**

1. A personal action **never** writes to a shared object.
2. A shared action **may** update personal attention state as a consequence
   (having rescheduled something, you probably do not want it on your screen
   today) — but it must be declared, not implicit.
3. A control must belong to exactly one class. Where the class depends on data,
   **render two controls**, not one that changes meaning.
4. Neither class creates an investment judgment.
5. A personal "remind me on a date, with a reason" is **not** attention state —
   it is an Action Engine object (`personal_tasks`). The test from
   `decision-memory-architecture.md` §9 stands: *if the user would expect to find
   it in a list later, it is a task; if they would only notice its absence, it is
   attention state.*

**No new scheduler.** Personal deferral remains a bounded suppression window with
no reason and no artefact. The moment a user wants to attach a date and a reason,
that is `personal_tasks`, which already exists and is already collected by
`useAttention`.

---

## 7. Final action semantics matrix — the product contract

For every future card action, fill this row before building it.

| Action | Personal attention state | Shared object mutation | Investment judgment | Durable audit event later | User-facing label |
|---|---|---|---|---|---|
| Snooze | ✅ 7d | ✗ | ✗ | ✗ | **Snooze** |
| Dismiss | ✅ 30d | ✗ | ✗ | ✗ | **Dismiss** |
| Reviewed | ✅ 30d | ✗ | ✗ | ✗ | **Reviewed** |
| Not now | ✅ 3d | ✗ | ✗ | ✗ | **Not now** |
| Not mine | ✅ 180d | ✗ | ✗ | ✗ | **Not mine** |
| In progress | ✅ 7d, non-suppressing | ✗ | ✗ | ✗ | **In progress** |
| Not useful / Wrong person | ✅ 180d | ✗ | ✗ | ✗ (telemetry) | **Not useful** / **Wrong person** |
| Reschedule | optional, declared | ✅ `revisit_at` / `deferred_until` | ✗ | ✅ workflow event | **Reschedule to…** |
| Complete | optional, declared | ✅ `completed` | ✗ | ✅ workflow event | **Complete** / **Mark done** |
| Approve | optional, declared | ✅ `status='approved'` | ✗ | ✅ workflow event | **Approve** |
| Decline | optional, declared | ✅ `status='rejected'` | ✗ | ✅ workflow event | **Decline** |
| Resolve (shared issue) | optional, declared | ✅ `status='resolved'` | ✗ | ✅ workflow event | **Resolve** |
| Thesis intact | ✅ 30d | ✗ | ✅ | ✅ judgment | **Thesis intact** |
| Cases outdated | ✅ 7d, non-suppressing | ✗ | ✅ | ✅ judgment | **Cases outdated** |
| Not price driven | ✅ 180d, scoped | ✗ | ✅ | ✅ judgment | **Not price driven** |
| No longer covered | ✅ 180d | ✗ | ✅ | ✅ judgment | **No longer covered** |
| Open / Review | read state only | ✗ | ✗ | ✗ | **Review** / **Open** |

**Three invariants**

- **At most one ✅ across the middle three columns per user gesture**, unless the
  extra effect is explicitly declared in the action definition and visible in the
  label or the confirmation.
- **A shared mutation requires a capability check**, and a surface without the
  capability must not render the control — not a disabled one, and not a
  personal-sounding substitute that quietly does something else.
- **The label names the strongest column that is checked.** Shared beats
  personal; judgment beats both.

---

## 8. Remaining Decision Memory blockers

| # | Blocker | Owner | Blocks |
|---|---|---|---|
| 1 | **P0 security release in flight** | P0 lane | everything below |
| 2 | `search_path` unpinned on 7 `SECURITY DEFINER` attention RPCs; `anon` holds full DML on all three suppression tables | **P0 Security lane** — explicitly not this one | the additive migration should land after, not before |
| 3 | Additive migration to `attention_user_state` (4 columns, 1 RPC, 1 index) | Decision Memory | the durable read/write path |
| 4 | `asset_followup_suppressions` has no unique constraint; three hooks do read-then-write | independent | correctness under concurrency |
| 5 | `lib/attention-feed/snooze.ts` has **no user key** — four "Defer" controls route into it | independent, and now higher priority | any consolidation of desktop personal state |
| 6 | `decision_requests.status='deferred'` counts as **Passed** in `useOutcomes` (§4) | product | outcome attribution correctness |
| 7 | Mobile passes no `can`, so no shared resolution is reachable there; and the four action ids are not routable (§4) | product + Decision Memory | mobile ever offering Complete/Approve |
| 8 | Label changes in §3 and §5 | product sign-off, then trivial to implement | user-facing correctness |

**Nothing above blocks the V1 read/write path except #1 and #3.** Items 4–7 are
independent and separately shippable.

---

## 9. Files touched

`docs/shared-action-semantics.md` — this file. Nothing else.

No code changed, no SQL written or executed, no RPC touched, no `audit_events`
access, no `search_path` work, nothing merged, nothing deployed.

**Decision Memory feature work is parked pending the P0 security release.**
