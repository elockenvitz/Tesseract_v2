# Security C1 — production runbook

**Branch:** `fix/security-c1` · **2026-08-29** · Production **not** executed.

This is the execution document. `c1-design.md` is the design, `c1-checkpoint.md`
the original evidence, `c1-staging-results.md` the staging validation record.

---

## 0. Naming — read this first

Two unrelated things have been called "07". They are separate packages, executed
separately, and must never be confused in a release plan:

| Unambiguous name | File | What it is |
|---|---|---|
| **MSG-07 — portfolio-context message derivation** | `scripts/sql/release-b/07-messages-portfolio-context-tenant-derivation.sql` | The Release B follow-up. Fixes `messages_set_organization_id()` so a portfolio-context message cannot be attributed to the caller's org. **Validated on staging (8/8), NOT live in production.** Independent of C1 — its own release step. |
| **C1-07 — asset contribution history** | `scripts/sql/security-c1/07-asset-contribution-history.sql` | Step 7 of the C1 sequence. Bounds `asset_contribution_history` to its parent contribution's organization. |

Everywhere below, C1 steps are written `C1-nn` and the message fix is `MSG-07`.
Nothing in the C1 sequence depends on MSG-07, and MSG-07 does not depend on C1.

---

## 1. The release, in one picture

```
   ┌── DATABASE, additive and invisible to the running app ──┐
   │  C1-01  tdf_holdings_snapshots                          │
   │  C1-02  tdf_holdings                                    │
   │  C1-03  theme_assets                                    │
   │  C1-04  object_links          (backfill + HARD GATE)    │
   │  C1-05  scenarios                                       │
   │  C1-06  asset_revisions + asset_revision_events         │
   │  C1-07  asset_contribution_history                      │
   │  C1-08  asset_contributions   (NULL escape removed)     │
   │  C1-08b asset_workflow_state  (MUST precede 09a)        │
   │  C1-09a assets workflow-state MIGRATION  (additive)     │
   └─────────────────────────────────────────────────────────┘
                             ↓
                  ★ APPLICATION DEPLOY ★
                             ↓
   ┌── DATABASE, restrictive: breaks any un-deployed client ─┐
   │  C1-09b assets column PRIVILEGES  (the revoke)          │
   │  C1-10  asset_field_history                             │
   │  C1-11  grants (anon / TRUNCATE on C1 tables)           │
   └─────────────────────────────────────────────────────────┘
```

**Why 09 was split.** The original single `09` did both the additive migration
and the restrictive revoke in one transaction, which makes a zero-break release
impossible: the new client needs the migrated workflow rows to exist *before* it
deploys, and the old client keeps working only while the columns are *still*
readable. One transaction cannot be both before and after a deploy. Split:

* **C1-09a is additive and pre-deploy.** `INSERT … ON CONFLICT DO NOTHING` into
  `asset_workflow_priorities` and `asset_workflow_progress`. No privilege,
  policy or column changes. The old client is unaffected — it still reads
  `assets.priority` and `assets.process_stage`.
* **C1-09b is restrictive and post-deploy.** Replaces the table-wide grant on
  `assets` with a column grant. This is the statement that breaks an old client,
  because `SELECT *` expands to every column and then checks privileges on all
  of them: a stale query fails entirely rather than returning fewer fields.

Everything from C1-01 to C1-09a is invisible to a correctly behaving old client.

---

## 2. Preflight (read-only, no writes)

```bash
# Endpoint resolver over the real 25 object_links. Expect:
#   total 25 | resolvable 25 | unresolvable 0 | cross_org_conflict 0
#   source_would_refuse 0 | target_would_refuse 0
node scripts/sql/security-c1/mgmt-query.mjs --env=prod \
     --file=scripts/sql/security-c1/91-prod-endpoint-dryrun.sql
```

Re-confirm the projected counts in §5 — production may have moved since
2026-08-29. If `unresolvable` is anything but 0, **stop**: C1-04 will refuse and
roll back (by design), so there is nothing to gain from attempting it.

---

## 3. Execution

Each file is one transaction and self-verifies; a failed assertion rolls its own
step back. All are **idempotent** — re-running any of them against an
already-remediated database is a no-op, proven by replaying all 13 against
staging.

```bash
run() { node scripts/sql/security-c1/mgmt-query.mjs --env=prod --allow-writes \
        --file=scripts/sql/security-c1/$1.sql; }
```

> The runner as committed **refuses `--allow-writes` on `--env=prod`**. That is
> deliberate: no accidental production write is possible from this branch.
> Executing in production is a conscious act that requires lifting that guard,
> and it should be done by whoever is authorized to run the release, not left
> pre-lifted in the repository.

### Phase A — pre-deploy

| Step | File | Expect |
|---|---|---|
| C1-01 | `01-tdf-holdings-snapshots.sql` | 4 policies, 0 unconditional |
| C1-02 | `02-tdf-holdings.sql` | 4 policies, 0 unconditional |
| C1-03 | `03-theme-assets.sql` | INSERT policy consults `themes` |
| C1-04 | `04-object-links.sql` | **`all 25 object_links attributed`** — raises if any is not |
| C1-05 | `05-scenarios.sql` | `111 defaults, 1 custom, 1 quarantined` |
| C1-06 | `06-asset-revisions-events.sql` | `13 revisions and 22 events quarantined` |
| C1-07 | `07-asset-contribution-history.sql` | exactly 1 policy |
| C1-08 | `08-asset-contributions.sql` | `every contribution carries an organization` |
| C1-08b | `08b-asset-workflow-state.sql` | `workflow state bounded by workflows.organization_id` |
| C1-09a | `09a-assets-workflow-state-migration.sql` | `+489 priorities, +478 progress, 16 quarantined` |

**Checkpoint before deploying.** Phase A is complete and the application has not
moved. Verify the old client is still healthy — it must be, since nothing it
reads has changed.

### ★ Application deploy

Deploy `fix/security-c1`. The new client reads workflow state from
`asset_workflow_progress` / `_priorities` and research from
`asset_contributions`, all of which C1-09a has now populated.

Smoke the deployed app before Phase B: asset page research, Explore search,
saved screens, portfolio positions, Case-vs-Price.

### Phase B — post-deploy

| Step | File | Expect |
|---|---|---|
| C1-09b | `09b-assets-column-privileges.sql` | `nine proprietary columns unreachable by authenticated` |
| C1-10 | `10-asset-field-history.sql` | `1052 system rows readable, 14 research rows creator-only` |
| C1-11 | `11-grants.sql` | `anon revoked and TRUNCATE removed across 14 C1 tables` |

### Post-run

```bash
node scripts/audit/schema-baseline.mjs --out=docs/audit/baselines/prod-c1-post.json
node scripts/unconditional-policy-guard.mjs docs/audit/baselines/prod-c1-post.json
# Expect: PASS, 0 new findings.
```

### MSG-07 — separate step, separate decision

`scripts/sql/release-b/07-messages-portfolio-context-tenant-derivation.sql` is
validated on staging (8/8) and **not executed in production**. It is independent
of C1 and can go in the same window or its own. It is not part of the sequence
above and must not be counted as one of its steps.

---

## 4. Rollback

**Nothing in this package is destructive.** No column is dropped, no row
deleted, no value overwritten. Rollback restores access; it never restores data,
because none was removed.

| Step | Rollback |
|---|---|
| C1-01/02/03/07/10 | re-create the prior policies — exact text in `c1-checkpoint.md` §1 and `docs/audit/baselines/c1-prod-20260828-220413.json` |
| C1-04 | drop trigger + policies; the column can stay (additive, nullable) |
| C1-05 | drop trigger, CHECK and the new unique index; restore `scenarios_asset_id_name_created_by_key`; restore 4 policies |
| C1-06 | drop 2 triggers, restore 5 policies; columns stay |
| C1-08 / C1-08b | restore the prior policies |
| **C1-09a** | **nothing to roll back.** The inserted rows are correct in the authoritative model regardless of whether the rest of C1 proceeds; they were `ON CONFLICT DO NOTHING`, so nothing was overwritten. Deleting them would be the destructive act, not keeping them. |
| **C1-09b** | `GRANT SELECT, INSERT, UPDATE ON public.assets TO authenticated` — a table-wide grant supersedes the column grants and restores the old client immediately |
| C1-11 | re-grant; re-granting `anon` should be a decision, not a reflex |

**Ordering under rollback.** The split makes this easier than it was. If Phase B
misbehaves, roll back **C1-09b alone** and the old client works again without
touching the app. If the *application* needs reverting, revert C1-09b first or
together with it — never the app alone, or its restored `select('*')` queries hit
a column grant that no longer permits them.

---

## 5. Production projections

| Table | Backfill | Quarantine |
|---|---|---|
| `object_links` | **25**, all deterministic — **hard-gated** | 0 (any failure aborts) |
| `asset_workflow_priorities` | **489** new rows (C1-09a) | — |
| `asset_workflow_progress` | **478** new rows (C1-09a) | — |
| `assets` workflow state, no workflow anchor | — | **16** |
| `assets` research prose | **0** — 6 of 8 already exist byte-identical | **2** |
| `asset_contributions` | **1** (single-membership author) | 0 |
| `scenarios` | 111 defaults stay NULL by design | **1** |
| `asset_revisions` / `asset_revision_events` | none | **13** / **22** |
| `asset_field_history` | none | 14 research rows creator-only; 1,052 system rows readable |
| `asset_contribution_history`, TDF, `theme_assets`, workflow state | none — EXISTS | 0 |

`trade_queue_items`: **8 rows carry `organization_id` NULL and are deliberately
NOT backfilled** — see §6.

---

## 6. `trade_queue_items` — the 8 NULL-org rows

Read-only structural classification, production, 2026-08-29:

| Measure | Count |
|---|---|
| Total queue items | 228 |
| `organization_id IS NULL` | **8** |
| …of which `portfolio_id IS NULL` too | **8 (all of them)** |
| …resolvable via `portfolios.organization_id` | **0** |
| Rows where item org and portfolio org disagree | **0** (across all 228) |
| `object_links` referencing a NULL-org item, directly or via `trade_idea_thesis` | **0** |

So all 8 are structurally unresolvable: no organization, and no portfolio to
derive one from. No link points at any of them, so nothing in C1 is blocked.
They are **left exactly as they are** — this is object-link safety, not a
trade-queue migration.

### Forward object-link rule for `trade_idea`

Implemented in `object_link_endpoint_org()` (C1-04):

1. `trade_queue_items.organization_id` populated → use it.
2. NULL, but `portfolio_id → portfolios.organization_id` resolves → **use the
   portfolio org**, consistent with the portfolio authority used elsewhere.
3. Both present and **disagreeing → RAISE**. Not resolved by precedence:
   choosing a winner between two candidate answers is a guess wearing a rule's
   clothes.
4. Neither resolves → **refuse the link**.
5. Not a queue item → pair trade, via its portfolio.

Never: creator membership, `current_org_id()` alone, or a caller-supplied
`organization_id`. On today's data rule 2 rescues nothing (all 8 lack a
portfolio too); it is implemented because it governs every future link.

Covered by matrix cases 57, 58, 59, 71, 72.

---

## 7. Gates

| Gate | Result |
|---|---|
| `npm run guard:unit` | see `c1-staging-results.md` |
| `npm run guard:types` | ” |
| `npm run guard:tdz` | ” |
| `npm run build` | ” |
| Synthetic matrix (`90`) | **77/77** |
| Product smoke (`92`) | **23/23** |
| Idempotency replay (all 13) | clean |
| Staging guard | PASS, 0 new |
