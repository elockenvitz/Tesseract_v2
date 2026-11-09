# Verification gate — contribution visibility P0

No further code changes in this lane. This is what the gate asks, what would
stop it, and the order things happen in.

---

## 1. Two kinds of stop condition, and I had them mixed

My runbook listed six hard stops. Only four are hard. The distinction is
whether the signal says **the fix is wrong** or **the fix is disruptive** — and
only the first can block a fail-closed security release.

### A. Security-invalidating — the fix is unsound or incomplete. STOP.

| Signal | Source | Why it invalidates |
|---|---|---|
| `invariant_violations_actor_is_not_author` **> 0** in any organization | `01-` final | `10-` §4 derives a revision event's visibility from the contribution authored by that event's **actor**. If an event's section has a contribution but none by the actor, the derivation is wrong and the policy would hand one analyst's prose to another. **Redesign §4.** |
| A policy on the five tables differs from C1/06, C1/07, C1/08 | `00-` Q1 | `10-` replaces policies by name. Replacing one nobody has read could drop a condition that is currently load-bearing. |
| A **view** over these tables without `security_invoker` | `00-` Q2 | Runs with its owner's rights and bypasses RLS entirely. `10-` would not close it, and shipping would imply we had. |
| A `SECURITY DEFINER` function over these tables executable by `anon`/`authenticated` | `00-` Q2 | Same: an independent read path the policy fix does not touch. |
| Any grant to `anon` on the five tables | `00-` Q3 | Pre-authentication exposure outranks this entire lane. |
| Revision table columns differ from `revision-service.ts` / `useAssetRevisions.ts` | `00-` Q1 | Neither table has a migration here. The policy is written against an inferred shape. |

The first is the only one that would make me redesign rather than re-aim.

### B. Operational impact — the fix is correct and someone loses access. DO NOT STOP.

**`n_6` is in this class, and I was wrong to list it as a hard stop.**

`n_6` counts contributions that at least one person can read today and only the
author will read after the fix. Every one of those is a contribution that is
currently readable by people it was never shared with — that is the defect, not
a cost of fixing it. A large `n_6` means the leak was *widespread*, which argues
for shipping sooner, not later.

It cannot make the release unsafe, because the failure direction is closed:
after the fix an affected contribution is visible to its author and nobody
else. Nothing is deleted, nothing is widened, and `90-rollback.sql` restores
the prior state exactly.

So `n_6` changes **sequencing and communication**, never go/no-go:

| `n_6` for a real organization | What it changes |
|---|---|
| 0 | Nothing. Ship. |
| 1–20 | Ship. Message the authors (`01-` #6b is the list) within the same day. |
| 21–100 | Ship, with the author notification drafted **before** apply so it goes out the same hour. |
| > 100, or most of that org's restricted corpus | Still ship — but tell the affected organizations first, because a visible change of that size arriving unannounced reads as a fault. Hours of notice, not a deferral. |

There is no threshold at which the honest answer becomes "leave the research
exposed." If a number ever looks like one, the right response is a staged
announcement, not a staged fix.

`n_7` (nodes reaching nobody) is also operational-impact context only: it
explains *why* population (b) of `n_6` exists. It is expected to be large — in
the live UI this organization's Division and Department have no direct members
and only one of three offered teams is reachable.

### C. Not a stop condition at all

`n_1`, `n_4`, `n_5`, `n_9` size the exposure. They inform the announcement and
the record. Large values are the argument **for** the release.

---

## 2. Execution order, and the one unsafe transition

```
1  read-only preflight (00-, 01-)            production, SELECT only
2  isolated database test, A→B→C→D           NEVER production
3  deploy the application fix                production app only, no SQL
4  wait for clients to pick up the new bundle
5  apply 10-policy-fix.sql                   production, one transaction
6  post-apply verification                   read-only
```

### Why 3 precedes 5, and why reversing them is the unsafe window

**Application before policy.** The application fix stops *new* audiences being
destroyed. The policy fix stops the *reading*. Doing the app first means that
during the gap the exposure continues — bad, but static — while no further
audiences are lost. The exposure has existed for months; a few more hours of it
is a smaller harm than permanently destroying more audience records, which
nothing can recover.

**Policy before application is the unsafe transition.** An old bundle still
submits `targetIds: []` on an ordinary content save. Under the *new* policy,
that contribution does not become org-readable — it becomes **owner-only**,
immediately and silently, and its targets are deleted with no record of what
they were. Fail-closed, so not a leak, but it manufactures exactly the
unrecoverable damage this lane exists to stop. Every save by a stale client
would do it.

**Step 4 is therefore not optional.** Between deploying the app and applying
the policy, clients with the old bundle are still running. They are the same
hazard as above. Keep the gap long enough for sessions to refresh, or force a
reload. I cannot tell you how long from here; that depends on how the app is
served and how long sessions live, and is worth confirming before step 5.

Two smaller notes:

- **Step 2 must never touch production.** The suite writes fixture users,
  org-chart nodes, contributions, history and revision events, then deletes
  them. Run it on a branch, a restored dump, or a local `supabase start`.
- **Rolling back the policy reopens the exposure.** `90-rollback.sql` restores
  C1/06–08 verbatim, including `OR team_id IS NULL`. It is the right lever if
  the fix breaks legitimate access; it is not a neutral undo.

---

## 3. Running the two scripts by hand in the Supabase SQL Editor

If no read-only connection is available. I am not involved in this step.

**Before you start**

- The SQL Editor runs as an owner role that **bypasses RLS**. That is fine here
  — every statement is a `SELECT` — but it is why every count is grouped by
  organization. Read the rows for the organizations that matter.
- Neither file writes. If a statement begins with anything other than `SELECT`
  or `WITH`, it is not from these files.
- Nothing needs installing. Both are self-contained and independent of the
  contribution-freshness lane.

**Procedure**

1. Open the SQL Editor on the production project.
2. Open `scripts/sql/contribution-visibility/00-verify-readonly.sql`.
3. **Run one query at a time.** The editor shows only the last result set when
   several are pasted together, and these files are deliberately a sequence of
   independent questions. Each is separated by a `-- Qn.` comment.
4. For each, copy the result grid back — including a header row, and including
   an empty result, which is itself an answer.
5. Repeat for `01-preflight-checklist.sql`. Run its first query (the
   organization names) first; every later result refers to those names.
6. `01-` #6b returns one row per contribution and may be long. Narrow it by
   adding `AND o.slug = '<slug>'` for the organizations that matter.

**Stop immediately and tell me if**

- Any statement errors. Do not amend it to make it run — the error is data.
- The editor asks to confirm a write. Nothing here should.
- `00-` Q2 returns a view with `security_invoker = false`, or a function with
  `anon` in `can_execute`.

---

## 4. Exactly what to return, and what each answer would mean

### From `00-verify-readonly.sql`

| Query | Return | No-go |
|---|---|---|
| Q1 policies | `tablename`, `policyname`, `cmd`, `roles`, and the **full `qual`** for all five tables | Any `qual` differing from C1/06/07/08 — paste it rather than summarising |
| Q2 views | every row, or "0 rows" | A row with `security_invoker` not `true` |
| Q2 functions | every row | `prosecdef = true` **and** `can_execute` containing `anon` or `authenticated` |
| Q3 grants | every row | Any row where `grantee = 'anon'` |
| Q4 history shapes | all rows | Not a no-go — tells me whether the attachment envelope still exists |
| Q5 bucket counts | all rows | Not a no-go — this is a freshness-lane question |
| Q6 LLY row | the single row | Not a no-go — incident record only |
| Q8/Q8b/Q9 org chart | all rows | Not a no-go — context for `n_7` |

### From `01-preflight-checklist.sql`

| Query | Return | No-go |
|---|---|---|
| organizations | all rows (names + slugs) | — |
| #1 exposed now | all rows | None. Sizing only. |
| #2/#3 split | all rows | None. Determines the notification split. |
| #4 history | all rows | None |
| #5 revisions | all rows | None |
| #6 cost | all rows, **by organization and reason** | None — operational, per §1.B |
| #6b itemised | only for the organizations that matter | — |
| #7 descent gap | all rows | None. Expected large. |
| #9 orphans | all rows | None. Retained, not deleted. |
| **invariant** | **all rows, even if empty** | **Any non-zero count in any organization. HARD STOP.** |

An empty result for the invariant query is the pass condition, and I need to
see it stated rather than inferred from silence.

### What I will do with it

Produce the exposure footprint and a rollout recommendation: whether to ship,
in what order, which organizations need notice first, and the author list for
`n_6`. If the invariant query is non-zero I will instead redesign `10-` §4 and
bring it back before anything is applied.

---

## 5. Out of scope, explicitly

Hierarchical department/division inheritance is a real product capability and
is **not** part of this release. The picker correction describes the existing
authorization model rather than changing it; test assertion 12 pins the
no-descent behaviour so that implementing descent later has to be a deliberate
act that inverts a named assertion.

No further code changes in this lane pending database evidence.
