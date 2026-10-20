# P0 contribution visibility — execution runbook

Everything here is **prepared and unapplied**. No step runs without your
explicit approval, and the read-only steps come first.

Related: `docs/contribution-visibility-assessment.md` (what is wrong and why),
`scripts/sql/contribution-visibility/` (the SQL),
`supabase/tests/contribution-visibility-security.sql` (the database test).

---

## 0. Authorized read-only access

Per decision 4, I will not look for or modify connection configuration. To give
me read-only production access, you do this:

1. Copy `C:\dev\Tesseract_v2\.mcp.json` to `C:\dev\tesseract-asset-page\.mcp.json`.
2. Add `--read-only` to the Supabase server's `args`. **The source file does not
   have it** — copied as-is it would give me a write-capable channel.
3. Restart the session.

`.mcp.json` is gitignored (line 18), so nothing is committed.

Alternatively, run the two read-only files yourself and paste the output.

---

## 1. Preflight — read-only, two files

```
psql "$DB_URL" -f scripts/sql/contribution-visibility/00-verify-readonly.sql
psql "$DB_URL" -f scripts/sql/contribution-visibility/01-preflight-checklist.sql
```

Every statement in both is a `SELECT`. `00-` establishes that production is the
system that was analysed; `01-` sizes the blast radius and the cost.

Both files are self-contained: no helper functions, and **no dependency on the
freshness lane**. Nothing from `scripts/sql/contribution-freshness/` needs to
be installed, and nothing here installs anything.

### Stop conditions — any one of these halts the release

| Signal | Where | Why it stops us |
|---|---|---|
| A policy on the four tables does not match C1/06, C1/07 or C1/08 | `00-` Q1 | `10-` would replace a policy nobody has read. Re-derive the fix against what is actually there. |
| A **view** over these tables exists without `security_invoker` | `00-` Q2 | It runs with its owner's rights and bypasses RLS entirely. `10-` would not close it, and shipping would imply we had. |
| A `SECURITY DEFINER` function over these tables is executable by `anon` or `authenticated` | `00-` Q2 | Same: an independent path the policy fix does not touch. |
| Any grant to `anon` on any of the five tables | `00-` Q3 | Pre-authentication exposure outranks this work. |
| `invariant_violations_actor_is_not_author` **> 0** | `01-` final query | The revision-event derivation in `10-` §4 is unsound. Both the actor branch and the attribution would hand one analyst's prose to another. **Hard stop — redesign §4.** |
| `n_6` (contributions that lose a reader) is large relative to the corpus | `01-` #6 | Correct but disruptive. Becomes a notification exercise before the policy lands, not after. |
| Column shapes differ from `revision-service.ts` / `useAssetRevisions.ts` | `00-` Q1 | Neither revision table has a migration in this repo. The policy is written against an inferred shape. |

### Numbers that inform but do not stop

- `n_1` / `n_4` / `n_5` size the exposure. Large is the argument **for**
  shipping, not against.
- `n_7` (targeted nodes reaching nobody) is expected to be large — see §4.
- `n_9` (orphaned revision events) feeds decision 3; they are retained and
  denied, never deleted.

---

## 2. Database test — isolated, not production

The test writes fixture rows (users, an org chart, contributions, history and
revision events) and deletes them again. **Do not run it against production.**
Run it against a branch, a restored dump, or a local `supabase start`.

```
# A — the defect must be observable BEFORE the fix
psql "$TEST_DB" -f supabase/tests/contribution-visibility-security.sql
#    EXPECT: 9 PASS / 5 FAIL, failures = 3, 4, 6, 8, 13

# B — apply the correction
psql "$TEST_DB" -f scripts/sql/contribution-visibility/10-policy-fix.sql

# C — the defect must be gone, and nothing legitimate lost
psql "$TEST_DB" -f supabase/tests/contribution-visibility-security.sql
#    EXPECT: 14 PASS / 0 FAIL

# D — the revert must restore the prior state exactly
psql "$TEST_DB" -f scripts/sql/contribution-visibility/90-rollback.sql
psql "$TEST_DB" -f supabase/tests/contribution-visibility-security.sql
#    EXPECT: 9 PASS / 5 FAIL again — same five
```

**Step A is not a formality.** If it reports 14/14, the test is not observing
the defect and neither it nor the fix can be trusted — stop and fix the test.

What each required failure proves:

| # | Proves |
|---|---|
| 3 | `team_id IS NULL` leaks a **zero-target** contribution to a team member it was never shared with |
| 4 | …and leaks **multi-target** and zero-target rows to any member of the organization |
| 6 | `asset_contribution_history` exposes restricted prose org-wide, unconditionally |
| 8 | `asset_revision_events` does the same |
| 13 | orphaned revision prose is readable by anyone in the organization |

The nine that must pass in **both** states are the preserve-access controls:
1 (anon), 2 (owner), 5 (cross-org), 7 (history still reaches the targeted
member), 9 (actor reads own events), 10 (cross-org on side tables), 11
(department target reaches its direct member), 12 (division target does **not**
reach a descendant), 14 (price targets stay org-visible; actor == author).

Assertion **12 encodes decision 1**: descent stays unimplemented. If descent is
ever implemented, 12 must be deliberately inverted.

---

## 3. Applying — only after 1 and 2

```
psql "$DB_URL" -f scripts/sql/contribution-visibility/10-policy-fix.sql
```

One transaction, policies and one function only. **No contribution data,
visibility value, target row, timestamp or audit event is touched**, so there
is no data log and no backfill — which is also why `90-rollback.sql` is purely
policy. Reverting reopens the exposure; the file says so.

Post-apply, re-run `01-` #1: `n_1_exposed_now` is unchanged, because the fix
changes who can **read** those rows, not the rows. The proof of effect is the
test suite, not the counts.

---

## 4. Production data needing manual audience review

Per decision 2 — fail closed, no automatic widening to firm. Two populations,
both from `01-` #6, which lists id, symbol, section, visibility, author and a
reason:

**(a) Audience destroyed** — non-firm with **no** target rows. The V4 client
bug deleted them; nothing records who they were for. After the fix: owner-only.
The author is the only person who knows the intended audience. Notify and let
them re-target. `01-` #8 counts the distinct authors.

**(b) Audience intact but unreachable** — targets exist, but no targeted node
has a direct member. Not caused by the bug; caused by the descent gap. After
the fix: owner-only. Two remedies, both the author's or an admin's: add direct
members to the node, or re-target a node that has them.

Population (b) is expected to be substantial. **Observed read-only in the live
UI:** for this organization, Division and Department both have **no direct
members**, and of three teams offered to the author only one ("The BEST Team",
1 direct member) is reachable.

Neither population is modified by any script here. The list is for a
conversation, not a migration.

**Not requiring review:** orphaned revision events (decision 3 — retained for
audit integrity, access denied where authorization cannot be established, no
deletion).

---

## 5. Application side

Three local commits, no deployment:

| Commit | What |
|---|---|
| `071e2673` | content saves can no longer delete a section's audience |
| `c48bef1d` | SQL preparation, hierarchy semantics, revision attribution, preflight |
| this lane | the picker stops offering audiences it cannot reach |

### Widening-path review — the whole surface, re-swept

`contribution_visibility_targets` is written in **exactly one file**,
`useContributions.ts`. Twelve other files touch `asset_contributions`; of those,
only `asset-research.ts` writes, and only `.update({ attachments })` — no
visibility, no `team_id`, no targets. Every other file reads.

So there is **one chokepoint**, and it now holds:

- `visibility` absent ⇒ preserve. No defaults.
- `visibility` present ⇒ an explicit change; it alone may replace the audience.
- non-`firm` + zero targets ⇒ throws, on all three write paths.

`ai-chat` forwards the caller's JWT, so it inherits RLS and widens nothing.

**One adjacent finding, not investigated:** `CoverageManager.tsx` carries its
own `visibility` (`'team' | 'division' | 'firm'`) plus `team_id` on the
`coverage` table — the same shape as the defect fixed here. Different table,
different feature, out of scope. Worth its own pass.

---

## What is verified, and what is not

**Verified**

- The application fix and the picker correction: 90 assertions passing, both
  gates proven non-vacuous by injecting the exact defects they guard and
  watching them fail.
- `guard:types` PASS at the 8635 baseline, card-surface 0; eslint clean.
- Read-only in the live UI: research renders, no console errors, Division and
  Department disabled with their reason, team member counts shown, picker reset
  to Firm **without saving**. No section editor was opened — the unsaved-edits
  guard auto-saves drafts on navigation, which would have been a production
  write.
- Exactly one write chokepoint for visibility and targets, re-swept above.

**Not verified — all of it needs the database**

- That production's policies are the ones analysed. Everything in the
  assessment is read from version control, and **migrations do not describe
  production in this repo**.
- Every count in `01-`: exposure, the two populations in §4, orphaned events.
- `actor == author` in real data. The revision-event policy depends on it.
- That the test reports 9/5 before and 14/0 after. Never executed.
- That no view, `SECURITY DEFINER` function or grant creates an independent
  path. Repo greps found none; only `00-` Q2/Q3 can confirm.
- The application fix end-to-end against a real save. Verifying it means
  writing contribution rows, which is a production write — it needs the
  isolated environment of §2.
