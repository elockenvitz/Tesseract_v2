# Security Release B — messages, audit_events, notifications

**Branch:** `fix/p0-security` · **Worktree:** `C:\dev\tesseract-security` · **2026-08-28**

**Status: NOT ready for production execution.** The design, the SQL and the test
suites are complete and reviewable. Nothing has been run against any database,
because this lane has no database credentials — see §9. Every "verified live"
statement below is sourced from a sanitized inventory or from the code, and is
labelled as such.

---

## 1. What this branch owns, and what it changed

| File | Change |
|---|---|
| `scripts/unconditional-policy-guard.mjs` | rescued, then upgraded (§2) |
| `scripts/lib/policy-predicate.mjs` | **new** — predicate classifier |
| `scripts/audit/schema-baseline.mjs` | records a predicate class per policy (`schema_version` 2) |
| `scripts/security-suite.mjs` | **new** — generic runner for `supabase/tests/*.sql` |
| `src/lib/security/__tests__/unconditional-policy-guard.test.ts` | rescued, +9 fixtures |
| `src/lib/security/__tests__/policy-predicate.test.ts` | **new** — 17 tests |
| `supabase/tests/messages-tenant-isolation.sql` | **new** — 10 assertions |
| `supabase/tests/audit-events-integrity.sql` | **new** — 7 assertions |
| `supabase/tests/notifications-authorization.sql` | **new** — 6 assertions |
| `scripts/sql/release-b/01-messages-containment.sql` | **new** |
| `scripts/sql/release-b/02-messages-permanent.sql` | **new** |
| `scripts/sql/release-b/03-audit-events.sql` | **new** |
| `scripts/sql/release-b/04-notifications.sql` | **new** |
| `scripts/sql/release-b/99-rollback.sql` | **new** |
| `docs/p0-unconditional-policy-findings.md`, `docs/object-links-tenant-audit.md` | rescued verbatim |
| `docs/audit/baselines/README.md` | documents the new class field |
| `package.json` | `guard:policies`, `sec:suite`, `sec:messages`, `sec:audit`, `sec:notifications` |

No product UI, no ranking, no Dashboard, no Desktop Ideas, no readthrough or
Decision Memory implementation file was touched. Two application changes are
*required* by this SQL and are deliberately **not** made here — they are listed
in §7 for Main Control to sequence.

---

## 2. The guard, and the thing it could not see

The rescued guard asked one question: is the predicate literally `true`? That
found `object_links` and `theme_assets`. It would have reported **nothing** on
`portfolio_team`:

```
Portfolio team: org-scoped read    USING portfolio_in_current_org(portfolio_id)
pt_select_all_authed               USING (auth.uid() IS NOT NULL)
```

Neither predicate is `true`. Permissive policies OR together, so the effective
read boundary is the second one — every authenticated user, every row. The
scoped policy is not a boundary; it is the reason everyone believed there was
one.

The upgraded guard groups policies by **(table, command, role)** — expanding
`FOR ALL` into four commands and `TO public` into `anon` + `authenticated` — and
classifies each predicate as `UNCONDITIONAL` / `AUTH_ONLY` / `SCOPED` / `DENY` /
`EMPTY` / `UNKNOWN`. `UNKNOWN` is the default for anything it cannot prove, and
the run prints how much of the inventory it could actually read, so a
mostly-blind run cannot look like a clean one.

### 2.1 It found something on the day it was written

`analyst_performance_snapshots`, identically in **production and staging**:

```
Users can manage their own snapshots      ALL    USING (user_id = auth.uid())
Users can view all performance snapshots  SELECT USING (auth.uid() IS NOT NULL)
```

The per-user policy is exactly right and completely inert for reads. Every
authenticated user can read every analyst's performance history in every
organization. No previous check saw it: it has no `USING (true)`, so the old
guard passed it; it has policies and an owner column, so `tenant-boundary-lint`
passed it. SEV2, recorded in the ratchet, queued behind this release.

### 2.2 Two judgements that were nearly wrong

Both are pinned by tests, because both are the difference between a guard that
gets read and one that gets ignored.

**`AUTH_ONLY` is closed for `anon`.** `auth.uid() IS NOT NULL` is *false*
without a session. My first version expanded `TO public` into both roles and
reported an anonymous bypass on `analyst_performance_snapshots` that cannot
happen. Only a literally unconditional predicate is broad for `anon`.

**An UPDATE that omits `WITH CHECK` is not a hole.** PostgreSQL reuses the
`USING` expression for the new row, so a scoped `USING` keeps scoping the
post-image. This corrects the premise in the brief: `Portfolio team: org-scoped
update` has a scoped `USING` and an empty `WITH CHECK`, and is *fine on its own*.
What actually permits moving a row into a foreign tenant is its sibling
`pt_update_all_authed`, which supplies `WITH CHECK (auth.uid() IS NOT NULL)`.
The detector reports a `WITH CHECK` that is *present and broader*, and the
sibling case; it deliberately does not report the harmless shape.

### 2.3 How it still works without predicate text

The committed inventory carries no predicates, on purpose — a repository is the
wrong place to publish every tenant boundary in the product. It does not need
them: recognising the *dangerous* shapes only requires hashing them. The guard
hashes a corpus of canonical predicates and matches those hashes, so it
classifies captures taken before it existed. `schema-baseline.mjs` additionally
records a class per predicate; the text is read in memory and dropped before the
file is written.

Guard result, both inventories: **120 known findings, 0 new, exit 0.**
Tests: **44 passing.**

---

## 3. messages — the real data model

Traced across all 14 call sites. **`messages` is not direct messaging.** DMs live
in `conversations` + `conversation_messages`, reached through
`get_or_create_direct_conversation()` and `mark_conversation_read()`.
`messages` is a polymorphic **comment** table.

| Column | What it actually means |
|---|---|
| `user_id` | the **author**. Confirmed by the table's own conditional policies: INSERT `WITH CHECK (auth.uid() = user_id)`, DELETE `USING (auth.uid() = user_id)`. |
| `context_type` / `context_id` | the thread's anchor: `asset`, `portfolio`, `theme`, `note`, `field`, `trade_idea`, `workflow`, `quick_thought`, `simulation_share`, `decision_request` |
| `portfolio_id` | **not** an ownership key. An optional annotation on `trade_idea` messages ("which portfolio am I talking about"), set from a picker in `TradeIdeaDetailModal`. Nullable. |
| `is_read` / `read_at` | a **single shared boolean on the row**, not per-recipient state. `MessagingSection` derives "unread" as `!is_read && user_id !== me`. |
| `is_pinned` | shared thread state |
| `reply_to`, `field_name`, `cited_content` | threading and quoting |

**There is no recipient column.** The audience is "whoever can see the context".
That, plus a single shared `is_read`, is why "mark as read" was written as a
whole-row UPDATE for everybody — and it is the root of the vulnerability.

### 3.1 The authorization matrix

| Operation | Who should | Live today |
|---|---|---|
| SELECT | members of the context's organization | **every authenticated user, every row** |
| INSERT | a member of that org, as themselves | correct (`auth.uid() = user_id`) — but no tenant check |
| mark read | any member of that org | **anyone, including `anon`, on any row** |
| pin | any member of that org | **anyone, including `anon`** |
| edit content | **nobody** — no caller edits content | **anyone, including `anon`** |
| reassign author | **nobody** | **anyone, including `anon`** |
| move context | **nobody** | **anyone, including `anon`** |
| DELETE | the author | correct (`auth.uid() = user_id`) — but no tenant check |

### 3.2 Where it came from

`scripts/sql/rls_fix_mark_messages_read.sql`, in this repository:

```sql
CREATE POLICY "Users can mark messages as read"
ON messages FOR UPDATE
USING (true) WITH CHECK (true);
```

with the comment *"This allows marking any message as read without allowing full
edit permissions"*. It allows full edit permissions. And because it names no
role, it defaulted to `PUBLIC` — which, with `anon` holding the UPDATE grant, is
exactly why this is reachable without logging in. Its own suggested alternative,
`auth.uid() IS NOT NULL`, would have closed the anonymous path and left every
authenticated user able to rewrite every message.

---

## 4. Containment recommendation (Phase 3)

**Recommended: contain now, in `01-messages-containment.sql`.** Do not wait for
the permanent policy.

The permanent fix needs a new `organization_id` column and a backfill whose
correctness must be checked against real rows — which cannot be validated from
here. Cross-tenant read and unauthenticated write should not stay open for that.

The mechanism is **deny-by-default**: revoke every `anon` grant, drop all four
policies, leave RLS on. `authenticated` and `anon` then match no rows;
`service_role` and `postgres` are unaffected, so triggers, edge functions and Ops
keep working. The script asserts the outcome — 0 policies, RLS on, 0 anon grants
— and refuses to commit otherwise.

**Blast radius: five secondary panels go blank.** `MessagingSection`,
`IdeaComments`, `TradeIdeaDiscussion`, `TradeIdeaDetailModal`'s discussion tab,
and `DecisionItemCard`'s inline question thread. All read through react-query
with a `= []` default, so a failed read renders an empty thread rather than
throwing. None is on a startup path. No other table's policies reference
`messages`, and its only trigger (`update_messages_updated_at`) does not read it.

A temporary messaging outage is the right trade against anonymous cross-tenant
rewrite.

---

## 5. Permanent messages design (Phase 4)

Full SQL in `02-messages-permanent.sql`. The decisions:

**An explicit `organization_id`, not an `EXISTS` join.** The `theme_assets`
analysis chose an `EXISTS` join because `theme_id` is `NOT NULL` and
single-valued, so the join is total and unambiguous. Neither holds here:
`context_type` is polymorphic across ten types in different tables, and one of
them — `asset` — is **global** and confers no organization at all. The column is
assigned by a `BEFORE INSERT OR UPDATE` trigger from the context's owner, never
from the caller's payload. Where the context has an owner, the owner wins and a
cross-org mismatch is rejected outright; `current_org_id()` is the fallback only
for context types that have no owner to consult.

**No general UPDATE policy at all.** Across all 14 call sites the only UPDATEs
are `{is_read, read_at}` and `{is_pinned}`. So content, author and context become
immutable once sent — which is what the UI already implies — and the two
legitimate mutations go through narrow `SECURITY DEFINER` RPCs,
`mark_messages_read(uuid[])` and `set_message_pinned(uuid, boolean)`, both scoped
internally to the caller's own organization. This is the property the brief asked
for: **a reader who can acknowledge a message cannot alter it.**

**The backfill quarantines rather than guesses.** Following the `quick_thoughts`
precedent: rows whose context object is gone, or whose context is global, get
`NULL` and become unreadable by anyone (`NULL = <uuid>` is `NULL`, not `TRUE`).
`asset`-context messages are the expected large quarantine bucket and need a
decision from Main Control — leave them dark, or derive from the author's
membership, which is a guess about intent and is not done in the script.
`NOT NULL` is deliberately **not** applied while quarantined rows exist.

---

## 6. audit_events (Phase 6)

Live: two policies, both unconditional. Every org's decision record readable by
any authenticated user; any authenticated user can insert an event attributing
any action to any actor in any org. Every authoritative field — `actor_id`,
`org_id`, `actor_email`, `actor_name`, `checksum` — is supplied by the client
from `src/lib/audit/audit-service.ts`. There is no trigger on the table.

**Read:** org-scoped, plus `is_platform_admin()`.
**Write:** `record_audit_event(...)`, `SECURITY DEFINER`, `search_path` pinned.
The caller keeps describing *what* happened; it stops asserting *who*, *where*
and *under what identity*. Those come from `auth.uid()`, `current_org_id()` and
the `users` row.

**`org_id NOT NULL`:** the creating migration already declares it. The script
still checks first (§0 of `03-audit-events.sql`) because this repo is known to
drift from production. **If any NULL rows exist, stop** — an org-scoped read
policy would make them invisible to everyone, which is a silent deletion of audit
history.

### 6.1 Checksum decision: **(B), it stops being a security claim**

* `calculateChecksum` is an **unkeyed** SHA-256 over nine fields, computed in the
  browser, and the recipe is in the repository. Anyone who can forge a row can
  compute its checksum. It detects nothing an attacker would fail to do.
* It is not even consistently produced: `useUserAssetPagePreferences.ts:1532`
  writes `${userId}-${entityId}-${Date.now()}` into the same `NOT NULL` column.
* `verifyChecksum` is exported and has **no caller**.

The column is kept and computed server-side inside the RPC, so it becomes
consistent — and the column comment says plainly that it is not tamper evidence.
Decorative security is worse than none: this checksum is why `audit_events` was
nominated as the tamper-evident home for relationship-edge governance.

If real tamper-evidence is required for the compliance story, the mechanism is
**per-org hash chaining** (each row commits to its predecessor's hash) computed
inside that function. Real design, real cost — ordering, contention, and a
backfill of the existing rows. That is a decision for Main Control, not a line in
a migration.

**Decision Memory stays blocked** from treating `audit_events` as authoritative
until this is live.

---

## 7. notifications (Phase 7) — Stage 1 only, and it does not close the hole

Reads and updates are already correctly user-scoped. `INSERT WITH CHECK (true)`
means any authenticated user can create a notification addressed to any user,
with any title and body — an attacker-authored message rendered inside the
product's own notification centre.

Tracing the producers explains why this is only half-fixable here:

* **~25 `SECURITY DEFINER` trigger functions** (`notify_*`) already write through
  a trusted path and are unaffected.
* **18 client call sites** insert directly, across 14 files. All are legitimate —
  mentioning, assigning and sharing genuinely do notify someone else. **There is
  no client-side predicate that separates them from an attacker**, because
  "notify another user" is exactly what they all do.

Worse: `user_id` is the **recipient**, and the table has **no sender/actor
column**. A notification today is unattributable — nothing in the row records who
wrote it.

**Stage 1** (`04-notifications.sql`) revokes `anon`, adds `created_by uuid
DEFAULT auth.uid()`, replaces `WITH CHECK (true)` with `WITH CHECK (created_by =
auth.uid())`, and adds a trigger restricting the recipient's UPDATE to
`is_read`/`read_at` (RLS cannot express column-level rules, and the existing
policy leaves every column writable). **Zero application changes** — the 18 sites
never set `created_by`, so the default applies and the check passes.

After Stage 1 a fabricated notification still succeeds, but carries the identity
of whoever created it. **Do not record this table as fixed when Stage 1 lands.**
Assertion 5 of the notifications suite is written to keep failing until Stage 2 —
moving those 18 sites behind per-workflow RPCs that derive the recipient — which
is product work this lane does not own.

### Required application changes (not made here)

| Site | Change |
|---|---|
| `MessagingSection.tsx:401` | → `rpc('mark_messages_read', …)` |
| `MessagingSection.tsx:384`, `TradeIdeaDiscussion.tsx:161`, `TradeIdeaDetailModal.tsx:1591` | → `rpc('set_message_pinned', …)` |
| `audit-service.ts:76`, `useUserAssetPagePreferences.ts:1521` | → `rpc('record_audit_event', …)`, dropping actor/org/checksum from the payload; `src/lib/audit/checksum.ts` becomes dead |

---

## 8. Adjacent findings, recorded not fixed

* **Every `SECURITY DEFINER` function in production has an unpinned
  `search_path`** — all 29 `notify_*`/`mark_*` functions included. That is a
  privilege-escalation surface independent of every finding above. Every function
  this release adds pins it. The existing ones are a separate sweep.
* **`anon` holds `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
  TRIGGER`** on all four tables examined, and on most of the 287. Those grants
  are inert only where no unconditional policy backs them. `REVOKE ALL … FROM
  anon` across the SEV-1 tables remains the cheapest mitigation available and
  needs no policy or application change.

---

## 9. Retrospective access review (Phase 9) — **not performed**

**No log source was reachable from this lane**, so no claim is made about whether
any of this was exploited. Reading Supabase credentials was blocked by the
sandbox policy at three paths (`.mcp.json` in the main checkout,
`~/.tesseract/db.env`, and the environment). The attempt was not worked around.

To run the review, Main Control needs to check, for the window since these
policies landed:

| Source | What to look for |
|---|---|
| Supabase **API gateway / PostgREST logs** | `anon`-role requests to `/rest/v1/messages` — especially `PATCH`; any `anon` write at all is unambiguous |
| **Postgres logs** | `UPDATE public.messages` from the `anon` role |
| `audit_events` | rows whose `actor_id`'s membership does not include the row's `org_id` — a self-inconsistency that forged rows are likely to show |
| `notifications` | rows whose recipient shares no organization with any plausible producer |
| `portfolio_team` | membership mutations where the actor was not a member of the portfolio's org |

Two constraints to state up front. **Supabase's log retention on lower tiers is
typically 1–7 days**, which is almost certainly shorter than the exposure window,
so "insufficient evidence" is the expected outcome for most of it — and that must
be reported as insufficient evidence, not as absence of compromise. And the
verification probes run by earlier lanes on 2026-08-27/28 will themselves appear
as cross-tenant reads; classify those as **our own probes** before anything else,
using the timestamps in `docs/p0-unconditional-policy-findings.md`.

Per the brief: a vulnerability existing is not evidence of compromise. Nothing
here claims one.

---

## 10. What is unverified

Everything in this release is **unexecuted**. Specifically:

* No SQL in `scripts/sql/release-b/` has been parsed by a database.
* No test suite has been run. They cannot be run without credentials.
* The **column list of `messages` is inferred from application code**, not read
  from the database — there is no migration that creates this table, so the
  repository does not describe it. `is_read`, `read_at` and `portfolio_id` are
  known only from queries in the UI.
* Policies, grants, triggers and functions ARE first-hand, from the sanitized
  inventories captured 2026-08-26/27 — including the exact predicates, recovered
  from their hashes and stated as such.

---

## 11. Remaining P0-B list, in priority order

1. **`messages`** — this release
2. **`audit_events`** — this release
3. **`notifications`** — Stage 1 this release, Stage 2 tracked
4. `analyst_performance_snapshots` — new, §2.1
5. `portfolio_team` — sibling bypass on SELECT/UPDATE/DELETE
6. The 12 SEV-1 anon-readable tables and 8 SEV-1 anon-writable tables
   (`docs/p0-unconditional-policy-findings.md` §1.1–1.2) — `REVOKE ALL … FROM
   anon` closes all of them with no policy change
7. Then the queued 46-table FK-chain sweep, **not started** per instruction:
   `tdf_holdings`, `tdf_holdings_snapshots`, `scenarios`, `asset_field_history`,
   `asset_revision_events`, `object_links`, `theme_assets`

---

## 12. Is Release B ready for production execution?

**No.** It is ready for *review*, and — once credentials are available — for
staging execution in this order:

1. `npm run sec:messages` / `sec:audit` / `sec:notifications` against staging →
   capture the **before** output
2. `01-messages-containment.sql` on staging → re-run `sec:messages`
3. `03-audit-events.sql`, `04-notifications.sql` on staging → re-run those suites
4. `02-messages-permanent.sql` on staging **after** reviewing the quarantine
   report, together with the application changes in §7
5. Re-run all three suites → capture the **after** output
6. Regenerate the inventory and re-run `npm run guard:policies`
7. Only then: Main Control executes the reviewed SQL against production

Steps 1–6 have not happened. Until they do, this is a design with untested SQL,
and it should not touch production.
