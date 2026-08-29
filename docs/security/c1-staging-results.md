# Security C1 — staging remediation results

**Branch:** `fix/security-c1` · **2026-08-29**
**Applied to STAGING only. No production write was attempted. Not merged, not deployed.**

Companion to `c1-design.md` (the design) and `c1-checkpoint.md` (the evidence).
Production was used read-only throughout, via
`scripts/sql/security-c1/mgmt-query.mjs`, which wraps every batch in
`SET TRANSACTION READ ONLY` and refuses `--allow-writes` on any environment but
staging.

---

## 1. Result

| Suite | Result |
|---|---|
| `07` portfolio-context message derivation (previously accepted) | **8/8** |
| `90` synthetic policy matrix | **70/70** |
| `92` product smoke tests | **23/23** |
| `93` query plans under synthetic volume | no regression |
| `91` production endpoint dry run (read-only) | 25/25 resolvable, 0 conflicts |
| Unconditional-policy guard vs. post-fix staging inventory | **PASS — 106 known, 0 new** |
| Ratchet | **9 entries removed** |
| Typecheck | 0 files worse; 11 errors fewer |

---

## 2. Files changed

**Application (repointing — 17 files)**

| File | Change |
|---|---|
| `src/lib/research/asset-research.ts` | **new** — org-scoped reads of research + thesis references |
| `src/lib/assets/asset-columns.ts` | **new** — the reference-column allowlist the client selects |
| `src/hooks/useExploreSearch.ts` | split the asset pass: reference from `assets`, research from `asset_contributions` |
| `src/components/tabs/AssetTab.tsx` | completeness derived, not written; thesis refs → contributions; 5 `workflow_id` cache writebacks removed; workflow resolved from `asset_workflow_progress` |
| `src/components/notes/InlineReferencePopup.tsx` | thesis/where-different/risks from contributions |
| `src/hooks/useCapture.ts`, `src/pages/NotesListPage.tsx`, `PortfolioCommandCenter.tsx`, `PortfolioWorkbench.tsx` | dropped restricted columns from selects |
| `UniversePreviewModal.tsx`, `universeAssetMatcher.ts`, `UniverseView.tsx`, `WorkflowsPage.tsx` | universe `priority` rule → `asset_workflow_priorities`, scoped by workflow |
| `MessagingSection.tsx`, `AddAssetToThemeModal.tsx`, `AssetsListPage.tsx`, `DashboardPage.tsx` | `select('*')` → `ASSET_REFERENCE_SELECT` |
| `CoverageManager.tsx`, `MobileCoverage.tsx`, `ListTab.tsx`, `ThemeTab.tsx` | embedded `assets(*)` → explicit column list |
| `scripts/unconditional-policy-guard.mjs` | `assets` allowlist reason rewritten; 9 ratchet entries removed |

**SQL (`scripts/sql/security-c1/`)** — `01`–`11` remediation, `90`–`93`
validation, `mgmt-query.mjs` runner.

---

## 3. Exact staging SQL applied, in order

| # | File | What it did on staging |
|---|---|---|
| 1 | `01-tdf-holdings-snapshots.sql` | 4 policies → EXISTS on `target_date_funds.organization_id` |
| 2 | `02-tdf-holdings.sql` | 4 policies → 2-hop EXISTS; `WITH CHECK` added |
| 3 | `03-theme-assets.sql` | 4 policies → EXISTS on `themes.organization_id`; org predicate ANDed onto INSERT |
| 4 | `04-object-links.sql` | `organization_id` column, endpoint resolver, backfill, trigger, index, 4 policies |
| 5 | `05-scenarios.sql` | `organization_id`, tenancy CHECK, unique index reshaped, trigger, 4 policies |
| 6 | `06-asset-revisions-events.sql` | `organization_id` on both, 2 triggers, 5 policies |
| 7 | `07-asset-contribution-history.sql` | `SELECT USING (true) TO public` → EXISTS via `asset_contributions` |
| 8 | `08-asset-contributions.sql` | NULL-org backfill, NULL escape removed from 7 policies, trigger |
| 9 | `08b-asset-workflow-state.sql` | **added mid-run** — see §5 |
| 10 | `09-assets-proprietary-columns.sql` | workflow-state migration, table grant → column grant |
| 11 | `10-asset-field-history.sql` | SELECT split: system history vs creator-only research |
| 12 | `11-grants.sql` | `anon` revoked, `TRUNCATE`/`REFERENCES`/`TRIGGER` revoked on 14 tables |

`07` (the portfolio-context message fix) was already applied to staging in the
previous session and is unchanged.

### Staging state after

* 0 unconditional policies on every C1 table except `assets`, whose
  `SELECT USING (true)` is now correct — the boundary moved to column grants.
* 0 `anon` grants across all 14 tables.
* 0 `TRUNCATE` grants for `authenticated` across all 14.

---

## 4. Data migrations performed on staging

Staging holds 10 assets and zero rows in every other C1 table, so every backfill
was a structurally-exercised no-op. That is the intended split: production
supplies counts, staging supplies behaviour. Production projections are §14.

---

## 5. Two findings the validation produced

Both were found by running the suites, not by reading the schema. Neither was in
the design package.

### a. The migration targets had no tenant boundary of their own

The product smoke suite failed on one assertion: the repointed universe
`priority` rule returned **nothing** for a legitimate caller. The cause is that
`asset_workflow_priorities` — one of the two tables `09` migrates 489+478
production rows *into* — carries the policy

```sql
asset_id IN (SELECT id FROM assets WHERE created_by = auth.uid())
```

"assets I personally created", on a table of global assets shared by every
tenant. It is not an organization boundary in either direction: it hides a
colleague's work inside the same org, and `asset_workflow_progress` additionally
carried

```sql
OR workflow_id IN (SELECT id FROM workflows WHERE is_public = true OR …)
```

which makes progress on any of the **23 `is_public` workflows** readable across
organizations.

Migrating 967 rows of proprietary workflow state into those tables would have
moved the data under a boundary that is not a tenant boundary — the same mistake
as securing a history table while its source stays open. `08b` was written and
inserted **before** `09` in the order. Both chains were measured total on
production first (396 + 6 rows, 0 dangling, 0 parent-without-org).

### b. `04`'s backfill would have failed on production

The production read-only dry run (`91`) replayed the endpoint resolver over the
real 25 links and reported `target_would_refuse = 1`. One link is
`asset_note → trade_idea_thesis`, and `trade_idea_theses.portfolio_id` is
**NULL on all 19 production rows**, so the portfolio route resolved nothing and
the forward guard would have refused the row.

Two corrections followed:

* `trade_idea_thesis` now resolves through `trade_queue_item_id`, which is
  `NOT NULL` and is the real parent, with `portfolio_id` kept as a second source.
* **The backfill was moved to before the trigger is created.** The backfill is an
  `UPDATE`, so with the trigger already installed every historical row is
  re-validated by the forward guard on its way to being attributed — and a row
  the guard would refuse can then never be attributed at all. On staging this was
  invisible: zero rows.

After both, the dry run reports 25/25 resolvable, 0 unresolvable, 0 cross-org
conflicts, 0 would-refuse on either side.

---

## 6. Synthetic matrix — 70/70

Three identities, because one cannot test tenancy: **U1** (org A only), **U2**
(member of orgs A *and* B — the multi-org user whose membership cannot identify
a row's tenant), **U3** (no organization — the identity that saw 100% of all
seven tables).

| Area | Cases | Notable |
|---|---|---|
| `assets` | 6 | `SELECT thesis`, `SELECT *`, and the `useExploreSearch` ILIKE shape all refused; reference columns still readable by an unaffiliated user |
| `asset_contributions` | 8 | cross-org read/search denied; **caller-supplied foreign `organization_id` overwritten**; foreign row survives a hostile UPDATE + DELETE unchanged |
| `asset_contribution_history` | 5 | own-org readable, foreign denied, cross-org prose search denied |
| `tdf_holdings` / snapshots | 8 | 2-hop EXISTS; UPDATE moving a row into a foreign snapshot refused by `WITH CHECK` |
| `theme_assets` | 5 | **INSERT into a foreign theme with `added_by = auth.uid()` refused** — the named defect |
| `object_links` | 7 | tenant↔global link works; foreign endpoint refused; caller-chosen org discarded |
| `scenarios` | 11 | global default unchanged after an ordinary user renamed it; quarantined legacy row visible to its creator only; Case-vs-Price loads default + own |
| `asset_revisions` / events | 7 | multi-org actor standing in org B refused against an org A revision |
| `asset_field_history` | 4 | system history readable, research history creator-only, direct forgery refused |
| `asset_workflow_progress` / `_priorities` | 6 | org B cannot see org A progress on a **public** workflow |
| `anon` | 3 | denied on `asset_contributions`, `tdf_holdings`, `assets` |

### A note on how four of these were first written

Four assertions initially reported FAIL because they expected an exception from
a cross-tenant `UPDATE`/`DELETE`. **RLS hides rows; it does not raise.** A write
whose `USING` clause excludes every row affects zero rows and returns success,
so "accepted" there means "changed nothing". Those four were rewritten to assert
the *row's state afterwards* — the foreign contribution still holds its original
content, the global default still has its original name — which is the stronger
claim and the one that actually distinguishes the fix from the defect. The
policies were correct throughout; the assertions were not.

---

## 7. Product smoke tests — 23/23

Policy tests prove denial. These prove the product still works, because an empty
result is what both a correct denial and a broken feature produce.

| Flow | Verified |
|---|---|
| Asset research | thesis edit persists to `asset_contributions` under the caller's org; the batched read returns it; thesis references save and read back |
| Explore search | reference pass over `assets` works; own research is findable; the pre-C1 column privilege is gone |
| Case vs Price | custom scenario write works; ladder loads global default + own custom; global defaults still load |
| Workflow | relationship resolves from `asset_workflow_progress`; process stage reads back; the universe priority rule resolves through the workflow |
| Themes | same-org add and remove both work |
| Object links | manual readthrough creation, read-back, and deletion by creator |
| TDF | holdings and snapshot lists populate |
| Revisions | authorized revision write and display; own-org contribution history displays |

---

## 8. Explore cross-tenant search — before / after

The sharpest form of the finding, and the one thing the matrix proves directly.

**Before.** `useExploreSearch.ts:190` selected `thesis, where_different,
risks_to_thesis` from `assets` and applied an `ILIKE` across them. `assets` has
no organization and `SELECT USING (true)`, so a user in any of the 27
organizations could find another firm's thesis by typing a phrase from it.

**After.**

| Check | Result |
|---|---|
| matrix #4 — the same `ILIKE` shape against `assets` | **refused: permission denied** |
| matrix #12 — research search as org A | 1 row: only org A's |
| matrix #13 — same search as an unaffiliated user | 0 rows |
| matrix #23 — the same phrase against contribution *history* | 0 rows |
| smoke #11 — own research still findable | 1 row |

The search still works. It no longer crosses a tenant.

---

## 9–13. Per-table results

**`asset_contributions` NULL escape (§9).** Every policy carried
`(organization_id = current_org_id() OR organization_id IS NULL)`, making an
unattributed row visible and writable in *every* tenant. Production has exactly
one such row (an NKE `thesis` contribution) and its author belongs to exactly
**one** organization — so unlike the other ambiguous cases in C1, this one is
deterministically recoverable and is backfilled, not quarantined. The backfill is
self-limiting: it resolves only authors with exactly one active membership; a
multi-org author leaves the row NULL and it becomes invisible to everyone rather
than visible to everyone. The NULL branch is gone from all 7 policies, and a
trigger assigns tenancy on write. Multi-org behaviour proven explicitly (matrix
#11, #14–17, #83).

**`asset_contribution_history` (§10).** Was `SELECT USING (true) TO public` over
22 rows of contribution prose — the edit history of the correctly-scoped table.
Now EXISTS via `asset_contributions.organization_id`; chain measured total, no
backfill, no new column. Sequenced **before** the assets migration, because
closing it afterwards would have relocated the leak rather than closed it. The
`INSERT` path is unchanged: the writer is a `SECURITY DEFINER` trigger and needs
no policy.

**`asset_field_history` (§11).** Split by `field_name`. 1,052 system/workflow
rows (1,007 of them unattributed `process_stage` churn across 505 assets in a
four-week window — a bulk operation, not user edits) stay authenticated-readable.
The 14 research rows are creator-only, with **no inferred org backfill**: 12 of
14 sit on an `(asset_id, section)` pair with a single owning org in
`asset_contributions`, but that infers tenancy for a global-column write from a
different table's row, which is the reasoning C1 rejected for the values
themselves. The old `WITH CHECK (true)` INSERT policy — which let any
authenticated user forge history — is not replaced.

**`scenarios` (§12).** 111 global defaults stay `organization_id` NULL and
readable by all; they are now immutable to ordinary users, which closes the
`OR (is_default = true)` UPDATE branch that had no `WITH CHECK` at all. Custom
scenarios carry an explicit org assigned by trigger. The one legacy custom row
keeps NULL and is creator-only — its author belongs to 2 organizations, so
membership does not identify its tenant. A CHECK enforces the pairing, exempting
that row by id rather than weakening the rule for every future row. The unique
index becomes `(asset_id, name, created_by, organization_id)` so tenancy is part
of identity.

**`asset_revisions` / `asset_revision_events` (§13).** Both get
`organization_id`, forward-only. The revision owns the tenant and takes it from
`current_org_id()` — the org the caller is *actively standing in*, gated on an
active unexpired membership — never from `actor_user_id` membership, because 4
of the 6 historical actors are multi-org. Events inherit from the parent and are
refused if the parent belongs to another org. The 13 + 22 historical rows keep
NULL and are reachable by their actor only. Editing a quarantined row does not
adopt it into the editor's org.

---

## 14. `object_links`, TDF, `theme_assets`

**`object_links` (§14).** Explicit column, because 12 of 25 rows have a global
endpoint on one side and neither endpoint alone determines tenancy. Backfill
25/25 deterministic, 0 quarantine. The trigger *assigns* rather than validates,
so a caller-supplied org is discarded (matrix #52–53). Two tenant-owned
endpoints in different orgs are refused. See §5b for the two corrections the
production dry run forced.

**TDF (§15).** `EXISTS` through `snapshot_id → tdf_id →
target_date_funds.organization_id`; chain measured total, both join columns and
both parent org columns `NOT NULL`. The `WITH CHECK` on UPDATE is the half that
matters: without it a caller could move a row they own into another tenant's
fund (matrix #34).

**`theme_assets` (§16).** `EXISTS` on `themes.organization_id`, ANDed onto
**INSERT** and not merely onto the read — the defect was that
`added_by = auth.uid()` asks only "are you claiming to be yourself?", which every
caller satisfies. `added_by` is kept on UPDATE/DELETE to preserve the existing
per-user semantic rather than smuggle a behaviour change into a security fix.

---

## 17. Grants

`REVOKE ALL … FROM anon` and `REVOKE TRUNCATE, REFERENCES, TRIGGER … FROM
authenticated` on the 14 C1 tables. Verified: 0 anon grants, 0 authenticated
TRUNCATE grants.

`assets` is different: its table-level `SELECT`/`INSERT`/`UPDATE` grant was
replaced by a **column-level** grant, because a table-level grant implies the
privilege on every column and makes a column `REVOKE` a no-op. The list is built
from the live column set at run time — staging is missing 10 columns production
has (§19) — but it remains an allowlist, not a denylist: the migration **raises**
if `assets` has grown a column classified as neither reference nor restricted, so
a column added after this review fails the migration instead of being silently
exposed.

The schema-wide version of this — `TRUNCATE` on 271 tables for `anon` and 293
for `authenticated` — is deliberately **out of scope** and documented separately
in `least-privilege-truncate.md`, including the point that it is a
least-privilege defect with **no demonstrated PostgREST exploit path**.

---

## 18. Indexes and query plans

New: `object_links(organization_id)`, `scenarios(organization_id) WHERE NOT
is_default`, `asset_revisions(organization_id)`,
`asset_revision_events(organization_id)`,
`asset_workflow_progress(workflow_id)`, `asset_workflow_priorities(workflow_id)`
— the last two because `workflow_id` is the second column of those tables' only
unique index, so the EXISTS could not use it.

The design's other proposed indexes were dropped as redundant: measured against
`pg_indexes`, the TDF and theme EXISTS chains already resolve through primary
keys plus the existing `idx_target_date_funds_org_id` / `idx_themes_org_id`.

Plans under synthetic volume (30–60× production), read as a real authenticated
caller:

| Query | Plan | Time |
|---|---|---|
| `tdf_holdings` full scan, 2-hop EXISTS, 20k rows | Aggregate | **9.1 ms** |
| `theme_assets` full scan, 1-hop EXISTS, 10k rows | Aggregate | **5.3 ms** |
| `theme_assets` selective by `asset_id` | **Index Scan** | 1.4 ms |
| `tdf_holdings` selective by `snapshot_id` | **Index Scan** | 2.6 ms |

No sequential re-scan of a parent per row. No further index is justified.

---

## 19. Guard, ratchet — and staging drift

Guard against the regenerated post-fix staging inventory:
**PASS — 106 known findings, 0 new.**

Ratchet shrunk by 9: `object_links`, `theme_assets`, `scenarios`, `tdf_holdings`,
`tdf_holdings_snapshots`, `asset_contribution_history`, `asset_field_history`,
`asset_revisions`, `asset_revision_events`.

The `assets` allowlist reason was rewritten. The old text —
*"Ticker/name/sector reference, identical for all tenants"* — was false when
written against the live data. No proprietary column was allowlisted to silence
the finding; the columns were revoked instead.

**Note on running the guard against production:** those 9 entries will report as
*new* findings until C1 executes there. That is correct behaviour — it says
production is behind this branch — but it means a production-inventory guard run
will fail in the interval.

### Staging drift found along the way

Not caused by this release, but it limits what staging can prove:

* `assets` is missing **10 columns** production has (`asset_type`, `currency`,
  `isin`, `figi`, `mic`, `identity_source`, `current_symbol`,
  `lifecycle_status`, `lifecycle_note`, `lifecycle_checked_at`) — the
  instrument-identity and lifecycle migrations never reached staging.
* `organization_id` is missing on `asset_notes`, `theme_notes`,
  `portfolio_notes` and `trade_queue_items` — which are precisely the
  `object_links` endpoint types production actually uses. The matrix therefore
  exercises the resolver through `theme` endpoints (identical code paths), and
  the note/trade-idea branches are verified against production read-only in `91`
  instead.

### Pre-existing failure, not caused by C1

`scripts/frontend-tenant-lint.mjs` **fails** with 13 new P0 violations above its
baseline (55 total vs. baseline 38). Verified identical before and after this
work by re-running it against the pre-change `src/`: **55 / 30 P0 in both
cases**. The violations are in `workflows`, `projects`, `themes`,
`calendar_events` and `conversations` — none in C1's tables or new code. Left
alone: fixing it is a different release.

---

## 20. Production projections

| Table | Backfill | Quarantine |
|---|---|---|
| `object_links` | **25** rows, all deterministic | 0 |
| `asset_workflow_priorities` | **489** new rows from `assets.priority` | — |
| `asset_workflow_progress` | **478** new rows from `assets.process_stage` | — |
| `assets` workflow state with no workflow anchor | — | **16** |
| `assets` research prose | **0** — 6 of 8 values already exist byte-identical in `asset_contributions` | **2** (AAPL `thesis`, V `quick_note`) |
| `asset_contributions` | **1** row (single-membership author → deterministic) | 0 |
| `scenarios` | 111 defaults stay NULL by design | **1** legacy custom |
| `asset_revisions` | none | **13** |
| `asset_revision_events` | none | **22** |
| `asset_field_history` | none | 14 research rows creator-only; 1,052 system rows stay readable |
| `asset_contribution_history`, TDF, `theme_assets`, workflow state | none — EXISTS needs no column | 0 |

Quarantine always means creator-only reachability, never a fabricated
organization.

---

## 21. Proposed production execution order

Preflight, all read-only: re-run `91` (endpoint dry run) and re-confirm the
counts in §20 — production may have moved since 2026-08-29.

```
 1  01-tdf-holdings-snapshots.sql       parent before child
 2  02-tdf-holdings.sql
 3  03-theme-assets.sql
 4  04-object-links.sql                 backfills 25 rows BEFORE the trigger exists
 5  05-scenarios.sql                    exempts the 1 legacy row by id
 6  06-asset-revisions-events.sql       35 rows quarantined
 7  07-asset-contribution-history.sql   MUST precede 9
 8  08-asset-contributions.sql          backfills 1 row, removes the NULL escape
 9  08b-asset-workflow-state.sql        MUST precede 10 — the migration target
10  09-assets-proprietary-columns.sql   967 rows migrated, column grants replace table grant
11  10-asset-field-history.sql
12  11-grants.sql
13  deploy the application changes       — see the ordering constraint below
14  regenerate the production inventory; run the guard; expect 0 new
```

**The one ordering constraint that is not negotiable.** Step 10 revokes the
column grants, and a client still issuing `select('*')` on `assets` begins
failing at that moment. The application changes must be **deployed before or
together with step 10**, not after. Steps 1–9 are invisible to a correctly
behaving client; step 10 is not.

`07` (messages) is already validated and independent; it can go in the same
window or separately.

---

## 22. Rollback

Every file is a single transaction, so a failure mid-file rolls itself back. Per
step:

| Step | Rollback |
|---|---|
| 1–3, 7, 10, 11 (policy-only) | re-create the previous policies; their exact prior text is in `c1-checkpoint.md` §1 and the pre-change inventory `docs/audit/baselines/c1-prod-20260828-220413.json` |
| 4 `object_links` | drop the trigger and policies; the column can stay (additive and nullable) |
| 5 `scenarios` | drop the trigger, CHECK and the new unique index; restore `scenarios_asset_id_name_created_by_key`; restore the 4 policies |
| 6 revisions | drop 2 triggers, restore 5 policies; columns stay |
| 8, 9 (`08b`) | restore the prior policies |
| 10 `09` | `GRANT SELECT, INSERT, UPDATE ON public.assets TO authenticated` restores the table-wide grant, which supersedes the column grants. **The migrated workflow rows are not removed** — they were `ON CONFLICT DO NOTHING` inserts into the authoritative model and are correct there regardless |
| 12 `11-grants` | re-grant; but re-granting `anon` should require a decision, not a reflex |

**Nothing in this package is destructive.** No column is dropped, no row is
deleted, no value is overwritten — the two quarantined prose values remain in
place in a column no ordinary role can read, and are recoverable if an
organization is ever established for them.

The application deploy is the awkward half of a rollback: reverting step 10
alone leaves the client selecting fewer columns than it may, which is harmless.
Reverting the *application* without reverting step 10 breaks reads. So roll back
the SQL first, or roll back both.

---

## 23. Still blocking production

1. **Staging cannot exercise the `object_links` note/trade-idea endpoints**
   (§19). Mitigated by the production read-only dry run (25/25, 0 conflicts),
   but that verifies *existing* rows, not a live INSERT. Either accept the dry
   run as sufficient, or apply the missing migrations to staging first — which
   is a separate authorization.
2. **The application deploy must be coordinated with step 10** (§21). This is a
   sequencing requirement, not an unknown.
3. **`08b` is new since the design package** and changes behaviour beyond a pure
   tenant boundary: progress on a public workflow is no longer visible across
   organizations. Correct in my view — a workflow *template* may be shared, one
   firm's progress through it is not — but it is a product-visible change that
   was not in the approved design and should be confirmed.
4. The **production guard run will fail** until C1 executes there (§19).

Not blocking: the `frontend-tenant-lint` failure (pre-existing, unrelated) and
the staging `assets` column drift (handled by building the grant from the live
column set).

---

## 24. Readiness

**READY for Main Control production review**, subject to item 3 above being
confirmed and item 1 being accepted or resolved.

What is established: the full package applied cleanly to staging in order;
70/70 policy matrix including multi-org and unaffiliated identities; 23/23
product smoke covering every flow named in the brief; plans healthy at 30–60×
production volume; guard PASS with 0 new findings and the ratchet down 9; every
production backfill deterministic or explicitly quarantined; and two defects
found *by the validation* — a migration target with no tenant boundary, and a
backfill that would have failed on production — both fixed and re-verified.

What is not established: the four `object_links` endpoint types staging cannot
host, and any behaviour on production-scale data, which by design was not
reproduced.

---

## 25. Feature-release freeze

**Recommendation: YES, lift the freeze — but only after successful production
execution, and not before.**

The freeze exists because proprietary research and workflow state on 506 of 912
production assets are readable, and searchable, by every authenticated user in
all 27 organizations. Nothing in this package has changed that: **production is
untouched**. Staging proves the fix works; it does not fix production.

Once steps 1–14 complete on production and the guard returns 0 new findings
against a fresh production inventory, the condition the freeze was set for is
met: the nine proprietary `assets` columns and the original seven C1 tables all
have an enforced tenant boundary, verified behaviourally rather than by reading
policy text.

Two caveats to carry past the freeze rather than block on:

* The ratchet still holds **106 known findings**. C1 closed the tables it scoped;
  it did not close the schema.
* The schema-wide `TRUNCATE` grants remain on ~256 untouched tables
  (`least-privilege-truncate.md`). No demonstrated exploit path, but it should
  be scheduled rather than forgotten.
