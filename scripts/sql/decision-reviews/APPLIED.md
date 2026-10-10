# decision_reviews tenant isolation — what was applied to production

Project `wfcebeagznzgeuyysbnt`, 2026-10-09/10, via the Supabase Management API
(`POST /v1/projects/{ref}/database/query`). No branch database: branching is
gated behind the Pro plan on this project, so the migration was rehearsed by
preflight against production rather than applied to a copy first.

## Order of operations

| # | Applied | File |
|---|---|---|
| 1 | containment — deny-by-default, client grants withdrawn | `01-containment.sql` |
| 2 | preflight — schema, constraints, helper, row dispositions | scratch `q-preflight.sql`, `q-preflight2.sql` |
| 3 | backup — all 7 rows to JSON, 3,134 bytes, verified | scratch `decision_reviews_backup.json` |
| 4 | permanent fix | `supabase/migrations/20261009120000_decision_reviews_tenant_isolation.sql` |
| 5 | behavioural verification | below |

## Preflight, before the migration

```
parent tables        trade_queue_items, decision_requests,
                     portfolio_trade_events, portfolios, organizations — all present
required columns     all four present (the three portfolio_id, plus portfolios.organization_id)
is_member_of_org     present: is_member_of_org(uuid), SECURITY DEFINER, STABLE,
                     EXECUTE held by authenticated and service_role
organization_id      not yet present (0)
constraints          UNIQUE (decision_id), PK (id), FK reviewed_by -> auth.users,
                     three CHECKs on the verdict enums
existing triggers    only decision_reviews_updated_at (sorts AFTER
                     decision_reviews_owner, so no ordering conflict)
new functions        none of the three already present
dispositions         total 7, will_backfill 1, will_quarantine 6
```

Matched the expectation exactly. No drift, so the migration was applied.

## Post-migration state

```
policies    decision_reviews_select  USING  (organization_id IS NOT NULL
                                             AND is_member_of_org(organization_id))
            decision_reviews_insert  CHECK  (reviewed_by = auth.uid()
                                             AND can_review_decision(decision_id))
            decision_reviews_update  USING  (reviewed_by = auth.uid()
                                             AND can_review_decision(decision_id)
                                             AND (organization_id IS NULL
                                                  OR is_member_of_org(organization_id)))
                                     CHECK  (reviewed_by = auth.uid()
                                             AND can_review_decision(decision_id))
grants      authenticated SELECT, INSERT, UPDATE   (restored; DELETE deliberately not)
            postgres, service_role  full
            anon, PUBLIC            none
rls         enabled, not forced
rows        7
```

`unconditional_predicates = 0`, `anon_grants = 0`, `fabricated_owners = 0`.

## Behavioural verification

Run against production as the migration role, inside a statement that
deliberately `RAISE`s at the end so every probe write is rolled back. Results
travel out in the exception message — the only channel that survives the abort.
Confirmed afterwards: 7 rows, `decision_quality` still NULL on the owned row,
zero fixture residue in `trade_queue_items` / `portfolio_trade_events`.

```
6a same-tenant SELECT: 1 rows (expect 1)                                PASS
6b cross-tenant SELECT (whole table): 0 rows (expect 0)                 PASS
6c cross-tenant INSERT: sqlstate=42501                                  PASS
6d cross-tenant UPDATE: 0 rows touched (expect 0)                       PASS
6e cross-tenant UPSERT (the client write shape): sqlstate=42501         PASS
6f quarantine: 6 orphans present, 0 visible to a tenant                 PASS
6g rightful reviewer upsert: 1 row written                              PASS
7a ambiguous decision_id resolves to NULL                               PASS
7a control: the same id with ONE parent resolves to that portfolio      PASS
7b decision_id immutability: sqlstate=23514                             PASS
7c quarantined row repairable by operator, still quarantined            PASS
7d anon/PUBLIC execute grants + unpinned search_path: 0                 PASS
rows still present: 7                                                   PASS
```

`user_a = fa46cffc…` (the row's own reviewer, an active member of the owning
org `4b4713e8…`); `user_b = 648e3034…` (active member of `8e879d89…`).

7a carries a **control** on purpose. "Resolves to NULL" is also what a resolver
that always returns NULL would report, which would make 7a vacuous and would
silently quarantine everything. The control deletes one of the two conflicting
parents and shows the same id then resolving to the surviving portfolio.

## Live client path

Production's real publishable key against PostgREST:

```
GET /rest/v1/decision_reviews?select=*  ->  401 {"code":"42501",
                                            "message":"permission denied for table decision_reviews"}
```

Before containment the same request returned `200 []`. The legacy `anon` key is
separately disabled (2026-10-03), so the publishable key is the only one that
proves anything here.

## Limitations

1. **No authenticated-session HTTP test.** I could not mint a tenant JWT, so the
   cross-tenant denial over HTTP is proven for `anon` only. For `authenticated`
   it is proven in-database (6a–6g above, executed under `SET LOCAL ROLE
   authenticated` with a forged `request.jwt.claims`), which exercises the same
   policies PostgREST would, but not the same transport.
2. **No branch-database rehearsal.** Branching requires the Pro plan. The
   migration went to production directly, gated on a preflight that matched
   expectations exactly and with a verified backup of all 7 rows in hand.
3. **`updated_at` moved on one row.** The backfill `UPDATE` fired the existing
   `decision_reviews_updated_at` trigger, so the owned row's `updated_at` is now
   the migration timestamp. No user-authored content changed.
4. **Writes are scoped to the organization, not the portfolio.**
   `can_review_decision` uses org membership rather than
   `user_is_portfolio_member`, because that helper reads `portfolio_members` —
   a third membership table alongside `portfolio_team` and
   `portfolio_memberships`, with known coverage gaps. Tightening it is a
   one-line change once that coverage is measured. The attack being closed
   crossed an organization boundary, so org scope closes it.
5. **The six orphans stay invisible.** They are preserved and repairable by
   `service_role` only. Nothing in the product currently offers a repair UI.
