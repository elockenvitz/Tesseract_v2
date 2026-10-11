# Why "Daniel Adam Capital" won't delete — root cause, deletion impact, plan

Read-only investigation, production (`wfcebeagznzgeuyysbnt`), 2026-10-11.
**Nothing was changed. No coverage row and no organization was deleted.**

Org under review: `Daniel Adam Capital` = `fd58ca21-8140-4fa7-97eb-87623a3b5d33`

---

## 1. Root cause

The reported error is
`null value in column "context_id" of relation "notifications" violates not-null constraint`.

The chain, each link verified in production:

1. Deleting the organization cascades into `coverage`
   (`coverage_organization_id_fkey`, `ON DELETE CASCADE`). This org holds
   **7 coverage rows**, all held by `daniel.lockenvitz@gmail.com`.
2. That DELETE fires the **statement-level** trigger
   `coverage_removed_notification` → `notify_coverage_removed_bulk()`.
3. That function groups the deleted rows **by recipient**, skipping rows the
   actor holds themselves (`WHERE nr.user_id IS NOT NULL AND nr.user_id <> actor`).
   All 7 belong to one person who is not the actor, so one group of 7 is emitted.
4. `_emit_coverage_notification()` takes its multi-asset branch and inserts
   `context_id = NULL` **on purpose**:

   ```sql
   -- For single-row, point at the asset; for bulk, leave context_id null
   -- and stash the list in context_data so the UI can render a list view.
   CASE WHEN count_n = 1 THEN 'asset' ELSE 'coverage_bulk' END,
   CASE WHEN count_n = 1 THEN asset_ids[1] ELSE NULL END,
   ```

5. `notifications.context_id` is `uuid NOT NULL` with no default
   (created by `20250827230714_crimson_paper.sql:51`).
6. The insert raises, and because it happens inside the cascade, **the whole
   organization DELETE aborts**.

The migration that introduced the bulk branch,
`20260427100700_coverage_handoff_notifications_with_bulk.sql`, writes a NULL
`context_id` and **never drops the NOT NULL**. The two halves of that migration
contradict each other.

### Proof it has never worked

| evidence | value |
|---|---|
| notifications with `context_type = 'coverage_bulk'` | **0** |
| notifications of type `coverage_added` or `coverage_removed`, ever | **0** |
| `context_type` values actually present | asset, decision_request, list, note, organization, price_target, project, trade_idea, workflow |

`coverage_added` and `coverage_removed` exist in the `notification_type` enum
and have never once been written. The feature has been dead on arrival since
April 2026.

### It is not an org-delete bug, and not only the delete path

Both directions are affected, through the same emitter:

| trigger | fires | function |
|---|---|---|
| `coverage_added_notification` | AFTER INSERT, STATEMENT | `notify_coverage_added_bulk` |
| `coverage_removed_notification` | AFTER DELETE, STATEMENT | `notify_coverage_removed_bulk` |

So **assigning or removing 2+ coverage assets for another person in one
operation fails anywhere in the app**, not just in the ops portal.

Why today's 7 coverage rows were created successfully anyway: both functions
skip rows where `user_id = actor`. Those rows were self-assigned, so no
notification was attempted. The org delete has a different actor from the
holder, so it fires — and throws.

### Six organizations are blocked the same way

| org | coverage rows |
|---|---|
| Tails Cap | 50 |
| Tesseract | 34 |
| Daniel Adam Capital | 7 |
| Challita Capital | 5 |
| Xtina Capital | 5 |
| Daniil Cap | 4 |

---

## 2. A second, independent defect — already fired

`src/pages/ops/OpsSettingsPage.tsx:101-103`:

```ts
await supabase.from('organization_memberships').delete().eq('organization_id', orgId)
const { error } = await supabase.from('organizations').delete().eq('id', orgId)
if (error) throw error
```

Two statements, no transaction, and the first one's result is not even checked.
Every failed delete attempt **destroys the memberships and then fails**.

Observed state now: `Daniel Adam Capital` has **0 memberships** and still
exists. It is a shell.

Nobody is locked out this time — `daniel.lockenvitz@gmail.com` still holds two
active memberships (Tesseract, Aruba Capital) and their active org is Aruba
Capital. On an org that was someone's only membership, the same click would
have stranded them: `current_org_id()` requires an active membership, so they
would hit "Access Required" with no route back.

This needs fixing regardless of the notification bug, and it is a third
separate change.

---

## 3. Deletion impact — what a successful delete would destroy

### Direct, by `organization_id`

| table | on delete | rows |
|---|---|---|
| portfolio_holdings_positions | CASCADE | 37 |
| research_fields | CASCADE | 29 |
| benchmark_weight_snapshots | CASCADE | 14 |
| user_sessions | CASCADE | 9 |
| coverage | CASCADE | 7 |
| coverage_history | CASCADE | 7 |
| research_sections | CASCADE | 4 |
| org_onboarding_status | CASCADE | 1 |
| organization_audit_log | CASCADE | 1 |
| organization_governance | CASCADE | 1 |
| pilot_scenarios | CASCADE | 1 |
| portfolio_holdings_snapshots | CASCADE | 1 |
| portfolios | CASCADE | 1 |
| rating_scales | CASCADE | 1 |
| **trade_queue_items** | **SET NULL** | **6** |
| **asset_notes** | **SET NULL** | **1** |

### Via the one portfolio ("Tech & Consumer Growth", created 2026-05-23)

| table | on delete | rows |
|---|---|---|
| **portfolio_benchmark_weights** | CASCADE | **6,738** |
| portfolio_holdings | CASCADE | 71 |
| portfolio_holdings_positions | CASCADE | 37 |
| benchmark_weight_snapshots | CASCADE | 14 |
| trade_queue_items | CASCADE | 6 |
| **accepted_trades** | CASCADE | **2** |
| decision_requests | CASCADE | 2 |
| portfolio_holdings_snapshots, portfolio_memberships, portfolio_team, portfolio_trade_events, simulations, trade_batches, trade_labs, trade_proposals | CASCADE | 1 each |
| decision_price_snapshots, pilot_scenarios | SET NULL | 1 each |

Third level adds `accepted_trade_comments` (1), `trade_lab_idea_links` (2),
`decision_price_snapshots` (1) and assorted `SET NULL` re-pointing between
`accepted_trades`, `decision_requests`, `trade_proposals` and `trade_batches`.

**Total: roughly 7,000 rows**, dominated by the 6,738 benchmark weights.

### The two things worth pausing over

1. **`accepted_trades` — 2 rows.** AAPL `buy` and CAT `buy`, both
   `execution_status = complete`, `reconciliation_status = matched`, created
   2026-06-02, sources `inbox` and `simulation`. `accepted_trades` is the
   **only committed trade record** in the system. Deleting the org destroys
   committed, executed, reconciled trade history. The data looks like fixture
   seed, but the record type is the canonical one.
2. **7 rows are orphaned rather than deleted.** `trade_queue_items` (6) and
   `asset_notes` (1) are `ON DELETE SET NULL`, so they survive with
   `organization_id = NULL`. Depending on each table's RLS they become either
   invisible to everyone or — worse — visible to everyone. **This should be
   checked before deleting any organization, not after.**

### No cross-organization or storage entanglement

| check | result |
|---|---|
| `files` rows for this org | 0 |
| storage objects naming this org | none |
| `teams` owned | 0 |
| portfolio's `team_id` | NULL |
| coverage / portfolio_membership / portfolio_team holders | all one user, `daniel.lockenvitz@gmail.com` |
| users whose `current_organization_id` points here | 0 |
| other orgs referencing this org's rows | none found |

The only `NO ACTION` foreign keys into `organizations` are
`decision_reviews.organization_id` and `messages.organization_id`, and both are
**0 rows** for this org. So coverage is the sole blocker.

---

## 4. Smallest safe fix

The evidence changes the answer from what it looked like at first. Dropping the
NOT NULL is *not* the smallest safe fix, because `coverage_bulk` has **zero
handlers in the client** — `NotificationCenter.tsx:239`,
`NotificationPane.tsx:276` and `NotificationPanel.tsx` all switch on
`context_type` with no `coverage_bulk` case. Dropping the constraint alone
would make the insert succeed and produce a notification that renders but
navigates nowhere.

### Recommended: Option B — replace the emitter only

Change `_emit_coverage_notification` so the bulk branch keeps
`context_type = 'asset'` and sets `context_id = asset_ids[1]`, leaving the full
list in `context_data` where it already is (`asset_ids`, `asset_symbols`).

- No schema change, so no risk to the other 20 notification producers.
- No client change: the existing `case 'asset'` already routes it, and
  `src/lib/notifications/grouping.ts:105-109` already prefers
  `context_data.asset_id` and falls back to `context_id` for
  `context_type = 'asset'`.
- Unblocks org deletion and bulk coverage assignment immediately.
- Cost: clicking a 7-asset notification opens the first asset rather than a
  list. The title and message already name the count and the symbols, so
  nothing is hidden from the reader.
- One caveat to handle in implementation: grouping reads
  `context_data.asset_id` (singular) and the emitter writes `asset_ids`
  (array). Add the singular key alongside it so grouping works too.

### Option A — honour the original design intent

`ALTER TABLE notifications ALTER COLUMN context_id DROP NOT NULL`, **plus** a
`coverage_bulk` case in all three notification panes. Larger surface: a
nullable `context_id` becomes legal for every producer, and each pane's
routing must be re-checked. Schema-wise nothing else objects —
`20260427140000_ai_conversation_tags.sql:57` already guards
`AND context_id IS NOT NULL` and `20260907120000` already uses
`COALESCE(..., n.context_id)` — but it is a wider blast radius for the same
user-visible outcome.

Either way the gate must be proven non-vacuous: assign 2+ coverage assets to
another user and delete them again, and show both operations succeeding where
they throw today.

---

## 5. Recommended sequence

1. **Finish `price_target_outcomes`.** Rehearsed and passing; awaiting approval
   to apply. Separate approval gate, separate PR.
2. **Fix the coverage bulk notification** (Option B) as its own focused change,
   with a test that fails against today's schema.
3. **Make the ops org delete atomic** — a single `SECURITY DEFINER` RPC in one
   transaction, so a failure cannot leave memberships deleted. Third change.
4. **Decide `Daniel Adam Capital`'s fate** once §3 is reviewed. It is a shell
   with 0 members holding a fixture portfolio; the only judgement calls are the
   2 committed `accepted_trades` and the 7 rows that would be orphaned rather
   than removed.
5. **Resume Asset Page Increment 2B.**

No destructive action is taken until step 4 is explicitly authorised.
