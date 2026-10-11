# price_target_outcomes — tenant isolation: evidence and rollout plan

Status: **awaiting approval. Nothing has been applied to production.**
All numbers below were measured read-only against production
(`wfcebeagznzgeuyysbnt`) on 2026-10-11. No writes were made.

---

## 1. The finding

`public.price_target_outcomes` has one SELECT policy and it is the entire read
boundary:

```
price_target_outcomes   SELECT   TO public   USING (auth.uid() IS NOT NULL)
```

That predicate proves a session exists and says nothing about which rows. The
sharpest measurement, taken behaviourally as a real authenticated user
(`patcaffrey9@gmail.com`, Caffrey Capital) with `SET LOCAL ROLE authenticated`:

| what that user can read | rows |
|---|---|
| outcome rows | **30 of 30** |
| outcome rows the Decision Timeline renders (`hit`/`missed`/`expired`) | **7 of 7** |
| parent price targets (correctly org-scoped) | 3 |
| **outcome rows whose own parent is invisible to them** | **27** |

The last row is the defect in one line: the child escapes a boundary its own
parent already enforces. `analyst_price_targets` has carried `organization_id`
and an org-scoped SELECT policy since `20260425120000`; the outcome table was
never brought along.

What a reader sees today on an asset's Decisions sub-page: another firm's
hit/missed/expired verdict on a shared security, with the evaluating analyst's
name, interleaved with their own and visually indistinguishable from it.

Live read path:
`AssetTab.tsx:4224` → `DecisionTimeline.tsx:28` →
`useAssetDecisionTimeline.ts:643` — `.eq('asset_id', …)` and no org predicate.
`assets` is global by design, so filtering by asset does not confine the read
to one tenant; it is precisely where two tenants' rows meet.

## 2. Authoritative ownership — derived, not assumed

The table has no `organization_id`. Both tempting derivations were tested and
both are wrong:

| candidate | verdict | evidence |
|---|---|---|
| author's membership (`user_id` → memberships) | **rejected** | 27 of 30 rows were written by users active in more than one org; for **7 rows (23%)** the author's current org is not the org the row belongs to. This derivation would have misfiled those 7. |
| the asset | **rejected** | `assets` is global by design and carries no tenant at all. |
| **parent price target** (`price_target_id` → `analyst_price_targets.organization_id`) | **adopted** | see below |

Why the parent is authoritative, as verified in production:

- `price_target_id` is `NOT NULL`, `UNIQUE`, FK `ON DELETE CASCADE` — an
  outcome cannot exist without, or outlive, its parent.
- Every outcome row is created by `create_outcome_for_target()`, an
  `AFTER INSERT OR UPDATE` trigger on `analyst_price_targets`. **The client
  never inserts** — grep confirms only `.select()` and `.update()` against this
  table anywhere in `src/`.
- The parent already stamps `organization_id = current_org_id()` server-side via
  `analyst_price_targets_set_org_id`.
- **30/30 rows resolve to exactly one organization. 0 orphans. 0 unresolvable.
  No ambiguity.** There is no quarantine set to adjudicate.

Owners, authoritatively: **Tesseract 27 rows, Caffrey Capital 3**. The
handover's "6 organizations" was the author-membership derivation — the one
this evidence rejects.

## 3. Containment: not warranted as a separate step

The `decision_reviews` remediation used a deny-all containment first. That was
right there, because its INSERT policy allowed an active, ongoing harm — one
org could squat another's globally-unique `decision_id` and permanently lock out
the rightful reviewer. Nothing is being written cross-org here. This table feeds
read-only analytics.

Against that, the permanent fix is small, fully resolvable, and provably breaks
nothing (§5). A separate containment step would blank live surfaces for a day
and then need unblanking — two production changes and an outage window, to
close a read 24 hours sooner. **Recommendation: apply the permanent fix
directly.** It is its own containment.

## 4. The fix

`supabase/migrations/20261011120000_price_target_outcomes_tenant_isolation.sql`

1. Add nullable `organization_id`. **NULL is the quarantine state** — preserved,
   invisible to every tenant, repairable by `service_role`.
2. `price_target_outcomes_set_org_id`, a `BEFORE INSERT OR UPDATE` trigger,
   derives the owner from the parent and **discards whatever the caller sent**.
   `price_target_id` is made immutable so a row cannot be walked into another
   tenant under the guise of an edit.
3. Backfill from the parent only. All 30 rows preserved; no owner guessed.
4. Replace the AUTH_ONLY SELECT policy with one that **mirrors the parent's
   boundary exactly** (`is_active_member_of_current_org() AND organization_id =
   current_org_id()`), so an outcome can never be visible for a price target the
   reader cannot see.
5. Withdraw grants the client does not need. **`anon` currently holds
   DELETE, INSERT, TRUNCATE and UPDATE on this table** and is revoked entirely.

### Why a stored column rather than an `EXISTS` against the parent

An `EXISTS` subquery needs no schema change, but it couples outcome visibility
to the parent's *policy* rather than to its *tenancy*: any future narrowing of
`analyst_price_targets` (covering-only, author-only) would silently blank the
Decision Timeline. A stored column pins tenancy without inheriting unrelated
restrictions, is indexable, and is the shape the repo's own org-scope tooling
and the `decision_reviews` precedent both expect.

### RLS posture after the migration

| command | posture |
|---|---|
| SELECT | org-scoped, fails closed on NULL, `authenticated` only |
| UPDATE | author-only within the row's org; `WITH CHECK` deliberately omits the org predicate so a quarantined row stays repairable |
| INSERT | **no policy** — deny by default. The only writers are `SECURITY DEFINER` functions owned by `postgres`, which bypass RLS |
| DELETE | no policy, no grant — unchanged, already denied |
| `anon` | no grant at all |

`FORCE ROW LEVEL SECURITY` is deliberately not set: it applies to the table
owner, which is the role the backfill runs through.

## 5. Production impact

**No organization loses a single row it owns.** Measured per reading org:

| reading org | keeps | loses | timeline rows kept | timeline rows lost |
|---|---|---|---|---|
| Tesseract | 27 | 3 | **7** | 0 |
| Caffrey Capital | 3 | 27 | 0 | **7** |
| the other 22 orgs with active members | 0 | 30 | 0 | **7** |

Twenty-two organizations own zero rows here and read all thirty today. After
the fix they read none — and lose nothing that was ever theirs.

### Surfaces checked, and why they do not break

| surface | status |
|---|---|
| `PriceTargetChart`, `MobilePriceTargetChart`, `MobileAssetPreview` (live) | **safe.** `usePriceTargetChart` consumes outcomes only as `outcomeMap.get(target.id)` against the already-org-scoped parent list, and no consumer destructures the raw `outcomes` array. Foreign rows are fetched today and never rendered. |
| `useAnalystScorecard`, `useAnalystPerformance` (live via `DecisionAccountabilityPage`) | filtered by `user_id`; the roster comes from org-scoped `useTeamMembers`. See the one behaviour change below. |
| `usePerformanceLeaderboard` | reads `analyst_performance_snapshots`, not this table. Unaffected. |
| `TeamPerformanceSummary` | **no live caller** — exported from the barrel only. |
| `OutcomesTimeline` | **no live caller** — moved to UserTab and not remounted. |
| all three SQL writers (`create_outcome_for_target`, `check_and_expire_user_targets`, `process_expired_price_targets`) | all `SECURITY DEFINER` owned by `postgres`; they bypass RLS, so no write path depends on the permissive policies. |

### The one real behaviour change

Exactly two users' price-target scorecard metrics drop to zero:

| user | active org | own rows today | after fix | rows actually owned by |
|---|---|---|---|---|
| john.homler@gmail.com | Homler Capital | 6 | **0** | Tesseract |
| sebastian.barbero@yahoo.com | Barbero Capital | 1 | **0** | Tesseract |

Both authored those targets inside Tesseract and have since switched active
org. Their scorecards become empty-but-correct rather than populated-but-wrong —
a firm's scorecard should not count work done at another firm. It will
nonetheless look like data loss to those two users, and it is demo/pilot data.

## 6. Verification

`scripts/sql/price-target-outcomes/verify.sql`.

Section 3 is a **rehearsal**: it applies the migration inside a transaction,
asserts every property against real production rows, and `ROLLBACK`s. Postgres
DDL is transactional, so this proves the whole fix with zero production change.
Each assertion `RAISE`s on failure, so a clean run means the cases passed
rather than merely not erroring.

Behavioural assertions: owner org keeps 27 rows and all 7 timeline rows;
foreign org reads only its own 3 and zero timeline rows; zero rows outlive an
invisible parent; cross-tenant UPDATE touches nothing.

Three of the assertions exist to prove the guard is not decoration:

- **3g** forges an `organization_id` on a row and proves the trigger discards it
  and re-derives the parent's. Without the trigger the write would relabel the
  row and the policy would honour it.
- **3h** repoints a row at a foreign parent and proves it is refused.
- **3i** manufactures the quarantine case — strips the parent's org, proves the
  child resolves to NULL, is preserved, and is invisible to the very org that
  would otherwise own it.
- **3j** creates a price target as a real user and proves the live write path
  still produces a correctly owned outcome.

### The repo's own gates, proven against their subject

`scripts/tenant-boundary-lint.mjs` listed this table as `'PT outcomes —
global'`. It never was. The entry is removed, and `get_tenant_lint_tables()`
reports `has_org_id: false` for it **today** — so with the entry gone, CHECK 2
fails in the pre-migration state (`FAIL: price_target_outcomes — not in
GLOBAL_TABLES, FK_CHAIN_TABLES, or has org_id`) and passes only once the column
exists. The gate observes its own subject rather than asserting a threshold.
`price_target_outcomes` is added to `GRANDFATHERED_NULLABLE` because NULL is
the designed quarantine state, with the reason written in place.

## 7. Sequence

1. Approval.
2. Run `verify.sql` sections 1-2 (read-only) and keep the output.
3. Run section 3, the aborting rehearsal. Every assertion must print OK.
4. Apply the migration for real.
5. Re-run sections 1-2 and the section 3 assertions against the applied state.
6. Reconcile the ledger: the Management API query endpoint executes SQL but
   writes **no** `supabase_migrations.schema_migrations` row. Insert it —
   do not re-execute the migration.
7. Refresh `docs/audit/baselines/ci-policy-inventory.json` from production
   **after** deployment, so the guard's input is a capture rather than intent.
8. Focused PR. Nothing unrelated bundled.
