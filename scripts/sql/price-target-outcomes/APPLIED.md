# APPLIED — price_target_outcomes tenant isolation

Applied to production (`wfcebeagznzgeuyysbnt`) on **2026-10-11** with explicit
approval, after a successful aborting rehearsal against the same rows
(`REHEARSAL-RESULTS.md`).

Migration: `supabase/migrations/20261011120000_price_target_outcomes_tenant_isolation.sql`
Ledger: recorded as version `20261011120000` (see §5).

---

## 1. Pre-flight — the two gates that had to pass first

**Byte-for-byte identity with the rehearsed SQL.** Comments stripped and
whitespace collapsed, so only executable SQL is compared:

```
migration file  sha256: faf0c2cfe244d4587060c6813b1446e4187e850bdc5daeeca21ffedc9b41db92
rehearsed body  sha256: b6d22c5027274a78c80ca8ff10501d8d685c1250fa0fb51b8026b83c85006f9a
migration minus COMMENT ON COLUMN: b6d22c5027274a78c80ca8ff10501d8d685c1250fa0fb51b8026b83c85006f9a
MATCH
```

The only divergence is the `COMMENT ON COLUMN` statement the rehearsal omitted,
which changes no behaviour. The worktree was clean at `305eb253`.

**No production drift since the rehearsal.** All 15 substantive checks matched:
3 policies with the AUTH_ONLY SELECT still live, no `organization_id` column, no
trigger, no derivation function, 7 anon grants, 30 rows, 0 orphans, 0
unresolvable, Tesseract 27 / Caffrey 3, 7 timeline rows, 2 distinct owning orgs,
both test identities still resolving to their organizations, and the parent's
SELECT predicate unchanged.

Two checks in the drift script carried placeholder expected hashes that had
never been measured — a vacuous check, and it is recorded here rather than
quietly dropped. The helper functions were then verified properly, by comparing
the live md5 against the md5 of the definitions captured earlier in the same
session:

```
MATCH  current_org_id                   a7738ec86b09bf06a183c9a547276480
MATCH  is_active_member_of_current_org  2a2d1aff0c33490ccf1cbf8c031a9c23
```

## 2. Structural verification — 18 of 18

| check | expected | actual |
|---|---|---|
| rows preserved | 30 | 30 |
| owners derived | 30 | 30 |
| quarantined (NULL owner) | 0 | 0 |
| owners disagreeing with their parent (fabricated) | 0 | 0 |
| Tesseract-owned / Caffrey-owned | 27 / 3 | 27 / 3 |
| policies on table | 2 | 2 |
| AUTH_ONLY or `true` predicates remaining | 0 | 0 |
| INSERT policy removed | 0 | 0 |
| anon grants | 0 | 0 |
| authenticated grants | SELECT,UPDATE | SELECT,UPDATE |
| PUBLIC grants | 0 | 0 |
| stamp trigger present | 1 | 1 |
| derivation fn is SECURITY DEFINER | true | true |
| org index present | 1 | 1 |
| org FK on-delete action | CASCADE | CASCADE |
| writers still SECURITY DEFINER | 3 | 3 |
| parent triggers creating outcomes | 2 | 2 |

## 3. Behavioural verification — both tenants, replaying the real hook queries

**Caffrey Capital** (`patcaffrey9@gmail.com`), the tenant that was leaking:

| measure | before | after |
|---|---|---|
| outcome rows readable | 30 | **3** |
| Decision Timeline rows (`hit`/`missed`/`expired`) | 7 | **0** |
| rows on the four leaked assets (AMZN, GOOGL, CEG, NVDA) | 7 | **0** |
| AAPL outcomes (`useTargetOutcomes.ts:92`) | 6 | **2** |
| rows readable whose parent is invisible | 27 | **0** |
| foreign-owned rows readable | 27 | **0** |

**Tesseract**, the owner — nothing lost:

| measure | expected | actual |
|---|---|---|
| outcome rows | 27 | 27 |
| Decision Timeline rows | 7 | 7 |
| rows on its own four assets | 7 | 7 |
| AAPL outcomes | 4 | 4 |
| outcomes that join to a visible parent | 27 | 27 |
| own scorecard rows (`user_id` filter) | 3 | 3 |
| foreign-owned rows readable | 0 | 0 |

`outcomes joinable to parent = 27 = total readable` is the property that
matters for `usePriceTargetChart`: every outcome a user can see now has a
price target they can also see.

## 4. Write-path verification — 6 of 6, in an aborting transaction

```
OK W1  cross-tenant UPDATE touched 0 rows
OK W2  author updates their own row in their own org
OK W3  forged owner discarded, re-derived from the parent
OK W4  price_target_id is immutable
OK W5  live create path produced a correctly owned outcome
OK W6  direct client INSERT is denied
WRITE VERIFICATION COMPLETE — ROLLING BACK (nothing persisted)
```

W3 and W4 are the non-vacuity proofs: the trigger is shown discarding a forged
`organization_id` and refusing a repointed parent. W5 inserts a real price
target as a real user and confirms the `SECURITY DEFINER` trigger stamps the
writer's organization on the resulting outcome. W6 confirms the removed INSERT
policy actually closes the client's direct-insert path.

Residue check afterwards: 30 rows, 30 owners, 0 probe notes, 0 probe price
targets. Nothing from the verification persisted.

## 5. Ledger reconciliation — no SQL re-executed

The Management API query endpoint executes SQL but writes no
`supabase_migrations.schema_migrations` row. Recorded with an INSERT:

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261011120000', 'price_target_outcomes_tenant_isolation', null)
on conflict (version) do nothing;
```

`statements` is deliberately NULL: putting the SQL text there would imply the
CLI ran it, and it did not. Confirmed present, and the migration was not
re-executed.

## 6. Guard inputs refreshed from production, after deployment

`docs/audit/baselines/ci-policy-inventory.json` was regenerated with
`scripts/audit/schema-baseline.mjs --ci-minimal`, so the guard's input is a
capture rather than intent. The diff is scoped to this one table:

```
-      "policies": 3,
-      "anon": "DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE",
-      "auth": "DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE"
+      "policies": 2,
+      "anon": "",
+      "auth": "SELECT,UPDATE"
-      "qual_class": "AUTH_ONLY",   (Users can view all price target outcomes)
+      "qual_class": "SCOPED",      (price_target_outcomes_select)
```

`node scripts/unconditional-policy-guard.mjs docs/audit/baselines/ci-policy-inventory.json`
→ `PASS: 105 known finding(s), 0 new.`

`scripts/tenant-boundary-lint.mjs`: the table was removed from `GLOBAL_TABLES`
and added to `GRANDFATHERED_NULLABLE`. Before the migration,
`get_tenant_lint_tables()` reported `has_org_id: false` for it, so with the
entry gone CHECK 2 would have failed — the gate observes its own subject. The
lint itself could not be executed in this environment (see the open item
below).

## 7. RLS posture now live

| command | posture |
|---|---|
| SELECT | `organization_id IS NOT NULL AND is_active_member_of_current_org() AND organization_id = current_org_id()`, `authenticated` only |
| UPDATE | author-only within the row's org; `WITH CHECK` omits the org predicate so a quarantined row stays repairable |
| INSERT | no policy — denied for `authenticated`. Writers are `SECURITY DEFINER` and bypass RLS |
| DELETE | no policy, no grant — denied |
| `anon` | no grant at all |

`FORCE ROW LEVEL SECURITY` is deliberately not set; it applies to the table
owner, the role the backfill ran through.

## 8. Rollback

`supabase/migrations/20261011120001_price_target_outcomes_tenant_isolation_DOWN.sql.rollback`
restores the previous boundary. Running it reopens the cross-tenant read, and
it also re-grants `anon` the DML it used to hold. It leaves the
`organization_id` column and trigger in place, since re-deriving is idempotent
and dropping them loses derived ownership for no benefit.

## 9. Open item, not fixed here

`scripts/tenant-boundary-lint.mjs` could not be executed in this environment:
the first run produced no output and the retry was denied by the sandbox
classifier. Its two edits are backed by the live `get_tenant_lint_tables()`
reading rather than by a run. The lint is not wired into CI either — only a
comment in `.github/workflows/ci.yml` references it.
