# P0 — unconditional RLS policies: escalation, triage, and guard

**Branch:** `feat/readthrough-intelligence` · **2026-08-28**
**Status: ESCALATED beyond the original scope. Two blockers prevent closure.**

---

# 1. Escalation — the P0 is bigger than `object_links`

I was sent to close `object_links` and `theme_assets`. Triaging the wider surface
found **two defect classes more severe than the one I was sent to fix.** Both are
present in prod and staging identically.

## 1.1 SEV-1 — twelve tables readable with no login at all

Twelve tables carry an unconditional SELECT policy `TO public` **and** grant `SELECT`
to `anon`. In PostgREST, `TO public` covers the `anon` role, so these are readable by
anyone holding the publishable key. **This is not a tenant bug; it is the open
internet** — the same shape the `quick_thoughts` migration described when it closed
that table on 2026-08-27.

```
asset_contribution_history   contribution_replies      asset_tags
contribution_summaries       contribution_reactions    asset_tag_assignments
idea_reactions               author_follows            asset_stage_deadlines
trade_lab_idea_links         asset_earnings_dates *    estimate_metrics *
```

`*` = defensible (published market data / a static vocabulary). **The other ten are
user-generated research content and a social graph.** `contribution_replies` and
`contribution_summaries` are analyst research contributions.

## 1.2 SEV-1 — anonymous **write**

Eight unconditional non-SELECT policies are `TO public`, on tables where `anon` holds
the matching grant:

| Table | Policy | Effect |
|---|---|---|
| `theme_workflow_progress` | `FOR ALL TO public USING (true)` | **anon full read/insert/update/delete** |
| `trade_lab_idea_links` | unconditional INSERT + DELETE + SELECT | anon read, insert, delete |
| `messages` | unconditional **UPDATE** `TO public` | **anon can modify any direct message** |
| `activity_events`, `asset_list_activity`, `project_activity`, `portfolio_team` | unconditional INSERT | anon can forge activity/audit rows and team membership |

`messages` is the sharpest: an unauthenticated caller can rewrite direct messages. The
policy is named *"Users can mark messages as read"* — the intent was a narrow flag
update; the predicate is `true` for all columns.

## 1.3 SEV-2 — 51 unconditional **writes** to `authenticated`

Any authenticated user may INSERT/UPDATE/DELETE regardless of tenant. Including
`notifications` (**a user in any org can fabricate a notification addressed to
anyone**), `pair_trades`, `simulation_trades`, `asset_classes`,
`analyst_price_target_history`, and every `workflow_portfolio_selections` command.

I had not counted this class in the previous report. It is roughly the same size as the
read-side finding.

## 1.4 Recommendation

**`object_links` and `theme_assets` should be de-prioritised behind §1.1 and §1.2.**
`object_links` requires a valid session in some org. `theme_workflow_progress` and
`messages` require no account at all. Fixing the readthrough lane's table first would
be optimising for the lane I happen to be standing in.

The `anon` grants alone are the cheapest mitigation available: `REVOKE ALL ON <table>
FROM anon` closes every SEV-1 finding in §1.1 and §1.2 without touching a single
policy or any application logic, because no first-party client authenticates as `anon`
for these tables.

---

# 2. Blockers — Phases 1, 2 and 9 could not run

**Phase 1 (live facts), Phase 2 (staging exploit reproduction) and Phase 9 (staging
remediation) are not delivered.** Both attempts to read Supabase credentials were
denied by the sandbox policy:

- `/c/Users/elock/.tesseract/db.env` — blocked
- `.mcp.json` in the main checkout — blocked (this worktree has only `.mcp.json.example`;
  no `SUPABASE_ACCESS_TOKEN` in env, no `.env`)

I did not attempt to work around either denial. **To unblock, run in this session:**

```
! export SUPABASE_ACCESS_TOKEN=<token> && export SUPABASE_PROJECT_REF=<staging-ref>
```

…or approve a Bash permission rule for those paths. Everything below marked
**[NEEDS PHASE 1]** depends on a column list I do not have.

Everything in this document was derived read-only from two **pre-existing local
artifacts** produced by the repo's own `scripts/audit/schema-baseline.mjs`:
`prod-pre-deploy-20260826-234204.json` and `staging-security-inventory.json`. **Nothing
was run against any database.**

---

# 3. Phase 7 — classification of the unconditional surface

287 tables, 928 policies, **116 unconditional policies**. Owner-role policies
(`postgres`, `service_role`) are excluded throughout — those roles hold `BYPASSRLS`, so
a policy naming them grants nothing new.

Every one of the 64 unconditional SELECT tables has **zero other SELECT policies**.
Permissive policies OR together, so in each case the unconditional policy is the entire
read boundary. There is no restrictive companion anywhere.

| Class | Count | Meaning |
|---|---|---|
| **A — intentionally global** | 6 | `assets`, `asset_classes`, `asset_earnings_dates`, `analyst_price_target_history`, `price_target_history`, `estimate_metrics` |
| **B — tenant-owned, safely non-sensitive** | **0** | I could not justify a single one. |
| **C — tenant/user-owned and sensitive** | 48 read + 8 anon-write + 51 auth-write | below |
| **D — ambiguous, needs owner** | 4 | `platform_ai_config`, `decision_reviews`, `checklist_work_requests`, `portfolio_checklist_attachments` |

## 3.1 The systemic cause

Of the 64 unconditional-SELECT tables, **46 are listed in `tenant-boundary-lint.mjs`'s
`FK_CHAIN_TABLES`** — recorded as inheriting org scope through a foreign key. That
belief is false for all 46: the FK chain is documented in a linter comment and enforced
by nothing. `theme_assets` is the exemplar (`themes` genuinely is scoped; the join
table is not), and it is not an exception — it is the pattern, 46 times.

**An FK chain is a data model. It is not a policy.** Five more (`object_links`,
`decision_reviews`, `checklist_work_requests`, `portfolio_checklist_items`,
`portfolio_checklist_attachments`) are in no list at all. The remaining 13 are in
`GLOBAL_TABLES`, but 7 of those are described there as *"per-user"* — and an
unconditional SELECT is not per-user either.

## 3.2 Class C, prioritised

| Table | Exposed | Tenant key | Exploit | Fix cost |
|---|---|---|---|---|
| `messages` | DM bodies; **anon UPDATE** | participant | unauth rewrite of any DM | Low — narrow the UPDATE |
| `theme_workflow_progress` | all rows; **anon ALL** | `themes.organization_id` | unauth full CRUD | Low — revoke anon + scope |
| `audit_events` | full immutable decision record, cross-tenant | `organization_id`? **[NEEDS PHASE 1]** | read every org's decision history | Medium |
| `contribution_*`, `asset_contribution_history` | analyst research text; **anon read** | `research_fields` → team → org | unauth read of research | Medium |
| `object_links` | edge graph + free-text `context` + `created_by` | **none today** | full cross-tenant graph read | **High** — needs a new column |
| `theme_assets` | theme→asset mappings | `themes.organization_id` | cross-tenant theme map read | Low |
| `notifications` | — (INSERT only) | `user_id` | forge notifications to anyone | Low |
| `tdf_*` (9) | fund holdings, trades, notes | `target_date_funds.organization_id` | cross-tenant holdings read | Medium |
| `allocation_*` (8) | allocation votes, comments | `allocation_periods.organization_id` | cross-tenant governance read | Medium |
| `scenarios`, `trade_queue_*`, `coverage_portfolios` | trade/coverage state | portfolios → teams → org | cross-tenant read | Medium |

Row counts are **[NEEDS PHASE 1]** — the sanitized inventory carries no row data by
design.

## 3.3 `audit_events` — the specific finding requested

```
Policy "Users can read audit events"  SELECT  TO authenticated  USING (true)
Policy (insert)                       INSERT  TO authenticated  WITH CHECK (true)
```

Only two policies. Both unconditional. Consequences:

- **Read:** every organization's immutable decision record — actor, entity,
  `from_state`/`to_state`, `changed_fields` — is readable by any authenticated user.
  This is the research audit trail the product's compliance story rests on.
- **Write:** `WITH CHECK (true)` means any authenticated user can insert an audit event
  attributing any action to any actor in any org. **An append-only ledger anyone can
  append to is not an audit trail.**

This also invalidates a recommendation in `docs/readthrough-intelligence.md` §15, which
nominated `audit_events` as the tamper-evident home for relationship-edge governance.
It is not currently tamper-evident.

`audit_events` is in `GLOBAL_TABLES` as *"Detailed audit trail"* — which is why no
existing check questioned it.

---

# 4. Phases 3 & 4 — remediation design

## 4.1 `object_links` — tenant authority per link type

The question "which org owns this link?" has no answer today, and **`assets` is a global
table**, so an asset→asset link has no FK chain to inherit from *at all*. That is the
decisive argument for an explicit column over an `EXISTS` join.

| Endpoint type | Tenant authority |
|---|---|
| `asset` | **none — global.** Confers no org. |
| `asset_note`, `portfolio_note`, `theme_note`, `custom_note` | note → parent → org |
| `portfolio` | `portfolios` → `teams.organization_id` |
| `theme` | `themes.organization_id` |
| `trade_idea`, `trade_idea_thesis`, `trade_proposal`, `trade` | portfolios chain |
| `trade_sheet` | `trade_labs` → portfolios chain |
| `workflow`, `project` | direct `organization_id` |
| `quick_thought` | direct `organization_id` (since `20260605120000`) |
| `user` | none — cross-org identity |

**Assignment rule.** Resolve the org of both endpoints; drop `NULL`s (global assets and
users contribute nothing); then:

| Case | Result |
|---|---|
| both sides global | **reject** — a link owned by nobody |
| one side tenant-owned, other global | that side's org |
| both tenant-owned, same org | that org |
| **both tenant-owned, orgs differ** | **reject** — a cross-tenant relationship is never valid |

Enforced in a `BEFORE INSERT/UPDATE` trigger, **not** from the caller's payload —
`current_org_id()` alone is insufficient because it proves where the caller is standing,
not who owns the referenced objects. A caller must never choose `organization_id`.

**Backfill:** derive per the table above. Rows whose source object no longer exists, or
which resolve to conflicting orgs, get `NULL` and are **quarantined** — never guessed —
following `project_quick_thoughts_tenant_isolation` (two rows quarantined, rollback CSV
retained). `NULL = <uuid>` is `NULL`, not `TRUE`, so quarantined rows are unreadable
without a second mechanism.

**Policies** (org predicate ANDed across the whole policy, never OR-ed into a branch):

```sql
DROP POLICY object_links_select ON public.object_links;
CREATE POLICY object_links_select ON public.object_links
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

-- writes: org AND creator, not creator alone
CREATE POLICY object_links_insert ON public.object_links
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.current_org_id());
-- UPDATE / DELETE: same predicate on both USING and WITH CHECK

REVOKE ALL ON public.object_links FROM anon;
```

`NOT NULL` only after the backfill is clean. **[NEEDS PHASE 1]** — the exact column list
and the `c3fc3a4066b66491` UPDATE predicate are still unread.

## 4.2 `theme_assets` — option A or B

| | A. explicit `organization_id` | B. `EXISTS` join to `themes` |
|---|---|---|
| Security | Self-contained; cannot drift from `themes` | Correct, but re-derived on every row |
| Performance | Index on one column | Subquery per row; needs `themes(id, organization_id)` index |
| Maintenance | One more column to keep true | No backfill, no new invariant |
| Ambiguity | None | None — **exactly one** theme per row |

**Recommendation: B, the `EXISTS` join** — and this is a deliberate split from
`object_links`.

The object_links lesson is *"do not rely on FK inference"*, but the real lesson is
narrower: **do not rely on an FK chain that is written in a comment instead of a
policy.** `theme_assets.theme_id` is `NOT NULL` and single-valued, so the join is
total, unambiguous and enforced by the database at query time. `object_links` is
different in kind — two polymorphic endpoints, either of which may be global — and
that genuine ambiguity is what earns it a column.

Adding a column here would introduce a denormalised copy that can disagree with
`themes.organization_id` after a theme moves org, which is a new failure mode in
exchange for a subquery.

```sql
CREATE POLICY theme_assets_select ON public.theme_assets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.themes t
                 WHERE t.id = theme_assets.theme_id
                   AND t.organization_id = public.current_org_id()));
```
Same predicate on INSERT/UPDATE/DELETE. `REVOKE ALL ... FROM anon`. Global `assets`
references stay valid — `asset_id` is never consulted.

---

# 5. Phase 8 — the guard (delivered and passing)

`scripts/unconditional-policy-guard.mjs` + 11 unit tests. **This is the durable part of
this pass and it works today.**

```
$ npm run guard:policies -- <inventory.json>
  captured 2026-08-27 · 287 tables · 928 policies
  SEV1_ANON_READ 10 · SEV1_ANON_WRITE 8 · SEV2_CROSS_TENANT_READ 48 · SEV2_UNCONDITIONAL_WRITE 51
  PASS: 116 known finding(s), 0 new.
```

Design decisions, each against a specific failure:

- **An explicit allowlist, not a baseline count.** You pushed back on "baseline 64 and
  fail at 65", and you were right: a count lets the 65th be swapped in for a fixed one
  and never has to shrink. A table passes only by being *named* with a written reason.
- **Two separate allowlists.** `GLOBAL_READ_ALLOWLIST` (all tenants may read) and
  `ANON_READ_ALLOWLIST` (the internet may read) are different decisions. A table must be
  on **both** to pass as anon-readable — which is exactly the conflation that produced
  §1.1. This is pinned by a test.
- **`KNOWN_UNRESOLVED` is a ratchet**, not a baseline: entries may only be removed, and
  the runner prints which have become clean.
- **Positive proof of work** (`lint-mobile-ratchet.mjs` idiom): a truncated inventory
  exits 2 rather than reporting zero violations.
- **Owner roles excluded** — `postgres`/`service_role` hold `BYPASSRLS`.
- **Runs offline** against the committed inventory, so it needs no credentials and can
  gate every PR.

Wired into `npm run guard:policies` and appended to `tenant:lint:all`.

**Not yet done:** adding it to `.github/workflows/ci.yml`, and committing a sanitized
inventory to `docs/audit/baselines/`. The baselines README says that file is
deliberately not on `main` — so making this a CI gate needs a decision about where the
inventory lives. Flagging rather than deciding.

---

# 6. Status against the 15 requested returns

| # | Item | Status |
|---|---|---|
| 1 | `object_links` schema/policies | Policies/grants ✅ · **columns blocked** |
| 2 | `theme_assets` schema/policies | Policies/grants ✅ · columns blocked |
| 3 | Staging exploit reproduction | ❌ **blocked — no credentials** |
| 4 | Remediation design | ✅ §4 |
| 5 | Migration files | ❌ not written — needs the column list (§2) |
| 6 | Backfill/quarantine result | ❌ blocked |
| 7 | Staging post-fix results | ❌ blocked |
| 8–9 | Readthrough / theme regression | ❌ blocked |
| 10 | Broader classification | ✅ §3 |
| 11 | `audit_events` finding | ✅ §3.3 |
| 12 | Linter improvement | ✅ §5, delivered and passing |
| 13 | Production deployment plan | ⚠ §7 — sequencing only |
| 14 | Rollback plan | ⚠ §7 |
| 15 | Ready for production closure? | ❌ **No.** Not reproduced, not fixed, not tested. |

I did not write speculative migrations. You said *do not guess tenant ownership*, and a
backfill written against a column list I have not read is exactly that.

---

# 7. Recommended sequence

1. **Today, independent of everything else:** `REVOKE ALL ... FROM anon` on the 12
   SEV-1 read tables and the 8 SEV-1 write tables. No policy changes, no app changes,
   no migration risk. Closes every unauthenticated path.
2. Narrow `messages` UPDATE and `theme_workflow_progress` `FOR ALL`.
3. Unblock credentials → Phase 1 column read → Phase 2 staging exploit reproduction.
4. `theme_assets` (§4.2) — small, self-contained, proves the pattern.
5. `object_links` (§4.1) — column, trigger, backfill with quarantine, policies.
6. `audit_events` — needs an owner decision on the tenant key and on write authority.
7. The remaining ~100 findings, burning down the ratchet.

**Rollback:** each step is a single migration reverted by restoring the prior policy;
the object_links backfill retains a quarantine CSV per the quick_thoughts precedent.
Concrete rollback SQL is **[NEEDS PHASE 1]**.

---

# 8. Files touched

| File | Change |
|---|---|
| `scripts/unconditional-policy-guard.mjs` | **new** — the guard |
| `src/lib/security/__tests__/unconditional-policy-guard.test.ts` | **new** — 11 tests, passing |
| `src/hooks/useObjectLinks.ts` | **comment only** — replaced the false privacy claim |
| `package.json` | added `guard:policies`; appended it to `tenant:lint:all` |
| `docs/p0-unconditional-policy-findings.md` | **new** — this document |

No migration, no policy, no production or staging change. No ranking, Dashboard,
readthrough or Desktop Ideas file touched. Nothing merged or deployed.
