# Security C1 — response to production review

**Branch:** `fix/security-c1` · **2026-08-29** · Production still untouched.

Main Control returned **NOT READY** on four application blockers and five
release-package defects. All ten items are closed. This document says what was
wrong, what changed, and what the fix is verified by.

The SQL/security architecture was accepted and is unchanged in substance. What
changed is the release *package*: three stale queries that would have failed
after the revoke, one guard violation, two brittle tests, a ratchet number, the
09 split, one misclassified history field, one soft assertion that should have
been a hard stop, and a forward rule for trade-idea links.

---

## 1. `useScreenResults` — HARD BLOCKER

`src/hooks/lists/useScreenResults.ts:30` selected eight restricted columns. After
C1-09b that query fails outright — Postgres checks privileges on every column a
select names, so the whole screen breaks, not just those fields.

**Deleting the fields was not an option.** Saved screens are stored criteria
trees referring to field *keys*, and `SCREENABLE_FIELDS` exposes `priority`,
`process_stage`, `completeness`, `thesis`, `where_different`,
`risks_to_thesis` and `quick_note` as screenable. Removing the columns would
have left every one of those criteria silently matching nothing — a saved screen
that used to return 40 assets returning 0, with no error.

**What it does now.** The universe query selects global reference columns only.
The proprietary half arrives as a per-organisation overlay
(`src/lib/research/asset-overlay.ts`) assembled from the authoritative models —
`asset_contributions` for the four research sections,
`asset_workflow_progress.current_stage_key` for process stage,
`asset_workflow_priorities.priority` for priority — and merged onto each row
before the criteria run. `completeness` is derived from the same inputs the
asset page uses, so a screen and the asset page cannot disagree.

Every field key is unchanged, so **no saved screen needs migrating**. What
changed is whose data it evaluates against.

I also scoped the `coverage` query in the same hook. It was unscoped and feeds
three screen criteria (`has_coverage`, `analyst_name`, `coverage_count`) — an
analyst-name screen matching another firm's analysts is the same defect in a
different column, and it was sitting in a file I was already fixing.

**Verified by** `src/lib/lists/screen-semantics.test.ts` (35 cases): nine global
criteria still match for every caller; four workflow and five research criteria
match for the owning org; all seven proprietary criteria fail for a foreign org
*and* for an unaffiliated user; `is_empty` reads as absence rather than another
tenant's value; and a combined global+proprietary screen ANDs correctly.
`src/lib/research/asset-overlay.test.ts` (11 cases) covers the assembly itself.

---

## 2. `PortfolioTab` — HARD BLOCKER

`src/components/tabs/PortfolioTab.tsx:140` embedded six restricted columns
through `assets(...)`, which would have thrown the whole holdings query.

**Audited before changing.** Four of the six are genuinely consumed:
`process_stage` (OverviewTab:185, PositionsTab:237), `priority`
(PositionsTab:238), `thesis` (PositionsTab:979), `where_different`
(PositionsTab:1082). Two are not: `risks_to_thesis` and `workflow_id` appear
nowhere but the select string.

So the embed now requests reference columns only, and the four consumed fields
are re-attached from the org-scoped overlay after the query returns. The
children keep reading `h.assets?.process_stage` and friends unchanged. Dropping
them without the re-attach would have blanked the position detail rows silently
— the worse failure, because it looks like data simply not being there.

The query key gained `currentOrgId`, so switching organisation refetches rather
than showing the previous tenant's overlay from cache.

---

## 3. `useEntitySearch` — SILENT BLOCKER

`src/hooks/useEntitySearch.ts:91` selected `priority`. The result maps to
`id`/`title`/`subtitle`/`icon` — nothing downstream reads it. Removed, not
repointed: adding a `asset_workflow_priorities` lookup to satisfy a field no
consumer wants would be work in the wrong direction.

@mention search, entity search, the object-link picker and capture search all
consume the same mapped shape and are unaffected.

---

## 4. Org-scope guard failure

`asset-research.ts` queried `asset_contributions` without an explicit
`organization_id` filter, relying on RLS alone. RLS *is* the real boundary, but
this repository requires source-level scoping for proprietary reads, and the
reason is sound: an unscoped query is indistinguishable in review from one that
forgot.

**No allowlist entry was added.** Every entry point now takes an
`organizationId` and filters on it, and **fails closed** when it is missing —
no organisation returns no research rather than an unscoped query RLS happens
to save. Callers updated: `useExploreSearch` (already gated on the org),
`InlineReferencePopup` (via `useOrganizationOptional`), `AssetTab` (three sites).
The new `asset-overlay.ts` was written to the same rule.

No call needed a documented exemption. `org-scope-guard.test.ts` passes.

---

## 5. Guard test fixtures

Two tests used `theme_assets` and `object_links` as stand-ins for "seeded in the
ratchet", so they broke the moment C1 remediated those tables and removed
them — **a test that fails when the ratchet shrinks punishes the outcome it
exists to protect.**

Neither table was re-added. Instead `classify()` and `resolvedEntries()` take
the known-set as an injectable parameter (production callers omit it), and the
tests use synthetic `fixture_*` names. Two cases were added: every finding is
"new" when nothing is seeded, and every seeded entry resolves when the findings
list is empty — the end state the ratchet is aiming at, which nothing covered.
A third test using `theme_assets` was left on the real name because it asserts a
*predicate shape*, not ratchet membership; it was renamed for consistency.

`npm run guard:unit`: **89 files, 1260 tests, all passing.**

---

## 6. Known-unscoped ratchet

Measured, not assumed: `node src/lib/org-scope/org-scope-scan.mjs` reports **97**
files after this pass, so `MAX_KNOWN_UNSCOPED` is **97**, not the 98 Main Control
observed. The difference is `useScreenResults`, whose `coverage` query I scoped
(§1); the register also held one entry the scanner no longer finds.

`asset-research.ts`, `asset-overlay.ts` and `PortfolioTab.tsx` are absent from
the register, confirming they are properly scoped rather than newly excused.

---

## 7. `09` split into `09a` / `09b`

Correctly found. The single `09` combined an additive migration with a
restrictive revoke, which makes a zero-break release impossible: the new client
needs the migrated rows *before* it deploys, and the old client works only while
the columns are *still* readable. One transaction cannot be both sides of a
deploy.

* **`09a-assets-workflow-state-migration.sql`** — additive, pre-deploy.
  `INSERT … ON CONFLICT DO NOTHING` only. No privilege, policy or column change;
  the old client is unaffected. It also asserts that every workflow-anchored
  asset now *has* a destination row, so a partial migration fails rather than
  silently under-populating the new client.
* **`09b-assets-column-privileges.sql`** — restrictive, post-deploy. The revoke
  and column grants, plus the verification.

Production order is now `01 … 08b → 09a → DEPLOY → 09b → 10 → 11`, documented in
`c1-runbook.md` with rollback per step.

**Naming.** `c1-runbook.md` §0 disambiguates the two things called "07":
**MSG-07** is the portfolio-context message fix in `scripts/sql/release-b/`,
validated on staging and *not* live in production; **C1-07** is
`07-asset-contribution-history.sql`. They are separate packages with no
dependency in either direction.

---

## 8. `thesis_references` misclassification

`10-asset-field-history.sql` had `thesis_references` in the system-readable
branch. That contradicts the approved design and is wrong on the merits: it is
the list of documents behind a thesis — what a firm read to reach its view —
which is research, not workflow state, and is one of the nine columns 09b
revokes for exactly that reason.

The system-readable set is now exactly `process_stage` and `priority`.
Production holds zero `thesis_references` history rows, so nothing changes hands
today; the forward rule still had to be right, because the first row written
would have been world-readable.

A regression assertion inside the migration fails if any research field is ever
added back to that branch, plus matrix cases 103/104 (not system-readable;
visible to its author).

---

## 9. `object_links` backfill — hard stop

The backfill emitted a `NOTICE` when a row was left unattributed. Under the new
SELECT policy an unattributed link is **invisible**, so a warning would have
shipped silent data loss as a clean run.

It now `RAISE EXCEPTION`s and rolls back, naming up to ten offending rows. Both
gates are retained as intended: the read-only `91` dry run catches it before any
write, and the migration refuses if reality moved between preflight and
execution.

---

## 10. The 8 NULL-org `trade_queue_items`

Read-only structural classification, production:

| Measure | Count |
|---|---|
| Total queue items | 228 |
| `organization_id IS NULL` | **8** |
| …of which `portfolio_id IS NULL` too | **8 — all of them** |
| Resolvable via `portfolios.organization_id` | **0** |
| Item org vs portfolio org disagreements (all 228) | **0** |
| `object_links` touching a NULL-org item, direct or via `trade_idea_thesis` | **0** |

All 8 are structurally unresolvable, and nothing links to them, so no C1 step is
blocked. **They are left exactly as they are** — this is object-link safety, not
a trade-queue migration. No content was inspected.

**Forward rule**, in `object_link_endpoint_org()`: item org if present;
otherwise a deterministic portfolio org; **RAISE** if both exist and disagree;
refuse if neither resolves. Never creator membership, never `current_org_id()`
alone, never a caller-supplied value. On today's data the portfolio fallback
rescues nothing — it is implemented because it governs every future link.

Matrix cases 57, 58, 59, 71, 72 cover all five branches including a foreign
caller attempting to forge the link's org.

---

## 11. Gates

| Gate | Result |
|---|---|
| `npm run guard:unit` | **PASS** — 89 files, 1260 tests |
| `npm run guard:types` | **PASS** — card-surface errors 0 |
| `npm run guard:tdz` | **PASS** — 0 violations, 101 files |
| `npm run build` | **PASS** — built in 49.8s |
| Synthetic matrix `90` | **77/77** (was 70; +7 for trade-idea and thesis_references) |
| Product smoke `92` | **23/23** |
| Idempotency replay, all 13 files | clean |
| Fresh staging inventory + `guard:policies` | **PASS — 106 known, 0 new** |
| Typecheck | 0 files worse than baseline; 16 errors fewer |

**On the "missing env" collection failures.** Eight test files failed to collect
with `Missing Supabase environment variables`. These were **environmental, not
test failures**: they are import-time throws from `src/lib/supabase.ts`, and
supplying two dummy client values (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` — placeholders, no real credentials) makes all eight
collect and pass. That is the distinction asked for: nothing was dismissed, and
no real secret was needed.

---

## 12. Staging validation

All 13 remediation files were **replayed against the already-remediated staging
database** and are idempotent — the first replay surfaced that every file
dropped only its *old* policy names, so a second run failed on "policy already
exists". Each now drops the new names too.

`90` and `92` were re-run after every change. Staging is verified clean
afterwards: 0 fixture organisations, 0 rows in any C1 table, and the temporary
`trade_queue_items.organization_id` column the matrix adds to reproduce
production's shape is gone (staging lacks it — pre-existing drift; adding it
inside the rolled-back transaction lets the branch production actually uses be
tested rather than skipped).

---

## 13. Still open

1. **`08b` remains a behaviour change beyond a pure tenant boundary** — progress
   on a public workflow is no longer visible across organisations. Still my
   recommendation (a template may be shared; one firm's progress through it is
   not), and still worth an explicit confirmation since it was not in the
   approved design.
2. **Staging cannot host four `object_links` endpoint types** (`asset_notes`,
   `theme_notes`, `portfolio_notes`, `trade_queue_items` lack `organization_id`
   there). Mitigated by the production read-only dry run and, for trade_idea,
   by adding the column inside the rolled-back test transaction. The note and
   portfolio-note branches are still verified only against existing production
   rows, not a live INSERT.
3. **`frontend-tenant-lint` fails** with 13 P0 violations above baseline —
   pre-existing, verified identical before and after this work, all in unrelated
   tables (`workflows`, `projects`, `themes`, `calendar_events`,
   `conversations`). Not C1's to fix.
4. **The production guard run will report the 9 removed ratchet entries as new**
   until C1 executes there. Correct behaviour; worth expecting.

None of these blocks execution.

---

## 14. Readiness

**READY for Main Control production re-review**, subject to item 1 above being
confirmed.
