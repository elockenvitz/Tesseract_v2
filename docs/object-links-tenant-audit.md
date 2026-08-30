# `object_links` tenant-isolation audit + retrieval bottleneck map

**Branch:** `feat/readthrough-intelligence` · **Date:** 2026-08-28
**Result: CLASS C — UNSAFE. A live cross-tenant read exists in production.**

Per the task's own instruction, implementation design (Phases 4–9) is **held**. This
document delivers Phase 1 (the security finding), Phase 2 (the manual readthrough flow
map) and Phase 3 (the retrieval bottleneck), because those are audits that do not
assume the table is safe. Phases 4–9 resume only after remediation.

---

# ⚠ PART 1 — THE SECURITY FINDING (read this first)

## 1.1 The defect

```sql
-- production, verified 2026-08-27
POLICY object_links_select ON public.object_links
  FOR SELECT TO authenticated
  USING (true);
```

**Any authenticated user of any organization can read every row of `object_links` in
production.** Not "can reach rows through a permissive join" — can `SELECT *` with no
filter and receive the entire cross-tenant relationship graph.

The same defect exists on **`theme_assets`**, the other table this lane's V1 design
proposed to build on.

### How this was established (read-only, no production access)

Two local sanitized security inventories produced by the repo's own
`scripts/audit/schema-baseline.mjs`:

- `%USERPROFILE%\.tesseract\schema-baselines\prod-pre-deploy-20260826-234204.json`
- `%USERPROFILE%\.tesseract\schema-baselines\staging-security-inventory.json`

Nothing was run against production. The inventory records, per policy, an
`unconditional` flag computed server-side as `qual = 'true'`, plus a SHA-256 hash of
the predicate.

```
object_links_select  cmd=SELECT  roles=authenticated  unconditional=TRUE
                     qual_hash=b5bea41b6c623f7c
```

Two independent confirmations that the predicate is literally `true`:

1. `unconditional: true` — the baseline query is `coalesce(qual='true' or (qual is
   null and with_check='true'), false)` (`scripts/audit/schema-baseline.mjs:122`).
2. `sha256("true")[0:16] = b5bea41b6c623f7c` — reproduced locally, exact match.
   (Control: `sha256("") = e3b0c44298fc1c14`, which is what the inventory shows for
   every absent predicate.)

**Prod and staging are byte-identical on all four policy hashes.** This is not drift;
it is the intended-as-written state in both environments.

## 1.2 The full policy set

| Policy | Cmd | Roles | Predicate | Verdict |
|---|---|---|---|---|
| `object_links_select` | SELECT | `authenticated` | **`USING (true)`** | ❌ **cross-tenant read** |
| `object_links_insert` | INSERT | `authenticated` | `WITH CHECK (created_by = auth.uid())` ¹ | ⚠ author-scoped only — no tenant, no object-ownership check |
| `object_links_delete` | DELETE | `authenticated` | `USING (created_by = auth.uid())` ¹ | ✅ author-scoped |
| `object_links_update` | UPDATE | `authenticated` | qual = check = `c3fc3a4066b66491` (not identified; conditional) | ⚠ verify |

¹ `sha256("(created_by = auth.uid())")[0:16] = 4380997723298a7f` — exact match on both
the INSERT `check_hash` and the DELETE `qual_hash`.

Table state: `rls = true`, `rls_forced = false`, 4 policies.

Grants — prod: `anon` and `authenticated` both hold
`DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`. Staging: both hold
`DELETE,INSERT,SELECT,UPDATE`.

**On the `anon` grant:** every policy is `TO authenticated`, so with RLS enabled an
anonymous caller matches no policy and reads zero rows. The grant is not directly
exploitable through PostgREST. One caveat worth recording rather than dismissing:
**`TRUNCATE` is not subject to RLS.** It is not reachable via PostgREST, so this is a
defence-in-depth item, not a live hole — but `TRUNCATE` on `anon` should not be
granted on any table.

## 1.3 Exact exploit surface

**Precondition:** a valid session for *any* organization. That is every pilot user.

**Exploit 1 — full graph exfiltration (one request, no guessing required).**

```ts
await supabase.from('object_links').select('*')
```

Returns, for every organization in the instance:

- `source_type` / `source_id` → `target_type` / `target_id` — the complete
  research-object graph: which notes cite which assets, which theses oppose which,
  which trade ideas descend from which, which portfolios link to which themes.
- **`context`** — free text. On a hand-marked readthrough this is a human's stated
  reason a story changes their view on a different name. **This is exactly the
  proprietary relationship intelligence §15 of the readthrough design was written to
  protect, and it is readable now.**
- `created_by` — attribution: who at which firm holds which view.
- `is_auto`, `link_type`, `created_at` — enough to separate hand-authored judgment
  from machine-extracted references and to time-order a competitor's research.

Object *ids* alone would be a weak leak. `context` plus `created_by` plus the edge
shape is not: the graph of what a rival desk connects to what, with their reasons and
their authors, reconstructed from one unfiltered query.

**Exploit 2 — cross-tenant link injection.** The INSERT check is only
`created_by = auth.uid()`. Nothing verifies that `source_id` or `target_id` is an
object the caller may see. A user in Org A can insert a link whose `source_id` is an
Org B note id and whose `context` is arbitrary text. It becomes a real row that Org B's
backlink queries can surface. Injection requires knowing a target UUID — but Exploit 1
hands over every UUID in the instance, so the two compose.

**Exploit 3 — the stated privacy model is false.** `src/hooks/useObjectLinks.ts:7`
documents the assumption:

> *"PRIVACY: Backlink queries always join through the source object's table, so RLS on
> the source table filters out notes the user can't see. The object_links row itself is
> just (type, UUID) pairs — no sensitive data."*

Both halves have since become false. `useForwardLinks` (line 55) does a bare
`.select('*')` with **no join**, filtered only by `source_type`/`source_id`, which the
caller supplies. And the row is no longer "just (type, UUID) pairs" — `context` was
added, and `readthrough-service.ts` now writes a human's reasoning into it.

This is the trap named in the task brief — *do not infer safety because another
referenced object is tenant-scoped*. The comment was accurate when written and was
never revisited when the data model changed under it.

## 1.4 `readthrough-service.ts` scoping — none

`src/lib/mobile/readthrough-service.ts`:

- `createReadthrough` (line 38) writes `source_type, source_id, target_type, target_id,
  link_type, context, is_auto, created_by`. **No `organization_id`.**
- `getReadthroughsForItem` (line 74) filters `source_type`, `source_id`, `target_type`,
  `link_type`. **No org filter, and RLS supplies none.**
- `deleteReadthrough` (line 87) filters by `id` alone; only the DELETE policy's
  `created_by` check stops cross-user deletion.

`grep organization_id` across `src/lib/object-links/`, `src/hooks/useObjectLinks.ts`
and `src/lib/services/counter-view-service.ts` returns **nothing**. No code in the repo
reads or writes an org column on this table.

The sanitized inventory carries no column list, so whether an `organization_id` column
physically exists is unverified. It does not matter: a column that nothing populates
and no policy references provides no boundary.

## 1.5 Why the existing guardrails did not catch it

Three layers each had a reason to look away:

1. **`scripts/tenant-boundary-lint.mjs`** — `object_links` is in neither
   `GLOBAL_TABLES` nor `FK_CHAIN_TABLES`. Its CHECK 2 flags uncategorised tables only
   when they lack `organization_id`; it has no check for *unconditional SELECT on a
   table holding org data*.
2. **`scripts/frontend-tenant-lint.mjs`** — `object_links` is absent from
   `ORG_SCOPED_TABLES`, so unfiltered `.from('object_links')` calls are not violations.
   Absence from that list is the whole exemption.
3. **The FK-chain assumption** — the lint classifies `theme_assets` as
   `'themes.organization_id via theme_id'`. `themes` **is** properly scoped
   (`qual_hash e3f8e59acdcd88df`, conditional). `theme_assets` is **not**
   (`USING (true)`). The belief recorded in the linter is false for the join table.

## 1.6 This is systemic, not one table

Production carries **123 unconditional policies across 73 tables**; **64 tables have an
unconditional SELECT**. Beyond `object_links` and `theme_assets`, the list includes
`audit_events`, `messages`, `scenarios`, `coverage_portfolios`, `decision_reviews`,
`asset_revisions`, and the entire `tdf_*` and `allocation_*` families.

Two consequences for this lane specifically:

- **Both proposed V1 relationship sources — `object_links` and `theme_assets` — are
  cross-tenant readable.** The V1 architecture cannot proceed on either until fixed.
- `audit_events` having `USING (true)` on SELECT undermines the governance design in
  §15 of `docs/readthrough-intelligence.md`, which nominated it as the audit trail for
  edge curation.

`docs/tenant-isolation-enumeration.md` establishes this defect *class* is actively
generated and states the full policy-body audit is "scoped and **not started**". The
two specific findings here are not recorded in it.

## 1.7 Smallest remediation

**Scope discipline:** fix the boundary. Do not add readthrough features, do not
restructure the table, do not attempt the 64-table sweep in this change.

### Step 0 — confirm against live before writing anything

The inventory is a 2026-08-27 snapshot and carries no column list. Read-only, via the
existing tooling:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='object_links' ORDER BY ordinal_position;

SELECT polname, cmd, roles, pg_get_expr(polqual, polrelid)     AS using_expr,
                          pg_get_expr(polwithcheck, polrelid) AS check_expr
FROM pg_policy WHERE polrelid = 'public.object_links'::regclass;

-- Blast radius before any change:
SELECT count(*) AS total,
       count(*) FILTER (WHERE context IS NOT NULL)          AS with_context,
       count(*) FILTER (WHERE is_auto = false)              AS hand_authored,
       count(DISTINCT created_by)                           AS authors
FROM object_links;
```

This also settles the `c3fc3a4066b66491` UPDATE predicate.

### Step 1 — the boundary (the actual fix)

`object_links` needs its **own** tenant column. Not an FK-chain inference — that is the
assumption that failed on `theme_assets`, and the relationship itself is the
proprietary asset. Note that `assets` is a **global** table
(`tenant-boundary-lint.mjs`: *"Security master — global reference"*), so an
asset→asset link has **no FK chain to inherit from at all**. There is no correct
answer available without an explicit column.

1. `ALTER TABLE object_links ADD COLUMN organization_id uuid REFERENCES organizations(id)`.
2. Backfill from the source object's owning org. Rows where the source object is gone
   or ambiguous get `NULL` and are **quarantined** — the pattern
   `project_quick_thoughts_tenant_isolation` already established (two rows deliberately
   quarantined, rollback CSV retained).
3. Replace the SELECT policy:
   ```sql
   DROP POLICY object_links_select ON public.object_links;
   CREATE POLICY object_links_select ON public.object_links
     FOR SELECT TO authenticated
     USING (organization_id = current_org_id());
   ```
   Org predicate **ANDed across the whole policy, never OR-ed into a branch** — the
   shape `benchmark_weight_snapshots` already uses.
4. INSERT: add `AND organization_id = current_org_id()` to the existing `created_by`
   check. Closes Exploit 2.
5. UPDATE/DELETE: AND the same predicate onto the existing `created_by` checks.
6. `REVOKE ALL ON public.object_links FROM anon;`
7. Set `organization_id` `NOT NULL` once the backfill is clean.

### Step 2 — code, after the boundary lands

- `readthrough-service.ts`, `sync-note-links.ts`, `backfill-links.ts`,
  `counter-view-service.ts`: write `organization_id` on insert; filter it on read.
  (Belt and braces — RLS is the boundary, the filter is the intent.)
- Add `object_links` to `ORG_SCOPED_TABLES` in `scripts/frontend-tenant-lint.mjs` and
  to the backend linter's categorisation. Expect the baseline to move; that is the
  point.
- **Correct the false comment** at `src/hooks/useObjectLinks.ts:7`. Leaving it is how
  the next reader repeats the reasoning.
- Regenerate `src/types/database.ts` and delete the `as never` cast at
  `readthrough-service.ts:60`.

### Step 3 — stop the class recurring

Add to `scripts/tenant-boundary-lint.mjs` a check the current suite lacks:
**any table not in `GLOBAL_TABLES` that has an unconditional SELECT policy is a
violation.** Seed the baseline at the current 64 so CI fails on the 65th, and burn the
list down separately. Per `tenant-isolation-enumeration.md` §3, *the scanner fix comes
before the audit* — this is that scanner fix for this defect shape.

### Separately, and not this lane's call

`theme_assets` has the identical defect and the same fix. It is a different feature
area; it needs an owner and a decision, not a quiet inclusion in a readthrough branch.
Flagging, not fixing.

---

# PART 2 — The manual readthrough flow (Phase 2)

Audited as specified. **This flow is currently exposed by the Part 1 defect** — every
field below is cross-tenant readable today.

## 2.1 Write path

`ReadthroughSheet.tsx` (asset search → select target → optional note) →
`createReadthrough()` → single `object_links` insert.

| Field | Value | Notes |
|---|---|---|
| source object | `source_type` + `source_id` | one of `quick_thought`, `trade_idea`, `asset_note`, `portfolio_note`, `theme_note`, `custom_note`, `trade_idea_thesis` |
| target object | `target_type = 'asset'` (always), `target_id` | always an asset — never a note or idea |
| target asset | `target_id` | UUID from `ReadthroughSheet`'s asset search |
| `link_type` | `'informs'` | borrowed, not dedicated — `READTHROUGH_LINK_TYPE` constant, line 17 |
| `is_auto` | `false` | the human/machine discriminator |
| `context` | note, or `null` | **the reason. The valuable field, and the leaking one.** |
| creator | `created_by` = `auth.uid()` | |
| timestamps | `created_at` (DB default) | **no `updated_at` written** |
| directionality | **encoded, implicitly** | always feed-item → asset. Never reversed. Asymmetric by construction. |
| expiry | **none** | no `effective_to`, no review date, no decay |
| edit | **not exposed** | no update path in the service |
| delete | `deleteReadthrough(linkId)` | exists in the service, **no caller in the repo** |

## 2.2 Read path — the finding

`getReadthroughsForItem()` is defined and **called from nowhere**. Neither is
`deleteReadthrough`. Confirmed by grep across `src/`.

**These readthroughs are write-only. Nothing in the product surfaces them again.** A
reader marks one, it is recorded, and it never reappears — not on the source card, not
on the target asset, not in any feed. The generic `useForwardLinks` / backlink hooks
would return them by shape, but no readthrough-aware caller exists.

Two consequences: the feature currently gives the user nothing back (a real product
gap, separate from the security one), and the corpus has been accumulating **unbiased
by any presentation feedback loop** — which is exactly what makes it good evaluation
data.

Only telemetry consumes the *action*: `feed-telemetry.ts:31` scores a `readthrough`
interaction at **30**, the highest weight in that table.

## 2.3 As an evaluation corpus (Phase 8) — yes, with conditions

The shape is right. Each row is a human asserting *this event implies something about
that asset*, with a free-text reason, an author, and a timestamp — positive labels for
retrieval recall, relationship quality, and explanation quality, produced before any
model existed to bias them.

Four conditions, all binding:

1. **Fix Part 1 first.** Assembling a corpus from a table with an open cross-tenant
   read means assembling other firms' proprietary judgments. Non-negotiable, and it is
   why Phase 8 cannot start now.
2. **Never cross the tenant boundary.** One org's links may not train, tune, evaluate
   or influence another org's behaviour without an explicit, reviewed privacy
   architecture. Default: evaluation runs **within** an org, and only aggregate
   pass/fail rates — never text, never `created_by`, never edge shapes — leave it.
3. **Positive-only.** These are labelled positives. There are no negatives: an
   unmarked pair means nobody happened to mark it, not that no relationship exists.
   Precision is unmeasurable from this data; recall is measurable.
4. **Volume is unknown.** Step 0 of the remediation counts `is_auto = false` rows. If
   that number is small — plausible given ~0 coverage adoption — this is a smoke-test
   set, not an evaluation set, and should be described as one.

---

# PART 3 — The retrieval bottleneck (Phase 3)

**The suspected architecture is confirmed, and it is worse than stated on desktop.**

## 3.1 The chain, precisely

```
MobileDashboard.tsx:955   newsSymbols  ← visibleItems[].asset.symbol
                                       + realSignals[].relatedAssets[0].symbol
                          Array.from(new Set(out)).slice(0, 24)
        ↓
useMarketNews.ts:41       dedupe + uppercase + sort → query key
                          body: { symbols, limit: 30, lookbackDays: 7 }
        ↓
market-news/index.ts      Finnhub    company-news?symbol=X   ← LOOP, one call per symbol
                          AlphaVant. NEWS_SENTIMENT&tickers=  ← batched, one call
                          Yahoo RSS  ?s=X                     ← LOOP, one call per symbol
                          Yahoo srch q=X                      ← LOOP, one call per symbol
        ↓
                          merge() by 80-char normalised headline
                          resolvePrimary() re-ranks symbols by text mention
        ↓
builders/news.ts          MAX_AGE_DAYS = 7, suppression gates
        ↓
feed-priority.ts          rankFeed → diversify
```

**The bottleneck is confirmed exactly as suspected.** A reader whose scope is NVDA
generates `newsSymbols = [NVDA, …]`. MSFT is absent. Every provider is queried *by
symbol*. The Microsoft story is never fetched, never normalised, never ranked. **There
is nothing for a relationship graph to evaluate.** No downstream change reaches it.

## 3.2 Answers to the specific questions

**How `newsSymbols` is built** — union of (a) `item.asset.symbol` for every item in
`visibleItems`, (b) `sig.relatedAssets[0].symbol` for `realSignals`. Deduped, capped at
24.

**What is excluded** — everything not already on screen. Notably: the reader's declared
coverage *that has not surfaced a card yet*, the whole book, every name in the org's
universe, and every company outside it. The exclusion is deliberate and documented:
*"a story about a name you are not looking at is not why you opened this."* Correct for
a news lane; fatal for readthrough.

**Caps** — 24 symbols; `limit: 30` items; `lookbackDays: 7`; `resolvePrimary` keeps at
most 6 symbols per story; `MAX_AGE_DAYS = 7` in the builder (deliberately matched to
`lookbackDays` — the two are coupled and must move together).

**Provider behaviour** — three of four providers loop per symbol. Only Alpha Vantage
batches. **Cost is therefore roughly linear in symbol count for 3 of 4 providers**,
which directly contradicts the reasoning in the comment that raised the cap from 12 to
24 (*"the marginal cost of a name is a longer query string"*) — true for Alpha Vantage
only. Any expansion must be costed against the loops, not the batched call.

**Dedupe** — `merge()` keys on the headline lowercased, stripped, truncated to 80
chars. Same key + different URL → kept separate (a deliberate guard against stapling
one company's ticker to another's story). Same key + same URL → merged, preferring the
record carrying sentiment/relevance; `primarySymbol` survives; symbol lists union with
the subject first.

**Pagination** — none in the news lane. One fetch, `limit` items, no cursor.
`useIdeasFeed.fetchFeedPage` paginates the *human* feed only.

**Latency** — worst case ≈ `symbols × 3` sequential-ish provider calls in the edge
function. At 24 symbols that is already the dominant cost; at 80 it is ~3×. The React
Query key is the sorted symbol set, so **any change to the symbol set is a total cache
miss** — a naive expansion invalidates every reader's cached news at once.

**Mobile vs desktop** — `useMarketNews` and `useMarketEvents` are imported by
`MobileDashboard.tsx` **and by nothing else**. Desktop Ideas has **no external news lane
at all**. So on desktop the bottleneck is not a cap to widen; the pipe does not exist.
Any desktop readthrough needs a retrieval path built from nothing — a materially larger
job than mobile, and it lands in the other lane's files.

**Interaction with the Desktop Ideas branch** — direct and unavoidable:
- `MobileDashboard.tsx:955` (`newsSymbols`) is the seam that must change, and it sits in
  a file this lane must not touch.
- `useIdeasFeed.scoreFeedItem` and `feed-priority.ts` are being modified by that lane.
- If Desktop Ideas introduces its own candidate retrieval, that becomes the natural
  home for a readthrough pool — and building a second one here would be the third
  parallel ranking mechanism `feed-priority.ts` was written to eliminate.

**Therefore: the retrieval expansion must be designed jointly with the Desktop Ideas
lane, not unilaterally here.**

---

# PART 4 — Status and what happens next

## Held pending remediation

Phases 4–9 — bellwether pool design, bounds, V1 relationship authority, grounded
explanation contract, tier safety, and the implementation sequence — are **not
delivered**. They design an implementation on top of `object_links` and `theme_assets`,
and both are currently cross-tenant readable. The task instruction is explicit: *do not
continue designing implementation as though the table is safe.*

The prior design in `docs/readthrough-intelligence.md` already anticipated this. Its
§15 flagged `object_links` org scoping as a **blocking prerequisite** and its §17 made
verification step 0. That call was correct, and the answer is worse than the "verify
before relying on it" the document assumed.

Two prior design decisions now need revisiting once remediation lands:

- **V1 edge sources.** `theme_assets` was recommended over free-text industry. It has
  the identical defect. The recommendation may still hold — but only after the boundary
  exists, and it now carries a dependency on someone else's fix.
- **Audit trail.** §15 nominated `audit_events` for edge-curation governance. It also
  has `USING (true)` on SELECT.

## Recommended order

1. Confirm the live schema read-only (remediation Step 0) — settles the column
   question, the UPDATE predicate, and the corpus size.
2. Decide the owner for the `object_links` boundary fix. It is not a readthrough
   feature; it is a defect in a shipped table, and it should be sequenced as one.
3. Raise `theme_assets` and the 64-table pattern with whoever owns the isolation
   enumeration. Not this lane's to fix, and not this lane's to sit on.
4. Add the unconditional-SELECT check to the backend linter so the class stops growing.
5. Then resume Phases 4–9, jointly with the Desktop Ideas lane on the retrieval seam.

## Files touched

| File | Change |
|---|---|
| `docs/object-links-tenant-audit.md` | **new** — this document |

No source file, migration, policy, script, or configuration was modified. Nothing was
run against production; the two inventory JSONs read are pre-existing local artifacts
produced by the repo's own read-only baseline tool. Nothing merged, nothing deployed.
