# Security C1 — evidence and remediation design

**Branch:** `fix/security-c1` · **2026-08-28** · **No remediation applied. No production writes.**

Every figure below was read live: production read-only via the Management API,
staging via the same transport. Nothing is inferred from the committed
inventory, which is supporting evidence only.

---

## 0. Escalation — outside C1 scope, needs a decision

**`assets` carries proprietary research prose and is allowlisted as reference data.**

`public.assets` has no `organization_id` and is `SELECT USING (true) TO
authenticated`. It also carries `thesis`, `risks_to_thesis`, `where_different`,
`priority` and `process_stage`. On production: 912 assets, of which **5 hold a
thesis, 1 holds risks_to_thesis, 1 holds where_different**.

The unconditional-policy guard allowlists this table as:

> `assets: 'Security master. Ticker/name/sector reference, identical for all tenants.'`

That justification no longer describes the data. Ticker and sector are indeed
global; a thesis is not. Every authenticated user in every organization can read
those 5 theses.

This is *not* a new privilege-escalation path and `anon` reaches none of it
(policies are `TO authenticated`; anon sees 0 rows). It is a **stale allowlist
justification over genuinely proprietary content**, and it is the parent table
of two C1 tables — which is how it surfaced. It also decides the design for
`asset_field_history` (§5), because that table is nothing but a change log of
these columns.

**Decision needed:** is per-asset research meant to be firm-global (in which case
the allowlist reason should be rewritten to say so, and `asset_field_history`
inherits the same answer), or is it tenant-owned (in which case `assets` itself
needs remediation and belongs in a release, not in C1)? I have not touched it.

---

## 1. Confirmed exposure — the seven tables

Read-only probe on production: a forged session for a user belonging to **no
organization**, `BEGIN`/`SET LOCAL ROLE authenticated`/`SELECT`/`ROLLBACK`, no
DML and no fixtures.

| Table | Rows | Visible to unaffiliated user | Visible to `anon` |
|---|---|---|---|
| `tdf_holdings` | 672 | **672 (100%)** | 0 |
| `tdf_holdings_snapshots` | 48 | **48 (100%)** | 0 |
| `scenarios` | 112 | **112 (100%)** | 0 |
| `asset_field_history` | 1066 | **1066 (100%)** | 0 |
| `asset_revision_events` | 22 | **22 (100%)** | 0 |
| `object_links` | 25 | **25 (100%)** | 0 |
| `theme_assets` | 18 | **18 (100%)** | 0 |

**The confirmed issue is authenticated cross-tenant exposure, not anonymous
leakage.** Every policy on these tables is `TO authenticated`, so the `anon`
grants are inert. Revoking them remains worthwhile as defence in depth.

Live predicates — **not one of the seven has any organization predicate**; every
"scoped" policy scopes to the individual user:

| Table | SELECT | Writes |
|---|---|---|
| `tdf_holdings` | `true` | INSERT/UPDATE/DELETE all `true` |
| `tdf_holdings_snapshots` | `true` | INSERT/UPDATE/DELETE all `true` |
| `scenarios` | `true` | UPDATE `(auth.uid()=created_by) OR (is_default=true)`, **no WITH CHECK** |
| `asset_field_history` | `true` | INSERT `true` |
| `asset_revision_events` | `true` | INSERT scoped to revision actor |
| `object_links` | `true` | `created_by = auth.uid()` |
| `theme_assets` | `true` | `added_by = auth.uid()` |

Staging carries the **identical** policy set and grants, and **zero rows** in all
seven. Per Decision 3 that is fine: production supplies counts and totality,
staging supplies synthetic behaviour tests.

Two live write defects worth naming, both cross-tenant:

* `theme_assets` INSERT requires only `added_by = auth.uid()`. Any authenticated
  user can add an asset to **any organization's theme**.
* `scenarios` UPDATE has an `OR (is_default = true)` branch and no `WITH CHECK`,
  so any authenticated user can mutate **any global default scenario**.

---

## 2. Chain totality (production)

| Table | Candidate chain | Dangling | Parent without org | Verdict |
|---|---|---|---|---|
| `tdf_holdings` | `snapshot_id`→`tdf_id`→`target_date_funds.organization_id` | 0 | 0 | **TOTAL** |
| `tdf_holdings_snapshots` | `tdf_id`→`target_date_funds.organization_id` | 0 | 0 | **TOTAL** |
| `theme_assets` | `theme_id`→`themes.organization_id` | 0 | 0 | **TOTAL** |
| `asset_revision_events` | `revision_id`→`asset_revisions` | 0 | n/a | structurally total, **no org on parent** |
| `scenarios` | `asset_id`→ global | — | — | **none** |
| `asset_field_history` | `asset_id`→ global | — | — | **none** |
| `object_links` | polymorphic | — | — | **none** |

All join columns on the three TOTAL chains are `NOT NULL`, and
`target_date_funds.organization_id` / `themes.organization_id` are both
`NOT NULL`. These are the conditions that were *absent* for
`portfolios.team_id`, which is what quarantined 13 messages in Release B.

---

## 3. `object_links` — all 25 classified

| source → target | link_type | auto | n | resolvable | cross-org conflict | unresolvable |
|---|---|---|---|---|---|---|
| `asset_note` → `asset` | references | no | 10 | 10 | 0 | 0 |
| `asset_note` → `trade_idea` | supports | no | 9 | 9 | 0 | 0 |
| `trade_idea` → `trade_idea` | opposes | no | 3 | 3 | 0 | 0 |
| `asset_note` → `asset` | references | **yes** | 1 | 1 | 0 | 0 |
| `asset_note` → `trade_idea_thesis` | supports | no | 1 | 1 | 0 | 0 |
| `theme_note` → `asset` | references | **yes** | 1 | 1 | 0 | 0 |

**25 / 25 deterministically attributable. 0 ambiguous. 0 cross-org conflicts.
`created_by` is populated on all 25.** No quarantine bucket is required — a
clean, complete backfill is available, which is a materially better position
than the `object_links` audit anticipated.

Resolution used: `asset_note` → `asset_notes.organization_id`; `theme_note` →
`theme_notes.organization_id`, falling back to `themes.organization_id` via
`theme_id`; `trade_idea` → `trade_queue_items.organization_id`, falling back to
`portfolios.organization_id` via `portfolio_id`, then `pair_trades`. `asset`
endpoints are global and contribute no org, which is why the *link* needs its own
column: 12 of the 25 have a global endpoint on one side.

---

## 4. `scenarios` — global reference, not tenant data

| Measure | Production |
|---|---|
| Total | 112 |
| `is_default = true` | **111** |
| `created_by IS NULL` | **111** |
| Distinct creators | 1 |

Confirms the architectural decision: default scenarios are global reference data.
Exactly **one** row is a genuine custom scenario.

Design:

* **Default scenarios** (`is_default = true`): readable by any authenticated
  user as global reference. `organization_id` stays NULL. **Not mutable** by
  ordinary users — this closes the `OR (is_default = true)` UPDATE branch, which
  is the live defect.
* **Custom scenarios**: explicit `organization_id`, derived and validated, never
  caller-supplied. Read and write confined to that org. `created_by` remains
  attribution only.
* **The one legacy custom row**: its organization is **not** inferred from the
  creator's current membership. Creator-only access until a deterministic context
  appears. Quarantine over fabrication.

Callers audited (static): `useScenarios.ts` (4 sites) and `MobileDashboard.tsx`
(1). All read paths filter by `asset_id`; none filters by organization, so
default-scenario reads continue to work unchanged under this model. Case-vs-Price
and the scenario ladder consume defaults, which stay globally readable.

---

## 5. `asset_field_history` — provenance classified

Written by exactly one writer: `track_asset_field_changes()`, a `SECURITY
DEFINER` trigger on the **global `assets`** table. There is no other producer.

| field_name | rows | `changed_by` NULL | attributed | distinct assets | window |
|---|---|---|---|---|---|
| `process_stage` | 1039 | **1007** | 32 | 505 | 2025-09-17 → 2025-10-14 |
| `priority` | 13 | 1 | 12 | 4 | 2025-09-20 → 2026-01-27 |
| `thesis` | 10 | 0 | **10** | 5 | 2025-08-30 → 2025-10-19 |
| `risks_to_thesis` | 2 | 0 | **2** | 1 | 2025-08-30 |
| `where_different` | 2 | 0 | **2** | 1 | 2025-08-30 |

Two distinct populations, and the 1,008 unattributed rows are **not** a single
class:

* **1,007 unattributed `process_stage` rows across 505 assets in a four-week
  window** is the signature of a bulk/system operation, not user edits. This is
  workflow-state churn on global asset records.
* **14 rows (`thesis`, `risks_to_thesis`, `where_different`) are 100% attributed
  and contain research prose in `old_value`/`new_value`.**

So blanket-quarantining the 1,008 would have been wrong, exactly as you
suspected. But the sharper point is that this table's sensitivity is **entirely
inherited from `assets`** (§0): it logs changes to columns that are themselves
globally readable today. Remediating the log while the source column stays open
would be theatre.

**Recommendation: do not remediate `asset_field_history` in C1.** Resolve §0
first; this table then inherits that answer mechanically. If research fields stay
firm-global, this is global reference history and the current SELECT is correct.
If they become tenant-owned, this table needs the same boundary and the 14
research rows are the migration unit — a small, fully-attributed set.

---

## 6. `asset_revision_events` — all 22 classified

Parent `asset_revisions`: `view_scope_type = 'firm'` for **every** row,
`view_scope_user_id` NULL for every row, `actor_user_id` NOT NULL on all, 0
dangling revisions, 6 distinct actors, 6 distinct assets.

The ambiguity test you asked for:

| Actor belongs to | Actors |
|---|---|
| 1 organization | 2 |
| 2 organizations | 3 |
| 3 organizations | 1 |

**4 of 6 actors (67%) are multi-org.** Deriving tenancy from `actor_user_id →
membership` is therefore not deterministic for the majority of rows, confirming
the instruction not to use it. There is no `organization_id`, portfolio, project
or note parent on `asset_revisions` to fall back to.

**Design:** explicit `organization_id` going forward, derived at write time from
the caller's validated current org. The 22 historical rows have no deterministic
authority — creator-only access, not a guess.

---

## 7. Final tenant authority

| # | Table | Authority | Mechanism |
|---|---|---|---|
| 1 | `tdf_holdings` | `snapshot_id`→`tdf_id`→`target_date_funds.organization_id` | **EXISTS** (chain total) |
| 2 | `tdf_holdings_snapshots` | `tdf_id`→`target_date_funds.organization_id` | **EXISTS** (chain total) |
| 3 | `theme_assets` | `theme_id`→`themes.organization_id` | **EXISTS**, no denormalisation |
| 4 | `object_links` | explicit `organization_id`, trigger-derived | column + backfill (25/25 clean) |
| 5 | `scenarios` | `is_default` → global; else explicit `organization_id` | split model |
| 6 | `asset_revision_events` | explicit `organization_id` forward; history creator-only | column + quarantine |
| 7 | `asset_field_history` | **deferred** — inherits §0 | none in C1 |

## 8. Proposed policy shape per command

**`tdf_holdings`** (and `tdf_holdings_snapshots`, one hop shorter):

```
SELECT / UPDATE / DELETE  TO authenticated  USING  (<org EXISTS>)
INSERT                    TO authenticated  WITH CHECK (<org EXISTS>)
UPDATE                    adds matching WITH CHECK (<org EXISTS>)
```
where `<org EXISTS>` is
`EXISTS (SELECT 1 FROM tdf_holdings_snapshots s JOIN target_date_funds f ON f.id = s.tdf_id
         WHERE s.id = tdf_holdings.snapshot_id AND f.organization_id = current_org_id())`.

**`theme_assets`**: same four commands, predicate
`EXISTS (SELECT 1 FROM themes t WHERE t.id = theme_assets.theme_id
         AND t.organization_id = current_org_id())`, ANDed with `added_by =
auth.uid()` on UPDATE/DELETE to preserve existing per-user semantics.

**`object_links`**: `organization_id = current_org_id()` on all four, ANDed with
the existing `created_by = auth.uid()` / `is_auto = false` conditions on
UPDATE/DELETE. `organization_id` assigned by a `BEFORE INSERT OR UPDATE` trigger
that resolves both endpoints and **rejects** a link whose two tenant-owned
endpoints belong to different orgs; global endpoints contribute nothing.

**`scenarios`**: SELECT `is_default OR organization_id = current_org_id()`;
INSERT/UPDATE/DELETE `NOT is_default AND organization_id = current_org_id() AND
created_by = auth.uid()`, with matching `WITH CHECK` on UPDATE. The
`OR (is_default = true)` write branch is removed.

Every table gets `REVOKE ALL ... FROM anon` (defence in depth), and every UPDATE
gets an explicit `WITH CHECK` so a row cannot be rewritten out of its tenant.

## 9. Projected backfills and quarantines

| Table | Backfill | Quarantine |
|---|---|---|
| `object_links` | 25 rows, all deterministic | **0** |
| `scenarios` | 111 defaults stay `organization_id` NULL by design | 1 legacy custom row, creator-only |
| `asset_revision_events` | none — no deterministic source | 22 historical rows, creator-only |
| `tdf_*`, `theme_assets` | none — EXISTS needs no column | 0 |
| `asset_field_history` | deferred | deferred |

## 10. Indexes required

| Index | For |
|---|---|
| `tdf_holdings_snapshots(id, tdf_id)` | the `tdf_holdings` EXISTS; 672 rows × per-row subquery |
| `target_date_funds(id, organization_id)` | both tdf chains |
| `themes(id, organization_id)` | `theme_assets` EXISTS |
| `object_links(organization_id)` | direct predicate |
| `scenarios(organization_id) WHERE NOT is_default` | partial; 111/112 are default |

Row counts here are small (672 is the largest), so no material performance risk
is expected. Plans should still be captured on staging with synthetic volume
before promotion.

## 11. Product-regression risks

* **`object_links` — highest blast radius**: 28 client call sites, incl.
  `useObjectLinks` (6), `useLinkedResearch` (5), `readthrough-service` (3),
  `sync-note-links` (3). Manual readthrough link creation and read must be smoke
  tested same-org. Caller count is not severity, but it is regression surface.
* **`theme_assets`** — 17 sites; theme membership add/remove.
* **`scenarios`** — 5 sites; Case-vs-Price and the scenario ladder must still
  load defaults. The split model preserves this by design.
* **`tdf_holdings`** — **0 client call sites**; lowest regression risk, highest
  data sensitivity (672 holdings rows). A reminder that blast radius and severity
  are independent.
* **`asset_revision_events` / `asset_field_history`** — read paths only
  (`revision-service`, 4 history views).

## 12. Ordered C1 remediation plan (proposed, not applied)

1. `07` — portfolio-context message derivation *(ready; independent of C1)*
2. `tdf_holdings_snapshots` — parent first
3. `tdf_holdings` — depends on 2 for its EXISTS
4. `theme_assets` — smallest self-contained EXISTS
5. `object_links` — column + trigger + 25-row backfill
6. `scenarios` — split model + close the `is_default` write branch
7. `asset_revision_events` — column forward + 22-row quarantine
8. `asset_field_history` — **only after §0 is decided**
9. `anon` revokes across all seven
10. Guard re-run against a fresh post-fix inventory; remove resolved ratchet entries

## 13. Open decisions

1. **§0 `assets`** — firm-global research, or tenant-owned? Blocks item 8 and
   rewrites the guard's allowlist justification either way.
2. **`asset_revision_events` history** — creator-only, or admin-only via Ops?
3. **`scenarios` legacy custom row** — creator-only indefinitely, or does the
   product want an explicit assignment path?
4. **Staging fixture depth** — how much synthetic data before promotion is
   considered proven, given staging holds no real rows.
