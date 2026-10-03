# Decision Flow / Decision Inbox — audit

Read-only audit of the lifecycle from analyst recommendation to outcome.
Branch `feat/decision-flow-audit`, cut from `0d70fdf1` (tagged
`memory-spine-v1-accepted`). No product code, schema, RLS or production data
was changed. Bugs found here are documented, not fixed.

**Evidence convention.** Claims marked **[verified]** I confirmed myself by
reading the cited code or running a read-only production query, both shown.
Claims marked **[reported]** come from subagent traces and carry a line
reference I did not personally open — treat the line number as a pointer, not
as proof.

---

## The worst thing in here, first

**Accepting a recommendation in the Decision Inbox records a completed,
reconciled execution while moving zero shares.** This is not a data artifact;
it is the current code path, and it is provable without running the app.

The chain, every link verified:

1. `acceptFromInboxToAcceptedTrade` (`src/lib/services/accepted-trade-service.ts:675-707`)
   builds its `createAcceptedTrade` payload with `sizing_input` (the raw
   string the PM typed) and **no** `sizing_spec`, `target_weight`,
   `target_shares`, `delta_weight`, `delta_shares`, `notional_value` or
   `price_at_acceptance`. **[verified]**
2. `createAcceptedTrade` (`:142-164`) hard-codes every one of those columns to
   `input.X ?? null`, so the inserted row has null sizing. **[verified]**
3. `finalizeTradeForHoldingsSource` (`:217-281`) reads `holdings_source`. All
   37 production portfolios are `manual_eod` **[verified, query below]**, so
   it always takes the apply branch at `:243`.
4. `applyTradeToHoldings` (`:939-973`) calls the RPC with
   `p_target_shares: null, p_delta_shares: null` and
   `p_price: trade.price_at_acceptance || 0` → `0`. **[verified]**
5. The RPC `apply_trade_to_holdings`
   (`supabase/migrations/20260913120000_apply_trade_to_holdings_rpc.sql`)
   checks for missing share information **first**, at `:91-97`, and
   `RETURN`s `{applied: false}` — *before* reaching the price guard at
   `:113`. **The price guard never fires on this path.** **[verified]**
6. Back in the client, `:989-992` turns `applied === false` into a plain
   return. **No throw.** **[verified]**
7. So `finalizeTradeForHoldingsSource` continues to `:257-270` and
   unconditionally sets `execution_status = 'complete'`,
   `execution_completed_at = now`, `executed_by = actor`,
   `reconciliation_status = 'matched'`, `reconciled_at = now`. **[verified]**

The row now asserts an execution that did not occur and a reconciliation that
was never performed. Worse, `computeReconciliation`
(`src/lib/services/trade-reconciliation-service.ts:217-226`) **skips** trades
where both `target_shares` and `delta_shares` are null — so nothing downstream
will ever revisit the `matched` stamp it did not earn. **[verified]**

Production carries two rows with exactly this signature — unsized, `complete`,
no `portfolio_trade_events` row:

```sql
select a.created_at::date, a.execution_status,
       a.price_at_acceptance, a.target_shares, a.delta_shares,
       exists(select 1 from portfolio_trade_events e
              where e.metadata->>'accepted_trade_id' = a.id::text) as applied
from accepted_trades a where a.source::text='inbox' order by a.created_at;
```

| created | execution_status | price | shares | holdings applied |
|---|---|---|---|---|
| 2026-03-18 | not_started | — | — | no |
| 2026-04-12 | not_started | — | — | no |
| 2026-05-26 | complete | 308.33 | +539 | **yes** |
| 2026-06-02 | **complete** | — | — | **no** ← |
| 2026-06-15 | **complete** | — | — | **no** ← |
| 2026-06-22 | complete | 297.04 | +559 | **yes** |
| 2026-06-26 | complete | 283.78 | +585 | **yes** |
| 2026-09-28 | complete | 338.40 | −248 | **yes** |
| 2026-09-29 | complete | 1065.08 | +245 | **yes** |

### The honest caveat on those five sized rows

Five inbox rows *are* fully sized and *did* move holdings. I could not
reconcile that with the code. `source: 'inbox'` is written in exactly one
place in the entire tree — `accepted-trade-service.ts:680` **[verified by
grep across `src/`]** — and the insert there cannot populate sizing (step 2).
Nothing in `inbox-accept-pipeline.ts` adds sizing **[verified, whole file
read]**, `finalizeTradeForHoldingsSource`'s update does not set sizing columns
**[verified]**, and `trade-reconciliation-service.ts` reads those columns but
never writes them **[verified]**.

Their `portfolio_trade_events` rows carry `source_type = 'holdings_diff'`, not
the `paper_execute` that `emitPaperTradeEvent` would produce, which points
away from the live accept path entirely. **[verified]** Given CLAUDE.md's
standing warning that the demo corpus is largely junk, the most likely
explanation is seeded or hand-written data rather than a second accept path —
but **I could not prove that, and this audit does not claim to have.**

What this means for the conclusion: the subagent claim that "the accept path
never executes anything, on any holdings_source" is **too strong and should
not be repeated.** The defensible finding is narrower and worse-behaved: *the
accept path cannot size a trade, and when it cannot, it marks the trade
executed and reconciled anyway.*

---

## 1. Every path that submits a recommendation

| # | Surface | Writes | Verified |
|---|---|---|---|
| 1 | Recommendation editor modal (`src/components/trading/RecommendationEditorModal.tsx`) | `trade_proposals` + `decision_requests`, with `submission_snapshot.baseline_weight` at `:185` | **[verified]** |
| 2 | Decision Inbox inline submit | `decision_requests` | [reported] |
| 3 | Thoughts → `PendingReviewList` (`src/components/communication/ThoughtsSection.tsx:1029-1062`) | `decision_requests` | [reported] |
| 4 | Trade Lab sim-variant execute (`src/lib/services/execute-sim-variants-service.ts:163-192`, `createSelfProposedAcceptedDR`) | a **self-proposed, pre-accepted** `decision_requests` row | [reported] |
| 5 | Mobile recommendation cards (`src/hooks/mobile/useRecommendationCards.ts`) | `decision_requests` | [reported] |

Path 4 is structurally different and matters for the rest of this audit: it
manufactures a decision request that is *already accepted* so the Trade Lab
execute has a lineage row to point at. It is a decision record created by the
execution, not a decision that preceded one.

Production shape, 113 decision requests **[verified]**:

```
status      n    with baseline_weight   with sizing_weight   with sizing_mode
accepted   54            6                     54                  11
pending    30           14                     29                  27
withdrawn  29            0                     27                  27
```

Note what is absent: **zero** rows in `rejected`, `under_review` or
`needs_discussion`, despite all three being live values in the partial unique
indexes. The states exist in the schema and are unused in practice.

## 2. How the Decision Inbox is populated

The Inbox reads `decision_requests` filtered to the open statuses and buckets
them for display at `DecisionInbox.tsx:414-423` [reported]. Three partial
unique indexes govern what can be in it **[verified]**:

```
idx_decision_requests_active_per_requester
  UNIQUE (trade_queue_item_id, portfolio_id, requested_by)
  WHERE status IN (pending, under_review, needs_discussion)

idx_decision_requests_active_proposal_leg
  UNIQUE (proposal_id, trade_queue_item_id)
  WHERE proposal_id IS NOT NULL AND status IN (...)

idx_trade_proposals_unique_active
  UNIQUE (trade_queue_item_id, user_id, portfolio_id) WHERE is_active = true
```

The first is keyed on `requested_by`. **Two analysts can each raise a live
request on the same idea for the same portfolio** and both appear in the
Inbox, with no relationship drawn between them. That is a real multi-analyst
collision the UI does not represent.

## 3. Acceptance safety

The accept control is a single click with no confirmation step, and Enter
commits the sizing field directly (`DecisionInbox.tsx:1548-1556`, `:2138-2145`)
[reported]. There is a second, independent accept surface in Thoughts
(`ThoughtsSection.tsx:1211-1245`) [reported], and a bulk `Accept all {n}`
(`:1624-1632`) [reported].

Risk classification:

- **LOW — losing the decision record.** `revertAcceptFromInbox`
  (`inbox-accept-pipeline.ts:184-195`) exists, finds the linked trade and
  resets the request to pending. **[verified]** An accidental accept is
  recoverable.
- **MEDIUM — accepting the wrong size.** The sizing field is free text
  committed by Enter, and the baseline it is shown against is often wrong
  (§5). The PM can type `2` meaning +2% and commit an absolute 2%.
- **HIGH — believing a trade happened when it did not.** This is the P0
  above. The Inbox reports success, the Trade Book shows `complete`, and
  holdings are untouched. Nothing in the UI distinguishes this from a real
  execution, and reconciliation will never flag it because it skips unsized
  rows after they have already been stamped `matched`. **[verified]**

The irreversibility hierarchy is upside-down: the cheap-to-reverse thing
(the decision record) has a revert path, and the expensive-to-detect thing
(a false execution claim) has none.

## 4. Analyst recommendation vs PM decision

They are separate rows and the distinction survives: the recommendation lives
in `trade_proposals` / `trade_proposal_versions`, the decision in
`decision_requests.status` plus the resulting `accepted_trades` row.
`acceptFromInboxToAcceptedTrade:710` sets status to
`accepted_with_modification` when the PM's string differs from
`decisionRequest.sizing_weight`, and `accepted` when it matches
**[verified]**.

**The +100bps / +50bps case works at the record level and fails at the
display level.** If the analyst recommends +100bps and the PM accepts +50bps:

- `trade_proposal_versions` still holds the frozen +100bps — Memory Spine V1
  guarantees the recommendation is not rewritten. **[verified from closeout
  doc]**
- `decision_requests.status` becomes `accepted_with_modification`.
  **[verified]**
- `accepted_trades.sizing_input` holds the PM's `+0.5` string, and every
  numeric sizing column is null (the P0). **[verified]**

So the *fact* of a modification is captured, but the executed size is stored
only as an unparsed string. Any surface that wants "analyst said X, PM did Y"
in numbers has to re-parse `sizing_input` at read time.

**12 accepted decision requests have no `accepted_trade_id`** (54 accepted vs
42 with a link) **[verified]**, and 4 `accepted_trades` have no
`decision_request_id` **[verified]**. The link is nullable in both directions
and enforced in neither.

## 5. Decision vs execution — the central question

**The product does not currently distinguish them, and the schema's attempt to
is defeated by the code.**

`accepted_trades` is simultaneously the decision record and the execution
record. One row carries `accepted_by` / `acceptance_note` (decision) and
`execution_status` / `execution_completed_at` / `executed_by` /
`reconciliation_status` (execution). There is no state in which a trade is
decided but not yet executed *by design* — the code reaches for `complete` on
every create for every `manual_eod` portfolio, which is all 37 of them.
**[verified]**

Supporting evidence: **47 of 49 completed trades completed within 5 seconds of
creation** **[verified]**. Decision and execution are the same event in
practice, with a median separation of about one second.

`LifecyclePhase` (`src/lib/trade-book/lifecycle.ts`) derives a display phase so
the UI never shows raw `execution_status` — the right instinct, but it derives
from a field that is set to `complete` without regard to whether anything
happened.

### Sizing visibility — why the PM cannot see what they are deciding

`DecisionInbox.tsx:1776` reads

```ts
const currentWeight = (snapshot?.baseline_weight as number) ?? 0
```

with no fallback **[verified]**. `baseline_weight` is written in exactly one
place, `RecommendationEditorModal.tsx:185` **[verified by grep]**, so every
request raised from any other surface has none. In production only **20 of 113**
requests carry it, and **16 of the 30 currently-pending items render current
weight as 0%** **[verified]**.

A PM looking at a position the portfolio holds at 7% sees `0% → 2%`. The
`+50bps` framing is drawn against a baseline the app made up.

(`:1388` does better — `matched?.baselineWeight ?? snapshot?.baseline_weight ?? 0`
— so two code paths in the same component disagree about where the baseline
comes from. **[verified]**)

## 6. Trade batch formation

**Batches exist and carry almost no grouping.** Of 20 batches that have any
trade attached **[verified]**:

```
trades per batch: 26, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
```

**18 of 20 hold exactly one trade.** 24 batch rows exist; 4 hold nothing.

For the AAPL +50 / NVDA +75 / MSFT −50 / MU −25 sequential-accept case: each
accept calls `createAcceptedTrade` independently with whatever `batch_id` the
caller passes, and the Inbox accept passes none — `batch_id` defaults to null
at `:161` **[verified]**. Four sequential accepts produce four unbatched
trades. The one 26-trade batch is the Trade Lab execute path, which commits a
set in a single action; the 1-trade batches are everything else.

`trade_batches.portfolio_id` is **NOT NULL** **[verified]** — a batch cannot
span portfolios. Any future "accept these four together" feature is therefore
constrained to one portfolio per batch by the schema as it stands, which
happens to agree with the IA conclusion in §11.

Also relevant: `accepted_trades.source` is per-trade and canonical;
`trade_batches.source_type` is a lossy rollup and should not be read in UI.

## 7. Accepted but not executed

This state is reachable but not designed, and it is not surfaced.

Two production rows sit at `not_started` **[verified]** — both unsized, both
from before the current code. The modern way to land here is the swallowed
failure: if `applyTradeToHoldings` *does* throw (a real sizing with a
non-positive price trips the guard at RPC `:113`), the outer `catch` at
`accepted-trade-service.ts:277-280` logs `console.warn` and returns the
un-finalized trade **[verified]**. The row stays `not_started`, the UI reports
no error, and the PM is told the accept succeeded.

So the two ways to end up accepted-but-not-executed are an unsized trade
(silently marked `complete`) and a priced-but-rejected trade (silently left
`not_started`). Neither is visible.

There is a hard constraint worth knowing before building anything here:

```
idx_accepted_trades_unique_open
  UNIQUE (portfolio_id, asset_id)
  WHERE is_active = true AND execution_status <> 'complete'
```

**[verified]** At most one open un-executed trade per portfolio+asset. A PM
who accepts a second recommendation on the same name while the first is still
open gets a database unique violation — not a merge, not a warning, an error
surfacing from the insert. This is the single most important constraint for
§8.

## 8. Execution staging and netting — feasibility

- **AVAILABLE NOW.** Grouping accepted trades by portfolio; showing action,
  `sizing_input`, `acceptance_note`, source, timestamps, batch membership and
  the linked recommendation; `LifecyclePhase` per trade. All of it is on rows
  that already exist.
- **DERIVABLE RELIABLY.** Live current weight and current shares, via the
  batched pattern already used at `src/hooks/mobile/useRecommendationCards.ts:64-99`
  [reported], which is the only place in the tree that fetches live current
  weight correctly. Resulting weight from a sizing string, via
  `normalizeSizing` (`src/lib/trade-lab/normalize-sizing.ts:239`) [reported],
  which is the canonical engine and should be the only one.
- **BLOCKED.** Netting two accepted trades on the same name in the same
  portfolio. `idx_accepted_trades_unique_open` makes the second open trade
  impossible to insert, so there is nothing to net. Netting requires either
  dropping that index or modelling staging as its own table — a schema
  decision, not a UI one.
- **MISLEADING TO SHOW.** Any execution progress, fill state or reconciliation
  status derived from `execution_status` or `reconciliation_status` on the
  current accept path. Both are stamped without evidence (§P0). A staging
  view that showed "executed ✓ / reconciled ✓" today would be repeating a
  claim the system cannot support. Also misleading: `baseline_weight`-derived
  current weight, for the 16-of-30 reason in §5.

## 9. Portfolio impact preview — feasibility

Feasible, with one substitution. Everything needed exists: current holdings
are queryable, `normalizeSizing` converts a sizing string to a target weight,
and the apply RPC already computes `shares_before` / `shares_after`.

The substitution: the preview must read **live current weight** (the
`useRecommendationCards` pattern), not `submission_snapshot.baseline_weight`,
which is absent on 93 of 113 requests. A preview built on the snapshot field
would be wrong more often than right.

What a preview cannot honestly show today: post-trade cash, because cash moves
by `movement × price` inside the RPC and the accept path has no price; and any
"after execution" state, because execution is not a distinct state.

## 10. Bulk accept vs decision session

`Accept all {n}` (`:1624-1632`) and a `Reject all` behind a `prompt()`
(`:1635`) exist today [reported]. Against the P0, bulk accept is the highest-
risk control in the product: it multiplies the false-execution claim by `n`
with one click and no per-item review.

The production shape argues against bulk accept on its own terms. The 30
pending items spread across **18 portfolios**, averaging 1.67 items per
portfolio (max 6) **[verified]**. There is no large homogeneous batch to
accept; there are many small portfolio-scoped decisions. A guided session that
walks portfolio by portfolio fits the data. A single "accept everything"
button fits nothing in the corpus.

## 11. Proposed Decision Inbox information architecture

**The hypothesis holds, but not for the reason the data first suggests.**

Measured shape of the 30 live pending items **[verified]**:

```
distinct portfolios                   18   (avg 1.67/portfolio, max 6)
distinct ideas                        29   (avg 1.03/idea,      max 2)
ideas spanning multiple portfolios     1
```

Grouping by idea — which is what the Inbox does today — is **degenerate**: 29
groups for 30 items means nearly every group has one member. It is grouping
that does no grouping. Portfolio at least compresses 30 items into 18 groups.

But 1.67 items per portfolio is thin too, so the volume argument is weak in
both directions and this corpus is small and partly synthetic. The real
argument for portfolio is structural, and it does not depend on the data:

- A sizing decision is a claim on **one portfolio's** weight budget. Two
  requests on different names in the same portfolio compete; the same name in
  two portfolios does not.
- `trade_batches.portfolio_id` is NOT NULL — the schema already says a batch
  of work is portfolio-scoped. **[verified]**
- `idx_accepted_trades_unique_open` is keyed on `(portfolio_id, asset_id)` —
  the collision the PM needs warning about is portfolio-scoped. **[verified]**
- Current weight, resulting weight, and cash impact are all only meaningful
  relative to a portfolio.

**Recommended IA:** portfolio as the primary grouping; within a portfolio,
one row per decision showing current weight → proposed weight with the delta
named in the units the analyst used; the analyst's recommendation and the PM's
sizing field side by side; and an explicit, separate indication of whether
anything has been executed. Idea becomes a cross-reference on the row, not the
container — it earns a container only for the 1-in-30 case that spans
portfolios.

## 12. Outcomes lineage map

```
trade_queue_items (idea)
  └─ trade_proposals ──── trade_proposal_versions   [immutable, FK, unique(proposal_id, version_number)]
       └─ decision_requests                          [proposal_id nullable]
            ├→ accepted_trades.decision_request_id   [nullable]
            └← decision_requests.accepted_trade_id   [nullable — bidirectional, neither enforced]
                 ├─ trade_batches                    [batch_id nullable; portfolio_id NOT NULL]
                 └─ portfolio_trade_events           [linked_trade_idea_id → trade_queue_items;
                                                      NO FK to accepted_trades — the link to the
                                                      trade lives only in metadata->>'accepted_trade_id']
  └─ trade_events                                    [proposal_version_id → trade_proposal_versions,
                                                      nullable — lineage to the frozen version exists
                                                      at event level]
decision_reviews.decision_id                         [TEXT. NO FOREIGN KEY.]
```

**[all FK/nullability facts verified]**

Two breaks matter:

1. **`decision_reviews.decision_id` is an unconstrained TEXT column.** The
   only FK on the table is `reviewed_by`. Of 7 rows, 1 matches a
   `trade_queue_item` and **0 match a `decision_request`** **[verified]**. The
   Outcomes review surface is writing judgments against identifiers that
   point at nothing. Any attribution built on this table today is attributing
   to a dangling string.
2. **`portfolio_trade_events` has no FK to `accepted_trades`.** The link is a
   JSON key. Every query that joins execution evidence to a trade does so
   through `metadata->>'accepted_trade_id'`, unindexed and untyped — which is
   how an earlier pass of this audit mis-joined through
   `linked_trade_idea_id` and reached a wrong conclusion.

## 13. Severity classification

**P0 — correctness of a claim the user acts on**

1. Inbox accept stamps `execution_status='complete'` and
   `reconciliation_status='matched'` while moving zero shares, because the
   RPC's no-share branch precedes its price guard and the client treats
   `applied:false` as success. §P0, §5.
2. `decision_reviews.decision_id` is unconstrained TEXT, 6 of 7 rows
   dangling. Outcomes attribution is unanchored. §12.

**P1 — the PM is shown something false or decides blind**

3. Current weight renders `0%` for 16 of 30 live pending items; `baseline_weight`
   is written by one surface and absent on 93 of 113 requests. §5.
4. A real sizing with a bad price is refused by the RPC and the throw is
   swallowed at `:277`; the trade silently stays `not_started` and the UI
   reports success. §7.
5. Two code paths in the same component disagree on where the baseline comes
   from (`:1388` vs `:1776`). §5.
6. Bulk `Accept all` multiplies P0-1 by `n`, and `Reject all` is gated by a
   native `prompt()`. §10.

**P2 — structural weakness, not yet wrong**

7. Decision and execution share one row; no designed accepted-not-executed
   state. §5, §7.
8. 18 of 20 batches hold one trade — batching exists without grouping. §6.
9. The decision↔trade link is nullable in both directions; 12 accepted
   requests have no trade, 4 trades have no request. §4.
10. Two analysts can raise competing live requests on the same idea+portfolio
    with no relationship shown. §2.
11. `portfolio_trade_events` → `accepted_trades` is a JSON key, not an FK. §12.

**P3 — cleanup**

12. `rejected`, `under_review`, `needs_discussion` are modelled and unused
    (0 rows each). §1.
13. 4 empty `trade_batches` rows. §6.
14. Executed size is recoverable only by re-parsing `sizing_input` at read
    time. §4.

## 14. Recommended implementation slices

**Slice 1 — stop the false execution claim.** Make the unsized case a visible
failure instead of a silent success. The accept path must either resolve a
price and shares before applying, or leave the trade in a state that says
plainly that nothing was executed. Do not stamp `reconciliation_status` on a
trade reconciliation will skip. This is one service function and one RPC
contract; no UI work is required to make the system stop lying.

**Slice 2 — one source of truth for current weight.** Replace both
`baseline_weight` reads with the live batched read already proven at
`useRecommendationCards.ts:64-99`. Keep `submission_snapshot.baseline_weight`
as *what was true at submission* — which is what it honestly is — and stop
using it as *current*.

**Slice 3 — portfolio-primary Inbox.** Regroup on portfolio per §11, with
current → proposed weight on every row and execution state shown separately
from decision state.

**Slice 4 — anchor the review.** Give `decision_reviews` a real FK to whatever
the product decides a decision *is*, and migrate or retire the 6 dangling
rows. This blocks any honest Outcomes attribution.

Netting and multi-trade staging are deliberately not in this list: both need
the `idx_accepted_trades_unique_open` question answered first, and that is a
schema decision for a separate conversation.

### The exact first slice

**Slice 1.** It is the smallest change, it needs no design input, and every
other slice builds on a system whose execution state means something. Shipping
Slice 3 first would make a prettier Inbox that reports the same false
completions more legibly.

## 15. Memory Spine invariants — none of the above disturbs them

The ten frozen V1 guarantees (`docs/memory-spine-v1-closeout.md`) survive
every slice above, and the reasons are structural rather than careful:

- **Append-only lifecycle events.** Slices 1–4 change what is written to
  `accepted_trades` and read in the UI; `recordExecutionRecorded` is still
  called at the single convergence point (`:189-200`), still after
  finalization, still idempotent through row-derived dedupe keys.
  **[verified]**
- **Immutable submitted recommendations.** No slice writes
  `trade_proposal_versions`. Slice 2 explicitly *preserves*
  `submission_snapshot` as the submission-time truth rather than overwriting
  it — which strengthens the guarantee.
- **Durable obligations, raised by explicit action only; due ≠ satisfied.**
  No slice touches `memory_obligations` or its SECURITY DEFINER RPCs.
- **`waiting_for` immutable, superseding rather than editing.** Untouched.
- **Deterministic due resurfacing; one suppression predicate.** Untouched.
- **Six grounded fact types.** Untouched. Note Slice 1 makes the
  `trade_committed` fact *more* truthful, since today it can fire for a trade
  that moved nothing.
- **`READY_TO_REVISIT` on the existing contract.** Untouched.
- **Direct return to work via `openIdeaDetail`.** Untouched.
- **Desktop/mobile parity.** Slice 3 is an Inbox IA change and must land on
  both shells to hold this; it is the only slice with a parity obligation.
- **"The Spine connects existing truth; it does not duplicate and compete with
  it,"** and its corollary that memory must never imply we know *why* when we
  only know *what*. Slice 4 is the one to watch: giving `decision_reviews` a
  real anchor is connecting truth, but inventing a decision for the 6 dangling
  rows to point at would violate both. They should be migrated only where a
  real referent exists, and retired where it does not.

The one genuine tension: §P0 means `execution.recorded` events have been
written for trades that did not execute. Those events are append-only and
must not be rewritten. The correct handling is to fix the path forward
(Slice 1) and leave the history as it is, consistent with V1's own decision
not to backfill — of 203 reconstructable events only 57 would have been true.

---

## Scope confirmation

Read code, inspected schema, ran read-only `SELECT`s against production, read
migrations. No writes to `src/`, `supabase/`, migrations, tests, schema, RLS or
production data. Nothing pushed, no PR, no merge, no deploy. The only file
added is this one.
