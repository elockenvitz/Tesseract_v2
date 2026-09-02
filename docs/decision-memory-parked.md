# Decision memory / disposition lane — PARKED

**Status:** parked 2026-09-02. Not merged, not rebased, not applied anywhere.
**Branch:** `audit/decision-memory`
**Worktree:** `C:\dev\tesseract-decision-memory`
**Predecessors:** `decision-memory-v1.md` → `decision-memory-architecture.md` →
`decision-memory-consolidation.md` → `shared-action-semantics.md` → this file.

This lane is closed for now. Nothing here is scheduled; all of it is input to a
later convergence pass. **Do not resume it as its own lane** — resume it as a
step inside convergence, on current ancestry.

---

## 0. Ancestry — read this before touching anything

| | |
|---|---|
| Branch HEAD when parked | `6931a4d` + one checkpoint commit (see §9) |
| Merge-base with `main` | `db85265` |
| Commits unique to this branch | 2 (the pre-existing WIP snapshot, and the Stage 4A checkpoint) |
| **Commits on `main` not in this branch** | **63** |
| Mobile feed work `0706007` | **absent** (`feat/mobile-research-v2`) |
| Desktop convergence `14b41ef` | **absent** (`feat/desktop-convergence`) |

**This branch is stale by construction.** It was cut before both of the product
lanes it overlaps, and 63 commits have landed on `main` since. Everything below
is a *decision* to port, not a *diff* to apply.

---

## 1. Locked product decisions

These are the conclusions worth surviving. They are about semantics, not code,
and they should hold whatever the surrounding code looks like when convergence
happens.

### A. Personal disposition never mutates the shared object

Snooze, dismiss, reviewed/settled, rejected, "not mine", and personal defer are
**one user's state about one object**. They change what that reader sees and
nothing else. A colleague loading the same asset, deliverable or queue item sees
exactly what they saw before.

The model is `user × signal/object × disposition`. The investment or workflow
object stays shared truth.

### B. Shared actions stay shared, and say so

Approve, reject, mark done, and an explicit shared trade-idea defer/revisit
genuinely change the object for everyone. They are legitimate, they need
authority, and they must be reached only from a control that names what it does.

The rule that connects A and B: **a button must not claim an effect its surface
cannot produce, and must not produce one it does not claim.** The mobile
attention card already applies this — `Done` and `Answered` were withdrawn
rather than reworded, because nothing on that surface could resolve anything.

### C. The personal "Defer" bug must not return

Prior behaviour, on the desktop attention card:

```
Defer  (looks personal, sits beside Snooze)
  → source_type === 'trade_queue_item'
  → UPDATE trade_queue_items SET revisit_at = …     ← the SHARED row
```

Two failures in one control:

1. `collectTradeQueueItems` fetches every `deciding` item in the organization
   and shows it to everyone who has not voted. `useCommandCenter` and
   `SimulationPage` both render `revisit_at` as time pressure. So one analyst's
   "not today" moved the revisit time **the whole desk reads**.
2. The attention filter reads `dismissed_at` and `snoozed_until` only.
   `revisit_at` appears nowhere in it — so the deferral **did not defer the item
   for the person who clicked**.

A personal intent with a shared effect and no personal effect. Whatever the
attention surfaces look like at convergence, re-check this seam by hand.

### D. `localStorage` alone is not durable enough

Every feed disposition — including 180-day answers about positions — lived in
`localStorage` and nowhere else. A cleared cache, a second device or a different
browser and the reader is asked everything again, and "what has this analyst
deferred" has no answer at all.

Intended model: **durable `user × signal/object × disposition`**, with local
state kept as the synchronous first paint and the offline fallback. Server wins
on conflict, because it is the only store that sees every device.

### E. Durable-state failure fails **open**

A failed or unresolved durable read yields no suppression, so a card the reader
already answered may appear once more. That is the correct direction: showing
something twice is a nuisance; hiding something the reader never dismissed is a
silent data loss they cannot detect. Writes never throw and never block triage.

---

## 2. Locked technical concepts

Concepts, stated so they can be rebuilt. See §3 for the code that currently
expresses them and why that code is not portable as-is.

| Concept | What is locked |
|---|---|
| **Three-way ownership contract** | `personal` / `shared` / `shared_ack`, as a lookup table plus predicates — not a dispatcher or registry. Enforcement is a test asserting every writable verb is classified. |
| **`shared_ack` declared and empty** | Nothing today is a shared acknowledgment. Keeping the category visible-but-empty stops a future "the desk has seen this" landing in `shared` and quietly mutating an object. Two categories would be a lie by omission. |
| **`signal:<type>:<subject>` namespace** | Feed rows namespaced away from attention rows, which hold 32-char hex hashes. Disjoint by shape → one table, no collision. Only the first separator after the prefix is structural (subjects like `idea:recommendation:<uuid>` contain their own colons). |
| **`dispositionEntityFor` identity** | Entity for a claim the data will make again tomorrow; card id for a one-off artefact somebody created (`desk`, `workflow`). Local and durable stores derive identity from the *same function*, so they cannot disagree. **See §5 — this rule is not finished.** |
| **Reuse `attention_user_state`** | It is already `UNIQUE (user_id, attention_id)` over an opaque text key with `auth.uid()` RLS on all four verbs — i.e. exactly `user × object`. It was missing a caller, not a sibling. A second table would have been the same key, policies and erasure entry, plus a standing obligation to keep two windows in step. |
| **`set_feed_disposition` RPC shape** | `SECURITY DEFINER`, `search_path` pinned, **takes no user id**, enforces the namespace server-side. The absence of a user parameter is the strong half of the guarantee: RLS rejects a forged id, but a call shape with nowhere to put one cannot express the attempt. |
| **`dismissed_until` ≠ `dismissed_at`** | `dismissed_at` is the permanent timestamp of the act and is read as a soft delete. Feed dismissals are *bounded* (30d / 180d). Overloading the existing column would turn a window into a deletion. |
| **Server-derived org** | Stamped by trigger from `current_org_id()`, never accepted from the client — the `quick_thoughts` rule. A user in two pilot orgs must not share one suppression namespace. |
| **One clock** | Windows come from `judgment-policy.ts` and nowhere else. The durable row stores an absolute timestamp computed from it. Hardcoded windows at call sites are what produced a 173-day divergence between the two stores. |

---

## 3. Prototype implementation — MUST be reconciled, not cherry-picked

All of the following exists on this branch and **none of it should be applied to
current code without re-auditing the call sites first.**

### New files (concept-carrying, most portable)

| File | Reconciliation risk |
|---|---|
| `src/lib/signals/disposition-scope.ts` | **Low.** Pure, no imports beyond types. The `ACTION_OWNERSHIP` table must be re-derived against the verbs the app writes *at convergence time* — its `WRITABLE` test list is a snapshot of 2026-09-02 vocabulary. |
| `src/lib/signals/disposition-sync.ts` | **Medium.** Depends on the migration existing. Contains `as never` casts matching the repo's existing idiom for untyped Supabase tables; if `types/database.ts` has been regenerated since, drop them. |
| `src/hooks/mobile/useFeedDispositions.ts` | **Medium.** Encodes MobileDashboard's once-per-mount snapshot rule. If the current feed has changed how it snapshots, this hook's contract changes with it. |
| `src/lib/signals/feed-triage-log.ts` | **Low.** Exists only to keep `feed-triage.ts` gallery-pure (`scripts/gallery-purity.mjs`). Verify that constraint still holds. |
| `src/lib/signals/__tests__/disposition-ownership.test.ts` | **Low**, and the most valuable artefact here. 20 tests. Port these *first* — they state the contract executably. |
| `supabase/migrations/…_personal_state.sql.draft` | **See §6.** |
| `supabase/tests/feed-disposition-ownership.sql` | Never executed. See §6. |

### Modified files (all stale seams)

| File | Overlap | Warning |
|---|---|---|
| **`src/components/mobile/MobileDashboard.tsx`** | **Touched by BOTH `0706007` and `14b41ef`** | **DO NOT BLINDLY CHERRY-PICK.** The change here is 3 semantic edits (state cell → hook; durable write in `applyFeedback`; `recordTriage` → `recordTriageDurably`). Port the *semantics* onto whatever this file has become. The diff will not apply and should not be forced. |
| `src/components/attention/AttentionCard.tsx` | Not touched by either absent branch **as of 2026-09-02** — but `main` has moved 63 commits | **DO NOT BLINDLY CHERRY-PICK.** This carries the §1C fix. Re-read `handleDefer` on current code before porting; the fix is "Defer calls `onSnooze` for every source type", not a specific hunk. |
| `src/components/attention/AttentionSection.tsx`, `AttentionDashboard.tsx`, `AttentionPage.tsx`, `PrioritizerPage.tsx` | prop plumbing only | Mechanical `onDefer` → `onDeferShared` rename. Re-derive from the current prop graph; do not assume the same four files. |
| `src/hooks/useAttention.ts` | shared seam | One-line namespace exclusion on the state fetch. Payload hygiene, not correctness. |
| `src/lib/signals/judgment-log.ts` | signals lane | Adds a `state` field to `SignalJudgmentResult`, independent of `durable`. The *separation* is the point: a macro card writes no audit row and must still remember the answer. |
| `src/lib/signals/__tests__/judgment-log.test.ts` | — | Needed a `../../supabase` stub once `judgment-log` gained a direct import. |

### Deliberately NOT touched on this branch

`judgment-policy.ts` (contested with `0706007`), `feed-priority.ts`,
`feed-triage.ts`, `dispositions.ts`, `contract.ts`, `builders/legacy-kinds.ts`,
and both domain-specific suppression tables.

---

## 4. Stale-ancestry summary

> **Rule for convergence: port the semantic change onto current ancestry.
> Do not cherry-pick, rebase, or merge this branch.**

The reasoning is not caution for its own sake. This branch predates both product
lanes that own these surfaces, so a clean apply would mean one of two things —
either the file has not changed (in which case porting by hand costs nothing) or
it has (in which case a clean apply is the dangerous outcome, not the safe one).

The artefacts worth carrying forward, in order of durability:

1. **The tests** — `disposition-ownership.test.ts` states the contract
   executably and depends on almost nothing.
2. **`disposition-scope.ts`** — pure, and the contract in one readable table.
3. **The migration's *design*** — not the file. See §6.
4. **Everything else** — read as a worked example, then rewrite.

---

## 5. UNRESOLVED — disposition identity vs portfolio

**Disposition identity must follow the semantic subject of the signal.**

Today's signals key on the asset, and that is correct *for today's signals*:
"AAPL has no thesis on record" is true or false about AAPL, not about a
portfolio's copy of AAPL. The current tests pin that, and pin that pair-trade
legs collapse to one key for the same reason.

**Do not generalise this to signals that do not yet exist.** A Portfolio signal
may carry a portfolio in its semantic subject, and asset-global keying would
then be wrong in a way that is silent and expensive:

> "AAPL framework break in **Growth Fund**"
> "AAPL framework break in **Defensive Fund**"

are plausibly two findings. Answering one must not silence the other. Equally,
if the finding really is one claim about the name, keying per portfolio would ask
the reader the same question once per fund — which is the failure in the other
direction.

**Before wiring suppression for any portfolio-scoped signal, audit whether the
identity should be `asset` or `asset × portfolio`.** `dispositionEntityFor`
already encodes one such distinction (entity for a recurring claim, card id for a
one-off artefact); a portfolio dimension would be a **third case**, not a blanket
switch. The caveat is also recorded at the assumption itself, in
`disposition-ownership.test.ts`.

No implementation now. This is a question to answer, not a task to schedule.

---

## 6. Migration status — HARD GATE

**File:** `supabase/migrations/20260902090000_feed_dispositions_personal_state.sql.draft`

**Status: DRAFT. UNAPPLIED. Never run against any database** — not production,
not staging, not a local instance.

Renamed to a `.draft` suffix so no migration runner can pick it up, following the
existing `…_coverage_self_service_rollback.sql.disabled` precedent in the same
directory. **Restoring the `.sql` extension is itself a deliberate act** and must
not happen as a side effect of tidying.

`supabase/tests/feed-disposition-ownership.sql` (12 assertions) has likewise
**never been executed anywhere**. It creates and deletes organizations, auth
users and memberships — never point it at production.

### Preconditions before this may EVER be applied

Recorded in full in the migration header, and repeated here because the file is
easy to open and the header is easy to scroll past:

1. Re-read the **live** production schema of `attention_user_state`. The file was
   written against a read-only capture of **2026-08-28**. The repo has no
   migration for that table at all, and migrations here do not describe
   production.
2. Verify the columns — particularly that nothing named `dismissed_until` has
   since appeared with a different meaning.
3. Verify the unique constraint is still `UNIQUE (user_id, attention_id)`. The
   RPC's `ON CONFLICT` depends on it.
4. Verify RLS is enabled and all four policies still compare to `auth.uid()`.
   The migration *recreates* them; recreating a predicate that has since been
   deliberately changed would silently revert that change.
5. Verify the seven existing attention RPCs still exist and behave as documented.
6. Verify `current_org_id()` still validates membership (migration
   `20260826100000`). The org-stamping trigger is only as safe as that function.
7. Run the SQL test against a **non-production** environment first.

Treat "reviewed" and "verified" as different words. This file has been reviewed.

---

## 7. Open items — preserved, not scheduled

None of these were solved. None should be solved as part of resuming this lane.

| # | Item | Where it came from |
|---|---|---|
| 1 | `search_path` unpinned on all 7 existing attention RPCs | consolidation §9 S3 |
| 2 | `asset_followup_suppressions` has no unique constraint on its logical key; three hooks do read-then-insert-or-update, so two concurrent dismissals insert two rows and the next `maybeSingle()` **throws** | consolidation §1.2 |
| 3 | `rating_ev_suppressions.view_scope_type = 'firm'` is a dead branch that reads like shared state and could never be — RLS restricts every read to the creator | consolidation §1.3 |
| 4 | `acknowledge_attention` is durably recorded and **behaviourally inert** — it writes `read_state`, which the attention filter never reads | consolidation §5.1 |
| 5 | Explicit shared defer needs a UI and a name. `onDeferShared` is plumbed and wired to nothing, deliberately | this pass, §1C |
| 6 | `localStorage` → durable transition: no lazy upload was built. Users re-answer a handful of cards once | this pass |
| 7 | `asset` vs `asset × portfolio` disposition identity | §5 |

Items 1–4 are independent of this lane and could ship separately at any time.

---

## 8. Future integration order

For the convergence pass, not for now:

1. Start from **current** shared/mobile/desktop ancestry. Not from this branch.
2. Re-audit the disposition call sites as they then exist.
3. Re-verify the live production schema (§6).
4. Port the **personal/shared ownership contract** first — it is the thing
   everything else is checked against.
5. Fix **personal Defer** semantics (§1C).
6. Add durable disposition storage.
7. Integrate the current mobile feed.
8. Integrate Desktop Today / attention surfaces.
9. Test **cross-user isolation** — A dismisses, B still sees.
10. Only then consider applying the migration.

Steps 4 and 5 are worth doing even if 6–10 never happen: the contract and the
Defer fix are correctness, and durability is an improvement.

---

## 9. Resume checkpoint

Resume by **reading this file**, not by checking out this branch to work in.

```
worktree   C:\dev\tesseract-decision-memory
branch     audit/decision-memory
read       docs/decision-memory-parked.md          ← start here
then       docs/decision-memory-consolidation.md   ← the live-schema audit
then       src/lib/signals/disposition-scope.ts    ← the contract, in one table
then       src/lib/signals/__tests__/disposition-ownership.test.ts
```

The branch exists to preserve the reasoning and the tests. It is not a base to
build on.
