# Security Release B — messages, audit_events, notifications

**Branch:** `fix/p0-security` · **Worktree:** `C:\dev\tesseract-security` · **2026-08-28**

**Status: executed and ACCEPTED on staging 2026-08-28. Ready for Main Control to
execute on production.** Product and data decisions are final — see §0. The
retrospective access review in §9 remains **not performed**; it is the one item
in this document that is still outstanding, and it does not gate the release.

---

## 0. Final decisions

| # | Decision | Where it lives |
|---|---|---|
| **1** | **Historical messages.** The 20 asset-context rows whose organization cannot be *deterministically* derived are left dark. Org is **not** guessed and specifically **not** derived from author membership. Rows are preserved, quarantined from ordinary tenant reads, and recoverable individually by a separately reviewed reconciliation if provenance is ever found. | `02-…​.sql` §2 |
| **2** | **Historical audit_events.** The 2,583 NULL-org rows and other unresolvable rows are policy-quarantined, not deleted and not attributed. Platform admins retain visibility through the `is_platform_admin()` branch. New trusted events are the authoritative history. | `03-…​.sql` §0–§1 |
| **3** | **Checksum: option B.** No hash chaining in Release B. The stored checksum is legacy and non-authoritative and is never described as tamper evidence. The security properties are trusted server-side attribution, tenant-scoped reads, and append-only rows. | `03-…​.sql` header, §6.1 |

On Decision 1, one thing to confirm rather than assume: **platform-admin access
to the 20 quarantined messages is via the existing `service_role`/Ops path
(BYPASSRLS), not via the tenant policy.** Adding an `is_platform_admin()` branch
to `messages_select` would grant cross-tenant read of *every* message in order to
reach 20, so the quick_thoughts precedent — a narrow admin-only RPC — is the
right shape if a first-class path is wanted. Say so and it becomes a follow-up.

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
| `supabase/tests/notifications-authorization.sql` | **new** — 9 assertions |
| `supabase/tests/analyst-performance-tenant-scope.sql` | **new** — 6 assertions |
| `src/lib/security/__tests__/release-b-callsites.test.ts` | **new** — 8 source-level guards |
| `scripts/sql/release-b/01-messages-containment.sql` | **new** |
| `scripts/sql/release-b/02-messages-permanent.sql` | **new** |
| `scripts/sql/release-b/03-audit-events.sql` | **new** |
| `scripts/sql/release-b/04-notifications.sql` | **new** |
| `scripts/sql/release-b/05-analyst-performance-snapshots.sql` | **new** |
| `scripts/sql/release-b/99-rollback.sql` | **new** — 4 sections + verification |
| `src/components/communication/MessagingSection.tsx` | ack + pin → RPCs |
| `src/components/thoughts/TradeIdeaDiscussion.tsx` | pin → RPC |
| `src/components/trading/TradeIdeaDetailModal.tsx` | pin → RPC |
| `src/lib/audit/audit-service.ts` | INSERT → `record_audit_event` |
| `src/hooks/useUserAssetPagePreferences.ts` | INSERT → `record_audit_event` |
| `src/lib/audit/checksum.ts` | **deleted** — see §6.1 |
| `src/lib/audit/index.ts`, `src/lib/audit/types.ts` | checksum export removed; attribution params deprecated |
| `src/types/database.ts` | declares the three new RPCs |
| `docs/p0-unconditional-policy-findings.md`, `docs/object-links-tenant-audit.md` | rescued verbatim |
| `docs/audit/baselines/README.md` | documents the new class field |
| `package.json` | `guard:policies`, `sec:suite`, `sec:messages`, `sec:audit`, `sec:notifications`, `sec:analyst` |
| `.gitattributes` | **new** — pins `*.mjs`/`*.cjs`/`*.sh` to LF; see §14 |
| `.gitignore` | generated inventories can no longer be committed under a project-implying name |

No ranking, Dashboard, Desktop Ideas, readthrough or Decision Memory file was
touched. The six application files listed above are the **minimum** required by
the prepared SQL — they are call-site conversions, not feature work; see §13.

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
Tests: **63 passing** (57 security + 6 judgment-log).

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

**Decision 3 confirmed: option B, and no hash chaining now.** The security
properties of the audit trail in this release are *trusted server-side
attribution*, *tenant-scoped reads* and *append-only rows*. The checksum is not
one of them.

The column is **retained rather than dropped** — removing a `NOT NULL` column
from a table with existing rows is migration risk bought for nothing — and is
computed server-side inside the RPC so it stops being caller-controlled. It is
explicitly **legacy and non-authoritative**: the column comment says so, and
`src/lib/audit/index.ts` carries the same statement where the deleted client
module used to be exported. The browser-side `checksum.ts` is gone, and a test
fails if anything reintroduces it.
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

## 7. notifications (Phase 7) — CONTAINED

Reads and updates are already correctly user-scoped and are kept. `INSERT WITH
CHECK (true)` meant any authenticated user could create a notification addressed
to any user, with any title and body — an attacker-authored message rendered
inside the product's own notification centre, with the product's chrome lending
it credibility.

An earlier draft of this release proposed *attribution* (a `created_by` column)
as Stage 1. That was rejected as closure, correctly: knowing who forged a
notification is not preventing it. **`04-notifications.sql` now removes direct
client INSERT outright.**

### The trap this change contains

"Revoke INSERT from `authenticated`; the triggers are SECURITY DEFINER so they
are fine" is **wrong here**, and would have taken down core write paths.
Invoker-rights functions run as the *calling user*, so they are subject to
exactly the grant being removed, and a trigger failure aborts the statement that
fired it.

Live discovery on staging (§0 of the SQL) found **five** SECURITY INVOKER
functions whose bodies INSERT into `notifications`:

`create_asset_change_notification` · `create_note_collaboration_notification` ·
`create_list_share_notification` · `_emit_coverage_notification` ·
`notify_note_sharing`

…plus **three** trigger wrappers that reach them via
`PERFORM create_asset_change_notification(...)` and would fail with them:
`notify_asset_field_changes`, `notify_price_target_changes`,
`notify_asset_content_changes`. **Eight functions are promoted in §1**, serving
**four** trigger chains:

| Table | Trigger | Function |
|---|---|---|
| `assets` | `asset_field_changes_notification` | `notify_asset_field_changes` |
| `price_targets` | `price_target_changes_notification` | `notify_price_target_changes` |
| `note_collaborations` | `note_collaboration_notification` | `notify_note_sharing` |
| `asset_list_collaborations` | `trigger_list_share_notification` | `create_list_share_notification` |

Without the fix, **editing an asset field, saving a price target, sharing a note,
or sharing an asset list** would start failing outright.

**The `asset_list_collaborations` chain is the one an earlier draft of this
document missed.** `create_list_share_notification` is itself a trigger function,
not merely a helper, so it does not surface when you look for `notify_*` by name
— which is precisely what reading the inventory by naming convention does. Live
discovery found it; the naming heuristic did not. That is the argument for §0
being mandatory rather than advisory, and it is why §0 must be re-run against
production rather than assumed from staging.

§1 also pins `search_path` on all eight. Promoting a function to definer rights
without pinning it would turn each into a fresh privilege-escalation surface,
which is how this class of fix usually goes wrong. `ALTER FUNCTION` changes only
the security attribute — no body is rewritten. Staging confirms all eight now
report `definer=true, search_path pinned=true`.

`mark_notification_read` and `mark_all_notifications_read` are deliberately left
invoker-rights: they only UPDATE, which the own-user policy still permits, and as
definer they would mark *any* user's notification read.

### What stops working

**20 client INSERT sites** (a re-count; the earlier audit said 18). Nineteen fail
silently — fire-and-forget writes that ignore or log the error — so the in-app
action still succeeds and the recipient simply is not told.

**One fails visibly, and should:** `DecisionInbox.tsx:234`, the "nudge a PM for a
decision" action. It is the only site whose mutation exists *solely* to send the
notification, so its `throw` and its "Follow-up failed" toast are telling the
truth. It is deliberately left throwing — making it silent would report
"Follow-up sent" when nothing was sent. Expect user reports of failing nudges
while containment is in place.

The full site list is in the footer of `04-notifications.sql`. No client code is
changed, so **Stage 2** — per-workflow RPCs that derive the recipient from the
object being acted on — is a call-site swap rather than a re-implementation.
Arbitrary client INSERT is never restored.

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

## 10. What is verified, and what is not

**Verified on staging (2026-08-28):** all five SQL steps executed and accepted;
all four exploit suites run before and after; the post-fix inventory
(`schema_version` 2, 286 tables / 895 policies, ref `pdajkw…`) confirms
`notifications` holds no INSERT policy, no anon grant and no `INSERT` for
`authenticated`, and that all eight promoted functions are `SECURITY DEFINER`
with `search_path` pinned.

**Still not verified:**

* **Production.** Staging and production are not guaranteed to hold the same
  functions or policies — production has already been shown to differ from this
  repository's migrations more than once. The `§0` discovery blocks in `03`, `04`
  and `05` exist for that reason and must be re-run there, not assumed.
* **The retrospective access review (§9) was never performed.** No log source was
  reachable from this lane. It does not gate the release, and it is the one
  outstanding item in this document.
* The **column list of `messages`** was inferred from application code rather
  than read from the database; no migration creates that table. Staging execution
  of `02` has since exercised those columns for real, which is stronger evidence
  than the inference, but the repository still does not describe the table.

---

## 11. Remaining P0-B list, in priority order

1. **`messages`** — this release
2. **`audit_events`** — this release
3. **`notifications`** — contained this release; Stage 2 (producer RPCs) tracked
4. **`analyst_performance_snapshots`** — remediated this release (`05-…​.sql`)
5. **`portfolio_team`** — remediated (staging confirms clean); ratchet entry removed
6. The 12 SEV-1 anon-readable tables and 8 SEV-1 anon-writable tables
   (`docs/p0-unconditional-policy-findings.md` §1.1–1.2) — `REVOKE ALL … FROM
   anon` closes all of them with no policy change
7. Then the queued 46-table FK-chain sweep, **not started** per instruction:
   `tdf_holdings`, `tdf_holdings_snapshots`, `scenarios`, `asset_field_history`,
   `asset_revision_events`, `object_links`, `theme_assets`

---

## 12. Is Release B ready for production execution?

**Yes.** Staging execution is complete and accepted, the product and data
decisions in §0 are final, and CI is green.

### File number is not execution order

The five files are numbered by the table they remediate, not by the order they
run. `02` is deliberately **last**: its backfill has to be reviewed against real
row counts, so it should land only once the rest is settled.

| Order | File | Note |
|---|---|---|
| 1 | `01-messages-containment.sql` | messaging goes dark |
| 2 | `03-audit-events.sql` | re-run §0 first; a non-zero NULL-org count is expected (Decision 2) |
| 3 | `04-notifications.sql` | **re-run §0 first**; then smoke-test an asset field edit, a price target save, a note share and an asset-list share |
| 4 | `05-analyst-performance-snapshots.sql` | re-run §0 first; live policies differ from the repo's migration |
| 5 | `02-messages-permanent.sql` | after reviewing the quarantine report (Decision 1) |

Then: re-run the four suites, regenerate the inventory **to a
project-specific filename**, and re-run `npm run guard:policies` against it.

`99-rollback.sql` reverses each step independently. Its §3 deliberately does
**not** revert the SECURITY DEFINER promotions: they do not depend on
containment, and reverting them would re-arm the breakage described in §7.

### The one caveat worth stating plainly

Rolling `01` forward makes messaging go dark until `02` lands, and `04` stops all
20 client notification producers — one of them, the Decision Inbox nudge, fails
visibly. Both are accepted trades, not regressions to be discovered. Say so in
the release notes before users report them.

---

## 13. Application compatibility (this pass)

The six application files in §1 are the minimum the prepared SQL requires. Each
is a call-site conversion; none changes product behaviour except where the SQL
removes a capability on purpose.

### messages — four callers, no generic UPDATE left

| Caller | Was | Now |
|---|---|---|
| `MessagingSection.tsx:401` | `.update({is_read, read_at}).in('id', ids)` | `rpc('mark_messages_read', { p_message_ids })` |
| `MessagingSection.tsx:384` | `.update({is_pinned}).eq('id', id)` | `rpc('set_message_pinned', { p_message_id, p_pinned })` |
| `TradeIdeaDiscussion.tsx:161` | same | same |
| `TradeIdeaDetailModal.tsx:1591` | same | same |

Both RPCs are `SECURITY DEFINER`, `search_path` pinned, and scope their write to
the caller's own organization. They return a row count / boolean rather than
raising when a message is out of scope, so each pin caller checks for `false`
and throws — otherwise the UI would show a pin that was never saved. A test
asserts that check exists at all three sites, and another asserts that **no
`.from('messages').update(` remains anywhere in `src/`**.

The RPCs write `is_read`/`read_at` and `is_pinned` and nothing else, so an
acknowledging reader can no longer alter content, author or context. That
separation is the point: one policy used to grant both.

### audit_events — two callers, and ~20 that did not have to change

The conversion happens **inside `emitAuditEvent`**, so its ~20 call sites are
untouched. `actor`, `orgId`, `actorEmail` and `actorName` are no longer even
destructured from the params — leaving them out of scope is what stops a future
edit from quietly putting a caller-supplied actor back on the wire. They remain
in `EmitAuditEventParams` as `@deprecated` optional fields so nothing has to be
edited to compile.

`actor_type` is fixed to `'user'` server-side. A browser session cannot
legitimately claim to be `'system'`, `'api_key'`, `'webhook'` or `'migration'`;
those belong to `service_role` writers, which bypass RLS and are unaffected.

**A bug found on the way.** `logLayoutAuditEvent`
(`useUserAssetPagePreferences.ts:1521`) passed `action_category: 'research_layout'`,
which is **not in the `valid_action_category` CHECK constraint** — the allowed set
is still the original six and no migration ever widened it. Every one of those
inserts has been violating the constraint and being swallowed by the function's
own `catch`: **it has never written a row.** Migration
`20260418000000_fix_morph_session_audit.sql` records the identical mistake being
fixed elsewhere. It is mapped to `'lifecycle'` and now actually records. The org
lookup it did is also gone — the server reads the caller's current organization,
which is more correct than the arbitrary `.single()` active membership it picked
for a user in more than one org.

### A pre-existing gap worth knowing about

`.rpc()` arguments are **not type-checked anywhere in this repo.** `src/types/database.ts`
is hand-written and has no `Relationships` keys, so it fails supabase-js 2.56's
`GenericSchema` constraint and the client degrades to an untyped overload — about
120 existing `.rpc()` calls report the same `not assignable to parameter of type
'undefined'` error. The three new functions are declared in that file anyway:
they are correct, they document that no attribution parameter is accepted, and
they start being enforced the moment the type is regenerated. Fixing the wider
gap is a repo-wide change and is out of scope here.

`src/lib/security/__tests__/release-b-callsites.test.ts` is what actually holds
the line in the meantime: it asserts the RPC names, the parameter names, the
absence of the forgeable attribution fields, and the absence of the old direct
write paths.

### Verification run

| | |
|---|---|
| security tests | **57 passing** (4 files) |
| `npm run guard:policies` (post-fix staging inventory) | **122 known, 0 new, exit 0** |
| `npm run guard:types` | **PASS** — card-surface errors 0 |
| `npm run guard:unit` | 1,170 tests pass; 9 files fail to load with `Missing Supabase environment variables` (this worktree has only `.env.example`) — environmental, identical at HEAD |
| `npm run tenant:lint` | cannot run — needs `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` |
| `npm run tenant:lint:frontend` | fails: 13 P0 above baseline, all in `workflows`/`projects`/`themes`/`calendar_events`/`conversations`. None in any file this release touched; identical at HEAD |
| `npm run build` | passes (50s) |

No Netlify. No production execution.

---

## 14. The CI blocker: `SyntaxError: Invalid or unexpected token`

The guard's unit test stopped loading under Vitest, with no file and no line
number, while the guard CLI kept working and the test file itself was unchanged
and byte-clean. Recorded here because the failure mode is genuinely misleading.

**Root cause: CRLF line endings *and* a shebang, together.** Neither alone
reproduces it.

`core.autocrlf=true` is set on this machine and the repository had no
`.gitattributes`, so Git checked every text file out with CRLF. That is harmless
for most of the tree. `scripts/unconditional-policy-guard.mjs` is an executable
CLI, so it begins `#!/usr/bin/env node` — and it is the one script imported by a
test. Vite neutralises a shebang with

```js
result.code.replace(/^#!.*/, s => ' '.repeat(s.length))
```

and in a JavaScript regular expression `.` matches anything **except** a line
terminator, `\r` included. With LF the whole `#!` line is blanked. With CRLF the
match stops short, and what reaches the evaluator is no longer valid.

Plain `node` is unaffected — its own loader strips the shebang before parsing —
which is exactly why the CLI passed while the test could not even load, and why
the file looked innocent to every byte-level check.

Reproduced minimally before fixing anything: a two-line `.mjs` fails under
Vitest with CRLF + shebang and passes with either one removed.

**Fix:** `.gitattributes` pinning `*.mjs`, `*.cjs` and `*.sh` to `eol=lf`.

Chosen over deleting the shebang because it fixes the class rather than one
file — about 30 scripts here start with a shebang, and any of them could be
imported by a test tomorrow — and because it makes the checkout identical on
Windows, macOS, Linux and CI, so this cannot return as "works on my machine".

The blobs were already stored LF (that is what `autocrlf` does), so this changed
only what lands in the working tree: **32 files renormalised, zero content diff.**
No test was deleted, skipped, weakened or removed from CI, and no allowlist or
ratchet was broadened. The guard unit test passes with all 25 assertions intact.
