# Trade Idea Audit

**Branch:** `audit/trade-idea` · **Worktree:** `C:\dev\tesseract-trade-idea` · **Base:** `origin/main` @ `12c6225`
**Date:** 2026-08-29
**Status:** Read-only audit. No application code, SQL, or production state was changed.

## How to read this document

Every claim is labelled:

| Label | Meaning |
|---|---|
| **[PROVEN]** | Observed directly in the code or migrations in this worktree, with a file reference. |
| **[DEFECT]** | A proven behaviour that is wrong, dead, or misleading. |
| **[PROPOSED]** | A design recommendation. Not built. Not agreed. |
| **[DEFERRED]** | A decision deliberately not taken here. Belongs to another owner or another phase. |
| **[UNVERIFIED]** | Could not be confirmed from this worktree. Requires a live check against staging. |

Line references were valid at `12c6225` and will drift. Prefer the symbol name over the number.

---

## 1. Executive Summary

**The core conclusion.** Trade Idea currently conflates three things that are not the same and do not share an owner:

1. **An investment proposal** — a person's staked view, stored in `trade_queue_items`.
2. **A reader judgment** — a colleague's reaction to that view, stored in `localStorage` dispositions and `audit_events`.
3. **Formal portfolio decision authority** — commitment of a trade, which lives in `decision_requests` → `accepted_trades` and touches neither of the above.

**[PROVEN]** These are three separate object graphs. The mobile Trade Idea card reads (1), writes (2), and has no connection to (3).

**The question the redesigned card must answer:**

> "Someone has staked an investment view. What judgment is required from me?"

**The rule that follows from the authority audit (§6):**

> Formal approval remains **outside** the card unless and until a `decision_request` exists.

There is no truthful "Approve this Trade Idea" action available to the mobile card today, because the only authorised commitment path operates on a different row that a Trade Idea does not have until someone deliberately raises one.

**Three defects worth attention independently of the redesign** (see §7):

- The `recommendation` card — the one card type in the product with a truthful Approve/Decline — has never rendered, because its status filter names three values that are not members of the `trade_queue_status` enum.
- Pair-trade judgments buy no quiet at all, and are filed in the durable audit log against one leg's asset.
- The PM gate on portfolio decisions is enforced in the client only.

---

## 2. Current Architecture

### 2.1 The Trade Idea path

**[PROVEN]**

```
CREATE                          STORE                     FEED                      BUILDER                  JUDGMENT
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
QuickTradeIdeaCapture ──┐
AddTradeIdeaModal ──────┼──►  trade_queue_items  ──►  useIdeasFeed  ──►  buildIdeaCard  ──►  VerdictBar
PromoteToTradeIdeaModal ┘     (+ pair_trades)         OPEN_PROPOSAL_        (ideas.ts)             │
                                                       STATUSES                                    │
                                                                                                   ▼
                                                                                         recordSignalJudgment
                                                                                         ├─ localStorage disposition
                                                                                         ├─ audit_events row
                                                                                         └─ private quick_thought
```

**Mobile render chain**

| Step | File |
|---|---|
| Feed query | `src/hooks/ideas/useIdeasFeed.ts` |
| Card construction | `src/lib/signals/builders/ideas.ts` → `buildIdeaCard` |
| Call site | `src/components/mobile/MobileDashboard.tsx:4070` (idea branch, ~4050–4260) |
| Card wrapper | `src/components/mobile/SignalCardSection.tsx` |
| Card renderer | `src/components/signals/SignalCardView.tsx` |
| Pane pager | `src/components/signals/CardCarousel.tsx` |
| Response control | `src/components/signals/VerdictBar.tsx` |
| Response persistence | `src/lib/signals/judgment-log.ts`, `dispositions.ts`, `judgment-thought.ts` |
| Resurfacing policy | `src/lib/signals/judgment-policy.ts`, `feed-priority.ts` |

**Desktop render chain**

| Step | File |
|---|---|
| Page | `src/pages/IdeaGeneratorPage.tsx` → `IdeasFeedPage` |
| Card | `src/components/ideas/feed/FeedCard.tsx` (`TradeIdeaFeedCard` variant) |

**[PROVEN] Legacy / dead on the primary path:** `src/components/ideas/MasonryGrid.tsx`, `src/components/ideas/cards/TradeIdeaCard.tsx`, `src/components/ideas/cards/PairTradeCard.tsx`. Reachable only through the preserved-for-rollback block in `IdeaGeneratorPage.tsx` (below the `LEGACY IDEA GENERATOR` banner). `src/components/mobile/MobileFeedActionRail.tsx` is defined and never imported.

### 2.2 The decision authority path — a different object graph

**[PROVEN]**

```
trade_queue_items ──► decision_requests ──► acceptFromInbox ──► accepted_trades
  (the proposal)       (the ask, per          (the commit)       (the Trade Book)
                        portfolio)
```

| Object | Table | Written by |
|---|---|---|
| Proposal | `trade_queue_items` | `QuickTradeIdeaCapture`, `createTradeIdea`, `createPairTrade` |
| Ask | `decision_requests` (`status: pending / accepted / rejected / deferred / withdrawn`) | `createDecisionRequest` (`src/lib/services/decision-request-service.ts`) |
| Commit | `accepted_trades` | `acceptFromInbox` (`src/lib/services/inbox-accept-pipeline.ts`) |
| Surface | — | `src/components/trading/DecisionInbox.tsx` (desktop only) |

**Make this explicit:** nothing in the Trade Idea card path — not `buildIdeaCard`, not `VerdictBar`, not `recordSignalJudgment` — reads or writes `decision_requests` or `accepted_trades`. A Trade Idea is not a decision request. A judgment on a Trade Idea card is not a decision.

**[PROVEN]** Consistent with existing project memory: `accepted_trades` is the only committed trade.

### 2.3 What the feed considers an idea

**[PROVEN]** `src/lib/ideas/open-proposal.ts`

- `OPEN_PROPOSAL_STATUSES = ['idea', 'discussing', 'simulating', 'deciding', 'approved']`
- The `trade_queue_status` enum has exactly ten labels: `idea, discussing, approved, rejected, executed, cancelled, deleted, deciding, simulating, archived`. `working_on` and `modeling` are members of the hand-written TypeScript union and **do not exist in the database**.
- `PROPOSAL_DAYS_BACK = 365`. Proposals are bounded by status, not by the feed's rolling time window.
- A pair is open when **any** leg is open (`pairIsOpen`).
- `PAIRS_PER_PAGE = 3`, `MAX_LEGS_PER_PAIR = 6` (widest in production: 4).

`open-proposal.ts` documents at length that PostgREST rejects an entire `in.(...)` list when one member is not a valid enum label, that the caller destructures `const { data }` without checking `error`, and that this silently returned zero rows. **The same failure exists in a second file — see §7.1.**

---

## 3. Available Data

### 3.1 Field audit — `trade_queue_items`

**[PROVEN]** Schema from `src/types/trading.ts:283`. Fetch shape from `src/hooks/ideas/useIdeasFeed.ts`.

| Column | Exists | Fetched by `useIdeasFeed` | Rendered on the mobile card |
|---|---|---|---|
| `action` | yes | yes | yes (headline verb) |
| `rationale` | yes | yes | yes (body) |
| `urgency` | yes | yes | yes (context chip, if not `low`) |
| `status` | yes | yes | no |
| `stage` | yes | **no** | no |
| `asset_id` → `symbol`, `company_name`, `current_price` | yes | yes | symbol + company only |
| `portfolio_id` → `name` | yes | yes | yes (context chip) |
| `pair_id`, `pair_trade_id`, `pair_leg_type` | yes | yes | yes (leg grouping) |
| `sharing_visibility` | yes | yes | no |
| **`target_price`** | yes | **no** | **no** |
| **`conviction`** (`low / medium / high`) | yes | **no** | **no** |
| **`time_horizon`** (`short / medium / long`) | yes | **no** | **no** |
| **`thesis_text`** | yes | **no** | **no** |
| **`proposed_weight`** | yes | **no** | **no** |
| **`proposed_shares`** | yes | **no** | **no** |
| **`stop_loss`** | yes | **no** | **no** |
| **`take_profit`** | yes | **no** | **no** |
| **`expected_position_size`**, **`max_position_size`** | yes | **no** | **no** |
| **`assigned_to`**, **`collaborators`** | yes | **no** | **no** |
| **`decision_outcome`**, `decision_reason`, `decided_by`, `decided_at` | yes | **no** | **no** |
| `approved_by`, `approved_at`, `executed_at` (legacy) | yes | no | no |
| `research_depth`, `catalyst_clarity` (1–5) | yes | no | no |
| `context_tags` | yes | no | no |
| `origin_type` / `origin_entity_*` / `origin_route` / `origin_metadata` | yes | no | no |

### 3.2 The conclusion that matters

**[PROVEN]** Every field that would make a Trade Idea card an *investment claim* rather than a *note* — target, conviction, horizon, intended size — **exists in the table and is not fetched.**

**Target, conviction and horizon are a QUERY-SHAPE problem, not a schema problem.** No migration is required to put any of them on the card.

**[PROVEN] Evidence that the data is real and already used elsewhere on mobile:**

- `src/hooks/usePipelineItems.ts` selects `*` under query key `['trade-queue-items', currentOrgId]`.
- `src/components/mobile/MobilePipeline.tsx:476,486` renders `target_price`.
- `src/components/mobile/asset/MobileAssetPage.tsx:248–258` renders `target_price`.

A Trade Idea card could read these from the existing `usePipelineItems` cache without issuing a new query.

### 3.3 Price data

**[PROVEN]**

| Fact | Source |
|---|---|
| Daily closes live in `price_history_cache`, ~260 points per symbol | `src/hooks/mobile/useSymbolHistory.ts` (`MAX_POINTS = 260`) |
| One request per symbol, 1 hour `staleTime`; the table is not org-scoped | same |
| Renamed tickers resolve through `useTickerAliases` / `tradedSymbol` — the single door to the cache | same |
| **Only 135 of 912 assets have any cached history** | `src/components/signals/PricePane.tsx` header |
| A chart needs at least 2 points (`MIN_POINTS_FOR_CHART`) | `src/lib/signals/price-availability.ts` |
| `assets.current_price` is a DB-cached mark, **not** a live quote | `supabase/migrations/20260313172549_add_decision_price_snapshots.sql` |
| The last close wins; a holdings mark is the fallback and must never be labelled "current" | `src/lib/signals/price-snapshot.ts` |

**[PROVEN] There is no stored inception price for an idea.** `decision_price_snapshots` records `snapshot_type IN ('approval','rejection','cancellation')` only — nothing at creation.

---

## 4. Creation-Path Inconsistencies

**[PROVEN]** Three writers produce three different rows.

### 4.1 `QuickTradeIdeaCapture` — mobile `FeedCaptureSheet` and desktop quick capture

`src/components/thoughts/QuickTradeIdeaCapture.tsx:687–755`

Writes: `created_by`, `portfolio_id` (first selected, or null), `asset_id`, `action`, `urgency`, `rationale`, `stage:'idea'`, `status:'idea'`, `pair_id`, `sharing_visibility`, provenance fields, `context_tags`.

- **[DEFECT] `urgency` is hardcoded** — `const urgency = 'medium' as const` (line 204). It is never offered to the author.
- **[DEFECT] Pairs get no parent row.** A client-side `crypto.randomUUID()` is written to `pair_id`. No `pair_trades` row is created, and `pair_leg_type` is not set.
- **[DEFECT] Rationale is duplicated onto every leg**, because there is nowhere pair-level to put it.
- **[PROVEN]** Writes `stage: 'idea'`.
- **[PROVEN, positive]** Carries a thorough duplicate-detection pass (per-leg and per-pair, lines ~497–610) that neither the feed nor the card knows anything about.

### 4.2 `AddTradeIdeaModal` — desktop full builder

`src/components/trading/AddTradeIdeaModal.tsx:640–695` → `createTradeIdea` / `createPairTrade` (`src/lib/services/trade-idea-service.ts`)

Writes: `target_price`, `proposed_weight`, `proposed_shares`, `assigned_to`, `urgency`, `rationale`, `sharing_visibility`, provenance, `context_tags`.

- **[DEFECT] Dead inputs.** `conviction`, `timeHorizon` and `stopLoss` are held in component state (lines 140–147) and rendered as controls (lines ~1922–2008), but the `createTradeAsync` payload never includes them, and `CreateTradeParams` has no such fields. **The author's conviction, horizon and stop are collected and discarded.**
- **[PROVEN] Pairs get a real parent.** `createPairTrade` inserts a `pair_trades` row with `name` / `description` / `rationale`, then legs carrying `pair_trade_id` **and** `pair_leg_type`, with leg `rationale: ''`.
- **[DEFECT] Stage mismatch.** `createTradeIdea` writes `stage: 'aware'` where `QuickTradeIdeaCapture` writes `stage: 'idea'`. Both write `status: 'idea'`.

### 4.3 `PromoteToTradeIdeaModal`

`src/components/ideas/PromoteToTradeIdeaModal.tsx` / `src/hooks/usePromoteToTradeIdea.ts` — converts a `quick_thought` into a `trade_queue_items` row.

### 4.4 Consequence

**[PROVEN]** The feed's pair reader must tolerate both shapes: it groups on `pair_trade_id || pair_id` and resolves the side with `pair_leg_type ?? action` (`useIdeasFeed.ts`, `isLong`). Pair-level thesis (`pair_trades.rationale` / `.thesis_summary`) exists **only** for path 4.2; for path 4.1 the feed falls back to the first leg's rationale.

**[PROVEN]** `organization_id` is not written by any client path. A `BEFORE INSERT` trigger populates it (`supabase/migrations/20260603020000_trade_queue_items_organization_id.sql`) from the portfolio's org, else from `users.current_organization_id`.

---

## 5. Current Mobile Card Problems

### 5.1 Anatomy as built

**[PROVEN]** From `buildIdeaCard` (`src/lib/signals/builders/ideas.ts`) and `SignalCardView`:

```
┌──────────────────────────────────────────────┐
│ ● [Trade idea]  desk / violet skin      ⋯    │  severity: attention (amber dot)
│                                              │
│ "Priya Raman wants to sell MSFT in Core      │  headline: who + verb + symbol + book
│  Equity"                                     │
│                                              │
│      (metric: null — no number at all)       │  <- loudest slot on the card, empty
│                                              │
│  body: rationale, clamped to 2 lines         │
│                                              │
│  [Priya Raman] [Core Equity] [high urgency]  │  context chips, max 3
│                                              │
│  ┌── CardCarousel ─────────────────────────┐ │
│  │  Price · (Post) · [Respond — filtered]  │ │  verdict pane removed until engaged
│  └─────────────────────────────────────────┘ │
│                                              │
│  [ Note ]        [   Open idea   ]           │  quick + primary
└──────────────────────────────────────────────┘
```

Registry declaration — `src/lib/signals/content-registry.ts:172`:

| Type | `judgment` | `assetLinked` | `fullscreenChart` | `manipulationSurface` | `portfolioContext` |
|---|---|---|---|---|---|
| `trade_idea` | `on_engage` | true | true | `none` | true |
| `pair_trade` | `on_engage` | **false** | **false** | `none` | true |

### 5.2 Defects

**[DEFECT] 5.2.1 — `metric` is null although target data exists.**
`ideas.ts` sets `metric: null`, reasoning that "a thought has no number, and inventing one would put a figure in the loudest slot nobody asked for". Correct for a `quick_thought`, wrong for a `trade_idea`: there *is* a number — `target_price` and the upside it implies — and it is simply not fetched (§3).

**[DEFECT] 5.2.2 — no explicit `prompt`.**
`buildIdeaCard` never sets `SignalCard.prompt`. `SignalCardView` uses the presence of `prompt` to choose the engagement label (`card.prompt ? 'Your view' : 'Review'`). So the card carrying a colleague's staked view offers a button labelled **"Review"** and never states the question it is asking.

**[DEFECT] 5.2.3 — the response is hidden.**
`content-registry` declares `trade_idea: judgment: 'on_engage'`. `SignalCardView` (`judgmentPane`, line ~329, and the `visiblePanes` filter below it) **removes the verdict pane from the carousel** for anything not `inline`, and offers it only behind the engagement affordance. The one control that records a judgment is two taps away, behind a button that does not say what it is for.

**[DEFECT] 5.2.4 — the primary action is dead on `main`.**
`ideas.ts:216` declares `{ id: 'primary', label: 'Open idea', inline: false }` for trade kinds. `'primary'` is not a `FeedActionKey`, so `resolveFeedAction` returns `null`, `SignalCardSection` falls through to `onPrimary`, and `MobileDashboard.tsx:4261` hits `default: note('open')` — a `recordInterest` telemetry write. **Nothing opens.** `feed-actions.ts` exists precisely to prevent this, and `feedActionIsRoutable('primary', …)` is false — the builder never asked.

**[PROVEN] 5.2.5 — the mobile quality branch already fixes 5.2.4.**
`feat/mobile-ideas-quality` commit `cea45c8` ("Mobile Ideas: no button in the feed lies about what it does") replaces the primary with `{ id: 'capture', label: 'Capture' }` and empties `quick[]`. **Do not re-fix this. See §11.**

**[DEFECT] 5.2.6 — ranking and rendering disagree about severity.**
`buildIdeaCard` emits `severity: 'attention'` for `trade_idea` and `pair_trade`. The ranker's idea branch (`MobileDashboard.tsx:1523`, `severity` at 1545) passes `'informational'` for every post kind. A trade idea renders as an attention card and ranks as an informational one.

**[DEFECT] 5.2.7 — desktop cannot reach the idea from the feed.**
`IdeasFeedPage.tsx:191` routes a `trade_idea` click to the **asset page** (`defaultTab: 'trade-queue'`), not to the idea. A `pair_trade` falls to the generic asset branch and lands on the first long leg's asset page.

**[DEFECT] 5.2.8 — desktop has no pair variant.**
`FeedCard.tsx` `selectVariant` has no `pair_trade` case. A pair carrying an asset (which `useIdeasFeed` sets to the first long leg) resolves to `chart_post`, so **the desktop pair card shows one leg and one chart.** This is the direct desktop manifestation of the reported concern that pair trades show only one leg.

---

## 6. Authority Semantics

Four mechanisms exist. They are not equivalent. Two of them lie.

### A. Canonical commitment — `decision_requests` → `accepted_trades`

**[PROVEN]**

- `decision_requests` created by `createDecisionRequest`; `CHECK` constraint on `status IN ('pending','accepted','rejected','deferred','withdrawn')`; partial unique index enforcing one pending request per requester per item+portfolio (`supabase/migrations/20260203004535_create_trade_lab_proposal_system.sql`).
- Accepted by `acceptFromInbox` (`src/lib/services/inbox-accept-pipeline.ts`), which creates an `accepted_trades` row.
- Surface: `src/components/trading/DecisionInbox.tsx` — **desktop only**. No mobile surface reads or writes `decision_requests`.
- RLS on `accepted_trades` INSERT/UPDATE/DELETE: `user_is_portfolio_member(portfolio_id) OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())` (`supabase/migrations/20260426030000_org_admin_decision_authority.sql`).

**This is the only path that commits a trade.**

### B. Portfolio-scoped decision — `setDecisionOutcome`

**[PROVEN]** `src/lib/services/trade-idea-service.ts:1823`

- Checks `is_portfolio_pm(portfolio_id, actorId)` **OR** `trade.created_by === actorId`.
- Writes `decision_outcome`, `decision_reason`, `decided_by`, `decided_at`, plus the legacy `outcome` fields.
- Emits an audit event (`decision_accepted` / `decision_deferred` / `decision_rejected`).
- `is_portfolio_pm` is defined in `supabase/migrations/20260314000004_fix_is_portfolio_pm_function.sql` and resolves PM from **`portfolio_memberships.is_portfolio_manager`**.

### C. Client-only PM checks

**[DEFECT]** `src/lib/permissions/trade-idea-permissions.ts`

- `getUserPortfolioRole` resolves PM from **`portfolio_team.role === 'Portfolio Manager'`**.
- The RPC in (B) resolves PM from **`portfolio_memberships.is_portfolio_manager`**. **Two different tables answer "is this person a PM."**
- The RLS policy `"Trade idea portfolios: team or org admin update"` (`20260426030000`) gates on **membership in `portfolio_team`, not on PM role**:

  ```sql
  USING (
    portfolio_id IN (SELECT pt.portfolio_id FROM portfolio_team pt WHERE pt.user_id = auth.uid())
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  )
  ```

  **Any portfolio team member can write a `decision_outcome` at the database layer. The PM restriction exists in the client only.**

**[UNVERIFIED]** `canUserMoveStage` (`trade-idea-service.ts:342`) calls an RPC `can_modify_trade_stage` that **has no defining migration in this repo**. It may exist in production (schema drift is a known condition of this project) and must be confirmed against staging before anything relies on it.

**[UNVERIFIED]** No `INSERT` or `UPDATE` policy for `trade_queue_items` appears in any migration — only `SELECT` policies. Whatever governs writes was applied outside the migration ledger.

### D. Legacy, unauthorised, non-committing — `useAttention`

**[DEFECT]** `src/hooks/useAttention.ts:1608` (`approveTradeIdeaMutation`), `:1632` (`rejectTradeIdeaMutation`)

```ts
await supabase.from('trade_queue_items')
  .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
  .eq('id', tradeId)
```

- **No PM check. No service function. No audit event. No `accepted_trade`.**
- Writes the fields `src/types/trading.ts:331` labels *"Legacy approval fields (kept for backwards compat)"*.
- Called by three desktop surfaces.

**An "approval" through this path does not commit anything to the Trade Book.**

### E. Vestigial

**[PROVEN]** `trade_queue_votes` is read by `useAttention.ts`, `usePipelineItems.ts` and `supabase/functions/attention/index.ts`, and **written by nothing in `src/`**. Vote summaries computed from it are always zero.

### Conclusion

> **There is currently no proven truthful concept of "Approve this Trade Idea" on the mobile Trade Idea card.**

The only authorised commitment (A) operates on a `decision_request`, which a Trade Idea does not have until someone deliberately raises one. (B) is real but portfolio-scoped, desktop-only, and its PM check disagrees with the RLS beneath it. (C) is advisory. (D) is a lie about commitment.

**The decision not to reintroduce formal approval actions on the card is correct and stands.**

---

## 7. Known Broken / Misleading Paths

### 7.1 The recommendation card has never rendered

**[DEFECT]** `src/hooks/mobile/useRecommendationCards.ts:51`

```ts
.in('status', ['pending', 'proposed', 'awaiting_review'])
```

None of those three are members of the `trade_queue_status` enum (ten labels, listed in §2.3; no migration adds a value to it). PostgREST rejects the entire `in.()` list; the error is destructured away (`const { data: rows }`); `rows` is `undefined`; the hook returns `[]`.

`recommendationBySource` (`MobileDashboard.tsx:1188`) is therefore always empty, the recommendation branch never matches, and attention items fall through to `buildAttentionCard`.

**This is the same bug class documented at length in `src/lib/ideas/open-proposal.ts`, occurring in a second file.** The one card type in the product with a truthful Approve/Decline has been dark.

### 7.2 Pair judgment keys are unclassified

**[DEFECT]** `MobileDashboard.tsx:4172` writes four judgment keys: `back_pair`, `pair_sizing`, `pair_one_leg`, `pair_no`.

None appear in `POLICY` in `src/lib/signals/judgment-policy.ts`. `policyForJudgment` returns `UNKNOWN` → `quietDays: 0`, `penalty: 0`. `feed-priority.ts` reads the policy, not the disposition window.

**Answering a pair trade buys nothing. The card returns to the same position on the next feed load.**

**[DEFECT]** The header of `judgment-policy.ts` states: *"`judgment-policy.test.ts` asserts that every key the app writes appears here, so adding an option to a card without deciding what it means fails a test rather than degrading quietly."* **That test file does not exist.** The guard that would have caught this was never written.

### 7.3 Pair judgments are filed against one leg

**[DEFECT]**

- `dispositionEntityFor` correctly keys a `desk`-surface card on the **card id**, so *local* suppression is right.
- `judgment-log.ts` `isDurableEntity` writes the durable `audit_events` row against `card.entity`, which for a pair is the **first long leg's asset** (`useIdeasFeed.ts:630` sets `asset: pairLegs.find(isLong)?.assets`). So "I would put this pair on" is recorded in the audit log as a judgment about one leg.
- `judgment-thought.ts` `assetIdOf` files the private note against the same single leg.

### 7.4 Dead inputs in `AddTradeIdeaModal`

**[DEFECT]** See §4.2. `conviction`, `timeHorizon`, `stopLoss` are collected and discarded.

### 7.5 Full action audit

**[PROVEN]** State at `main` @ `12c6225`.

| Label | Handler | Persisted effect | Authority required | Truthful? |
|---|---|---|---|---|
| **"Open idea"** (mobile primary, `trade_idea` / `pair_trade`) | `MobileDashboard.tsx:4261` `default: note('open')` | `recordInterest` telemetry only | none | **No — dead.** Fixed on `feat/mobile-ideas-quality`. |
| "Note" (mobile quick, id `capture`) | `onCapture` → `FeedCaptureSheet` | writes a `quick_thought` | none | Yes |
| "Ask about this" | `setAskItem` → `PromptModal` | writes a prompt | none | Yes |
| "Share with someone" | `setShareItem` → `ShareToUserModal` | share record | none | Yes |
| "Promote to trade idea" | `setPromoteItem` | creates a `trade_queue_items` row | none | Yes (offered only on `quick_thought`) |
| "See what this refers to" | `setReadthroughFor` | none (read) | none | Yes |
| "Snooze for a week" / "Dismiss" | `triageCard` | `feed_snoozed` (7d) / `feed_dismissed` (30d) disposition | none | Yes |
| Verdict **Agree / Questions / Not convinced** (single name) | `applyVerdict` | disposition + `audit_events` + private thought | none | Yes — keys are classified (`agree` confirmed/14d; `questions`, `disagree` needs_review/3d) |
| Verdict **Back it / Right idea wrong size / Only one leg / Not convinced** (pair) | `applyVerdict` | disposition + `audit_events` + private thought | none | **Partly — §7.2, §7.3** |
| **"Approve"** (`recommendation` card primary, id `approve`) | `MobileDashboard.tsx:3044` `onPrimary` → `markRead` + navigate | attention row marked read | *implies* PM | **No** |
| **"Decline"** (`recommendation` card quick, id `reject`) | same handler; the action id is ignored | identical to Approve | *implies* PM | **No — Approve and Decline are the same button.** Fixed on `feat/mobile-ideas-quality`. |
| Desktop card click (`trade_idea`) | `IdeasFeedPage.tsx:191` | navigates to the asset page | none | Misleading — the idea is unreachable from the feed |
| `AddTradeIdeaModal` conviction / horizon / stop-loss | none | **discarded** | none | **No — dead inputs** |
| `note('reaction')` telemetry signal | declared at `MobileDashboard.tsx:4052` | — | — | Unreachable; nothing calls it |

---

## 8. Proposed Single-Name Card

**[PROPOSED]** Not built. Six lines, one number, one question.

```
┌───────────────────────────────────────────────────┐
│ ● Trade idea · desk                          ⋯    │
│                                                   │
│ Priya wants to buy COIN for Core Equity           │  headline: who + action + asset + portfolio
│                                                   │
│      +34%          to $310 · 12 mo                │  METRIC: upside to target
│      Upside to Priya's target                     │  source:'stated', asOf: created_at
│                                                   │  sub-line: target + horizon
│ $231.40 last close (28 Aug)                       │  body 1 — canonical price context
│ The re-rate hasn't happened and the take-rate     │  body 2 — originator rationale, clamped
│ floor is now visible in the Q2 print.             │
│                                                   │
│ [Priya Raman] [Core Equity] [High conviction]     │  context: author / portfolio / conviction
│                                                   │
│ Would you put this on?                            │  PROMPT — the missing field
│                                                   │
│ ┌ Price │ The case │ Respond ─────────────────┐   │  panes; Respond present from frame 1
│ │  chart with target band + inception marker  │   │
│ └─────────────────────────────────────────────┘   │
│                                                   │
│ [ Actions ]      [   I'd back it   ]              │
└───────────────────────────────────────────────────┘
```

### Rules this anatomy must respect

1. **Metric = upside to target.** `source: 'stated'`, `asOf: created_at`. Computed through `deviationFrom` in `price-snapshot.ts` so no second arithmetic can appear. **Suppress with `missing_number` when `target_price` is null** — that keeps `metric: null` honest for ideas that genuinely have no target, and stops the card claiming a number it does not have.
2. **Price context is canonical only.** Last close via `PricePane` / `useSymbolHistory`. Never `assets.current_price` presented as "current", never a holdings mark.
3. **`prompt` is set.** "Would you put this on?" This is what fixes §5.2.2 and §5.2.3 without moving the response bar: `SignalCardView` renders `prompt` above the fold and switches the affordance label from "Review" to "Your view".
4. **Target and idea date go on the chart, not into prose.** `PricePane` already accepts `bands` and `markers` (`MobileDashboard.tsx:2391`). No new chart component is needed for the single-name card.
5. **Conviction is a chip, not a number.** `low / medium / high` is an enum; rendering it as a metric would be false precision.
6. **No formal approval language anywhere on the card.** Not in the primary, not in the quick action, not in the menu, not in the verdict labels.

### Deliberately NOT on the card

`proposed_weight`, `stop_loss`, `take_profit`, `research_depth`, `catalyst_clarity`, `stage`, `sharing_visibility`, reaction counts. Weight belongs to the recommendation card; the rest belongs to the idea detail surface.

---

## 9. Proposed Judgment Vocabulary

**[PROPOSED]** Four keys. They map onto the categories `judgment-policy.ts` already defines, so nothing new is invented in the policy layer.

| Intent | Key | Label | Category | Quiet | Penalty | Consequence |
|---|---|---|---|---|---|---|
| Expressing interest | `idea_back` | "I'd back it" | `confirmed` | 14d | 0.5 | Disposition + `audit_events` + private note. **Nothing else.** |
| Not for me | `idea_pass` | "Not for me" | `not_applicable` (`resolves: false`) | 30d | 0.8 | Same; stops asking this reader without closing the idea |
| Requesting more work | `idea_needs_work` | "Needs more work" | `action_needed` | 7d | 0.35 | Same, plus `nextAction: update_thesis` routed via `resolveFeedAction` |
| Discussing | `idea_discuss` | "Let's discuss" | `needs_review` | 3d | 0.2 | Same, plus opens `PromptModal` seeded with the note (the existing `ask` path) |

Quiet periods and penalties above follow the existing bands in `POLICY` for their category. They are product hypotheses, not tuned parameters — the same caveat `judgment-policy.ts` already carries.

### The distinction that must not be lost

> **"I'd back it" is a personal judgment. It is NOT portfolio authorization.**

It records that a colleague would support the trade. It does not create a `decision_request`, does not create an `accepted_trade`, does not set `decision_outcome`, and does not change any position. The label, the `note` text and the `consequence` string must all say so.

### Acknowledging / reviewing

**[PROPOSED]** Do **not** add a "Seen" or "Acknowledge" button. Engaging the card already records `recordInterest`, and a button whose only effect is telemetry is the class of control §7.5 exists to eliminate.

### Required to make any of this truthful

1. Add all four new keys **and the four existing pair keys** to `POLICY` in `judgment-policy.ts`.
2. Write the `judgment-policy.test.ts` the module's own header already claims exists, asserting every key written by the app is classified. This is the guard that would have caught §7.2.
3. Populate `VerdictOption.consequence` per option — four options leading to four different places is exactly the case that field was added for.

---

## 10. Pair Trade

### 10.1 What data exists

**[PROVEN]**

| Needed | Available? | Where |
|---|---|---|
| Long leg(s) | **yes** | `useIdeasFeed.ts:630` `long_legs[]` — id, action, asset (id/symbol/company_name/current_price) |
| Short leg(s) | **yes** | `short_legs[]`; side resolved by `pair_leg_type ?? action` |
| Both legs' daily closes | **conditional** | `useSymbolHistory`, ~260 points — but only ~135 of 912 assets are cached. A spread needs **both** legs cached. |
| Pair-level thesis | **partial** | `pair_trades.rationale` / `.thesis_summary` — **only for pairs created via `createPairTrade`** (§4.2). Quick-capture pairs have no parent row; the feed falls back to the first leg's rationale. |
| Per-leg target / intended size | **columns exist, not fetched** | `target_price`, `proposed_weight`, `proposed_shares` |
| **Idea inception reference price** | **absent** | `decision_price_snapshots` fires only at approval / rejection / cancellation |

### 10.2 Verdict

**[PROVEN]** A spread / ratio chart is buildable, with two hard conditions and one honest gap.

- **Ratio / normalized performance: yes.** Both legs' close series come from the same cache in the same shape (`PricePoint[]`), fetched independently. Indexing both to 100 at a common start date and drawing `long/short` is client-side arithmetic over data already in hand.
- **Return since inception: derived only.** There is no stored inception price, so the reference must be *the close on or nearest after `created_at`, taken from the same series*, and it must be **labelled as that** ("indexed to 6 Mar close") — never as "entry".
- **[DEFECT-adjacent constraint]** `PROPOSAL_DAYS_BACK = 365` and the cache holds ~260 trading days, so ideas at the far edge of the feed window will have a creation date **before** their cached series begins. Those must render **without** an inception marker rather than silently anchoring to the oldest available close.
- **Gate on both legs.** `canChart(priceIdentity(long)) && canChart(priceIdentity(short))`. If either is uncached, **do not draw a spread.** Fall back to the per-leg panes that already exist (`MobileDashboard.tsx:4125`) and say why, in the voice `PricePane`'s no-history state already uses.
- **Multi-leg baskets.** `MAX_LEGS_PER_PAIR = 6`; the widest in production is 4. For more than one leg per side the "spread" is an **equal-weighted** basket ratio, and it must say so — per-leg sizes are not fetched, so it cannot be weight-weighted. If equal weighting is unacceptable, restrict the spread chart to 1x1 pairs and show per-leg panes for baskets.
- **[UNVERIFIED]** No per-asset currency handling exists anywhere in the signals layer. A cross-currency pair may be misrepresented. Percentage-return normalization mitigates but does not eliminate this.

> **Do not fake a spread.** No synthetic series, no substituted symbol, no anchoring to a price that was not observed.

### 10.3 Proposed pair card

**[PROPOSED]**

```
┌───────────────────────────────────────────────────┐
│ ● Pair trade · desk                          ⋯    │
│                                                   │
│ Priya: Long LLY, Short CLOV                       │  headline names both sides
│                                                   │
│      +6.4%            since 6 Mar                 │  METRIC = the spread, not a leg
│      Long side vs short side                      │  source:'computed', vintage:'quote'
│                                                   │
│ LLY +11.2% · CLOV +4.5% since the idea was put up │  body: the decomposition
│                                                   │
│ [Priya Raman] [Core Equity]                       │
│                                                   │
│ Would you put this pair on?                       │  prompt
│                                                   │
│ ┌ Spread │ Long LLY │ Short CLOV │ Respond ────┐  │  SPREAD FIRST, legs second, Respond last
│ │  both legs indexed to 100 at 6 Mar,          │  │
│ │  ratio line, inception marker                │  │
│ └──────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

Pane order is deliberate: **the relationship is the claim**, so it leads. The individual legs are supporting evidence, not the subject.

### 10.4 Contract changes this would require

**[PROPOSED]**

- New `EvidenceKind: 'relative'` in `src/lib/signals/contract.ts`, data `{ long: PricePoint[]; short: PricePoint[]; from: string }`.
- `content-registry.pair_trade` → `assetLinked: true`, `fullscreenChart: true`. Currently `false` on the reasoning that no single symbol is the evidence — correct then, wrong once the evidence is the relationship itself.
- **Fix §7.3 before shipping.** `isDurableEntity` in `judgment-log.ts` must stop writing a pair judgment against the long leg's asset. Either widen `audit_events.entity_type` to accept `pair_trade`, or return `durable: 'skipped'`. Same for `writeJudgmentThought`. **Do not keep filing pair verdicts under one leg.**

**[PROVEN]** There is no existing two-series chart component. `PriceContext`, `Sparkline` and `WeightSeries` are all single-series. This is genuinely new drawing code.

---

## 11. Implementation Risks / Branch Overlap

### 11.1 The overlapping branch

**[PROVEN]** `feat/mobile-ideas-quality` @ `8e20c53` — 15 commits ahead of `main`, 162 files, +8008 / −643. Owned by another session (`C:\dev\tesseract-mobile-ideas`).

| File | Their change | Risk |
|---|---|---|
| **`src/lib/signals/builders/ideas.ts`** | `cea45c8` — removes the dead `Open idea` primary, makes `capture` the primary, empties `quick[]` | **HIGH — same function, adjacent lines.** They have already fixed §5.2.4. |
| **`src/components/mobile/MobileDashboard.tsx`** | 667 lines — scenario panes extracted, recommendation Approve/Decline replaced with `Open decision`, attention `onPrimary` wired, `useFeedSessionStability` added | **HIGH — the idea branch sits inside the churn.** |
| **`src/components/signals/SignalCardView.tsx`** | 139 lines — `judgmentIsTheOnlyPane` and `judgmentIsInOwnShell` promote `on_engage` to `inline`; `barLabel()` extracted | **MEDIUM — changes the exact mechanism §5.2.3 concerns.** |
| **`src/lib/signals/content-registry.ts`** | `team_focus` → `on_engage`; new `judgmentIsDeclaredInline()` export | **MEDIUM — same record literal that `pair_trade` lives in.** |
| `src/lib/signals/contract.ts` | `PortfolioRef.benchmarkPct` added | LOW — different interface. |
| `src/hooks/ideas/useIdeasFeed.ts` | 12 lines | LOW |
| `ScenarioLadder.tsx`, `ScenarioGapPanes.tsx`, `ScenarioRespond.tsx`, `current-ladder.ts`, `scenario-review.ts` | Case vs Price | **NONE — do not touch.** |

### 11.2 Two of their changes directly affect this design

**[PROVEN]**

1. **`judgmentIsTheOnlyPane` promotes `on_engage` to `inline`.** A trade idea whose asset has no cached history and whose body is ≤140 characters has `panes = [verdict]` only, so **after their merge the response is already inline on exactly those cards.** The `prompt` field proposed in §8 must be added with this in mind: `VerdictBar`'s `hideQuestion` guard keys on `card.prompt === question`, so the two strings must match exactly or the question renders twice.
2. **They deliberately did not wire `approveTradeIdea` / `rejectTradeIdea` on mobile**, and recorded why: *"wiring them here would give a phone the authority to commit a trade-queue decision, which is a product call and not a rendering one."* This is the same position as §6. **Do not reverse it in this work.**

### 11.3 Rule

> **DO NOT IMPLEMENT UNTIL CASE VS PRICE MERGES.**

Three of the four files this work needs are in their diff, and `ideas.ts` in particular would conflict on the exact `actions(...)` call that must change.

---

## 12. Implementation Sequence

**[PROPOSED]** Five phases, after `feat/mobile-ideas-quality` merges.

### Phase 0 — rebase and re-read

1. Rebase `audit/trade-idea` onto post-merge `main`.
2. Re-read `ideas.ts`, `SignalCardView.tsx` (~347–420), `content-registry.ts` and the `MobileDashboard` idea branch. Three of the four have moved; the line references in this document will be stale.
3. Confirm against **staging** (never production): the `trade_queue_status` enum labels, the existence of `can_modify_trade_stage`, and the `INSERT` / `UPDATE` policies on `trade_queue_items`. Nothing in §6 should be shipped against until these are read live.

### Phase 1 — truth fixes (independently shippable; no new UI)

4. Fix the `useRecommendationCards` status filter (§7.1). This alone restores the only truthful Approve/Decline card in the product.
5. Classify the eight idea and pair judgment keys in `POLICY`; write `judgment-policy.test.ts` asserting every written key is classified (§7.2).
6. Stop filing pair judgments against the long leg — `judgment-log.ts` `isDurableEntity` and `judgment-thought.ts` `assetIdOf` (§7.3).
7. Resolve the dead `conviction` / `timeHorizon` / `stopLoss` controls in `AddTradeIdeaModal` — either thread them through `CreateTradeParams` into the insert, or remove them. Do not leave them collected and discarded (§7.4).

### Phase 2 — data

8. Widen both `useIdeasFeed` selects: `target_price`, `conviction`, `time_horizon`, `thesis_text` for single names; per-leg `target_price` for pairs. Extend `TradeIdeaItem` and `PairTradeLeg` in `src/hooks/ideas/types.ts`.
9. Reconcile the two pair creation paths (§4.1 vs §4.2): either `QuickTradeIdeaCapture` writes a `pair_trades` parent and `pair_leg_type`, or `createPairTrade` stops doing so. One shape.

### Phase 3 — single-name card

10. `buildIdeaCard`: add `prompt`; add the upside `metric` (suppressing with `missing_number` when no target); add conviction to `context`; keep the existing sparkline evidence declaration.
11. Pass `target_price` as a `PriceBand` and `created_at` as a `PriceMarker` into the existing `pricePane`.
12. New verdict set (§9) with `nextAction` and `consequence` per option. **No approve.**
13. Gallery fixture + `e2e/signal-cards.spec.ts` coverage.

### Phase 4 — pair card

14. `src/lib/signals/relative-series.ts` — pure indexing / ratio / inception resolution, with tests including the "creation date predates the cached series" case.
15. `src/components/signals/RelativeSeries.tsx` and `PairSpreadPane.tsx`, with the both-legs-cached gate.
16. `contract.ts` `EvidenceKind: 'relative'`; `content-registry.pair_trade` → `assetLinked` / `fullscreenChart` true.
17. Pair metric becomes the spread; body becomes the decomposition; the existing per-leg panes become the fallback.
18. Gallery `pair_trade` fixture — **none exists today** (`gallery/main.tsx` has `idea-trade` and `idea-thought` only).

### Phase 5 — the authority decision, last and separate

19. Decide whether a PM may **raise** a `decision_request` from the feed. If yes: it is a **routing** action into `DecisionInbox`, gated on `is_portfolio_pm`, labelled as raising and not deciding, and shown only to a reader who is PM on that book. If no: ship Phases 1–4 and leave the card as a place to express a view. See §13.

---

## 13. Deferred Follow-Ups

These are recorded here rather than started. **[DEFERRED]** in every case.

### 13.1 Security / authority follow-up — NOT this branch

**Owner: whoever owns the security work. Do not resolve during this audit.**

1. **`portfolio_team.role` vs `portfolio_memberships.is_portfolio_manager`.** Two tables answer "is this person a PM" (§6C). `trade-idea-permissions.ts` reads the first; the `is_portfolio_pm` RPC reads the second. They can disagree. Which is the source of truth is a platform decision, not a Trade Idea decision.
2. **`trade_idea_portfolios` UPDATE policy vs the client's PM gate.** The RLS policy admits any `portfolio_team` member; the client admits only PMs (§6C). Either the policy should carry the PM check the client pretends it has, or the client should stop pretending. This is a privilege question with a blast radius well beyond the Trade Idea card.
3. **`can_modify_trade_stage` has no defining migration** (§6C, `[UNVERIFIED]`), and `trade_queue_items` has no `INSERT` / `UPDATE` policy in the ledger. Both need a live read against staging.
4. **`useAttention.approveTradeIdea` / `rejectTradeIdea`** perform unauthenticated-by-role status writes with no audit trail (§6D). Whether they should be removed, gated, or redirected through `setDecisionOutcome` is a separate change with three desktop callers.

### 13.2 Broader product follow-up

1. **Should a PM be able to raise a `decision_request` directly from the feed?**
   This is the one escalation that would be truthful: it moves an idea into the queue where `DecisionInbox` can accept it into `accepted_trades`. It is *raising*, not *deciding*. It is nonetheless a change to how work enters the decision queue, and it should be decided as a product question — not adopted as a side effect of a card redesign. Phase 5.
2. **Desktop pair variant.** `FeedCard.tsx` has no `pair_trade` case (§5.2.8), so the desktop feed shows one leg. Out of scope for the Mobile Ideas card type; worth its own ticket.
3. **Desktop feed navigation.** A trade idea is unreachable from the desktop feed (§5.2.7). Same — separate ticket.
4. **`trade_queue_votes`** is read and never written (§6E). Decide whether it is being revived or removed.

---

## Appendix — files read for this audit

`src/lib/signals/`: `contract.ts`, `content-registry.ts`, `dispositions.ts`, `judgment-log.ts`, `judgment-policy.ts`, `judgment-thought.ts`, `feed-actions.ts`, `feed-priority.ts`, `price-snapshot.ts`, `price-availability.ts`, `card-identity.ts`, `builders/ideas.ts`, `builders/shared.ts`, `builders/recommendation.ts`

`src/components/signals/`: `SignalCardView.tsx`, `VerdictBar.tsx`, `PricePane.tsx`, `PriceContext.tsx`, `WeightSeries.tsx`

`src/components/mobile/`: `MobileDashboard.tsx`, `SignalCardSection.tsx`, `FeedCaptureSheet.tsx`, `MobilePipeline.tsx`

`src/components/ideas/`: `feed/FeedCard.tsx`, `feed/IdeasFeedPage.tsx`, `cards/TradeIdeaCard.tsx`

`src/components/trading/`: `AddTradeIdeaModal.tsx`, `DecisionInbox.tsx`

`src/components/thoughts/QuickTradeIdeaCapture.tsx`

`src/hooks/`: `ideas/useIdeasFeed.ts`, `ideas/useContentAggregation.ts`, `ideas/types.ts`, `mobile/useSymbolHistory.ts`, `mobile/useRecommendationCards.ts`, `usePipelineItems.ts`, `useAttention.ts`, `useDecisionRequests.ts`

`src/lib/`: `ideas/open-proposal.ts`, `permissions/trade-idea-permissions.ts`, `services/trade-idea-service.ts`, `mobile/mobile-surfaces.ts`

`src/types/trading.ts`

`supabase/migrations/`: `20260203004535_create_trade_lab_proposal_system.sql`, `20260313172549_add_decision_price_snapshots.sql`, `20260314000004_fix_is_portfolio_pm_function.sql`, `20260316110000_add_idea_expression_fields.sql`, `20260426030000_org_admin_decision_authority.sql`, `20260603020000_trade_queue_items_organization_id.sql`

`gallery/main.tsx`
