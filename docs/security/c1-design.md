# Security C1 — remediation design package

**Branch:** `fix/security-c1` · **2026-08-29** · Supersedes the open questions in
`c1-checkpoint.md`, which remains the evidence record.

**Applied so far:** `07` on **staging only**. Nothing else is applied anywhere.
**Production was read-only throughout** — every production figure below came
through `scripts/sql/security-c1/mgmt-query.mjs`, which wraps each batch in
`SET TRANSACTION READ ONLY` and refuses `--allow-writes` on any environment but
staging. No production write was attempted.

---

## 1. `07` staging result

**All 8 assertions pass, including a demonstrated exploit.**

Staging carried the identical pre-fix function body to production
(`pg_get_functiondef` md5 `e66e67c628d5`, 2454 bytes — byte-identical). `07`
applied cleanly; the deployed body is now 3475 bytes, md5 `e280f8288e7a`,
`SECURITY DEFINER` retained, `search_path` still pinned to `public, pg_temp`.

The suite (`scripts/sql/security-c1/07-staging-behaviour.sql`) does not merely
assert the post-fix state. It **reinstalls the pre-07 production body inside the
test transaction and performs the cross-tenant write first**, so the "after"
denial is known to be the guard firing rather than a fixture that never reached
it. Everything runs in one transaction and ends in a deliberate `RAISE`, so the
fixtures, both function swaps and every test row roll back; the assertion table
is carried out in the exception message precisely because a committed result set
would defeat the rollback.

| # | Phase | Test | Expected | Result |
|---|---|---|---|---|
| 0 | BEFORE | cross-tenant write to foreign team-less portfolio | exploitable | **EXPLOITED — stored as caller org A** |
| 1 | AFTER | same-org team-less portfolio INSERT | accepted, org from portfolio | accepted, org = A |
| 2 | AFTER | foreign-org team-less portfolio INSERT | REFUSED | refused by the owner-bearing guard |
| 3 | AFTER | same-org portfolio **with** team INSERT | accepted, org = A | accepted, org = A |
| 4 | AFTER | nonexistent portfolio INSERT | REFUSED | refused |
| 5 | AFTER | global context type (`asset`) INSERT | falls back to caller org | accepted, org = A |
| 6 | AFTER | UPDATE of orphan, context unchanged | accepted, org preserved | accepted, org preserved as A |
| 7 | AFTER | UPDATE moving context to foreign portfolio | REFUSED | refused |

Test 0 is the material one: under the pre-07 body a user in org A wrote a
message against **org B's** team-less portfolio and it was stored as org A's,
exactly as predicted. Test 5 confirms `07` did not over-correct — a genuinely
tenant-less context still falls back to the caller's org.

Post-run verification: staging holds 0 messages, 0 portfolios, 0 fixture orgs,
0 fixture teams, 0 fixture users, and the fix is still applied.

### Two findings the suite produced on its own

**a. `authenticated` holds no `UPDATE` grant on `messages`** — on staging *or*
production (`service_role` only). Tests 6 and 7 first ran as `authenticated` and
both returned `permission denied for table messages`. Test 7 therefore *passed
for the wrong reason*: it was refused by a missing grant before the trigger ever
fired. They were re-run as `service_role`, which is the only role that can reach
the trigger's UPDATE branches. **The UPDATE half of `07` is unreachable from the
client and matters only for `service_role` and `SECURITY DEFINER` RPC paths.**
That does not make it unnecessary, but it should be stated accurately rather
than claimed as user-facing protection.

**b. Transport.** The Management API is sufficient for the full methodology, so
**no staging psql credential is required**. Measured, not assumed: one batch is
one transaction (`set_config(...,true)` set in statement 1 is visible in
statement 2 and gone in the next batch); `role` and `request.jwt.claims` are
settable mid-batch and `auth.uid()` resolves from them; and an error at the end
of a batch rolls back durable DDL and DML (a `CREATE TABLE` + `INSERT` followed
by `1/0` left `to_regclass` NULL). The only adaptation is that the endpoint
opens the transaction itself, so an explicit outer `BEGIN`/`COMMIT` pair is a
syntax error and is stripped; the statements still commit or abort together, so
semantics are preserved, not relaxed.

---

## 2. `assets` — column classification (live production schema)

32 live columns. Ordinal gaps (4, 5, 9–12, 16, 17) are dropped columns.

### A — Global reference (stays on `assets`)

| Column | Populated / 912 |
|---|---|
| `id`, `symbol`, `company_name` | 912 |
| `sector`, `country`, `exchange`, `asset_type` | 911 |
| `currency` | 862 |
| `industry` | 405 |
| `isin`, `figi`, `mic` | 0 |
| `identity_source` | 911 |

### B — Market / system data (stays on `assets`)

| Column | Populated |
|---|---|
| `current_price` | 68 |
| `market_cap` | 10 |
| `lifecycle_status`, `lifecycle_note`, `lifecycle_checked_at` | 49 |
| `created_at`, `updated_at` | — |

### C — Proprietary investment view (**must not be global**)

| Column | Populated | Note |
|---|---|---|
| `thesis` | **5** | the known finding |
| `where_different` | **1** | |
| `risks_to_thesis` | **1** | |
| `quick_note` | **1** | **not previously identified**; also not tracked by the history trigger |
| `thesis_references` (jsonb) | **1** | **not previously identified** |
| `completeness` | **7** | derived from the prose fields |
| `priority` (non-`none`) | **506** | **not previously identified** — 55% of the table |
| `process_stage` (non-`research`) | **506** | **not previously identified** |
| `workflow_id` | **490** | **not previously identified** — FK to `workflows`, whose `organization_id` is `NOT NULL` |

### D — Ambiguous, resolved

`created_by` (506) — attribution, not tenancy. Stays; it is what the current
UPDATE/DELETE policies key on. Note 406 assets have `created_by` NULL, so under
`auth.uid() = created_by` **no one can update them at all** — an availability
artefact worth knowing, not a security hole.

### The two conclusions that change the shape of the problem

**The finding is 55% of the table, not 5 rows.** The checkpoint scoped this to
three prose fields. `priority`, `process_stage` and `workflow_id` are research
workflow state — what a firm is working on and how urgently — on 506 assets,
readable by every authenticated user in all 27 organizations.

**`assets.workflow_id` is structurally single-tenant.** All 490 values resolve
to **one** organization (`4b4713e8…`), 0 dangling. There is no cross-org
conflict today only because one org uses workflows. A single-valued column on a
globally shared row cannot hold a second org's answer, so the second org to
adopt workflows collides. That is a correctness defect that exposure remediation
would otherwise leave in place.

---

## 3. `assets` caller / writer map

**Writers (client).** The app no longer writes the prose columns at all.
Only two of the nine class-C columns are still written from `src/`:

| Column | Write sites |
|---|---|
| `workflow_id` | 5 (`AssetTab.tsx`, `AssetTableView.tsx`) |
| `thesis_references` | 1 |
| `completeness` | 1 — `AssetTab.tsx:1580` `updateAssetCompleteness()`, recomputed from `asset.thesis / where_different / risks_to_thesis` |
| `thesis`, `risks_to_thesis`, `where_different`, `quick_note`, `priority`, `process_stage` | **0** |

**Writer (database).** `track_asset_field_changes()` — `SECURITY DEFINER`
trigger on `assets`, the sole producer of `asset_field_history`. It tracks
exactly `thesis`, `where_different`, `risks_to_thesis`, `priority`,
`process_stage`, `thesis_references`. It does **not** track `quick_note`,
`completeness` or `workflow_id`, which is why `quick_note` has no history to
resolve provenance from.

**Readers — 6 sites, and one is worse than the others:**

| Site | Reads |
|---|---|
| `useExploreSearch.ts:190` | `thesis, where_different, risks_to_thesis` |
| `NotesListPage.tsx:171` | `thesis, where_different, risks_to_thesis, priority, process_stage` |
| `InlineReferencePopup.tsx:344` | `thesis, where_different, risks_to_thesis` |
| `useCapture.ts:264` | `priority, process_stage, quick_note` |
| `PortfolioCommandCenter.tsx:87` | `thesis, process_stage` |
| `PortfolioWorkbench.tsx:108` | `thesis, process_stage` |

`useExploreSearch` runs an `ILIKE` pass across `thesis`, `where_different` and
`risks_to_thesis` on a table whose SELECT policy is `USING (true)`. **That is a
cross-tenant full-text search over proprietary research prose** — a materially
worse exposure shape than "you can read a row if you already know its id",
because it lets a user in any org discover another firm's thesis by searching
for a phrase. This is the single sharpest expression of the finding.

**Policies (live).** `SELECT USING (true) TO authenticated`;
`INSERT/UPDATE/DELETE` all keyed on `auth.uid() = created_by`. So the leak is a
read leak; cross-tenant *overwrite* of another firm's thesis is not currently
possible unless the attacker created the asset row.

---

## 4. Existing org-scoped storage candidates

Four per-asset tables already carry `organization_id`: `asset_contributions`,
`asset_models` (0 rows), `asset_notes`, `asset_page_templates`.

**`asset_contributions` is already the authoritative org-scoped proprietary
asset view, and it already stores exactly these fields.**

| section | rows | assets | orgs |
|---|---|---|---|
| `thesis` | 12 | 9 | 2 |
| `business_model` | 8 | 5 | 2 |
| `risks_to_thesis` | 5 | 4 | 1 |
| `where_different` | 4 | 4 | 1 |
| `key_catalysts` | 3 | 3 | 1 |

`src/lib/research/contribution-sections.ts` maps template slugs to these section
keys, and its own comment states the model plainly: *"each field's prose lives in
`asset_contributions` under a section key."* Its RLS is genuinely org-scoped —
`is_active_member_of_current_org() AND organization_id = current_org_id()`, plus
a visibility/org-chart term — and it has a history table
(`asset_contribution_history`) and an index on `organization_id`.

The workflow-state columns have existing homes too, both with a **total** org
chain through `workflows.organization_id` (`NOT NULL`, 0 unresolved):

* `asset_workflow_progress` — 396 rows, 76 assets, `current_stage_key` is the
  org-scoped equivalent of `assets.process_stage`.
* `asset_workflow_priorities` — 6 rows, `(asset_id, workflow_id, priority)`, the
  org-scoped equivalent of `assets.priority`.

**Conclusion: no new table is required for any class-C column.** Every one has
an existing authoritative org-scoped home. The `assets` columns are a legacy
duplicate of a model the product already moved to.

---

## 5. Recommended architecture

**GLOBAL ASSET + ORG-SCOPED INVESTMENT VIEW**, implemented by *retiring*
duplicated state rather than by adding tenancy to `assets`.

| `assets` column | Org-scoped home | Org authority |
|---|---|---|
| `thesis`, `risks_to_thesis`, `where_different` | `asset_contributions` (section key) | explicit `organization_id` |
| `quick_note` | `asset_contributions`, new section `quick_note` | explicit `organization_id` |
| `thesis_references` | `asset_contributions.attachments` | explicit `organization_id` |
| `completeness` | derived at read time from contributions | derived |
| `process_stage` | `asset_workflow_progress.current_stage_key` | `workflows.organization_id` (EXISTS, total) |
| `priority` | `asset_workflow_priorities.priority` | `workflows.organization_id` (EXISTS, total) |
| `workflow_id` | `asset_workflow_progress.workflow_id` | `workflows.organization_id` (EXISTS, total) |

`assets` keeps class A and class B, keeps `SELECT USING (true)`, and the guard's
allowlist reason is rewritten to describe what actually remains:

```
assets: 'Security master: identity, listing and market reference only.
         Proprietary research lives in asset_contributions (org-scoped);
         workflow state in asset_workflow_progress / _priorities.'
```

**Sequencing note, and the one place I would push back on doing the minimum.**
Dropping the class-C columns is the correct end state, but a `DROP COLUMN` is
not reversible and 6 read sites still select them. The safe order is: migrate and
quarantine the data → repoint the 6 readers → *then* drop. Between those steps
the columns must be neutralised, not left readable. I therefore propose
**column-level `REVOKE`** as the interim boundary (§12), which removes the leak
immediately without a destructive schema change and without waiting on frontend
work. This is the one recommendation in this package that costs a follow-up
release; the alternative is leaving a cross-tenant research search live for the
duration of the frontend migration.

---

## 6. Provenance of the live proprietary values

Read-only, hashes only — **no prose was extracted**. Eight populated values
across 6 assets.

| Asset | Field | len | Existing contribution in same section | Exact content match | Verdict |
|---|---|---|---|---|---|
| AMZN | `thesis` | 27 | 1 (org `4b4713e8`) | **yes** | duplicate |
| AMZN | `risks_to_thesis` | 17 | 1 (org `4b4713e8`) | **yes** | duplicate |
| AMZN | `where_different` | 21 | 1 (org `4b4713e8`) | **yes** | duplicate |
| LLY | `thesis` | 62 | 1 (org `4b4713e8`) | **yes** | duplicate |
| PLTR | `thesis` | 101 | 1 (org `4b4713e8`) | **yes** | duplicate |
| WMT | `thesis` | 2 | 1 (org `4b4713e8`) | **yes** | duplicate |
| **AAPL** | `thesis` | 88 | **2, in two different orgs** (`35ae7b0b`, `4b4713e8`) | **no** | **ambiguous** |
| **V** | `quick_note` | 14 | 0 (no such section; field untracked) | n/a | **ambiguous** |

**6 of 8 need no migration at all** — an org-scoped copy already exists, owned by
`4b4713e8`, byte-identical. Clearing the legacy column loses nothing.

The two ambiguous values were both last written by a user who belongs to **2
organizations**. For AAPL the writer's orgs are `{4b4713e8, c3e1a71c}` and the
section's contributions are `{35ae7b0b, 4b4713e8}` — the intersection is a single
org, but that is an *inference across two storage models*, not a derivation.
Per the standing rule that a multi-org actor does not identify a row's tenant:

> **AAPL `thesis` and V `quick_note` → quarantine. No organization is guessed.**

Workflow state: **490 of 506** `priority` and `process_stage` values are
org-derivable through `workflow_id → workflows.organization_id` — a real FK to an
org-owning parent, not a membership guess. **16 have no workflow anchor and are
quarantined.** `completeness`: 5 of 7 derivable, 2 quarantined.

---

## 7. `asset_field_history` — final classification

Single writer, `track_asset_field_changes()`. Two populations, confirmed:

| field | rows | unattributed | class |
|---|---|---|---|
| `process_stage` | 1039 | **1007** | global/system churn — 505 assets in a 4-week window |
| `priority` | 13 | 1 | mixed |
| `thesis` | 10 | 0 | **proprietary** |
| `risks_to_thesis` | 2 | 0 | **proprietary** |
| `where_different` | 2 | 0 | **proprietary** |

**Split model:**

* **System history** (1,007 unattributed `process_stage` rows): bulk workflow
  churn on global asset records. **Not quarantined**, per the standing decision.
  It becomes readable to authenticated users as system history, or — better —
  follows the same workflow authority as the column it logs once
  `process_stage` moves to `asset_workflow_progress`.
* **Proprietary research history** (14 rows: `thesis`, `risks_to_thesis`,
  `where_different` — 100% attributed): follows the tenant authority of the
  proprietary asset view.

On backfilling those 14: an anchor exists — 12 of 14 sit on an
`(asset_id, section)` pair with exactly one owning org in `asset_contributions`,
2 (the AAPL rows) are multi-org. **I recommend not using it.** The anchor infers
tenancy for a *global-column write event* from a *different table's* row, which
is the same class of reasoning the AAPL value was quarantined for. These 14 rows
log a column being retired, and their org-scoped successor history already exists
in `asset_contribution_history`. **Creator-only (`changed_by = auth.uid()`), no
org backfill** — the same treatment as `asset_revision_events`, and consistent.

### Escalation: `asset_contribution_history` is the sharper leak

`asset_contribution_history` is `SELECT USING (true) TO public` over **22 rows,
100% carrying `new_content` prose, spanning 3 assets in 1 org**. It is the edit
history of the *correctly scoped* `asset_contributions` — so the table the
product uses to protect research leaks that research's full revision history to
every authenticated user. It is already on the guard's `KNOWN_UNRESOLVED`
ratchet, so it is known; what is new is that it is the migration target for
§5 and must be closed **in the same change**, not after. Migrating prose out of
`assets` into `asset_contributions` while this stays open would move the leak,
not close it.

Its chain is **total**: 0 dangling, 0 parent-without-org. `EXISTS` works, no
backfill needed.

---

## 8. `scenarios` — final design

Production: 112 rows; 111 `is_default = true` with `created_by` NULL; **1**
genuine custom scenario ("Uber Bull"), whose creator belongs to **2
organizations** → not deterministically recoverable → **quarantine**.

```sql
-- global defaults: readable by all, writable by none
SELECT  USING (is_default OR organization_id = current_org_id())
INSERT  WITH CHECK (NOT is_default AND organization_id = current_org_id() AND created_by = auth.uid())
UPDATE  USING      (NOT is_default AND organization_id = current_org_id() AND created_by = auth.uid())
        WITH CHECK (NOT is_default AND organization_id = current_org_id() AND created_by = auth.uid())
DELETE  USING      (NOT is_default AND organization_id = current_org_id() AND created_by = auth.uid())
```

This closes the live defect: the current UPDATE policy is
`(auth.uid() = created_by) OR (is_default = true)` **with no `WITH CHECK`**, so
any authenticated user can mutate any of the 111 global default scenarios.

`organization_id uuid NULL` is added, `NOT NULL` is **not** enforced (defaults
require NULL). Integrity is a CHECK instead:

```sql
CHECK ((is_default AND organization_id IS NULL) OR (NOT is_default AND organization_id IS NOT NULL))
```

The legacy custom row is exempted from that CHECK by being flipped to
creator-only quarantine (see §14) rather than being given a fabricated org.

**Regression risk to verify:** the existing unique index is
`(asset_id, name, created_by)`. Two orgs can now legitimately want the same
scenario name on the same asset, and with `created_by` in the key they mostly
will not collide — but the index should become
`(asset_id, name, created_by, organization_id)` so tenancy is part of identity.
Case-vs-Price and the scenario ladder read by `asset_id` only and never filter by
org (`useScenarios.ts`, 4 sites; `MobileDashboard.tsx`, 1), so the `is_default OR
same-org` SELECT keeps them working unchanged.

---

## 9. `asset_revision_events` — final design

22 rows; parent `asset_revisions` is `view_scope_type = 'firm'` for every row,
0 dangling, but carries **no** organization column. **4 of 6 actors belong to
more than one org**, so actor→membership is not a derivation.

* **Historical (22 rows):** creator-only, quarantined. No org backfill.
* **Forward:** explicit `organization_id uuid NOT NULL` on new rows.

**Forward derivation path — and it must not come from the actor.** The rule is
that the org is taken from the *parent revision*, and the parent's org is
validated against the caller at write time:

1. Add `organization_id uuid` to **`asset_revisions`** as well. It is the object
   that owns the tenant; the event table inherits it.
2. `BEFORE INSERT` trigger on `asset_revisions`:
   `NEW.organization_id := current_org_id()`, and `RAISE` if that is NULL.
   Never caller-supplied, never derived from `actor_user_id` membership —
   `current_org_id()` is the org the caller is *actively standing in*
   (`users.current_organization_id`, gated on an active, unexpired membership),
   which is exactly the distinction a multi-org user needs.
3. `BEFORE INSERT` trigger on `asset_revision_events`: resolve
   `organization_id` from the parent revision, and `RAISE` if the parent's org
   is not `current_org_id()`. This is the same "refuse rather than fall back"
   shape `07` established.
4. Existing rows keep `organization_id` NULL and are reachable only by their
   actor, so `NOT NULL` is deferred until the quarantine is emptied.

---

## 10. `object_links` — final design and backfill

25 rows, `created_by` populated on all 25, **25/25 deterministically
attributable, 0 ambiguous, 0 cross-org conflicts**. No quarantine bucket.

| source → target | link_type | auto | n |
|---|---|---|---|
| `asset_note` → `asset` | references | no | 10 |
| `asset_note` → `trade_idea` | supports | no | 9 |
| `trade_idea` → `trade_idea` | opposes | no | 3 |
| `asset_note` → `asset` | references | **yes** | 1 |
| `asset_note` → `trade_idea_thesis` | supports | no | 1 |
| `theme_note` → `asset` | references | **yes** | 1 |

**Backfill resolution (deterministic, no guessing):** `asset_note` →
`asset_notes.organization_id`; `theme_note` → `theme_notes.organization_id`,
falling back to `themes.organization_id` via `theme_id`; `trade_idea` →
`trade_queue_items.organization_id`, falling back to `portfolios.organization_id`
via `portfolio_id`, then `pair_trades`. **`asset` endpoints are global and
contribute nothing** — which is exactly why the link needs its own column: 12 of
25 have a global endpoint on one side, so neither endpoint alone determines
tenancy.

Forward: `organization_id` assigned by a `BEFORE INSERT OR UPDATE` trigger that
resolves both endpoints, **rejects a link whose two tenant-owned endpoints
belong to different orgs**, and rejects a caller-supplied value. Global endpoints
contribute nothing; a link with two global endpoints and no caller org is
refused rather than defaulted.

---

## 11. TDF + `theme_assets` policy design

Chain totality re-measured on production: **0 unresolved** for all three.

* `tdf_holdings` → `snapshot_id` → `tdf_id` → `target_date_funds.organization_id`
* `tdf_holdings_snapshots` → `tdf_id` → `target_date_funds.organization_id`
* `theme_assets` → `theme_id` → `themes.organization_id`

All join columns are `NOT NULL` and both parent `organization_id` columns are
`NOT NULL`. `EXISTS`, no denormalisation — the condition that was *absent* for
`portfolios.team_id`, which is what quarantined 13 messages in Release B.

`theme_assets` must reject adding an asset to another organization's theme **even
when `added_by = auth.uid()`**, which the current `added_by = auth.uid()` INSERT
policy does not. The org predicate is therefore ANDed on INSERT, not just on
read, and `added_by = auth.uid()` is kept only on UPDATE/DELETE to preserve
existing per-user semantics.

---

## 12. Exact policy shapes

Every UPDATE gets a matching `WITH CHECK` so a row cannot be rewritten out of its
tenant. All policies `TO authenticated`.

**`tdf_holdings`**
```sql
USING / WITH CHECK:
EXISTS (SELECT 1 FROM tdf_holdings_snapshots s
          JOIN target_date_funds f ON f.id = s.tdf_id
         WHERE s.id = tdf_holdings.snapshot_id
           AND f.organization_id = current_org_id())
```

**`tdf_holdings_snapshots`**
```sql
EXISTS (SELECT 1 FROM target_date_funds f
         WHERE f.id = tdf_holdings_snapshots.tdf_id
           AND f.organization_id = current_org_id())
```

**`theme_assets`**
```sql
SELECT / INSERT:            <org EXISTS>
UPDATE / DELETE:            <org EXISTS> AND added_by = auth.uid()
where <org EXISTS> =
EXISTS (SELECT 1 FROM themes t
         WHERE t.id = theme_assets.theme_id
           AND t.organization_id = current_org_id())
```

**`object_links`**
```sql
SELECT:                     organization_id = current_org_id()
INSERT (WITH CHECK):        organization_id = current_org_id()
UPDATE / DELETE:            organization_id = current_org_id() AND created_by = auth.uid() AND is_auto = false
```

**`scenarios`** — as §8.

**`asset_revision_events`**
```sql
SELECT: organization_id = current_org_id()
        OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM asset_revisions r
              WHERE r.id = asset_revision_events.revision_id
                AND r.actor_user_id = auth.uid()))   -- the 22 quarantined rows
INSERT (WITH CHECK): organization_id = current_org_id()
        AND EXISTS (SELECT 1 FROM asset_revisions r
                     WHERE r.id = revision_id AND r.organization_id = current_org_id())
```

**`asset_revisions`** (newly in scope — parent of the above, `SELECT USING
(true)`, 13 rows, 1 with `revision_note` prose)
```sql
SELECT: organization_id = current_org_id() OR (organization_id IS NULL AND actor_user_id = auth.uid())
UPDATE: organization_id = current_org_id() AND actor_user_id = auth.uid()   (+ WITH CHECK)
```

**`asset_contribution_history`** (chain total, no backfill)
```sql
SELECT: EXISTS (SELECT 1 FROM asset_contributions c
                 WHERE c.id = asset_contribution_history.contribution_id
                   AND c.organization_id = current_org_id())
```

**`asset_field_history`**
```sql
SELECT: field_name IN ('process_stage','priority')          -- system/workflow churn
        OR changed_by = auth.uid()                          -- the 14 research rows, creator-only
INSERT: unchanged (SECURITY DEFINER trigger is the only writer)
```

**`assets`** — policies unchanged. The boundary is column-level:
```sql
REVOKE SELECT (thesis, where_different, risks_to_thesis, quick_note,
               thesis_references, completeness, priority, process_stage, workflow_id)
  ON public.assets FROM authenticated, anon;
```
This closes the cross-tenant research search immediately, without a destructive
`DROP COLUMN` and without blocking on the 6 frontend readers. Those readers must
be repointed first or they will start erroring — see §16 for the ordering.

### Grants — a schema-wide finding

`TRUNCATE` is granted to **`anon` on 271 tables** and to **`authenticated` on 293
tables**, including every C1 table and `assets`. **RLS does not apply to
`TRUNCATE`**, so no policy in this document constrains it.

Reachability, stated honestly: PostgREST does not emit `TRUNCATE`, and the
`anon`/`authenticated` roles are not reachable over a direct Postgres connection
without the database password. So this is a least-privilege defect with **no
demonstrated exploit path**, not a live destructive capability. It does mean the
planned `anon` revoke is worth more than "defence in depth" implied, and it
should extend to `TRUNCATE`, `REFERENCES` and `TRIGGER` for `authenticated` on
these tables, not only to `anon`.

```sql
REVOKE TRUNCATE, REFERENCES, TRIGGER ON <c1 tables> FROM authenticated;
REVOKE ALL ON <c1 tables> FROM anon;
```

---

## 13. Indexes

The checkpoint's §10 list is largely **redundant** — measured against
`pg_indexes`, the EXISTS chains already resolve through primary keys and existing
org indexes:

| Proposed | Status |
|---|---|
| `tdf_holdings_snapshots(id, tdf_id)` | **not needed** — `tdf_holdings_snapshots_pkey(id)` serves the EXISTS |
| `target_date_funds(id, organization_id)` | **not needed** — `pkey(id)` + `idx_target_date_funds_org_id` |
| `themes(id, organization_id)` | **not needed** — `themes_pkey(id)` + `idx_themes_org_id` |
| `object_links(organization_id)` | **required** — new column, direct predicate |
| `scenarios(organization_id) WHERE NOT is_default` | **required** — partial; 111/112 are default |
| `asset_revisions(organization_id)`, `asset_revision_events(organization_id)` | **required** — new columns |

`asset_contribution_history` already has `idx_contribution_history_contribution`,
which is the index its EXISTS needs. Largest table in scope is 1,066 rows, so no
material plan risk; plans should still be captured on staging with synthetic
volume before promotion.

---

## 14. Projected production backfills and quarantines

| Table | Backfill | Quarantine |
|---|---|---|
| `object_links` | **25** rows, all deterministic | 0 |
| `assets` → `asset_contributions` | **0** — 6 of 8 values already exist org-scoped and byte-identical; clear the column | **2** (AAPL `thesis`, V `quick_note`) |
| `assets` workflow state → `asset_workflow_progress` / `_priorities` | **490** `priority`, **490** `process_stage`, **490** `workflow_id`, **5** `completeness` — all via `workflow_id → workflows.organization_id` | **16** `priority` + **16** `process_stage` + **2** `completeness` (no workflow anchor) |
| `asset_contributions` | **1** row (`organization_id` NULL, NKE thesis; creator is in exactly **1** org → deterministic) | 0 |
| `scenarios` | 111 defaults stay NULL by design | **1** legacy custom row |
| `asset_revision_events` | none — no deterministic source | **22** |
| `asset_revisions` | none | **13** |
| `asset_field_history` | none — creator-only, no org backfill | 14 research rows creator-only; 1,052 system rows stay readable |
| `asset_contribution_history` | none — chain total, EXISTS | 0 |
| `tdf_*`, `theme_assets` | none — EXISTS needs no column | 0 |

Quarantine means creator-only reachability, never a fabricated organization.

---

## 15. Synthetic staging test matrix

Staging holds 0 rows in all C1 tables, so every case below is synthetic, and
every branch is exercised in both directions. Same transport and rollback
discipline as `07`: fixtures, `SET LOCAL role` + `request.jwt.claims`,
assertions, deliberate abort.

Fixture set: orgs A and B; user U1 active in A only; user U2 active in **both**
(the multi-org case that broke every membership-based derivation); one theme,
one TDF + snapshot + holding, one asset note, one trade idea, one scenario and
one contribution per org.

| # | Table | Case | Expect |
|---|---|---|---|
| 1–2 | `tdf_holdings` | same-org SELECT / foreign-org SELECT | visible / **0 rows** |
| 3–4 | `tdf_holdings` | INSERT into own fund / into B's fund | accepted / **refused** |
| 5 | `tdf_holdings` | UPDATE rewriting `snapshot_id` to B's snapshot | **refused by WITH CHECK** |
| 6–7 | `tdf_holdings_snapshots` | same-org / foreign-org SELECT | visible / **0 rows** |
| 8 | `tdf_holdings_snapshots` | DELETE of B's snapshot | **refused** |
| 9–10 | `theme_assets` | same-org SELECT / foreign-org SELECT | visible / **0 rows** |
| 11 | `theme_assets` | **INSERT into B's theme with `added_by = auth.uid()`** | **refused** — the named defect |
| 12 | `theme_assets` | INSERT into own theme | accepted |
| 13 | `theme_assets` | UPDATE/DELETE of a row A added to A's theme | accepted |
| 14 | `object_links` | same-org global↔tenant link (`asset_note` → `asset`) | accepted |
| 15 | `object_links` | same-org tenant↔tenant (`asset_note` → `trade_idea`) | accepted |
| 16 | `object_links` | foreign tenant endpoint | **refused** |
| 17 | `object_links` | **caller-supplied foreign `organization_id`** | **overwritten by trigger, not honoured** |
| 18 | `object_links` | manual readthrough creation (`is_auto = false`) | accepted |
| 19–20 | `object_links` | same-org read / cross-org read | visible / **0 rows** |
| 21 | `object_links` | link with two global endpoints, caller has no org | **refused** |
| 22 | `scenarios` | SELECT of a global default | visible to both orgs |
| 23 | `scenarios` | **UPDATE of a global default by an ordinary user** | **refused** — the live defect |
| 24 | `scenarios` | DELETE of a global default | **refused** |
| 25–26 | `scenarios` | custom: same-org read / cross-org read | visible / **0 rows** |
| 27 | `scenarios` | INSERT custom with foreign `organization_id` | **refused** |
| 28 | `scenarios` | Case-vs-Price load: defaults + own custom, by `asset_id` | both returned |
| 29 | `asset_revisions` | cross-org SELECT | **0 rows** |
| 30 | `asset_revision_events` | INSERT against B's revision | **refused** |
| 31 | `asset_revision_events` | INSERT by **U2 standing in A** against B's revision | **refused** — multi-org actor must not resolve tenancy |
| 32 | `asset_revision_events` | quarantined row readable by its actor only | visible to actor, **0 rows** to others |
| 33 | `asset_contribution_history` | cross-org SELECT | **0 rows** |
| 34 | `asset_contribution_history` | same-org SELECT | visible |
| 35 | `asset_field_history` | `process_stage` row | visible (system history) |
| 36 | `asset_field_history` | `thesis` row, non-author | **0 rows** |
| 37 | `assets` | SELECT `symbol, sector` | visible to all orgs |
| 38 | `assets` | **SELECT `thesis`** | **permission denied** (column REVOKE) |
| 39 | `assets` | `useExploreSearch`-shaped `ILIKE` over `thesis` | **permission denied** |
| 40 | all | `anon` SELECT after revoke | **0 rows / denied** |

Application smoke tests, same-org: manual readthrough create + read
(`useObjectLinks`, `useLinkedResearch`, `readthrough-service`, `sync-note-links`
— 28 call sites, the highest regression surface), theme membership add/remove
(17 sites), Case-vs-Price and the scenario ladder (5 sites), and the asset page
research sections. `tdf_holdings` has **0 client call sites** — lowest
regression risk, highest data sensitivity, a reminder that blast radius and
severity are independent.

---

## 16. Ordered remediation plan

Data first, then boundary, then destructive schema change — so that no step
leaves a window where the data is neither migrated nor protected.

1. **`07`** — done on staging. Production apply is a separate authorisation.
2. `tdf_holdings_snapshots` — parent first.
3. `tdf_holdings` — depends on 2 for its EXISTS.
4. `theme_assets` — smallest self-contained EXISTS; closes the foreign-theme INSERT.
5. `object_links` — column + trigger + 25-row backfill.
6. `scenarios` — split model, CHECK, index change; closes the `is_default` write branch.
7. `asset_revisions` + `asset_revision_events` — columns forward, 13 + 22 rows quarantined.
8. `asset_contribution_history` — EXISTS. **Must precede 9**, so the migration target is closed before prose moves into it.
9. **`assets` proprietary columns:**
   a. backfill `asset_contributions.organization_id` for the 1 NULL row;
   b. migrate 490 workflow-state rows into `asset_workflow_progress` / `_priorities`;
   c. quarantine the 2 prose values and the 16 + 2 unanchored workflow values;
   d. clear the 6 duplicate prose values;
   e. **column-level `REVOKE`** on the 9 class-C columns;
   f. rewrite the guard's `assets` allowlist reason.
10. `asset_field_history` — split SELECT policy (now unblocked by 9).
11. Grants — `REVOKE ALL … FROM anon`; `REVOKE TRUNCATE, REFERENCES, TRIGGER … FROM authenticated`.
12. Guard re-run against a fresh post-fix inventory; remove resolved ratchet entries.
13. **Follow-on release (not C1):** repoint the 6 frontend readers to
    `asset_contributions` / `asset_workflow_progress`, then `DROP COLUMN`.

---

## 17. Still needing your decision

1. **The class-C surface is 9 columns, not 3.** `priority`, `process_stage` and
   `workflow_id` (506/506/490 rows) were not in the original escalation.
   Confirm they are in C1 scope, or C1 covers prose only and workflow state
   becomes a named follow-on. My recommendation: in scope — they are the
   majority of the exposure and share the same fix.
2. **Column-level `REVOKE` as the interim boundary** (§5, §12e), which breaks the
   6 read sites until they are repointed. The alternative — repoint the frontend
   first — leaves the cross-tenant research search live for another release.
3. **`asset_field_history` research rows:** creator-only as recommended, or
   backfill 12 of 14 from the contribution anchor and quarantine 2? I recommend
   creator-only; the anchor is an inference, not a derivation.
4. **`asset_revisions`** is newly in scope as the parent of a C1 table
   (`SELECT USING (true)`, 13 rows). Confirm it joins C1 rather than becoming an
   eighth deferred item.
5. **`TRUNCATE` grants** (§12): fold the revoke into C1, or raise separately as
   a schema-wide least-privilege item covering all 293 tables?
6. **`asset_contributions` `organization_id IS NULL` tolerance.** Its policies
   accept `organization_id IS NULL` as same-org. After backfilling the 1 row,
   should that escape hatch be removed and the column made `NOT NULL`?

---

## 18. Readiness

**READY to apply the C1 remediation to staging**, subject to decisions 1–4
above, which change *scope* rather than *method*.

What is established: live production schema and provenance for every table in
scope; chain totality re-measured (0 unresolved on all four EXISTS chains); every
backfill deterministic or explicitly quarantined; an existing org-scoped home
identified for every proprietary column, so no new table is required; and a
transport proven to run the full before/after methodology transactionally with
rollback, demonstrated end-to-end by the `07` suite.

What is not established, and should be before production: plans captured under
synthetic volume, and the 40-case matrix in §15 actually run — it is designed,
not executed.

**Not applied:** anything other than `07` on staging. No production write was
attempted. No merge, no deploy. The feature-release freeze stands: the
proprietary asset fields are still globally readable and searchable in
production.
